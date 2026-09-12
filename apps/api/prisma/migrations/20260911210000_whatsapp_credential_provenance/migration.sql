-- Un nombre de columna no prueba de qué tipo es un token.
--
-- `whatsapp_credentials.credential_type` dice `system_user_token`, y bajo el
-- modelo de Tech Provider ahí conviven dos cosas que NO son intercambiables:
--
--   · un token BISU (Business Integration System User), acuñado para UN cliente
--     por Embedded Signup y acotado a los activos de ese cliente — el que un
--     Tech Provider debe usar para enviar;
--   · el System User propio del PROVEEDOR, que Meta reserva para uso del
--     proveedor y para la línea de crédito de un Solution Partner.
--
-- Firmar el envío de un tenant con el segundo no es una versión menor del
-- primero: atribuye el mensaje al proveedor, lo cobra a otro portafolio y mete
-- el tráfico de un cliente en la auditoría de otro negocio. Nada en el código
-- podía distinguirlos porque la única evidencia era el nombre de la columna.
--
-- ── POR QUÉ TODO ES NULLABLE Y NO HAY BACKFILL ───────────────────────────────
--
-- Establecer la procedencia de un token exige preguntarle a Meta, y esta
-- migración no llama a nadie. Una credencial que nadie verificó queda con estas
-- columnas en NULL, que el código lee como `not_established` — un tercer estado,
-- distinto de las dos respuestas. Se sigue usando y se dice que no fue
-- comprobada: rechazarla sería una caída causada por la contabilidad, y darla
-- por buena sería la mentira que esto viene a evitar.
--
-- Expand-only, como manda el runbook: sólo columnas nuevas nullables, ningún
-- RENAME y ningún DROP, así el binario viejo sigue funcionando contra este
-- esquema durante el deploy.

ALTER TABLE "public"."whatsapp_credentials"
    ADD COLUMN IF NOT EXISTS "credential_kind" TEXT,
    ADD COLUMN IF NOT EXISTS "meta_app_id" TEXT,
    ADD COLUMN IF NOT EXISTS "owner_business_id" TEXT,
    ADD COLUMN IF NOT EXISTS "granted_scopes" TEXT,
    ADD COLUMN IF NOT EXISTS "provenance_verified_at" TIMESTAMPTZ;

-- Los dos valores que el código sabe leer, más la ausencia. Un valor que nadie
-- definió entraría a la tabla y saldría leído como "no establecido", que es
-- seguro pero silencioso: mejor que la base lo rechace y alguien lo vea.
--
-- NOT VALID primero y VALIDATE después: la validación toma un lock más suave y
-- las filas existentes tienen NULL, que el CHECK admite.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_credentials_kind'
    ) THEN
        ALTER TABLE "public"."whatsapp_credentials"
            ADD CONSTRAINT "whatsapp_credentials_kind"
            CHECK ("credential_kind" IS NULL OR "credential_kind" IN (
                'business_integration_system_user', 'provider_system_user'
            )) NOT VALID;
        ALTER TABLE "public"."whatsapp_credentials"
            VALIDATE CONSTRAINT "whatsapp_credentials_kind";
    END IF;
END $$;

-- Para la pantalla que tiene que listar las credenciales sin procedencia: es la
-- cola de trabajo que esta migración crea, y una cola que nadie puede consultar
-- barata es una cola que nadie mira.
CREATE INDEX IF NOT EXISTS "idx_whatsapp_credentials_unverified"
    ON "public"."whatsapp_credentials" ("tenant_id")
    WHERE "provenance_verified_at" IS NULL;
