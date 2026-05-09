-- Tenant invitations: email-based magic link flow for adding users
-- (supervisors and agents) without the admin needing to set their password.

CREATE TABLE IF NOT EXISTS "tenant_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "skill_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "token" TEXT NOT NULL,
    "invited_by_user_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_user_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "resent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_invitations_token_key" ON "tenant_invitations"("token");
CREATE INDEX IF NOT EXISTS "tenant_invitations_tenant_id_accepted_at_idx" ON "tenant_invitations"("tenant_id", "accepted_at");
CREATE INDEX IF NOT EXISTS "tenant_invitations_email_idx" ON "tenant_invitations"("email");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'tenant_invitations_tenant_id_fkey'
    ) THEN
        ALTER TABLE "tenant_invitations"
            ADD CONSTRAINT "tenant_invitations_tenant_id_fkey"
            FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
