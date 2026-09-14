-- Operational estimates only: never presented as an invoice or Meta spend.
CREATE TABLE public.llm_spend_reservations (
 id TEXT PRIMARY KEY,
 tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 month TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
 model TEXT NOT NULL,
 reserved_micro BIGINT NOT NULL CHECK (reserved_micro >= 0),
 accounted_micro BIGINT NOT NULL CHECK (accounted_micro >= 0),
 basis TEXT NOT NULL CHECK (basis IN ('opening_estimate','reserved_estimate','reported_tokens_estimate','stream_upper_estimate')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX llm_spend_reservations_tenant_month ON public.llm_spend_reservations(tenant_id,month);
