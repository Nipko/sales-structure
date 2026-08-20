-- Operating identity is not billing identity.
--
-- `billing_country` is the only country a tenant has ever had, and the rest of
-- the platform reads it — or infers from a timezone, or falls back to Colombia —
-- to decide terminology, phone normalisation, currency and date formats. Those
-- are different questions with different answers: a Colombian company can bill
-- from Colombia and operate a hotel in Mexico, and its guests are neither.
--
-- Purely additive, per the expand-contract rule: the deploy migrates before the
-- containers are recreated, so the old code runs against this schema for
-- minutes. Every column is nullable with no default, so a NULL means "not
-- declared yet" and the resolver falls back to today's behaviour. Nothing is
-- backfilled here: a guessed operating country is worse than an absent one,
-- because it looks decided. The review queue in `regional_identity_reviews`
-- carries the discrepancies to a human instead.
BEGIN;

ALTER TABLE "tenants"
    ADD COLUMN IF NOT EXISTS "operating_country"  VARCHAR(2),
    ADD COLUMN IF NOT EXISTS "operating_timezone" VARCHAR(64),
    ADD COLUMN IF NOT EXISTS "default_locale"     VARCHAR(35),
    ADD COLUMN IF NOT EXISTS "phone_region"       VARCHAR(2),
    ADD COLUMN IF NOT EXISTS "address_schema_id"  VARCHAR(16),
    ADD COLUMN IF NOT EXISTS "country_pack_id"      VARCHAR(16),
    ADD COLUMN IF NOT EXISTS "country_pack_version" VARCHAR(16),
    -- Where each value came from, so a support agent can tell a declared
    -- country from one the platform inferred. Without provenance a wrong value
    -- is indistinguishable from a chosen one.
    ADD COLUMN IF NOT EXISTS "regional_provenance" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ISO 3166-1 alpha-2, uppercase. A lowercase or three-letter value silently
-- fails every lookup it is used in, so it is rejected at the boundary.
ALTER TABLE "tenants"
    DROP CONSTRAINT IF EXISTS "tenants_operating_country_format_chk";
ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_operating_country_format_chk"
    CHECK ("operating_country" IS NULL OR "operating_country" ~ '^[A-Z]{2}$');

ALTER TABLE "tenants"
    DROP CONSTRAINT IF EXISTS "tenants_phone_region_format_chk";
ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_phone_region_format_chk"
    CHECK ("phone_region" IS NULL OR "phone_region" ~ '^[A-Z]{2}$');

ALTER TABLE "tenants"
    DROP CONSTRAINT IF EXISTS "tenants_regional_provenance_object_chk";
ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_regional_provenance_object_chk"
    CHECK (jsonb_typeof("regional_provenance") = 'object');

CREATE INDEX IF NOT EXISTS "idx_tenants_operating_country"
    ON "tenants" ("operating_country");

-- Discrepancies a human must resolve.
--
-- Billing country, business-info country, agent timezone and phone prefixes
-- disagree for real tenants today. Rewriting them automatically would silently
-- change a tenant's product — including historical phone numbers normalised to
-- +57, where a "correction" can merge two different people into one contact.
CREATE TABLE IF NOT EXISTS "regional_identity_reviews" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"   UUID NOT NULL,
    -- operating_country | timezone | currency | locale | phone_region
    "field"       VARCHAR(32) NOT NULL,
    -- Competing values with where each came from.
    "candidates"  JSONB NOT NULL DEFAULT '[]'::jsonb,
    "suggested"   VARCHAR(64),
    -- pending | confirmed | dismissed
    "status"      VARCHAR(16) NOT NULL DEFAULT 'pending',
    "resolved_by" VARCHAR(200),
    "resolved_at" TIMESTAMPTZ(6),
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regional_identity_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "regional_identity_reviews_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "regional_identity_reviews_status_chk"
        CHECK ("status" IN ('pending', 'confirmed', 'dismissed')),
    CONSTRAINT "regional_identity_reviews_candidates_array_chk"
        CHECK (jsonb_typeof("candidates") = 'array')
);

-- One open review per tenant/field: re-running discovery must update the
-- existing row, not pile up duplicates for the same disagreement.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_regional_identity_reviews_open"
    ON "regional_identity_reviews" ("tenant_id", "field")
    WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS "idx_regional_identity_reviews_status"
    ON "regional_identity_reviews" ("status", "created_at");

COMMIT;
