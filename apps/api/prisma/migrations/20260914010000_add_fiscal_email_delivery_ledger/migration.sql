ALTER TABLE "fiscal_invoices"
    ADD COLUMN IF NOT EXISTS "email_delivery_state" VARCHAR(32) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS "email_delivery_attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "email_lease_token" UUID,
    ADD COLUMN IF NOT EXISTS "email_lease_expires_at" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "email_provider_reference" TEXT,
    ADD COLUMN IF NOT EXISTS "email_error_code" TEXT,
    ADD COLUMN IF NOT EXISTS "email_next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS "email_started_at" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "email_completed_at" TIMESTAMPTZ;

UPDATE "fiscal_invoices"
SET "email_delivery_state"='legacy_sent',
    "email_provider_reference"='legacy:invoiceEmailSentAt',
    "email_completed_at"=COALESCE("issued_at","created_at")
WHERE "metadata"->>'invoiceEmailSentAt' IS NOT NULL
  AND "email_delivery_state"='pending';

ALTER TABLE "fiscal_invoices" DROP CONSTRAINT IF EXISTS "fiscal_invoice_email_state_check";
ALTER TABLE "fiscal_invoices" ADD CONSTRAINT "fiscal_invoice_email_state_check" CHECK (
    "email_delivery_state" IN ('pending','claimed','sending','sent','failed','reconciliation_required','suppressed','legacy_sent'));
ALTER TABLE "fiscal_invoices" DROP CONSTRAINT IF EXISTS "fiscal_invoice_email_attempts_check";
ALTER TABLE "fiscal_invoices" ADD CONSTRAINT "fiscal_invoice_email_attempts_check" CHECK ("email_delivery_attempts">=0);
ALTER TABLE "fiscal_invoices" DROP CONSTRAINT IF EXISTS "fiscal_invoice_email_lease_check";
ALTER TABLE "fiscal_invoices" ADD CONSTRAINT "fiscal_invoice_email_lease_check" CHECK (
    ("email_delivery_state" IN ('claimed','sending')) =
    ("email_lease_token" IS NOT NULL AND "email_lease_expires_at" IS NOT NULL));
ALTER TABLE "fiscal_invoices" DROP CONSTRAINT IF EXISTS "fiscal_invoice_email_receipt_check";
ALTER TABLE "fiscal_invoices" ADD CONSTRAINT "fiscal_invoice_email_receipt_check" CHECK (
    "email_delivery_state"<>'sent' OR ("email_provider_reference" IS NOT NULL AND "email_completed_at" IS NOT NULL));

CREATE INDEX IF NOT EXISTS "fiscal_invoice_email_due_idx" ON "fiscal_invoices"
    ("email_next_attempt_at","created_at")
    WHERE "status"='issued' AND "email_delivery_state" IN ('pending','failed');
