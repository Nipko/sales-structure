-- Tenant-owned payment credentials are financial authorization material.
-- Keeping them inside tenants.settings lets unrelated settings writers roll
-- them back and generic tenant DTOs expose their encrypted envelopes. Move the
-- complete versioned document to a dedicated one-to-one table.
BEGIN;

CREATE TABLE "tenant_payment_provider_configs" (
    "tenant_id" UUID NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{"version":2,"activeProvider":null,"providers":{}}'::jsonb,
    "wompi_public_key" TEXT,
    "mercadopago_account_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_payment_provider_configs_pkey" PRIMARY KEY ("tenant_id"),
    CONSTRAINT "tenant_payment_provider_configs_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tenant_payment_provider_configs_config_object_chk"
        CHECK (jsonb_typeof("config") = 'object')
);

CREATE UNIQUE INDEX "tenant_payment_provider_configs_wompi_public_key_key"
    ON "tenant_payment_provider_configs"("wompi_public_key")
    WHERE "wompi_public_key" IS NOT NULL;

CREATE UNIQUE INDEX "tenant_payment_provider_configs_mercadopago_account_id_key"
    ON "tenant_payment_provider_configs"("mercadopago_account_id")
    WHERE "mercadopago_account_id" IS NOT NULL;

-- Block old-runtime settings writes only for the short backfill/trigger install
-- window so no credential update can fall between the snapshot and capture.
LOCK TABLE "tenants" IN SHARE ROW EXCLUSIVE MODE;

-- Backfill both the v2 document and the pre-v2 Mercado Pago shape. Claims are
-- intentionally nullable when old MP settings never recorded /users/me.id;
-- those accounts remain settlement-only until the tenant revalidates them.
INSERT INTO "tenant_payment_provider_configs" (
    "tenant_id",
    "config",
    "wompi_public_key",
    "mercadopago_account_id"
)
SELECT
    t."id",
    t."settings" -> 'tenantPayments',
    NULLIF(BTRIM(t."settings" #>> '{tenantPayments,providers,wompi,publicKey}'), ''),
    NULLIF(BTRIM(COALESCE(
        t."settings" #>> '{tenantPayments,providers,mercadopago,accountId}',
        t."settings" #>> '{tenantPayments,accountId}'
    )), '')
FROM "tenants" t
WHERE t."settings" ? 'tenantPayments'
  AND jsonb_typeof(t."settings" -> 'tenantPayments') = 'object'
ON CONFLICT ("tenant_id") DO NOTHING;

-- Rolling-deploy bridge: the old binary still writes tenantPayments inside
-- settings until the new containers replace it. Mirror only an actual change
-- to that subdocument into the dedicated table. Unrelated settings updates do
-- not fire because the old/new subdocuments are identical. A later contract
-- migration may remove the legacy copy after every runtime is on the new code.
CREATE OR REPLACE FUNCTION sync_legacy_tenant_payment_provider_config()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    next_config jsonb;
    current_config jsonb;
    next_revision bigint;
    current_revision bigint;
BEGIN
    IF (NEW.settings -> 'tenantPayments') IS NOT DISTINCT FROM
       (OLD.settings -> 'tenantPayments') THEN
        RETURN NEW;
    END IF;

    SELECT config
      INTO current_config
      FROM tenant_payment_provider_configs
     WHERE tenant_id = NEW.id
     FOR UPDATE;

    -- The expand deploy keeps the legacy copy for old instances. A removal is
    -- therefore treated as a stale writer and the authoritative copy restored.
    IF NOT (NEW.settings ? 'tenantPayments') THEN
        IF current_config IS NOT NULL THEN
            NEW.settings := jsonb_set(
                COALESCE(NEW.settings, '{}'::jsonb),
                '{tenantPayments}',
                current_config,
                true
            );
        END IF;
        RETURN NEW;
    END IF;

    next_config := NEW.settings -> 'tenantPayments';
    next_revision := CASE
        WHEN COALESCE(next_config ->> 'documentRevision', '') ~ '^\d+$'
            THEN (next_config ->> 'documentRevision')::bigint
        ELSE 0
    END;
    current_revision := CASE
        WHEN COALESCE(current_config ->> 'documentRevision', '') ~ '^\d+$'
            THEN (current_config ->> 'documentRevision')::bigint
        ELSE 0
    END;

    -- A settings writer that read an older snapshot cannot roll back money
    -- credentials. Restore the dedicated value into NEW for old runtimes too.
    IF current_config IS NOT NULL AND next_revision < current_revision THEN
        NEW.settings := jsonb_set(
            COALESCE(NEW.settings, '{}'::jsonb),
            '{tenantPayments}',
            current_config,
            true
        );
        RETURN NEW;
    END IF;

    INSERT INTO tenant_payment_provider_configs (
        tenant_id,
        config,
        wompi_public_key,
        mercadopago_account_id,
        created_at,
        updated_at
    ) VALUES (
        NEW.id,
        next_config,
        NULLIF(BTRIM(next_config #>> '{providers,wompi,publicKey}'), ''),
        NULLIF(BTRIM(COALESCE(
            next_config #>> '{providers,mercadopago,accountId}',
            next_config #>> '{accountId}'
        )), ''),
        NOW(),
        NOW()
    )
    ON CONFLICT (tenant_id) DO UPDATE
       SET config = EXCLUDED.config,
           wompi_public_key = EXCLUDED.wompi_public_key,
           mercadopago_account_id = EXCLUDED.mercadopago_account_id,
           updated_at = NOW();

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_legacy_tenant_payment_provider_config
BEFORE UPDATE OF settings ON tenants
FOR EACH ROW
EXECUTE FUNCTION sync_legacy_tenant_payment_provider_config();

COMMIT;
