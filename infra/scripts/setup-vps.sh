#!/bin/bash
# ============================================
# Parallext Engine — VPS Setup Script
# Run this on the VPS after the first deploy:
#   bash /opt/parallext-engine/infra/scripts/setup-vps.sh
# ============================================

set -e
cd /opt/parallext-engine

echo "🔧 Configurando Parallext Engine en el VPS..."

# 1. Generar JWT secrets aleatorios
JWT_SECRET=$(openssl rand -base64 48)
JWT_REFRESH_SECRET=$(openssl rand -base64 48)
ENCRYPTION_KEY=$(openssl rand -hex 16)

echo "🔑 Secrets generados correctamente"

# 2. Crear .env de producción
cat > .env << EOF
# ============================================
# Parallext Engine - Production Configuration
# VPS: 31.97.99.73 | Domain: parallly-chat.cloud
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# ============================================

# ---- Application ----
NODE_ENV=production
PORT=3000
API_URL=https://api.parallly-chat.cloud
DASHBOARD_URL=https://admin.parallly-chat.cloud

# ---- Database (PostgreSQL) ----
DATABASE_URL=postgresql://parallext:p4r4ll3xt9877*.@postgres:5432/parallext_engine
DATABASE_HOST=postgres
DATABASE_PORT=5432
DATABASE_USER=parallext
DATABASE_PASSWORD=p4r4ll3xt9877*.
DATABASE_NAME=parallext_engine
DB_PASSWORD=p4r4ll3xt9877*.

# ---- Redis ----
REDIS_URL=redis://redis:6379
REDIS_HOST=redis
REDIS_PORT=6379

# ---- Authentication (auto-generated) ----
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# ---- LLM Providers (add your keys) ----
OPENAI_API_KEY=sk-your-openai-key
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
GOOGLE_AI_API_KEY=your-google-ai-key
XAI_API_KEY=your-xai-grok-key
DEEPSEEK_API_KEY=your-deepseek-key

# ---- Embeddings ----
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536

# ---- WhatsApp (Meta Cloud API) ----
WHATSAPP_VERIFY_TOKEN=parallext-whatsapp-verify-2026
WHATSAPP_APP_SECRET=your-meta-app-secret

# ---- Cloudflare R2 (Object Storage) ----
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET_NAME=parallext-media
R2_PUBLIC_URL=https://media.parallext.com

# ---- Chatwoot ----
CHATWOOT_URL=https://chatwoot.parallly-chat.cloud
CHATWOOT_API_TOKEN=your-chatwoot-api-token
CHATWOOT_ACCOUNT_ID=1

# ---- Encryption (auto-generated) ----
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# ---- Backup ----
BACKUP_RETENTION_DAYS=30
BACKUP_SCHEDULE=0 2 * * *
EOF

echo "📝 Archivo .env creado con JWT secrets auto-generados"

# 3. Verificar que Docker está corriendo
echo "🐳 Reiniciando stack con la nueva configuración..."
docker compose -f infra/docker/docker-compose.prod.yml down || true
docker compose -f infra/docker/docker-compose.prod.yml up -d --build

# 4. Esperar a que arranquen
echo "⏳ Esperando 15 segundos para que los servicios arranquen..."
sleep 15

# 5. Verificar estado
echo ""
echo "📊 Estado de los contenedores:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# 6. Seed de la base de datos (Gecko Aventura)
echo ""
echo "🦎 Ejecutando seed de Gecko Aventura..."
docker exec parallext-postgres psql -U parallext -d parallext_engine -f /dev/stdin < apps/api/prisma/seed-gecko.sql 2>/dev/null && echo "✅ Seed ejecutado" || echo "⚠️  Seed ya ejecutado previamente o DB aún arrancando. Re-intenta en 30s."

echo ""
echo "============================================"
echo "✅ SETUP COMPLETADO"
echo "============================================"
echo ""
echo "🌐 Dashboard: https://admin.parallly-chat.cloud"
echo "🔌 API:       https://api.parallly-chat.cloud"
echo ""
echo "⚠️  PENDIENTE: Edita /opt/parallext-engine/.env para agregar:"
echo "   - Tus API keys de LLM (OpenAI, Anthropic, Google, etc.)"
echo "   - Credenciales de WhatsApp Meta"
echo "   - Luego reinicia: docker compose -f infra/docker/docker-compose.prod.yml restart"
echo ""
