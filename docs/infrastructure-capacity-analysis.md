# Infrastructure & Capacity Analysis — Parallext Engine

> Last updated: 2026-05-14
> Status: Pre-production (KVM 2)

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

### Docker Compose Services (16 total)

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

### Cron Jobs (~35+)

Peak concentration: 2-5 AM UTC (offboarding, reconciliation, metrics, cleanup).
Most frequent: `*/2 * * * *` (SLA escalation), `*/5 * * * *` (agent availability, pipeline).

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
5. **Disk (100 GB)** — Media growth is the main risk. ~100MB/month/active tenant.

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

| Item | Status | Notes |
|------|--------|-------|
| DB backup script (pg_dump) | DONE | `infra/backup/backup.sh` |
| Automated cron | DONE | Crontab on VPS |
| Media backup | DONE | Included in backup script |
| Redis RDB backup | DONE | Copies redis dump.rdb |
| Offsite sync (R2/Backblaze) | DONE | rclone cron after backup |
| Restore test | PENDING | Monthly manual test needed |
| Retention: 7 daily + 4 weekly + 2 monthly | DONE | Cleanup script handles |

### Deployment — Status

| Item | Status | Notes |
|------|--------|-------|
| Rolling update (per-service) | DONE | Worker first, then API, then frontend |
| Health check wait before next | DONE | 35s wait for API health |
| Webhook resilience during deploy | DONE | <5s gap vs 30s before |
| Rollback procedure | PENDING | Document manual rollback steps |

### Cleanup — Status

| Item | Status | Notes |
|------|--------|-------|
| Docker image prune | DONE | Weekly cron |
| Log rotation | DONE | json-file 50MB × 5 (built-in) |
| Loki retention | DONE | 7 days (auto) |
| Old backup cleanup | DONE | Retention policy in backup script |
| Orphaned media cleanup | PENDING | Needs custom script (DB vs disk scan) |

### Security — Status

| Item | Status | Notes |
|------|--------|-------|
| Firewall (ufw) | DONE | `infra/scripts/harden-vps.sh` — SSH only |
| Fail2ban | DONE | 3 failed SSH = 2h ban |
| OS auto-updates | DONE | unattended-upgrades (security patches daily) |
| Swap (2 GB) | DONE | Safety net for OOM, swappiness=10 |
| SSH hardening | DONE | Root restricted, max 3 auth tries |
| Kernel tuning | DONE | file-max, TCP keepalive, somaxconn |
| Docker resource limits | DONE | API=768MB, Worker=512MB, Dashboard=512MB, WA=384MB |
| Graceful shutdown (API) | DONE | SIGTERM drain in main.ts, stop_grace_period=15s |
| Graceful shutdown (Worker) | DONE | SIGTERM handler, stop_grace_period=30s |
| Cloudflare WAF rules | PENDING | SQL injection, XSS protection (configure in CF dashboard) |
| Secrets rotation plan | PENDING | Quarterly JWT/encryption key rotation |

### Monitoring — Status

| Item | Status | Notes |
|------|--------|-------|
| Uptime Kuma | DONE | 7 monitors configured |
| Detailed health endpoint | DONE | GET /health/detailed (memory, latency, system info) |
| Version tracking | DONE | GIT_SHA in health response |
| Disk usage alerts | PENDING | Alert at 80% (cleanup.sh warns) |
| RAM usage alerts | PENDING | Alert at 85% |
| Queue depth alerts | PENDING | BullMQ backlog monitoring |
| Error rate alerts (Sentry) | DONE | >5 events in 10 min |

---

## 7. Cost Optimization Tips

1. **LLM routing**: Default to GPT-4o-mini for starter/pro plans (90% cheaper than GPT-4o)
2. **Embedding cache**: Cache frequent RAG queries in Redis (avoid redundant API calls)
3. **Prompt compression**: Reduce conversation history in prompts (4 messages in booking mode already helps)
4. **Media to R2**: Free 10 GB + no egress fees = $0 until significant scale
5. **Observability trimming**: If not actively using Grafana/Loki, disable them to reclaim ~700 MB RAM
6. **PgBouncer tuning**: Reduce `default_pool_size` from 50 to 30 if <20 tenants (saves PG memory)

---

*This document should be updated when infrastructure changes are made or scaling thresholds are crossed.*
