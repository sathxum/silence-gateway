-- The previous migration revoked from PUBLIC and authenticated, 
-- but 'anon' might still have residual access to specific functions.
-- We explicitly revoke EXECUTE from anon for all public gateway functions.

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.gw_reserve_token_slot(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_user_suspended(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.gw_debit_api_key(uuid, numeric, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.gw_is_ip_banned(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.gw_debit_provider_token(uuid, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.gw_unban_ip(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.gw_manual_ban_ip(text, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.gw_record_ip_strike(text, text) FROM anon;

-- Ensure service_role maintains access for server-side logic
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.gw_reserve_token_slot(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_user_suspended(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.gw_debit_api_key(uuid, numeric, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.gw_is_ip_banned(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.gw_debit_provider_token(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.gw_unban_ip(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.gw_manual_ban_ip(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.gw_record_ip_strike(text, text) TO service_role;
