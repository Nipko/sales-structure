-- DEC-11: an explicit operating currency is tenant identity, not an inferred
-- country default. NULL means the tenant has not configured it yet; writers
-- fail closed until it is set.
ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS operating_currency VARCHAR(3),
    ADD COLUMN IF NOT EXISTS operating_currency_locked_at TIMESTAMPTZ;

ALTER TABLE public.tenants
    DROP CONSTRAINT IF EXISTS tenants_operating_currency_format_chk;

ALTER TABLE public.tenants
    ADD CONSTRAINT tenants_operating_currency_format_chk
    CHECK (operating_currency IS NULL OR operating_currency ~ '^[A-Z]{3}$');

ALTER TABLE public.tenants
    DROP CONSTRAINT IF EXISTS tenants_operating_currency_lock_chk;

ALTER TABLE public.tenants
    ADD CONSTRAINT tenants_operating_currency_lock_chk
    CHECK (operating_currency_locked_at IS NULL OR operating_currency IS NOT NULL);

-- Service-level locking is backed by a database invariant so imports, admin
-- scripts, and future writers cannot relabel historical money accidentally.
CREATE OR REPLACE FUNCTION public.enforce_tenant_operating_currency_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.operating_currency_locked_at IS NOT NULL THEN
        IF NEW.operating_currency IS DISTINCT FROM OLD.operating_currency THEN
            RAISE EXCEPTION 'operating_currency_locked'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.operating_currency_locked_at IS DISTINCT FROM OLD.operating_currency_locked_at THEN
            RAISE EXCEPTION 'operating_currency_lock_cannot_change'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_operating_currency_immutable_trg ON public.tenants;
CREATE TRIGGER tenants_operating_currency_immutable_trg
BEFORE UPDATE OF operating_currency, operating_currency_locked_at
ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.enforce_tenant_operating_currency_immutable();

COMMENT ON COLUMN public.tenants.operating_currency IS
    'Explicit ISO-4217 operating currency; immutable after operating_currency_locked_at is set.';
COMMENT ON COLUMN public.tenants.operating_currency_locked_at IS
    'Timestamp of the first transactional money lineage row; prevents later relabeling.';
