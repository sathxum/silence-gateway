-- Fix 1: Add policy for login_attempts
CREATE POLICY "Admins can view login attempts" ON public.login_attempts
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Fix 2-8: Restrict SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gw_reserve_token_slot(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_user_suspended(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gw_debit_api_key(uuid, numeric, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gw_is_ip_banned(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gw_debit_provider_token(uuid, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gw_unban_ip(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gw_manual_ban_ip(text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gw_record_ip_strike(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gw_reserve_token_slot(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_user_suspended(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gw_debit_api_key(uuid, numeric, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gw_is_ip_banned(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gw_debit_provider_token(uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gw_unban_ip(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gw_manual_ban_ip(text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gw_record_ip_strike(text, text) TO authenticated, service_role;