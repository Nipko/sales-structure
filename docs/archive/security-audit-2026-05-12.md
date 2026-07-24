> ⚠️ **ARCHIVADO (2026-07-23) — documento histórico.** Auditoria point-in-time; los findings vigentes viven en docs/security-specification.md. No refleja el estado actual del código; se conserva como referencia.

# Parallext Engine — Security Audit Report

**Date:** 2026-05-12
**Scope:** Full platform (API, Dashboard, WhatsApp, Landing, Infrastructure)
**Methodology:** Static code analysis across 7 security domains

---

## Executive Summary

| Severity | Count | Fixed | Remaining |
|----------|-------|-------|-----------|
| **CRITICAL** | 11 | 11 | 0 |
| **HIGH** | 16 | 15 | 1 (H-14 Docker non-root) |
| **MEDIUM** | 22 | 18 | 4 (M-05, M-07, M-08, M-17) |
| **LOW** | 14 | 7 | 7 (L-02, L-04, L-06, L-07, L-08, L-10, L-12) |
| **INFO** | 12 | — | No action needed |

**Total findings: 75 | Fixed: 51 | Remaining: 12**

Remediation completed in 3 phases (commits 1c85fe6, 08bdc4e, 4a3223e). All CRITICAL issues resolved. Remaining items are low-risk design decisions (M-05 super admin session skip, M-07 signup returns tokens before verification, M-08 unsigned SAML requests) or broad refactoring tasks (M-17 queryRawUnsafe audit across 13 files).

---

## CRITICAL Findings (11)

### C-01. SQL Injection — Column Name Injection in CRM Leads (Create)
- **File:** `apps/api/src/modules/crm/repositories/leads.repository.ts:229-235`
- **Domain:** SQL Injection
- **Description:** `createLead()` takes `Object.keys(record)` from unvalidated `@Body() body: Record<string, any>` and interpolates them directly as SQL column names: `INSERT INTO leads (${fields.join(', ')})`. No whitelist validation.
- **Impact:** Authenticated tenant user can inject arbitrary SQL via crafted JSON keys (e.g., `"id) VALUES ('x'); DROP TABLE leads; --"`). Full SQL control within tenant schema.
- **Recommendation:** Add `ALLOWED_FIELDS` whitelist, matching the pattern already used in `contacts.service.ts:125`.

### C-02. SQL Injection — Column Name Injection in CRM Leads (Update)
- **File:** `apps/api/src/modules/crm/repositories/leads.repository.ts:252-261`
- **Domain:** SQL Injection
- **Description:** `updateLead()` same pattern: `SET ${setClause}` where `setClause` is built from `Object.keys(record)` without whitelist.
- **Impact:** Same as C-01.
- **Recommendation:** Same whitelist approach.

### C-03. SQL Injection — Column Name Injection in CRM Opportunities (Create)
- **File:** `apps/api/src/modules/crm/repositories/opportunities.repository.ts:63-70`
- **Domain:** SQL Injection
- **Description:** `createOpportunity()` identical pattern — `Object.keys(record)` interpolated as column names.
- **Impact:** SQL injection within tenant schema.
- **Recommendation:** Add `ALLOWED_FIELDS` whitelist for opportunities table columns.

### C-04. SQL Injection — Column Name Injection in CRM Opportunities (Update)
- **File:** `apps/api/src/modules/crm/repositories/opportunities.repository.ts:80-89`
- **Domain:** SQL Injection
- **Description:** `updateOpportunity()` identical pattern.
- **Impact:** Same as C-03.
- **Recommendation:** Same whitelist approach.

### C-05. Missing TenantGuard — Billing Controller (Cross-Tenant Subscription Manipulation)
- **File:** `apps/api/src/modules/billing/billing.controller.ts:162-318`
- **Domain:** Access Control / Multi-tenancy
- **Description:** Billing controller uses only `AuthGuard('jwt')` without `RolesGuard` or `TenantGuard`. Any authenticated user can manipulate any tenant's subscription by changing `:tenantId` in the URL.
- **Impact:** Tenant A's agent can cancel Tenant B's subscription, upgrade plans, change payment methods, view invoices.
- **Recommendation:** Add `@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)` at class level. Add `@Roles('tenant_admin', 'super_admin')` on mutation endpoints.

### C-06. Missing Auth — Knowledge Legacy Endpoints (Unauthenticated Data Exfiltration)
- **File:** `apps/api/src/modules/knowledge/knowledge.controller.ts:90-134`
- **Domain:** Access Control
- **Description:** `GET resources/:tenantId` and `GET search/:tenantId` have zero auth guards. Write endpoints have `AuthGuard+RolesGuard` but no `TenantGuard`.
- **Impact:** Unauthenticated enumeration/exfiltration of all knowledge base content for any tenant. Authenticated cross-tenant create/delete.
- **Recommendation:** Add full guard chain. Separate public KB endpoints (already exist under `/public/`) from admin endpoints.

### C-07. No Rate Limiting — Authentication Endpoints
- **File:** `apps/api/src/modules/auth/auth.controller.ts:98-397`
- **Domain:** Authentication
- **Description:** Login, signup, forgot-password, reset-password, verify-email, and 2FA endpoints have zero rate limiting. No IP-based throttle, no account lockout, no CAPTCHA.
- **Impact:** Unlimited brute-force on credentials. 6-digit OTP (1M combinations) can be brute-forced within the 10-minute window. Credential stuffing attacks.
- **Recommendation:** Redis-based rate limiting: login 5/email/15min with progressive lockout, signup 3/IP/hour, forgot-password 3/email/hour, 2FA verify 5 attempts then invalidate token.

### C-08. Redis — No Password Protection in Production
- **File:** `infra/docker/docker-compose.prod.yml:209`
- **Domain:** Infrastructure
- **Description:** Production Redis has no `--requirepass`. `redis.config.ts` never reads `REDIS_PASSWORD`. Any Docker network process can access all Redis data.
- **Impact:** Full access to sessions, BullMQ jobs (containing customer messages/PII), booking state, conversation locks. Ability to inject jobs and bypass rate limiting.
- **Recommendation:** Add `--requirepass ${REDIS_PASSWORD}` to Redis, update `redis.config.ts` and `RedisService` constructor to pass password, update BullMQ connection configs.

### C-09. Hardcoded JWT Secret Fallbacks
- **File:** `apps/api/src/config/auth.config.ts:4-5`, `apps/api/src/modules/auth/jwt.strategy.ts:17`
- **Domain:** Secrets
- **Description:** JWT secrets fall back to `'change-me-in-production'` and `'change-me-refresh'` when env vars are unset. If `.env` regeneration fails during deploy, the system runs with publicly known signing secrets.
- **Impact:** Complete authentication bypass — any attacker can forge JWTs for any user including super_admin.
- **Recommendation:** Remove fallback defaults entirely. Throw startup error if `JWT_SECRET`/`JWT_REFRESH_SECRET` not set.

### C-10. Encryption Graceful Degradation to Base64
- **File:** `apps/api/src/modules/whatsapp/services/whatsapp-crypto.service.ts:10-13`
- **Domain:** Secrets / Crypto
- **Description:** When `ENCRYPTION_KEY` is missing, crypto service silently falls back to plain base64 encoding (not encryption). Labeled "DEV ONLY" but no production guard.
- **Impact:** If `ENCRYPTION_KEY` is unset in production, all Meta/WhatsApp/Instagram tokens are stored as trivially-reversible base64 in the database.
- **Recommendation:** Throw exception when `ENCRYPTION_KEY` is missing and `NODE_ENV=production`.

### C-11. Hardcoded Bull Board Token
- **File:** `apps/api/src/main.ts:90`
- **Domain:** Secrets
- **Description:** `process.env.BULL_BOARD_TOKEN || 'parallly-queues-2026'` — hardcoded fallback visible in source code.
- **Impact:** Unauthorized access to BullMQ queue dashboard exposing job payloads, queue stats, retry/remove capabilities.
- **Recommendation:** Remove fallback. Require env var or refuse to serve.

---

## HIGH Findings (16)

### H-01. SQL Injection — Filter Rule Field Names in Segments
- **File:** `apps/api/src/modules/crm/services/segments/segments.service.ts:204-207`
- **Description:** `buildFilterSQL()` interpolates `rule.field` directly as SQL column names without validation.
- **Recommendation:** Validate against whitelist of known lead columns.

### H-02. SQL Injection — Filter Rule Field Names in Import/Export
- **File:** `apps/api/src/modules/crm/services/import-export/import-export.service.ts:212-215`
- **Description:** Duplicate `buildFilterSQL()` with same vulnerability.
- **Recommendation:** Extract to shared utility with field validation.

### H-03. Missing TenantGuard — Offboarding Controller
- **File:** `apps/api/src/modules/offboarding/offboarding.controller.ts:10`
- **Description:** `voluntaryCancel` endpoint accessible to `tenant_admin` without TenantGuard. Cross-tenant cancellation possible.
- **Recommendation:** Add `TenantGuard` at class level.

### H-04. Missing TenantGuard — Coupons Controller
- **File:** `apps/api/src/modules/billing/coupons.controller.ts:105-157`
- **Description:** Validate/redeem endpoints take tenantId from URL without TenantGuard.
- **Recommendation:** Add `TenantGuard`.

### H-05. Missing TenantGuard — Settings Controller
- **File:** `apps/api/src/modules/settings/settings.controller.ts:8-10`
- **Description:** Platform settings (including LLM API keys) accessible to `tenant_admin` without tenant validation.
- **Recommendation:** Restrict to `super_admin` only, or add TenantGuard.

### H-06. TOTP Secret Stored in Plaintext
- **File:** `apps/api/src/modules/auth/auth.service.ts:938`
- **Description:** `two_factor_secret` stored as plaintext String in users table despite existing `ENCRYPTION_KEY` infrastructure.
- **Impact:** Database compromise exposes all TOTP secrets, enabling 2FA bypass for all users.
- **Recommendation:** Encrypt with AES-256-GCM using existing `ENCRYPTION_KEY`.

### H-07. SAML Assertion Typo — wantAssertionsSigned
- **File:** `apps/api/src/modules/auth/saml.strategy.ts:34`
- **Description:** Property `wantAssertionsSigned` should be `wantAssertsSigned`. Library ignores the misspelled option, potentially skipping assertion signature validation.
- **Recommendation:** Fix typo. Test with tampered assertion.

### H-08. SAML — No Assertion Replay Protection
- **File:** `apps/api/src/modules/auth/saml.strategy.ts:28-36`
- **Description:** No `validateInResponseTo` or `cacheProvider` configured. Captured SAML responses replayable within validity window.
- **Recommendation:** Add `validateInResponseTo: 'always'` with Redis-based cache provider.

### H-09. Meta Webhook — Fail-Open When Secret Missing
- **File:** `apps/api/src/modules/channels/meta-signature.util.ts:13`
- **Description:** `if (!appSecret) return true` — accepts all webhooks when `META_APP_SECRET` is unset.
- **Impact:** Forged webhook payloads can inject fake messages into any tenant's conversations.
- **Recommendation:** Change to `return false`. Single-character fix.

### H-10. Telegram Webhook — No Signature Validation
- **File:** `apps/api/src/modules/channels/channels.controller.ts:324-417`
- **Description:** Telegram webhooks accepted without validating `X-Telegram-Bot-Api-Secret-Token`.
- **Recommendation:** Generate `secret_token` in `connectTelegram`, validate on every webhook.

### H-11. Instagram OAuth — Missing CSRF State Parameter Validation
- **File:** `apps/dashboard/src/app/admin/channels/instagram/callback/page.tsx:14-48`
- **Description:** State parameter generated but never validated in callback. Classic OAuth CSRF.
- **Recommendation:** Compare `params.get("state")` against `localStorage.getItem("ig_oauth_state")`.

### H-12. KB Article — Stored XSS via dangerouslySetInnerHTML
- **File:** `apps/dashboard/src/app/kb/[tenantSlug]/[slug]/page.tsx:50-61, 145-148`
- **Description:** Public KB renders `article.content` via `dangerouslySetInnerHTML` without sanitization. No DOMPurify.
- **Impact:** Tenant admin can inject JS in public pages, attacking all visitors.
- **Recommendation:** Install `dompurify`, sanitize before rendering.

### H-13. iCal Feed Import — SSRF (No URL Validation)
- **File:** `apps/api/src/modules/vacation-rental/ical-sync.service.ts:30-48`
- **Description:** `axios.get(url)` with no validation of target. Tenant admin can set URL to internal IPs (169.254.169.254, localhost, etc.).
- **Recommendation:** Validate URL, reject private/reserved IP ranges, restrict to HTTPS.

### H-14. Docker — All Containers Run as Root
- **File:** `infra/docker/Dockerfile.api`, `Dockerfile.worker`, `Dockerfile.whatsapp`, `Dockerfile.dashboard`
- **Recommendation:** Add non-root user in production stage.

### H-15. Missing HSTS and CSP Headers
- **File:** `infra/nginx/nginx.conf:34-37`
- **Description:** No `Strict-Transport-Security` or `Content-Security-Policy` headers.
- **Recommendation:** Add HSTS with `max-age=31536000; includeSubDomains`. Add CSP (start report-only).

### H-16. CI/CD — JWT_SECRET and INTERNAL_JWT_SECRET Share Same Value
- **File:** `.github/workflows/deploy.yml:316-317`
- **Description:** Both use `PROD_INTERNAL_JWT_SECRET`. Violates key separation principle.
- **Recommendation:** Create separate `PROD_JWT_SECRET` GitHub Secret.

---

## MEDIUM Findings (22)

| ID | Title | File | Domain |
|----|-------|------|--------|
| M-01 | No rate limiting on password reset | auth.controller.ts:383-389 | Auth |
| M-02 | No rate limiting on email verification | auth.controller.ts:365-369 | Auth |
| M-03 | 2FA disable skips password for OAuth accounts | auth.service.ts:976-1000 | Auth |
| M-04 | Admin password reset doesn't invalidate sessions | auth.service.ts:516-532 | Auth |
| M-05 | Super admin sessions skip session validation | auth.service.ts:174,555 | Auth |
| M-06 | Impersonation tokens can be refreshed (extend beyond 1h) | auth.service.ts:1403-1462 | Auth |
| M-07 | Signup returns tokens before email verification | auth.service.ts:283-353 | Auth |
| M-08 | SAML AuthnRequests not signed | saml.controller.ts:128 | Auth |
| M-09 | SAML JIT doesn't validate email domain vs config | saml.service.ts:132-192 | Auth |
| M-10 | Internal API key comparison not timing-safe | internal-auth.guard.ts:48 | Crypto |
| M-11 | Ecommerce/ChannelManager credentials stored unencrypted | ecommerce.service.ts:47-52 | Crypto |
| M-12 | Decrypted tokens cached in Redis without encryption | channel-token.service.ts:80,136 | Crypto |
| M-13 | Swagger/OpenAPI docs exposed in production | main.ts:69-87 | API |
| M-14 | Channel account upsert without tenant scope (hijacking) | channel-management.controller.ts:154 | Multi-tenancy |
| M-15 | SMS/Twilio webhook — no signature validation | channels.controller.ts:278-320 | Webhooks |
| M-16 | Schema name missing validation in create/dropTenantSchema | prisma.service.ts:54-66,161 | SQL |
| M-17 | Direct $queryRawUnsafe bypasses executeInTenantSchema (13 files) | Various | SQL |
| M-18 | PostgreSQL port exposed to host in production | docker-compose.prod.yml:196 | Infra |
| M-19 | PgBouncer uses fallback default password | docker-compose.prod.yml:48 | Infra |
| M-20 | Webhook URL validation missing (SSRF) | webhooks.service.ts:82-97 | SSRF |
| M-21 | Copilot widget XSS via LLM responses | CopilotWidget.tsx:113-118 | XSS |
| M-22 | Widget domain validation uses weak substring match | widget-public.controller.ts:67-71 | API |

---

## LOW Findings (14)

| ID | Title | File |
|----|-------|------|
| L-01 | OTP codes use Math.random() instead of crypto.randomInt() | auth.service.ts:794,835,1029 |
| L-02 | Password reset code not invalidated after failed attempts | auth.service.ts:852-881 |
| L-03 | Google OAuth Client ID hardcoded as default | google-auth.service.ts:5-6 |
| L-04 | Users endpoint missing role-based restriction | auth.controller.ts:270-306 |
| L-05 | Verification code comparisons not timing-safe | auth.service.ts:816,857 |
| L-06 | 2FA email send endpoint no rate limit | auth.controller.ts:485-492 |
| L-07 | Register endpoint accepts unvalidated role string | auth.controller.ts:119-139 |
| L-08 | Session TTL (6min) relies on client ping | auth.service.ts:34 |
| L-09 | Missing ::uuid casts on some UUID comparisons | scheduled-reports.service.ts:23 |
| L-10 | PII (phone, email) logged in plaintext | whatsapp-webhook.service.ts:217, intake.service.ts:207 |
| L-11 | .env.example contains realistic credential patterns | .env.example:18-20 |
| L-12 | Telegram fallback tenant resolution (wrong tenant) | channels.controller.ts:361-367 |
| L-13 | No .dockerignore file exists | (missing) |
| L-14 | Anthropic SDK pinned to "latest" (supply chain risk) | apps/api/package.json:24 |

---

## INFO / Positive Findings (12)

| ID | Finding | Assessment |
|----|---------|------------|
| I-01 | JWT uses HS256 (acceptable for single-service) | Secure |
| I-02 | Token expiration (15min access, 8h/14d refresh) | Reasonable |
| I-03 | Refresh token rotation with replay detection | Well-implemented |
| I-04 | Bcrypt 12 rounds for all passwords | Adequate |
| I-05 | Backup codes hashed with bcrypt | Secure |
| I-06 | 2FA verification has 5-attempt limit with 15min lockout | Good |
| I-07 | AES-256-GCM encryption (when key is set) — random IV, auth tag | Correct implementation |
| I-08 | MercadoPago webhook — timing-safe HMAC, idempotency, fail-closed | Reference implementation |
| I-09 | .gitignore excludes .env files | Correct |
| I-10 | executeInTenantSchema — SET LOCAL + schema regex validation | Well-implemented |
| I-11 | WebSocket gateway — JWT-scoped, tenant from token not client | Secure |
| I-12 | File upload — sharp converts to webp, path.basename, mime whitelist | Secure |

---

## Remediation Priority Matrix

### Phase 1 — Before Production Launch (CRITICAL + blocking HIGH)

| Priority | ID | Fix | Effort |
|----------|-----|-----|--------|
| 1 | C-01..04 | Add ALLOWED_FIELDS whitelists to CRM repositories | 1h |
| 2 | C-05 | Add TenantGuard to BillingController | 5min |
| 3 | C-06 | Add auth guards to knowledge legacy endpoints | 15min |
| 4 | C-07 | Add rate limiting to auth endpoints (Redis-based) | 2h |
| 5 | C-08 | Add Redis password (--requirepass + app config) | 30min |
| 6 | C-09 | Remove hardcoded JWT fallbacks, add startup validation | 15min |
| 7 | C-10 | Add production guard on crypto base64 fallback | 10min |
| 8 | C-11 | Remove hardcoded Bull Board token fallback | 5min |
| 9 | H-09 | Meta webhook: change `return true` to `return false` | 1min |
| 10 | H-03..05 | Add TenantGuard to Offboarding, Coupons, Settings | 15min |
| 11 | H-16 | Separate JWT_SECRET from INTERNAL_JWT_SECRET in deploy.yml | 10min |

### Phase 2 — First Week Post-Launch

| Priority | ID | Fix | Effort |
|----------|-----|-----|--------|
| 12 | H-01..02 | Whitelist fields in buildFilterSQL (segments + import) | 1h |
| 13 | H-06 | Encrypt TOTP secrets at rest | 1h |
| 14 | H-10 | Add Telegram webhook secret_token validation | 30min |
| 15 | H-11 | Validate Instagram OAuth state parameter in callback | 15min |
| 16 | H-12 | Install DOMPurify, sanitize KB article rendering | 30min |
| 17 | H-13 | Add URL validation for iCal feed import (block private IPs) | 1h |
| 18 | H-14 | Add non-root user to all Dockerfiles | 30min |
| 19 | H-15 | Add HSTS + CSP headers to nginx | 30min |
| 20 | M-13 | Disable Swagger in production or add auth gate | 10min |

### Phase 3 — Within 2 Weeks

All remaining MEDIUM findings (M-01 through M-22).

### Phase 4 — Maintenance Cycle

All LOW findings (L-01 through L-14).

---

## Methodology Notes

This audit was performed via static code analysis across 7 parallel security domains:
1. Authentication & Sessions
2. SQL Injection & Database Security
3. API Security, Input Validation & Access Control
4. Secrets Management, Encryption & Data Protection
5. Multi-Tenancy Isolation
6. Infrastructure & Configuration Security
7. OAuth Flows, XSS, SSRF & Frontend Security

Each domain agent analyzed all relevant source files, configuration files, and deployment scripts. Findings were deduplicated and cross-referenced across domains.

**Out of scope:** Dynamic testing (penetration testing), dependency CVE scanning (beyond manual review), production environment configuration verification, third-party service configurations (Meta App Dashboard, MercadoPago dashboard, Google Cloud Console).
