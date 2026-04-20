#!/bin/bash
# ============================================
# Parallly — VPS Initial Setup
# Run on a fresh Ubuntu VPS:
#   cd /opt/parallext-engine && bash infra/scripts/setup-vps.sh
#
# Prerequisites: Docker + Docker Compose installed
# Full guide: docs/server-installation.md
# ============================================

set -e
cd /opt/parallext-engine

echo ""
echo "=========================================="
echo "  PARALLLY — VPS INITIAL SETUP"
echo "=========================================="
echo ""

# ---- 1. Generate secrets ----
echo "===> [1/7] Generating secrets..."
JWT_SECRET=$(openssl rand -base64 48)
JWT_REFRESH_SECRET=$(openssl rand -base64 48)
INTERNAL_JWT_SECRET=$(openssl rand -base64 48)
ENCRYPTION_KEY=$(openssl rand -hex 32)
INTERNAL_API_KEY=$(openssl rand -base64 32)
DB_PASSWORD="p4r4ll3xt$(openssl rand -hex 4)"
BULL_BOARD_TOKEN=$(openssl rand -hex 32)
GRAFANA_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
META_VERIFY_TOKEN=$(openssl rand -hex 32)
echo "  [OK] Secrets generated"

# ---- 2. Create production .env ----
echo "===> [2/7] Creating .env..."
cat > .env << EOF
# ============================================
# Parallly — Production Configuration
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# ============================================

NODE_ENV=production

# ---- Database ----
DB_PASSWORD=${DB_PASSWORD}
DATABASE_URL=postgresql://parallext:\${DB_PASSWORD}@pgbouncer:5432/parallext_engine?pgbouncer=true
DIRECT_DATABASE_URL=postgresql://parallext:\${DB_PASSWORD}@postgres:5432/parallext_engine

# ---- Redis ----
REDIS_HOST=redis
REDIS_PORT=6379

# ---- JWT Auth ----
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=8h

# ---- Encryption (AES-256-GCM) ----
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# ---- Internal Service Auth ----
INTERNAL_JWT_SECRET=${INTERNAL_JWT_SECRET}
API_INTERNAL_URL=http://api:3000/api/v1
INTERNAL_API_KEY=${INTERNAL_API_KEY}

# ---- Meta / WhatsApp (EDIT THESE) ----
META_APP_ID=CAMBIAR
META_APP_SECRET=CAMBIAR
META_CONFIG_ID=CAMBIAR
META_VERIFY_TOKEN=${META_VERIFY_TOKEN}
WHATSAPP_VERIFY_TOKEN=${META_VERIFY_TOKEN}
SYSTEM_USER_ID=

# ---- Google OAuth (EDIT) ----
GOOGLE_OAUTH_CLIENT_ID=CAMBIAR
NEXT_PUBLIC_GOOGLE_CLIENT_ID=CAMBIAR

# ---- AI Providers (at least 1 required) ----
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
XAI_API_KEY=
DEEPSEEK_API_KEY=

# ---- Sentry (EDIT) ----
SENTRY_DSN=CAMBIAR

# ---- SMTP / Email (EDIT) ----
SMTP_HOST=CAMBIAR
SMTP_PORT=587
SMTP_USER=CAMBIAR
SMTP_PASS=CAMBIAR

# ---- Frontend URLs (EDIT domain) ----
NEXT_PUBLIC_API_URL=https://api.parallly-chat.cloud/api/v1
NEXT_PUBLIC_WA_SERVICE_URL=https://wa.parallly-chat.cloud/api/v1
NEXT_PUBLIC_META_APP_ID=CAMBIAR
NEXT_PUBLIC_META_CONFIG_ID=CAMBIAR
DASHBOARD_URL=https://admin.parallly-chat.cloud

# ---- Media ----
MEDIA_STORAGE_PATH=/data/media

# ---- Observability ----
BULL_BOARD_TOKEN=${BULL_BOARD_TOKEN}
GRAFANA_PASSWORD=${GRAFANA_PASSWORD}
LOG_LEVEL=info

# ---- Calendar Integrations ----
GOOGLE_CALENDAR_REDIRECT_URI=https://api.parallly-chat.cloud/api/v1/calendar/google/callback
MS_CALENDAR_REDIRECT_URI=https://api.parallly-chat.cloud/api/v1/calendar/microsoft/callback
EOF

chmod 600 .env
echo "  [OK] .env created and secured"
echo ""
echo "  IMPORTANT: Edit .env now to fill in CAMBIAR values:"
echo "    nano /opt/parallext-engine/.env"
echo ""
read -p "  Press Enter after editing .env to continue..."

# ---- 3. Create Cloudflare Tunnel config template ----
echo "===> [3/7] Creating Cloudflare Tunnel config template..."
mkdir -p /opt/cloudflared
cat > /opt/cloudflared/config.yml << 'TUNNELCFG'
# Cloudflare Tunnel configuration
# Replace TUNNEL_ID with your actual tunnel ID
tunnel: YOUR_TUNNEL_ID
credentials-file: /opt/cloudflared/credentials.json

ingress:
  - hostname: parallly-chat.cloud
    service: http://landing:80
  - hostname: admin.parallly-chat.cloud
    service: http://dashboard:3000
  - hostname: api.parallly-chat.cloud
    service: http://api:3000
  - hostname: wa.parallly-chat.cloud
    service: http://whatsapp:3002
  - hostname: logs.parallly-chat.cloud
    service: http://dozzle:8080
  - hostname: status.parallly-chat.cloud
    service: http://uptime-kuma:3001
  - hostname: grafana.parallly-chat.cloud
    service: http://grafana:3000
  - service: http_status:404
TUNNELCFG
echo "  ✓ Cloudflare Tunnel config template created at /opt/cloudflared/config.yml"
echo "    → Edit this file with your actual tunnel ID and credentials"

# ---- 4. Start infrastructure ----
echo "===> [4/7] Starting PostgreSQL and Redis..."
docker compose -f infra/docker/docker-compose.prod.yml up -d postgres redis
echo "  Waiting for PostgreSQL..."
for i in $(seq 1 30); do
    if docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres pg_isready -U parallext > /dev/null 2>&1; then
        echo "  [OK] PostgreSQL ready"
        break
    fi
    [ $i -eq 30 ] && { echo "  [ERROR] PostgreSQL not ready after 30s"; exit 1; }
    sleep 1
done

# ---- 5. Run fresh database setup ----
echo "===> [5/7] Running fresh database setup..."
bash infra/scripts/setup-fresh.sh

# ---- 6. Start all services ----
echo "===> [6/7] Starting all services (app + observability)..."
docker compose -f infra/docker/docker-compose.prod.yml up -d

# Wait for API health
echo "  Waiting for API..."
for i in $(seq 1 60); do
    if docker compose -f infra/docker/docker-compose.prod.yml exec -T api wget -q -O/dev/null http://localhost:3000/api/v1/health 2>/dev/null; then
        echo "  [OK] API healthy after ${i}s"
        break
    fi
    [ $i -eq 60 ] && echo "  [WARN] API not healthy after 60s"
    sleep 1
done

# ---- 7. Print summary ----
echo ""
echo "=========================================="
echo "  SETUP COMPLETE"
echo "=========================================="
echo ""
echo "  App URLs:"
echo "    Landing:    https://parallly-chat.cloud"
echo "    Dashboard:  https://admin.parallly-chat.cloud"
echo "    API:        https://api.parallly-chat.cloud"
echo "    WhatsApp:   https://wa.parallly-chat.cloud"
echo ""
echo "  Admin Login:"
echo "    Email:    admin@parallext.com"
echo "    Password: Parallext2026!"
echo ""
echo "  Observability:"
echo "    Bull Board:  https://api.parallly-chat.cloud/api/v1/admin/queues?token=${BULL_BOARD_TOKEN}"
echo "    Uptime Kuma: https://status.parallly-chat.cloud (create admin on first visit)"
echo "    Grafana:     https://grafana.parallly-chat.cloud (admin / admin, then change password)"
echo "    Dozzle:      https://logs.parallly-chat.cloud"
echo ""
echo "  Next steps:"
echo "    1. Configure Cloudflare Tunnel hostnames (see docs/server-installation.md step 4)"
echo "    2. Configure Uptime Kuma monitors + Telegram alerts"
echo "    3. Configure Grafana: add Loki datasource (http://parallext-loki:3100)"
echo "    4. Reset Grafana password: docker exec parallext-grafana /usr/share/grafana/bin/grafana cli admin reset-admin-password YOUR_PASS --homepath /usr/share/grafana --config /etc/grafana/grafana.ini"
echo ""
echo "  Credentials saved in /opt/parallext-engine/.env"
echo "  Full guide: docs/server-installation.md"
echo ""
