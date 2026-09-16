-- Operational estimates only: never presented as an invoice or Meta spend.
CREATE TABLE IF NOT EXISTS public.llm_spend_reservations (
 id TEXT PRIMARY KEY,
 tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 month TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
 model TEXT NOT NULL,
 reserved_micro BIGINT NOT NULL CHECK (reserved_micro >= 0),
 accounted_micro BIGINT NOT NULL CHECK (accounted_micro >= 0),
 basis TEXT NOT NULL CHECK (basis IN ('opening_estimate','reserved_estimate','reported_tokens_estimate','stream_upper_estimate','failed_estimate')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS llm_spend_reservations_tenant_month ON public.llm_spend_reservations(tenant_id,month);

-- `failed_estimate` es el estado de una reserva cuyo intento falló: el guardián
-- la liquida en vez de dejarla cobrando el máximo estimado para siempre. Se
-- amplía el conjunto permitido de forma idempotente, para una base donde esta
-- migración ya se hubiera aplicado con el CHECK anterior. Ampliar nunca rompe
-- al código viejo: ninguno escribe ese valor.
ALTER TABLE public.llm_spend_reservations DROP CONSTRAINT IF EXISTS llm_spend_reservations_basis_check;
ALTER TABLE public.llm_spend_reservations ADD CONSTRAINT llm_spend_reservations_basis_check
  CHECK (basis IN ('opening_estimate','reserved_estimate','reported_tokens_estimate','stream_upper_estimate','failed_estimate'));
