ALTER TABLE "channel_accounts"
    ADD COLUMN IF NOT EXISTS "token_refresh_state" VARCHAR(16) NOT NULL DEFAULT 'idle',
    ADD COLUMN IF NOT EXISTS "token_refresh_attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "token_refresh_lease_token" UUID,
    ADD COLUMN IF NOT EXISTS "token_refresh_lease_expires_at" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "token_refresh_started_at" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "token_refresh_completed_at" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "token_refresh_error" TEXT;

ALTER TABLE "channel_accounts" DROP CONSTRAINT IF EXISTS "channel_account_token_refresh_state_check";
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_account_token_refresh_state_check" CHECK (
    "token_refresh_state" IN ('idle','claimed','sending','failed','unknown'));
ALTER TABLE "channel_accounts" DROP CONSTRAINT IF EXISTS "channel_account_token_refresh_lease_check";
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_account_token_refresh_lease_check" CHECK (
    ("token_refresh_state" IN ('claimed','sending')) =
    ("token_refresh_lease_token" IS NOT NULL AND "token_refresh_lease_expires_at" IS NOT NULL));
ALTER TABLE "channel_accounts" DROP CONSTRAINT IF EXISTS "channel_account_token_refresh_attempts_check";
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_account_token_refresh_attempts_check" CHECK (
    "token_refresh_attempts">=0);
