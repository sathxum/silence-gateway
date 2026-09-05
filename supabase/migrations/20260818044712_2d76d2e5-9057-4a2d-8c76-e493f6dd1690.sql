-- 1. Add missing RLS policy for login_attempts
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'login_attempts' AND policyname = 'Admins can view login attempts'
    ) THEN
        CREATE POLICY "Admins can view login attempts" ON public.login_attempts
        FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
    END IF;
END $$;

-- 2. Restrict SECURITY DEFINER functions by revoking PUBLIC execute permissions
-- and granting them only to service_role to prevent direct API abuse.

DO $$ 
DECLARE
    func_name text;
    funcs text[] := ARRAY[
        'has_role', 
        'gw_reserve_token_slot', 
        'is_user_suspended', 
        'gw_debit_api_key', 
        'gw_is_ip_banned', 
        'gw_debit_provider_token', 
        'gw_unban_ip', 
        'gw_manual_ban_ip', 
        'gw_record_ip_strike'
    ];
BEGIN
    FOREACH func_name IN ARRAY funcs LOOP
        -- Revoke from all roles (including anon and authenticated)
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I FROM PUBLIC', func_name);
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I FROM authenticated', func_name);
        
        -- Grant exclusively to service_role for backend use
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO service_role', func_name);
    END LOOP;
END $$;
