# Onyx Paper Trading

**Live demo:** [onyx-takehome.vercel.app](https://onyx-takehome.vercel.app)

Welcome to Rods TakeHome Paper Trading project!

A small paper-trading app with Clerk sign-in, live Onyx markets, $1,000 in
starting virtual cash, buy-only YES/NO orders, and a persistent portfolio with
unrealized P&L. No real money or upstream trades are involved.

## TESTING FOR YOU GUYS

Made you all an account for testing: 

email = testonyx@gmail.com
password = g30dud31234567!

## Local setup

Use Node.js 20.9+ and npm.

```sh
npm ci
cp .env.example .env.local
```

1. Create a Clerk application and copy its publishable and secret keys into
   `.env.local`. This time-boxed demo uses a **Clerk development instance**.
2. Create a Neon database and set `DATABASE_URL` to its PostgreSQL connection
   string with SSL enabled. Set `ONYX_API_TOKEN` to a valid Onyx dev access token.
   Keep the Clerk route variables from `.env.example` at their supplied defaults.
3. In the Neon SQL editor, apply **all of `db/schema.sql` once to a fresh database**.
   For an existing database from an earlier block, apply `db/block4.sql` instead
   to enable fractional quantities and the current execution function. Do not
   reapply the initial schema to an existing database. See [database setup](db/README.md).
4. Run `npm run dev` and open [localhost:3000](http://localhost:3000). Sign up to
   create an account; the first account read grants $1,000 exactly once.

Required values are `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
`DATABASE_URL`, and `ONYX_API_TOKEN`. The four Clerk sign-in/sign-up URL and
fallback redirect variables are listed in `.env.example`; the application also
defaults them to `/sign-in`, `/sign-up`, and `/dashboard`.

For Vercel, configure the same variables in the deployment environment and
redeploy after changes. Only the Clerk publishable key and route variables are
public; database credentials, the Clerk secret key, and the Onyx token stay on
the server. Never commit `.env.local`.

```sh
npm run lint
npm run build
```

## Architecture

Next.js App Router, TypeScript, React, plain CSS, Clerk, and Neon PostgreSQL;
hosted on Vercel. Clerk's `proxy.ts` integration supplies authentication, and
the dashboard and API handlers enforce the authenticated session server-side.

- `GET /api/markets` reads the Onyx catalog through `lib/onyx.ts`.
- `GET /api/account` reads a consistent user-scoped database snapshot and joins
  fresh Onyx prices to calculate portfolio values on the server.
- `POST /api/orders` accepts only `marketId`, `side`, and a positive USD
  `notional`. It refreshes the market quote, then executes one PostgreSQL function.

Onyx is read-only. PostgreSQL owns account/trade state and does not store the
canonical market catalog. Refreshing the page or signing in again restores the
same account; YES and NO holdings remain separate.

## Database model

| Table | Purpose |
| --- | --- |
| `accounts` | One row per Clerk user ID; cash starts at $1,000. |
| `orders` | User, upstream market UUID, side, quantity, filled status, timestamp. |
| `fills` | One execution per order with actual price, quantity, and generated cost. |
| `positions` | Accumulated quantity and cost basis keyed by user, market UUID, and side. |

Primary/foreign keys, checks, timestamps, and a user order-history index protect
and support these records. Money/prices use six decimal places, fractional
quantities use twelve, and PostgreSQL `NUMERIC` values serialize as decimal
strings. Portfolio arithmetic also uses decimal values; UI formatting rounds
for display. Average entry is cost basis / quantity; current value is quantity
× current side price; unrealized P&L is current value − cost basis.

## Design decisions and tradeoffs

- **Normalized adapter:** `lib/onyx.ts` is server-only and contains all knowledge
  of the raw Onyx schema. It calls `GET https://predictions.dev-onyxodds.com/markets`
  with `limit`/`offset`; helpers support pages, the full catalog, and UUID lookup.
- **Identity:** upstream market UUID `id` is canonical because observed `symbol`
  values may repeat. Symbols are metadata, never lookup or position keys.
- **Prices:** YES comes from upstream `yes_price`; I defined NO as `1 - YES`
  because the observed schema has no explicit NO price. Null-priced markets
  remain browseable but cannot be traded.
- **Authoritative execution:** the server takes the user from Clerk and performs
  a fresh catalog lookup by UUID at submission, since no reliable unique-ID quote
  endpoint was observed. It rejects missing, closed, expired, or unpriced markets
  and invalid notionals. Client prices are rejected. Quantity is notional / fresh
  side price; responses include the actual persisted fill price and quantity.
- **Atomic cash safety:** `execute_paper_order` creates the account if needed,
  conditionally debits sufficient cash, inserts the order/fill, and upserts the
  position in one transaction. The conditional `UPDATE` locks the account row
  and rechecks available cash under contention, preventing concurrent overspending.
  Any failure rolls back the entire call; insufficient funds returns a clean 409.
- **Polling:** the displayed market page refreshes five seconds after each request
  settles, with one loop for the list and no overlapping polls. This is simpler
  than streaming but adds latency and repeated upstream requests. Portfolio
  pricing polls every 15 seconds after completion and refreshes immediately after
  a buy. Reads use `no-store`; quote scans for execution/portfolio have a 20-second
  overall deadline. Catalog scans are slower than a dedicated quote endpoint.
- **Unavailable marks:** positions/history remain visible when quotes disappear
  or Onyx fails. Missing current prices, values, and P&L are `null`, not invented
  zeroes. Equity is cash + available position values and is labeled partial when
  needed; total unrealized P&L is unavailable until all holdings are priced.
- **Onyx authentication:** the server sends `Authorization: Bearer <token>` from
  `ONYX_API_TOKEN`. Its observed lifetime is approximately 24 hours. There is no
  automatic refresh: replace an expired token in the environment and redeploy.
  Upstream auth errors are sanitized; server logs retain safe error codes without
  credentials, provider payloads, or raw exceptions. I'll make a new one before. 

## Known limitations

Buy-only market orders fill completely at the latest quoted price: no selling,
settlement, realized P&L, fees, slippage, or order-book liquidity simulation.
Development Clerk credentials and a manually renewed Onyx token suit a demo,
not production. Offset pagination can shift while the upstream catalog changes.
Execution supports prices up to six decimal places and notionals to cents.

The UI blocks duplicate clicks in flight, but there is no server idempotency:
after an ambiguous network failure, inspect order history before retrying.
History reads are unpaginated; the UI shows the latest 20 fills. There is no
checked-in automated test suite or production monitoring; lint/build and
temporary integration checks cover the current implementation.

## What I'd build next

- Selling functionality for existing filled orders at current market price
- Would polish the UI to enable filtering via get/market endpoint filters (sport, event type)
- Streaming/WebSockets for price updates and fewer catalog scans.
- Idempotency keys and safe order retries.
- Settlement and realized P&L, with an auditable ledger.
- Automated tests for concurrency, provider contracts, and authenticated flows.
- Monitoring/observability: structured logs, metrics, tracing, and alerts.
- AWS + Terraform production infrastructure, with managed secrets and a
  production Clerk instance.
