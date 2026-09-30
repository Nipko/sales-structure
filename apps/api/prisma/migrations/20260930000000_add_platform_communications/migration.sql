CREATE TABLE "public"."platform_communications" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "audience" VARCHAR(32) NOT NULL,
    "recipient_role" VARCHAR(16) NOT NULL,
    "tenant_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "content" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "preview_version" UUID,
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "sent_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previewed_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    CONSTRAINT "platform_communications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_communications_status_check" CHECK ("status" IN ('draft','ready','queued','sending','completed')),
    CONSTRAINT "platform_communications_audience_check" CHECK ("audience" IN ('all','whatsapp_connected')),
    CONSTRAINT "platform_communications_role_check" CHECK ("recipient_role" IN ('all','admins'))
);
CREATE INDEX "platform_communications_status_created_at_idx" ON "public"."platform_communications"("status", "created_at");

CREATE TABLE "public"."platform_communication_recipients" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tenant_name" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "language" VARCHAR(2) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(64),
    "claimed_at" TIMESTAMPTZ(6),
    "claim_token" UUID,
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_communication_recipients_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_communication_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."platform_communications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "platform_communication_recipients_status_check" CHECK ("status" IN ('pending','processing','accepted','failed','unknown','skipped')),
    CONSTRAINT "platform_communication_recipients_email_normalized" CHECK ("email" = lower(btrim("email")))
);
CREATE UNIQUE INDEX "platform_communication_recipients_campaign_id_email_key" ON "public"."platform_communication_recipients"("campaign_id", "email");
CREATE INDEX "platform_communication_recipients_campaign_id_status_idx" ON "public"."platform_communication_recipients"("campaign_id", "status");
CREATE INDEX "platform_communication_recipients_status_claimed_at_idx" ON "public"."platform_communication_recipients"("status", "claimed_at");
