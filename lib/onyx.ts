import "server-only";
import {
  DEFAULT_MARKET_PAGE_SIZE,
  MAX_MARKET_PAGE_SIZE,
  type Market,
  type MarketFilters,
  type MarketPage,
} from "./market";

const BASE_URL = "https://predictions.dev-onyxodds.com";
const REQUEST_TIMEOUT_MS = 10_000;

// All knowledge of the provider's wire format stays in this server-only file.
type RawOnyxMarket = {
  id: string;
  symbol: string;
  sport: string;
  name: string;
  event_name: string | null;
  status: string;
  expiry_date: string;
  min_price: number;
  max_price: number;
  yes_price: number | null;
};

type OnyxErrorCode =
  | "NOT_CONFIGURED"
  | "UPSTREAM_AUTH"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_TIMEOUT"
  | "INVALID_RESPONSE";

export class OnyxError extends Error {
  readonly code: OnyxErrorCode;

  constructor(code: OnyxErrorCode) {
    super("Market data is temporarily unavailable.");
    this.name = "OnyxError";
    this.code = code;
  }
}

function fail(code: OnyxErrorCode, status?: number): never {
  // Never include the token, response body, URL, or original exception.
  console.error("[onyx] Market request failed.", { code, status });
  throw new OnyxError(code);
}

function isRawMarket(value: unknown): value is RawOnyxMarket {
  if (!value || typeof value !== "object") return false;
  const market = value as Record<string, unknown>;

  return (
    typeof market.id === "string" && market.id.length > 0 &&
    typeof market.symbol === "string" &&
    typeof market.sport === "string" &&
    typeof market.name === "string" &&
    (market.event_name === null || typeof market.event_name === "string") &&
    typeof market.status === "string" &&
    typeof market.expiry_date === "string" &&
    Number.isFinite(Date.parse(market.expiry_date)) &&
    typeof market.min_price === "number" && Number.isFinite(market.min_price) &&
    typeof market.max_price === "number" && Number.isFinite(market.max_price) &&
    market.min_price >= 0 && market.max_price <= 1 &&
    market.min_price <= market.max_price &&
    (market.yes_price === null ||
      (typeof market.yes_price === "number" &&
        Number.isFinite(market.yes_price) &&
        market.yes_price >= 0 && market.yes_price <= 1))
  );
}

function normalizeMarket(raw: RawOnyxMarket, now: number): Market {
  const yesPrice = raw.yes_price;

  return {
    id: raw.id,
    symbol: raw.symbol,
    title: raw.name.trim() || raw.event_name?.trim() || "Untitled market",
    sport: raw.sport,
    status: raw.status,
    expiresAt: new Date(raw.expiry_date).toISOString(),
    yesPrice,
    noPrice: yesPrice === null ? null : 1 - yesPrice,
    isTradable:
      raw.status === "open" && Date.parse(raw.expiry_date) > now &&
      yesPrice !== null && yesPrice >= raw.min_price && yesPrice <= raw.max_price,
  };
}

export type FetchMarketsOptions = MarketFilters & {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
};

export async function fetchMarkets({
  limit = DEFAULT_MARKET_PAGE_SIZE,
  offset = 0,
  signal,
  ...filters
}: FetchMarketsOptions = {}): Promise<MarketPage> {
  if (
    !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_MARKET_PAGE_SIZE ||
    !Number.isSafeInteger(offset) || offset < 0 ||
    !Number.isSafeInteger(offset + limit)
  ) {
    throw new RangeError("Invalid market pagination.");
  }

  const token = process.env.ONYX_API_TOKEN;
  if (!token) fail("NOT_CONFIGURED");

  const url = new URL("/markets", BASE_URL);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const filterNames = {
    sport: "sport",
    status: "status",
    eventType: "event_type",
    contractType: "contract_type",
    periodType: "period_type",
  } as const;
  for (const key of Object.keys(filterNames) as (keyof MarketFilters)[]) {
    const value = filters[key];
    if (value) url.searchParams.set(filterNames[key], value);
  }

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let payload: unknown;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: requestSignal,
    });

    if (response.status === 401 || response.status === 403) {
      fail("UPSTREAM_AUTH", response.status);
    }
    if (!response.ok) fail("UPSTREAM_UNAVAILABLE", response.status);

    try {
      payload = await response.json();
    } catch {
      if (requestSignal.aborted) throw new Error("Request aborted.");
      fail("INVALID_RESPONSE");
    }
  } catch (error) {
    if (error instanceof OnyxError) throw error;
    if (signal?.aborted) throw new DOMException("Request aborted.", "AbortError");
    if (timeout.aborted) fail("UPSTREAM_TIMEOUT");
    fail("UPSTREAM_UNAVAILABLE");
  }

  // The observed endpoint returns a bare array, without total/next-page fields.
  // Fail the whole page on malformed records rather than silently losing rows.
  if (!Array.isArray(payload) || payload.length > limit || !payload.every(isRawMarket)) {
    fail("INVALID_RESPONSE");
  }

  const now = Date.now();
  const markets = new Map<string, Market>();
  for (const raw of payload) markets.set(raw.id, normalizeMarket(raw, now));

  return {
    markets: [...markets.values()],
    limit,
    offset,
    hasMore: payload.length === limit,
  };
}

export async function fetchAllMarkets(
  options: MarketFilters & { signal?: AbortSignal } = {},
): Promise<Market[]> {
  const markets = new Map<string, Market>();
  let offset = 0;

  while (true) {
    const page = await fetchMarkets({ ...options, limit: MAX_MARKET_PAGE_SIZE, offset });
    const previousSize = markets.size;
    for (const market of page.markets) markets.set(market.id, market);
    if (!page.hasMore) return [...markets.values()];

    // An upstream that ignores offsets must fail rather than loop indefinitely
    // or return a silently truncated catalog. Symbols are never used as keys.
    if (markets.size === previousSize) fail("INVALID_RESPONSE");
    offset += page.limit;
  }
}

export async function fetchMarketById(id: string, signal?: AbortSignal): Promise<Market | null> {
  const seen = new Set<string>();
  let offset = 0;
  while (true) {
    const page = await fetchMarkets({ limit: MAX_MARKET_PAGE_SIZE, offset, signal });
    const market = page.markets.find((item) => item.id === id);
    if (market) return market;
    if (!page.hasMore) return null;
    const previousSize = seen.size;
    for (const item of page.markets) seen.add(item.id);
    if (seen.size === previousSize) fail("INVALID_RESPONSE");
    offset += page.limit;
  }
}
