-- De quién es el hilo, cuando Meta tiene su propio agente adentro.
--
-- El agente de negocio de Meta puede contestar en la MISMA conversación en la
-- que contesta esta plataforma. Nada del pipeline hace esa pregunta:
-- `shouldHandoff` lee las palabras del cliente y el carril durable pregunta si
-- el efecto sigue autorizado. Ninguna de las dos es «¿me toca hablar?».
--
-- Si contestan los dos, el cliente recibe DOS respuestas distintas a un mismo
-- mensaje —posiblemente contradictorias— y las dos se cobran. Eso no es el
-- duplicado que el outbox evita (un efecto enviado dos veces): son dos agentes.
--
-- ── POR QUÉ ES DURABLE ───────────────────────────────────────────────────────
--
-- El control del hilo se mueve en un webhook y se lee en un envío: procesos
-- distintos, reinicios distintos. En memoria, un deploy entre medio deja todos
-- los hilos en `unknown` — y bajo coexistencia eso significa una plataforma
-- muda. El estado vive al lado de la conversación de la que habla.
--
-- ── POR QUÉ `unknown` ES UN ESTADO Y NO UN DEFAULT ───────────────────────────
--
-- Lo obvio sería asumir que el hilo es nuestro mientras nadie diga lo
-- contrario, y es exactamente la lectura que produce la doble respuesta el día
-- que un portafolio enciende el agente de Meta: nadie nos habría avisado, y
-- «sin registro» se habría leído como permiso. Qué significa `unknown` lo
-- decide el interruptor, no esta tabla: apagado —todas las cuentas de hoy—
-- habla, porque es la verdad; encendido, se calla y pregunta.
--
-- ADITIVA: una tabla nueva por tenant. Nada existente cambia de forma y el
-- binario anterior, que no la conoce, sigue funcionando igual.

DO $meta_agent_thread_control$
DECLARE
    tenant_record RECORD;
    target TEXT;
BEGIN
    FOR tenant_record IN
        SELECT "schema_name" FROM "public"."tenants" ORDER BY "schema_name"
    LOOP
        target := quote_ident(tenant_record."schema_name");

        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."meta_agent_thread_control" (
                "conversation_id" UUID PRIMARY KEY,
                "state"           TEXT NOT NULL DEFAULT 'unknown',
                "since"           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                "reason"          TEXT,
                "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                CONSTRAINT "meta_agent_thread_control_state"
                    CHECK ("state" IN ('ours', 'meta_agent', 'standby', 'unknown'))
            )
        $ddl$, target);

        -- Parcial: sólo las filas en standby pueden vencer, y son una fracción
        -- mínima de la tabla. El barrido que recupera un traspaso que nadie
        -- reconoció las lee por `since`.
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS "idx_meta_agent_thread_control_standby"
                ON %s."meta_agent_thread_control" ("since")
                WHERE "state" = 'standby'
        $ddl$, target);
    END LOOP;
END
$meta_agent_thread_control$;
