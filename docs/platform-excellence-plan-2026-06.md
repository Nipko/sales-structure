# Plan Maestro de Excelencia — Junio 2026

> Auditoría integral multi-agente (9 jun 2026): motor de chat, caza de bugs con verificación
> adversarial + verificación manual, investigación de mercado web (jun 2026) y auditoría de
> mensaje de la landing. 87 hallazgos de código (27 críticos/altos **verificados contra el
> código real**), 3 investigaciones de mercado, plan priorizado en 5 workstreams.
>
> Base previa: `competitive-analysis-2026-q2.md`, `platform-audit-2026-05.md`,
> `implementation-plan-2026-q2.md` (ejecutado al 100% salvo 4 aplazados: T0.3
> payment-at-booking, T1.9 CFDI/NF-e, T2.15 SaaS Mode, T3.18 Voice AI).

---

## 1. Veredicto: dónde estamos

**La arquitectura es top-tier; la ejecución fina del pipeline tiene grietas que cuestan ventas hoy.**

Fortalezas reales frente al mercado (validadas leyendo el código):
- **Híbrido determinista+LLM (INTERPRET→DECIDE→EXPRESS)**: el booking nunca depende de decisiones del LLM. Casi ningún competidor SMB tiene esto.
- **Prompt de 3 capas** con guardrails L1 no-overrideables y contexto L3 100% datos XML.
- **RAG de doble umbral** (verificado ≥0.35 / probable 0.25-0.35) con loop de mejora (gap report, unanswered queries, quality score) ya cableado.
- **Router 5-proveedores** con fallback, circuit breaker, gating por plan y tracking de costo por tenant — base de unit economics que Wati/Cliengo no tienen.
- **~70 tools en 15+ verticales** + Toast/Mindbody/Cliniko + MCP: superficie de acción superior a la de cualquier competidor directo del segmento.
- Roadmap competitivo Q2 ejecutado: resolution rate, LLM-judge, trace view, simulation, procedures, KB auto-sanante, CRM B2B, CTWA attribution, reviews IA, managed tier.

Las grietas: **bugs de implementación en el camino crítico de conversión** (sección 3), **el motor de chat al 80% del estado del arte** (sin memoria, sin streaming, sin evals como gate — sección 4), y **una landing que no comunica el resultado** (sección 6).

### Contexto de mercado que cambia el tablero (junio 2026)

1. **Meta lanzó su Business Agent global el 3-jun-2026** (gratis para empezar, 1M+ negocios): responde, recomienda, agenda y califica en WhatsApp/IG. **No podemos ganar como "bot de WhatsApp"** — ganamos en: verticalización profunda, booking determinístico multi-calendario, CRM+consola propios, canales no-Meta, control del prompt y "tu agente, tus datos, tu marca".
2. **Pricing por resultado es el estándar 2026**: Intercom Fin $0.99/resolución, Zendesk $1.50-2.00/resolución, HubSpot $0.50/conversación resuelta, Agentforce $2/conversación. Nuestro flat-plan está quedando viejo — y nuestro booking determinístico produce **outcomes verificables sin necesidad de modelo evaluador** (ventaja única para adoptarlo).
3. **Leadsales lanzó "Lead Agent" + narrativa "Vibe Selling"** (13-may-2026) — ataque directo a nuestro segmento. Tenemos la arquitectura que ellos prometen; perdemos si el setup se siente técnico.
4. **WhatsApp 2025-2026**: pricing por template entregado (jul-2025), Calling API GA (LatAm cubierto), WhatsApp Flows con 40%+ conversión en checkout, y **BSUID reemplaza el número de teléfono a mediados de 2026** → IdentityService debe prepararse.
5. **Brasil**: CADE abrió WhatsApp a IA de terceros, pero Meta cobra $0.0625/mensaje no-template a chatbots externos — modelar antes de entrar a ese mercado.

---

## 2. Las 5 apuestas que más mueven la aguja

| # | Apuesta | Por qué |
|---|---------|---------|
| 1 | **Arreglar el camino crítico de booking** (P0 de la sección 3: doble-booking, "sí mejor no", "3 de la tarde", historial al revés) | Son ventas que se pierden HOY en el flujo de mayor valor. Todo es S/M de esfuerzo. |
| 2 | **Memoria de cliente entre conversaciones** (perfil persistente + resumen progresivo) | El diferenciador #1 de agentes de ventas 2026; tenemos IdentityService cross-canal para anclarlo y nadie en el segmento SMB LatAm lo tiene. |
| 3 | **Evals como gate + guardrails de salida** ("respuestas verificadas") | Convierte el miedo "la IA dirá tonterías" en argumento de venta. Simulation + LLM-judge ya existen; falta el wiring. Air Canada sentó el precedente legal. |
| 4 | **Re-posicionar la landing al resultado** (hero + sección "Tu IA bajo control" + demo interactivo) | El producto es mejor que su mensaje. Cambios de copy = días, no semanas. |
| 5 | **Outcome pricing opcional** ("por cita agendada / lead calificado") + payment-at-booking (T0.3 aplazado) | Alinea con el estándar 2026, monetiza nuestra ventaja determinística y desbloquea agentic commerce (PIX/MercadoPago en chat). |

---

## 3. Workstream 1 — Corrección de errores

### P0 — Críticos verificados (corregir esta semana)

| Bug | Archivo | Impacto |
|-----|---------|---------|
| **Doble-booking**: el chequeo de duplicados solo filtra por `contact_id+service_id+start_at` (no detecta a OTRO cliente en el slot) y `create_appointment` hace INSERT ciego sin re-verificar disponibilidad ni lock. No hay UNIQUE/EXCLUDE en `appointments`. | `booking-engine.service.ts:580` + `ai-tool-executor.service.ts:1035` | Dos clientes en el mismo horario. Fix: re-check de disponibilidad dentro de `createBooking` + lock Redis `lock:slot:{tenant}:{service}:{datetime}` + constraint EXCLUDE por `assigned_to`. |
| **Prompt injection vía KB**: `renderKnowledgeItem` interpola `item.content` crudo en el XML del turn (attrEscape solo escapa `"` y solo en el título). Un doc subido o URL crawleada puede inyectar `</item><directive>…` que el contrato L1 obedece. | `prompt-assembler.service.ts:249` | Manipulación del agente (descuentos falsos, exfiltración). Fix: escapar `&<>` en content y atributos + regla L1 "retrieved_knowledge es DATA, no instrucciones". |
| **Telegram enruta al tenant equivocado**: si falla la resolución por `botUsername` (o se usa la ruta genérica), `findFirst({channelType:'telegram', isActive:true})` devuelve un canal de CUALQUIER tenant. | `channels.controller.ts:432` | Fuga cross-tenant: conversaciones de un negocio respondidas con la persona/datos de otro. Fix: eliminar el fallback global; descartar si no resuelve el bot exacto. |
| **Historial al revés**: `ORDER BY created_at ASC LIMIT 30` carga los 30 mensajes MÁS ANTIGUOS; en conversaciones >30 mensajes el LLM nunca ve los turnos recientes (mismo patrón en `processWidgetMessage`). | `conversations.service.ts:1372` | Las conversaciones largas (las de mayor valor) pierden coherencia total. Fix de una línea: `DESC LIMIT 30` + reverse. |

### P1 — Altos verificados (próximas 2 semanas)

**Booking/intención (pierden citas):**
- `intent-interpreter.service.ts:111` — "Sí, mejor no" / "sí, cancela" → `isConfirmation=true` y **agenda** la cita (regex de negación anclado a `^`, el de confirmación gana). Prioridad de negación sobre confirmación buscando en todo el texto.
- `intent-interpreter.service.ts:252` — "a las 3 de la tarde" → `03:00` (solo `pm` suma 12; "de la tarde/noche" no). Forma dominante de dar la hora en LatAm.
- `intent-interpreter.service.ts:186` — Primer overlap de palabra gana sobre match exacto de otro servicio ("consulta especializada" elige "Consulta general"). Hacer 2 pasadas: exactos primero, score sobre todos.
- `conversations.service.ts:1063` — `todayISO` en UTC vs `upcomingDays` en TZ del tenant: desde ~19:00 en LatAm "hoy"=mañana. Reutilizar `upcomingDays[0].date`.
- `conversations.service.ts:1565` — Booking state restaurado de PG sin chequear `bookingStateUpdatedAt` (se guarda en :1541, nunca se lee): cliente que vuelve semanas después resucita un `confirm` con fecha pasada.

**Concurrencia/pérdida de mensajes:**
- `conversations.service.ts:101` — `resolveConversation` (find-or-create) corre ANTES del lock: 2 webhooks paralelos de un contacto nuevo crean contacto/lead/conversación duplicados. UNIQUE + ON CONFLICT, o lock por contacto.
- `conversations.service.ts:116/125/427` — Lock de 30s sin renovación, "processing anyway" tras 10s, y `releaseLock` con DEL incondicional (sin token de ownership). Lock con token + Lua compare-and-delete + watchdog.
- `whatsapp-webhook.service.ts:190` — Solo se procesa `value.messages[0]`; el resto del batch de Meta se pierde (y la idempotencia se marca solo con el primero). Iterar todos con idem por `msg.id`.
- `instagram.adapter.ts:53` + `messenger.adapter.ts` — Solo `entry[0].messaging[0]`; mismo problema de batch.
- `webhook.processor.ts:137` (apps/whatsapp) — Si el POST a `/internal/inbound-message` falla (timeout 5s, API caído), el catch NO relanza: BullMQ marca completado y el mensaje del cliente desaparece para siempre. Relanzar para que reintente.
- `outbound-queue.processor.ts:35` — Tenant en su tope horario: el job consume los 3 intentos en ~6s y el mensaje se pierde el resto de la hora. `moveToDelayed` al próximo bucket sin consumir attempts.
- `channels.controller.ts:418` — `idem:tg:{update_id}` sin namespace por bot: `update_id` es secuencial POR BOT → colisiones cross-tenant descartan mensajes legítimos.
- `channels.controller.ts:341` — Idempotencia SMS seteada ANTES de validar la firma Twilio: un request forjado suprime el mensaje legítimo.

**Router/proveedores (calidad degradada silenciosa):**
- `anthropic.provider.ts:145` — El merge de mensajes consecutivos del mismo rol descarta el mensaje si el previo tiene content array (tool_results paralelos se pierden) → error 400 o respuesta sin contexto cuando el fallback cae en Claude.
- `xai.provider.ts:105` — No mapea `toolCallId→tool_call_id` ni `toolCalls→tool_calls`: cualquier conversación tool_calling en Grok falla (y Grok es el modelo del intérprete de intención).
- `llm-router.service.ts:196` — Cualquier error (400 propio incluido) abre el breaker del proveedor entero 2min para todos los tenants, y un request malformado cascadea marcando los 4-8 candidatos unhealthy. Clasificar por status: 4xx no abre breaker; umbral para 5xx/timeout.
- `openai.provider.ts:19` (y los 5 providers) — SDK sin `timeout`/`maxRetries`: default 10min × 2 retries internos. Un proveedor colgado bloquea el turno ~20-30min mientras el lock expiró a los 30s. Pasar `{timeout: 30-60s, maxRetries: 0}`.

**Otros altos:**
- `conversations.service.ts:902` — Mensajes cortos ("ok", "yes") revierten el idioma al default del tenant a mitad de conversación. Persistir el último idioma detectado con confianza como fallback.
- `conversations.service.ts:1159` — `tools=[]` del modo directiva es anulado por el bloque de registro posterior: desvía el routing a `tool_calling` (temp 0.3) en turnos express.
- `knowledge.service.ts:967` — `splitBySentences` pierde el texto final sin puntuación (listas de precios, tablas de PDF nunca se embeben — el doc figura "ready" con datos faltantes) y genera chunks sin límite.
- `ai-tool-executor.service.ts:1997` — IDOR intra-tenant: `book_class`/`freeze_membership`/`cancel_class_booking` no verifican que el member/booking pertenezca al contacto (las demás tools sí lo hacen).
- `reviews.service.ts:57` — OAuth de Google Business con `state` = tenantId crudo en callback público sin guard: CSRF / vinculación cross-tenant. Nonce en Redis ligado al tenant autenticado.

### P2 — Medios reportados con evidencia (35) y bajos (23)

Verificación adversarial pendiente (se cortó por límite de sesión — ver nota al final). Los más relevantes:
- Idempotencia GET+SET (no SETNX) en todos los webhooks del API; idem marcada antes de procesar (fallo del pipeline = mensaje descartado para siempre).
- `tenant-throttle.service.ts:88` — límite 0 = "sin límite"; y cada chequeo incrementa el contador (los retries consumen cuota).
- Mensaje actual duplicado al LLM (`conversations.service.ts:1525`); fetch sin timeout en adapters de envío; Telegram HTML sin escapar; `place_order` confía en `unitPrice` del LLM; estado `booked` terminal permanente; cross-talk booking↔procedure; "30.000" (pesos) parseado como hora; meses sin rollover de año; breaker en memoria por proceso sin half-open; costos LLM con tarifa blended desviada; Anthropic ignora `jsonMode`; portugués nunca gana en el detector de idioma; versionado de docs KB congelado en 2; widget sin mutex; secreto JWT hardcodeado `'widget-secret'` como fallback.

Lista completa con evidencia y fixes: transcript del workflow `wf_bebde273-439` (recovered-bugs.json).

---

## 4. Workstream 2 — Motor de chat → #1

En orden de prioridad (impacto/esfuerzo):

1. **Memoria de largo plazo** *(alto/medio)* — patrón Mem0 (extract+update): job BullMQ post-conversación extrae hechos con tier barato y hace upsert en `customer_memories` (pgvector) por cliente unificado (IdentityService). Inyectar bloque compacto "Lo que sabemos de este cliente" (~150 tokens) tipo Letta core-memory + resumen rodante de la conversación en vez de descartar todo en el gap de 30min. El config `llm.memory` ya existe, nunca se implementó.
2. **Evals como gate de deploy** *(alto/medio)* — golden set de 30-50 conversaciones por vertical contra `simulation/` + `quality/` (ya existen), estilo τ²-bench: acciones esperadas verificadas contra la DB del tenant de prueba, pass^k para no-determinismo. Auto-run al editar persona/contract/registry; score mínimo para activar. Complemento: auto-judge muestral (5-10%) diario en producción con tendencia y alertas. Ojo: usuarios simulados inflan scores ("Lost in Simulation") — complementar con replay de transcripts reales.
3. **Guardrails de salida** *(alto/medio)* — `ResponseValidatorService` antes de OutboundQueue: extraer precios/fechas/cantidades de la respuesta y validar contra lo que BookingEngine/Knowledge/BusinessInfo entregaron ese turno; mismatch → retry correctivo o handoff. + Sanitizar chunks RAG y outputs de tools MCP. Vendible como "respuestas verificadas" (precedente legal Air Canada).
4. **Debounce de ráfagas** *(alto/bajo)* — buffer Redis `buf:conv:{id}` con flush ~0.8s: los usuarios de WhatsApp escriben en 3-5 mensajes; hoy cada uno dispara el pipeline y compite por el lock. Menos costo LLM, cero respuestas dobles, mejor intención.
5. **Prompt caching** *(medio/bajo)* — prefijo byte-estable (tools→L1→L2→business) + `cache_control` en Anthropic (90% dto.) y caching automático OpenAI. Sticky routing por conversación para preservar hit-rate entre fallbacks. Loggear `cached_tokens` por tenant.
6. **Latencia percibida** *(alto/medio)* — typing indicator vía IChannelAdapter, troceo de respuestas en 2-3 burbujas, `executeStream` (existe, nadie lo llama) para el widget con SSE. Targets: <2s percibido.
7. **RAG 2.0** *(alto/medio)* — query rewriting conversacional (anáforas "¿y eso cuánto sale?" embeben basura), tsvector/BM25 + RRF en vez del boost ILIKE, reranker, cache de embeddings de queries, migrar cliente de embeddings a LlmKeyService (hoy `OPENAI_API_KEY` del env hardcodeado), evaluar embedding multilingüe.
8. **Routing por valor** *(medio/bajo)* — `analyzeComplexity`/`analyzeSentiment`/lead score ya se calculan y no influyen: lead caliente o etapa de cierre → tier superior; small talk → tier_4. Honrar `persona.llm.temperature/maxTokens` (hoy ignorados). RouteLLM demostró 95% de calidad frontier con 14-26% de uso.
9. **Tool loop endurecido** *(medio/medio)* — Promise.all para tools del mismo turno, timeout por tool (MCP externas pueden colgar el turno), validación de args contra schema, errores estructurados `{error, retryable}`.
10. **Internacionalizar capas deterministas** *(medio/bajo)* — interpreter solo parsea fechas en español ("amanhã às 15h" falla); mensajes de confirmación/handoff hardcodeados en español. Extender regex a en/pt/fr y rutear por `msg()`.
11. **Follow-ups proactivos generativos** *(alto/medio)* — cron que detecta booking abandonado a mitad de máquina (step≠idle/booked + sin respuesta 2-24h) o cotización sin cierre, y genera follow-up contextual respetando ventana 24h/plantillas/opt-out. El estado ya existe; es el feature "sales agent" con más ROI directo.
12. **Contexto por tokens** *(bajo/bajo)* — reemplazar `MAX_HISTORY_CHARS` (12k chars) por presupuesto en tokens contra `maxContextTokens` del modelo candidato.
13. **Multimodalidad saliente** *(medio/medio)* — enviar imágenes de producto/propiedad al recomendar (media module ya existe), carruseles fuera del booking, TTS opcional cuando el cliente manda audios.

---

## 5. Workstream 3 — Brechas competitivas / producto

1. **Outcome pricing opcional** — plan base + "por cita agendada / lead calificado" (outcomes verificables por el motor determinístico, sin modelo evaluador). Mensaje potente para PyMEs escépticas de pagar "por mensajes".
2. **Payment-at-booking + agentic commerce** (T0.3 aplazado) — link/QR de MercadoPago (y PIX para Brasil) generado por el agente en el chat, registrado como venta en CRM. WhatsApp Flows para checkout (40%+ conversión reportada). Cierra vender→cobrar→agendar en un chat.
3. **WhatsApp Flows en el booking** — adoptar Flows para pasos estructurados (servicio/fecha/datos/confirmación); alineado con la filosofía "el LLM no decide el flujo".
4. **Preparación BSUID** (H2 2026) — IdentityService y todo lo indexado por teléfono debe soportar el Business-Scoped User ID como identificador primario (mapeo phone↔BSUID, dedup de contactos).
5. **Resolution rate como métrica de marketing** — Tidio vende con "67% automatizado". T0.1 ya calcula la métrica: exhibirla en dashboard Y en la landing.
6. **Prospección híbrida (no AI SDR autónomo)** — el mercado validó híbrido IA+humano: módulo de campañas de prospección con secuencias desde el CRM; el agente abre/da seguimiento, la consola cierra. + Modo "draft-for-approval" en la consola (el agente humano aprueba/edita la respuesta sugerida en un click).
7. **Handoff tipificado por categoría de decisión** — descuento fuera de política, queja, monto alto, VIP detectado en memoria — configurable por tenant.
8. **Voice AI sobre WhatsApp Calling API** (T3.18 aplazado; GA desde jul-2025, LatAm cubierto) — agente de voz que atiende llamadas WhatsApp contra el mismo BookingEngine. Nadie en SMB LatAm lo tiene bien resuelto. Candidato H2, plan-gated alto.
9. **TikTok como 6º canal** (comentarios→DM) — Manychat ya lo tiene; creciendo en LatAm. Evaluar para el adapter pattern.
10. **Brasil**: modelar el fee de $0.0625/mensaje no-template antes de entrar; transparentar pass-through de costos Meta como Wati.

---

## 6. Workstream 4 — Landing y mensaje

### Diagnóstico (auditoría de copy jun-2026)

El test de 5 segundos falla parcialmente: "qué es" pasa a medias (el titular dice vende/agenda/atiende 24/7 pero el sujeto es "La IA" no "tu negocio"), "para quién es" falla (badge y subtítulo usan "IA conversacional de 5 canales" y "motor cognitivo de 3 capas"), y "qué gano" falla en el home (los resultados +45% conversiones, 3 seg de respuesta, -60% no-shows solo existen en `/soluciones/[slug]`, nunca en la portada).

Fortalezas reales: demos interactivos por industria (mostrar > contar), strip antes/después (6h→3 seg), tabla comparativa vs manual/chatbots básicos, FAQ en lenguaje llano, CTA sin tarjeta de crédito.

**Fallas estructurales** que cortar primero:
1. La sección de problema/agitación (`problem.*` en es.json) **existe completa pero ningún componente la renderiza** (grep: 0 referencias) — la columna vertebral problema→agitación→solución está escrita y no se usa.
2. HowItWorks (objeción #1 del dueño no técnico: "¿es fácil de usar?") está en posición 6, después de 3 showcases consecutivos que exigen explorar antes de convencer.
3. Jerga de ingeniería en todo el funnel incluyendo las tarjetas de precio: "motor cognitivo de 3 capas", "RAG++", "Z-score", "Layer 1/2/3", "AES-256-GCM", "WebSockets".
4. Prueba social con números redondos no verificables: 500 negocios × 2M conversaciones/mes = 4.000 conv/negocio/mes → matemáticamente sospechoso; puede destruir más confianza de la que construye.
5. Mezcla voseo/tuteo en la misma frase ("Mira todo lo que podés hacer") — inconsistencia de marca para Colombia/México (core del mercado).

### Problemas identificados

| Severidad | Ubicación (archivo/clave) | Descripción |
|-----------|--------------------------|-------------|
| **critical** | `es.json:89` — `hero.subtitle` | "motor cognitivo de 3 capas" y "llena tu CRM" — jerga de arquitectura en el momento más caro. |
| **critical** | `page.tsx` — sección problema ausente | `problem.*` en es.json (título + 3 cards de dolor) con 0 referencias en componentes. Sin problema no hay "sé que lo necesito". |
| **high** | `page.tsx` — orden de secciones | TrustRow en posición 2 (antes de entender el producto); HowItWorks en posición 6 tras 3 showcases consecutivos. |
| **high** | `es.json` — ToolsShowcase + FeaturesGrid | "Arquitectura Cognitiva de 3 Capas", "RAG++", "Z-score", "AES-256-GCM, datos aislados por tenant" — vocabulario de ingeniería como beneficio. |
| **high** | `es.json:574-618` — PricingSection features | "1 agente IA con Layer 1", "Consola por WebSockets", "RAG de 5 niveles", "Z-Score" — jerga en el punto exacto de decisión de compra. |
| **high** | `StatsCounter`, `TestimonialsSection`, `hero.trustline` | Números redondos (500 negocios, 2M conv, 4.9/5) + testimonios genéricos sin nombre real. La matemática no cierra. |
| **high** | Todo `es.json` — voz | Mezcla voseo ("respondés", "elegí", "mirá") + tuteo ("por ti", "Conecta", "Mira") en la misma frase. |
| **medium** | VerticalsShowcase — posición 2 | Duplica el picker del hero con 18 verticales × 4 clusters en la segunda pantalla: sobrecarga antes de convencer. |
| **medium** | `StatsCounter.tsx:12` | Hardcodea "16 industrias"; hero, meta y nav dicen "18". |
| **medium** | Time-to-value — 4 promesas distintas | "1 hora" (hero), "5+3 min/Inmediato" (pasos), "10 minutos" (verticales), "< 10 min" (faq.a1). El comprador no sabe cuál creer. |
| **medium** | PricingSection — moneda | "Precios transparentes en moneda local" muestra solo COP; un visitante mexicano ve contradicción inmediata. |
| **medium** | Hero + FAQ — CTA y contacto | No hay demo por WhatsApp (wa.me) para un producto que automatiza WhatsApp; contacto del FAQ es un mailto. |
| **medium** | `es.json:3` — `meta.title` | "IA conversacional" como primer término en SERP; el dueño busca "responder WhatsApp automático". |
| **low** | `es.json:651` — `cta.title` | "Esto es lo que necesita tu negocio" — afirma sin demostrar; vacío como cierre de página. |
| **low** | `MultiChannelShowcase.tsx`, `data/verticals.ts` | `CHANNEL_SCENARIOS` y `demoMessages` hardcodeados en español — visitantes en/pt/fr ven demos en español. |

### Rewrites prioritarios (todos requieren actualizar los 4 JSON de i18n)

**hero.title / hero.titleHighlight (es.json:87-88)**
- Actual: `La IA que <em>vende, agenda y atiende</em> por ti — 24/7`
- Propuesto: `Tu negocio <em>responde, agenda y vende solo</em> por WhatsApp — 24/7`
- Sujeto pasa de "La IA" a "tu negocio"; ancla WhatsApp para reconocimiento instantáneo.

**hero.subtitle (es.json:89)**
- Actual: `...motor cognitivo de 3 capas, llena tu CRM y agenda citas de forma inteligente.`
- Propuesto: `Mientras tú atiendes tu negocio (o duermes), tu asistente con IA contesta cada mensaje en segundos, agenda citas y guarda los datos de cada cliente para que ninguna venta se escape. Lo configuras una vez, sin saber de tecnología.`
- Elimina jerga; formato problema→resultado; ataca objeción #1 del no técnico.

**hero.badge (es.json:86)**
- Actual: `IA conversacional de 5 canales · 18 industrias · Hecho en LatAm`
- Propuesto: `Tu vendedor con IA · WhatsApp, Instagram y 3 canales más · Hecho en LatAm`

**problem.\* — montar componente + normalizar voz**
- Normalizar `perdés`→`pierdes`, `respondés`→`respondes`, `lead`→`cliente`; montar sección inmediatamente después del hero (copy ya existe en es.json).

**tools.tool6Title / tool6Desc (es.json:82-83) — "Arquitectura Cognitiva de 3 Capas"**
- Propuesto título: `Un asistente con tu tono y tus reglas`
- Propuesto desc: `Decide cómo habla tu asistente en cada canal: formal en email, cercano en Instagram. Tú pones las reglas — qué puede prometer, qué no — y él las cumple en cada conversación.`

**tools.tool5Title / tool5Desc (es.json:80-81) — "Base de Conocimiento de 5 Niveles"**
- Propuesto título: `Responde con tu información real — no inventa`
- Propuesto desc: `Sube tu catálogo, tus precios, tus preguntas frecuentes y tus políticas. Tu asistente responde solo con lo que tú cargaste: nunca inventa precios ni promete lo que no puedes cumplir.`

**tools.tool4Desc (es.json:79)** — eliminar "Z-score" y "anomalías"
- Propuesto: `Mira en vivo cuántos clientes te escriben, qué tan rápido respondes y qué canal te genera más ventas. Si algo se sale de lo normal, te avisamos — sin esperar reportes a fin de mes.`

**features.f7Title (es.json:511) — "Base de conocimiento (RAG)"**
- Propuesto: `Responde con tu información, no inventa`

**features.f11Desc (es.json:520)** — eliminar "GDPR-ready, audit log inmutable, AES-256-GCM, datos aislados por tenant"
- Propuesto: `Tus datos y los de tus clientes protegidos con cifrado de nivel bancario, separados por empresa y con respaldo diario. Cumplimos normas internacionales de privacidad.`

**pricing.\*Features — renglones con jerga (es.json:577, 603, 613-614)**
- `1 agente IA con Layer 1` → `1 asistente IA listo para tu industria`
- `Consola por WebSockets en vivo` → `Consola de equipo en tiempo real`
- `RAG de 5 niveles` → `base de conocimiento avanzada`
- `Detección de anomalías Z-Score` → `Alertas automáticas cuando algo se sale de lo normal`

**cta.title (es.json:651)**
- Actual: `Esto es lo que necesita tu negocio`
- Propuesto: `Tu asistente puede estar respondiendo clientes hoy mismo`

**hero.trustline + socialProof.trust (es.json:108, 538)**
- Actual: `Más de 500 negocios en LatAm ya automatizan con Parallly`
- Propuesto: `Integración oficial de Meta para WhatsApp, Instagram y Messenger · Pagos seguros con MercadoPago`
- Credenciales verificables > números redondos no auditables. Volver al conteo cuando haya clientes reales referenciables.

**meta.title (es.json:3)**
- Actual: `Parallly — IA conversacional para vender, atender y agendar 24/7`
- Propuesto: `Parallly — Tu negocio responde, agenda y vende solo por WhatsApp, 24/7`

**trust.title (es.json:111)**
- Actual: `Confianza, seguridad y respaldo de los grandes`
- Propuesto: `Respaldados por Meta y MercadoPago`

**howItWorks.subtitle (es.json:485)**
- Actual: `...Si sabés usar WhatsApp, sabés usar Parallly.`
- Propuesto: `Sin código y sin técnicos. Si sabes usar WhatsApp, sabes usar Parallly.`

### Cambios estructurales (página `apps/landing`)

1. **Montar sección de problema** — crear componente `ProblemSection` que renderice `problem.*` inmediatamente después del hero.
2. **Mover HowItWorks a posición 3** — después del problema: "en 3 pasos estás operando" responde la objeción #1 antes de pedir explorar features.
3. **Mover TrustRow a antes de PricingSection** — los badges de seguridad responden dudas de final de funnel, no la pregunta inicial "¿qué es esto?".
4. **Agregar banda de resultados en home** — reutilizar `industryPage.roiStat*` (+45% conversiones · respuesta en 3 seg · -60% no-shows) entre el problema y HowItWorks.
5. **Deduplicar demos** — reducir VerticalsShowcase a 6-8 verticales tier-1 con "Ver las 18 industrias →" → `/soluciones`; fusionar MultiChannelShowcase como pestañas dentro.
6. **Recortar FeaturesGrid** de 12 a 6 tarjetas por resultado (Vender más / Ahorrar tiempo / No perder ningún cliente); mover compliance y roles/permisos al FAQ.
7. **Estandarizar voz a tuteo neutro** en todo `es.json` (Colombia/México son el core); aplicar el mismo criterio en pt/fr/en al propagar.
8. **Unificar números**: (a) `StatsCounter.tsx:12` → "18 industrias"; (b) una sola promesa de time-to-value: "primer agente listo en 10 minutos, operando el mismo día".
9. **Agregar CTA wa.me** — "Habla con nuestra IA ahora" junto a "Probar gratis 7 días" en hero y CTABanner; reemplazar el mailto del FAQ por ese mismo WhatsApp.
10. **Resolver contradicción de moneda** — cambiar título a "Precios claros, pagas en tu moneda con MercadoPago" con nota visible de las 7 monedas soportadas.

### Nuevas secciones a crear

- **"Tu IA bajo control"** — 3 promesas: (1) responde SOLO con tu información, (2) deriva a un humano cuando no sabe, (3) cada conversación es auditable. + FAQ "¿Y si la IA dice algo incorrecto?". Respaldado por RAG con umbral, handoff configurado, booking determinístico, trace view.
- **Demo animado en hero** — convertir el picker de industria existente en simulación de chat WhatsApp animada (cliente → IA → cita agendada / pregunta respondida). Ninguno de los 6 competidores analizados tiene esto.
- **Landing pages verticales** — `/para/restaurantes`, `/para/salud`, etc. con H1 + demo + métricas por industria. Las claves `verticals`/`industryPage`/`solutions` ya existen; falta el routing y los componentes.
- **Elevar "Vibe Selling"** a mensaje central — "No es un chatbot de flujos ni un CRM con bot pegado — es un vendedor IA que ya sabe vender en tu industria". Disputar la narrativa antes de que Leadsales se la apropie.

### Prioridad de ejecución

| Fase | Qué | Esfuerzo |
|------|-----|----------|
| Días 1-2 | Rewrites hero/subtitle/badge + montar sección problema + normalizar voseo | S |
| Semana 1 | Rewrites tools/features/pricing/cta/meta + unificar voz y números | M |
| Semana 2 | Reordenar secciones (2-4) + CTA WhatsApp (9) | M |
| Semana 3 | Dedup demos (5) + recortar FeaturesGrid (6) + moneda (10) | M |
| Mes 2 | Demo animado + "Tu IA bajo control" + landing pages verticales | L |

---

## 7. Workstream 5 — Fundamentos

1. **Trazas paso-a-paso por turno** (razonamiento→tool→resultado→decisión) persistidas — alimentan evals offline y debugging; Trace View (T1.7) ya da la base.
2. **TTFT por proveedor como señal del breaker** (no solo errores) + medir latencia end-to-end webhook→cliente.
3. **Redis del lock**: token de ownership + Lua compare-and-delete + watchdog de renovación (patrón estándar Redlock simplificado).
4. **Sweep de idempotencia**: SETNX en todos los webhooks, marcar DESPUÉS de encolar (no de procesar), namespacing por cuenta.
5. **Timeouts en todo el perímetro**: SDKs LLM (30-60s), fetch de adapters de envío, tools MCP externas.
6. **Costos LLM reales**: separar input/output por modelo en el registry (la tarifa blended actual desvía los márgenes que reporta financials).

---

## Secuencia sugerida

- **Semana 1-2**: P0 completos + P1 de booking/intención + debounce de ráfagas. (Workstream 1 + items 4 de WS2)
- **Semana 3-4**: P1 de concurrencia/providers + prompt caching + landing fase 1 (hero, "Tu IA bajo control", CTA). 
- **Mes 2**: Memoria de cliente + evals como gate + guardrails de salida + landing fase 2 (demo interactivo, verticales).
- **Mes 3**: RAG 2.0 + follow-ups proactivos + routing por valor + outcome pricing (diseño de negocio) + payment-at-booking.
- **H2 2026**: Voice AI, BSUID, WhatsApp Flows checkout, prospección híbrida, TikTok.

---

## Nota de auditoría

- Workflow multi-agente `wf_bebde273-439` (77+ agentes, ~2M tokens, 3 runs por límite de sesión): 87 hallazgos brutos → 86 dedupe.
- **Críticos/altos**: 19 confirmados adversarialmente + 5 verificados manualmente contra el código = **24 válidos**. **3 refutados** con razón:
  - `conversations.service.ts:947` dateLabel UTC — `TIMESTAMP WITHOUT TIME ZONE` se almacena en la TZ del tenant; el bug no existe. (Distinto de `:1063 todayISO`, que SÍ se confirmó y corrigió — ese usa `toISOString()` para calcular "hoy" y sí daba fecha UTC.)
  - `anthropic.provider.ts:145` merge de tool_results — los mensajes tool pasan por la rama de la línea 128-141 y nunca alcanzan la lógica de merge; no se pierden.
  - `executeStream` con fallos — función sin call sites en el repo (código muerto, no ejecutable).
- Los **P0 y P1 de la sección 3** fueron validados leyendo cada `file:line` citado — los bugs existen en el código.
- Los P2/bajos (35+23) tienen evidencia citada pero **sin verificación adversarial completa**.
- Investigación de mercado: 40 findings con fuentes (jun-2026) de 3 investigadores web independientes.
- Auditoría de landing: 15 problemas (2 critical / 5 high / 5 medium / 3 low) + 15 rewrites con copy antes/después + 10 cambios estructurales (sección 6).
