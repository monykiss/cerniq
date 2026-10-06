-- Platform-admin privilege is an explicit, database-held flag.
--
-- It replaces a hardcoded email allowlist. The flag defaults to FALSE for
-- every row (fail closed) and is never set by any application code path
-- (registration, OAuth sign-in, Supabase provisioning). An operator grants it
-- out-of-band, e.g.:
--
--   UPDATE "users" SET "platform_admin" = TRUE WHERE "email" = '<verified operator email>';
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "platform_admin" BOOLEAN NOT NULL DEFAULT FALSE;
