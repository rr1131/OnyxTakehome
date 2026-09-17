import { auth } from "@clerk/nextjs/server";
import { NeonDbError } from "@neondatabase/serverless";
import { getDb } from "@/lib/db";
import { fetchMarketById, OnyxError } from "@/lib/onyx";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const marketIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status, headers });
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return errorResponse("Authentication required.", 401);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return errorResponse("Send the order as application/json.", 415);
    }

    let body: unknown;
    try { body = await request.json(); }
    catch { return errorResponse("Invalid JSON body.", 400); }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid order.", 400);
    }
    const values = body as Record<string, unknown>;
    const { marketId, side, notional } = values;
    if (
      Object.keys(values).length !== 3 ||
      typeof marketId !== "string" || !marketIdPattern.test(marketId) ||
      (side !== "YES" && side !== "NO") ||
      typeof notional !== "number" || !Number.isFinite(notional) || notional <= 0 ||
      notional > Number.MAX_SAFE_INTEGER / 100 ||
      !/^\d+(?:\.\d{1,2})?$/.test(String(notional))
    ) return errorResponse("Supply only a marketId UUID, side (YES or NO), and a positive USD notional with at most two decimal places.", 400);

    const market = await fetchMarketById(marketId.toLowerCase(), request.signal);
    if (!market) return errorResponse("Market not found.", 404);
    if (
      market.status !== "open" || !market.isTradable ||
      !Number.isFinite(Date.parse(market.expiresAt)) || Date.parse(market.expiresAt) <= Date.now() ||
      market.yesPrice === null || !Number.isFinite(market.yesPrice) ||
      market.yesPrice < 0 || market.yesPrice > 1
    ) {
      return errorResponse("Market is closed or pricing is unavailable.", 409);
    }
    const price = side === "YES" ? market.yesPrice : 1 - market.yesPrice;
    if (price <= 0 || price > 1) {
      return errorResponse("Pricing is unavailable for this side.", 409);
    }
    const fillPrice = price.toFixed(6);
    if (Number(fillPrice) <= 0 || Math.abs(Number(fillPrice) - price) > 1e-12) {
      return errorResponse("Market price precision is unsupported.", 409);
    }

    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    const sql = getDb();
    // Division happens in PostgreSQL NUMERIC, with fractional contracts. The
    // function owns the conditional debit and all order/fill/position writes.
    const rows = await sql`SELECT
        order_id AS "orderId", fill_id AS "fillId", balance::text AS balance,
        ${market.id}::text AS "marketId", ${side}::text AS side,
        fill_price::text AS "fillPrice", filled_quantity::text AS quantity,
        total_cost::text AS notional, filled_at AS "createdAt"
      FROM public.execute_paper_order(
        ${userId}::text, ${market.id}::text, ${side}::text,
        round(${String(notional)}::numeric / ${fillPrice}::numeric, 12),
        ${fillPrice}::numeric
      )`;
    return Response.json({ order: rows[0] }, { status: 201, headers });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    if (error instanceof OnyxError) {
      return errorResponse(error.code === "UPSTREAM_AUTH"
        ? "Market data authentication failed. Please contact the application owner."
        : "Unable to obtain a fresh market price. Please try again.", error.code === "UPSTREAM_TIMEOUT" ? 504 : 502);
    }
    const code = error instanceof NeonDbError && /^[0-9A-Z]{5}$/.test(error.code ?? "")
      ? error.code : "UNKNOWN";
    console.error("[api/orders] Paper order failed.", { code });
    if (code === "P0001") return errorResponse("Insufficient cash.", 409);
    if (code === "22023" || code === "22003") return errorResponse("The order amount cannot be executed at this price.", 400);
    if (code === "42883" || code === "42703") return errorResponse("Trading is not configured. Please contact the application owner.", 503);
    return errorResponse("Unable to execute the order. Please try again.", 500);
  }
}
