# Parallly — Análisis Competitivo Exhaustivo (Mayo 2026)

## Resumen Ejecutivo

**Competidores analizados:** 13 plataformas líderes en 5 categorías
**Áreas funcionales evaluadas:** 25 dimensiones
**Score global Parallly:** 7.8/10 (promedio ponderado) — *actualizado tras 12 features implementadas en Mayo 2026*
**Posición en el mercado:** Top 3 en AI conversacional y adaptación vertical; gap principal restante en mobile y ecosistema de integraciones nativas

### Hallazgo Principal

Parallly ocupa un nicho único en la intersección de tres mercados que ningún competidor cubre completamente:
1. **Plataformas conversacionales AI** (Respond.io, Manychat) — breadth pero sin verticales
2. **SaaS verticales** (Mindbody, Guesty, Toast) — depth pero sin AI conversacional
3. **All-in-one** (GoHighLevel) — breadth + SaaS mode pero sin profundidad vertical real

**Ventaja competitiva #1:** AI conversacional + 12 verticales con auto-bootstrap + booking nativo
**Brecha competitiva #1:** Ecosistema de integraciones nativas (6/10 vs industria 8/10) — mejorada significativamente con REST API pública, API keys, webhooks y Swagger docs

---

## Metodología

### Competidores Analizados

| Categoría | Plataformas | Relevancia |
|---|---|---|
| **Competidores directos** (multi-canal messaging) | Respond.io, Trengo | Más cercanos en funcionalidad core |
| **Gold standard** (soporte + AI) | Intercom, Zendesk | Referencia de calidad en AI, inbox, UX |
| **CRM + messaging** | HubSpot, Kommo (ex-amoCRM) | CRM con capacidades conversacionales |
| **Messaging-focused** | Manychat, Wati, Tidio | Automatización por canal específico |
| **All-in-one** | GoHighLevel | Competidor filosófico más cercano |
| **Booking** | Calendly, Cal.com | Referencia en scheduling |
| **Verticales** | Guesty, Mindbody, Toast, Cliniko | Referencia por industria |

### Criterios de Puntuación (1-10)

| Score | Significado |
|---|---|
| 9-10 | Líder de mercado / mejor que cualquier competidor |
| 7-8 | Competitivo / a la par con los mejores |
| 5-6 | Funcional pero con gaps notables |
| 3-4 | Básico / muy por debajo del estándar |
| 1-2 | Inexistente o no funcional |

---

## PARTE 1: SCORECARD GLOBAL

### Resumen por Área Funcional

| # | Área Funcional | Parallly | Mejor Competidor | Score Competidor | Gap | Prioridad |
|---|---|---|---|---|---|---|
| 1 | Canales de messaging | **8/10** ⬆ | Respond.io (12+ canales) | 9/10 | -1 | 🟡 Mantener |
| 2 | AI Conversacional | **8/10** | Intercom Fin (67% resolución) | 9/10 | -1 | 🟡 Mantener |
| 3 | AI Knowledge/RAG | **8/10** ✅ | Intercom (multi-source) | 9/10 | -1 | 🟡 Mantener |
| 4 | Multi-Agente AI | **9/10** | GoHighLevel (básico) | 5/10 | **+4** ✅ | Diferenciador |
| 5 | LLM Router Multi-Provider | **9/10** | Zendesk (multi-LLM) | 7/10 | **+2** ✅ | Diferenciador |
| 6 | CRM — Contactos | **7/10** | HubSpot | 10/10 | -3 | 🟡 Media |
| 7 | CRM — Pipeline/Deals | **7/10** ⬆ | HubSpot | 10/10 | -3 | 🟡 Media |
| 8 | CRM — Lead Scoring | **6/10** | HubSpot (predictivo) | 9/10 | -3 | 🟡 Media |
| 9 | CRM — Segmentación | **6/10** | Respond.io / HubSpot | 9/10 | -3 | 🟡 Media |
| 10 | Automatización / Workflows | **8/10** ⬆ | Respond.io (100 pasos) | 9/10 | -1 | 🟡 Mantener |
| 11 | Inbox / Consola Agente | **8/10** ⬆ | Intercom | 9/10 | -1 | 🟡 Mantener |
| 12 | Broadcasting / Campañas | **7/10** ⬆ | Manychat (multi-canal) | 8/10 | -1 | 🟡 Mantener |
| 13 | Analytics / Reportes | **8/10** ⬆ | Zendesk Explore | 9/10 | -1 | 🟡 Mantener |
| 14 | Booking / Citas | **8/10** | Calendly | 9/10 | -1 | 🟡 Mantener |
| 15 | Knowledge Base Pública | **7/10** | Zendesk Guide | 9/10 | -2 | 🟡 Media |
| 16 | Billing / Pagos | **7/10** | HubSpot (Stripe nativo) | 8/10 | -1 | 🟢 Baja |
| 17 | Compliance / Seguridad | **7/10** | Zendesk (SOC2+FedRAMP) | 9/10 | -2 | 🟠 Alta |
| 18 | API / Integraciones | **6/10** ⬆ | Zendesk (1,800+ apps) | 10/10 | -4 | 🟠 Alta |
| 19 | Mobile Experience | **4/10** | Respond.io (nativa) | 8/10 | -4 | 🔴 Crítica |
| 20 | UX / Diseño | **7/10** | Intercom | 9/10 | -2 | 🟡 Media |
| 21 | Web Chat Widget | **8/10** ⬆ | Tidio | 9/10 | -1 | 🟡 Mantener |
| 22 | White Label / Multi-tenant | **7/10** | GoHighLevel (SaaS mode) | 9/10 | -2 | 🟡 Media |
| 23 | E-commerce | **5/10** | Tidio/Manychat (Shopify) | 9/10 | -4 | 🟡 Media |
| 24 | Adaptación Vertical | **9/10** | Ninguno comparable | 3/10 | **+6** ✅ | Diferenciador |
| 25 | Onboarding | **7/10** | Intercom | 8/10 | -1 | 🟢 Baja |

### Score Global

| Métrica | Valor anterior | Valor actual (Mayo 2026) |
|---|---|---|
| **Score promedio** | 6.7/10 | 7.0/10 |
| **Score ponderado** (por impacto en ventas) | 7.1/10 | **7.8/10** ⬆ |
| **Áreas donde lideramos** (9-10) | 3 | 3 (Multi-Agente, LLM Router, Verticales) |
| **Áreas competitivas** (7-8) | 11 | **17** ⬆ (+6 áreas subieron a competitivas) |
| **Áreas con gap notable** (4-6) | 9 | **5** (Lead Scoring, Segmentación, API, E-commerce, Mobile) |
| **Áreas críticas** (≤3) | 2 | **0** ⬆ (API/Integraciones subió de 3 a 6) |

> **12 features implementadas** en Mayo 2026 eliminaron las 2 áreas críticas y movieron 6 áreas a nivel competitivo. El gap más significativo restante es Mobile (4/10).

---

## PARTE 2: ANÁLISIS DETALLADO POR ÁREA FUNCIONAL

---

### 1. CANALES DE MESSAGING — 8/10 ⬆ (antes 7/10)

**Lo que tiene Parallly:**
- 7 canales: WhatsApp (Business API), Instagram DM, Messenger, Telegram, SMS (Twilio), Web Chat Widget, **Email** (nuevo)
- Patrón adaptador (`IChannelAdapter`) permite agregar canales
- Idempotencia webhook con Redis (`idem:{channel}:{id}`, 24h TTL)
- Token refresh automático para Instagram (cron diario @6AM)
- Validación HMAC-SHA256 para Meta webhooks

> **Implementado (Mayo 2026):** Email como canal completo — envío/recepción, thread tracking, sanitización HTML. Parallly pasa de 6 a 7 canales nativos.

**Mejor competidor — Respond.io (9/10):**
- 12+ canales nativos: WhatsApp, Instagram, Messenger, TikTok, Telegram, SMS, Email, VoIP, Viber, LINE, WeChat + canales custom
- Custom Channel API para conectar cualquier plataforma
- Cross-channel contact merge automático
- WhatsApp Business Calling API (voz dentro de WhatsApp)
- No hay límite de canales conectados

**Gap analysis:**
| Feature | Parallly | Respond.io | Trengo | Zendesk |
|---|---|---|---|---|
| WhatsApp | ✅ | ✅ | ✅ (add-on) | ✅ |
| Instagram DM | ✅ | ✅ | ✅ | ✅ |
| Messenger | ✅ | ✅ | ✅ | ✅ |
| Telegram | ✅ | ✅ | ✅ | ✅ |
| SMS | ✅ | ✅ | ✅ (add-on) | ✅ |
| Web Chat | ✅ | ✅ | ✅ | ✅ |
| Email | ✅ (nuevo) | ✅ | ✅ | ✅ |
| TikTok | ❌ | ✅ | ❌ | ❌ |
| LINE | ❌ | ✅ | ❌ | ✅ |
| Viber | ❌ | ✅ | ❌ | ✅ |
| WeChat | ❌ | ✅ | ❌ | ✅ |
| Voice/Phone | ❌ | ✅ | ✅ | ✅ |
| Custom Channel API | ❌ | ✅ | ❌ | ✅ |
| WA Business Calling | ❌ | ✅ | ❌ | ❌ |

**Recomendaciones:**
1. ~~**Email como canal** (ALTO)~~ — ✅ **COMPLETADO Mayo 2026.** Canal email completo con envío/recepción, thread tracking y sanitización HTML
2. **Voice/Phone** (MEDIO) — Respond.io y Zendesk ofrecen voz. Considerar integración Twilio Voice
3. **Custom Channel API** (MEDIO) — Permitiría que terceros conecten canales sin modificar código
4. TikTok, LINE, Viber, WeChat son de baja prioridad para LatAm

---

### 2. AI CONVERSACIONAL — 8/10

**Lo que tiene Parallly:**
- LLM Router con task-based routing (conversation vs tool_calling)
- 5 proveedores (OpenAI, Anthropic, Gemini, DeepSeek, xAI)
- 4 tiers de modelos con fallback automático
- Circuit breaker por proveedor (2min cooldown, Redis)
- 17 herramientas AI por vertical (booking, CRM, búsqueda)
- Procesamiento multimedia (audio Whisper + imagen Vision)
- Detección de idioma automática
- Prompt assembler de 3 capas (contrato L1 + persona L2 + turno L3)
- Safety guardrails hardcoded en Layer 1
- Intent interpreter determinístico
- Booking engine determinístico (no depende de LLM para flujo)

**Mejor competidor — Intercom Fin (9/10):**
- 67% tasa de resolución promedio (40M+ conversaciones resueltas)
- $0.99 por resolución (pricing basado en resultados)
- RAG multi-fuente (help center, PDFs, URLs, Confluence, Notion, Guru)
- Fin Actions: ejecuta acciones en sistemas externos (refunds, cancelaciones, updates CRM)
- Fin Voice: llamadas telefónicas con AI en 28 idiomas
- Fin Vision: procesa imágenes (screenshots, recibos)
- MCP connectors para Shopify, Stripe, Salesforce, Jira
- "Procedures" para flujos multi-paso en lenguaje natural
- Sim/test suite para probar antes de deploy

**Respond.io AI Agent (8/10):**
- AI Agents autónomos con GPT-5 (según claim)
- Tool calling + HTTP requests desde AI
- Multimodal (texto, imágenes, PDFs, audio)
- Multilingüe auto-detect
- AI Objectives dentro de workflows

**Comparación directa:**

| Capacidad | Parallly | Intercom | Respond.io |
|---|---|---|---|
| Multi-LLM con fallback | ✅ 5 providers | ❌ Propio | ❌ Single |
| Tool calling nativo | ✅ 17 tools | ✅ MCP connectors | ✅ HTTP + workflows |
| Procesamiento audio | ✅ Whisper | ❌ | ❌ |
| Procesamiento imagen | ✅ Vision API | ✅ Fin Vision | ✅ |
| RAG / Knowledge | ✅ pgvector | ✅ Multi-source | ✅ Docs + URLs |
| Booking determinístico | ✅ State machine | ❌ | ❌ |
| Multi-agente por canal | ✅ Plan-gated | ❌ | ❌ |
| Personas configurables | ✅ YAML + versioning | ❌ Tone settings | ❌ |
| Circuit breaker | ✅ Redis | ❌ | ❌ |
| Safety guardrails | ✅ Hardcoded L1 | ✅ | ✅ |
| Resolution rate tracking | ✅ (nuevo) | ✅ 67% | ❌ |
| Pricing por resolución | ❌ | ✅ $0.99/res | ❌ |
| Voice AI (llamadas) | ❌ | ✅ 28 idiomas | ❌ |

**Dónde Parallly es mejor:**
- Multi-LLM con circuit breaker (ningún competidor tiene 5 providers con fallback automático)
- Multi-agente (1 agente por canal, plan-gated) — único en el mercado
- Booking determinístico que no depende del LLM para decisiones de flujo
- Procesamiento multimedia integrado (audio + imagen) con throttling de 6 capas

**Dónde nos falta:**
- ~~No medimos "resolution rate" como Intercom~~ — ✅ **COMPLETADO Mayo 2026** (tracking de tasa de resolución AI con tendencia y desglose por canal)
- No ofrecemos pricing por resolución (modelo diferente pero Intercom demuestra que funciona)
- No tenemos Voice AI (llamadas telefónicas con AI)
- No tenemos test/simulation suite para probar AI antes de producción

**Recomendaciones:**
1. ~~**Medir resolution rate** (ALTO)~~ — ✅ **COMPLETADO Mayo 2026.** AI resolution rate tracking con tendencia temporal y breakdown por canal
2. **AI test console mejorada** (MEDIO) — Expandir el Agent Test Console para simular escenarios completos
3. **Voice AI** (BAJO, largo plazo) — Integración Twilio/Retell para llamadas con AI

---

### 3. AI KNOWLEDGE / RAG — 8/10 ✅ (confirmado, consolidado)

**Lo que tiene Parallly:**
- Knowledge Base con pgvector para embeddings
- Upload de documentos + crawling de URLs
- Categorías, quality scoring, AI article suggestions
- Multi-language auto-detection
- Document versioning
- Bulk import
- 5-tier knowledge hierarchy
- Portal público `/kb/{tenant-slug}`
- **Content gap analytics** (consultas sin respuesta, clustering de queries, detección de contenido obsoleto) — nuevo
- **Feedback widget** (thumbs up/down en artículos KB) — nuevo
- **Satisfaction scoring** por artículo — nuevo
- **Query clustering** para identificar temas recurrentes — nuevo

> **Implementado (Mayo 2026):** Content gap analytics completo (consultas no respondidas, satisfaction scoring, detección de contenido stale, query clustering). Feedback widget con thumbs up/down. Esto cierra el gap con Intercom en analytics de búsquedas fallidas.

**Mejor competidor — Intercom (9/10):**
- Multi-source: Help Center, PDFs, URLs, Confluence, Notion, Guru, custom databases
- AI article generator crea contenido desde descripciones
- Internal articles separados para agentes vs público
- Analytics de búsquedas fallidas (identifica gaps de contenido)
- Import one-click desde Zendesk

**Recomendaciones:**
1. **Conectores a fuentes externas** (MEDIO) — Confluence, Notion, Google Drive como fuentes de knowledge
2. ~~**Analytics de búsquedas fallidas** (ALTO)~~ — ✅ **COMPLETADO Mayo 2026.** Content gap analytics con query clustering, satisfaction scoring y detección de contenido obsoleto
3. **Artículos internos vs públicos** (BAJO) — Separar content para agentes del content público

---

### 4. MULTI-AGENTE AI — 9/10 ✅ DIFERENCIADOR

**Lo que tiene Parallly:**
- Múltiples agentes AI por tenant (plan-gated: 1/3/10/∞)
- 1 agente por canal (hard rule)
- 6 templates built-in (Sales Advisor, Support Agent, FAQ Bot, Appointment Scheduler, Lead Qualifier, Blank)
- Templates custom por usuario
- Schedule por agente
- YAML/JSON config con versioning
- `getPersonaForChannel()` con 3-tier fallback
- 17 herramientas AI específicas por vertical

**Competencia:**
- **Respond.io:** No tiene multi-agente. Un bot por workspace
- **Intercom:** Un Fin per workspace. Customizable pero no multi-agente
- **GoHighLevel:** AI básico, no multi-agente
- **Manychat:** Un bot per account
- **Wati:** Un AI agent per account
- **Tidio:** Un Lyro per account

**Veredicto:** Parallly es el ÚNICO que ofrece múltiples agentes AI configurables por canal con personas independientes. Esto es un diferenciador masivo.

**Recomendación:** Mantener y comunicar como ventaja competitiva principal.

---

### 5. LLM ROUTER MULTI-PROVIDER — 9/10 ✅ DIFERENCIADOR

**Lo que tiene Parallly:**
- 5 proveedores (OpenAI, Anthropic, Gemini, DeepSeek, xAI)
- 4 tiers de modelos con fallback automático
- Task-based routing (conversation vs tool_calling)
- Circuit breaker por proveedor (Redis, 2min cooldown)
- Plan-gated tier access (starter=tier_3+4, enterprise=all)
- Unified AI usage tracking per tenant

**Competencia:**
- **Zendesk:** Multi-LLM (OpenAI, Azure, Amazon Bedrock, Google Cloud) — el más cercano
- **Intercom:** Propio + Anthropic Claude — no es configurable
- **Respond.io:** GPT-5 (single provider)
- **Tidio:** Anthropic Claude (single)
- **Wati:** OpenAI (single)
- **Manychat:** OpenAI (single)

**Veredicto:** Parallly tiene el router más sofisticado del mercado. 5 providers con circuit breaker, fallback automático y task-based routing es único.

---

### 6. CRM — CONTACTOS — 7/10

**Lo que tiene Parallly:**
- 55+ endpoints CRM
- CRUD leads completo + bulk operations
- Import/export CSV
- Custom attributes dinámicos
- Tags y etiquetas
- Historial de actividades
- Notas y tareas
- Vista 360° del contacto
- Identity merge cross-channel
- AI insights por lead

**Mejor competidor — HubSpot (10/10):**
- Contactos, empresas, deals como objetos separados con relaciones
- Timeline de actividad completa (emails, llamadas, reuniones, visitas web, formularios)
- Predictive lead scoring con ML
- 1,000+ propiedades built-in
- Deduplicación automática
- Enriquecimiento de datos
- Association labels
- CRM gratuito hasta 1M contactos

**Kommo (7/10):**
- CRM nativo para WhatsApp
- Pipeline visual con drag-and-drop
- Salesbot (chatbot dentro del CRM)
- Digital pipeline (auto-progreso basado en acciones del lead)
- Popular en LATAM

**Gap:**
| Feature | Parallly | HubSpot | Kommo |
|---|---|---|---|
| Contactos CRUD | ✅ | ✅ | ✅ |
| Empresas/Organizaciones | ❌ | ✅ | ✅ |
| Custom fields | ✅ | ✅ 1,000+ | ✅ |
| Timeline actividad | ⚠️ Básico | ✅ Completo | ✅ |
| Identity merge | ✅ Cross-channel | ✅ Dedup | ❌ |
| Import/Export CSV | ✅ | ✅ | ✅ |
| Lead scoring | ✅ Configurable | ✅ Predictivo ML | ❌ |
| AI insights | ✅ | ✅ Breeze AI | ❌ |
| Enriquecimiento datos | ❌ | ✅ Clearbit | ❌ |

**Recomendaciones:**
1. **Objeto "Empresa/Organización"** (MEDIO) — Agrupar contactos por empresa
2. **Timeline de actividad enriquecido** (MEDIO) — Incluir todos los touchpoints (mensajes, citas, pagos, visitas)
3. **Enriquecimiento de datos** (BAJO) — Integración con APIs de enrichment

---

### 7. CRM — PIPELINE / DEALS — 7/10 ⬆ (antes 6/10)

**Lo que tiene Parallly:**
- Pipeline Kanban con drag-and-drop
- Stages configurables con color y posición
- Deals CRUD completo
- Auto-progreso desde señales de conversación
- Deal approval workflow (request/approve/reject)
- Stage transitions tracking
- CRM analytics (funnel, velocity, win-loss, leaderboard)
- **Múltiples pipelines** (plan-gated) — nuevo

> **Implementado (Mayo 2026):** Soporte para múltiples pipelines por tenant (plan-gated). Permite tener pipelines separados para ventas, soporte, onboarding, etc.

**Mejor competidor — HubSpot (10/10):**
- Múltiples pipelines por equipo
- Forecasting con AI (predicción de cierre)
- Deal rotting alerts
- Weighted pipeline value
- Custom deal properties ilimitadas
- Automations en pipeline (mover deal → trigger workflow)
- Quotes + proposals desde deals
- Products/line items en deals
- Revenue attribution
- Deal scoring predictivo

**Gap crítico:**

| Feature | Parallly | HubSpot |
|---|---|---|
| Pipeline Kanban | ✅ | ✅ |
| Múltiples pipelines | ✅ (nuevo, plan-gated) | ✅ |
| Forecasting AI | ❌ | ✅ |
| Deal rotting | ❌ | ✅ |
| Weighted value | ❌ | ✅ |
| Quotes/Proposals | ❌ | ✅ |
| Products en deals | ❌ | ✅ |
| Revenue attribution | ❌ | ✅ |
| Auto-progress | ✅ (conversación) | ✅ (workflow) |
| Approval workflow | ✅ | ✅ |

**Recomendaciones:**
1. ~~**Múltiples pipelines** (ALTO)~~ — ✅ **COMPLETADO Mayo 2026.** Múltiples pipelines por tenant, plan-gated
2. **Deal rotting alerts** (MEDIO) — Alerta cuando un deal lleva X días sin movimiento
3. **Weighted pipeline value** (MEDIO) — Valor ponderado por probabilidad de cierre
4. **Forecasting básico** (BAJO) — Proyección de revenue basada en pipeline velocity

---

### 8. CRM — LEAD SCORING — 6/10

**Lo que tiene Parallly:**
- Scoring configurable con 5 factores (sliders)
- Config CRUD endpoints
- AI insights por lead

**Mejor competidor — HubSpot (9/10):**
- Predictive lead scoring con ML (analiza deals ganados/perdidos para predecir)
- Score manual + automático
- Múltiples scorecards por objeto
- Decay automático por inactividad
- Scoring basado en comportamiento web + email engagement + propiedades

**Recomendaciones:**
1. **Scoring basado en actividad conversacional** (ALTO) — Puntos por mensajes enviados, citas agendadas, productos consultados
2. **Decay automático** (MEDIO) — Reducir score si no hay interacción en X días

---

### 9. CRM — SEGMENTACIÓN — 6/10

**Lo que tiene Parallly:**
- Segments con filtros
- Custom attributes para filtrado
- Tags en contactos

**Mejor competidor — Respond.io (9/10):**
- Hasta 500 segmentos
- Filtros por cualquier atributo de contacto
- Segmentos dinámicos (se actualizan automáticamente)
- Segmentos conectados directamente a broadcasts
- Filtros por lifecycle stage + canal + tags + campos custom

**Recomendaciones:**
1. **Conectar segmentos a broadcasts** (ALTO) — Ya mencionado en audit, ejecutar esta conexión
2. **Segmentos dinámicos auto-refresh** (MEDIO)
3. **Filtros compuestos con OR/AND** (MEDIO)

---

### 10. AUTOMATIZACIÓN / WORKFLOWS — 8/10 ⬆ (antes 6/10)

**Lo que tiene Parallly:**
- Visual Automation Builder (React Flow canvas)
- Trigger → conditions → actions
- Nurturing sequences (3-attempt)
- BullMQ processors
- Execution audit trail
- Delay nodes
- **HTTP request step** con variable interpolation — nuevo
- **Drip sequences** con stop conditions — nuevo
- **Automation templates library** (15+ templates, 8 categorías, 12 industrias) — nuevo

> **Implementado (Mayo 2026):** HTTP request step (permite API calls desde workflows, desbloqueando integraciones sin Zapier), interpolación de variables en acciones, drip sequences con condiciones de parada, y librería de 15+ templates pre-construidos organizados por 8 categorías y 12 industrias. Esto coloca a Parallly a la par con Respond.io y cerca de GoHighLevel/Manychat.

**Mejor competidor — Respond.io (9/10):**
- Visual Workflow Builder (canvas drag-and-drop)
- Hasta 100 pasos por workflow
- Hasta 9 branches por paso de branching
- Triggers: mensaje, tag, campo actualizado, ad click, lifecycle change, manual
- Actions: send message, assign, update field, HTTP request, trigger otro workflow, AI Objective
- Undo/redo, branch reordering
- AI Agent Actions dentro de workflows
- Google Sheets integration nativa en workflows

**Intercom (8/10):**
- Drag-and-drop Workflows builder
- Series para campañas multi-paso
- Bot builder para qualification/routing
- Fin integration dentro de workflows

**GoHighLevel (8/10):**
- 100+ trigger types
- Recipes/templates pre-built
- Visual builder con branching complejo
- HTTP webhooks como actions
- A/B split testing en workflows

**Manychat (8/10):**
- Flow Builder best-in-class para social media
- Conditional branching, A/B testing
- Delays, randomizers, external API calls
- 25+ templates pre-built
- AI Flow Builder Assistant (genera flows desde prompts)

**Gap crítico:**

| Feature | Parallly | Respond.io | GoHighLevel | Manychat |
|---|---|---|---|---|
| Visual builder | ✅ | ✅ | ✅ | ✅ Best-in-class |
| Max steps | ? | 100 | Ilimitado | Ilimitado |
| Branching | ✅ Básico | ✅ 9 branches | ✅ Complejo | ✅ + A/B |
| HTTP request step | ✅ (nuevo) | ✅ | ✅ | ✅ |
| Delay configurable | ✅ | ✅ | ✅ | ✅ |
| Drip sequences | ✅ (nuevo) | ❌ | ✅ | ✅ |
| A/B testing | ❌ | ❌ | ✅ | ✅ |
| Templates library | ✅ 15+ (nuevo) | ❌ | ✅ 100+ | ✅ 25+ |
| Variable interpolation | ✅ (nuevo) | ✅ | ✅ | ✅ |
| AI dentro de workflow | ❌ | ✅ AI Objectives | ❌ | ✅ AI Step |
| Undo/redo | ❌ | ✅ | ❌ | ❌ |
| Trigger: webhook inbound | ❌ | ✅ | ✅ | ✅ |
| Action: Google Sheets | ❌ | ✅ | ✅ | ✅ |

**Recomendaciones:**
1. ~~**HTTP request step** (CRÍTICO)~~ — ✅ **COMPLETADO Mayo 2026.** HTTP request step con variable interpolation. Desbloquea miles de integraciones sin Zapier
2. ~~**Templates library** (ALTO)~~ — ✅ **COMPLETADO Mayo 2026.** 15+ templates pre-built, 8 categorías, 12 industrias
3. **Trigger: webhook inbound** (ALTO) — HTTP endpoint que inicia un workflow
4. **A/B split testing** (MEDIO) — Branching aleatorio para probar variantes de mensaje
5. **AI step en workflows** (MEDIO) — Invocar LLM Router como un paso dentro del workflow

> *Nota: Drip sequences con stop conditions también fueron implementadas en Mayo 2026, cerrando otro gap vs Manychat/Intercom.*

---

### 11. INBOX / CONSOLA AGENTE — 8/10 ⬆ (antes 7/10)

**Lo que tiene Parallly:**
- Inbox unificado via WebSocket (/inbox namespace)
- Assignment manual + auto-assignment skill-based
- Internal notes
- Macros/canned responses
- Snooze
- SLA deadline (5 min default, escalation cron */2 min)
- Copilot (AI suggestions)
- Conversation auto-summary at handoff
- Typing indicators
- Socket reconnection handling
- **Collision detection** (viewer indicators + heartbeat) — nuevo

> **Implementado (Mayo 2026):** Collision detection con indicadores de quién está viendo cada conversación y heartbeat para detectar presencia. Evita que 2 agentes respondan simultáneamente al mismo cliente.

**Mejor competidor — Intercom (9/10):**
- Diseño messaging-app, keyboard-first (CMD+K)
- Dark mode
- Copilot AI con suggestions + drafts + traducción automática
- Collision detection (flags cuando 2 agentes editan)
- Customer context panel completo (custom attributes, historial, empresa)
- Product Tours integrados
- Tickets + conversations en el mismo workspace
- Performance: "blazingly fast"
- G2: 4.5/5 (3,755 reviews)

**Gap:**

| Feature | Parallly | Intercom | Zendesk |
|---|---|---|---|
| Inbox unificado | ✅ | ✅ | ✅ |
| WebSocket real-time | ✅ | ✅ | ✅ |
| Auto-assignment | ✅ Skill-based | ✅ Workflow | ✅ Skills + round-robin |
| SLA management | ✅ 5min + escalation | ✅ | ✅ Avanzado |
| Collision detection | ✅ (nuevo) | ✅ | ✅ |
| Keyboard shortcuts | ❌ | ✅ CMD+K | ⚠️ Parcial |
| AI Copilot | ✅ Suggestions | ✅ Drafts + translate | ✅ $50/agent add-on |
| Auto-summary | ✅ | ✅ | ✅ |
| Canned responses | ✅ | ✅ | ✅ Macros |
| Side conversations | ❌ | ❌ | ✅ |
| Visitor monitoring | ❌ | ✅ | ✅ |
| Typing preview | ❌ | ✅ | ✅ |

**Recomendaciones:**
1. ~~**Collision detection** (ALTO)~~ — ✅ **COMPLETADO Mayo 2026.** Viewer indicators con heartbeat para detectar presencia en tiempo real
2. **Keyboard shortcuts** (MEDIO) — CMD+K para buscar conversaciones, atajos para asignar/resolver
3. **Typing preview del cliente** (BAJO) — Ver lo que el cliente está escribiendo antes de enviar

---

### 12. BROADCASTING / CAMPAÑAS — 7/10 ⬆ (antes 6/10)

**Lo que tiene Parallly:**
- Broadcast multi-canal (WA + Email + SMS)
- BullMQ rate limit 80 msg/s
- Smart recipient resolution
- Per-channel stats
- Scheduling
- Segment targeting
- **A/B testing** con significancia estadística, auto-winner selection, analytics por variante — nuevo

> **Implementado (Mayo 2026):** A/B testing completo en broadcasts con significancia estadística, selección automática de ganador y analytics a nivel de variante. Cierra gap con Manychat.

**Mejor competidor — Manychat (8/10):**
- Broadcasts en 7 canales (Messenger, IG, WA, TikTok, Telegram, SMS, Email)
- A/B testing en broadcasts
- Segmented audiences avanzados
- Revenue attribution (Shopify)
- Templates de broadcast
- Growth Tools (pop-ups, QR codes, comment triggers)

**Intercom (8/10):**
- Series multi-step (email + in-app + tours + bots)
- Behavioral targeting (atributos, eventos, segmentos)
- Banners, tooltips, modals in-app
- Product Tours
- Proactive engagement (no solo reactivo)

**Gap:**

| Feature | Parallly | Manychat | Intercom |
|---|---|---|---|
| Multi-canal broadcast | ✅ WA+Email+SMS | ✅ 7 canales | ✅ Email+in-app |
| Scheduling | ✅ | ✅ | ✅ |
| A/B testing | ✅ (nuevo) | ✅ | ✅ Series |
| Revenue attribution | ❌ | ✅ | ❌ |
| Growth tools | ❌ | ✅ Pop-ups, QR | ✅ Banners, tooltips |
| Drip sequences | ✅ (nuevo) | ✅ | ✅ Series |
| In-app messages | ❌ | ❌ | ✅ |

**Recomendaciones:**
1. ~~**A/B testing en broadcasts** (MEDIO)~~ — ✅ **COMPLETADO Mayo 2026.** A/B testing con significancia estadística, auto-winner y analytics por variante
2. ~~**Drip sequences** (ALTO)~~ — ✅ **COMPLETADO Mayo 2026** (implementado como parte de automatización, con stop conditions)
3. **Campaign ROI tracking** (MEDIO) — Atribución de conversiones a campañas específicas

---

### 13. ANALYTICS / REPORTES — 8/10 ⬆ (antes 7/10)

**Lo que tiene Parallly:**
- 8 tabs analytics dashboard
- CRM analytics (funnel, velocity, win-loss, leaderboard, sources)
- Agent analytics (performance, CSAT)
- Custom report builder (16 métricas, 4 tipos gráfico)
- Scheduled reports (weekly/monthly email)
- Alert rules con threshold
- BI API (7 endpoints, X-API-Key)
- LLM observability (cost/model/tenant drill-down)
- CSV export
- AI Usage Dashboard (unified tracking)
- **AI resolution rate tracking** (tendencia temporal, desglose por canal) — nuevo
- **Content gap analysis para KB** (consultas sin respuesta, satisfaction scoring, detección stale) — nuevo

> **Implementado (Mayo 2026):** AI resolution rate tracking con tendencia temporal y breakdown por canal. Content gap analysis para Knowledge Base (consultas no respondidas, satisfaction scoring, detección de contenido obsoleto). Parallly ahora tiene analytics a nivel de Intercom Fin en métricas de resolución AI.

**Mejor competidor — Zendesk Explore (9/10):**
- Pre-built dashboards por módulo (Support, Talk, Guide, Chat)
- Custom report builder con query builder (métricas + atributos)
- Real-time dashboards para call centers
- Workforce Management (scheduling, forecasting, adherence)
- Quality Assurance (100% conversation evaluation con AI)
- Export CSV/XML + scheduled email reports
- API access a reporting data

**Intercom (8/10):**
- 12 pre-built reports
- Custom charts (100+ types en Advanced+)
- CSAT holístico cross-channel
- Fin AI metrics (resolution rate, accuracy, handoff rate, cost/resolution)
- CX Score propietario

**Dónde Parallly es fuerte:**
- LLM observability (cost tracking por provider/tenant) — ningún competidor tiene esto
- BI API externa — pocos competidores ofrecen API analytics
- Unified AI usage tracking — único en el mercado

**Recomendaciones:**
1. **QA scoring de conversaciones** (MEDIO) — Evaluar calidad de respuestas AI + agentes
2. ~~**AI resolution rate tracking** (ALTO)~~ — ✅ **COMPLETADO Mayo 2026.** Tracking de tasa de resolución AI con tendencia temporal y desglose por canal
3. **Real-time dashboard** (BAJO) — Dashboard con refresh automático para operaciones

---

### 14. BOOKING / CITAS — 8/10

**Lo que tiene Parallly:**
- Booking engine determinístico (state machine: service → date → time → confirm)
- Multi-calendar Google/Microsoft con 3-tier resolution (service → staff → general)
- Plan-gated calendar limits (1/3/10/∞)
- Double booking protection
- Redis-backed state + PG backup
- Public booking page `/book/{tenant-slug}`
- AI tools para booking en conversación
- Appointment reminders + auto-complete cron
- Attendance confirmation post-appointment
- i18n 4 idiomas
- Blocked dates + availability slots

**Mejor competidor — Calendly (9/10):**
- Round-robin, collective booking, meeting polls
- Routing forms para qualification
- Payment collection at booking (Stripe + PayPal)
- Scheduling API headless (sin redirects/iframes)
- 100+ integraciones nativas
- Embed options (inline, popup, widget)
- Mobile app (iOS + Android)
- Automated reminders + follow-ups via workflows

**Cal.com (8/10):**
- Open source, self-hosted
- API-first architecture
- Routing forms con custom logic
- Generous free tier (unlimited bookings)
- Developer-friendly

**Dónde Parallly es MEJOR que Calendly:**
- **Booking through conversation** — El usuario agenda vía WhatsApp/IG en lenguaje natural
- **Multi-vertical** — Services adaptados por industria (turnos médicos, clases gym, visitas inmobiliaria)
- **AI-powered** — El agente AI guía el proceso, no es solo un link

**Dónde nos falta vs Calendly:**
| Feature | Parallly | Calendly |
|---|---|---|
| Payment at booking | ❌ | ✅ Stripe + PayPal |
| Routing forms | ❌ | ✅ |
| Meeting polls | ❌ | ❌ |
| Headless API | ❌ | ✅ Scheduling API |
| Round-robin teams | ❌ | ✅ |
| Collective booking | ❌ | ✅ |
| Embed widget | ⚠️ Básico | ✅ 3 opciones |

**Recomendaciones:**
1. **Payment at booking** (CRÍTICO) — Cobrar al agendar reduce no-shows 40-60%. Stripe/MercadoPago
2. **Round-robin assignment** (MEDIO) — Distribuir citas entre staff automáticamente
3. **Embed widget mejorado** (BAJO) — Opciones de embed como Calendly (inline, popup, button)

---

### 15. KNOWLEDGE BASE PÚBLICA — 7/10

**Lo que tiene Parallly:**
- Portal público `/kb/{tenant-slug}`
- Articles CRUD con categorías
- Quality scoring
- AI article suggestions
- Multi-language auto-detection
- Document versioning
- Bulk import
- URL crawling + auto-recrawl cron

**Mejor competidor — Zendesk Guide (9/10):**
- Hasta 5 help centers branded (Professional)
- Community forums
- AI Knowledge Builder (genera artículos desde tickets)
- Content lifecycle (draft/publish/archive)
- Customizable themes
- 90+ idiomas
- Content Cues (sugiere qué actualizar basado en búsquedas fallidas)

**Intercom Help Center (8/10):**
- Multi-brand help centers
- AI article generator
- Internal vs público
- Sync desde Confluence, Notion, Guru
- Failed search analytics

**Recomendaciones:**
1. ~~**Content gap analytics** (ALTO)~~ — ✅ **COMPLETADO Mayo 2026.** Consultas sin respuesta, query clustering, satisfaction scoring, detección de contenido obsoleto
2. **Multi-brand help centers** (BAJO) — Para white label
3. **Themes customizables** (MEDIO) — Colores, logo, CSS custom en el portal

---

### 16. BILLING / PAGOS — 7/10

**Lo que tiene Parallly:**
- MercadoPago + Stripe dual adapter
- Subscription lifecycle completo
- Webhook verification + idempotency
- Plan quotas enforcement (27 features × 4 plans)
- Reconciliation (hourly past_due sweep + daily drift)
- 5 email templates billing
- Card tokenization
- Coupons
- Financials dashboard (MRR, ARR, churn, LTV, forecast)
- Monthly snapshots

**Mejor competidor — HubSpot (8/10):**
- Stripe nativo + múltiples pasarelas
- Quotes + proposals
- Products/line items
- Revenue tracking per deal
- Subscription management

**Veredicto:** Parallly está bien posicionado aquí. El dual adapter MercadoPago+Stripe es un diferenciador para LatAm. Los financials dashboard son superiores a la mayoría.

**Recomendaciones:**
1. **PayPal adapter** (MEDIO) — Para mercados que prefieren PayPal
2. **Self-service plan change** (MEDIO) — Permitir upgrade/downgrade desde dashboard del tenant

---

### 17. COMPLIANCE / SEGURIDAD — 7/10

**Lo que tiene Parallly:**
- JWT + 2FA (TOTP + email + backup codes)
- Refresh token rotation con replay detection
- AES-256-GCM encryption
- RBAC (4 roles)
- Audit logs
- Schema isolation per tenant
- SAML/SSO
- GDPR per-contact erasure (11 tablas)
- Trusted devices (30 días)
- Legal texts versionados + consent records
- Opt-out detection + review
- Safety guardrails en AI

**Mejor competidor — Zendesk (9/10):**
- SOC 2 Type II
- ISO 27001, 27018, 27701
- HIPAA (con add-on)
- FedRAMP authorized
- PCI DSS
- Audit logs 7 años (Enterprise)
- Advanced Data Privacy add-on (PII redaction, encryption avanzada)

**Intercom (9/10):**
- SOC 2 Type II
- ISO 27001, 27018, 27701, 42001:2023 (AI-specific!)
- HIPAA (Enterprise + BAA)
- GDPR + CCPA
- Annual penetration testing

**Gap:**

| Certificación | Parallly | Zendesk | Intercom |
|---|---|---|---|
| SOC 2 Type II | ❌ | ✅ | ✅ |
| ISO 27001 | ❌ | ✅ | ✅ |
| HIPAA | ❌ | ✅ (add-on) | ✅ (Enterprise) |
| GDPR tools | ✅ Erasure | ✅ Full | ✅ Full |
| FedRAMP | ❌ | ✅ | ❌ |
| PCI DSS | ❌ | ✅ | ❌ |
| 2FA | ✅ TOTP+email | ✅ | ✅ |
| SAML/SSO | ✅ | ✅ | ✅ |
| Schema isolation | ✅ | N/A | N/A |
| AI safety guardrails | ✅ Hardcoded | ⚠️ | ⚠️ |
| Audit trail | ✅ | ✅ 7yr | ✅ |
| IP allowlist | ❌ | ✅ | ❌ |
| Pen testing | ❌ Documentado | ✅ | ✅ |

**Recomendaciones:**
1. **SOC 2 Type II** (ALTO para enterprise) — Necesario para vender a empresas grandes
2. **IP allowlist/blocklist** (MEDIO) — Restricción por IP para tenants enterprise
3. **Data retention policies configurables** (MEDIO) — Retention per tenant
4. **Penetration testing documentado** (BAJO) — Contratar pen test anual y documentar

---

### 18. API / INTEGRACIONES — 6/10 ⬆ (antes 3/10, ya no es brecha crítica)

**Lo que tiene Parallly:**
- BI API (7 endpoints analytics, X-API-Key auth)
- Outbound webhooks (eventos → URL externa)
- HubSpot/Pipedrive OAuth + import
- Google/Microsoft Calendar
- Twilio SMS
- 5 LLM providers
- MercadoPago + Stripe
- iCal sync
- **REST API pública documentada** con API keys (scoped, rate-limited) — nuevo
- **Swagger docs** (OpenAPI spec) — nuevo
- **Webhook subscriptions** (subscribe/unsubscribe, HMAC-signed dispatch) — nuevo
- **HTTP request actions** en automations — nuevo

> **Implementado (Mayo 2026):** REST API pública completa con API keys scoped y rate-limited, documentación Swagger/OpenAPI, webhook subscriptions con subscribe/unsubscribe y dispatch firmado con HMAC, y HTTP request actions en automations. Esto transforma la posición de Parallly de "sin API" a "API funcional con autenticación y documentación". El gap restante es la falta de marketplace de apps nativas (Zapier, Make.com) y conectores pre-construidos.

**Mejor competidor — Zendesk (10/10):**
- REST APIs extensas (Support, Talk, Chat, Sell, Guide, Explore, Sunshine)
- 1,800+ apps marketplace
- Webhooks con retry logic + monitoring
- Zendesk Apps Framework (ZAF) para apps custom
- Custom Objects API (Sunshine)
- SDKs web + mobile (iOS, Android, Unity)

**Respond.io (8/10):**
- Developer REST API
- Webhooks (Advanced plan)
- Zapier + Make + n8n
- Native: Salesforce, HubSpot, Shopify, WooCommerce, Magento
- Custom Channel API
- HTTP request step en workflows

**Intercom (8/10):**
- REST API completa
- Webhooks real-time
- 450+ marketplace apps
- MCP connectors (Shopify, Stripe, Salesforce, Jira)
- SDKs iOS + Android + React Native + Web

**Gap (actualizado Mayo 2026 — ya no es "devastador"):**

| Integración | Parallly | Zendesk | Respond.io | Intercom |
|---|---|---|---|---|
| REST API pública documentada | ✅ (nuevo) | ✅ | ✅ | ✅ |
| API keys scoped + rate-limited | ✅ (nuevo) | ✅ | ✅ | ✅ |
| Swagger/OpenAPI docs | ✅ (nuevo) | ✅ | ✅ | ✅ |
| Webhook subscriptions (HMAC) | ✅ (nuevo) | ✅ | ✅ (Advanced) | ✅ |
| Marketplace de apps | ❌ | ✅ 1,800+ | ❌ | ✅ 450+ |
| Zapier native app | ❌ | ✅ | ✅ | ✅ |
| Make.com | ❌ | ✅ | ✅ | ✅ |
| n8n | ❌ | ✅ | ✅ | ❌ |
| Shopify native | ❌ | ✅ | ✅ | ✅ |
| Slack notifications | ❌ | ✅ | ❌ | ✅ |
| Google Sheets | ❌ | ✅ | ✅ | ❌ |
| HTTP request en workflow | ✅ (nuevo) | ✅ | ✅ | ❌ |

**La brecha se redujo significativamente.** Con REST API, Swagger, webhooks HMAC y HTTP en workflows, los tenants ya pueden integrar Parallly con herramientas externas. El gap restante es el ecosistema de conectores nativos (Zapier, Make, marketplace).

**Recomendaciones (por prioridad, actualizado Mayo 2026):**
1. ~~**REST API pública documentada** (CRÍTICO)~~ — ✅ **COMPLETADO Mayo 2026.** API REST con API keys scoped, rate-limited, y Swagger docs
2. **Zapier native app** (CRÍTICO) — Publicar en Zapier marketplace. Triggers: new_lead, new_message, appointment_booked, handoff_triggered. Actions: create_lead, send_message, update_contact
3. **Shopify connector** (ALTO) — E-commerce module ya existe, conectar con Shopify API
4. **Slack/Teams notifications** (ALTO) — Webhook a Slack cuando hay handoff, nueva venta, cita
5. ~~**HTTP request step en workflows** (ALTO)~~ — ✅ **COMPLETADO Mayo 2026** (con variable interpolation)
6. **Google Sheets export** (MEDIO) — Sync contactos/analytics a Google Sheets
7. **Make.com / n8n** (MEDIO) — Después de Zapier

> *Nota: Webhook subscriptions con HMAC-signed dispatch también fueron implementados, completando la infraestructura de integración básica.*

---

### 19. MOBILE EXPERIENCE — 4/10 🔴 BRECHA CRÍTICA

**Lo que tiene Parallly:**
- PWA con manifest.json + service worker
- Push notifications
- Responsive CSS
- Dark/light/system themes

**Mejor competidor — Respond.io (8/10):**
- App nativa iOS (16+) + Android (10+)
- Inbox completo en mobile
- WhatsApp voice calls desde app
- Push notifications
- Dark mode
- 99.94% crash-free rate
- 54% reducción latencia screen-switching

**Intercom (8/10):**
- Agent mobile app (iOS + Android)
- Customer SDK (iOS, Android, React Native)
- Push notifications
- Full inbox access

**Manychat (7/10):**
- iOS + Android
- Live chat + flow preview
- Basic management

**Gap:**

| Feature | Parallly PWA | Respond.io Native | Intercom Native |
|---|---|---|---|
| Instalable | ✅ PWA | ✅ App Store | ✅ App Store |
| Performance | ⚠️ Depende de browser | ✅ Nativa, rápida | ✅ Nativa |
| Push notifications | ✅ | ✅ | ✅ |
| Offline support | ⚠️ Limitado | ✅ | ✅ |
| Inbox completo | ⚠️ Responsive | ✅ | ✅ |
| Voice calls | ❌ | ✅ | ❌ |
| Biometric login | ❌ | ✅ | ✅ |
| App Store presence | ❌ | ✅ | ✅ |

**Nota importante para LatAm:** En Latinoamérica, muchos agentes de ventas trabajan desde el móvil. La falta de una app nativa es un bloqueador significativo.

**Recomendaciones:**
1. **Optimizar PWA para mobile inbox** (ALTO) — Swipe actions, quick reply, push reliability
2. **React Native app** (MEDIO, largo plazo) — Agent inbox + notifications. Publicar en App Store/Play Store
3. **Biometric login** (BAJO) — Fingerprint/face para acceso rápido

---

### 20. UX / DISEÑO — 7/10

**Lo que tiene Parallly:**
- Tailwind + shadcn/ui + next-themes
- 3 modos (dark/light/system)
- Motion para animaciones
- Design system unificado (0 gray-*, 0 font-bold inconsistentes)
- Shared components (TabNav, PageHeader, Breadcrumbs, SkeletonLoader)
- 80+ páginas dashboard
- HelpPanel contextual (15 páginas, YouTube embed)
- Recharts para gráficos

**Mejor competidor — Intercom (9/10):**
- Diseño moderno messaging-app
- Keyboard-first (CMD+K)
- Dark mode nativo
- "Blazingly fast" performance
- Setup en minutos (paste code snippet)
- G2: 4.5/5 (3,755 reviews)

**Tidio (8/10):**
- Widget de chat más pulido del mercado
- Setup en 5 minutos
- UX simplísima
- G2: 4.7/5 (1,800+ reviews)

**Manychat (8/10):**
- Flow builder drag-and-drop best-in-class
- Onboarding suave con templates
- G2: 4.6/5

**Comparación UX:**

| Aspecto | Parallly | Intercom | Tidio |
|---|---|---|---|
| Design system | ✅ shadcn/ui | ✅ Custom | ✅ Custom |
| Dark mode | ✅ | ✅ | ❌ |
| Animations | ✅ Motion | ✅ | ⚠️ Básico |
| Responsive | ✅ | ✅ | ✅ |
| Keyboard shortcuts | ❌ | ✅ CMD+K | ❌ |
| Loading states | ✅ Skeleton | ✅ | ✅ |
| Error feedback | ⚠️ Parcial | ✅ | ✅ |
| Breadcrumbs | ✅ | ✅ | ❌ |
| Contextual help | ✅ HelpPanel | ✅ | ❌ |
| i18n | ✅ 4 idiomas | ✅ 45+ | ⚠️ Limitado |

**Recomendaciones:**
1. **Keyboard shortcuts** (MEDIO) — CMD+K global search, shortcuts en inbox
2. **Error feedback universal** (ALTO) — Cada acción debe tener feedback visual claro (ya mejorado en audit, completar)
3. **Onboarding tour interactivo** (MEDIO) — Guided tour para nuevos usuarios

---

### 21. WEB CHAT WIDGET — 8/10 ⬆ (antes 6/10)

**Lo que tiene Parallly:**
- Widget JS embebible
- WebSocket gateway
- AI → handoff flow
- Configurator en dashboard
- **Proactive triggers** (5 tipos de condición, 3 tipos de acción, frequency capping, evaluación client-side) — nuevo

> **Implementado (Mayo 2026):** Sistema de proactive triggers completo con 5 tipos de condición (tiempo en página, exit intent, scroll depth, URL match, visitas), 3 tipos de acción (mensaje, open widget, highlight), frequency capping para evitar spam, y evaluación client-side para performance. Cierra el gap principal vs Tidio e Intercom.

**Mejor competidor — Tidio (9/10):**
- Widget altamente customizable (colores, posición, avatar, greeting)
- Visitor monitoring (ver qué página visitan, preview de typing)
- Flows trigger basados en comportamiento (exit intent, time on page, cart value)
- Ticketing integrado
- Mobile-responsive widget
- Shopify optimizado (#1 rated)
- Offline form
- G2: 4.7/5 para live chat

**Intercom Messenger (9/10):**
- Widget con Product Tours
- Proactive messages (banners, tooltips)
- In-app surveys
- Custom bot flows
- Rich media (carruseles, botones, quick replies)
- SDK mobile (embed en apps)
- Branding customizable

**Gap:**

| Feature | Parallly | Tidio | Intercom |
|---|---|---|---|
| Widget embebible | ✅ | ✅ | ✅ |
| Customizable theme | ⚠️ Básico | ✅ Completo | ✅ Completo |
| Proactive triggers | ✅ 5 condiciones (nuevo) | ✅ Exit intent, time, cart | ✅ Behavior-based |
| Visitor monitoring | ❌ | ✅ | ✅ |
| Rich media (carrusel) | ❌ | ⚠️ | ✅ |
| Offline form | ❌ | ✅ | ✅ |
| Mobile SDK | ❌ | ✅ | ✅ Native SDK |
| Pre-chat form | ✅ | ✅ | ✅ |
| AI → handoff | ✅ | ✅ Lyro | ✅ Fin |

**Recomendaciones:**
1. ~~**Proactive triggers** (ALTO)~~ — ✅ **COMPLETADO Mayo 2026.** 5 tipos de condición, 3 tipos de acción, frequency capping, evaluación client-side
2. **Widget theming completo** (MEDIO) — Colores, avatar, posición, greeting personalizado
3. **Offline form** (MEDIO) — Formulario cuando no hay agentes disponibles
4. **Rich media messages** (BAJO) — Carruseles, botones, quick replies en el widget

---

### 22. WHITE LABEL / MULTI-TENANT — 7/10

**Lo que tiene Parallly:**
- Schema-per-tenant (aislamiento completo PostgreSQL)
- White label module (brandName, logoUrl, colors, customDomain, customCss, hidePoweredBy)
- Plan-gated a Custom plan
- Public lookup by slug/domain con Redis cache
- Custom domains para KB
- Multi-tenant desde arquitectura base

**Mejor competidor — GoHighLevel SaaS Mode (9/10):**
- Full white label (rebrand completo)
- Custom domain para todo (app, links, emails)
- Sub-accounts ilimitados (Unlimited plan)
- SaaS mode: agencias revenden como producto propio
- Billing rebilling (cobrar a sub-accounts)
- Custom app mobile (branding propio)
- Marketplace de snapshots (templates por industria)
- G2: comunidad masiva de agencies

**Trengo (7/10):**
- White labeling incluido en todos los planes
- Rebrand de plataforma
- Reseller capabilities (Enterprise)

**Gap:**

| Feature | Parallly | GoHighLevel | Trengo |
|---|---|---|---|
| White label visual | ✅ | ✅ Completo | ✅ |
| Custom domain | ✅ KB | ✅ Todo | ❌ |
| Sub-account billing | ❌ | ✅ Rebilling | ❌ |
| Snapshot/template marketplace | ❌ | ✅ | ❌ |
| Custom mobile app | ❌ | ✅ | ❌ |
| Remove powered-by | ✅ | ✅ | ✅ |
| Multi-tenant native | ✅ Schema isolation | ❌ Sub-accounts | ❌ |

**Recomendaciones:**
1. **Sub-account billing** (MEDIO) — Permitir que agencias cobren a sus clientes desde Parallly
2. **Custom domain para toda la app** (MEDIO) — No solo KB, también dashboard
3. **Snapshot marketplace** (BAJO) — Templates por industria compartibles

---

### 23. E-COMMERCE — 5/10

**Lo que tiene Parallly:**
- E-commerce module (Shopify Admin API + WooCommerce REST API)
- Product sync
- Cart abandonment tracking
- AI product search
- Catalog/offers endpoints

**Mejor competidor — Tidio (9/10):**
- Deep Shopify integration (#1 rated app)
- Cart recovery flows automatizados
- Product recommendations in-chat con AI
- Order status lookup en tiempo real
- Visitor behavior tracking (pages viewed, cart value)
- 5 Shopify-specific flow nodes
- Revenue attribution

**Manychat (8/10):**
- Shopify + WooCommerce native
- Abandoned cart recovery via DM/WA/SMS
- Product catalogs en conversaciones
- In-chat payments (PayPal + Stripe)
- Revenue attribution

**Gap:**

| Feature | Parallly | Tidio | Manychat |
|---|---|---|---|
| Shopify sync | ✅ | ✅ Deep native | ✅ Deep native |
| Cart abandonment | ✅ Tracking | ✅ Auto-recovery | ✅ Auto-recovery |
| Product search AI | ✅ | ✅ | ✅ |
| Order status lookup | ❌ | ✅ Real-time | ❌ |
| In-chat payments | ❌ | ❌ | ✅ PayPal+Stripe |
| Revenue attribution | ❌ | ✅ | ✅ |
| WA cart recovery | ❌ | ❌ | ✅ |

**Recomendaciones:**
1. **Cart abandonment → WhatsApp message** (ALTO) — Cuando se detecta carrito abandonado, enviar WA automático
2. **Order status via AI tool** (MEDIO) — AI tool que consulta estado de orden en Shopify
3. **In-chat payment links** (MEDIO) — Enviar link de pago dentro de la conversación

---

### 24. ADAPTACIÓN VERTICAL — 9/10 ✅ DIFERENCIADOR

**Lo que tiene Parallly:**
- 12 verticales con módulos dedicados (turismo/VR, tours, inmobiliaria, restaurantes, gimnasios, veterinaria, salud, educación, seguros, servicios hogar, fotografía, pet services)
- Auto-bootstrap por industria (pipeline stages, FAQs, servicios, AI tool flags)
- Sidebar adaptativo por vertical
- AI tools específicos por industria (17 tools)
- Terminología adaptada por vertical
- Staff scheduling, vehicle inventory, channel manager como módulos dedicados

**Competencia:**
- **GoHighLevel:** Snapshots genéricos por industria (templates de marketing, no módulos)
- **Respond.io:** Case studies por industria, pero plataforma 100% horizontal
- **Trengo:** Templates por industria, plataforma horizontal
- **Manychat/Wati/Tidio:** Sin features verticales
- **Intercom/Zendesk:** Sin features verticales

**Comparación con verticales especializados:**

| Vertical | Parallly | Especialista | Score Parallly vs Especialista |
|---|---|---|---|
| Turismo/VR | ✅ Properties + iCal + tours | Guesty (60+ OTAs, PMS, pricing dinámico) | 6/10 vs 9/10 — Falta channel manager API |
| Gimnasios | ✅ Memberships + classes | Mindbody ($139-699/mo, marketplace consumer, POS) | 5/10 vs 9/10 — Falta pagos recurrentes, check-in |
| Restaurantes | ✅ Menu + food orders | Toast ($0-69/mo, POS, KDS, hardware) | 4/10 vs 9/10 — Falta POS, KDS |
| Salud | ✅ Treatment plans | Cliniko ($45/mo, clinical notes, telehealth) | 5/10 vs 8/10 — Falta SOAP notes |
| Veterinaria | ✅ Pets + vaccinations | VetBadger ($99/mo, clinical workflow) | 5/10 vs 7/10 — Falta historial clínico |

**Insight clave:** Parallly NO compite directamente con los especialistas verticales. La propuesta de valor es: **"Tu plataforma de ventas conversacionales con adaptaciones específicas para tu industria"**. No reemplaza Toast para un restaurante, pero SÍ maneja sus ventas y atención al cliente por WhatsApp/IG con terminología y herramientas relevantes.

**Recomendaciones:**
1. Mantener como diferenciador principal en marketing
2. Comunicar claramente que complementa (no reemplaza) herramientas verticales especializadas
3. Priorizar integraciones con los especialistas (Guesty API, Mindbody API, etc.)

---

### 25. ONBOARDING — 7/10

**Lo que tiene Parallly:**
- Setup wizard (selección industria → vertical config → template agente)
- Onboarding 4 pasos (empresa → industria → canal → agente)
- Bounce protection (30s window)
- Auto-bootstrap vertical
- HelpPanel contextual (15 páginas, YouTube embed)

**Mejor competidor — Intercom (8/10):**
- Setup en minutos (paste code snippet)
- Product Tours para onboarding de usuarios finales
- In-app guidance (tooltips, banners, checklists)
- Onboarding Series multi-step
- Early Stage Program (90% off Year 1)

**Tidio (8/10):**
- Setup en <5 minutos
- Guided wizard
- Templates pre-configuradas
- Valor inmediato (widget funcional en minutos)
- G2: "most teams running in under 5 minutes"

**Recomendaciones:**
1. **Onboarding checklist in-dashboard** (MEDIO) — Progress bar con pasos completados
2. **Time-to-first-value optimization** (ALTO) — El primer mensaje AI debería funcionar en <10 min desde signup
3. **Templates pre-configurados por vertical** (MEDIO) — Un setup completo funcional al elegir industria

---

## PARTE 3: MAPA COMPETITIVO

### Posicionamiento de Mercado

```
                    AI Conversacional
                         ↑
                         |
            Parallly ★   |   Intercom
                 ●        |      ●
                         |
   GoHighLevel      ─────+───────────────→ Especialización
        ●                |                   Vertical
                         |
        Respond.io  ●    |    ● Mindbody/Guesty/Toast
                         |
                  Manychat ●   ● Wati
                         |
             ← ─ ─ ─ ─ ─+─ ─ ─ ─ ─ → 
           Horizontal    |    Vertical
                         |
                    HubSpot ●
                         |
              Zendesk ●  ↓
                    CRM/Soporte
```

### Ventajas Competitivas Únicas de Parallly

| Ventaja | Ningún Competidor Ofrece |
|---|---|
| **Multi-Agente AI por canal** | 1 agente por canal, plan-gated, templates + schedule |
| **LLM Router 5-provider** | Circuit breaker, task-based routing, 4 tiers con fallback |
| **12 verticales con auto-bootstrap** | Módulos, AI tools, pipeline, FAQs, sidebar adaptativo |
| **Booking conversacional** | Agendar por WhatsApp/IG con state machine determinístico |
| **LLM Observability** | Cost tracking por provider/tenant/modelo |
| **Schema-per-tenant** | Aislamiento real de datos (no row-level) |

### Donde Parallly Pierde Claramente (actualizado Mayo 2026)

| Brecha | Competidor que lo hace mejor | Impacto en ventas | Estado |
|---|---|---|---|
| ~~Sin REST API pública + Zapier~~ | Zendesk, Respond.io, Intercom | 🔴→🟡 | ⚠️ API REST implementada. Falta Zapier native app |
| Sin app mobile nativa | Respond.io, Intercom | 🔴 Bloqueador en LatAm | Pendiente |
| ~~Automation builder limitado~~ | Respond.io, GoHighLevel, Manychat | 🟠→🟢 | ✅ HTTP step + templates + drip sequences |
| Sin payment at booking | Calendly | 🟠 No-shows sin cobro previo | Pendiente |
| ~~Web chat widget básico~~ | Tidio, Intercom | 🟡→🟢 | ✅ Proactive triggers implementados |

> **3 de 5 brechas principales han sido cerradas o reducidas significativamente.** El gap #1 restante es mobile nativa (4/10).

---

## PARTE 4: PLAN DE MEJORA PRIORIZADO

### Criterios de Priorización

| Factor | Peso |
|---|---|
| Impacto en conversión de ventas | 35% |
| Paridad competitiva (eliminar deal-breaker) | 30% |
| Esfuerzo de implementación | 20% |
| Diferenciación (ventaja competitiva nueva) | 15% |

### TIER 1 — Deal-Breakers (Eliminar barreras de venta) — 1-3 meses

| # | Feature | Score Actual → Target | Esfuerzo | Impacto | Competidor Ref | Estado |
|---|---|---|---|---|---|---|
| 1 | ~~**REST API pública documentada**~~ | 3→6 | 3-4 semanas | 🔴 Máximo | Zendesk, Respond.io | ✅ **COMPLETADO** |
| 2 | **Zapier native app** | 6→7 | 4-6 semanas | 🔴 Máximo | Respond.io, Intercom | Pendiente |
| 3 | ~~**HTTP request step en workflows**~~ | 6→8 | 1-2 semanas | 🔴 Alto | Respond.io, GHL | ✅ **COMPLETADO** |
| 4 | **Payment at booking** (Stripe/MP) | 8→9 | 1 semana | 🟠 Alto | Calendly | Pendiente |
| 5 | **Mobile inbox optimization** | 4→6 | 2-3 semanas | 🔴 Alto | Respond.io | Pendiente |

> **Tier 1: 2/5 completados** (REST API + HTTP request step). Los deal-breakers más críticos de integraciones fueron resueltos.

### TIER 2 — Paridad Competitiva — 2-4 meses

| # | Feature | Score Actual → Target | Esfuerzo | Impacto | Competidor Ref | Estado |
|---|---|---|---|---|---|---|
| 6 | ~~**Email como canal de messaging**~~ | 7→8 | 2-3 semanas | 🟠 Alto | Todos | ✅ **COMPLETADO** |
| 7 | ~~**Collision detection en inbox**~~ | 7→8 | 1 semana | 🟡 Medio | Intercom, Zendesk | ✅ **COMPLETADO** |
| 8 | ~~**Proactive widget triggers**~~ | 6→8 | 2 semanas | 🟡 Medio | Tidio, Intercom | ✅ **COMPLETADO** |
| 9 | ~~**Automation templates library**~~ | 6→7 | 2 semanas | 🟡 Medio | GHL, Manychat | ✅ **COMPLETADO** |
| 10 | ~~**Drip sequences**~~ | 6→7 | 2-3 semanas | 🟡 Medio | Manychat, Intercom | ✅ **COMPLETADO** |
| 11 | ~~**AI resolution rate tracking**~~ | 7→8 | 1 semana | 🟡 Medio | Intercom | ✅ **COMPLETADO** |
| 12 | ~~**Multiple pipelines**~~ | 6→7 | 1-2 semanas | 🟡 Medio | HubSpot | ✅ **COMPLETADO** |
| 13 | ~~**Content gap analytics (KB)**~~ | 7→8 | 1 semana | 🟡 Medio | Zendesk, Intercom | ✅ **COMPLETADO** |
| 14 | ~~**A/B testing broadcasts**~~ | 6→7 | 1-2 semanas | 🟡 Medio | Manychat | ✅ **COMPLETADO** |

> **Tier 2: 9/9 completados (100%).** Todas las features de paridad competitiva fueron implementadas en Mayo 2026. Webhook subscriptions con HMAC-signed dispatch, variable interpolation en workflows, y feedback widget en KB fueron bonus adicionales.

### TIER 3 — Diferenciación Avanzada — 4-8 meses

| # | Feature | Score Actual → Target | Esfuerzo | Impacto | Competidor Ref |
|---|---|---|---|---|---|
| 15 | **React Native mobile app** | 4→8 | 2-3 meses | 🟠 Alto | Respond.io |
| 16 | **Shopify deep connector** | 5→7 | 3-4 semanas | 🟡 Medio | Tidio, Manychat |
| 17 | **Voice AI channel** | 8→9 | 2-3 meses | 🟡 Medio | Intercom Fin Voice |
| 18 | **Sub-account billing** | 7→8 | 3-4 semanas | 🟡 Medio | GoHighLevel |
| 19 | **SOC 2 Type II prep** | 7→8 | 2-3 meses | 🟡 Enterprise | Zendesk, Intercom |
| 20 | **Make.com / n8n connector** | 6→8 | 2-3 semanas | 🟡 Medio | Respond.io |

### TIER 4 — Nice-to-Have — 6-12 meses

| # | Feature | Esfuerzo | Notas |
|---|---|---|---|
| 21 | Custom Channel API | 3-4 semanas | Permitir conectar canales custom |
| 22 | Keyboard shortcuts (CMD+K) | 1-2 semanas | Mejor UX para power users |
| 23 | Deal rotting alerts | 1 semana | Pipeline optimization |
| 24 | Widget rich media (carruseles) | 2-3 semanas | Better widget UX |
| 25 | Revenue attribution campaigns | 3-4 semanas | ROI tracking |

---

## PARTE 5: BENCHMARKING DE PRECIOS

### Comparación de Pricing

| Plataforma | Entry Price | Mid-tier | Enterprise | Modelo |
|---|---|---|---|---|
| **Parallly** | Plan Starter | Plan Pro | Plan Enterprise | Per tenant, features |
| Respond.io | $79/mo (5 users) | $159/mo (10 users) | $279/mo (25 users) | Per MAC |
| Trengo | €299/mo (10 users) | €499/mo (20 users) | Custom | Per conversation |
| Intercom | $29/seat/mo | $85/seat/mo | $132/seat/mo | Per seat + $0.99/resolution |
| Zendesk | $19/agent/mo | $89/agent/mo | $169/agent/mo | Per agent + add-ons |
| HubSpot | Gratis (CRM) | $100/seat/mo (Pro) | $150/seat/mo | Per seat |
| Kommo | $15/user/mo | $25/user/mo | $45/user/mo | Per user |
| Manychat | $0-$29/mo | $69/mo | Custom | Per contact |
| Wati | $39/mo (5 users) | $79/mo | $229/mo | Per user + Meta fees |
| Tidio | $0-$29/mo | $59/mo | $749/mo | Per conversations |
| GoHighLevel | $97/mo | $297/mo | $497/mo | Flat + usage |
| Calendly | $0 | $12/seat/mo | $15K/year | Per seat |

### Oportunidad de Pricing

Parallly puede posicionarse competitivamente:
- **LatAm pricing advantage:** MercadoPago + precios en USD accesibles vs Intercom ($85/seat) o Trengo (€299)
- **All-inclusive vs per-resolution:** No cobrar por resolución AI como Intercom ($0.99/ea)
- **Vertical value:** Cobrar premium por módulos verticales que otros no tienen
- **Multi-agent included:** En la competencia, cada "bot" o "AI agent" cuesta extra

---

## PARTE 6: RESUMEN EJECUTIVO FINAL

### Lo que Parallly Hace Mejor que Todos

1. **Multi-Agente AI por canal** — Nadie más ofrece esto
2. **LLM Router 5-provider con circuit breaker** — La arquitectura AI más resiliente del mercado
3. **12 verticales con auto-bootstrap** — El único que adapta toda la plataforma por industria
4. **Booking conversacional determinístico** — Agendar por WhatsApp sin depender del LLM para flujo
5. **LLM Observability** — Tracking de costos AI por provider/tenant/modelo

### Los 5 Gaps que Más Impactan las Ventas (actualizado Mayo 2026)

1. ~~**Sin API pública + Zapier**~~ — ✅ API REST pública implementada (Swagger, API keys, webhooks HMAC). **Falta:** Zapier native app
2. **Sin app mobile nativa** — Bloqueador en LatAm (mercado principal) — **SIN CAMBIO**
3. ~~**Automation builder limitado**~~ — ✅ **CERRADO.** HTTP steps, 15+ templates, drip sequences, variable interpolation
4. **Sin payment at booking** — No-shows altos sin cobro previo — **SIN CAMBIO**
5. ~~**Widget web básico**~~ — ✅ **CERRADO.** Proactive triggers con 5 condiciones, frequency capping

### Score Objetivo (6 meses) — Actualizado Mayo 2026

| Área | Antes | Actual (Mayo 2026) | Objetivo Nov 2026 | Requiere |
|---|---|---|---|---|
| API / Integraciones | 3/10 | **6/10** ✅ | 8/10 | Zapier native app + Make.com + Shopify deep |
| Mobile | 4/10 | 4/10 | 7/10 | PWA optimized + React Native |
| Automatización | 6/10 | **8/10** ✅ | 9/10 | AI step en workflows + webhook triggers |
| Web Chat Widget | 6/10 | **8/10** ✅ | 9/10 | Widget theming completo + offline form |
| E-commerce | 5/10 | 5/10 | 7/10 | Shopify deep + cart recovery WA |
| **Score Global** | **7.1/10** | **7.8/10** ✅ | **8.5/10** | Tier 3 completado + Zapier + mobile |

> **Progreso:** El score global subió de 7.1 a 7.8 (+0.7) con la implementación de 12 features. Para llegar a 8.5 se necesita principalmente mobile nativa y ecosystem de integraciones (Zapier/Make).

---

*Documento generado: Mayo 27, 2026*
*Actualizado: Mayo 27, 2026 — 12 features implementadas, scores recalculados (7.1→7.8)*
*Fuentes: Investigación directa de 13 plataformas competidoras con datos de 2025-2026*
*Ratings G2, Capterra, precios oficiales, documentación técnica, y análisis funcional*
*Próxima actualización recomendada: Agosto 2026*
