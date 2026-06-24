-- Platform incidents: persistent, deduped, acknowledgeable alerts for the
-- super_admin ops center. PlatformMonitorService.alert() upserts an open
-- incident per key; checks auto-resolve when the condition clears.

CREATE TABLE IF NOT EXISTS "public"."platform_incidents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "value" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'active',
    "count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "acknowledged_at" TIMESTAMPTZ,
    "acknowledged_by" TEXT,
    "resolved_at" TIMESTAMPTZ,
    "resolved_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "platform_incidents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "platform_incidents_status_severity_idx"
    ON "public"."platform_incidents"("status", "severity");
CREATE INDEX IF NOT EXISTS "platform_incidents_key_idx"
    ON "public"."platform_incidents"("key");
