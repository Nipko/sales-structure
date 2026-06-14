-- Fiscal invoices (DIAN electronic invoicing — Colombia).
-- Fiscal-document lifecycle decoupled from the payment provider: a row is
-- created on billing.payment.succeeded (any PSP) and issued asynchronously via
-- a fiscal provider adapter (Factus today). Holds CUFE, numbering, signed
-- XML/PDF references and an immutable acquirer snapshot for legal traceability.
-- Columns match the Prisma model FiscalInvoice (no FKs — denormalized like the
-- rest of the billing hot path).

CREATE TABLE IF NOT EXISTS "public"."fiscal_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID,
    "type" TEXT NOT NULL DEFAULT 'invoice',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "cufe" TEXT,
    "invoice_number" TEXT,
    "xml_url" TEXT,
    "pdf_url" TEXT,
    "qr_url" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "related_invoice_id" UUID,
    "failure_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "acquirer_snapshot" JSONB,
    "issued_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "fiscal_invoices_pkey" PRIMARY KEY ("id")
);

-- payment_id is unique (one fiscal invoice per successful payment) and indexed
-- separately to match the Prisma model's @@index([paymentId]).
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_invoices_payment_id_key" ON "public"."fiscal_invoices"("payment_id");
CREATE INDEX IF NOT EXISTS "fiscal_invoices_tenant_id_created_at_idx" ON "public"."fiscal_invoices"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "fiscal_invoices_status_idx" ON "public"."fiscal_invoices"("status");
CREATE INDEX IF NOT EXISTS "fiscal_invoices_payment_id_idx" ON "public"."fiscal_invoices"("payment_id");

-- NOTE: fiscal platform settings (fiscal.mode, fiscal.co_iva_treatment, …) are
-- NOT seeded here. FiscalConfigService returns the defaults (CO_LOCAL / excluido)
-- when the rows are absent, and the super admin writes them at runtime. Seeding
-- would couple this migration to the platform_settings column set, which differs
-- between the Prisma-managed schema (CI) and the SQL-bootstrapped one (prod).
