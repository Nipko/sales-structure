---
name: Production Infrastructure
description: Server setup on Hostinger VPS with Docker containers, Cloudflare Tunnel, Watchtower auto-deploy
type: reference
originSessionId: d5aaa220-582d-4f39-aed4-0a7831ce3013
---
Production runs on Hostinger Ubuntu VPS with 10 Docker containers:

| Container | Image | Port | Status |
|-----------|-------|------|--------|
| parallext-api | ghcr.io/nipko/parallext-api:latest | 3000 (internal) | healthy |
| parallext-dashboard | ghcr.io/nipko/parallext-dashboard:latest | 3001 (internal) | up |
| parallext-whatsapp | ghcr.io/nipko/parallext-whatsapp:latest | 3002 (internal) | healthy |
| parallext-postgres | pgvector/pgvector:pg16 | 5432 (exposed) | healthy |
| parallext-redis | redis:7-alpine | 6379 (internal) | healthy |
| parallext-pgbouncer | edoburu/pgbouncer | 6432 (internal) | healthy |
| parallext-tunnel | cloudflare/cloudflared:latest | — | up |
| parallext-watchtower | containrrr/watchtower | 8080 (internal) | healthy |
| dozzle | amir20/dozzle | 9999 (internal) | up |
| uptime-kuma | louislam/uptime-kuma | 3003 (internal) | up |

**Observability stack (bound to 127.0.0.1, exposed via Cloudflare Tunnel):**
- Dozzle (port 9999) — real-time Docker log viewer → logs.parallly-chat.cloud
- Uptime Kuma (port 3003) — endpoint monitoring with email+Telegram alerts → status.parallly-chat.cloud
- Grafana (port 3004) + Loki (port 3100) + Promtail — log aggregation and dashboards → grafana.parallly-chat.cloud

**PgBouncer** (added April 13, 2026): Transaction pooling mode, 500 app connections mapped to 25 PostgreSQL connections. Apps connect via port 6432; migrations use DIRECT_DATABASE_URL to bypass PgBouncer.

No ports exposed to internet. All traffic via Cloudflare Tunnel (Zero Trust). Watchtower polls GHCR every 5min and auto-deploys new images.

**Deploy flow:** `git push main` → GitHub Actions builds 3 images → pushes to GHCR → Watchtower detects new tag → pulls and restarts container.

**Why:** Understanding the prod topology helps avoid suggesting changes that would break the deploy pipeline or require manual server access.

**How to apply:** Never expose ports directly. DB migrations run in the deploy workflow. Config changes need to update GitHub Secrets (not .env on server).
