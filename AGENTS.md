# AGENTS.md

## Goal

Build the smallest complete, reliable implementation of the Onyx paper-trading
take-home within a strict 90-minute wall-clock limit.

Priorities, in order:

1. Required functionality works end to end.
2. Trading and account state are correct.
3. The application is deployed and usable.
4. Architecture and tradeoffs are easy to understand.
5. Visual polish.

Do not expand scope until all required functionality works.

Prefer a simple working implementation over a more sophisticated incomplete one.

---

## Stack

Use:

- Next.js App Router
- TypeScript
- React
- Clerk authentication
- Neon PostgreSQL
- `@neondatabase/serverless`
- Plain CSS
- Vercel deployment

Keep dependencies minimal.

Do not introduce additional frameworks or infrastructure unless explicitly
required.

---

## High-Level Architecture

The application owns user-specific paper-trading state.

Onyx owns market data and prices.

Architecture:

Browser
  -> Next.js application
      -> Clerk for application-user authentication
      -> `/api/markets` -> Onyx Predictions API
      -> `/api/account` -> Neon PostgreSQL
      -> `/api/orders`
          -> refresh current upstream Onyx market data
          -> determine authoritative paper fill price
          -> atomically update Neon PostgreSQL

PostgreSQL stores:

- accounts
- paper orders
- fills
- positions

PostgreSQL does NOT store the canonical market catalog.

Onyx is read-only from this application's perspective.

---

## Onyx API — Observed Dev API Behavior

Base URL:

`https://predictions.dev-onyxodds.com`

The implementation must follow the behavior observed in the provided dev API
rather than guessing undocumented production behavior.

---

## Onyx Authentication

The observed Onyx dev API uses HTTP Bearer authentication.

For this time-boxed take-home, use a server-side Bearer access token supplied
through:

`ONYX_API_TOKEN`

The observed token lifetime is approximately 24 hours and is expected to cover
the submission/review window.

Requirements:

- Send:

  `Authorization: Bearer <token>`

  from server-side code only.

- Never expose `ONYX_API_TOKEN` to browser code.
- Never log the token.
- Do not implement login, token refresh, token caching, or credential-based
  reauthentication for this prototype.
- If Onyx returns 401, log a sanitized server-side error and return a safe
  upstream-authentication error to the application.

Clerk authentication and Onyx authentication are separate concerns.

Clerk identifies users of this application.

The Onyx Bearer token authorizes the server to read upstream market data.

---

## Onyx Market Catalog

Primary catalog endpoint:

`GET /markets`

Observed query parameters include:

- `sport`
- `status`
- `event_type`
- `contract_type`
- `period_type`
- `limit`
- `offset`

Use `limit` and `offset` for pagination.

Observed market response fields include:

```ts
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