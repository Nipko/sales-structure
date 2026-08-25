-- P25: persist the progressive email-verification state without changing the
-- entitlement of existing users. The boolean remains during the compatible
-- migration window; the state is the auditable lifecycle projection.
ALTER TABLE "public"."users"
    ADD COLUMN IF NOT EXISTS "email_verification_state" TEXT NOT NULL DEFAULT 'unverified';

UPDATE "public"."users"
SET "email_verification_state" = CASE
    WHEN "is_active" = false THEN 'restricted'
    WHEN "email_verified" = true THEN 'verified'
    ELSE 'unverified'
END
WHERE "email_verification_state" IS DISTINCT FROM CASE
    WHEN "is_active" = false THEN 'restricted'
    WHEN "email_verified" = true THEN 'verified'
    ELSE 'unverified'
END;

ALTER TABLE "public"."users"
    DROP CONSTRAINT IF EXISTS "users_email_verification_state_check";
ALTER TABLE "public"."users"
    ADD CONSTRAINT "users_email_verification_state_check"
    CHECK ("email_verification_state" IN ('unverified', 'pending_change', 'verified', 'restricted'));
