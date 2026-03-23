-- Migración V4: Analytics — Daily Metrics aggregates

CREATE TABLE IF NOT EXISTS daily_metrics (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "tenant_id" VARCHAR(255) NOT NULL,
    "metric_date" DATE NOT NULL,
    "dimension_type" VARCHAR(50) NOT NULL,
    "dimension_id" VARCHAR(255),
    "metrics_json" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON daily_metrics("metric_date", "dimension_type");
CREATE INDEX IF NOT EXISTS idx_daily_metrics_tenant ON daily_metrics("tenant_id", "metric_date");
