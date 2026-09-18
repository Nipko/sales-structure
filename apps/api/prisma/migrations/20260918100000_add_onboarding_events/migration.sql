-- Lo que mide el día 0 (Ola 8 del onboarding). Solo guarda lo que no tenía
-- dónde quedar: el alta, el primer canal y la activación ya tienen su columna y
-- se leen de ahí. Ver packages/shared/src/onboarding-events.ts.
--
-- Aditiva de punta a punta: el código viejo no la conoce y no la toca durante
-- el despliegue escalonado. Registrada en TENANT_PUBLIC_PURGE_ORDER (la purga
-- de un tenant la borra), y además cae en cascada con el tenant.
--
-- Identificadores sin el prefijo `public.` a propósito: el guardián de la
-- purga (prisma.service.spec.ts) lee las migraciones con una expresión que
-- históricamente no veía ese prefijo.
CREATE TABLE IF NOT EXISTS "onboarding_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
    "event" VARCHAR(48) NOT NULL,
    "channel_type" VARCHAR(32),
    "step" VARCHAR(32),
    "detail" VARCHAR(64),
    "source" VARCHAR(16) NOT NULL DEFAULT 'server',
    "session_id" UUID,
    "dedupe_key" TEXT,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "onboarding_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onboarding_events_source_check" CHECK ("source" IN ('server','client','derived'))
);

CREATE INDEX IF NOT EXISTS "onboarding_events_tenant_occurred_idx" ON "onboarding_events" ("tenant_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "onboarding_events_event_occurred_idx" ON "onboarding_events" ("event", "occurred_at");
-- Un hito del servidor queda una sola vez: el segundo escritor choca acá y se
-- descarta (INSERT … ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_events_dedupe_key_key" ON "onboarding_events" ("dedupe_key") WHERE "dedupe_key" IS NOT NULL;
