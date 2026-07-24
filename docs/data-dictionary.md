# Parallly Platform — Data Dictionary

> Version 8.0 | July 23, 2026
> Updates: Add this document whenever DB schema changes are made.

---

## Schema Architecture

```
parallext_engine (database)
├── public                    ← Global tables (33 modelos Prisma + tablas lazy raw SQL)
├── tenant_{slug}             ← Per-tenant tables (raw SQL, tenant-schema.sql)
├── tenant_{slug_2}           ← Another tenant
└── ...
```

**When tables are created:**
- **Public schema (Prisma)**: Prisma migrations (`npx prisma migrate deploy`) — 33 modelos en `schema.prisma`
- **Public schema (lazy raw SQL)**: Algunos servicios crean su tabla `public.<t>` en runtime con `CREATE TABLE IF NOT EXISTS` (no están en Prisma). Ver "Tablas public por servicio" abajo
- **Tenant schema**: On tenant signup (`auth.service.ts:createTenantSchema`) applies `tenant-schema.sql`
- **Existing tenants**: On deploy, `deploy.yml` applies `tenant-schema.sql` to all active tenants (IF NOT EXISTS)

---

## PUBLIC SCHEMA (33 modelos Prisma + tablas lazy por servicio)

Global (cross-tenant) tables. 33 modelos gestionados por Prisma migrations (`apps/api/prisma/schema.prisma`), agrupados por dominio. `platform_settings` está modelado en Prisma pero se lee/escribe vía raw SQL. Aparte, algunos servicios crean tablas `public.*` en runtime vía raw SQL (ver la última subsección).

### Core

| Table | Model | Purpose |
|-------|-------|---------|
| `tenants` | Tenant | Client businesses (+ columnas denormalizadas de billing/onboarding) |
| `users` | User | Dashboard users (admins, agents); 2FA, skill_tags |
| `platform_settings` | PlatformSetting | Global key/value config (modelado en Prisma; accedido vía raw SQL) |
| `channel_accounts` | ChannelAccount | Cuentas conectadas WA/IG/Messenger/Telegram; token por-cuenta (multi-cuenta) |
| `audit_logs` | AuditLog | Security/impersonation audit trail (actor real bajo impersonación) |
| `tenant_invitations` | TenantInvitation | Invitación de usuarios por email (tokens de un solo uso, 14 días) |
| `trusted_devices` | TrustedDevice | Bypass de 2FA en navegadores recordados (30 días, hash SHA-256) |

### WhatsApp / Onboarding

| Table | Model | Purpose |
|-------|-------|---------|
| `whatsapp_onboardings` | WhatsappOnboarding | Estado del Embedded Signup v4 (new/existing/coexistence) |
| `whatsapp_credentials` | WhatsappCredential | Tokens Meta encriptados (system_user_token, app_secret) |

### API pública

| Table | Model | Purpose |
|-------|-------|---------|
| `api_keys` | ApiKey | API keys del tenant (hash SHA-256, scopes, rate limit) |
| `automation_templates` | AutomationTemplate | Catálogo de automatizaciones prearmadas (marketplace) |

### Billing

| Table | Model | Purpose |
|-------|-------|---------|
| `billing_plans` | BillingPlan | Catálogo de planes (5: emprendedor/starter/pro/enterprise/custom); precio USD cents + overrides locales + ciclo anual |
| `billing_subscriptions` | BillingSubscription | Una suscripción activa por tenant (incl. downgrade programado pendingPlan) |
| `billing_events` | BillingEvent | Log append-only + idempotencia de webhooks — UNIQUE(provider, provider_event_id) |
| `billing_payments` | BillingPayment | Historial de cargos (amountCents, currency, provider ref) |
| `billing_coupons` | BillingCoupon | Códigos promo (percent_off / amount_off / free_months) |
| `billing_coupon_redemptions` | BillingCouponRedemption | Una fila por tenant×cupón (anti-reuso) |

### Fiscal (DIAN Colombia)

| Table | Model | Purpose |
|-------|-------|---------|
| `fiscal_invoices` | FiscalInvoice | Ciclo de factura electrónica DIAN (CUFE/CUDE, XML/PDF/QR), desacoplado del PSP; provider Factus. Snapshot inmutable del adquiriente |

### SMS Credits (reseller monetizado)

| Table | Model | Purpose |
|-------|-------|---------|
| `sms_credit_balances` | SmsCreditBalance | Balance prepago por tenant (1 crédito = 1 segmento Twilio) |
| `sms_credit_ledger` | SmsCreditLedger | Movimientos append-only (+purchase / -consumption / ±adjustment / +refund) |
| `sms_package_orders` | SmsPackageOrder | Compra de paquete de créditos (pago único MercadoPago) |

### Financials & Ops Center

| Table | Model | Purpose |
|-------|-------|---------|
| `financial_snapshots` | FinancialSnapshot | Métricas SaaS mensuales de plataforma (MRR movements, costos) |
| `tenant_financial_snapshots` | TenantFinancialSnapshot | P&L mensual por tenant (revenue, LLM cost, mensajes) |
| `storage_snapshots` | StorageSnapshot | Snapshot diario de disco (db_bytes/media_bytes, proyección de llenado) |
| `platform_incidents` | PlatformIncident | Alertas persistentes del Ops Center (disk/storage/backup) |
| `infra_costs` | InfraCost | Costos de infraestructura por mes/categoría |
| `exchange_rates` | ExchangeRate | Tipos de cambio (rateDate, from/to currency) |

### Growth (Feature Requests)

| Table | Model | Purpose |
|-------|-------|---------|
| `feature_requests` | FeatureRequest | Board global de features (embedding vector para dedupe) |
| `feature_request_votes` | FeatureRequestVote | Un voto por usuario×request |
| `feature_request_comments` | FeatureRequestComment | Comentarios (isAdminReply) |
| `feature_request_subscribers` | FeatureRequestSubscriber | Suscriptores a cambios de estado |

### Integraciones / Plataforma

| Table | Model | Purpose |
|-------|-------|---------|
| `crm_connections` | CrmConnection | OAuth a CRM externo por (tenant, provider); tokens encriptados AES-256-GCM |
| `system_updates` | SystemUpdate | Changelogs/anuncios de plataforma (multi-idioma JSONB) |

### Tablas public por servicio (raw SQL, NO Prisma)

Creadas lazy por el servicio dueño con `CREATE TABLE IF NOT EXISTS public.<t>` (cache Redis 24h). NO existen en `schema.prisma` ni en migraciones — no marcar como "Prisma migration":

| Table | Creado por | Purpose |
|-------|-----------|---------|
| `email_channel_configs` | `channels/email/email-channel.service.ts` | Config del canal Email por tenant (UNIQUE(tenant_id)) |
| `webhook_subscriptions` | `public-api/webhook-subscription.service.ts` | Suscripciones de webhooks salientes (event singular, secret HMAC) |
| `widget_configs` | `widget/widget.service.ts` | Config del Web Chat Widget (widget_id, colores, dominios permitidos) |
| `widget_triggers` | `widget/widget.service.ts` + `widget/widget-triggers.service.ts` | Reglas de disparo proactivo del widget |
| `widget_sessions` | `widget/widget.service.ts` | Sesiones de visitante del widget (visitor_id, conversation_id) |

### tenants
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| name | TEXT | Company name |
| slug | TEXT UNIQUE | URL-safe identifier |
| industry | TEXT | Business sector |
| language | TEXT | Default language (default es-CO) |
| schema_name | TEXT UNIQUE | PostgreSQL schema name (tenant_{slug}) |
| plan | TEXT | Subscription plan (emprendedor/starter/pro/enterprise/custom), default starter |
| is_active | BOOLEAN | |
| settings | JSONB | Config overrides |
| billing_email, billing_country | TEXT? | Denormalized billing hot-path fields |
| subscription_status | TEXT? | pending_auth\|trialing\|active\|past_due\|cancelled\|expired |
| trial_ends_at, current_period_end | TIMESTAMPTZ? | Denormalized from billing_subscriptions para el rate limiter |
| payment_provider | TEXT? | mercadopago\|stripe\|mock |
| payment_provider_customer_id | TEXT? | Provider customer ID |
| onboarding_completed_at | TIMESTAMPTZ? | Onboarding funnel (cohort /admin/funnel) |
| first_channel_connected_at | TIMESTAMPTZ? | TTFV: primer canal conectado |
| first_message_at | TIMESTAMPTZ? | Primer mensaje |
| signup_source | TEXT? | landing_page\|api\|partner\|... |
| created_at, updated_at | TIMESTAMPTZ | |

> Fuente de verdad de la suscripción: `billing_subscriptions` (relación 1:1). Las columnas de billing en `tenants` son un cache denormalizado que `BillingService` mantiene sincronizado para decidir acceso sin JOIN por request.

### users
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| email | TEXT UNIQUE | |
| password | TEXT? | bcrypt 12 rounds (null for OAuth-only) |
| first_name, last_name | TEXT | |
| role | TEXT | super_admin, tenant_admin, tenant_supervisor, tenant_agent (default tenant_agent) |
| tenant_id | UUID? FK → tenants | null para super_admin (sin tenant implícito, modo plataforma) |
| is_active | BOOLEAN | |
| auth_provider | TEXT | email, google, microsoft (default email) |
| google_id, microsoft_id | TEXT? | OAuth provider IDs |
| picture | TEXT? | Avatar URL |
| email_verified | BOOLEAN | |
| email_verify_code, email_verify_expires | TEXT?/TIMESTAMPTZ? | Verificación de email |
| two_factor_enabled | BOOLEAN | 2FA activo |
| two_factor_secret | TEXT? | Secreto TOTP (encriptado) |
| two_factor_method | TEXT? | totp \| email \| sms |
| backup_codes | TEXT[] | Códigos de respaldo 2FA |
| onboarding_completed | BOOLEAN | |
| phone, job_title | TEXT? | |
| availability_status | TEXT | online, offline, away, dnd (default offline) |
| max_capacity | INT | Max concurrent conversations (default 5) |
| skill_tags | TEXT[] | Etiquetas para skill-based routing del handoff |
| last_active_at, last_login_at | TIMESTAMPTZ? | |

### api_keys
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| tenant_id | UUID FK → tenants | Owning tenant |
| key_prefix | VARCHAR(12) | Visible prefix for identification (e.g. `pk_live_abc`) |
| key_hash | VARCHAR(64) | SHA-256 hash of the full key (key never stored in plain text) |
| name | TEXT | Human-friendly label |
| scopes | TEXT[] | Permitted actions (e.g. `contacts:read`, `messages:send`) |
| rate_limit_rpm | INT | Requests-per-minute cap |
| last_used_at | TIMESTAMPTZ | Last successful request |
| expires_at | TIMESTAMPTZ | Optional expiration |
| is_active | BOOLEAN | Soft revocation flag |
| created_by | UUID | User who created the key |
| created_at | TIMESTAMPTZ | |
| revoked_at | TIMESTAMPTZ | Timestamp of explicit revocation |

### automation_templates
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| name | TEXT | Template name shown in marketplace |
| description | TEXT | Summary of what the template does |
| category | TEXT | Grouping (e.g. `lead_nurturing`, `support`, `onboarding`) |
| industry | TEXT | Target industry (null = universal) |
| icon | TEXT | Icon identifier for UI |
| trigger_config | JSONB | Trigger definition (event type, conditions) |
| actions_config | JSONB | Ordered list of actions to execute |
| variables | JSONB | Configurable placeholders the tenant must fill |
| is_active | BOOLEAN | Published to marketplace |
| popularity_count | INT | Installation counter |
| created_at | TIMESTAMPTZ | |

### email_channel_configs
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| tenant_id | UUID FK → tenants UNIQUE | One config per tenant |
| provider | TEXT | Email provider (smtp, ses, sendgrid, mailgun) |
| from_email | TEXT | Sender address |
| from_name | TEXT | Sender display name |
| reply_to | TEXT | Reply-to address |
| inbound_type | TEXT | Inbound processing method (webhook, imap_poll) |
| provider_config | JSONB | Encrypted provider credentials (AES-256-GCM) |
| is_active | BOOLEAN | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### webhook_subscriptions
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| tenant_id | UUID FK → tenants | Owning tenant |
| target_url | TEXT | Destination URL for event delivery |
| events | TEXT[] | Subscribed event types (e.g. `message.received`, `deal.stage_changed`) |
| secret | TEXT | HMAC signing secret for payload verification |
| is_active | BOOLEAN | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### widget_triggers
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| widget_config_id | UUID | Parent widget configuration |
| name | TEXT | Trigger name |
| conditions | JSONB | Matching rules (page URL, time on page, scroll %, etc.) |
| condition_operator | VARCHAR(3) | `AND` or `OR` — how conditions combine |
| action_type | TEXT | What happens when triggered (open_chat, send_message, show_banner) |
| action_config | JSONB | Action-specific payload |
| frequency_minutes | INT | Minimum interval between re-fires for same visitor |
| is_active | BOOLEAN | |
| priority | INT | Evaluation order (lower = first) |
| created_at | TIMESTAMPTZ | |

---

## TENANT SCHEMA (84+ tables per tenant)

### Core Messaging

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `contacts` | External customers | external_id, channel_type, name, phone, email |
| `conversations` | Active chats | contact_id, channel_type, status, assigned_to, metadata (JSONB), was_handed_off, handoff_at, ai_message_count, resolution_type |
| `messages` | Message history | conversation_id, direction, content_text, content_type, llm_model_used |
| `conversation_memory` | Long-term summaries | conversation_id, summary_text |

### AI Agent System

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `persona_config` | Legacy single-agent config (deprecated) | config_yaml, config_json, version, is_active |
| `agent_personas` | Multi-agent configs | name, config_json, channels[], schedule_mode, is_default |
| `agent_templates` | Reusable agent templates | name, config_json, is_builtin |

### CRM & Sales

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `leads` | Prospects | contact_id, stage, score, campaign_id |
| `opportunities` | Deals | lead_id, stage, value, sla_deadline |
| `deals` | Kanban board | contact_id, stage_id, value, assigned_agent_id, pipeline_id (FK pipelines) |
| `pipeline_stages` | Configurable stages | name, sort_order, color, pipeline_id (FK pipelines) |
| `pipelines` | Named sales pipelines | name, description, is_default, is_active |
| `stage_history` | Stage change audit | deal_id, from_stage, to_stage |
| `companies` | Extended business info | name, industry, about, phone, email, website, social_links |
| `contact_segments` | Saved contact filters | name, filter_rules (JSONB) |
| `custom_attribute_definitions` | Dynamic fields | entity_type, key, label, data_type |
| `tags`, `lead_tags` | Contact categorization | name, color |

### Products & Commerce

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `products` | Catalog items | name, price, currency, stock, is_available |
| `product_categories` | Category grouping | name, color, sort_order |
| `stock_movements` | Inventory audit trail | product_id, type (in/out/adjustment), quantity |
| `orders` | Customer orders | contact_id, total_amount, status, payment_status |
| `order_items` | Order line items | order_id, product_id, quantity, unit_price |
| `commercial_offers` | Discounts/promos | name, discount_type, valid_from, valid_to |
| `courses` | Course/service catalog | name, price, duration, modality |
| `campaigns` | Marketing campaigns | name, channel, schedule_json, status, is_ab_test, ab_test_config (JSONB) |
| `campaign_recipients` | Broadcast delivery tracking | campaign_id, contact_id, phone, status, variant_id (FK campaign_variants) |
| `campaign_variants` | A/B test content variations | campaign_id (FK campaigns), name, content (JSONB), percentage, is_winner |

### Appointments & Calendar

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `services` | Bookable offerings | name, duration_minutes, price, is_active, is_public |
| `availability_slots` | Staff weekly schedule | user_id, day_of_week, start_time, end_time |
| `appointments` | Booked sessions | contact_id, service_id, start_at, end_at, status |
| `blocked_dates` | Staff unavailability | user_id, blocked_date, reason |
| `calendar_integrations` | Google/Outlook sync | user_id, provider, encrypted_refresh_token |

### Knowledge & Content

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `knowledge_documents` | RAG source docs | title, content, source_type, satisfaction_score (DECIMAL 3,2), feedback_count |
| `knowledge_embeddings` | Vector chunks | document_id, chunk_text, embedding (vector) |
| `knowledge_resources` | Resource management | title, type, status |
| `knowledge_chunks` | Processed chunks | resource_id, content, embedding |
| `knowledge_approvals` | Content moderation | resource_id, reviewer_id, status |
| `faqs` | Frequently asked questions | question, answer, category, search_vector (tsvector) |
| `policies` | Company policies | type, title, content, version, is_active |
| `kb_feedback` | User feedback on KB answers | conversation_id, message_id, document_id (FK knowledge_documents), query, rating (1-5), is_false_positive, comment, created_by |

### Automation & Workflows

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `automation_rules` | Event-driven triggers | trigger_type, conditions_json, actions_json |
| `automation_executions` | Rule execution history | rule_id, status, result_json |
| `wait_jobs` | Scheduled actions | job_type, execute_at, payload |
| `drip_sequences` | Multi-step nurture sequences | name, trigger_event, trigger_conditions (JSONB), steps (JSONB), is_active |
| `drip_enrollments` | Contact enrollment in drip sequences | sequence_id (FK drip_sequences), contact_id, conversation_id, current_step, status, stop_reason. UNIQUE(sequence_id, contact_id) WHERE status='active' |
| `automation_secrets` | Encrypted tenant secrets for automations | name, encrypted_value (AES-256-GCM) |

### Analytics & Monitoring

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `analytics_events` | Event stream | event_type, conversation_id, data (JSONB) |
| `daily_metrics` | Pre-aggregated stats | metric_date, dimension_type, metrics_json |
| `csat_surveys` | Customer satisfaction | conversation_id, rating (1-5), feedback |
| `alert_rules` | Threshold alert config | metric, operator, threshold, cooldown |
| `alert_history` | Alert trigger history | rule_id, triggered_at, value |
| `scheduled_reports` | Report delivery config | frequency, recipients, template |
| `dashboard_preferences` | Widget config per user | user_id, preferences_json |

### Compliance & Identity

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `consent_records` | GDPR consent tracking | contact_id, consent_type, granted |
| `opt_out_records` | Opt-out registry | phone, channel, trigger_message |
| `legal_text_versions` | Legal document versions (multi-channel, multi-agent, typed) | name, description, type, channel, channels[], agent_ids[], version, text, active, updated_at |
| `customer_profiles` | Unified identity | contact_id, merged_data |
| `contact_identities` | Cross-channel linking | contact_id, channel_type, external_id |
| `merge_suggestions` | Identity merge proposals | contact_a_id, contact_b_id, match_type |

### Agent Console

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `conversation_assignments` | Agent handoff tracking | agent_id, conversation_id, first_response_at |
| `internal_notes` | Agent notes | agent_id, conversation_id, content |
| `canned_responses` | Reusable responses | title, content, category |
| `macros` | Action sequences | name, actions_json |
| `pre_chat_forms` | Intake fields | name, fields_json, is_active |

### WhatsApp Specific

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `whatsapp_channels` | WABA connection details | phone_number_id, waba_id, display_name |
| `whatsapp_templates` | HSM templates | name, language, components, approval_status |
| `whatsapp_message_logs` | Message audit | message_id, direction, status |
| `whatsapp_webhook_events` | Webhook audit | event_type, payload |

### Landing & Forms

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `landing_pages` | Page builder | slug, sections_json, status |
| `form_definitions` | Form builder | name, fields_json |
| `form_submissions` | Form responses | form_id, data_json |
| `intake_sources` | Lead attribution | name, type, webhook_url |

### Email

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `email_templates` | Email templates | name, subject, body_html, variables |
| `broadcast_templates` | Mass messaging templates | name, channel, content |
| `email_threads` | Email conversation threading | conversation_id, subject, message_id_header, in_reply_to, references_header, cc (TEXT[]), bcc (TEXT[]) |

### E-commerce Integration

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `ecommerce_products` | Synced product catalog from external providers | external_id, provider, title, price_cents, currency, variants (JSONB), status. UNIQUE(external_id, provider) |
| `abandoned_carts` | Cart recovery tracking | external_id, provider, contact_id, items (JSONB), total_cents, checkout_url, status, recovery_sent_at, recovered_at |

### Channel Manager (Vacation Rental)

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `cm_listings` | Synced property listings from channel managers | external_id, provider, name, address, max_guests, base_price_cents, property_id, last_synced_at. UNIQUE(external_id, provider) |
| `cm_reservations` | Guest reservations from channel managers | listing_id (FK cm_listings), external_id, provider, guest_name, check_in, check_out, total_cents, status, source, contact_id. UNIQUE(external_id, provider) |
| `cm_availability` | Per-date availability and pricing | listing_id (FK cm_listings), date, is_available, price_cents, min_nights. UNIQUE(listing_id, date) |

### Staff Management

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `staff_members` | Service staff / practitioners | name, email, phone, role, specialties (TEXT[]), active |
| `staff_schedules` | Weekly recurring availability per staff | staff_id (FK staff_members), day_of_week (0-6), start_time, end_time |
| `staff_service_links` | Staff-to-service assignment | staff_id (FK staff_members), service_id. UNIQUE(staff_id, service_id) |
| `staff_breaks` | One-off staff unavailability blocks | staff_id (FK staff_members), date, start_time, end_time, reason |

### Automotive / Vehicles

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `vehicles` | Vehicle inventory | make, model, year, vin, mileage, fuel_type, transmission, price_cents, features (TEXT[]), photos (TEXT[]), status (default 'available'), sold_at, sold_price_cents |
| `vehicle_inquiries` | Customer interest in a vehicle | vehicle_id (FK vehicles), contact_id, message, status (default 'new') |
| `test_drives` | Scheduled test drives | vehicle_id (FK vehicles), contact_id, scheduled_date, scheduled_time, status (default 'scheduled'), notes |

---

## Table Count Summary

| Schema | Tables | Managed by |
|--------|--------|-----------|
| Public | 12 | Prisma migrations |
| Per tenant | 84+ | tenant-schema.sql (CREATE IF NOT EXISTS) |
| **Total per tenant** | **96+** | |

---

## Update Log

| Date | Change | Tables affected |
|------|--------|----------------|
| 2026-04-18 | Added multi-agent system | agent_personas, agent_templates |
| 2026-04-20 | Added FAQs and policies | faqs, policies |
| 2026-04-20 | Extended companies table | companies (new columns) |
| 2026-04-20 | Added WhatsApp templates | whatsapp_templates |
| 2026-04-22 | Added missing tables | campaign_recipients, product_categories, stock_movements, order_items |
| 2026-05-10 | Added e-commerce integration | ecommerce_products, abandoned_carts |
| 2026-05-10 | Added channel manager (vacation rental) | cm_listings, cm_reservations, cm_availability |
| 2026-05-10 | Added staff management | staff_members, staff_schedules, staff_service_links, staff_breaks |
| 2026-05-10 | Added automotive / vehicles | vehicles, vehicle_inquiries, test_drives |
| 2026-05-27 | Added public API keys & webhook subscriptions | api_keys, webhook_subscriptions |
| 2026-05-27 | Added automation templates marketplace | automation_templates |
| 2026-05-27 | Added email channel (provider config + threading) | email_channel_configs, email_threads |
| 2026-05-27 | Added proactive widget triggers | widget_triggers |
| 2026-05-27 | Added drip sequences & automation secrets | drip_sequences, drip_enrollments, automation_secrets |
| 2026-05-27 | Added KB feedback loop | kb_feedback, knowledge_documents (new columns) |
| 2026-05-27 | Added multi-pipeline support | pipelines, pipeline_stages (new FK), deals (new FK) |
| 2026-05-27 | Added A/B test campaigns | campaign_variants, campaigns (new columns), campaign_recipients (new FK) |
| 2026-05-27 | Added handoff & resolution tracking | conversations (new columns: was_handed_off, handoff_at, ai_message_count, resolution_type) |
