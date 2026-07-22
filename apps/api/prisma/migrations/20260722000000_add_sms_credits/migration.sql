-- SMS credit monetization (reseller packages).
-- Tenants buy prepaid credit packages to notify their own customers via the
-- PLATFORM Twilio sender. 1 credit = 1 Twilio message segment. Three global
-- (public schema) tables — columns match the Prisma models SmsCreditBalance,
-- SmsCreditLedger and SmsPackageOrder. No FKs (denormalized like the billing
-- hot path); balance mutations are atomic (guarded UPDATE ... RETURNING).

-- ---- Running balance per tenant (fast-read cache of the ledger total) ----
CREATE TABLE IF NOT EXISTS "public"."sms_credit_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "balance_credits" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "sms_credit_balances_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "sms_credit_balances_tenant_id_key" ON "public"."sms_credit_balances"("tenant_id");

-- ---- Append-only ledger (auditable source of truth) ----
CREATE TABLE IF NOT EXISTS "public"."sms_credit_ledger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "ref" TEXT,
    "balance_after" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "sms_credit_ledger_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "sms_credit_ledger_tenant_id_created_at_idx" ON "public"."sms_credit_ledger"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "sms_credit_ledger_tenant_id_reason_ref_idx" ON "public"."sms_credit_ledger"("tenant_id", "reason", "ref");
-- Idempotency for credit GRANTS (purchase / refund / positive adjustment): one
-- grant per (tenant, reason, ref). Scoped to positive movements so consumption
-- (negative, whose ref may legitimately repeat across failed-send retries) stays
-- unconstrained. This is the atomic gate SmsCreditsService.addCredits relies on.
CREATE UNIQUE INDEX IF NOT EXISTS "sms_credit_ledger_grant_idem_idx"
    ON "public"."sms_credit_ledger" ("tenant_id", "reason", "ref")
    WHERE "ref" IS NOT NULL AND "delta" > 0;

-- ---- One-time package purchase orders (MercadoPago external_reference = id) ----
CREATE TABLE IF NOT EXISTS "public"."sms_package_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "package_id" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider" TEXT NOT NULL DEFAULT 'mercadopago',
    "provider_ref" TEXT,
    "init_point" TEXT,
    "paid_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "sms_package_orders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "sms_package_orders_tenant_id_status_idx" ON "public"."sms_package_orders"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "sms_package_orders_status_created_at_idx" ON "public"."sms_package_orders"("status", "created_at");
