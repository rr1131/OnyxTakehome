-- Apply to an existing Block 2/4 database before submitting paper orders.
-- This migration is transactional and may be rerun without losing trade data.
-- Fractional quantities are necessary for quantity = notional / fill price.
BEGIN;
-- Rebuild only this generated column so quantity's type can be changed.
-- Every stored cost is recomputed from its existing fill quantity and price.
ALTER TABLE public.fills DROP COLUMN IF EXISTS total_cost;
ALTER TABLE public.orders ALTER COLUMN quantity TYPE numeric(28, 12);
ALTER TABLE public.fills ALTER COLUMN quantity TYPE numeric(28, 12);
ALTER TABLE public.positions ALTER COLUMN quantity TYPE numeric(28, 12);
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_quantity_finite;
ALTER TABLE public.fills DROP CONSTRAINT IF EXISTS fills_quantity_finite;
ALTER TABLE public.positions DROP CONSTRAINT IF EXISTS positions_quantity_finite;
ALTER TABLE public.orders ADD CONSTRAINT orders_quantity_finite CHECK (quantity <> 'NaN'::numeric);
ALTER TABLE public.fills ADD CONSTRAINT fills_quantity_finite CHECK (quantity <> 'NaN'::numeric);
ALTER TABLE public.positions ADD CONSTRAINT positions_quantity_finite CHECK (quantity <> 'NaN'::numeric);
ALTER TABLE public.fills ADD COLUMN total_cost numeric(20, 6)
  GENERATED ALWAYS AS (quantity * price) STORED;
-- Recreate both known versions because PostgreSQL cannot replace return types.
DROP FUNCTION IF EXISTS public.execute_paper_order(text, text, text, integer, numeric);
DROP FUNCTION IF EXISTS public.execute_paper_order(text, text, text, numeric, numeric);
CREATE FUNCTION public.execute_paper_order(
  p_user_id text,
  p_market_id text,
  p_outcome text,
  p_quantity numeric,
  p_fill_price numeric
)
RETURNS TABLE (
  order_id uuid,
  fill_id uuid,
  balance numeric,
  fill_price numeric,
  filled_quantity numeric,
  total_cost numeric,
  filled_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cost numeric(20, 6);
  v_balance numeric(20, 6);
  v_order_id uuid;
  v_fill_id uuid;
BEGIN
  IF p_user_id IS NULL OR length(btrim(p_user_id)) = 0
    OR p_market_id IS NULL OR length(btrim(p_market_id)) = 0
    OR p_outcome IS NULL OR p_outcome NOT IN ('YES', 'NO')
    OR p_quantity IS NULL OR NOT (p_quantity > 0 AND p_quantity < 'Infinity'::numeric)
    OR p_quantity <> round(p_quantity, 12)
    OR p_fill_price IS NULL OR NOT (p_fill_price > 0 AND p_fill_price <= 1)
    OR p_fill_price <> round(p_fill_price, 6)
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid paper order.';
  END IF;

  v_cost := p_quantity * p_fill_price;
  IF v_cost <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid paper order.';
  END IF;

  INSERT INTO public.accounts (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- UPDATE locks this user's account row. At READ COMMITTED, a competing
  -- update waits and rechecks balance >= v_cost against the committed balance.
  -- No balance is checked or calculated in Node, and cash cannot go negative.
  UPDATE public.accounts AS a
  SET balance = a.balance - v_cost, updated_at = clock_timestamp()
  WHERE a.user_id = p_user_id AND a.balance >= v_cost
  RETURNING a.balance INTO v_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Insufficient cash.';
  END IF;

  INSERT INTO public.orders (user_id, market_id, outcome, quantity)
  VALUES (p_user_id, p_market_id, p_outcome, p_quantity)
  RETURNING id INTO v_order_id;

  INSERT INTO public.fills (order_id, quantity, price)
  VALUES (v_order_id, p_quantity, p_fill_price)
  RETURNING id INTO v_fill_id;

  INSERT INTO public.positions AS p
    (user_id, market_id, outcome, quantity, total_cost)
  VALUES (p_user_id, p_market_id, p_outcome, p_quantity, v_cost)
  ON CONFLICT (user_id, market_id, outcome) DO UPDATE
  SET quantity = p.quantity + EXCLUDED.quantity,
      total_cost = p.total_cost + EXCLUDED.total_cost,
      updated_at = clock_timestamp();

  RETURN QUERY
    SELECT v_order_id, f.id, v_balance,
           f.price, f.quantity, f.total_cost, f.created_at
    FROM public.fills AS f
    WHERE f.id = v_fill_id;
  -- Exceptions propagate: PostgreSQL rolls back the entire call, including
  -- a newly created account, cash debit, order, fill, and position changes.
END;
$$;

-- The role applying this schema owns the function and can execute it.
REVOKE ALL ON FUNCTION public.execute_paper_order(text, text, text, numeric, numeric)
  FROM PUBLIC;

COMMIT;
