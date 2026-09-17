# Block 2 database setup

Apply the entire contents of `db/schema.sql` once in the **Neon SQL editor** for
the database named by `DATABASE_URL`. Alternatively, with the connection string
already exported in your shell:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
```

The script runs in a transaction and creates four tables, the order-history
index, and `public.execute_paper_order`. It is an initial schema, not a repeatable
migration: existing objects cause an error rather than silently changing data.
No schema has been applied automatically. Use the schema-owning database role
for the application; function execution is revoked from `PUBLIC`.

The supplied `AGENTS.md` names the four tables but does not contain their fields
or the referenced function signature. This block uses these explicit defaults:

- One account per Clerk user ID, initially credited with exactly $1,000 once.
- Buy-only, fully filled YES/NO orders, with positive whole contract quantities.
- Fill prices are **USD per contract**, greater than zero and at most one, with
  at most six decimal places. Raw upstream price units must be normalized by the
  future server order handler. No market data is stored or fetched here.
- Positions are unique per user, market, and outcome. Quantity and exact total
  cost are accumulated; average acquisition price is derived from those values.
- UUID order/fill IDs, foreign keys, checks, and timezone-aware timestamps.
- `orders_user_history_idx` covers user history in descending creation order.

## Atomic paper order function

```sql
SELECT * FROM public.execute_paper_order(
  p_user_id    => 'clerk-user-id',
  p_market_id  => 'upstream-market-id',
  p_outcome   => 'YES',
  p_quantity  => 10,
  p_fill_price => 0.450000
);
```

This example **writes a trade**; it is not part of the schema setup. The result
contains `order_id`, `fill_id`, and the remaining `balance`.

The function inserts an account on first use, then debits with
`UPDATE ... WHERE balance >= cost RETURNING balance`. PostgreSQL locks that
account row and rechecks the condition after any concurrent updater commits.
It inserts the order and fill and upserts the position in the same transaction.
Every exception propagates and rolls back the whole call, including initial
account creation. Invalid input uses SQLSTATE `22023`; insufficient cash uses
`P0001`. Higher transaction isolation can yield a serialization failure instead
of an insufficient-cash error; the transaction still rolls back safely.

The future server handler must obtain the Clerk user ID and authoritative price
itself. This function does not verify market status or prevent duplicate
submissions; each successful call is a distinct order.

## Authenticated account endpoint

`GET /api/account` accepts the current Clerk session. It does not accept a user
ID from query parameters or the request body. Signed-out requests receive `401`
before any database call; failures receive a generic `500`. Application logs
contain a fixed message and, when available, SQLSTATE, never raw exceptions.
Responses use `Cache-Control: private, no-store`.

The endpoint initializes an absent account using `ON CONFLICT DO NOTHING`, so
repeated or simultaneous reads cannot replenish an existing balance. It reads
all state in one SQL snapshot and scopes every collection to the session user.

Example for a new user (timestamps abbreviated):

```json
{
  "userId": "clerk-user-id",
  "currency": "USD",
  "balance": "1000.000000",
  "createdAt": "2026-09-16T00:00:00+00:00",
  "updatedAt": "2026-09-16T00:00:00+00:00",
  "positions": [],
  "orders": [],
  "fills": []
}
```

All PostgreSQL NUMERIC values are explicitly converted to decimal strings before
JSON construction. Quantities are JSON integers; IDs and timestamps are strings.
History is newest first; positions are sorted by market and outcome. History is
unpaginated for this prototype. There are no live prices, P&L, market requests,
or `POST /api/orders` in this block.

After applying the schema, sign in and open `/api/account`. Repeated requests
should preserve the same $1,000 balance and account creation time. Use a second
account to verify isolation and a private/signed-out browser to verify `401`.

```sh
npm run lint
npm run build
```

## Validation performed

Lint and the production build passed. The schema and account query were also
run against a disposable local PostgreSQL 18 instance. Checks covered invalid
inputs, insufficient cash, rollback after a forced late position failure,
overlapping orders on the same account, simultaneous first-use funding,
concurrent position accumulation, user isolation, history ordering, and exact
decimal serialization. The route was exercised with a mocked Clerk session
and local database transport to verify `401`, identity scoping, no-cache
headers, and sanitized `500` responses. Live Clerk/Neon integration still needs
the manual check above after the schema is applied.
