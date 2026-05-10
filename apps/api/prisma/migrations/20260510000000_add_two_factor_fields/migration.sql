-- Two-factor authentication: TOTP (authenticator app) + email fallback + backup codes

ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "two_factor_secret" TEXT,
    ADD COLUMN IF NOT EXISTS "two_factor_method" TEXT,
    ADD COLUMN IF NOT EXISTS "backup_codes" TEXT[] DEFAULT '{}';
