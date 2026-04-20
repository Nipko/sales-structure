---
name: Scaling & i18n Plan
description: Roadmap for internationalization, geo-targeting, and infrastructure scaling — analyzed April 2026
type: project
originSessionId: d5aaa220-582d-4f39-aed4-0a7831ce3013
---
Three-pillar evolution plan for Parallly to handle thousands of users globally.

**Why:** Platform needs to expand beyond Colombia to LATAM (MX, BR, AR, CL, PE) and eventually globally, handling thousands of concurrent tenants.

**How to apply:** Use this as the implementation roadmap. Each phase has clear triggers (tenant count thresholds).

## Pillar 1 — i18n (Internationalization)

- Library: `next-intl` for Next.js App Router
- Two-layer model: tenant.language (chatbot/emails) + users.locale (dashboard UI)
- Translation files: `messages/es.json`, `messages/en.json`, `messages/pt.json`
- Translation management: Crowdin ($200/mo) or SimpleLocalize ($25/mo)
- AI chatbot: LLMs auto-detect language, add system prompt instruction
- RTL support: CSS logical properties + `dir="rtl"` on html element
- Currency/dates: `Intl` API with tenant.currency and user.locale

## Pillar 2 — Geo-targeting & Country Presence

- Landing subdirectories: `/mx/`, `/co/`, `/br/` with hreflang tags
- PPP pricing tiers: MX/CL 100%, CO/PE 70-80%, AR/BO 40-60%, BR 80%
- Country detection: Cloudflare `CF-IPCountry` header (free)
- Compliance: data_region field on tenants, per-country legal requirements
- Payment: Stripe/Dodo as merchant-of-record for tax handling
- Launch order: MX → CO → CL → PE → AR → BR (BR requires LGPD)

## Pillar 3 — Infrastructure Scaling

### Phase 1: Now (<100 tenants) ✅ DONE (April 13, 2026)
- [x] PgBouncer in transaction mode (Docker container) — pgbouncer:6432, 500→25 connections
- [x] Sentry free tier for error tracking — @sentry/nestjs + profiling
- [x] BullMQ workers in separate Docker containers — already separate, added Sentry
- [x] Cloudflare caching + rate limiting — helmet CORP, multi-origin CORS, documented WAF rules

### Phase 2: 100+ tenants
- [x] next-intl with es/en/pt/fr — DONE (April 17-18, 4 languages, 0 Spanish remaining)
- [ ] Cloudflare R2 for file storage (replace local /data/media volume)
- [ ] Prometheus + Grafana monitoring
- [ ] PPP pricing per country

### Phase 3: 500+ tenants
- [ ] Second PostgreSQL instance + tenant routing layer
- [ ] Socket.IO Redis adapter for multi-replica
- [ ] 2-3 API replicas behind Nginx load balancer
- [ ] Partition messages table by created_at (monthly)

### Phase 4: 2,000+ tenants
- [ ] Hybrid schema: new tenants → shared-schema with RLS, enterprise → dedicated schema
- [ ] Redis Sentinel (1 master + 1 replica + 3 sentinels)
- [ ] Kubernetes migration (if needed)
- [ ] Data residency per region (EU, LATAM)
