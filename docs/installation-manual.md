# Parallly Platform — Installation Manual

> Complete guide from blank Ubuntu VPS to fully running platform.
> Version 4.0 | April 2026

---

## Table of Contents

1. [Pre-Deployment Checklist](#1-pre-deployment-checklist)
2. [VPS Setup](#2-vps-setup)
3. [Environment Configuration](#3-environment-configuration)
4. [Database Setup](#4-database-setup)
5. [Cloudflare Tunnel](#5-cloudflare-tunnel)
6. [Start All Services](#6-start-all-services)
7. [Post-Deploy Configuration](#7-post-deploy-configuration)
8. [CI/CD (GitHub Actions)](#8-cicd-github-actions)
9. [Backup & Recovery](#9-backup--recovery)
10. [Troubleshooting](#10-troubleshooting)
11. [Monitoring Checklist](#11-monitoring-checklist)

---

## 1. Pre-Deployment Checklist

### External Accounts Required

| Service | Required? | Purpose | Where to get |
|---------|-----------|---------|--------------|
| Meta/WhatsApp Cloud API | YES | WhatsApp messaging | business.facebook.com |
| Cloudflare | YES | Tunnel routing + DNS | dash.cloudflare.com |
| GitHub (GHCR) | YES | Docker image registry | Automatic with repo |
| OpenAI / Anthropic / Gemini | At least 1 | AI model provider | platform.openai.com |
| Google OAuth | Optional | Dashboard login | console.cloud.google.com |
| Sentry | Optional | Error tracking | sentry.io |
| SMTP (Gmail/SendGrid) | Optional | Email notifications | Any SMTP provider |
| Twilio | Optional | SMS channel | twilio.com |

### DNS Records Needed

| Subdomain | Service | Port |
|-----------|---------|------|
| `parallly-chat.cloud` | Landing page | 80 |
| `admin.parallly-chat.cloud` | Dashboard | 3001 |
| `api.parallly-chat.cloud` | API | 3000 |
| `wa.parallly-chat.cloud` | WhatsApp service | 3002 |
| `logs.parallly-chat.cloud` | Dozzle (logs) | 8080 |
| `status.parallly-chat.cloud` | Uptime Kuma | 3001 |
| `grafana.parallly-chat.cloud` | Grafana | 3000 |

All records are CNAME pointing to `{TUNNEL_ID}.cfargotunnel.com`.

### VPS Requirements

- **OS**: Ubuntu 20.04+ (22.04 recommended)
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 40GB SSD minimum
- **CPU**: 2 vCPU minimum
- **Provider**: Hostinger, DigitalOcean, Hetzner, AWS, etc.

---

## 2. VPS Setup

### 2.1 Initial Server

```bash
ssh -p YOUR_PORT user@your_vps_ip

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version

# Setup swap (important for 4GB VPS)
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Firewall
sudo ufw default deny incoming
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 2.2 Clone Repository

```bash
sudo mkdir -p /opt/parallext-engine
sudo chown $USER:$USER /opt/parallext-engine
cd /opt/parallext-engine
git clone https://github.com/Nipko/sales-structure.git .
```

### 2.3 Automated Setup (Recommended)

```bash
bash infra/scripts/setup-vps.sh
```

This script:
1. Generates all cryptographic secrets (JWT, encryption, API keys)
2. Creates `.env` file with all required variables
3. Prompts you to edit `.env` with Meta/Google/AI credentials
4. Creates Cloudflare Tunnel config template
5. Starts PostgreSQL + Redis
6. Initializes database (tables, admin user, extensions)
7. Starts all 13+ Docker services

**Default admin credentials**: `admin@parallext.com` / `Parallext2026!`

---

## 3. Environment Configuration

### 3.1 Required Variables

```bash
# ---- Database ----
DB_PASSWORD=<generated>
DATABASE_URL=postgresql://parallext:<pass>@pgbouncer:6432/parallext_engine
DIRECT_DATABASE_URL=postgresql://parallext:<pass>@postgres:5432/parallext_engine

# ---- Auth ----
JWT_SECRET=<generated-base64-48>
JWT_REFRESH_SECRET=<generated-base64-48>
INTERNAL_JWT_SECRET=<generated-base64-48>
ENCRYPTION_KEY=<generated-hex-64>
INTERNAL_API_KEY=<generated-base64-32>

# ---- Meta/WhatsApp ----
META_APP_ID=<from-meta-business>
META_APP_SECRET=<from-meta-business>
META_CONFIG_ID=<from-meta-business>
META_VERIFY_TOKEN=<generated-hex-32>
SYSTEM_USER_ID=<from-meta-system-users>

# ---- AI (at least one) ----
OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
# GOOGLE_GENERATIVE_AI_API_KEY=...

# ---- Frontend ----
NEXT_PUBLIC_API_URL=https://api.parallly-chat.cloud/api/v1
NEXT_PUBLIC_WA_SERVICE_URL=https://wa.parallly-chat.cloud/api/v1
DASHBOARD_URL=https://admin.parallly-chat.cloud
```

### 3.2 Optional Variables

```bash
# Google OAuth
GOOGLE_OAUTH_CLIENT_ID=<from-google-console>
GOOGLE_OAUTH_CLIENT_SECRET=<from-google-console>

# Calendar integrations
GOOGLE_CALENDAR_REDIRECT_URI=https://api.parallly-chat.cloud/api/v1/calendar/google/callback

# SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<email>
SMTP_PASS=<app-specific-password>

# Sentry
SENTRY_DSN=https://...@sentry.io/...

# Observability
BULL_BOARD_TOKEN=<generated>
GRAFANA_PASSWORD=<generated>
LOG_LEVEL=info
```

### 3.3 Important Notes

- `DATABASE_URL` goes through PgBouncer (port 6432) for connection pooling
- `DIRECT_DATABASE_URL` goes direct to PostgreSQL (port 5432) for migrations
- `ENCRYPTION_KEY` must be exactly 64 hex characters (32 bytes for AES-256-GCM)
- `.env` file permissions should be `600` (owner read/write only)
- **CRITICAL**: `.env` is regenerated on every deploy from GitHub Secrets. New vars MUST be added to both GitHub Secrets AND `.github/workflows/deploy.yml`

---

## 4. Database Setup

### 4.1 Schema Structure

The platform uses **schema-per-tenant** multi-tenancy:

```
parallext_engine (database)
├── public (global schema)
│   ├── tenants
│   ├── users
│   ├── channel_accounts
│   ├── audit_logs
│   ├── whatsapp_onboardings
│   ├── whatsapp_credentials
│   └── platform_settings
│
├── tenant_acme (per-tenant schema)
│   ├── contacts, conversations, messages
│   ├── leads, opportunities, deals
│   ├── agent_personas, agent_templates     ← Multi-agent system
│   ├── persona_config                      ← Legacy (backward compat)
│   ├── services, appointments, availability_slots
│   ├── calendar_integrations               ← Google/Outlook sync
│   ├── automation_rules, automation_executions
│   ├── knowledge_documents, knowledge_embeddings
│   ├── analytics_events, daily_metrics
│   ├── consent_records, opt_out_records
│   └── ... (74 tables total per tenant)
│
└── tenant_other (another tenant's schema)
    └── ... (same structure)
```

### 4.2 Fresh Database Init

```bash
bash infra/scripts/setup-fresh.sh
```

### 4.3 Database Reset (destroys all data)

```bash
bash infra/scripts/reset-db.sh
```

### 4.4 Apply Schema Updates to Existing Tenants

```bash
# Get list of active tenant schemas
SCHEMAS=$(docker exec parallext-postgres psql -U parallext -d parallext_engine -t \
  -c "SELECT schema_name FROM tenants WHERE is_active = true" | tr -d ' ' | grep -v '^$')

# Apply tenant-schema.sql to each
for schema in $SCHEMAS; do
  echo "Migrating: $schema"
  cat apps/api/prisma/tenant-schema.sql | sed "s/{{SCHEMA_NAME}}/$schema/g" | \
    docker exec -i parallext-postgres psql -U parallext -d parallext_engine
done
```

---

## 5. Cloudflare Tunnel

### 5.1 Create Tunnel

```bash
# Install cloudflared
curl -L --output cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflare-deb-linux_amd64.deb
sudo dpkg -i cloudflared.deb

# Login to Cloudflare
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create parallext

# Get tunnel ID
TUNNEL_ID=$(cloudflared tunnel list | grep parallext | awk '{print $1}')
echo "Tunnel ID: $TUNNEL_ID"
```

### 5.2 Configure Routing

```bash
mkdir -p /opt/cloudflared

# Copy credentials
cp ~/.cloudflared/${TUNNEL_ID}.json /opt/cloudflared/credentials.json
chmod 600 /opt/cloudflared/credentials.json
```

Edit `/opt/cloudflared/config.yml`:
```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /opt/cloudflared/credentials.json

ingress:
  - hostname: parallly-chat.cloud
    service: http://landing:80
  - hostname: admin.parallly-chat.cloud
    service: http://dashboard:3001
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
```

### 5.3 DNS Records

In Cloudflare Dashboard, create CNAME records:
```
parallly-chat.cloud          → TUNNEL_ID.cfargotunnel.com (proxied)
admin.parallly-chat.cloud    → TUNNEL_ID.cfargotunnel.com (proxied)
api.parallly-chat.cloud      → TUNNEL_ID.cfargotunnel.com (proxied)
wa.parallly-chat.cloud       → TUNNEL_ID.cfargotunnel.com (proxied)
logs.parallly-chat.cloud     → TUNNEL_ID.cfargotunnel.com (proxied)
status.parallly-chat.cloud   → TUNNEL_ID.cfargotunnel.com (proxied)
grafana.parallly-chat.cloud  → TUNNEL_ID.cfargotunnel.com (proxied)
```

---

## 6. Start All Services

### 6.1 Service Architecture

```
14 Docker containers:

Core App:
  parallext-api          NestJS API         :3000
  parallext-worker       BullMQ processor   (no port)
  parallext-dashboard    Next.js admin      :3001
  parallext-whatsapp     WhatsApp service   :3002
  parallext-landing      Static site/nginx  :80

Data:
  parallext-postgres     PostgreSQL 16      :5432 (localhost only)
  parallext-pgbouncer    Connection pooler  :6432 (internal)
  parallext-redis        Redis 7            :6379 (internal)

Routing:
  parallext-tunnel       Cloudflare Tunnel  (outbound only)

Observability:
  parallext-grafana      Grafana            :3004→3000
  parallext-loki         Loki               :3100
  parallext-promtail     Log shipper        (internal)
  parallext-dozzle       Live logs          :9999→8080
  parallext-uptime-kuma  Health monitor     :3003→3001

Auto-deploy:
  parallext-watchtower   Image updater      (internal)
```

### 6.2 Start

```bash
cd /opt/parallext-engine
docker compose -f infra/docker/docker-compose.prod.yml up -d

# Wait for health
sleep 30
docker compose -f infra/docker/docker-compose.prod.yml ps

# Verify API
curl -s https://api.parallly-chat.cloud/api/v1/health | jq .
```

### 6.3 Persistent Volumes

| Volume | Purpose |
|--------|---------|
| `parallext-postgres-data` | Database files |
| `parallext-redis-data` | Cache + queues |
| `parallext-media-data` | Uploaded images/docs |
| `parallext-api-logs` | API debug logs |
| `parallext-worker-logs` | Worker debug logs |
| `parallext-grafana-data` | Dashboards config |
| `parallext-loki-data` | Log storage |
| `parallext-uptime-kuma-data` | Monitor configs |

---

## 7. Post-Deploy Configuration

### 7.1 Change Default Passwords

```bash
# Grafana admin password
docker exec parallext-grafana grafana-cli admin reset-admin-password YOUR_PASSWORD

# Dashboard admin (login, go to Settings → Change Password)
```

### 7.2 Setup Grafana → Loki

1. Go to `https://grafana.parallly-chat.cloud`
2. Login: admin / (your password)
3. Configuration → Data Sources → Add → Loki
4. URL: `http://parallext-loki:3100`
5. Save & Test

### 7.3 Setup Uptime Kuma

1. Go to `https://status.parallly-chat.cloud`
2. Create admin account on first visit
3. Add monitors:
   - API: `https://api.parallly-chat.cloud/api/v1/health`
   - Dashboard: `https://admin.parallly-chat.cloud`
   - WhatsApp: `https://wa.parallly-chat.cloud/api/v1/health/live`
   - PostgreSQL: TCP `parallext-postgres:5432`
   - Redis: TCP `parallext-redis:6379`

### 7.4 Configure WhatsApp

1. Login to dashboard: `https://admin.parallly-chat.cloud`
2. Go to Channels → WhatsApp → Connect
3. Follow Embedded Signup wizard
4. Webhook URL: `https://wa.parallly-chat.cloud/api/v1/webhooks/whatsapp`
5. Verify token: value of `META_VERIFY_TOKEN` from `.env`

### 7.5 Configure AI Agent

1. Go to AI Agents → Select template (Sales, Support, FAQ, etc.)
2. Customize: name, personality, rules, schedule
3. Assign channels (WhatsApp, Instagram, etc.)
4. Save → Agent is active

---

## 8. CI/CD (GitHub Actions)

### 8.1 Setup

Add these secrets to GitHub repo → Settings → Secrets:

```
SERVER_HOST, SERVER_USER, SERVER_PASSWORD, SERVER_PORT
META_APP_ID, META_APP_SECRET, META_CONFIG_ID, META_VERIFY_TOKEN
SYSTEM_USER_ID, META_BUSINESS_ID
PROD_DATABASE_URL, DATABASE_PASSWORD
REDIS_HOST
JWT_SECRET, JWT_REFRESH_SECRET, INTERNAL_JWT_SECRET
ENCRYPTION_KEY, INTERNAL_API_KEY
OPENAI_API_KEY, ANTHROPIC_API_KEY (+ other AI keys)
GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
SENTRY_DSN, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
BULL_BOARD_TOKEN, GRAFANA_PASSWORD
CLOUDFLARE_TUNNEL_TOKEN
```

### 8.2 Deploy Flow

Push to `main` → GitHub Actions:
1. TypeScript check (API + WhatsApp)
2. Build 5 Docker images (API, Worker, Dashboard, WhatsApp, Landing)
3. Push to GHCR
4. SSH to VPS
5. Pull images + regenerate `.env`
6. Run Prisma migrations
7. Apply tenant-schema.sql to all tenants
8. Restart services
9. Verify API health
10. Restart tunnel

---

## 9. Backup & Recovery

### 9.1 Backup

```bash
# Database
docker exec parallext-postgres pg_dump -U parallext parallext_engine | \
  gzip > /backup/db_$(date +%Y%m%d).sql.gz

# Redis
docker exec parallext-redis redis-cli BGSAVE
cp /var/lib/docker/volumes/parallext-redis-data/_data/dump.rdb \
  /backup/redis_$(date +%Y%m%d).rdb

# Media
tar czf /backup/media_$(date +%Y%m%d).tar.gz \
  /var/lib/docker/volumes/parallext-media-data/_data/

# Grafana
tar czf /backup/grafana_$(date +%Y%m%d).tar.gz \
  /var/lib/docker/volumes/parallext-grafana-data/_data/
```

### 9.2 Restore

```bash
# Database
gunzip -c /backup/db_YYYYMMDD.sql.gz | \
  docker exec -i parallext-postgres psql -U parallext -d parallext_engine

# Redis
docker compose -f infra/docker/docker-compose.prod.yml stop redis
cp /backup/redis_YYYYMMDD.rdb \
  /var/lib/docker/volumes/parallext-redis-data/_data/dump.rdb
docker compose -f infra/docker/docker-compose.prod.yml start redis
```

### 9.3 Automated Backup (Cron)

```bash
crontab -e
# Add:
0 3 * * * /opt/parallext-engine/infra/scripts/backup.sh >> /var/log/backup.log 2>&1
```

---

## 10. Troubleshooting

### API won't start

```bash
docker logs parallext-api --tail 100
# Common: DB not ready → wait 30s, restart
# Common: Missing env var → check .env
# Common: Circular DI → check console for module name
```

### Webhooks not received

```bash
# Test endpoint
curl -X POST https://wa.parallly-chat.cloud/api/v1/webhooks/whatsapp \
  -H "Content-Type: application/json" -d '{"object":"whatsapp_business_account"}'

# Check Meta webhook config matches META_VERIFY_TOKEN
```

### Database connection timeout

```bash
# Check PgBouncer
docker logs parallext-pgbouncer --tail 20
# Check active connections
docker exec parallext-postgres psql -U parallext -d parallext_engine \
  -c "SELECT count(*) FROM pg_stat_activity;"
```

### High memory

```bash
docker stats --no-stream
# Grafana limit: 256m | Loki limit: 384m | Redis: 512m
```

### Tunnel not routing

```bash
docker logs parallext-tunnel --tail 20
cat /opt/cloudflared/config.yml
# Verify hostnames match DNS records
```

---

## 11. Monitoring Checklist

### Daily
- [ ] Uptime Kuma: all green
- [ ] API health: 200 OK
- [ ] Dozzle: no ERROR floods

### Weekly
- [ ] Sentry: review new errors
- [ ] Bull Board: no stuck jobs
- [ ] DB size check: `SELECT pg_size_pretty(pg_database_size('parallext_engine'));`

### Monthly
- [ ] Full backup (DB + Redis + Media)
- [ ] Rotate API keys if needed
- [ ] Docker image cleanup: `docker system prune -af`
- [ ] Review Grafana dashboards

---

## Quick Reference

### Key Commands

```bash
# Status
docker compose -f infra/docker/docker-compose.prod.yml ps

# Logs
docker logs parallext-api --tail 100 -f

# Restart service
docker compose -f infra/docker/docker-compose.prod.yml restart api

# Database console
docker exec -it parallext-postgres psql -U parallext -d parallext_engine

# Redis console
docker exec -it parallext-redis redis-cli

# Reset database (WARNING: data loss)
bash infra/scripts/reset-db.sh

# Apply schema to new tenant
cat apps/api/prisma/tenant-schema.sql | sed "s/{{SCHEMA_NAME}}/tenant_slug/g" | \
  docker exec -i parallext-postgres psql -U parallext -d parallext_engine
```

### URLs

| URL | Service |
|-----|---------|
| `https://admin.parallly-chat.cloud` | Dashboard (login) |
| `https://api.parallly-chat.cloud/api/v1/health` | API health |
| `https://api.parallly-chat.cloud/api/v1/admin/queues?token=TOKEN` | Bull Board |
| `https://logs.parallly-chat.cloud` | Dozzle |
| `https://status.parallly-chat.cloud` | Uptime Kuma |
| `https://grafana.parallly-chat.cloud` | Grafana |
| `https://admin.parallly-chat.cloud/book/{slug}` | Public booking |
| `https://admin.parallly-chat.cloud/kb/{slug}` | Public knowledge base |

### Default Credentials

| Service | User | Password |
|---------|------|----------|
| Dashboard | admin@parallext.com | Parallext2026! |
| Grafana | admin | (set during setup) |
| PostgreSQL | parallext | (from .env DB_PASSWORD) |
| Bull Board | token param | (from .env BULL_BOARD_TOKEN) |
