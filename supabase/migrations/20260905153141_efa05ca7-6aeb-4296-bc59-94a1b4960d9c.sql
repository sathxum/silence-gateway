-- Permanent cumulative usage counters. Historical request snapshots remain in usage_events;
-- these counters are never reduced when a provider, model, or key is deleted.
CREATE TABLE IF NOT EXISTS public.global_stats (
  id text PRIMARY KEY DEFAULT 'current',
  total_tokens bigint NOT NULL DEFAULT 0,
  total_cost numeric(20,10) NOT NULL DEFAULT 0,
  total_requests bigint NOT NULL DEFAULT 0,
  total_successes bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.global_stats TO authenticated;
GRANT ALL ON public.global_stats TO service_role;
ALTER TABLE public.global_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "global stats admin only" ON public.global_stats;
CREATE POLICY "global stats admin only" ON public.global_stats FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS total_tokens bigint NOT NULL DEFAULT 0;

-- Seed the durable counter from the complete historical ledger exactly once.
INSERT INTO public.global_stats (id, total_tokens, total_cost, total_requests, total_successes)
SELECT 'current',
       COALESCE(SUM(total_tokens), 0),
       COALESCE(SUM(cost), 0),
       COUNT(*),
       COUNT(*) FILTER (WHERE success)
FROM public.usage_events
ON CONFLICT (id) DO NOTHING;

-- One atomic write for a completed request: immutable usage snapshot plus all counters.
CREATE OR REPLACE FUNCTION public.gw_record_usage(
  _api_key_id uuid,
  _provider_id uuid,
  _model_id uuid,
  _model_name text,
  _provider_name text,
  _input_tokens integer,
  _output_tokens integer,
  _cost numeric,
  _internal_cost numeric,
  _latency_ms integer,
  _success boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tokens bigint := greatest(0, coalesce(_input_tokens, 0)::bigint + coalesce(_output_tokens, 0)::bigint);
  v_cost numeric := greatest(0, coalesce(_cost, 0));
BEGIN
  INSERT INTO public.usage_events (
    api_key_id, provider_id, model_id, model_name, provider_name,
    input_tokens, output_tokens, total_tokens, cost, internal_cost, latency_ms, success
  ) VALUES (
    _api_key_id, _provider_id, _model_id, _model_name, _provider_name,
    greatest(0, coalesce(_input_tokens, 0)), greatest(0, coalesce(_output_tokens, 0)),
    v_tokens, v_cost, greatest(0, coalesce(_internal_cost, 0)), greatest(0, coalesce(_latency_ms, 0)), coalesce(_success, false)
  );

  UPDATE public.api_keys
  SET total_requests = total_requests + 1,
      total_tokens = total_tokens + v_tokens,
      total_cost = total_cost + v_cost,
      balance = greatest(0, balance - v_cost),
      last_used_at = now()
  WHERE id = _api_key_id;

  INSERT INTO public.global_stats (id, total_tokens, total_cost, total_requests, total_successes)
  VALUES ('current', v_tokens, v_cost, 1, CASE WHEN coalesce(_success, false) THEN 1 ELSE 0 END)
  ON CONFLICT (id) DO UPDATE SET
    total_tokens = public.global_stats.total_tokens + EXCLUDED.total_tokens,
    total_cost = public.global_stats.total_cost + EXCLUDED.total_cost,
    total_requests = public.global_stats.total_requests + EXCLUDED.total_requests,
    total_successes = public.global_stats.total_successes + EXCLUDED.total_successes,
    updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.gw_record_usage(uuid, uuid, uuid, text, text, integer, integer, numeric, numeric, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gw_record_usage(uuid, uuid, uuid, text, text, integer, integer, numeric, numeric, integer, boolean) TO service_role;

-- Keep the existing API-key debit RPC compatible while also tracking tokens.
CREATE OR REPLACE FUNCTION public.gw_debit_api_key(_id uuid, _cost numeric, _tokens integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.api_keys
  SET balance = greatest(0, balance - coalesce(_cost, 0)),
      total_cost = total_cost + coalesce(_cost, 0),
      total_tokens = total_tokens + greatest(0, coalesce(_tokens, 0)),
      total_requests = total_requests + 1,
      last_used_at = now()
  WHERE id = _id;
$$;
REVOKE ALL ON FUNCTION public.gw_debit_api_key(uuid, numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gw_debit_api_key(uuid, numeric, integer) TO service_role;

-- Full, uncapped admin summary for dashboard reads.
CREATE OR REPLACE FUNCTION public.gw_get_admin_usage_summary()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH current_totals AS (
    SELECT total_tokens, total_cost, total_requests, total_successes
    FROM public.global_stats WHERE id = 'current'
  ),
  today AS (
    SELECT COALESCE(SUM(cost), 0) AS cost,
           COALESCE(SUM(total_tokens), 0) AS tokens,
           COUNT(*) AS requests,
           COUNT(*) FILTER (WHERE success) AS ok
    FROM public.usage_events WHERE ts >= now() - interval '24 hours'
  ),
  by_model AS (
    SELECT COALESCE(model_name, 'unknown') AS name, COUNT(*) AS requests,
           COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(cost), 0) AS cost
    FROM public.usage_events GROUP BY COALESCE(model_name, 'unknown')
    ORDER BY requests DESC LIMIT 8
  ),
  by_provider AS (
    SELECT COALESCE(provider_name, 'unknown') AS name, COUNT(*) AS requests,
           COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(cost), 0) AS cost
    FROM public.usage_events GROUP BY COALESCE(provider_name, 'unknown')
    ORDER BY requests DESC LIMIT 8
  ),
  recent AS (
    SELECT jsonb_agg(jsonb_build_object(
      'ts', ts, 'model', COALESCE(model_name, '—'), 'provider', COALESCE(provider_name, '—'),
      'input', input_tokens, 'output', output_tokens, 'total', total_tokens,
      'cost', cost, 'latency', latency_ms, 'success', success
    ) ORDER BY ts DESC) AS rows
    FROM (SELECT * FROM public.usage_events ORDER BY ts DESC LIMIT 200) r
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'cost', COALESCE((SELECT total_cost FROM current_totals), 0),
      'tokens', COALESCE((SELECT total_tokens FROM current_totals), 0),
      'requests', COALESCE((SELECT total_requests FROM current_totals), 0),
      'successRate', CASE WHEN COALESCE((SELECT total_requests FROM current_totals), 0) = 0 THEN 0
        ELSE COALESCE((SELECT total_successes FROM current_totals), 0)::numeric * 100 / (SELECT total_requests FROM current_totals) END
    ),
    'today', (SELECT jsonb_build_object('cost', cost, 'tokens', tokens, 'requests', requests, 'ok', ok) FROM today),
    'byModel', COALESCE((SELECT jsonb_agg(to_jsonb(by_model)) FROM by_model), '[]'::jsonb),
    'byProvider', COALESCE((SELECT jsonb_agg(to_jsonb(by_provider)) FROM by_provider), '[]'::jsonb),
    'recent', COALESCE((SELECT rows FROM recent), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.gw_get_admin_usage_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gw_get_admin_usage_summary() TO service_role;