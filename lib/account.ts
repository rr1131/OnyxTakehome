import "server-only";
import { getDb } from "./db";

// Monetary values are exact decimal strings, never floating-point numbers.
// Integer contract quantities remain JSON numbers; timestamps are ISO strings.
export type AccountState = {
  userId: string;
  currency: "USD";
  balance: string;
  createdAt: string;
  updatedAt: string;
  positions: {
    marketId: string;
    outcome: "YES" | "NO";
    quantity: number;
    totalCost: string;
    averagePrice: string;
    createdAt: string;
    updatedAt: string;
  }[];
  orders: {
    id: string;
    marketId: string;
    outcome: "YES" | "NO";
    quantity: number;
    status: "filled";
    createdAt: string;
  }[];
  fills: {
    id: string;
    orderId: string;
    quantity: number;
    price: string;
    totalCost: string;
    createdAt: string;
  }[];
};

// userId must come from the authenticated Clerk session, never request input.
export async function getAccountState(userId: string): Promise<AccountState> {
  const sql = getDb();
  const [, rows] = await sql.transaction(
    [
      sql`
        INSERT INTO public.accounts (user_id)
        VALUES (${userId})
        ON CONFLICT (user_id) DO NOTHING
      `,
      // A single SELECT gives balance, positions, and history one consistent
      // snapshot, even if an order commits while this request is running.
      // Cast NUMERIC before JSON construction to preserve its exact precision.
      sql`
        SELECT jsonb_build_object(
          'userId', a.user_id,
          'currency', 'USD',
          'balance', a.balance::text,
          'createdAt', a.created_at,
          'updatedAt', a.updated_at,
          'positions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'marketId', p.market_id,
              'outcome', p.outcome,
              'quantity', p.quantity,
              'totalCost', p.total_cost::text,
              'averagePrice', (p.total_cost / p.quantity)::numeric(7, 6)::text,
              'createdAt', p.created_at,
              'updatedAt', p.updated_at
            ) ORDER BY p.market_id, p.outcome)
            FROM public.positions AS p
            WHERE p.user_id = a.user_id
          ), '[]'::jsonb),
          'orders', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', o.id,
              'marketId', o.market_id,
              'outcome', o.outcome,
              'quantity', o.quantity,
              'status', o.status,
              'createdAt', o.created_at
            ) ORDER BY o.created_at DESC, o.id DESC)
            FROM public.orders AS o
            WHERE o.user_id = a.user_id
          ), '[]'::jsonb),
          'fills', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', f.id,
              'orderId', f.order_id,
              'quantity', f.quantity,
              'price', f.price::text,
              'totalCost', f.total_cost::text,
              'createdAt', f.created_at
            ) ORDER BY f.created_at DESC, f.id DESC)
            FROM public.fills AS f
            JOIN public.orders AS o ON o.id = f.order_id
            WHERE o.user_id = a.user_id
          ), '[]'::jsonb)
        ) AS account
        FROM public.accounts AS a
        WHERE a.user_id = ${userId}
      `,
    ],
    { isolationLevel: "ReadCommitted" },
  );

  if (!rows[0]?.account) {
    throw new Error("Account state is unavailable.");
  }

  return rows[0].account as AccountState;
}
