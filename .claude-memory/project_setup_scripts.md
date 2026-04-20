---
name: Setup scripts status and usage
description: Three infra scripts for VPS deployment — setup-vps.sh (initial), setup-fresh.sh (DB from zero), reset-db.sh (destructive reset)
type: project
---

**Scripts location:** `infra/scripts/`

| Script | Purpose | When to use |
|--------|---------|-------------|
| `setup-vps.sh` | First-time VPS setup: generates .env, starts infra, calls setup-fresh.sh | Only on brand new VPS |
| `setup-fresh.sh` | Creates DB from scratch: public tables, extensions, admin user, tenant schemas | Fresh install or after DB wipe |
| `reset-db.sh` | Drops and recreates everything (DESTRUCTIVE) | Dev/testing only |

**Why:** Updated 2026-04-06 — old setup-vps.sh had wrong ENCRYPTION_KEY size (16 bytes instead of 32), Chatwoot references (removed from project), and missing env vars (INTERNAL_API_KEY, META_* vars, SYSTEM_USER_ID).

**How to apply:** When deploying to a new VPS:
1. Clone repo to `/opt/parallext-engine`
2. Run `bash infra/scripts/setup-vps.sh`
3. Edit `.env` to add Meta credentials, AI API keys, Cloudflare tunnel token
4. `docker compose -f infra/docker/docker-compose.prod.yml restart`

The GitHub Actions deploy workflow handles subsequent deploys automatically (push to main → build images → SSH deploy → apply migrations → restart).
