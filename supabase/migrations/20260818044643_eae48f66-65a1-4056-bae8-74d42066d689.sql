-- Revoke default PUBLIC execute permissions from sensitive gateway and auth functions
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gw_reserve_token_slot(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_user_suspended(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gw_debit_api_key(uuid, numeric, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gw_is_ip_banned(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gw_debit_provider_token(uuid, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gw_unban_ip(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gw_manual_ban_ip(text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gw_record_ip_strike(text, text) FROM PUBLIC;

-- Explicitly grant permissions only to service_role (used by server functions)
-- This ensures the functions remain usable by the backend while blocking direct API access
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.gw_reserve_token_slot(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_user_suspended(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.gw_debit_api_key(uuid, numeric, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.gw_is_ip_banned(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.gw_debit_provider_token(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.gw_unban_ip(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.gw_manual_ban_ip(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.gw_record_ip_strike(text, text) TO service_role;
