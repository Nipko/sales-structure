# Parallly Platform — Data Dictionary

> Version 5.0 | April 22, 2026
> Updates: Add this document whenever DB schema changes are made.

---

## Schema Architecture

```
parallext_engine (database)
├── public                    ← Global tables (Prisma-managed)
├── tenant_{slug}             ← Per-tenant tables (raw SQL, tenant-schema.sql)
├── tenant_{slug_2}           ← Another tenant
└── ...
```

**When tables are created:**
- **Public schema**: Prisma migrations (`npx prisma migrate deploy`)
- **Tenant schema**: On tenant signup (`auth.service.ts:createTenantSchema`) applies `tenant-schema.sql`
- **Existing tenants**: On deploy, `deploy.yml` applies `tenant-schema.sql` to all active tenants (IF NOT EXISTS)

---

## PUBLIC SCHEMA (7 tables — Prisma-managed)

| Table | Purpose | Created by |
|-------|---------|-----------|
| `tenants` | Client businesses | Prisma migration |
| `users` | Dashboard users (admins, agents) | Prisma migration |
| `channel_accounts` | Connected WhatsApp/IG/Messenger/Telegram accounts | Prisma migration |
| `audit_logs` | Security audit trail | Prisma migration |
| `whatsapp_onboardings` | Embedded Signup flow state | Prisma migration |
| `whatsapp_credentials` | Encrypted Meta tokens | Prisma migration |
| `platform_settings` | Global key-value config | setup-fresh.sh |

### tenants
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| name | TEXT | Company name |
| slug | TEXT UNIQUE | URL-safe identifier |
| industry | TEXT | Business sector |
| language | TEXT | Default language (es-CO, en-US, etc.) |
| schema_name | TEXT UNIQUE | PostgreSQL schema name (tenant_{slug}) |
| plan | TEXT | Subscription plan (starter/pro/enterprise/custom) |
| is_active | BOOLEAN | |
| settings | JSONB | Config overrides |

### users
| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| email | TEXT UNIQUE | |
| password | TEXT? | bcrypt 12 rounds (null for OAuth-only) |
| first_name, last_name | TEXT | |
| role | TEXT | super_admin, tenant_admin, tenant_supervisor, tenant_agent |
| tenant_id | UUID FK → tenants | |
| auth_provider | TEXT | email, google, microsoft |
| google_id, microsoft_id | TEXT | OAuth provider IDs |
| email_verified | BOOLEAN | |
| availability_status | TEXT | online, offline, away, dnd |
| max_capacity | INT | Max concurrent conversations |

---

## TENANT SCHEMA (65+ tables per tenant)

### Core Messaging

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `contacts` | External customers | external_id, channel_type, name, phone, email |
| `conversations` | Active chats | contact_id, channel_type, status, assigned_to, metadata (JSONB) |
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
| `deals` | Kanban board | contact_id, stage_id, value, assigned_agent_id |
| `pipeline_stages` | Configurable stages | name, sort_order, color |
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
| `campaigns` | Marketing campaigns | name, channel, schedule_json, status |
| `campaign_recipients` | Broadcast delivery tracking | campaign_id, contact_id, phone, status |

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
| `knowledge_documents` | RAG source docs | title, content, source_type |
| `knowledge_embeddings` | Vector chunks | document_id, chunk_text, embedding (vector) |
| `knowledge_resources` | Resource management | title, type, status |
| `knowledge_chunks` | Processed chunks | resource_id, content, embedding |
| `knowledge_approvals` | Content moderation | resource_id, reviewer_id, status |
| `faqs` | Frequently asked questions | question, answer, category, search_vector (tsvector) |
| `policies` | Company policies | type, title, content, version, is_active |

### Automation & Workflows

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `automation_rules` | Event-driven triggers | trigger_type, conditions_json, actions_json |
| `automation_executions` | Rule execution history | rule_id, status, result_json |
| `wait_jobs` | Scheduled actions | job_type, execute_at, payload |

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
| `legal_text_versions` | Legal document versions | type, content, version |
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

---

## Table Count Summary

| Schema | Tables | Managed by |
|--------|--------|-----------|
| Public | 7 | Prisma migrations |
| Per tenant | 65+ | tenant-schema.sql (CREATE IF NOT EXISTS) |
| **Total per tenant** | **72+** | |

---

## Update Log

| Date | Change | Tables affected |
|------|--------|----------------|
| 2026-04-18 | Added multi-agent system | agent_personas, agent_templates |
| 2026-04-20 | Added FAQs and policies | faqs, policies |
| 2026-04-20 | Extended companies table | companies (new columns) |
| 2026-04-20 | Added WhatsApp templates | whatsapp_templates |
| 2026-04-22 | Added missing tables | campaign_recipients, product_categories, stock_movements, order_items |
