import { auth } from "@clerk/nextjs/server";
import {
  DEFAULT_MARKET_PAGE_SIZE,
  MAX_MARKET_PAGE_SIZE,
  type MarketFilters,
} from "@/lib/market";
import { fetchMarkets, OnyxError } from "@/lib/onyx";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Authentication required." }, { status: 401, headers });
    }

    const params = new URL(request.url).searchParams;
    const limitValue = params.get("limit") ?? String(DEFAULT_MARKET_PAGE_SIZE);
    const offsetValue = params.get("offset") ?? "0";
    const limit = Number(limitValue);
    const offset = Number(offsetValue);
    if (
      !/^\d+$/.test(limitValue) || !/^\d+$/.test(offsetValue) ||
      params.getAll("limit").length > 1 || params.getAll("offset").length > 1 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_MARKET_PAGE_SIZE ||
      !Number.isSafeInteger(offset) || !Number.isSafeInteger(offset + limit)
    ) {
      return Response.json(
        { error: `Use an integer limit from 1 to ${MAX_MARKET_PAGE_SIZE} and a nonnegative integer offset.` },
        { status: 400, headers },
      );
    }

    const filters: MarketFilters = {};
    for (const key of ["sport", "status", "eventType", "contractType", "periodType"] as const) {
      const value = params.get(key);
      if (value !== null) {
        if (!value.trim() || value.length > 100 || params.getAll(key).length > 1) {
          return Response.json({ error: "Invalid market filter." }, { status: 400, headers });
        }
        filters[key] = value.trim();
      }
    }

    const page = await fetchMarkets({ ...filters, limit, offset, signal: request.signal });
    return Response.json(page, { headers });
  } catch (error) {
    if (request.signal.aborted) {
      return new Response(null, { status: 499, headers });
    }
    if (error instanceof OnyxError) {
      // The adapter already logged sanitized diagnostics.
      return Response.json(
        {
          error: error.code === "UPSTREAM_AUTH"
            ? "Market data authentication failed. Please contact the application owner."
            : "Market data is temporarily unavailable. Please try again.",
          code: error.code,
        },
        { status: error.code === "UPSTREAM_TIMEOUT" ? 504 : 502, headers },
      );
    }

    console.error("[api/markets] Failed to load markets.");
    return Response.json(
      { error: "Unable to load markets. Please try again." },
      { status: 500, headers },
    );
  }
}
