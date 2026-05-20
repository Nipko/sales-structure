-- Trusted devices: skip 2FA for remembered browsers (30-day trust window)

CREATE TABLE IF NOT EXISTS "trusted_devices" (
    "id"               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id"          UUID        NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "token_hash"       TEXT        NOT NULL UNIQUE,
    "device_name"      TEXT        NOT NULL,
    "user_agent"       TEXT,
    "fingerprint_hash" TEXT,
    "ip_address"       TEXT,
    "expires_at"       TIMESTAMPTZ NOT NULL,
    "last_used_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    "is_revoked"       BOOLEAN     NOT NULL DEFAULT false,
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "trusted_devices_user_id_idx" ON "trusted_devices" ("user_id");
