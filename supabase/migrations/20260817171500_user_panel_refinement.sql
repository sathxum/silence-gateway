-- Add max_tokens_limit, is_frozen, and total_tokens columns if they don't exist
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS max_tokens_limit bigint DEFAULT 1000000;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_frozen boolean DEFAULT false;

ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS total_tokens bigint DEFAULT 0;

-- Add a table to persist global statistics (including deleted users' data)
CREATE TABLE IF NOT EXISTS public.global_stats (
    id text PRIMARY KEY DEFAULT 'current',
    total_tokens_consumed bigint DEFAULT 0,
    total_cost_usd numeric(20, 10) DEFAULT 0,
    updated_at timestamptz DEFAULT now()
);

-- Initialize global_stats if empty
INSERT INTO public.global_stats (id, total_tokens_consumed, total_cost_usd)
VALUES ('current', 0, 0)
ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.global_stats TO authenticated;
GRANT ALL ON public.global_stats TO service_role;

-- Function to check if a user is suspended
CREATE OR REPLACE FUNCTION public.is_user_suspended(_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(suspended, false) FROM public.profiles WHERE id = _user_id;
$$;

-- Function to check if a user is frozen
CREATE OR REPLACE FUNCTION public.is_user_frozen(_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(is_frozen, false) FROM public.profiles WHERE id = _user_id;
$$;

-- RPC to record usage and update global stats even if user is deleted later
CREATE OR REPLACE FUNCTION public.gw_record_final_usage(
    _api_key_id uuid,
    _tokens bigint,
    _cost numeric,
    _user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Update API key usage
    UPDATE public.api_keys
    SET total_requests = total_requests + 1,
        total_tokens = total_tokens + _tokens,
        total_cost = total_cost + _cost,
        balance = balance - _cost,
        last_used_at = now()
    WHERE id = _api_key_id;

    -- Update Global stats (persists even if user/key deleted)
    UPDATE public.global_stats
    SET total_tokens_consumed = total_tokens_consumed + _tokens,
        total_cost_usd = total_cost_usd + _cost,
        updated_at = now()
    WHERE id = 'current';
END;
$$;

GRANT EXECUTE ON FUNCTION public.gw_record_final_usage TO authenticated;
GRANT EXECUTE ON FUNCTION public.gw_record_final_usage TO service_role;

-- Helper to get total tokens for a user across all keys
CREATE OR REPLACE FUNCTION public.gw_get_user_token_total(_user_id uuid)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(SUM(total_tokens), 0) FROM public.api_keys WHERE user_id = _user_id;
$$;

-- Update global stats helper
CREATE OR REPLACE FUNCTION public.gw_update_global_stats(_cost numeric, _tokens bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.global_stats (total_cost, total_tokens, total_requests)
  VALUES (_cost, _tokens, 1)
  ON CONFLICT (id) DO UPDATE SET
    total_cost = public.global_stats.total_cost + EXCLUDED.total_cost,
    total_tokens = public.global_stats.total_tokens + EXCLUDED.total_tokens,
    total_requests = public.global_stats.total_requests + 1,
    updated_at = now();
END;
$$;

-- Helper to check if a user is frozen
CREATE OR REPLACE FUNCTION public.is_user_frozen(_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(is_frozen, false) FROM public.profiles WHERE id = _user_id;
$$;

-- Ensure proper grants for new functions
GRANT EXECUTE ON FUNCTION public.is_user_frozen(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gw_get_user_token_total(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gw_update_global_stats(numeric, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_user_frozen(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.gw_get_user_token_total(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.gw_update_global_stats(numeric, bigint) TO service_role;

-- Ensure usage_events are properly recorded for users even if key is deleted
-- This assumes usage_events table has user_id, if not, we rely on global_stats
-- The gateway records usage_events with api_key_id. 
-- We should ensure api_key_id has ON DELETE SET NULL or similar, or just rely on global_stats.
-- Let's make sure global_stats exists and is initialized.
INSERT INTO public.global_stats (id, total_cost, total_tokens, total_requests)
VALUES (1, 0, 0, 0)
ON CONFLICT (id) DO NOTHING;
