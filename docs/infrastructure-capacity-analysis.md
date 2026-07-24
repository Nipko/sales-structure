# Infrastructure & Capacity Analysis — Parallext Engine

> Last updated: 2026-07-23
> Status: Production (KVM 2) — go-live con cobros reales en curso (MercadoPago CO + factura DIAN vía Factus)
>
> Plataforma: 5 apps (`api` NestJS :3000, `dashboard` Next.js :3001, `whatsapp` NestJS :3002, `landing` Next static :80, `mobile` React Native/Expo `@parallext/mobile`). El backend expone **83 módulos**; el dashboard, **139 páginas**. La app `mobile` no corre como contenedor (build/OTA vía Expo), no consume recursos del VPS.

---

## 1. Current Infrastructure (Hostinger KVM 2)

| Resource | Spec | Used (estimated) | Available |
|----------|------|-------------------|-----------|
| vCPU | 2 | ~60% peak | 40% headroom |
| RAM | 8 GB | ~3.5 GB | ~4.5 GB |
| SSD | 100 GB NVMe | ~15-20 GB | ~80 GB |
| Bandwidth | 8 TB/month | <100 GB/month | Plenty |

### RAM Distribution

| Service | RAM (MB) | Notes |
|---------|----------|-------|
| PostgreSQL 16 + pgvector | 400-600 | shared_buffers=256MB |
| Redis 7 | 200-512 | maxmemory 512MB, noeviction |
| API (NestJS + Prisma) | 300-500 | Main HTTP server |
| Worker (BullMQ) | 200-400 | Background job processing |
| Dashboard (Next.js) | 200-300 | SSR + static |
| WhatsApp service | 150-250 | Embedded Signup + webhooks |
| Landing (Nginx) | 30 | Static export |
| PgBouncer | 30 | Connection pooler |
| Observability stack | ~700 | Grafana(256)+Loki(384)+Promtail(128)+Dozzle(64)+Uptime(192) |
| Cloudflare Tunnel | 50 | Ingress |
| **TOTAL** | **~2,300-3,600** | |

### Docker Compose Services (15 total)

Fuente: `infra/docker/docker-compose.prod.yml`.

1. **postgres** — PostgreSQL 16 + pgvector, max_connections=200
2. **redis** — Redis 7, 512MB, appendonly, noeviction
3. **pgbouncer** — Transaction mode, pool=50, max_client=1000
4. **api** — NestJS API, port 3000, 8 DB connections
5. **worker** — BullMQ processors + cron jobs, 8 DB connections
6. **dashboard** — Next.js 16, port 3001
7. **whatsapp** — NestJS, port 3002, 4 DB connections
8. **landing** — Nginx static, port 80
9. **tunnel** — Cloudflare Tunnel (remote-managed)
10. **watchtower** — Auto-deploy on image push
11. **dozzle** — Real-time Docker logs (64MB)
12. **uptime-kuma** — Health monitoring (192MB)
13. **grafana** — Dashboards (256MB)
14. **loki** — Log aggregation (384MB)
15. **promtail** — Log shipper (128MB)

> El grupo de observabilidad (dozzle + uptime-kuma + grafana + loki + promtail) son 5 de esos 15 servicios. La app `mobile` (Expo) **no** es un contenedor.

### Docker Volumes (persistencia)

| Volumen (name) | Contenido | Respaldado por `backup.sh` |
|----------------|-----------|-----------------------------|
| `parallext-postgres-data` | PostgreSQL (public + schemas por tenant) | Sí (pg_dump por schema) |
| `parallext-redis-data` | Redis AOF/RDB (BullMQ, cache, heartbeats) | Sí (BGSAVE → `redis.rdb`) |
| `parallext-media-data` | Media subida por tenant (`/data/media`) | Sí (tar) |
| `parallext-fiscal-data` | Facturas fiscales DIAN (PDF/XML/QR de Factus) | Sí (`fiscal-invoices.tar.gz`) |
| `parallext-api-logs` / `parallext-worker-logs` | Logs de app (rotación json-file) | No (efímeros) |
| `parallext-uptime-kuma-data` / `parallext-grafana-data` / `parallext-loki-data` | Estado de observabilidad | No (reconstruibles) |

### BullMQ Queues (7)

| Queue | Concurrency | Rate Limit | Retries |
|-------|-------------|-----------|---------|
| outbound-messages | 5 | 20/s | 3 |
| broadcast-messages | 10 | 80/s | 3 |
| automation-jobs | 10 | 30/s | 3 |
| nurturing | 5 | 10/s | 3 |
| conversation-snooze | 1 | — | 5 |
| crm-sync | 10 | 20/s | 3 |
| crm-import | 2 | — | 1 |

### Cron Jobs (46)

46 decoradores `@Cron` en `apps/api/src` (worker). Peak concentration: 2-5 AM UTC (offboarding, reconciliation, metrics, cleanup, backup nocturno 2AM).
Most frequent: `*/2 * * * *` (SLA escalation), `*/5 * * * *` (agent availability, pipeline), `*/10 * * * *` (Ops Center system checks).

---

## 2. Capacity Estimates — KVM 2

### Tenants

| Metric | Conservative | Optimistic |
|--------|-------------|-----------|
| Registered tenants | 30-50 | 50-80 |
| Active tenants (daily) | 10-20 | 20-30 |
| Concurrent conversations | 20-50 | 50-100 |
| WebSocket agents online | 5-10 | 10-20 |
| Conversations/day | 500-1,000 | 1,000-2,000 |
| LLM calls/day | 1,500-3,000 | 3,000-6,000 |

### Bottlenecks (in order of impact)

1. **CPU (2 vCPU)** — Prompt assembly, BullMQ processing, cron jobs compete for CPU. Saturates at ~15-20 concurrent conversations with AI.
2. **PgBouncer pool (50)** — 20 used by apps, 30 headroom. Enough for ~30-40 tenants with simultaneous queries.
3. **RAM (8 GB)** — Stable at current load. Observability stack uses ~700MB that could be reclaimed.
4. **Redis (512 MB)** — Sufficient for ~200+ tenants (keys are small).
5. **Disk (100 GB)** — Media growth is the main risk. ~100MB/month/active tenant. El volumen fiscal (`parallext-fiscal-data`) crece lento (PDF/XML por factura DIAN).

### External Dependencies (no consumen CPU/RAM del VPS pero sí presupuesto)

| Dependencia | Uso | Modelo de costo | Notas |
|-------------|-----|-----------------|-------|
| **Twilio SMS** | Notificación **one-way** al cliente del tenant (SMS reseller) + alertas críticas al ops del super_admin | Por segmento (~160–240 COP/SMS en CO) | El **canal SMS conversacional fue descartado**; hoy SMS = créditos prepagos (1 crédito = 1 segmento). **Kill-switch maestro apagado por defecto** (`sms-credits.service`) hasta validar margen. Firma del webhook Twilio verificada |
| **MercadoPago** | Cobros de suscripción (mensual/anual) + compra de paquetes SMS (pago único) | % por transacción | Ciclo anual usa un preapproval_plan separado |
| **Factus (DIAN)** | Factura electrónica Colombia | Por documento / plan del proveedor tecnológico | Facturas guardadas en `parallext-fiscal-data`; gate collect-before-pay |
| **LLM providers** | Inferencia (5 proveedores, router con fallback) | Por token | 60-70% del costo operativo total (ver §4) |

### Impacto de capacidad — Multi-canal por tipo

Desde jun-jul 2026 un tenant puede conectar **N conexiones del mismo tipo** (p. ej. 2 números WhatsApp, 2 cuentas IG), gateado por `features.maxChannelAccounts` (default 1). Efectos en capacidad:

- **`channel_accounts`**: 1 fila por conexión (token por-cuenta en `channel_accounts.access_token`, sin migración global). Un tenant con varias conexiones multiplica filas, no schemas — impacto marginal.
- **Token-refresh**: el cron diario de refresco de tokens de Instagram (`instagram-token-refresh.service`, `@Cron('0 6 * * *')`) itera **por cuenta**, no por tenant. Con muchas conexiones IG el trabajo del refresco escala con el número de `channel_accounts`, no de tenants.
- **Un agente por conexión** (`agent_personas.channel_bindings`): más conexiones ⇒ más personas activas resueltas por turno, pero la resolución está cacheada y el costo por turno no cambia materialmente.

---

## 3. Scaling Projections

### Hostinger VPS Plans

| Plan | vCPU | RAM | SSD | Tenants (active) | Conv/day | Price |
|------|------|-----|-----|-----------------|----------|-------|
| **KVM 2 (current)** | 2 | 8 GB | 100 GB | 10-20 | 500-1,000 | ~$15/mo |
| **KVM 4** | 4 | 16 GB | 200 GB | 30-50 | 2,000-5,000 | ~$30/mo |
| **KVM 8** | 8 | 32 GB | 400 GB | 80-150 | 10,000-20,000 | ~$60/mo |
| **2× KVM 8** (split) | 16 total | 64 GB | 800 GB | 150-300 | 20,000-50,000 | ~$120/mo |

**Hostinger ceiling: ~300 tenants.** Beyond that, need managed services.

### Trigger Points for Upgrade

| Signal | Action |
|--------|--------|
| CPU avg >70% for 1 hour | Upgrade to KVM 4 |
| >15 active tenants | Upgrade to KVM 4 |
| >50 active tenants | Upgrade to KVM 8 |
| DB >50 GB | Separate DB to its own server or managed PostgreSQL |
| Media >30 GB | Migrate to Cloudflare R2 / S3 |
| >150 tenants | Full cloud migration (AWS/Hetzner) |

---

## 4. 1,000 Tenants Scenario

### Traffic Estimates

| Metric | Value |
|--------|-------|
| Conversations/day | ~30,000 (30 avg/tenant) |
| LLM calls/day | ~90,000 (3 AI turns/conv) |
| Outbound messages/day | ~150,000 |
| WebSocket connections | 200-500 concurrent |
| DB schemas | 1,000 |
| DB size | ~200 GB (200 MB avg/tenant) |
| Media storage | 100+ GB (growing) |
| Redis active keys | 50,000+ |

### LLM Cost Projection

| Model Tier | % Traffic | Monthly Cost |
|-----------|-----------|-------------|
| GPT-4o-mini (starter/pro) | 70% | ~$650 |
| GPT-4o (enterprise) | 25% | ~$4,600 |
| DeepSeek/Gemini Flash (fallback) | 5% | ~$60 |
| **Total LLM** | | **~$5,300/mo** |

LLM cost = 60-70% of total operating cost. Infrastructure is secondary.

### Required Infrastructure

| Component | Spec | Provider Option | Monthly Cost |
|-----------|------|----------------|-------------|
| App servers (API × 2-3) | 4 vCPU, 8 GB each | ECS Fargate / Fly.io | $200-400 |
| Worker instances (× 2) | 2 vCPU, 4 GB each | ECS Fargate / Fly.io | $100-200 |
| PostgreSQL (managed) | 4 vCPU, 32 GB, 500 GB | RDS / Supabase Pro | $200-350 |
| Redis (managed) | 4 GB | ElastiCache / Upstash | $100-150 |
| Object Storage (media) | 200 GB + CDN | S3+CloudFront / R2 | $30-50 |
| Load Balancer | HTTP + WebSocket | ALB / Cloudflare | $25-50 |
| Monitoring | Logs + metrics + alerts | CloudWatch / Grafana Cloud | $50-100 |
| **Total Infra** | | | **$700-1,300/mo** |
| **Total (Infra + LLM)** | | | **$6,000-6,600/mo** |

### Architecture Changes Needed

| Change | Why | When to Start |
|--------|-----|---------------|
| Schema-per-tenant → row-level tenancy | 1,000 schemas = slow migrations, huge catalog | ~200 tenants |
| Redis Cluster or managed | Single instance is SPOF, 512 MB insufficient | ~100 tenants |
| Multiple workers (horizontal) | 1 worker can't process 90K LLM calls/day | ~50 tenants |
| Object storage (S3/R2) | Local disk doesn't scale, no CDN | ~30 tenants |
| Container orchestration (ECS/K8s) | Auto-scaling, rolling deploys | ~200 tenants |
| WebSocket Redis adapter | socket.io single-node limit | ~100 tenants |
| Database read replicas | Analytics queries compete with writes | ~300 tenants |

---

## 5. Provider Comparison

### AWS (Full Managed)

| Service | For | Monthly |
|---------|-----|---------|
| RDS PostgreSQL (db.r6g.xlarge) | Database | ~$350 |
| ElastiCache Redis (cache.r6g.large) | Cache + queues | ~$150 |
| ECS Fargate (4 services) | App containers | ~$250 |
| S3 + CloudFront | Media + CDN | ~$30 |
| ALB | Load balancer | ~$25 |
| Route 53 + ACM | DNS + SSL | ~$5 |
| CloudWatch | Monitoring | ~$50 |
| **Total** | | **~$860/mo** |

Pros: Auto-scaling, managed backups, multi-AZ, no server management.
Cons: 10-15× more expensive than Hostinger for same capacity, vendor lock-in, complex.

### Hetzner Cloud (Best Value VPS)

| Service | For | Monthly |
|---------|-----|---------|
| CX41 (4 vCPU, 16 GB) × 2 | App + DB split | ~$30 |
| Managed PostgreSQL (4 vCPU) | Optional | ~$50 |
| Object Storage | Media (S3-compatible) | ~$5 |
| **Total** | | **~$35-85/mo** |

Pros: 2× cheaper than Hostinger, EU datacenter, good API.
Cons: No managed Redis, manual DB management, no LATAM datacenter.

### Hybrid (Recommended Path)

| Phase | Tenants | Infrastructure | Infra Cost | LLM Cost | Total |
|-------|---------|---------------|-----------|----------|-------|
| 1 - Launch | 1-20 | Hostinger KVM 2 | $15 | ~$100 | **$115** |
| 2 - Traction | 20-50 | Hostinger KVM 4 + R2 | $35 | ~$500 | **$535** |
| 3 - Growth | 50-150 | KVM 8 + Managed DB (Supabase/Neon) + R2 | $90 | ~$1,500 | **$1,590** |
| 4 - Scale | 150-500 | AWS ECS + RDS + ElastiCache + S3 | $500 | ~$3,500 | **$4,000** |
| 5 - Enterprise | 500-1000 | AWS auto-scale + RDS Multi-AZ + Redis Cluster | $900 | ~$5,300 | **$6,200** |

**Inflection point: ~150 tenants.** Before that, VPS + external managed DB is cheaper.

### Alternative Providers (More Economical than AWS)

| Provider | Best For | Phase |
|----------|---------|-------|
| **Cloudflare R2** | Object storage (10 GB free, no egress fees) | Phase 1+ |
| **Supabase** | Managed PostgreSQL (free to $25/mo) | Phase 2-3 |
| **Neon** | Serverless PostgreSQL (pay per compute) | Phase 2-3 |
| **Upstash** | Serverless Redis (pay per command) | Phase 2-3 |
| **Hetzner Cloud** | VPS (2× cheaper than AWS) | Phase 2-3 |
| **Fly.io** | Container hosting (global, simple) | Phase 3-4 |
| **Railway / Render** | PaaS (zero DevOps) | Phase 2-3 |

---

## 6. Production Hardening Checklist

### Backups — Status

Runbook completo: **`docs/backup-restore-runbook.md`**.

| Item | Status | Notes |
|------|--------|-------|
| DB backup script (pg_dump) | DONE | `infra/backup/backup.sh` — `pg_dump` corre **DENTRO** del contenedor `parallext-postgres` (auth por socket, versión coincidente); el host no necesita cliente psql |
| Per-schema dump | DONE | public + cada schema de tenant en formato `custom` |
| Automated cron | DONE | Crontab on VPS, 2AM |
| Media backup | DONE | tar del volumen `parallext-media-data` |
| Fiscal invoices backup | DONE | `fiscal-invoices.tar.gz` desde `parallext-fiscal-data` (facturas DIAN) |
| Redis RDB backup | DONE | `BGSAVE` + `docker cp` de `dump.rdb` |
| Offsite sync (R2/S3/B2) | DONE | rclone → Cloudflare R2 (config por env vars, sin `rclone.conf`); solo corre si los dumps de DB tuvieron éxito |
| Backup heartbeat (honesto) | DONE | Escribe `backup:last_success` en Redis **solo si el backup fue completo**; si algo falla, deja el heartbeat viejo para que el Ops Center alerte (nada de "verde" falso) |
| Restore script | DONE | `infra/backup/restore.sh` (restaura DB/media/fiscal/redis desde un archivo dado) |
| Restore drill (prueba real) | PENDING | El script existe; falta agendar un simulacro periódico de restauración |
| Retention: 7 daily + 4 weekly + 2 monthly | DONE | Cleanup en el propio backup script |

> **Incidente + fix (2026-07-23)**: los scripts de infra (`backup.sh`, `restore.sh`, etc.) estaban versionados sin bit de ejecución, así que en el VPS (que sigue a `origin` con `reset --hard`) quedaban sin `+x` y el cron fallaba silenciosamente. Fix: `git update-index --chmod=+x` para marcarlos **100755** en git (commit `fix(backup): marcar scripts de infra como ejecutables en git (100755)`). Regla: no hand-editar scripts de infra en el VPS — el deploy los sobrescribe.

### Deployment — Status

Deploy: push a `main` → GitHub Actions (`.github/workflows/deploy.yml`) → CI gate (typecheck 4 apps + lint + `prisma migrate deploy` en DB efímera) → build 5 imágenes → SSH al VPS → `git stash` + `reset --hard origin/main` → regenerar `.env` → backup pre-migración → migrar → rolling restart.

| Item | Status | Notes |
|------|--------|-------|
| Rolling update (per-service) | DONE | Worker first, then API, then frontend |
| Health check wait before next | DONE | 35s wait for API health |
| Webhook resilience during deploy | DONE | <5s gap vs 30s before |
| SSH key-only auth | DONE | El deploy usa clave (sin password); claves en `.gitignore`; VPS con `PasswordAuthentication no` |
| VPS sigue a origin (anti-drift) | DONE | `git stash push` + `reset --hard origin/<branch>` para que scripts drifteados no bloqueen el fast-forward |
| Pre-migration backup (rollback point) | DONE | `pg_dump` a `/backup/pre-deploy/predeploy_*.dump` antes de migrar (best-effort; el backup nocturno es el fallback) |
| Fail-fast en migrate/seed | DONE | Un `prisma migrate deploy`/seed fallido corta el deploy (no deja el stack a medias) |
| SSH-unreachable guard | DONE | Si el puerto SSH no responde en ~7 min (backup nocturno / fail2ban / red), el job falla sin aplicar nada |
| Rollback procedure | PENDING | Documentar pasos de rollback manual desde el dump pre-migración |

### Cleanup — Status

| Item | Status | Notes |
|------|--------|-------|
| Docker image prune | DONE | Weekly cron |
| Log rotation | DONE | json-file 50MB × 5 (built-in) |
| Loki retention | DONE | 7 days (auto) |
| Old backup cleanup | DONE | Retention policy in backup script |
| Orphaned media cleanup | DONE | MediaCleanupService: weekly cron + manual endpoint |

### Security — Status

| Item | Status | Notes |
|------|--------|-------|
| Firewall (ufw) | DONE | `infra/scripts/harden-vps.sh` — SSH only |
| Fail2ban | DONE | 3 failed SSH = 2h ban |
| OS auto-updates | DONE | unattended-upgrades (security patches daily) |
| Swap (2 GB) | DONE | Safety net for OOM, swappiness=10 |
| SSH hardening | DONE | Root restricted, max 3 auth tries |
| SSH key-only (no password) | DONE | `PasswordAuthentication no`; el deploy dejó de usar password; claves de deploy en `.gitignore` |
| Auth throttle por IP real | DONE | `auth-throttle.guard.ts` usa **`CF-Connecting-IP`** (detrás del túnel Cloudflare) para no rate-limitear a todos por la IP del túnel; cobertura ampliada a más endpoints sensibles |
| Twilio webhook signature | DONE | Firma `X-Twilio-Signature` verificada antes de aceptar callbacks (antes se aceptaba sin verificar) |
| Super_admin governance | DONE | `roles.ts` deny-by-default (cada página nueva necesita regla); **sin tenant implícito** en modo plataforma; `impersonate(superAdminId, tenantId, {reason, ticketId})` con motivo obligatorio + sesión emparejada (`impersonationSid`) + **actor real** en auditoría. Ver `docs/superadmin-governance.md` |
| Kernel tuning | DONE | file-max, TCP keepalive, somaxconn |
| Docker resource limits | DONE | API=768MB, Worker=512MB, Dashboard=512MB, WA=384MB |
| Graceful shutdown (API) | DONE | SIGTERM drain in main.ts, stop_grace_period=15s |
| Graceful shutdown (Worker) | DONE | SIGTERM handler, stop_grace_period=30s |
| Cloudflare WAF rules | PENDING | SQL injection, XSS protection (configure in CF dashboard) |
| Secrets rotation plan | PENDING | Quarterly JWT/encryption key rotation |

### Monitoring — Ops Center (super_admin)

El monitoreo vive en el módulo `health/` (**Centro de Operaciones**, super_admin), no en un stack externo. Núcleo: `platform-monitor.service` corre una batería de chequeos por cron, persiste hallazgos como incidentes vía `incident.service` (upsert con conteo/lastSeen, auto-resolución al despejar, backstop `sweepStale`), y notifica con cooldown por canal (email + Telegram + **SMS crítico** vía `sms-alert.service` / Twilio). `platform-storage.service` cubre disco + storage por-tenant + quota + history. Endpoints bajo `/health/*` (incidents, storage, llm-providers, alert-config, `POST /health/checks/run`).

**Chequeos automatizados (`platform-monitor.service`):**

| Check | Cron | Umbrales / señal |
|-------|------|------------------|
| Disk | `checkSystem` (`*/10 * * * *`) | warn 80% / crit 90% |
| RAM | `checkSystem` | warn 85% / crit 95% |
| Redis memory | `checkSystem` | warn 75% / crit 90% |
| DB connections | `checkSystem` | % de max_connections |
| PgBouncer pool (maxwait) | `checkSystem` | espera en cola de conexiones |
| Sentry error rate | `checkSystem` | ráfaga de eventos en ventana corta |
| LLM provider health | `checkSystem` | proveedores configurados pero no healthy (circuit breaker) |
| Queue depth + failed jobs | `checkQueues` (`2,7,12,…/5min`) | warn/crit por cola + jobs fallidos |
| SLA breaches | `checkSlaBreaches` | conversaciones fuera de SLA |
| Per-tenant storage / quota | `checkStorage` | quota de media por plan |
| Webhook / payment failures | `checkWebhookFailures`, `checkPaymentFailures` | fallos de webhook y de cobro |
| Channel token expiry | `checkChannelTokens` | tokens de canal por vencer |
| LLM budget | `checkLlmBudgets` | presupuesto de costo LLM por tenant/plan |
| Backup heartbeat | `checkBackupHeartbeat` | alerta si `backup:last_success` (Redis) tiene > `backupStaleHours` (**default 26h**) |

| Item complementario | Status | Notes |
|---------------------|--------|-------|
| Uptime Kuma | DONE | monitores externos (liveness) |
| Detailed health endpoint | DONE | GET /health/detailed (memory, latency, system info) |
| Version tracking | DONE | GIT_SHA in health response |
| SMS de alerta crítica | DONE | `sms-alert.service` (Twilio) — solo severidad `critical`, throttled por cooldown |
| Incident store + ack/resolve | DONE | `incident.service` + UI Ops Center (`/health/incidents`) |

---

## 7. Cost Optimization Tips

1. **LLM routing**: Default to cheaper models (GPT-4o-mini / Gemini Flash) for los planes bajos (emprendedor/starter/pro) y reservar los tiers caros a enterprise/custom. Acceso a tiers gateado por plan en el LLM Router. Planes vigentes: emprendedor USD $21, starter $49, pro $129, enterprise $349, custom (fuente `apps/api/prisma/seed-billing-plans.js`); ciclo mensual/anual (~15% desc), ver `docs/billing-annual-cycle.md`
2. **Embedding cache**: Cache frequent RAG queries in Redis (avoid redundant API calls)
3. **Prompt compression**: Reduce conversation history in prompts (4 messages in booking mode already helps)
4. **Media to R2**: Free 10 GB + no egress fees = $0 until significant scale
5. **Observability trimming**: If not actively using Grafana/Loki, disable them to reclaim ~700 MB RAM
6. **PgBouncer tuning**: Reduce `default_pool_size` from 50 to 30 if <20 tenants (saves PG memory)

---

### Docs relacionados

- **`docs/backup-restore-runbook.md`** — procedimiento de backup + restauración (pg_dump en contenedor, offsite R2, heartbeat).
- **`docs/superadmin-governance.md`** — modelo de acceso super_admin, deny-by-default e impersonación gobernada.
- **`docs/billing-annual-cycle.md`** — ciclo mensual/anual, billing-ops cross-tenant y sync a MercadoPago.

---

*This document should be updated when infrastructure changes are made or scaling thresholds are crossed. Última revisión contra código: 2026-07-23.*
