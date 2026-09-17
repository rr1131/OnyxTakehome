-- Final application schema: apply this entire file once to a fresh database.
-- Not a migration or a reset script; do not rerun over existing tables.
-- Prices/cash are USD with six decimal places; quantities support fractional contracts to twelve decimal places.
-- Markets stay upstream. market_id is only a reference, not a local catalog.
BEGIN;

CREATE TABLE public.accounts (
  user_id text PRIMARY KEY CHECK (length(btrim(user_id)) > 0),
  balance numeric(20, 6) NOT NULL DEFAULT 1000.000000
    CHECK (balance >= 0 AND balance <> 'NaN'::numeric),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public.accounts(user_id),
  market_id text NOT NULL CHECK (length(btrim(market_id)) > 0),
  outcome text NOT NULL CHECK (outcome IN ('YES', 'NO')),
  quantity numeric(28, 12) NOT NULL CHECK (quantity > 0 AND quantity <> 'NaN'::numeric),
  status text NOT NULL DEFAULT 'filled' CHECK (status = 'filled'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orders_user_history_idx
  ON public.orders (user_id, created_at DESC, id DESC);

CREATE TABLE public.fills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The prototype fills each order completely, exactly once.
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
  quantity numeric(28, 12) NOT NULL CHECK (quantity > 0 AND quantity <> 'NaN'::numeric),
  price numeric(7, 6) NOT NULL CHECK (price > 0 AND price <= 1),
  total_cost numeric(20, 6) GENERATED ALWAYS AS (quantity * price) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.positions (
  user_id text NOT NULL REFERENCES public.accounts(user_id),
  market_id text NOT NULL CHECK (length(btrim(market_id)) > 0),
  outcome text NOT NULL CHECK (outcome IN ('YES', 'NO')),
  quantity numeric(28, 12) NOT NULL CHECK (quantity > 0 AND quantity <> 'NaN'::numeric),
  total_cost numeric(20, 6) NOT NULL
    CHECK (total_cost > 0 AND total_cost <= quantity),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, market_id, outcome)
);

-- Buy-only execution. The server order handler must authenticate the
-- user and obtain/normalize the authoritative fill price before calling this.
-- Do not expose this function or database credentials directly to the browser.
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
