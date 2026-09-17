# Database setup

For a **fresh database**, apply the entire [`schema.sql`](schema.sql) in Neon's
SQL editor. It creates the four tables, constraints, history index, and current
`execute_paper_order` function in one transaction. The initial schema is not
rerunnable over existing tables.

For an **existing database from earlier blocks**, apply [`block4.sql`](block4.sql)
instead. It upgrades integer quantities to `numeric(28,12)` and replaces the
execution function with its current return fields. This migration is transactional
and rerunnable; existing trades are preserved. Fresh installations already have
these changes and do not need both scripts.

Alternatively, with `DATABASE_URL` already exported in your shell, run the
appropriate command:

```sh
# Fresh database only:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql

# Existing earlier-block database only:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/block4.sql
```

Use the schema-owning role for the demo application. The function uses invoker
permissions and execution is revoked from `PUBLIC`. Schema application is manual;
application startup never runs migrations.

## Trade and account invariants

- `accounts` is keyed by Clerk user ID. First use inserts $1,000 with
  `ON CONFLICT DO NOTHING`; subsequent reads/sign-ins do not reset cash.
- `orders` and `fills` have UUID keys and a one-to-one relationship.
- `positions` is keyed by `(user_id, market_id, outcome)`; YES and NO accumulate
  separately, with quantity and cost basis preserved across requests.
- Amounts/prices use six decimal places and quantities use twelve. Numeric
  response fields are decimal strings; history is newest first.

`execute_paper_order(text, text, text, numeric, numeric)` takes the authenticated
user ID, upstream market UUID, side, quantity, and server-authoritative fill price.
The application validates fresh market status/pricing before calling it.
The function conditionally debits with `UPDATE ... WHERE balance >= cost`, then
inserts order/fill records and upserts the position atomically. Concurrent orders
lock and recheck the account row; any exception rolls back all writes. SQLSTATE
`P0001` means insufficient cash and `22023` means invalid input.

Returned fields are `order_id`, `fill_id`, `balance`, `fill_price`,
`filled_quantity`, `total_cost`, and `filled_at`, taken from the persisted
execution. Calling this function **writes a trade**; it is not a read-only check.

The account API reads a consistent, user-scoped database snapshot and adds live
marks/P&L from Onyx without storing quotes or changing positions. See the
[project README](../README.md) for setup, formulas, API behavior, and limitations.
