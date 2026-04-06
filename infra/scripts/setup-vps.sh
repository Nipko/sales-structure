#!/bin/bash
# ============================================
# Parallext Engine — VPS Initial Setup
# Run on a fresh Hostinger Ubuntu VPS:
#   cd /opt/parallext-engine && bash infra/scripts/setup-vps.sh
#
# Prerequisites: Docker + Docker Compose installed
# ============================================

set -e
cd /opt/parallext-engine

echo ""
echo "=========================================="
echo "  PARALLEXT ENGINE — VPS INITIAL SETUP"
echo "=========================================="
echo ""

# ---- 1. Generate secrets ----
echo "===> [1/5] Generating secrets..."
INTERNAL_JWT_SECRET=$(openssl rand -base64 48)
ENCRYPTION_KEY=$(openssl rand -hex 32)   # 64 hex chars = 32 bytes for AES-256-GCM
INTERNAL_API_KEY=$(openssl rand -base64 32)
DB_PASSWORD="p4r4ll3xt$(openssl rand -hex 4)"
echo "  [OK] Secrets generated"

# ---- 2. Create production .env ----
echo "===> [2/5] Creating .env..."
cat > .env << EOF
# ============================================
# Parallext Engine — Production Configuration
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# ============================================

# ---- General ----
NODE_ENV=production
LOG_LEVEL=info

# ---- Database (PostgreSQL) ----
DATABASE_URL=postgresql://parallext:${DB_PASSWORD}@postgres:5432/parallext_engine
DB_PASSWORD=${DB_PASSWORD}

# ---- Redis ----
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=

# ---- Authentication ----
# Shared JWT secret between API and WhatsApp services
INTERNAL_JWT_SECRET=${INTERNAL_JWT_SECRET}

# ---- Encryption (AES-256-GCM for WhatsApp tokens) ----
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# ---- Internal Service-to-Service Auth ----
API_INTERNAL_URL=http://api:3000/api/v1
INTERNAL_API_KEY=${INTERNAL_API_KEY}

# ---- Meta / WhatsApp Cloud API ----
# Fill these from your Meta Developer App:
META_APP_ID=CHANGE_ME
META_APP_SECRET=CHANGE_ME
META_VERIFY_TOKEN=CHANGE_ME
META_CONFIG_ID=CHANGE_ME
WHATSAPP_VERIFY_TOKEN=CHANGE_ME
# System User ID from business.facebook.com → Settings → System Users
SYSTEM_USER_ID=

# ---- AI Providers (at least one required) ----
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
XAI_API_KEY=
DEEPSEEK_API_KEY=

# ---- Frontend URLs ----
NEXT_PUBLIC_API_URL=https://api.parallly-chat.cloud/api/v1
NEXT_PUBLIC_WA_SERVICE_URL=https://wa.parallly-chat.cloud/api/v1
NEXT_PUBLIC_META_APP_ID=CHANGE_ME
NEXT_PUBLIC_META_CONFIG_ID=CHANGE_ME
DASHBOARD_URL=https://admin.parallly-chat.cloud

# ---- Cloudflare Tunnel ----
CLOUDFLARE_TUNNEL_TOKEN=CHANGE_ME
EOF

chmod 600 .env
echo "  [OK] .env created and secured"

# ---- 3. Start infrastructure (postgres + redis) ----
echo "===> [3/5] Starting PostgreSQL and Redis..."
docker compose -f infra/docker/docker-compose.prod.yml up -d postgres redis
echo "  Waiting for PostgreSQL..."
for i in $(seq 1 20); do
    if docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres pg_isready -U parallext > /dev/null 2>&1; then
        echo "  [OK] PostgreSQL ready"
        break
    fi
    [ $i -eq 20 ] && { echo "  [ERROR] PostgreSQL not ready after 20s"; exit 1; }
    sleep 1
done

# ---- 4. Run fresh database setup ----
echo "===> [4/5] Running fresh database setup..."
bash infra/scripts/setup-fresh.sh

# ---- 5. Start remaining services + tunnel ----
echo "===> [5/5] Starting all services..."
docker compose -f infra/docker/docker-compose.prod.yml up -d

echo ""
echo "=========================================="
echo "  VPS SETUP COMPLETE"
echo "=========================================="
echo ""
echo "  Dashboard: https://admin.parallly-chat.cloud"
echo "  API:       https://api.parallly-chat.cloud"
echo "  WhatsApp:  https://wa.parallly-chat.cloud"
echo ""
echo "  Login:     admin@parallext.com / Parallext2026!"
echo ""
echo "  IMPORTANT: Edit /opt/parallext-engine/.env to add:"
echo "    - Meta/WhatsApp credentials (META_APP_ID, META_APP_SECRET, etc.)"
echo "    - At least one AI provider API key"
echo "    - Cloudflare Tunnel token"
echo "  Then restart: docker compose -f infra/docker/docker-compose.prod.yml restart"
echo ""
