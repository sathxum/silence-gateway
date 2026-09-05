ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS max_tokens_limit bigint NOT NULL DEFAULT 1000000,
  ADD COLUMN IF NOT EXISTS max_api_keys integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS is_frozen boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_max_tokens_limit_nonnegative,
  DROP CONSTRAINT IF EXISTS profiles_max_api_keys_positive;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_max_tokens_limit_nonnegative CHECK (max_tokens_limit >= 0),
  ADD CONSTRAINT profiles_max_api_keys_positive CHECK (max_api_keys >= 1);