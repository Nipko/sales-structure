-- Financial tables for SaaS metrics (MRR, snapshots, infra costs, FX rates).
-- Used by FinancialSnapshotService (monthly cron) and /financials/* endpoints.

CREATE TABLE IF NOT EXISTS "public"."financial_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "snapshot_month" TIMESTAMPTZ NOT NULL,
    "mrr_cents" INTEGER NOT NULL DEFAULT 0,
    "new_mrr_cents" INTEGER NOT NULL DEFAULT 0,
    "expansion_mrr_cents" INTEGER NOT NULL DEFAULT 0,
    "contraction_mrr_cents" INTEGER NOT NULL DEFAULT 0,
    "churned_mrr_cents" INTEGER NOT NULL DEFAULT 0,
    "reactivation_mrr_cents" INTEGER NOT NULL DEFAULT 0,
    "active_customers" INTEGER NOT NULL DEFAULT 0,
    "new_customers" INTEGER NOT NULL DEFAULT 0,
    "churned_customers" INTEGER NOT NULL DEFAULT 0,
    "trialing_customers" INTEGER NOT NULL DEFAULT 0,
    "trials_started" INTEGER NOT NULL DEFAULT 0,
    "trials_converted" INTEGER NOT NULL DEFAULT 0,
    "revenue_collected_cents" INTEGER NOT NULL DEFAULT 0,
    "payments_succeeded" INTEGER NOT NULL DEFAULT 0,
    "payments_failed" INTEGER NOT NULL DEFAULT 0,
    "llm_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "infra_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "plan_distribution" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "financial_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "financial_snapshots_snapshot_month_key"
    ON "public"."financial_snapshots"("snapshot_month");

CREATE TABLE IF NOT EXISTS "public"."tenant_financial_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "snapshot_month" TIMESTAMPTZ NOT NULL,
    "plan_slug" TEXT NOT NULL,
    "mrr_cents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "revenue_cents" INTEGER NOT NULL DEFAULT 0,
    "llm_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "ai_messages" INTEGER NOT NULL DEFAULT 0,
    "conversations" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "tenant_financial_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_financial_snapshots_tenant_month_key"
    ON "public"."tenant_financial_snapshots"("tenant_id", "snapshot_month");

CREATE TABLE IF NOT EXISTS "public"."infra_costs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "month" TIMESTAMPTZ NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "infra_costs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "infra_costs_month_category_key"
    ON "public"."infra_costs"("month", "category");

CREATE TABLE IF NOT EXISTS "public"."exchange_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rate_date" TIMESTAMPTZ NOT NULL,
    "from_currency" TEXT NOT NULL,
    "to_currency" TEXT NOT NULL,
    "rate" DECIMAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "exchange_rates_date_pair_key"
    ON "public"."exchange_rates"("rate_date", "from_currency", "to_currency");
