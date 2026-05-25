-- System updates: platform-wide changelogs & announcements

CREATE TABLE IF NOT EXISTS "system_updates" (
    "id"          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    "version"     TEXT        NOT NULL,
    "date"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "title"       JSONB       NOT NULL,
    "description" JSONB       NOT NULL,
    "features"    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    "is_active"   BOOLEAN     NOT NULL DEFAULT true,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);
