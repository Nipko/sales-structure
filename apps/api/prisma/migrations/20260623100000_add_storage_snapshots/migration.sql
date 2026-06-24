-- Daily storage snapshots: per-tenant (db + media bytes) plus a platform-wide
-- row (tenant_id = 'platform', disk_used_pct set). Written by the daily storage
-- cron in PlatformMonitorService; powers the disk-fill projection, the storage
-- trend chart, and per-tenant media-quota early-warning alerts.

CREATE TABLE IF NOT EXISTS "public"."storage_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "snapshot_date" TIMESTAMPTZ NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "db_bytes" BIGINT NOT NULL DEFAULT 0,
    "media_bytes" BIGINT NOT NULL DEFAULT 0,
    "disk_used_pct" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "storage_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "storage_snapshots_date_tenant_key"
    ON "public"."storage_snapshots"("snapshot_date", "tenant_id");
