-- Un recibo de entrega toca DOS registros, y sólo uno era durable.
--
-- Meta manda `sent/delivered/read/failed` por webhook. Ese evento cambia dos
-- cosas que viven en tablas distintas: la historia que ve el cliente y el
-- dinero. La historia se escribía en su transacción; el dinero se intentaba
-- después, en la suya, y si el segundo intento fallaba —PgBouncer saturado, un
-- deadlock, la base en failover— el proceso lo anotaba en un log y seguía.
--
-- El log es lo único que quedaba. El webhook se confirmaba, Meta nunca
-- reenviaba ese evento, y la reserva quedaba contada para siempre: el techo del
-- número se llenaba con mensajes que habían llegado hacía horas y el informe de
-- exposición mostraba un mes de dinero retenido de una cuenta que ya había
-- pagado. Nadie se enteraba, porque no había nada roto que mirar.
--
-- ── POR QUÉ UN INBOX Y NO UNA TRANSACCIÓN DISTRIBUIDA ───────────────────────
--
-- Porque no hay tal cosa entre "lo que Meta ya nos dijo" y "lo que nuestra base
-- alcanzó a escribir". Fingirla —un try/catch que abarca las dos escrituras—
-- sólo mueve el punto donde se pierde el evento. Lo honesto es hacer durable el
-- HECHO antes de intentar sus consecuencias:
--
--   1. llega el recibo  → se escribe acá, en su propia sentencia confirmada;
--   2. se intenta aplicarlo al libro y a la pausa del número;
--   3. sólo si ambas cosas salieron bien pasa a `applied`.
--
-- Un reinicio entre 1 y 3 deja la fila en `pending` y el barrido la retoma. Un
-- fallo en 1 no confirma nada: el llamador recibe 503 y BullMQ reintenta, que
-- es exactamente lo correcto porque todavía no se escribió nada.
--
-- ── POR QUÉ LA CLAVE ES (recibo, estado) ────────────────────────────────────
--
-- Porque Meta manda varios eventos del MISMO mensaje —`sent`, luego
-- `delivered`, luego `read`— y reenvía cada uno cuantas veces quiera. La clave
-- por recibo solo colapsaría los tres en uno y perdería el que decide. La clave
-- por (recibo, estado) hace que un reenvío sea un no-op de una línea y que dos
-- workers que reciben el mismo evento a la vez escriban la misma fila.
--
-- Que aplicar dos veces no mueva dinero dos veces NO depende de esta tabla: lo
-- garantiza el estado de la reserva, que se niega a salir de `settled` o
-- `released`. Esta tabla garantiza la otra mitad — que aplicar CERO veces no
-- pase inadvertido.
--
-- ADITIVA: sólo CREATE TABLE / CREATE INDEX sobre schemas de tenant que ya
-- tienen el libro de gasto. El binario anterior no conoce esta tabla y sigue
-- funcionando sin ella.

DO $receipt_inbox$
DECLARE
    tenant_record RECORD;
    target TEXT;
BEGIN
    FOR tenant_record IN
        SELECT "schema_name" FROM "public"."tenants" ORDER BY "schema_name"
    LOOP
        target := quote_ident(tenant_record."schema_name");
        CONTINUE WHEN NOT EXISTS (
            SELECT 1 FROM "information_schema"."schemata"
            WHERE "schema_name" = tenant_record."schema_name"
        );
        CONTINUE WHEN to_regclass(target || '.whatsapp_spend_reservations') IS NULL;

        EXECUTE format($ddl$
            CREATE TABLE IF NOT EXISTS %s."whatsapp_receipt_inbox" (
                provider_message_id TEXT NOT NULL,
                status TEXT NOT NULL,
                tenant_id UUID,
                channel_account_id TEXT,
                error_code TEXT,
                error_detail TEXT,
                pricing JSONB,
                state TEXT NOT NULL DEFAULT 'pending',
                outcome TEXT,
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                first_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
                PRIMARY KEY (provider_message_id, status),
                CONSTRAINT whatsapp_receipt_inbox_state
                    CHECK (state IN ('pending','applied','abandoned')),
                CONSTRAINT whatsapp_receipt_inbox_status
                    CHECK (status IN ('sent','delivered','read','failed')),
                CONSTRAINT whatsapp_receipt_inbox_attempts CHECK (attempts >= 0)
            )
        $ddl$, target);

        -- El barrido busca lo pendiente y vencido, que son pocas filas frente a
        -- todo lo que ya se aplicó. Parcial por eso.
        EXECUTE format($ddl$
            CREATE INDEX IF NOT EXISTS idx_whatsapp_receipt_inbox_pending
                ON %s."whatsapp_receipt_inbox" (next_attempt_at)
                WHERE state = 'pending'
        $ddl$, target);
    END LOOP;
END
$receipt_inbox$;
