-- ============================================
-- Platform Settings Table
-- Stores configurable API keys and platform config
-- ============================================

CREATE TABLE IF NOT EXISTS "public"."platform_settings" (
    "key" VARCHAR(255) PRIMARY KEY,           -- e.g. 'llm.openai_api_key'
    "value" TEXT NOT NULL DEFAULT '',
    "category" VARCHAR(100) NOT NULL DEFAULT 'general',
    "label" VARCHAR(255) NOT NULL DEFAULT '',
    "description" TEXT DEFAULT '',
    "is_secret" BOOLEAN DEFAULT false,
    "field_type" VARCHAR(50) DEFAULT 'text',  -- text, password, number, boolean, select
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

-- Seed default settings structure
INSERT INTO platform_settings (key, category, label, description, is_secret, field_type, value) VALUES
  -- LLM Providers
  ('llm.openai_api_key', 'llm', 'OpenAI API Key', 'API key for GPT-4o and GPT-4o-mini models', true, 'password', ''),
  ('llm.anthropic_api_key', 'llm', 'Anthropic API Key', 'API key for Claude Sonnet models', true, 'password', ''),
  ('llm.google_ai_api_key', 'llm', 'Google AI API Key', 'API key for Gemini Pro and Gemini Flash', true, 'password', ''),
  ('llm.xai_api_key', 'llm', 'xAI API Key', 'API key for Grok models', true, 'password', ''),
  ('llm.deepseek_api_key', 'llm', 'DeepSeek API Key', 'API key for DeepSeek Chat model', true, 'password', ''),
  ('llm.default_model', 'llm', 'Modelo por defecto', 'Modelo LLM usado cuando el router no puede decidir', false, 'select', 'gpt-4o-mini'),
  ('llm.default_temperature', 'llm', 'Temperatura por defecto', 'Controla la creatividad de respuestas (0.0 - 1.0)', false, 'number', '0.7'),
  ('llm.max_tokens', 'llm', 'Max Tokens', 'Límite máximo de tokens por respuesta', false, 'number', '800'),
  -- WhatsApp
  ('whatsapp.verify_token', 'whatsapp', 'Verify Token', 'Token de verificación del webhook de Meta', true, 'password', ''),
  ('whatsapp.app_secret', 'whatsapp', 'App Secret', 'Secret de la app de Meta (verificación de firma)', true, 'password', ''),
  ('whatsapp.phone_number_id', 'whatsapp', 'Phone Number ID', 'ID del número de teléfono de WhatsApp Business', false, 'text', ''),
  ('whatsapp.access_token', 'whatsapp', 'Access Token', 'Token de acceso permanente de Meta', true, 'password', ''),
  ('whatsapp.business_account_id', 'whatsapp', 'Business Account ID', 'ID de la cuenta de WhatsApp Business (WABA)', false, 'text', ''),
  -- Chatwoot
  ('chatwoot.url', 'chatwoot', 'Chatwoot URL', 'URL base de tu instancia de Chatwoot', false, 'text', ''),
  ('chatwoot.api_token', 'chatwoot', 'API Token', 'Token de API de Chatwoot para integración', true, 'password', ''),
  ('chatwoot.account_id', 'chatwoot', 'Account ID', 'ID de la cuenta en Chatwoot', false, 'text', '1'),
  -- General
  ('general.platform_name', 'general', 'Nombre de la plataforma', 'Nombre que aparece en el dashboard', false, 'text', 'Parallext Engine'),
  ('general.default_language', 'general', 'Idioma por defecto', 'Idioma predeterminado para nuevos tenants', false, 'select', 'es-CO'),
  ('general.default_timezone', 'general', 'Zona horaria', 'Zona horaria por defecto', false, 'select', 'America/Bogota'),
  ('general.max_conversations_per_tenant', 'general', 'Max conversaciones por tenant', 'Límite de conversaciones activas simultáneas', false, 'number', '100'),
  ('general.enable_analytics', 'general', 'Habilitar Analytics', 'Activar tracking de analytics', false, 'boolean', 'true'),
  ('general.enable_rag', 'general', 'Habilitar RAG', 'Activar búsqueda por conocimiento (RAG pipeline)', false, 'boolean', 'true')
ON CONFLICT (key) DO NOTHING;
