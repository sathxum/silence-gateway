INSERT INTO public.profiles (id, email, max_tokens_limit, max_api_keys, is_frozen)
SELECT u.id, lower(trim(u.email)), 1000000, 3, false
FROM auth.users AS u
WHERE u.email IS NOT NULL
  AND u.email_confirmed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles AS admin_role
    WHERE admin_role.user_id = u.id AND admin_role.role = 'admin'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS p WHERE p.id = u.id
  );

INSERT INTO public.user_roles (user_id, role)
SELECT p.id, 'user'
FROM public.profiles AS p
JOIN auth.users AS u ON u.id = p.id
WHERE u.email_confirmed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles AS existing_role
    WHERE existing_role.user_id = p.id AND existing_role.role = 'admin'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles AS user_role
    WHERE user_role.user_id = p.id AND user_role.role = 'user'
  );