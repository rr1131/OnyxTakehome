import "server-only";
import { getAccountState } from "./account";
import type { Market } from "./market";
import { fetchMarketsByIds, OnyxError } from "./onyx";
import type { PortfolioAccount, PortfolioPosition } from "./portfolio";

const PRICING_TIMEOUT_MS = 20_000;
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);

type Decimal = { units: bigint; scale: number };

// Keep persisted NUMERIC values exact. Price numbers are converted from their
// decimal representation once; all subsequent arithmetic uses integers.
function decimal(value: string): Decimal {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value);
  if (!match) throw new Error("Invalid account amount.");
  const fraction = match[3] ?? "";
  const scale = fraction.length - Number(match[4] ?? 0);
  const units = BigInt(`${match[1]}${match[2]}${fraction}`);
  return scale >= 0
    ? { units, scale }
    : { units: units * TEN ** BigInt(-scale), scale: 0 };
}

function add(left: Decimal, right: Decimal): Decimal {
  const scale = Math.max(left.scale, right.scale);
  return {
    units:
      left.units * TEN ** BigInt(scale - left.scale) +
      right.units * TEN ** BigInt(scale - right.scale),
    scale,
  };
}

function subtract(left: Decimal, right: Decimal): Decimal {
  return add(left, { units: -right.units, scale: right.scale });
}

function multiply(left: Decimal, right: Decimal): Decimal {
  return { units: left.units * right.units, scale: left.scale + right.scale };
}

function averageEntry(cost: Decimal, quantity: Decimal): Decimal {
  if (quantity.units <= ZERO) throw new Error("Invalid position quantity.");
  // Division may recur. Round average entry to 18 decimals, without rounding
  // either current value or P&L (which use exact multiplication/subtraction).
  const scale = 18;
  const numerator = cost.units * TEN ** BigInt(scale + quantity.scale);
  const denominator = quantity.units * TEN ** BigInt(cost.scale);
  const remainder = numerator % denominator;
  const units = numerator / denominator +
    (remainder * BigInt(2) >= denominator ? ONE : ZERO);
  return { units, scale };
}

function formatDecimal(value: Decimal): string {
  if (value.units === ZERO) return "0";
  const negative = value.units < ZERO;
  const digits = (negative ? -value.units : value.units).toString();
  if (value.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(value.scale + 1, "0");
  const fraction = padded.slice(-value.scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${padded.slice(0, -value.scale)}${fraction ? `.${fraction}` : ""}`;
}

export async function getPortfolioState(
  userId: string,
  signal?: AbortSignal,
): Promise<PortfolioAccount> {
  const account = await getAccountState(userId, signal);
  signal?.throwIfAborted();
  let markets = new Map<string, Market>();
  let pricingUpdatedAt: string | null = null;

  if (account.positions.length > 0) {
    // This deadline bounds the whole catalog scan, rather than resetting on
    // each page. Disconnecting a client cancels remaining catalog requests.
    const deadline = AbortSignal.timeout(PRICING_TIMEOUT_MS);
    const pricingSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      markets = await fetchMarketsByIds(
        account.positions.map((position) => position.marketId),
        pricingSignal,
      );
      pricingSignal.throwIfAborted();
      pricingUpdatedAt = new Date().toISOString();
    } catch (error) {
      signal?.throwIfAborted();
      const code = deadline.aborted
        ? "UPSTREAM_TIMEOUT"
        : error instanceof OnyxError ? error.code : "UNKNOWN";
      // Account state remains available on quote failure. Never log provider
      // payloads, request headers, original exceptions, or database records.
      console.error("[portfolio] Current prices are unavailable.", { code });
      markets.clear();
    }
  }

  let equity = decimal(account.balance);
  let totalUnrealizedPnl = decimal("0");
  let unpricedPositionCount = 0;
  const positions = account.positions.map((position): PortfolioPosition => {
    const market = markets.get(position.marketId) ?? null;
    const quantity = decimal(position.quantity);
    const costBasis = decimal(position.totalCost);
    const yesPrice = market?.yesPrice;
    const priced = typeof yesPrice === "number" && Number.isFinite(yesPrice) &&
      yesPrice >= 0 && yesPrice <= 1;
    // Tradability is irrelevant to marking an existing holding. A quoted zero
    // is a real price; null, removed markets, and failed retrieval are not.
    const currentSidePrice = priced
      ? position.outcome === "YES"
        ? decimal(String(yesPrice))
        : subtract(decimal("1"), decimal(String(yesPrice)))
      : null;
    const currentValue = currentSidePrice === null
      ? null
      : multiply(quantity, currentSidePrice);
    const unrealizedPnl = currentValue === null
      ? null
      : subtract(currentValue, costBasis);

    if (currentValue !== null && unrealizedPnl !== null) {
      equity = add(equity, currentValue);
      totalUnrealizedPnl = add(totalUnrealizedPnl, unrealizedPnl);
    } else {
      unpricedPositionCount += 1;
    }

    return {
      ...position,
      market,
      side: position.outcome,
      costBasis: position.totalCost,
      averageEntry: formatDecimal(averageEntry(costBasis, quantity)),
      currentSidePrice: currentSidePrice === null ? null : formatDecimal(currentSidePrice),
      currentValue: currentValue === null ? null : formatDecimal(currentValue),
      unrealizedPnl: unrealizedPnl === null ? null : formatDecimal(unrealizedPnl),
    };
  });

  signal?.throwIfAborted();
  return {
    ...account,
    positions,
    equity: formatDecimal(equity),
    totalUnrealizedPnl: unpricedPositionCount > 0 ? null : formatDecimal(totalUnrealizedPnl),
    unpricedPositionCount,
    pricingUpdatedAt,
    pricingUnavailable: unpricedPositionCount > 0,
  };
}
