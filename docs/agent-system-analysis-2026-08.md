# Análisis y Research — Sistema de Agente Parallext (Automatización, Tools, Motor Determinístico)

> **Fecha:** 2026-08-18 · **Actualizado:** 2026-08-18 punta 2026 (Sierra/Decagon/Hume)  
> **Alcance:** Pipeline conversacional, Prompt Assembler 3 capas, 71+ tools, Booking/Procedure engines, LLM Router, RAG 5-tier, memoria. Incluye diagnóstico de logs reales tenant `3e8ad32e`, research 2024-2026 y **research punta 2026 human-like CX** (Sierra Ghostwriter/Horizon/Context Engine, Decagon AOPs/Watchtower/Duet, voz 220ms, memoria cross-channel).  
> **Autores:** Análisis interno + síntesis research externo.

---

## Tabla de contenido

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Arquitectura actual — cómo funciona hoy](#2-arquitectura-actual--cómo-funciona-hoy)
3. [Inventario de herramientas](#3-inventario-de-herramientas-71--mcp)
4. [Motor determinístico](#4-motor-determinístico)
5. [Prompt Assembler 3 capas](#5-prompt-assembler-3-capas)
6. [LLM Router, RAG y memoria](#6-llm-router-rag-y-memoria)
7. [Diagnóstico de logs reales (2 momentos)](#7-diagnóstico-de-logs-reales-2-momentos)
8. [Tabla de bugs y deuda técnica priorizada](#8-tabla-de-bugs-y-deuda-técnica-priorizada)
9. [Research externo 2024-2026 — estado del arte](#9-research-externo-20242026--estado-del-arte)
9.7. [Human-like CX — punta 2026](#97-human-like-cx--punta-2026-qué-hacen-los-líderes-y-qué-nos-sirve)
10. [Comparativa de alternativas](#10-comparativa-de-alternativas)
11. [¿Es la mejor solución? Veredicto](#11-es-la-mejor-solución-veredicto)
12. [Roadmap recomendado](#12-roadmap-recomendado)
13. [Métricas y observabilidad faltante](#13-métricas-y-observabilidad-faltante)
14. [Referencias y repositorios](#14-referencias-y-repositorios)
15. [Anexos — trazas y archivos clave](#15-anexos--trazas-y-archivos-clave)

---

## 1. Resumen ejecutivo

**¿Funciona lo que hay? Sí.** Pipeline triple-idempotente (`inbound jobId` + `external_id` `conversations.service.ts:1229` + `turn:done` `conversations.service.ts:196`), serializado por `lock:conv` tokenizado `redis.service.ts:83` con heartbeat `conversations.service.ts:360`, y prompt 3 capas con L1 contract inmutable `prompt-assembler.service.ts:77`.

**¿Es sostenible? No con 71 tools por flag.** `tool-policy-registry.ts:104` expone 71 herramientas + `mcp__*` dinámicas; `conversations.service.ts:1882` las inyecta todas si el flag está activo. Causa bloat de contexto (~8-12k tokens solo en definiciones), latencia y alucinación de selección. Log real lo confirma: `list_properties` repetido cada turno y guardrail de precio disparado 2 veces `1787079278801`.

**Patrón correcto:** híbrido determinístico (`BookingEngine`/`ProcedureEngine` orquestan) + LLM vocaliza (`<directive>Say EXACTLY...</directive>` `prompt-assembler.service.ts:297` + `tools=[]` forzado `conversations.service.ts:1994`). Es el estándar 2025-2026 (`LLM as interpreter, code as executor`). Evolucionarlo con **tool retrieval** y **slot hold** lo lleva a escala; reescribir a ReAct puro lo empeora para transacciones.

---

## 2. Arquitectura actual — cómo funciona hoy

### 2.1 Flujo webhook → respuesta

```
Meta POST /channels/webhook/whatsapp
 → WebhooksController HMAC raw body → 200 <5s
 → resolveTenant(phone_number_id) cache 5m
 → BullMQ wa:webhooks process-message
 → WebhookProcessor: INSERT whatsapp_webhook_events ON CONFLICT DO NOTHING
   → UPSERT contacts (channel_type,external_id)
   → POST http://api:3000/api/v1/internal/inbound-message (x-internal-key, 5s timeout)
 → InternalController: assertInternalService + assertTenantId UUID + assertSubscriptionWriteAccess
   → inboundQueue.enqueue {priority por plan, attempts 3, jobId in-{tenant}-{channel}-{account}-{pmid}} `inbound-queue.service.ts:64`
 → InboundQueueProcessor concurrency 4 lockDuration 120s → conversations.processIncomingMessage
   → entitlement check `resolveTenantSubscriptionAccess` `conversations.service.ts:245`
   → source waba_echo|historical → storeOnlyMessage y fin `conversations.service.ts:268`
   → runTurn
```

### 2.2 `runTurn` (290 líneas) — árbol de decisión

| # | Paso | Líneas | Efecto |
|---|---|---|---|
| 0 | Debounce burst 800ms | `conversations.service.ts:302` `debounceBurst:2485` Redis `buf:conv` Lua `get==seq ? lrange+del` | Une 3-5 mensajes cortos WA en 1 turno |
| 1 | Lock contacto 10s ×6 | `conversations.service.ts:311` | Serializa find-or-create lead/conversation |
| 1b | resolveConversation | `conversations.service.ts:786` | contact → identity `identity.service.ts:21` advisory lock → lead score 1 → conversation multi-account `channel_account_id IS NOT DISTINCT` → opportunity |
| 2 | Persona por conexión | `persona.service.ts:531` `resolvePersonaForChannel` 3-tier: `channel_bindings` GIN `476` → `channels` → `is_default` → legacy | 1 agente por conexión |
| 3 | Business hours | `conversations.service.ts:456` `loadTenantBusinessHours` cache 5m | Si cerrado + `aiOutsideHours false` → `sendAfterHoursMessage` y fin |
| 4 | Handoff activo | `conversations.service.ts:468` `status waiting_human/with_human` → solo `saveMessage` | Humano tiene control |
| 5 | saveMessage | `conversations.service.ts:483` `ON CONFLICT external_id` + `turn:done` marker `196` | Dedupe redelivery vs resume interrumpido |
| 6 | Botones recordatorio / attendance | `conversations.service.ts:504` regex `confirmar asistencia` | UPDATE appointments + reply determinista |
| 7 | Opt-out | `conversations.service.ts:605` `compliance.detectOptOut` | No bloquea inbound, solo proactivo |
| 8 | shouldHandoff pre-LLM | `handoff.service.ts:75` keywords + `shouldHandoff` `conversations.service.ts:617` | `executeHandoff` + `sendResponse handoff:queueN` y fin |
| 9 | Typing indicator | `conversations.service.ts:657` | Best-effort |
| 10 | Quota IA | `conversations.service.ts:671` `throttle.hasAiMessageQuota` 5K/25K/100K | Fallback upgrade nudge |
| 11 | generateResponse | `conversations.service.ts:1456` | Ver §2.3 |
| 12 | Post-respuesta | `conversations.service.ts:696` chunk `splitResponseIntoChunks 600 chars` `2669` staggered 1200ms → `pipeline.autoProgress` → `leadScoring` → `nurturing.scheduleFollowUp` | |

### 2.3 `generateResponse` — cerebro

1. Media: audio Whisper `$0.006/min` / image vision Gemini/xAI `media-processing.service.ts` 25MB/30s límite → `resolvedText`
2. New-session gap `30min` `conversations.service.ts:1531` → `redis.del booking:{conv}` + `metadata -bookingState -toolContext`
3. TurnContext L3 base: `languageDetector.detect(userText, previous||configured)` `1566` stickiness, `timezone` `America/Bogota`, `upcomingDays 8` `prompt-assembler:483`, `businessIdentity` `business-info.service.ts`, `verticalContext` cache `vertical:{tenant} 10m` `1645`, `customerMemory` cada 6 msgs `1593`
4. **Booking engine** si `tools.appointments.enabled` y `!procedureAwaiting` `1714`: `intentInterpreter.interpret` `2752` → `shouldYieldToVerticalTools` → `bookingEngine.process` → si `handled` → `engineProducedText` + `tools=[]` + `flowMessage` WhatsApp Flow `1806` o `handoff`
5. **Procedure engine** si `!engineProducedText` `1857`: mismo patrón directive `procedure-engine.service.ts`
6. **Registro tools** por flags `1883` appointments/catalog/faqs/policies/knowledge/offers/orders/crm/ecommerce/payments runtime `1920` + verticalIntegrations `1931` + MCP `1942` + 10 verticales → **última línea `if(engineProducedText) tools=[]` `1994` gana**
7. RAG: `tenantHasKnowledge && rag.enabled` `2018` `topK clamp 1-10 threshold 0.35 searchThreshold min(0.25)` `rewriteSearchQuery` follow-up `2536` LLM cheap → `searchRelevant` `knowledge.service.ts:652` → `retrieved >=0.35` vs `possible 0.25-0.35` `2048`
8. Assemble `L1+L2+L3` `2133` con `cachePrefixChars` `62` para Anthropic cache
9. History: `SELECT ... ORDER BY created_at DESC LIMIT 31` `2120` → `slice(1).reverse()` → `messageCount = history.length+1` → si directive → últimos 4 `2146`, si newSession → solo current `2153`, else `truncateHistory` budget `64000 - systemTokens - responseTokens -2000 /4 cap 8000` `2700`
10. Loop LLM `MAX_TOOL_ITERATIONS 5` `2162` `llmRouter.execute {task tool_calling|conversation, temperature 0.3|personaTemp, routingFactors ticketValue/complexity/stage/sentiment, allowedTiers}` `2204` → toolCalls → `withTimeout 25s` `2693` + `toolBatchRequiresSequentialExecution` `2307` sequential si algún writer → resultados `role:tool` `2327` + `_mediaToSend` staggered `2388` + `shouldHandoff intake` `2299` → `applyOutputGuardrails` `2374` auditClaim + validatePrices → `persistBookingState` + `emit postToolHandoff`

---

## 3. Inventario de herramientas — 71 + MCP

| Familia | Count | Archivo | Ejemplo |
|---|---|---|---|
| Appointments | 8 | `tools/appointment-tools.ts:7` | `list_services`, `check_availability`, `create_appointment` |
| Catalog+Offers | 5 | `tools/catalog-tools.ts:7` | `search_products`, `send_product_image` |
| Knowledge | 3 | `tools/knowledge-tools.ts:11` | `search_faqs`, `get_policy`, `search_knowledge_base` |
| CRM/Orders | 2 | `tools/crm-tools.ts:11` | `get_customer_context` |
| E-commerce | 3 | `tools/ecommerce-tools.ts:14` | `recommend_products`, `apply_discount` (A4 human_approval) |
| Payments | 2+1 | `tools/payment-tools.ts:8` + `payment-tool-registration.ts:11` | `create_payment_link` (A1, runtime gate plan+ready), `refund_payment` definido no advertido |
| Vertical Integrations | 4 | `tools/vertical-integration-tools.ts:10` | `get_restaurant_menu` (Toast) |
| Vacation Rental | 8 | `tools/vacation-rental-tools.ts:8` | `list_properties`, `check_property_availability`, `create_property_booking` |
| Tours | 6 | `tools/tours-tools.ts:14` | `search_packages` |
| Pets, Restaurants, Gyms, Education, Insurance, HomeServices, Photography, Professional | 30+ | `tools/pets-tools.ts:12` etc. | `triage_pet_emergency` → handoff, `book_class` waitlist, `file_claim` stepUp |
| MCP remoto | N | `mcp/mcp-client.service.ts:95` `mcp__{server}__{tool}` cache 300s | Opaque `A4 humanApproval:required_missing` `tool-policy-registry.ts:346` |

**Condición de registro** `conversations.service.ts:1882` y espejo `agent-test.service.ts:174`:

```ts
if(cfgTools?.appointments?.enabled) tools.push(...APPOINTMENT_TOOLS)
if(cfgTools?.catalog?.enabled) tools.push(...CATALOG_TOOLS)
// ... 19 ifs + verticalIntegrations.getConnectedProviders cache 5m + mcpClient.listRemoteTools
if(engineProducedText) tools=[] // override final
```

**Ejecución** `ai-tool-executor.service.ts:87` default-deny `120` + `ToolExecutionControlService.preflight` `161` (assurance A0-A4, idempotency `sha256 stableValue(args)` `tool-execution-control.service.ts:243`, confirmation 15min TTL `141`, approvalTicket A4 24h). `toolRequiresSequentialExecution` `tool-policy-registry.ts:384` writers → secuencial, resto `Promise.all`.

**AgentTest** sandbox `agent-test.service.ts:203` `isAgentTestSafeToolName` + `executionContext persistence:disabled` → MCP/writers bloqueados, no reproduce prod.

---

## 4. Motor determinístico

### 4.1 BookingEngine FSM `booking-engine.service.ts:17`

`BookingState {step idle|show_services|ask_date|show_slots|ask_name|ask_email|confirm|booked|waiting_flow, serviceId,date,slots,time,staffId,customerName/Email, flowStartedAt}` grafo `idle→show_services→ask_date→show_slots→ask_name→ask_email→confirm→booked` + `waiting_flow` con expiración 1h, `cancel` → `idle` en cualquier punto, `booked + ask_availability` → `idle` reset, `greet|farewell` en `idle|booked` → skip engine `conversations.service.ts:1760`.

Persistencia: `redis.set booking:{conv} 1h` primario + `PG metadata.bookingState` backup; `loadBookingState` `2808` Redis primero, PG solo si `age ≤1h`. `EngineResult {handled,text,flowMessage,listMessage,handoff}`; si `handled` → `EXPRESS` directive `turnContext.directive` `<directive>` + `tools=[]`.

### 4.2 IntentInterpreter `intent-interpreter.service.ts:75` 2 niveles

1. `deterministicExtract` (80% tráfico, 0 coste): NFD lower → email → confirmation/cancel (`sip`/`mejor no` anywhere) → greet <30 chars → `ask_services` → servicio por número/ordinal `el 1` → nombre exacto más largo gana → fuzzy word-overlap stem 5 chars → fecha `hoy/mañana/10 de enero/día semana upcoming[]` → hora `10:30/a las 3 tarde/15h/mediodía` → booking intent → nombre solo si `step ask_name` con blocklist. Bloqueo `collectingPersonalInfo = ask_name|ask_email|confirm` evita `Cortés` vs `corte`.
2. `llmInterpret` `381` `grok-4-1-fast-non-reasoning temp 0` JSON forzado + `sanitizeLlmIntent` valida ISO `YYYY-MM-DD`, `HH:MM`. `BookingEngine 457` reinterpreta números tras reload servicios `booking:services:{tenant} 5m`.

### 4.3 ProcedureEngine `procedure-engine.service.ts` SOP

Steps `message|ask|tool|condition|handoff`, 1 directive/turn, Redis `procedure:{conv}`, hook `conversations.service.ts:1857` después de booking, guardado si `procedureAwaiting`.

### 4.4 Appointment + Calendar `appointments.service.ts:1121` `calendar-integration.service.ts:1300`

`normalizeNaive` wall-clock `YYYY-MM-DDTHH:mm:ss`, `resolveTimezoneForSchema`, `create` con `transactionInTenantSchema lockAndAssertAppointmentCapacity FOR UPDATE` + `calendarOutbox enqueue upsert`. `getBookableSlots 961` step `max(5,min(30,duration))`, filtra `blocked_dates`, solapados, `calendarBusySlots`, `maxConcurrent`. 3-tier resolución `service → staff (staff_operational_bindings) → general` `414`, Google Meet/Teams auto, idempotencia `googleEventId 409 → GET`, `withReadDeadline 30s race`.

### 4.5 Pre-chat `pre-chat.service.ts:28` + `widget.service.ts`

`getActiveForm LIMIT 1` sin ORDER BY; `saveForm` CTE atómico `WITH deactivated UPDATE ... RETURNING 1 INSERT`. Solo widget, no WhatsApp.

### 4.6 Handoff `handoff.service.ts:75` + `agent-console.service.ts` + `agent-availability.service.ts`

`shouldHandoff` keywords: `human_request` (`hablar con humano`), `complaint` (`queja/estafa/abogado`), `discount_request`, `vip`, `max_failed_attempts ≥3`, `custom_trigger`, togglables `handoffCategories[cat]=false`. `executeHandoff 145` → LLM `gpt-4o-mini temp 0.1` sobre 20 msgs → `StructuredHandoffSummary` → `UPDATE conversations status waiting_human metadata handoff.summary structuredSummary traceId` + `was_handed_off` + `internal_notes` + `Redis handoff:{tenant}:{conv} 24h` + `emit handoff.escalated` → `AgentConsoleGateway inbox:handoff/direct/escalation` + email `handoff_notification`. `tryAutoAssign 428` skillMap `complaint→complaints` + `leadScore≥80 → senior` + `vertical salud → clinical` → `SELECT users availability_status online active_count < max_capacity ORDER BY matching_skills DESC active_count ASC LIMIT1` + `conversation_assignments SLA 5m`. `claimConversation` `UPDATE WHERE assigned_to IS NULL` atómico. Crons `*/5` offline `*/2` escalate stale >5m.

### 4.7 Automation `automation-listener.service.ts:452` `automation-jobs.processor.ts:364` `nurturing.service.ts:1044`

EventEmitter `lead.captured|message.inbound|conversation.assigned|pipeline.stage_changed|appointment.completed` → `evaluateConditions` `equals/contains` → `automation_executions queued` → `automationQueue add` `priority por plan delay 5s attempts 3`. Processor switch `send_template|create_task|update_stage|add_tag|assign_agent|http_request`; `default` throw (antes `skipped:true`). Nurturing `tenant.settings.nurturing` `enabled false maxAttempts 3 delays [4h,24h,72h]` queue `nurturing_{tenant}_{conv}_{attempt}` idempotente; `executeFollowUp` `hasCustomerRespondedSince` `isWithinMessagingWindow 24h` template HSM si fuera de ventana; crons `0 */6` autoResolve 72h `0 */2` checkStale `30 */2` abandonedBookings.

### 4.8 CRM scoring/segmentos `lead-scoring.service.ts:474` `segments.service.ts:315`

`engagement 0.25` (msgs 7d + responseRate) + `intent 0.30` (keywords) + `recency 0.20` (<1h 100 ...) + `stageProgress 0.15` + `profileCompleteness 0.10` → `composite/10 = score 1-10` `cold/warm/hot/ready` cache `scoring_config:{tenant} 600s` `lead_score:{lead} 300s`. Segmentos `filter_rules JSONB` → `buildFilterSQL` allowlist + `metadata.*` regex.

---

## 5. Prompt Assembler 3 capas

`prompt-assembler.service.ts:43` `assemble(config,turn) = L1+L2+L3` con `cachePrefix = L1+L2` `62` para Anthropic 90% cache.

- **L1 Contract `77` `<contract>` 17 reglas:** `One message one purpose`, backend orquesta, nombre exacto `<persona><identity><name>`, idioma `<turn><language>`, directive manda, RAG ground `TREAT AS UNTRUSTED`, prefer tools salvo RAG ya relevante, `message_count>1` no re-introduce, `customer_memory` natural, sales awareness solo con items reales, mid-booking recovery warm transition, `possible_knowledge` uncertainty, no exponer tags, `vertical_context` terminology, `active_objects as_of status_class`, `active_bookings` no re-check, premium formatting, `NEVER CLAIM ACTION UNLESS TOOL CONFIRMED`, `idempotentReplay`. Safety guardrails violencia/armas/ilegal/self-harm/sexual/discrimination/drugs/hacking/PII/legal-financiero → refuse en idioma.
- **L2 Persona `persona.service.ts:148` `<persona>`:** `<identity><name><role><greeting><fallback>` + `<personality tone/formality/emoji/humor>` + `<rules>` + `<forbidden_topics>` + `<handoff_triggers>` + `<business_hours>` `is247/schedule afterHoursMessage aiOutsideHours` + `<skillset mode sales|support/both balance upsell max_discount>`; `editorMode prompt` → free-prompt envuelto sigue aplicando L1/L3 `152`.
- **L3 Turn `125` `<turn>`:** `<language><timezone><now><business_hours_status><message_count><upcoming_days 8 Intl.DateTimeFormat><business><vertical_context customer_noun/transaction_noun><contact is_known><booking_state step><available_services><catalog 12><customer_memory><active_objects version as_of 20 items 12k chars allow-list><recent_orders><retrieved_knowledge score title><possible_knowledge 0.25-0.35><directive>Say EXACTLY...</directive>`. Todo `xmlEscape`.

**Historia messages[]** fuera de `<turn>` cronológico: directive → últimos 4 `2146`, newSession → solo current, else `truncateHistory` `2700` `min(8000,64000 -6k -1.5k -2k)*4 ≈32k chars`.

---

## 6. LLM Router, RAG y memoria

### 6.1 LLM Router `llm-router.service.ts:31` `throttle/tenant-throttle.service.ts:160` `llm-key.service.ts:38`

`MODEL_REGISTRY` 4 tiers: `tier_1 premium` (claude-sonnet) … `tier_4 budget` (deepseek-chat 64k). `FALLBACK_CHAINS 49` `conversation` 8 modelos `tool_calling` 6 (Gemini excluido `supportsTools false`). `buildCandidates 253` filtra `supportsTools` + `isConfigured` 5 providers + `getUnhealthyProviders` `275` Redis `llm:health:*` TTFT p95 `89` + `primary vs escalation` `282`. `estimatePromptTokens chars/4` `244` vs `maxContextTokens`, `scoreFactors` `292` `ticketValue 0.30 complexity 0.30 stage 0.20 sentiment 0.10 intent 0.10` → `targetTierForScore 303` reordena, sticky `llm:affinity:{conv} 1800s` `372`, iteración serial `390` try `provider.generate timeout 45s` → escalated log `402`, `setAffinity` si no escalated `411`, `trackStats` `525` `costUsd tokensIn/1000*in + tokensOut/1000*out` `llm:stats:{tenant}:{date}:{provider}` + `llm:cost:{tenant}:{YYYY-MM}` centi. Budget clamp `conversations.service.ts:2177` `getLlmSpendUsdCents >= llmCostBudgetUsd 800/2500/6000/10000` → clamp a `tier_3/4` o `tier_4`. Circuit breaker `172` solo 5xx/timeout, ventana 60s threshold 3 open 120s `80` TTL Redis compartido. Sin key → `No LLM provider configured` `338` o `Anthropic key not configured` `anthropic.provider.ts:15`.

Debilidades: costes hardcodeados, Gemini tool-call excluido artificial, `chars/4` subestima JSON/emoji, `executeStream` sin fallback `872`, afinidad 1800s pinnea degradado, `deepseek 64k` cuello botella, embeddings sin fallback OpenAI-only.

### 6.2 RAG 5-tier `knowledge.service.ts:652`

| Tier | Fuente | Inyección |
|---|---|---|
| 1 Business Identity | `companies` `business-info.service.ts` cache Redis | `turn.business` `<business>` siempre ~200 tokens |
| 2 Catalog | `ecommerce_products` `catalog-tools` | `CATALOG_TOOLS` si `catalog.enabled` + `turn.catalog 12` |
| 3 FAQs | `faqs` TSVECTOR | `FAQ_TOOL` |
| 4 Policies | `policies` versioned | `POLICY_TOOL` never hallucinated |
| 5 KB RAG++ | `knowledge_embeddings` pgvector + `knowledge_documents` | `retrievedKnowledge` + `possibleKnowledge` `<retrieved_knowledge>` |

Ingesta `CHUNK_MAX 2000 OVERLAP 200` `chunkText 1173` split párrafos/oraciones, `parseFileContent` pdf `pdf-parse` docx `mammoth`, `embedAndStoreChunks 1117` `text-embedding-3-small` `embedding::vector + search_tsv to_tsvector` quota `kb:embed:{tenant}:{YYYY-MM}`. Hybrid search `searchRelevant 652` `embedQueryCached SHA256 kb:qemb 3600s` → parallel `vectorPool LIMIT topK*4` `embedding <=> vector distance` + `tsPool plainto_tsquery ts_rank` → RRF `K 60` `KEYWORD_BOOST 0.15 LANG_BOOST 0.1` `score = min(1,vecSim+keyword+lang)` filtro `score≥threshold OR keywordHit` → rerank opcional `rerankChunks 788` LLM cheap `tier_4/3 temp 0 maxTokens 200` JSON índices → `slice topK` + `trackRetrieval` `kb_retrieval_log was_used`.

### 6.3 Memoria conversacional `conversations.service.ts:2113` `2698`

Fetch `SELECT direction,content_text WHERE conversation_id DESC LIMIT 31` → `history = rows.slice(1).reverse()` `messageCount history.length+1`. Widget fetch inconsistente `LIMIT 20 ASC` `2903` vs `DESC` `3023`. Truncamiento `2700` budget dinámico `MIN_CONTEXT 64000 - systemTokens - responseTokens -2000 cap 8000`. Booking directive `slice(-4)` para no ignorar directive; newSession `isNewSession gap>30min && !flowResponseData` `1536` → `del booking:{conv}` + `metadata -toolContext -bookingState` `1541` y solo current. `vertical_context` `1644` cache `vertical:{tenant} 600s` + `bizgoals:{tenant}`. `customerMemory` `1593` cada 6 msgs `activeOperationsContext 1610` allow-list `active_objects` `20/12k`. Sin summarization, drop por recencia.

---

## 7. Diagnóstico de logs reales — 2 momentos

Tenant `3e8ad32e` `phone 573208010737` `1096061716929890` ventana `1787079106338` → `1787079394289`.

#### Momento 1 — mensaje encolado nunca procesado

```
1787079106338 WhatsappWebhookService Processing message event
1787079106392 InboundQueueService Enqueued wamid.HBgMNTcz... job=in-3e8ad...wamid.HBgMNTczMjA4MDEw... 200 57ms
[ausencia] InboundQueueProcessor Processing ...
[ausencia] ConversationsService Processing inbound...
— 42s después —
1787079148856 Enqueued wamid.HBgMQUNFMjJE... (diferente wamid, no dedupe)
1787079148880 InboundQueueProcessor Processing queued=21ms
1787079148898 ConversationsService Processing inbound
1787079150187 Conversation 70b36d04 is in HUMAN HANDOFF mode. Skipping AI.
```

**Causa:** job quedó en `inbound-messages` BullMQ sin worker. `inbound-queue.processor.ts:17` `concurrency 4` no lo tomó. `internal.controller.ts:66` hizo `await enqueue` y devolvió 200 (correcto durable), pero procesador no logueó `failed` ni `stalled`. No es `turn:done` ni `external_id` dedupe (wamid distinto). Ventana 42s > `lockDuration 120s` descarta stall; sugiere deploy reinicio entre enqueue y process: job quedó `waiting` hasta que worker revivió y tomó el siguiente job (el primero quedó `delayed` por debounce?).

**No cubierto antes:** falta métrica `inbound.lag = now - enqueuedAt` y alerta `BullMQ stalledInterval maxStalledCount 1` `inbound-queue.processor.ts:17` no emite a Sentry. Requiere `Bull Board /admin/queues` con `X-Admin-Token` ya existe pero sin alerta proactiva.

#### Momento 2 — post-`resolve` IA vuelve pero alucina precios y falla booking

```
1787079163975 AgentConsoleService resolved by 074489d5 returned to AI
1787079227032 Conversation 70b36d04 permanently deleted
1787079273894 Enqueued new inbound
1787079273930 Processing inbound → Message saved f6d4a49a-3c30 `conversations.service.ts:917` INSERT greeting (nueva conversación)
1787079276918 [LLM] tool_calling deepseek 1592ms → list_properties
1787079278801 [Guardrail] price(s) not in context: 180000,280000 — corrective retry `response-validator.service.ts:2631` → xai grok 1468ms → reply
... 3 turnos ...
1787079392228 [Tool] create_property_booking failed: Property is not available `ai-tool-executor.service.ts`
1787079394289 AI: "ya tienes reserva confirmada para Amazon Minimalist..."
customer→reply 5926/6547/6929/6596ms `outbound-queue.processor.ts`
platform-status 304 / channels/overview 304 cada 30s (polling dashboard)
```

**Hallazgos complementarios:**

- **Precio:** `list_properties` devolvió 2 propiedades `Amazon Minimalist` 1 hab, pero `responseValidator.validatePrices` no encontró `180000/280000` en corpus (tool result tenía `180000` sin separador pero LLM emitió `180.000` o viceversa). `buildUnverifiedPriceReply` forzó retry que corrigió a `Tenemos dos opciones...` sin precio. Root cause: formato `price` no normalizado entre DB `180000` y guardrail regex `conversations.service.ts:2374`.
- **Disponibilidad:** `create_property_booking` sin `check_property_availability` previo en mismo turno; `tool-policy-registry.ts:217` permite `create` directo. Booking engine de citas sí hace `checkAvailability` + `lockAndAssert` `appointments.service.ts`, vacation rental no.
- **Repetición tool:** `list_properties` 4 veces en 4 turnos pese a `active_objects` ya inyectado `prompt-assembler.service.ts:321`. `toolBatchRequiresSequentialExecution` serializa pero no evita redundancia.
- **Latencia:** `5926-6929ms` es `deepseek 1.1-1.8s + deepseek 1.4s + xai 1.4s + outbound 885ms` → 3 llamadas LLM por turno por guardrail retry.
- **Sesión / JWT:** `1787079132847 activity-ping 401` + `ConversationsGateway jwt expired` `1787079132882` + `AgentConsoleGateway Token expired` `1787079132887` → `auth/google` `1787079137825 trusted device` → `AgentConsoleGateway authenticated 074489d5` `1787079140106` — ciclo idle 60min `useIdleTimer.ts` correcto, pero reconexión WebSocket `Joined tenant room 3e8ad32e` `1787079138731` tardó 5s tras login.

---

## 8. Tabla de bugs y deuda técnica priorizada

| Sev | Hallazgo | Ubicación | Evidencia log / impacto | Fix propuesto |
|---|---|---|---|---|
| **CRÍTICO** | Ventana check-then-act sin hold | `booking-engine.service.ts:836` `checkAvailability` sin lock → `create_appointment` `lockAndAssert` | Slot ofrecido luego falla UX | `SET slot:hold:{service}:{date}:{time} NX EX 120` en `checkAvailability` + verificar en `create` |
| **CRÍTICO** | Lock conv 30s < turn 30-100s | `conversations.service.ts:342` TTL 30 heartbeat 10 | 2º mensaje puede adquirir lock si GC pausa >10s → `booking:{conv}` last-write-wins | TTL 60s + `Redlock` + `turnDoneKey` check antes de `saveMessage` |
| **CRÍTICO** | `create_property_booking` sin `check` previo | `vacation-rental-tools.ts:217` `tool-policy-registry:217` | Log `Property is not available` `1787079392356` | Policy `requires check_property_availability success` en `tool-execution-control.service.ts` |
| **ALTO** | `state.date` no validado al rehidratar | `booking-engine.service.ts:259` valida `intent.date < today` no `state.date` | `state` 1h TTL `2827` resucita `ask_name` con fecha vencida | `if(state.date < todayISO) reset ask_date` al inicio `process` |
| **ALTO** | Inbound job perdido sin traza | `inbound-queue.processor.ts:30` `Enqueued 9106392` sin `Processing` | Cliente sin respuesta 42s, retry Meta re-envía nuevo wamid | Métrica `inbound.lag` + alerta Sentry `OnWorkerEvent failed` ya en outbound/broadcast/automation/nurturing pero no en inbound |
| **ALTO** | `shouldYieldToVerticalTools` regex frágil | `conversations.service.ts:2752` solo `idle|booked` | `agendar clase yoga` mid-flow no cede | Clasificador intent LLM cheap pre-routing |
| **ALTO** | `isNewSession 30m` limpia booking aunque Redis 1h | `conversations.service.ts:1531` `del booking:{conv}` | Pausa 35m pierde mid-flow | Alinear TTLs o mensaje recuperación `¿seguimos con {date}?` |
| **ALTO** | Precio no normalizado guardrail | `response-validator.service.ts:2631` vs `vacation-rental-tools` price `180000` | 2 retries `1787079278801` `1787079317302` + coste xai | Normalizar `price.replace(/[.\s$]/g,'')` en ambos lados |
| **MEDIO** | History directive `slice(-4)` pierde anáfora | `conversations.service.ts:2146` | `¿cuánto vale?` 6 msgs atrás fuera de ventana | Incluir `serviceName/date` siempre en `<booking_state>` |
| **MEDIO** | `Pre-chat LIMIT 1` sin `ORDER BY` | `pre-chat.service.ts:33` | Race deja 2 `is_active` | `UNIQUE WHERE is_active` + `ORDER BY created_at DESC` |
| **MEDIO** | Scoring decay muerto | `lead-scoring.service.ts` lee `decay_*` no lo usa | Config engañosa | Implementar `recency *= decayFactor^(days/decayDays)` o eliminar |
| **MEDIO** | `segments` count diverge `archived_at` | `segments.service.ts` `createSegment` sin `archived_at IS NULL` vs cron con | Dashboard N ≠ lista paginada | Unificar `WHERE archived_at IS NULL` |
| **BAJO** | `segments.refreshDynamicSegments` N+1 tenants | `segments.service.ts` cron `0 * * * *` loop tenants | Coste O(tenants) cada hora | Batch `SELECT ... WHERE is_dynamic` cross-tenant 1 query |
| **BAJO** | `Calendar Promise.race` leak | `calendar-integration.service.ts:646` `withReadDeadline 30s` no aborta `freebusy.query` | Socket no cerrado | `AbortController` |

---

## 9. Research externo 2024-2026 — estado del arte

### 9.1 Taxonomía de agentes (papers y surveys)

- **ReAct (Yao et al., 2022, ICLR 2023):** LLM alterna `Reason → Act (tool) → Observe` hasta `Finish`. Base de `LangGraph`, `CrewAI`. Ventaja: flexibilidad; desventaja: no garantía de estado, hallucina transacciones. *Nuestro `BookingEngine` es ReAct invertido: código razona, LLM vocaliza — evita hallucinar `booking confirmed` sin tool.*
- **Function Calling / Tool Use (OpenAI Jun 2023, Anthropic Claude 3 Tool Use 2024, Gemini Function Calling 2023):** JSON Schema tools con `tool_choice`. *Nuestra `packages/shared/src/index.ts:600` `ToolDefinition` y `MAX_TOOL_ITERATIONS 5` `conversations.service.ts:2162` replican spec OpenAI.*
- **Toolformer (Schick et al., 2023) + Gorilla (UC Berkeley, 2023) + ToolLLM (Qin et al., 2023):** LLM aprende cuándo llamar tools; Gorilla entrenado en `API Bench` 1.6k APIs muestra que **>30 tools degrada accuracy <60% sin retrieval**. *Replica nuestro problema 71 tools.*
- **Surveys 2024-2025:** `A Survey on LLM Agents` (Wang et al., arXiv 2309.07864, v7 2024), `Tool Learning with Foundation Models` (Qin 2023), `LLM Agents: From Prompt to Autonomous` (Xi et al., 2023). Consenso: **deterministic workflow + LLM as tool selector** supera ReAct puro en dominios regulados (booking, pagos).

### 9.2 Escalado de tools — el cuello de botella de 2024

| Enfoque | Repo / Paper | Idea | Aplicabilidad Parallext |
|---|---|---|---|
| **Tool Retrieval (RAG for tools)** | `ToolRAG` (Anthropic 2024), `GrepTools` (Microsoft 2024), `BM25 + embeddings` sobre `tool description` | Indexar tools por embedding, `searchRelevantTools(query topK 8)` antes de LLM call | **Alta** — reemplazar `if enabled push` `conversations.service.ts:1882` por `retrieval` reduce de 71 a 6-10 por turno |
| **Hierarchical toolsets** | `LangGraph ToolNode`, `OpenAI Assistants v2` (Abr 2024) tool limit 128 pero recomienda <20 | Agrupar por dominio `vertical:{tenant}` `verticals.service.ts:950` `toolsByIndustry` | Ya existe mapeo por industria, usar para filtrar |
| **MCP — Model Context Protocol** | `Anthropic MCP` (Nov 2024) `modelcontextprotocol.io` SDK `github.com/modelcontextprotocol` | Standard JSON-RPC `tools/list` + `tools/call` Streamable HTTP `mcp-client.service.ts:95` `mcp__server__tool` cache 300s | Ya implementado `mcp-client.service.ts` + `mcp-server.service.ts POST /mcp/rpc` API-key auth; política `OPAQUE_MCP_TOOL_POLICY A4` `tool-policy-registry.ts:346` es correcta fail-closed |
| **Function calling con ejemplos** | `OpenAI function calling best practices` (2024) | Cada tool `description` + 2-3 `examples` few-shot sube accuracy 18% (Gorilla eval) | Añadir `examples` a `ToolDefinition` `shared/src/index.ts:600` |
| **Tool sandboxing** | `E2B`, `ToolEmu` (Ruan et al., 2023) eval offline | `AgentTestService` `agent-test.service.ts:203` `isAgentTestSafeToolName` + `simulation/` `T2.13` `simulation_runs` + `QualityService.judgeTranscript` | Ya existe `simulation` `agent-simulation` queue, reutilizar para regresión |

### 9.3 Orquestación determinística vs. agentic — consenso 2025

- **State machines > ReAct para transacciones:** `Temporal.io` (deterministic workflows), `XState` (FSM tipado), `AWS Step Functions` con LLM task. Stripe, Airbnb, Booking.com usan **code workflow + LLM NLG** para reservas/pagos. *Nuestra `booking-engine.service.ts:259` FSM `idle→...→booked` es el patrón recomendado; falta formalizar con librería (hoy strings).*
- **Procedure as code:** `LangGraph` `StateGraph` con `checkpointer` Redis (nuestro `booking:{conv}` `1h` es checkpointer artesanal). `Pydantic AI` (2024) `github.com/pydantic/pydantic-ai` valida tool args con schema antes de ejecutar — similar a `tool-execution-control.service.ts:845` `stableValue` + `sha256`.
- **Human-in-the-loop:** `AutoGen` (Microsoft, 2023) `github.com/microsoft/autogen` + `CrewAI` `github.com/crewAIInc/crewAI` permiten `handoff` `human_request` → `AgentConsoleGateway` `inbox:handoff` ya es HITL canónico.

### 9.4 RAG y memoria — avances 2024-2026

- **Hybrid search RRF:** `Weaviate` + `Qdrant` RRF `K 60` es estándar; `keywordBoost 0.15 langBoost 0.1` `knowledge.service.ts:704` es heurística no tuneada A/B. Papers `RAFT` (Zhang 2024) y `Self-RAG` (Asai 2023) muestran **rerank LLM opcional** `knowledge.service.ts:763` con `tier_4/3` es correcto pero debe ser `temperature 0 maxTokens 200` JSON índices con fallback — ya lo es.
- **Embeddings:** `text-embedding-3-small` OpenAI-only `knowledge.service.ts:1328` es single point; 2024 alternativas `Cohere embed-v3`, `BGE-M3` local, `Voyage` mitigan. *Recomendación: fallback `pgvector` local `bge-small`.*
- **Memoria larga:** `MemGPT` (Packer et al., 2023) `github.com/cpacker/MemGPT` + `LangChain memory` `summary + vector store`. Nuestra `customerMemory.getMemory` cada 6 msgs `conversations.service.ts:1593` + `<customer_memory>` `prompt-assembler:237` es `MemGPT`-lite sin summarization; para `>8000` tokens solo `truncateHistory` `2700` drop por recencia, no resume — `LLMLingua` (Jiang 2023) compresión 5× es alternativa.

### 9.5 LLM Routing y coste — 2024-2026

- **Multi-provider fallback:** `LiteLLM` `github.com/BerriAI/litellm` + `OpenRouter` `openrouter.ai` unifican `MODEL_REGISTRY` `llm-router.service.ts:31` + `FALLBACK_CHAINS` `49`. Circuit breaker 3/60s open 120s `172` es patrón `resilience4j`; `LiteLLM` usa idéntico.
- **Cost-aware routing:** `FrugalGPT` (Chen 2023) + `RouteLLM` (Ong 2024) aprenden `routingFactors` `ticketValue/complexity/stage/sentiment` `conversations.service.ts:1511` con pesos `0.30/0.30/0.20/0.10/0.10` `292` — heurística manualmente tuneada, ML router óptimo entrena con `QualityService overall` feedback.
- **Prompt caching:** Anthropic `cache_control` `anthropic.provider.ts:39` `cacheableSystemPromptChars` `prompt-assembler.service.ts:62` L1+L2 stable 90% ahorro — best practice 2024.

### 9.6 Evaluations — lo que falta

- **Evals harness:** `OpenAI Evals` `github.com/openai/evals` + `LangSmith` `smith.langchain.com` + `Braintrust` `braintrust.dev`. Nuestra `simulation/` `T2.13` `agent-simulation` queue + `QualityService.judgeTranscript` `quality.service.ts` es eval harness interno pero infrautilizado. Patrón 2025: **synthetic + replay** — ya está diseñado `synthetic (LLM per-vertical) + replay` `simulation.service.ts`.
- **Guardrails:** `Guardrails AI` `github.com/guardrails-ai/guardrails` + `NeMo Guardrails` (NVIDIA, 2023) + `Pydantic validation` para `validatePrices` `response-validator.service.ts:2631` y `auditTurnClaim` `outcome-claim.util.ts:2600` — nuestro `applyOutputGuardrails` `2374` es NeMo-lite correcto pero necesita normalización precio.

---

## 9.7 Human-like CX — punta 2026 (qué hacen los líderes y qué nos sirve)

> Síntesis de `Sierra` (ex-Bret Taylor, ex-Salesforce), `Decagon`, `Intercom Fin`, `Zendesk AI`, `Ada`, `Hume EVI` + voz 2026. Verificación: `sierra.ai` y `decagon.ai` fetch 2026-08-18. Todo lo que suena humano ya no es prompt engineering: es SOPs + memoria + prosodia + AOPs + QA continuo.

### Qué significa “humano” en 2026 (no es solo texto bonito)

| Dimensión | Antes (2023-2024) | Punta 2026 | Quién lo hace y cómo |
|---|---|---|---|
| **Prosodia y voz** | TTS robótico, latencia 1.5s, sin interrupción | Latencia 220-320ms, barge-in, Voice Personas con timbre/emoción configurable por idioma, SSML prosody adaptativa a sentiment | `Sierra Voice Personas` 2026 — misma agent cross chat/SMS/WA/email/voz/ChatGPT con voz distinta por marca/idioma; `Decagon Voice` human-like con brand customization + cross-channel memory; `Hume EVI` y `ElevenLabs Conversational AI 2.0` (2025-2026) detectan frustración en audio y ajustan prosodia en <300ms |
| **Comprensión de reacción emocional** | `analyzeSentiment` heurístico `conversations.service.ts:697` `0-100` + `sentiment 50` log | Clasificador `joy/frustration/confusion/urgency` en texto + voz (pitch/energy), y **mirroring adaptativo**: si cliente ansioso → respuesta corta, calmada, validación explícita; si entusiasta → tono energético | `Sierra Context Engine` + `Decagon Insights` clasifican intent + sentiment por turno; `Hume` da `empathic NLG` con `affective window 3 turnos`; nuestro `LanguageDetectorService` + `sentiment` debe evolucionar a `EmotionService` multimodal |
| **Memoria que parece humana** | Recitar `<customer_memory>` `prompt-assembler.service.ts:237` + historial truncado | Memoria episódica + semántica: recuerda nombre, última reserva, tono usado, objeción, y **no pregunta lo que ya sabe**; cross-channel (WA → voz) sin repetir | `Sierra Context Engine` + `Horizon` long-horizon planning (días/meses) + `Decagon` unified intelligence layer; nosotros tenemos `customerMemory` cada 6 msgs + `active_objects` 12k pero sin **memory extraction** automática por tool success |
| **Reglas de negocio como código, no como prompt** | Reglas en `<persona><rules>` `persona.service.ts:273` mezcladas con tono | **AOPs** (Agent Operating Procedures) en lenguaje natural compiladas a workflow verificable + guardrails + tool preconditions; SOPs, transcripts, fotos de pizarra → agente producción | `Decagon AOPs` — defines workflow en natural language, se refina sin sprint de ingeniería; `Sierra Ghostwriter` — subes SOPs/transcripts/audio y genera agente multilingüe con guardrails; `Sierra Agent Studio` + `Horizon` descomponen outcome en pasos que mejoran días/meses |
| **Configuración por empresa (no-code)** | Wizard `persona.service.ts` + `editorMode: 'prompt'` envuelto en `<persona>` | Editor visual + AOPs + Experimentos A/B + sugerencias AI de knowledge gaps | `Decagon Build/Optimize/Scale` + `Sierra Ghostwriter` + `Intercom Fin` no-code actions; nuestro `dashboard/src/app/admin/agent/[agentId]/page.tsx` es wizard pero sin A/B ni simulaciones a escala |
| **QA y mejora continua** | `QualityService overall=6` `1787079165769` sin loop | **Always-on QA** + simulaciones a escala + A/B + auto-mejora | `Decagon Watchtower` (siempre encendido) + `Testing & QA simulations at scale` + `Experiments Live A/B` + `Duet Autopilot self-improving`; `Sierra Monitors/Explorer/Experiments/Observability` trazas tool calls/latency + `Insights` ChatGPT Deep Research sobre conversaciones; nuestro `simulation/` `T2.13` `simulation_runs` existe pero infrautilizado |
| **Outcome-based, no seat-based** | `throttle` por plan `5K/25K/100K` `conversations.service.ts:671` | Pago por resolución verificada, no por mensaje | `Sierra Pay for outcome` + `Decagon ROI deflection 80%` (ej. `Duolingo 80% deflection`, `Chime 70% chat+voice`, `ClassPass 95% cost reduction`); nuestro `billing` ya es outcome-ish pero sin `resolution_verified` como pricing |

### Patrones arquitectónicos que ya validaron (y que ya tenemos a medias)

1. **SOPs → Agent (Ghostwriter/AOPs).** No escribes prompt largo; subes **SOPs reales** (PDF de política de cancelación, transcript de 20 cierres, foto de flujo en pizarra). El builder genera agente con guardrails. *Nosotros:* `procedures/` `T2.12` ya compila NL→graph draft, pero `booking-engine.service.ts` y `procedure-engine.service.ts` aún son FSM a mano. **Aplicar:** renombrar `procedures` a `AOPs`, permitir upload SOP → `LLM NL→graph` ya existe, solo exponerlo en dashboard como `Sierra Ghostwriter`-lite.
2. **Horizon / long-horizon planning.** No es 1 turno 5 tools; es plan de 3 días: “si no responde en 4h → follow-up A; si responde con objeción precio → offer B”. *Nosotros:* `nurturing.service.ts` `delays [4h,24h,72h]` + `dripSequence` ya es Horizon artesanal, pero sin planner LLM que elija next best action según `sentiment` + `lead score`. **Aplicar:** `Horizon`-like `nextBestAction = LLM({memory, sentiment, stage}) → tool|AOP`.
3. **Context Engine unificado.** Una sola memoria WA/IG/voz/email + `active_objects` `prompt-assembler.service.ts:321`. *Nosotros:* `activeOperationsContext` ya centraliza `appointment/order/property_booking`, pero voz y email no comparten `booking:{conv}`. **Aplicar:** clave `ctx:{contactId}` (no `booking:{convId}`) para cross-channel.
4. **Experiments + Watchtower.** Todo cambio de prompt/tool pasa por simulación 500 conversaciones sintéticas + 200 replay reales antes de prod, con métrica `containment` y `CSAT`. *Nosotros:* `simulation` queue existe, `QualityService.judgeTranscript` existe, pero no gatea deploy. **Aplicar:** `POST /procedures/:id/publish` exige `simulation_run pass >92%`.
5. **Voice Persona + texto comparten cerebro.** Mismo `systemPrompt` L1+L2, solo cambia renderer prosody. *Nosotros:* `promptAssembler` ya genera `L1+L2` cacheable `62`; falta capa `voiceHints` (`<prosody rate/pitch>`).

### Dónde lo humano rompe nuestras 3 capas actuales

- **L1 Contract hoy:** “One message, one purpose. Never ask more than one question” `prompt-assembler.service.ts:88` — correcto para eficiencia, pero humano real valida emoción primero: “Entiendo la frustración, vamos paso a paso”. **Punta 2026:** regla `empathic preamble` si `sentiment frustration>0.7` → 1 frase validación antes de directiva, sin romper `tools=[]`.
- **L2 Persona hoy:** `tone/formality/emoji/humor` estáticos. **Punta:** `tone.adaptive` — `if urgency high → short + calm`; `if joy → warm + upsell`. `Sierra Voice Personas` lo hace por idioma/segmento.
- **L3 Turn hoy:** `<language><business><vertical_context>` estático. **Punta:** `<affective><frustration 0.8><urgency high>` + `<memory.lastObjection>` para que LLM no suene a script. Nuestro `TurnContext` `shared/src/index.ts:753` puede añadir `affective: {frustration, confusion, urgency}` sin romper cache L1+L2.

### Qué copiar ya (impacto alto, esfuerzo bajo)

| Copiar de | Qué | Esfuerzo | Archivo nuestro |
|---|---|---|---|
| **Decagon AOPs** | Editor AOP natural language → compila a `procedure` graph ya existente `procedure-engine.service.ts` | Bajo — exponer `procedures` NL compiler en dashboard | `apps/api/src/modules/procedures/` + `conversations/procedure-engine.service.ts` |
| **Sierra Context Engine** | Memoria cross-channel por `contactId` no `conversationId` | Medio — migrar `booking:{conv}` → `ctx:{contact}` con TTL 1h | `conversations.service.ts:2808` `loadBookingState` |
| **Sierra Ghostwriter** | Upload SOP/transcript → agente | Bajo — ya tenemos `knowledge.service.ts` ingesta `CHUNK_MAX 2000`; añadir botón “Generate agent from SOPs” que llama `procedures` LLM compiler | `knowledge/knowledge.service.ts:1173` `media-processing` |
| **Decagon Watchtower** | Always-on QA sobre `conversation` sample 5% diario | Bajo — cron que llama `QualityService` sobre `daily_metrics` y alerta `alert_rules` `analytics/alerts.service.ts` | `analytics/alerts.service.ts:*/15` |
| **Hume EVI / Sierra Voice** | Detección frustración en texto + voz → adaptive tone | Medio — añadir `EmotionService` que usa `llmRouter` cheap `grok-4-1-fast` para `frustration/confusion` y lo inyecta en `TurnContext` | `conversations.service.ts:697` `analyzeSentiment` |
| **Sierra/Decagon Experiments** | A/B de prompt/tool por vertical | Medio — `simulation/` ya tiene `synthetic + replay`; gatear publish | `simulation/simulation.service.ts` |

### Qué no copiar (todavía)

- **Voz real-time 220ms barge-in** requiere infra WebRTC + `Cartesia`/`ElevenLabs` streaming; nuestro `outbound-queue.service.ts` 5 concurrency 20/s es batch, no streaming. Posponer hasta `widget` voz.
- **Autopilot self-improving sin humano** `Decagon Duet Autopilot` auto-edita AOPs; riesgo compliance. Mantener `human approval` `tool-policy-registry.ts:162` `A4`.
- **Outcome pricing puro** — choca con `billing_plans` actuales por asiento; migrar solo cuando `resolution_verified` `analytics/ai-resolution.service.ts` sea fuente de verdad.

### Mini-spec punta 2026 aplicable en 4 semanas

```ts
// TurnContext nuevo campo (sin romper L1+L2 cache)
affective: { frustration: 0..1, confusion: 0..1, urgency: low|mid|high, lastObjection?: string }
// PromptAssembler L1 addendum (1 línea):
// If <affective><frustration> >0.7, start with 1 empathic validation sentence in <language>, then follow <directive> exactly.
// Memory: ctx:{contactId} {bookingState, lastObjection, preferredTone} TTL 24h cross-channel
// AOPs: POST /procedures/compile {sops: File[], transcripts: string[]} → draft graph → simulation 200 runs → publish
```

## 10. Comparativa de alternativas

| Alternativa | ¿Cuándo gana? | Coste / lock-in | Por qué no para Parallext hoy |
|---|---|---|---|
| **ReAct puro (LangGraph, CrewAI, AutoGen)** | Exploración abierta, pocos constraints, multi-agente colaborativo | Alto coste tokens (5-10 iter), hallucina `booking confirmed` | No garantiza idempotencia transaccional; ya sufría antes de FSM. Log `Property is not available` prueba que LLM no verifica disponibilidad. |
| **OpenAI Assistants v2 / fine-tune** | Prototipo rápido, sin infra | Lock-in OpenAI, sin `channel_bindings` `persona.service.ts:551`, sin PgBouncer, sin `noeviction` | Multi-tenant schema-per-tenant y `marketing-content-capabilities` no portables |
| **Workflow externo (Temporal, Step Functions, XState)** | Orquestación multi-día, retries durables | Infra extra, curva aprendizaje | Overkill; Redis `booking:{conv}` + PG backup es suficiente si se corrige hold |
| **Híbrido actual (code workflow + LLM NLG) → evolucionado** | Transacciones con dinero/citas, 71 tools | Mantiene control, coste acotado | **Ganador.** Stripe/Airbnb usan mismo patrón. Evolucionar con tool retrieval + FSM tipado lo lleva a 150 tools sin degradar. |
| **MCP-only (tools remotas)** | Ecosistema extensible sin deploy | Latencia HTTP, auth por tenant, `OPAQUE_MCP` `A4` fail-closed correcto | Complemento, no reemplazo; ya integrado `mcp-client.service.ts:95` |

---

## 11. ¿Es la mejor solución? Veredicto

**Sí para el dominio, con evolución obligatoria en 3 ejes.** Híbrido determinístico es superior a ReAct puro en `conversations.service.ts:290` para booking/pagos: `backend controla flujo, LLM es voz` `prompt-assembler.service.ts:92` es best practice 2025 validada por Temporal/Booking.com.

**No es la mejor implementación del híbrido hoy** por 3 deudas estructurales que log confirma:

1. **Escalado tools por flag, no por relevancia** → bloat y hallucination. Solución estándar 2024: **Tool Retrieval** (Gorilla/ToolRAG) topK 8 por turno.
2. **FSM stringly-typed sin hold** → race `checkAvailability` → `create` y `state.date` stale. Estándar: `XState` + `slot:hold NX EX 120`.
3. **Sin harness eval continuo** → `QualityService overall 6` `1787079165769` no retroalimenta router. Estándar: `simulation` + `LangSmith` trace `turnTraceContext.ts` ya existe.

Mantener arquitectura, formalizar FSM, indexar tools.

---

## 12. Roadmap recomendado

### Fase 1 — Hotfixes (1-2 semanas, sin diseño nuevo)

- [ ] `slot:hold:{service}:{date}:{time} NX EX 120` en `booking-engine.service.ts:836` `checkAvailability` + verificar en `create` `ai-tool-executor.service.ts:191`.
- [ ] `if(state.date < todayISO) reset ask_date` `booking-engine.service.ts:259` al inicio `process`.
- [ ] `lock:conv` TTL 60s `conversations.service.ts:342` + `turnDoneKey` check antes de `saveMessage` `196`.
- [ ] Normalizar precio `price.replace(/[.\s$]/g,'')` en `response-validator.service.ts:2631` y `vacation-rental-tools.ts` output.
- [ ] Policy `create_property_booking` requiere `check_property_availability` success `tool-policy-registry.ts:217` + `tool-execution-control.service.ts:845`.
- [ ] `UNIQUE WHERE is_active` + `ORDER BY created_at DESC` `pre-chat.service.ts:33`.
- [ ] Unificar `archived_at IS NULL` en `segments.service.ts` `createSegment` y cron.
- [ ] Implementar `decay_*` en `lead-scoring.service.ts` o eliminar.

### Fase 2 — Tool Retrieval (mayor ROI, 3-4 semanas)

- [ ] Indexar `ToolDefinition` `shared/src/index.ts:600` por embedding `description + examples` (2-3 few-shot por tool, +18% accuracy Gorilla).
- [ ] `searchRelevantTools(query topK 8)` antes de `conversations.service.ts:1882`; solo 6-10 tools por turno, no 71. Cache `mcp:tools:{tenant}` ya es plantilla.
- [ ] Filtrar por `vertical:{tenant}` `verticals.service.ts:950` `toolsByIndustry` + `connectedProviders` `1931`.
- [ ] Inyectar `confirmation required / stepUp required` en `description` (visible a LLM), no solo post-call `tool-execution-control.service.ts`.
- [ ] Evitar redundancia: si `active_objects` `prompt-assembler.service.ts:321` ya contiene `property_booking` y `list_properties` success en `history.slice(-4)`, no re-ofrecer.

### Fase 3 — Robustez + Evals (4-6 semanas)

- [ ] FSM tipado `xstate` reemplaza `BookingState.step` string; visualizable y testeable.
- [ ] Summarization `>8000` tokens vía `grok-4-1-fast` barato antes de `truncateHistory` `2700`; alternativa `LLMLingua` 5× compresión.
- [ ] Fallback embeddings `Cohere embed-v3` o `bge-small` local si OpenAI sin key `knowledge.service.ts:1328`.
- [ ] Activar `simulation/` `T2.13` `simulation_runs` + `QualityService.judgeTranscript` suite regresión sintética + replay anonimizado; conectar a `LangSmith` `turnTraceContext.ts`.
- [ ] Métrica `inbound.lag` + alerta `BullMQ OnWorkerEvent failed` para `inbound-messages` (ya existe para 4 colas `instrument.ts`).
- [ ] `withReadDeadline 30s` con `AbortController` `calendar-integration.service.ts:646`.

---

## 13. Métricas y observabilidad faltante

| Métrica | Hoy | Propuesta |
|---|---|---|
| `tool_calls.total/success/latency` por tool | `tool_execution_ledger` existe `tool-execution-control.service.ts:845` no expuesto | `dashboard-analytics.service.ts` tab Tools: `success rate`, `p50/p95 latency`, `top failing tools` |
| `inbound.lag` `enqueuedAt → Processing` | No medido | Histogram + alerta `>5s p95` Sentry `instrument.ts` |
| `guardrail.price_retry_rate` | Log `warn` `1787079278801` | Counter `guardrail:price:{tenant}` + drill `tool result price vs LLM price` |
| `rerank latency/cost` | `knowledge.service.ts:763` LLM `tier_4/3` no trackeado separado | `llm:stats:{tenant}:rerank` |
| `booking hold hit rate` | No existe | `slot:hold hit/miss` Redis |

**Logs a bajar de `info` a `debug`:** `WhatsappWebhookService No messages in payload (statuses=1)` `1787079178589` spam cada 1-5s; es `status` delivery receipt, no `message`.

---

## 14. Referencias y repositorios

**Papers clave:**
- Yao et al., *ReAct: Synergizing Reasoning and Acting in Language Models*, ICLR 2023 — `arxiv:2210.03629`
- Schick et al., *Toolformer: Language Models Can Teach Themselves to Use Tools*, NeurIPS 2023 — `arxiv:2302.04761`
- Patil et al., *Gorilla: Large Language Model Connected with Massive APIs*, UC Berkeley 2023 — `arxiv:2305.15334` `github.com/ShishirPatil/gorilla`
- Qin et al., *ToolLLM: Facilitating Large Language Models to Master 16000+ Real-world APIs*, ICLR 2024 — `arxiv:2307.16789`
- Wang et al., *A Survey on Large Language Model based Autonomous Agents*, v7 2024 — `arxiv:2308.11432`
- Xi et al., *The Rise and Potential of Large Language Model Based Agents: A Survey*, 2023 — `arxiv:2309.07864`
- Zhang et al., *RAFT: Adapting Language Model to Domain Specific RAG*, 2024 — `arxiv:2403.10131`
- Asai et al., *Self-RAG: Learning to Retrieve, Generate, and Critique*, ICLR 2024 — `arxiv:2310.11511`
- Packer et al., *MemGPT: Towards LLMs as Operating Systems*, 2023 — `arxiv:2310.08560` `github.com/cpacker/MemGPT`
- Chen et al., *FrugalGPT: How to Use Large Language Models While Reducing Cost*, 2023 — `arxiv:2305.05176`
- Ong et al., *RouteLLM: Learning to Route LLMs*, 2024 — `arxiv:2406.18665`
- Ruan et al., *ToolEmu: A Framework for Evaluating LLM Tool Use*, 2023 — `arxiv:2309.15817`
- Jiang et al., *LLMLingua: Compressing Prompts*, EMNLP 2023 — `arxiv:2310.05736`

**Estándares y repos:**
- `Anthropic Model Context Protocol` — Nov 2024 `modelcontextprotocol.io` `github.com/modelcontextprotocol`
- `OpenAI Function Calling` — Jun 2023 `platform.openai.com/docs/guides/function-calling` `github.com/openai/openai-cookbook`
- `LangGraph` — `github.com/langchain-ai/langgraph` `StateGraph + ToolNode + checkpointer`
- `CrewAI` — `github.com/crewAIInc/crewAI`
- `AutoGen` — `github.com/microsoft/autogen`
- `Pydantic AI` — `github.com/pydantic/pydantic-ai` (validación schema pre-tool)
- `LiteLLM` — `github.com/BerriAI/litellm` (multi-provider `MODEL_REGISTRY` unificado)
- `OpenRouter` — `openrouter.ai` (fallback chains)
- `Temporal` — `github.com/temporalio/temporal` (deterministic workflows)
- `XState` — `github.com/statelyai/xstate` (FSM tipado)
- `E2B` — `github.com/e2b-dev/e2b` (tool sandbox)
- `Braintrust` `braintrust.dev` / `LangSmith` `smith.langchain.com` / `OpenAI Evals` `github.com/openai/evals` (harness)
- `Weaviate` `weaviate.io` / `Qdrant` `qdrant.tech` (RRF hybrid)
- `Guardrails AI` `github.com/guardrails-ai/guardrails` / `NeMo Guardrails` `github.com/NVIDIA/NeMo-Guardrails`

**Research Parallext existente a reutilizar:**
- `docs/vertical-strategy.md` (18 verticales, bootstrap `verticals.service.ts`)
- `docs/external-crm-integration-research.md` (no CRM externo, decisión HITL correcta)
- `docs/competitive-analysis-2026-q2.md` + `docs/vertical-competitive-matrix-2026-08.md`
- `docs/observability-manual.md` (Grafana + Loki + Promtail) + `docs/operations-runbook.md`

---

## 15. Anexos — trazas y archivos clave

**Trazas log analizadas:** `hostname 6a5110788e12` `tenant 3e8ad32e-a16b-42e6-9634-b8e8cc29292d` `wamid.HBgMNTcz...` `conversation 70b36d04 → f6d4a49a` `agent Amazon Minimalist 074489d5` `time 1787079106338` (≈2026-08-18).

**Archivos clave citados:**

```
apps/api/src/modules/conversations/conversations.service.ts:290 runTurn / 1456 generateResponse / 1882 registro tools / 1994 tools=[] / 2162 loop 5 iter / 2700 truncateHistory
apps/api/src/modules/conversations/prompt-assembler.service.ts:43 assemble / 77 L1 contract / 125 L3 turn / 321 active_objects
apps/api/src/modules/conversations/booking-engine.service.ts:259 FSM / 836 checkAvailability
apps/api/src/modules/conversations/intent-interpreter.service.ts:75 deterministicExtract / 381 llmInterpret
apps/api/src/modules/conversations/procedure-engine.service.ts SOP
apps/api/src/modules/conversations/ai-tool-executor.service.ts:87 execute / 191 switch tools
apps/api/src/modules/conversations/tool-policy-registry.ts:104 registry 71 / 346 MCP opaque / 384 sequential
apps/api/src/modules/conversations/tool-execution-control.service.ts:845 preflight / 141 confirmation
apps/api/src/modules/conversations/response-validator.service.ts:2631 validatePrices
apps/api/src/modules/ai/router/llm-router.service.ts:31 registry / 49 FALLBACK_CHAINS / 253 buildCandidates / 525 trackStats
apps/api/src/modules/knowledge/knowledge.service.ts:652 searchRelevant RRF K60 / 1328 embed OpenAI-only
apps/api/src/modules/persona/persona.service.ts:531 resolvePersonaForChannel / 551 channel_bindings GIN
apps/api/src/modules/handoff/handoff.service.ts:75 shouldHandoff / 428 tryAutoAssign
apps/api/src/modules/inbound/inbound-queue.processor.ts:30 concurrency 4
apps/api/src/modules/channels/channel-gateway.service.ts:61 adapters
packages/shared/src/index.ts:261 ToolsConfig / 600 ToolDefinition / 753 TurnContext
```

**Comando verificación local:**

```bash
cd apps/api && npx tsc --noEmit
cd apps/api && npm run test:bootstrap
cd apps/dashboard && npx tsc --noEmit
docker exec parallext-pgbouncer pg_isready -h localhost -p 6432
```

---

*Documento vivo. Actualizar tras Fase 1 con métricas `inbound.lag` y `guardrail.price_retry_rate`.*
