import Link from "next/link";
import type { PortfolioAccount } from "@/lib/portfolio";

const moneyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const priceFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});
const quantityFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 8,
});
const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

function money(value: string | null, price = false): string {
  if (value === null) return "Unavailable";
  const number = Number(value);
  return Number.isFinite(number)
    ? (price ? priceFormat : moneyFormat).format(number)
    : "Unavailable";
}

function quantity(value: string): string {
  const number = Number(value);
  return Number.isFinite(number) ? quantityFormat.format(number) : "Unavailable";
}

function timestamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateFormat.format(date) : "Unavailable";
}

export default function Portfolio({ account, error, signedOut }: {
  account: PortfolioAccount | null;
  error: string | null;
  signedOut: boolean;
}) {
  if (signedOut) {
    return (
      <section className="portfolio" aria-labelledby="portfolio-heading">
        <h2 id="portfolio-heading">Portfolio</h2>
        <p role="alert">Your session has ended. <Link href="/sign-in">Sign in</Link> to view your account.</p>
      </section>
    );
  }

  const liveUnavailable = Boolean(error);
  const orders = new Map(account?.orders.map((order) => [order.id, order]));
  const markets = new Map(account?.positions.map((position) => [position.marketId, position.market]));
  const recentFills = [...(account?.fills ?? [])]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 20);

  return (
    <section className="portfolio" aria-labelledby="portfolio-heading">
      <h2 id="portfolio-heading">Portfolio</h2>
      {error && (
        <p className="market-error" role="alert">
          {error}{account && " Cash and trading history are last known values. Live values are unavailable until the next successful refresh."}
        </p>
      )}
      {!account && !error && <p role="status">Loading account…</p>}
      {account && (
        <>
          <dl className="portfolio-summary">
            <div>
              <dt>Cash</dt>
              <dd>{money(account.balance)}</dd>
            </div>
            <div>
              <dt>Portfolio equity{account.unpricedPositionCount > 0 && !liveUnavailable ? " (partial)" : ""}</dt>
              <dd>{money(liveUnavailable ? null : account.equity)}</dd>
            </div>
            <div>
              <dt>Total unrealized P&amp;L</dt>
              <dd>{money(liveUnavailable ? null : account.totalUnrealizedPnl)}</dd>
            </div>
          </dl>
          {!liveUnavailable && account.unpricedPositionCount > 0 && (
            <p className="auth-state" role="status">
              Pricing unavailable for {account.unpricedPositionCount} position{account.unpricedPositionCount === 1 ? "" : "s"}.
              {" "}Equity includes cash and available position values only. Total unrealized P&amp;L is unavailable until all positions have prices.
            </p>
          )}
          {!liveUnavailable && account.pricingUnavailable && account.unpricedPositionCount === 0 && (
            <p className="auth-state" role="status">Live market pricing is unavailable.</p>
          )}
          {!liveUnavailable && account.pricingUpdatedAt && (
            <p className="auth-state">
              Prices refreshed <time dateTime={account.pricingUpdatedAt}>{timestamp(account.pricingUpdatedAt)}</time>.
              {" "}Portfolio pricing refreshes automatically.
            </p>
          )}

          <h3 id="positions-heading">Positions ({account.positions.length})</h3>
          {account.positions.length === 0 ? <p>No positions yet.</p> : (
            <div className="portfolio-table-scroll" role="region" aria-labelledby="positions-heading" tabIndex={0}>
              <table className="portfolio-table">
                <thead>
                  <tr>
                    <th scope="col">Market</th>
                    <th scope="col">Side</th>
                    <th scope="col" className="numeric">Quantity</th>
                    <th scope="col" className="numeric">Cost basis</th>
                    <th scope="col" className="numeric">Avg. entry</th>
                    <th scope="col" className="numeric">Current price</th>
                    <th scope="col" className="numeric">Current value</th>
                    <th scope="col" className="numeric">Unrealized P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {account.positions.map((position) => (
                    <tr key={`${position.marketId}:${position.side}`}>
                      <th scope="row" className="portfolio-market" title={position.marketId}>
                        {position.market?.title ?? position.marketId}
                      </th>
                      <td>{position.side}</td>
                      <td className="numeric" title={position.quantity}>{quantity(position.quantity)}</td>
                      <td className="numeric">{money(position.costBasis)}</td>
                      <td className="numeric">{money(position.averageEntry, true)}</td>
                      <td className="numeric">{money(liveUnavailable ? null : position.currentSidePrice, true)}</td>
                      <td className="numeric">{money(liveUnavailable ? null : position.currentValue)}</td>
                      <td className="numeric">{money(liveUnavailable ? null : position.unrealizedPnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 id="fills-heading">Recent fills / order history</h3>
          {recentFills.length === 0 ? <p>No filled orders yet.</p> : (
            <>
              <p className="auth-state">Showing {recentFills.length} of {account.fills.length} fills · {account.orders.length} orders</p>
              <div className="portfolio-table-scroll" role="region" aria-labelledby="fills-heading" tabIndex={0}>
                <table className="portfolio-table">
                  <thead>
                    <tr>
                      <th scope="col">Filled at</th>
                      <th scope="col">Market</th>
                      <th scope="col">Side</th>
                      <th scope="col" className="numeric">Quantity</th>
                      <th scope="col" className="numeric">Fill price</th>
                      <th scope="col" className="numeric">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentFills.map((fill) => {
                      const order = orders.get(fill.orderId);
                      const market = order ? markets.get(order.marketId) : null;
                      return (
                        <tr key={fill.id} title={`Order ${fill.orderId}`}>
                          <td><time dateTime={fill.createdAt}>{timestamp(fill.createdAt)}</time></td>
                          <th scope="row" className="portfolio-market" title={order?.marketId}>
                            {market?.title ?? order?.marketId ?? "Market unavailable"}
                          </th>
                          <td>{order?.outcome ?? "Unavailable"}</td>
                          <td className="numeric" title={fill.quantity}>{quantity(fill.quantity)}</td>
                          <td className="numeric">{money(fill.price, true)}</td>
                          <td className="numeric">{money(fill.totalCost)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
