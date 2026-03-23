-- Migración V4: Campañas & Cursos — Campos Extendidos y Tablas Relacionales
-- Aplicar sobre tenants existentes si las columnas aún no existen.

-- 1. Extensiones a courses
ALTER TABLE courses ADD COLUMN IF NOT EXISTS "code" VARCHAR(50);
ALTER TABLE courses ADD COLUMN IF NOT EXISTS "brochure_url" VARCHAR(500);
ALTER TABLE courses ADD COLUMN IF NOT EXISTS "faq_version" INTEGER DEFAULT 1;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS "policy_version" INTEGER DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_courses_code ON courses("code");

-- 2. Extensiones a campaigns
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS "code" VARCHAR(50);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS "source_type" VARCHAR(50) DEFAULT 'landing';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS "schedule_json" JSONB DEFAULT '{}';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS "default_owner_rule" VARCHAR(255);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS "automation_profile_id" UUID;
CREATE INDEX IF NOT EXISTS idx_campaigns_code ON campaigns("code");

-- 3. Tabla relacional Campaign <-> Courses (many-to-many)
CREATE TABLE IF NOT EXISTS campaign_courses (
    "campaign_id" UUID NOT NULL REFERENCES campaigns("id") ON DELETE CASCADE,
    "course_id"   UUID NOT NULL REFERENCES courses("id") ON DELETE CASCADE,
    "is_primary"  BOOLEAN DEFAULT false,
    PRIMARY KEY ("campaign_id", "course_id")
);

-- 4. Ofertas Comerciales
CREATE TABLE IF NOT EXISTS commercial_offers (
    "id"              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id"       VARCHAR(255),
    "course_id"       UUID REFERENCES courses("id") ON DELETE CASCADE,
    "campaign_id"     UUID REFERENCES campaigns("id") ON DELETE SET NULL,
    "offer_type"      VARCHAR(100) NOT NULL,
    "title"           VARCHAR(500) NOT NULL,
    "conditions_json" JSONB DEFAULT '{}',
    "valid_from"      TIMESTAMP,
    "valid_to"        TIMESTAMP,
    "active"          BOOLEAN DEFAULT true,
    "created_at"      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commercial_offers_course ON commercial_offers("course_id");
CREATE INDEX IF NOT EXISTS idx_commercial_offers_active ON commercial_offers("active");
