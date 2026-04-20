---
name: Big Refactor April 20 2026 — 3-Layer Prompt + 5-Tier Knowledge + Onboarding + All Tools
description: COMPLETED (both batches) — prompt contamination removed, full knowledge infrastructure, Test Agent, onboarding integration, all 9 tool categories, commercial offers module. 44 tasks done.
type: project
---
## Status: 44 / 44 TASKS COMPLETE

Two-batch refactor delivered in a single session:

**Batch 1 (tasks 1–31):** 3-layer prompt architecture + 5 knowledge tiers + Test Agent
**Batch 2 (tasks 32–44):** Onboarding integration + 3 extra tools (orders/offers/crm) + Offers CRUD module & UI + required_fields UI

## 3-Layer Prompt Architecture
- Layer 1 (Contract): hardcoded in PromptAssemblerService
- Layer 2 (Persona): PersonaService.buildSystemPrompt → XML-tagged <persona>
- Layer 3 (Turn): <turn> with language, now, business, contact, booking_state, available_services, retrieved_knowledge

## Knowledge Tiers
1. **Business Identity** — extended `companies` + BusinessInfoService + `/admin/settings/business-info`. **Now auto-populated from onboarding.**
2. **Catalog / Inventory** — tools: search_products, get_product, check_stock. Queries shared `products` table.
3. **FAQs** — new `faqs` table with TSVECTOR + `/admin/knowledge/faqs` + tool search_faqs
4. **Policies** — new `policies` table versioned + `/admin/settings/policies` + tool get_policy
5. **Knowledge Base (RAG++)** — hybrid search + rerank + topK/threshold respected + tool search_knowledge_base + UI sliders

## Extra tools (batch 2)
- **list_customer_orders** — agent answers "what's my order status?" (tools/crm-tools.ts)
- **list_active_offers** — agent mentions live promos (tools/catalog-tools.ts)
- **get_customer_context** — CRM lookup: lead score, tags, stage, opportunities (tools/crm-tools.ts)

## Offers Module (new)
- Backend: OffersService + controller + module over existing `commercial_offers` table
- UI: `/admin/catalog/offers` full CRUD with live/inactive badges, datetime pickers, JSON conditions editor

## Onboarding integration
- `auth.service.ts:completeOnboarding` now calls BusinessInfoService.upsertPrimary after tenant schema creation
- Onboarding form extended with phone, businessEmail, about fields (Step 1)
- Agent starts with `<turn.business>` populated on day one — no empty state

## Required Fields UI
- BehaviorSection now has subsection for `requiredFields`: contexts with field+question pairs
- Edit/add/delete contexts and fields inline
- Still ignored when appointments tool is enabled (existing logic in persona.service.ts)

## ToolsConfig (final shape)
```typescript
{
  appointments?: { enabled, canBook?, canCancel? }
  catalog?:      { enabled, canCheckStock? }
  faqs?:         { enabled }
  policies?:     { enabled }
  knowledge?:    { enabled }
  orders?:       { enabled }    // NEW batch 2
  offers?:       { enabled }    // NEW batch 2
  crm?:          { enabled }    // NEW batch 2
}
```

## Pipeline registration
conversations.service.ts + agent-test.service.ts both register tools based on config flags.
Appointment tools are registered separately by the booking engine when its flag is on.

## Files created (total across both batches)
Backend:
- conversations/prompt-assembler.service.ts
- conversations/language-detector.service.ts
- conversations/agent-test.service.ts + controller
- conversations/tools/catalog-tools.ts (includes OFFER_TOOL)
- conversations/tools/knowledge-tools.ts (FAQ_TOOL + POLICY_TOOL + KB_TOOL)
- conversations/tools/crm-tools.ts (ORDER_TOOL + CUSTOMER_CONTEXT_TOOL)
- business-info/{service,controller,module}.ts
- faqs/{service,controller,module}.ts
- policies/{service,controller,module}.ts
- offers/{service,controller,module}.ts

Frontend:
- admin/settings/business-info/page.tsx
- admin/settings/policies/page.tsx
- admin/knowledge/faqs/page.tsx
- admin/catalog/offers/page.tsx
- admin/agent/[agentId]/test/page.tsx

## Files modified (key ones)
- packages/shared/src/index.ts — ToolsConfig extended with orders/offers/crm
- apps/api/prisma/tenant-schema.sql — extended companies + new faqs/policies tables
- apps/api/src/modules/persona/persona.service.ts — buildSystemPrompt Layer 2 only
- apps/api/src/modules/conversations/conversations.service.ts — 6 contaminations removed + all tools registered
- apps/api/src/modules/conversations/ai-tool-executor.service.ts — 11 executors total
- apps/api/src/modules/conversations/agent-test.service.ts — all 11 tools registered
- apps/api/src/modules/knowledge/knowledge.service.ts — hybrid search + rerank + config respected
- apps/api/src/modules/auth/auth.service.ts + auth.module.ts — BusinessInfoService injected, upsert on onboarding
- apps/dashboard/src/app/onboarding/page.tsx — phone, email, about added to Step 1
- apps/dashboard/src/app/admin/agent/_components/CapabilitiesSection.tsx — 7 tool toggles + RAG sliders
- apps/dashboard/src/app/admin/agent/_components/BehaviorSection.tsx — requiredFields subsection
- apps/dashboard/src/app/admin/agent/_types.ts — tools extended
- apps/dashboard/src/lib/api.ts — +13 methods (business-info, faqs, policies, offers, test)
- apps/dashboard/messages/{es,en,pt,fr}.json — onboarding extensions + 7 new agent.capabilities keys + catalog.offers + requiredFields
- apps/api/src/app.module.ts — 4 new modules registered

## Remaining / skipped
- Multi-embedding models (hardcoded OpenAI text-embedding-3-small) — low priority
- FAQ versioning (policies got it, FAQs didn't) — low priority
- UI unification between catalog.products and inventory.products — same DB table, no urgency

## Verification
- All 4 message JSON files parse OK
- tsc clean on ALL touched backend files (pre-existing Prisma-generate errors are unrelated)
- tsc clean on ALL touched dashboard files (pre-existing missing npm deps are unrelated)

## Navigation reorganization (batch 3)

Auditoría post-implementación reveló que las páginas nuevas estaban "huérfanas" (inaccesibles sin conocer la URL). También detectamos inconsistencias preexistentes. Aplicado cleanup completo:

**Sidebar reorganizado (AppSidebar.tsx):**
- Operations ahora incluye: Automation, Campaigns, Appointments, **Catalog** (nuevo), **Inventory** (estaba huérfano), **Orders** (estaba huérfano), Channels
- Analytics: Alerts **removido** (estaba inconsistente — apuntaba a /admin/settings/alerts)
- Config sin cambios

**Settings landing reorganizado:**
- Sección Company: añadidos cards **Business Info** + **Policies** (antes huérfanos)
- Nueva sección **Monitoring**: card Alerts (movido desde sidebar Analytics)

**Knowledge landing:**
- Tab nav ahora tiene 3 items: Library / FAQs / Search
- Tab FAQs navega a /admin/knowledge/faqs
- FAQs page tiene el mismo sub-nav para consistencia de vuelta
- Labels movidos a i18n (knowledge.tabs.*)

**Catalog landing (nuevo):**
- /admin/catalog con CardGrid: Courses, Campaigns, Offers
- Patrón idéntico al Settings landing para consistencia visual

**i18n (4 idiomas):**
- nav.items.{catalog, inventory, orders} añadidos
- settings.{businessInfoCard, policiesCard, alertsCard, monitoring} añadidos
- knowledge.tabs.{library, faqs, search} añadidos
- catalog.hub.{title, subtitle, courses, campaigns, offers} añadidos

**Resultado:** cero páginas huérfanas. Todas las 5 páginas nuevas del refactor + 2 páginas preexistentes (Inventory, Orders) ahora son descubribles desde la navegación. Test Agent se descubre desde el agent editor (correcto desde siempre).

## Ready to deploy
`git add -A && git commit` then push to main. GitHub Actions handles build + deploy. Then Test Agent at `/admin/agent/[id]/test` to verify end-to-end with a real message.
