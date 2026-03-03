-- ============================================
-- Parallext Engine — Seed Script
-- Seeds the platform with initial data:
--   1. Super admin user
--   2. Gecko Aventura tenant
--   3. Gecko's tenant schema and tables
--   4. Gecko's WhatsApp channel account
--   5. Gecko's products (tours)
--   6. Gecko's persona configuration
-- ============================================

-- 0. Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================
-- 1. Create Super Admin User
-- ============================================
-- Password: parallext2026! (bcrypt hash)
INSERT INTO "public"."User" ("id", "email", "passwordHash", "name", "role", "isActive", "createdAt", "updatedAt")
VALUES (
  uuid_generate_v4(),
  'admin@parallext.io',
  '$2b$10$x7kzK0hV8qZ5g9q2YmJ3..dummy_hash_replace_in_production',
  'Parallext Admin',
  'super_admin',
  true,
  NOW(),
  NOW()
) ON CONFLICT ("email") DO NOTHING;

-- ============================================
-- 2. Create Gecko Aventura Tenant
-- ============================================
INSERT INTO "public"."Tenant" ("id", "name", "slug", "industry", "isActive", "schemaName", "settings", "createdAt", "updatedAt")
VALUES (
  'gecko-aventura-0001-0001-000000000001',
  'Gecko Aventura Extrema',
  'gecko-aventura',
  'tourism',
  true,
  'tenant_gecko_aventura',
  '{"language": "es-CO", "timezone": "America/Bogota", "plan": "professional"}',
  NOW(),
  NOW()
) ON CONFLICT ("slug") DO NOTHING;

-- ============================================
-- 3. Create Gecko Admin User
-- ============================================
-- Password: gecko2026! (bcrypt hash)
INSERT INTO "public"."User" ("id", "email", "passwordHash", "name", "role", "tenantId", "isActive", "createdAt", "updatedAt")
VALUES (
  uuid_generate_v4(),
  'admin@geckoaventura.com',
  '$2b$10$x7kzK0hV8qZ5g9q2YmJ3..dummy_hash_replace_in_production',
  'Gecko Admin',
  'tenant_admin',
  'gecko-aventura-0001-0001-000000000001',
  true,
  NOW(),
  NOW()
) ON CONFLICT ("email") DO NOTHING;

-- ============================================
-- 4. Create Channel Account (WhatsApp)
-- ============================================
INSERT INTO "public"."ChannelAccount" ("id", "tenantId", "channelType", "displayName", "accountIdentifier", "accessToken", "isActive", "configuration", "createdAt", "updatedAt")
VALUES (
  uuid_generate_v4(),
  'gecko-aventura-0001-0001-000000000001',
  'whatsapp',
  'Gecko Aventura WhatsApp',
  'REPLACE_WITH_PHONE_NUMBER_ID',  -- Meta Phone Number ID
  'REPLACE_WITH_ACCESS_TOKEN',     -- Meta permanent access token
  true,
  '{"webhookVerifyToken": "REPLACE_WITH_VERIFY_TOKEN", "businessAccountId": "REPLACE_WITH_WABA_ID"}',
  NOW(),
  NOW()
) ON CONFLICT DO NOTHING;

-- ============================================
-- 5. Create Gecko Aventura Tenant Schema
-- ============================================
CREATE SCHEMA IF NOT EXISTS "tenant_gecko_aventura";

-- Contacts
CREATE TABLE IF NOT EXISTS "tenant_gecko_aventura"."contacts" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "external_id" VARCHAR(255) NOT NULL,
    "channel_type" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255),
    "phone" VARCHAR(50),
    "email" VARCHAR(255),
    "avatar_url" VARCHAR(500),
    "metadata" JSONB DEFAULT '{}',
    "tags" TEXT[] DEFAULT '{}',
    "first_contact_at" TIMESTAMP DEFAULT NOW(),
    "last_contact_at" TIMESTAMP DEFAULT NOW(),
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gecko_contacts_channel ON "tenant_gecko_aventura"."contacts" ("channel_type", "external_id");

-- Conversations
CREATE TABLE IF NOT EXISTS "tenant_gecko_aventura"."conversations" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id" UUID NOT NULL REFERENCES "tenant_gecko_aventura"."contacts"("id") ON DELETE CASCADE,
    "channel_type" VARCHAR(50) NOT NULL,
    "channel_account_id" VARCHAR(255) NOT NULL,
    "status" VARCHAR(50) DEFAULT 'active',
    "stage" VARCHAR(50) DEFAULT 'greeting',
    "assigned_to" VARCHAR(255),
    "summary" TEXT,
    "estimated_ticket_value" DECIMAL(15, 2) DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "resolved_at" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

-- Messages
CREATE TABLE IF NOT EXISTS "tenant_gecko_aventura"."messages" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "conversation_id" UUID NOT NULL REFERENCES "tenant_gecko_aventura"."conversations"("id") ON DELETE CASCADE,
    "direction" VARCHAR(20) NOT NULL,
    "content_type" VARCHAR(50) NOT NULL DEFAULT 'text',
    "content_text" TEXT,
    "media_url" VARCHAR(500),
    "media_mime_type" VARCHAR(100),
    "caption" TEXT,
    "status" VARCHAR(50) DEFAULT 'pending',
    "llm_model_used" VARCHAR(100),
    "llm_tokens_used" INTEGER DEFAULT 0,
    "llm_cost" DECIMAL(10, 6) DEFAULT 0,
    "routing_tier" VARCHAR(50),
    "routing_score" DECIMAL(5, 2),
    "external_id" VARCHAR(255),
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW()
);

-- Persona Config
CREATE TABLE IF NOT EXISTS "tenant_gecko_aventura"."persona_config" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "version" INTEGER DEFAULT 1,
    "is_active" BOOLEAN DEFAULT true,
    "config_yaml" TEXT NOT NULL,
    "config_json" JSONB NOT NULL,
    "created_by" VARCHAR(255),
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

-- Knowledge Documents (RAG)
CREATE TABLE IF NOT EXISTS "tenant_gecko_aventura"."knowledge_documents" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "title" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(500),
    "file_url" VARCHAR(500),
    "file_type" VARCHAR(50),
    "file_size" INTEGER DEFAULT 0,
    "content_text" TEXT,
    "chunk_count" INTEGER DEFAULT 0,
    "status" VARCHAR(50) DEFAULT 'ready',
    "error_message" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

-- Knowledge Embeddings (Vector search)
CREATE TABLE IF NOT EXISTS "tenant_gecko_aventura"."knowledge_embeddings" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "document_id" UUID NOT NULL REFERENCES "tenant_gecko_aventura"."knowledge_documents"("id") ON DELETE CASCADE,
    "chunk_index" INTEGER NOT NULL,
    "chunk_text" TEXT NOT NULL,
    "embedding" vector(1536),
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW()
);

-- Products / Tours
CREATE TABLE IF NOT EXISTS "tenant_gecko_aventura"."products" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "name" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(255),
    "price" DECIMAL(15, 2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(10) DEFAULT 'COP',
    "is_available" BOOLEAN DEFAULT true,
    "stock" INTEGER,
    "images" TEXT[] DEFAULT '{}',
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

-- Orders / Reservations
CREATE TABLE IF NOT EXISTS "tenant_gecko_aventura"."orders" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "contact_id" UUID NOT NULL REFERENCES "tenant_gecko_aventura"."contacts"("id"),
    "conversation_id" UUID REFERENCES "tenant_gecko_aventura"."conversations"("id"),
    "items" JSONB NOT NULL DEFAULT '[]',
    "total_amount" DECIMAL(15, 2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(10) DEFAULT 'COP',
    "status" VARCHAR(50) DEFAULT 'pending',
    "payment_status" VARCHAR(50) DEFAULT 'pending',
    "payment_reference" VARCHAR(255),
    "notes" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW(),
    "updated_at" TIMESTAMP DEFAULT NOW()
);

-- Analytics Events
CREATE TABLE IF NOT EXISTS "tenant_gecko_aventura"."analytics_events" (
    "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "event_type" VARCHAR(100) NOT NULL,
    "conversation_id" UUID,
    "contact_id" UUID,
    "data" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- 6. Seed Gecko Products (Tours)
-- ============================================
INSERT INTO "tenant_gecko_aventura"."products" ("name", "description", "category", "price", "currency", "is_available", "metadata")
VALUES
  ('Rafting Río Chicamocha', 'Aventura de rafting en el Cañón del Chicamocha. Nivel III-IV. Incluye transporte, equipo completo, guía certificado y seguro. Duración: 3-4 horas de adrenalina pura.', 'rafting', 180000, 'COP', true, '{"duration": "3-4 horas", "difficulty": "intermedio-avanzado", "minAge": 14, "minGroup": 2, "maxGroup": 12}'),
  
  ('Parapente Cañón del Chicamocha', 'Vuelo en parapente sobre el espectacular Cañón del Chicamocha. Vuelo tándem con instructor certificado. Incluye video y fotos del vuelo. Duración: 15-25 minutos de vuelo.', 'parapente', 250000, 'COP', true, '{"duration": "15-25 min vuelo", "difficulty": "principiante", "minAge": 10, "minGroup": 1, "maxGroup": 1}'),
  
  ('Canyoning Cascada Juan Curí', 'Descenso en rappel por la cascada Juan Curí de 180 metros. Incluye equipo técnico, guía especializado, transporte y snack. La experiencia completa dura 5-6 horas.', 'canyoning', 150000, 'COP', true, '{"duration": "5-6 horas", "difficulty": "intermedio", "minAge": 12, "minGroup": 2, "maxGroup": 10}'),
  
  ('Espeleología Cueva del Indio', 'Exploración de cavernas naturales con formaciones milenarias. Incluye equipo de iluminación, casco, guía experto y transporte. Ideal para familias y grupos.', 'espeleología', 120000, 'COP', true, '{"duration": "3-4 horas", "difficulty": "fácil-intermedio", "minAge": 8, "minGroup": 4, "maxGroup": 15}'),
  
  ('Bungee Jumping 70m', 'Salto de bungee desde 70 metros de altura. La descarga de adrenalina más intensa. Incluye certificado, video y seguro. Peso mínimo 40kg, máximo 110kg.', 'bungee', 200000, 'COP', true, '{"duration": "30 min", "difficulty": "extremo", "minAge": 16, "minGroup": 1, "maxGroup": 1, "minWeight": 40, "maxWeight": 110}'),
  
  ('Combo Aventura Total', 'Paquete completo: Rafting + Parapente + Canyoning. 2 días de aventura extrema con alojamiento incluido en eco-lodge. Comidas incluidas.', 'combo', 650000, 'COP', true, '{"duration": "2 días", "difficulty": "intermedio-avanzado", "minAge": 14, "minGroup": 2, "maxGroup": 8, "includes": ["alojamiento", "comidas", "transporte", "equipo", "seguro"]}')
ON CONFLICT DO NOTHING;

-- ============================================
-- 7. Load Gecko Persona Config (Sofia Henao)
-- ============================================
-- Read from templates/personas/turismo.yaml  
-- The config_json is a JSON representation of the YAML
INSERT INTO "tenant_gecko_aventura"."persona_config" ("version", "is_active", "config_yaml", "config_json", "created_by")
VALUES (
  1,
  true,
  '# Sofia Henao - Gecko Aventura Extrema
# See templates/personas/turismo.yaml for full config',
  '{
    "tenant": {"id": "gecko-aventura", "name": "Gecko Aventura Extrema", "industry": "tourism", "language": "es-CO"},
    "persona": {
      "name": "Sofia Henao",
      "role": "Asesora de aventuras extremas",
      "personality": {"tone": "amigable, entusiasta, aventurera", "formality": "casual-professional", "emojiUsage": "moderate", "humor": "ligero, temática de aventura"},
      "greeting": "¡Hola! 🦎 Soy Sofia de Gecko Aventura Extrema.\n¿Listo para vivir una experiencia inolvidable? ¿En qué puedo ayudarte hoy?",
      "fallbackMessage": "Hmm, no tengo esa información ahora mismo.\nDéjame conectarte con alguien de nuestro equipo que pueda ayudarte mejor. 🙌"
    },
    "behavior": {
      "rules": [
        "NUNCA inventar precios, disponibilidad o información que no tengas",
        "SIEMPRE confirmar fecha y número de personas antes de cotizar",
        "Si el cliente menciona niños, SIEMPRE preguntar edades",
        "Si no puedes resolver en 3 mensajes, ofrecer hablar con un humano",
        "Responder SIEMPRE en español colombiano natural",
        "Usar máximo 2-3 emojis por mensaje, no exagerar",
        "Si preguntan por competidores, redirigir a las ventajas de Gecko"
      ],
      "handoffTriggers": [
        "Quejas o reclamos formales",
        "Solicitud explícita de hablar con un humano",
        "Más de 3 intentos sin resolver la consulta",
        "Temas de facturación, devoluciones o reembolsos",
        "Accidentes o emergencias"
      ]
    },
    "rag": {"enabled": true, "chunkSize": 512, "chunkOverlap": 50, "topK": 5, "similarityThreshold": 0.75},
    "hours": {
      "timezone": "America/Bogota",
      "schedule": {"lunes-viernes": "08:00-18:00", "sabado": "08:00-14:00", "domingo": "cerrado"},
      "afterHoursMessage": "¡Hola! 🌙 En este momento estamos fuera de nuestro horario de atención.\nTe responderemos mañana a primera hora. ¡Tu aventura nos espera! 🦎"
    }
  }',
  'system_seed'
)
ON CONFLICT DO NOTHING;

-- ============================================
-- 8. Seed Knowledge Base (FAQ / Info)
-- ============================================
INSERT INTO "tenant_gecko_aventura"."knowledge_documents" ("title", "content_text", "file_type", "status", "chunk_count", "metadata")
VALUES
  ('Información General Gecko Aventura', 
   'Gecko Aventura Extrema es una empresa de turismo de aventura ubicada en San Gil, Santander, Colombia. Somos expertos en deportes extremos y actividades al aire libre desde 2018. Ofrecemos experiencias de rafting, parapente, canyoning, espeleología, bungee jumping y combos de aventura. Todos nuestros guías están certificados y contamos con los mejores equipos de seguridad. Estamos ubicados en la capital del turismo extremo de Colombia.',
   'text', 'ready', 1, '{"type": "general_info"}'),
   
  ('Preguntas Frecuentes', 
   '¿Qué incluye cada tour? Todos nuestros tours incluyen: equipo completo, guía certificado, seguro de aventura y transporte desde San Gil. ¿Necesito experiencia previa? No, la mayoría de nuestras actividades son aptas para principiantes. Nuestros guías te darán toda la instrucción necesaria. ¿Cuál es la política de cancelación? Puedes cancelar hasta 24 horas antes sin cargo. Cancelaciones con menos de 24 horas tienen un cargo del 50%. ¿Qué debo llevar? Ropa cómoda, protector solar, zapatos cerrados que se puedan mojar (para rafting/canyoning), y muchas ganas de aventura. ¿Hay restricciones de edad o peso? Cada actividad tiene sus propias restricciones. El rafting es desde 14 años, el parapente desde 10 años. Para bungee el peso debe estar entre 40-110kg. ¿Cuáles son los métodos de pago? Aceptamos efectivo, transferencia bancaria (Nequi, Daviplata, Bancolombia) y tarjetas de crédito/débito.',
   'text', 'ready', 1, '{"type": "faq"}'),
   
  ('Ubicación y Contacto',
   'Dirección: Carrera 10 #7-35, San Gil, Santander, Colombia. Teléfono: +57 310 XXX XXXX. Email: info@geckoaventura.com. Horario de oficina: Lunes a Viernes 8:00 AM - 6:00 PM, Sábados 8:00 AM - 2:00 PM. Los tours operan todos los días, sujetos a condiciones climáticas. Punto de encuentro para tours: Nuestra oficina principal en el centro de San Gil. Ofrecemos transporte gratuito desde hoteles en San Gil.',
   'text', 'ready', 1, '{"type": "contact_info"}')
ON CONFLICT DO NOTHING;

-- ============================================
-- Done!
-- ============================================
-- Run with: psql -U parallext -d parallext_engine -f seed-gecko.sql
