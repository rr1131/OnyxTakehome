"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type RefObject } from "react";
import BuyControls from "./buy-controls";
import Portfolio from "./portfolio";
import { usePortfolioAccount } from "./use-portfolio-account";
import { DEFAULT_MARKET_PAGE_SIZE, type MarketPage } from "@/lib/market";

const POLL_DELAY_MS = 5_000;
const priceFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

type Pagination = { limit: number; offset: number };

export default function MarketBrowser() {
  const submissionRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const { account, error: accountError, signedOut, refreshAccount } = usePortfolioAccount();
  const [pagination, setPagination] = useState<Pagination>({
    limit: DEFAULT_MARKET_PAGE_SIZE,
    offset: 0,
  });

  return (
    <>
      <Portfolio account={account} error={accountError} signedOut={signedOut} />
      <section className="market-browser" aria-labelledby="markets-heading">
        <div className="market-toolbar">
          <div>
            <h2 id="markets-heading">Markets</h2>
            <p>Prices refresh about every five seconds.</p>
          </div>
          <label>
            Markets per page{" "}
            <select
              value={pagination.limit}
              disabled={submitting || signedOut}
              onChange={(event) => setPagination({ limit: Number(event.target.value), offset: 0 })}
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        </div>
        <MarketList
          key={`${pagination.limit}:${pagination.offset}`}
          pagination={pagination}
          onNavigate={setPagination}
          onAccountRefresh={refreshAccount}
          submitting={submitting || signedOut}
          submissionRef={submissionRef}
          onPendingChange={setSubmitting}
        />
      </section>
    </>
  );
}

function MarketList({ pagination, onNavigate, onAccountRefresh, submitting, submissionRef, onPendingChange }: {
  pagination: Pagination;
  onNavigate: (pagination: Pagination) => void;
  onAccountRefresh: () => Promise<void>;
  submitting: boolean;
  submissionRef: RefObject<boolean>;
  onPendingChange: (pending: boolean) => void;
}) {
  const { limit, offset } = pagination;
  const [page, setPage] = useState<MarketPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    async function refresh() {
      let continuePolling = true;
      try {
        const response = await fetch(`/api/markets?limit=${limit}&offset=${offset}`, {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        if (!active) return;
        if (response.status === 401) {
          continuePolling = false;
          setSignedOut(true);
          throw new Error("Your session has ended. Sign in to continue browsing.");
        }
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.code === "UPSTREAM_AUTH"
            ? "Market data authentication failed. Please contact the application owner."
            : "Could not refresh markets. Retrying automatically.");
        }

        const result: MarketPage = await response.json();
        if (!active) return;
        setPage(result);
        setError(null);
        setUpdatedAt(new Date().toLocaleTimeString());
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error && cause.name === "Error"
          ? cause.message
          : "Could not refresh markets. Retrying automatically.");
      } finally {
        // Schedule only after the request settles: one timer/request for the
        // whole page, never an interval or a polling loop per market card.
        if (active && continuePolling) timer = setTimeout(refresh, POLL_DELAY_MS);
      }
    }

    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [limit, offset]);

  return (
    <>
      {error && (
        <p className="market-error" role="alert">
          {error} {page && "Displayed prices may be outdated."}{" "}
          {signedOut && <Link href="/sign-in">Sign in</Link>}
        </p>
      )}
      {!page && !error && <p className="state-message" role="status">Loading live markets…</p>}
      {updatedAt && <p className="auth-state">Last successful update: {updatedAt}</p>}
      {page?.markets.length === 0 && (
        <p className="state-message" role="status">
          {offset > 0
            ? "No markets on this page. Use Previous to return to the catalog."
            : "No markets are available right now. Checking again automatically."}
        </p>
      )}
      <ul className="market-list">
        {page?.markets.map((market) => (
          <li className="market-card" key={market.id}>
            <h3>{market.title}</h3>
            <p className="auth-state">{market.sport} · {market.status}</p>
            <dl className="market-prices">
              <div>
                <dt>YES</dt>
                <dd>{market.yesPrice === null ? "Unavailable" : priceFormat.format(market.yesPrice)}</dd>
              </div>
              <div>
                <dt>NO</dt>
                <dd>{market.noPrice === null ? "Unavailable" : priceFormat.format(market.noPrice)}</dd>
              </div>
            </dl>
            {market.yesPrice === null ? (
              <p className="auth-state">Pricing unavailable · Not tradable</p>
            ) : !market.isTradable ? (
              <p className="auth-state">Not tradable</p>
            ) : null}
            <BuyControls market={market} disabled={signedOut || submitting}
              onAccountRefresh={onAccountRefresh} submissionRef={submissionRef}
              onPendingChange={onPendingChange} />
          </li>
        ))}
      </ul>
      <nav className="market-pagination" aria-label="Market pages">
        <button
          className="button button-secondary"
          disabled={offset === 0 || signedOut || submitting}
          onClick={() => onNavigate({ limit, offset: Math.max(0, offset - limit) })}
        >
          Previous
        </button>
        <span>Page {Math.floor(offset / limit) + 1}</span>
        <button
          className="button"
          disabled={!page?.hasMore || signedOut || submitting}
          onClick={() => onNavigate({ limit, offset: offset + limit })}
        >
          Next
        </button>
      </nav>
    </>
  );
}
