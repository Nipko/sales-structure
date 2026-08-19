# Diagnóstico y estrategia del agente conversacional — Ago 2026

> **Fecha:** 2026-08-19 · **Estado:** DIAGNÓSTICO Y PLAN — nada de esto está construido todavía.
> **Alcance:** por qué el agente se repite, no confirma, alucina resultados, usa mal las tools y a veces calla; por qué los 14 commits del 17-18 de agosto no lo arreglaron; qué hacen hoy los líderes del sector; qué se rediseña, qué se conserva y en qué orden — para las 18 verticales, no para una.
> **Método:** 6 auditorías forenses de código (una por familia de fallo, cada hallazgo con archivo:línea verificado contra `origin/main` a las 01:00 del 19-ago, es decir, DESPUÉS de los commits D1-D14), 5 investigaciones externas del estado del arte 2025-2026 (arquitecturas líderes, fiabilidad del tool-use, frameworks/runtimes, evaluación/observabilidad, WhatsApp/LatAm) y verificación directa propia de los dos hallazgos críticos. Complementa y en varios puntos corrige `docs/agent-system-analysis-2026-08.md` (§4).
> **Cómo leerlo:** §0 es el veredicto en una página. §1-§5 el diagnóstico. §6 el mundo. §7-§9 la arquitectura objetivo y el mapa por vertical. §10-§11 el sistema de calidad y el plan. §12 las decisiones que sólo el dueño puede tomar. §13 la validación de `agent-audit-decente-2026-08.md` y la respuesta a "¿es el modelo?". Anexos con el detalle.

---

## 0. Resumen ejecutivo

**Veredicto.** No hay que reescribir la plataforma ni seguir parchando el prompt. Hay que **rediseñar el núcleo del turno transaccional**: generalizar a las 18 verticales lo que ya funciona en citas (un motor determinístico que es dueño del estado, de la confirmación y de la ejecución, con el LLM como intérprete y redactor) y sacar al modelo de lenguaje del camino crítico del "commit". Todo lo demás —colas, idempotencia de entrada, multi-tenant, canales, router, RAG, CRM, handoff, simulación— se conserva. Es un cambio de núcleo con estrategia *strangler* (nuevo runtime detrás de un flag por tenant, vertical por vertical), no un big-bang.

**Por qué falla, en una frase.** Para toda transacción que no sea una cita, cerrar una operación exige hoy que un modelo de gama media (gpt-4.1-mini o deepseek-chat), con un historial que sólo tiene texto y sin ver la operación pendiente, **vuelva a emitir por su cuenta exactamente la misma tool con los mismos argumentos** tras el "sí" del cliente, y que esa tool esté en la lista de ese turno. Es una cadena de cinco eslabones probabilísticos para algo que en citas es determinístico. Cada parche del 17-18 de agosto endureció un eslabón (qué cuenta como "sí", qué cuenta como "los mismos args", qué frases prohibir) sin quitar la dependencia. Dos de esos parches, además, empeoraron producción.

**Los dos defectos críticos vigentes en producción hoy** (verificados por dos auditores independientes y por mí):

1. **El guardrail anti-alucinación corre ciego** (`c29c4e0f`, 18-ago 12:17): `applyOutputGuardrails` se invoca sin la lista de tools ejecutadas (`conversations.service.ts:2424-2426` pasa 6 argumentos; la firma en `:2645` espera el 7º), así que `backed` es siempre `false` y **toda frase de completitud —incluida la de una reserva que SÍ se creó— se reescribe como "está pendiente"** en los 4 idiomas y las 18 verticales. El cliente vuelve a decir "sí", el modelo vuelve a llamar la tool, y el sistema pide confirmar (o repite) algo ya hecho. Es, con alta probabilidad, la causa directa de las "pruebas pésimas" posteriores a ese commit.
2. **El recorte de tools a 10 borra la tool de escritura justo en el turno del "sí"** (`3cc9f6a9`, 18-ago 23:22, ítem D2/D7 del roadmap anterior): `tool-retrieval.service.ts` puntúa por solapamiento de palabras del mensaje actual; "sí"/"ok" tienen ≤2 caracteres y se descartan (`:62`), nada supera `MIN_SCORE 0.15` y el fallback devuelve las 10 primeras por orden de registro (`:43`) = 8 tools de citas + catálogo. `create_property_booking`, `place_order`, `enroll_student`, `book_class`, `calculate_quote`… **desaparecen del turno de confirmación** (se registran al final, `conversations.service.ts:1952-1993`). Como la ejecución sólo ocurre si el LLM re-emite la tool, el modelo responde texto ("¡listo, reservado!") o llama `create_appointment`.

**Las cinco causas raíz** (todas verificadas, detalle en §2-§5):

| # | Causa raíz | Síntoma que produce | Dónde vive |
|---|---|---|---|
| R1 | El LLM está en el camino crítico del commit: el "sí" no ejecuta nada por sí mismo; sólo si el modelo re-emite la tool idéntica y esa tool sigue en la lista | no confirma · pide confirmar lo ya hecho · alucina "listo" | `tool-execution-control.service.ts:1329-1438`, `tool-retrieval.service.ts`, historial texto-only `conversations.service.ts:2120` |
| R2 | El estado del turno está repartido en ~10 almacenes con TTLs distintos, la respuesta no se persiste antes de enviarse y los efectos de las tools no quedan en el historial | repetición · mezcla de respuestas · negar acciones reales · amnesia a los 30 min | lock 30s / buf 60s / ledger 15m / newSession 30m / affinity 30m / booking 1h / handoff 24h |
| R3 | El modelo que decide las tools es el más barato del plan y el router lo "pega" a la conversación | mala selección · args con deriva · reglas ignoradas | `llm-router.service.ts:49-67, 290-315, 372-387`; emprendedor/starter → deepseek-chat 64k para TODO tool_calling |
| R4 | Dos conductores sobre la misma conversación (FSM de citas y LLM+tools) que se ceden el turno por regex en español | pierde el hilo · agenda "cita" en vez de propiedad · doble confirmación | `conversations.service.ts:2802-2835`, `booking-engine.service.ts:753-755` |
| R5 | El harness de calidad es estructuralmente ciego: writers apagados antes del preflight, juez que sólo ve texto, cero specs sobre `generateResponse`; los parches se despliegan "en verde" | los bugs llegan a prod; el dueño es el harness | `agent-test.service.ts:174-205`, `ai-tool-executor.service.ts:127-129`, `simulation.service.ts:503`, `quality.service.ts:28-51` |

**Qué dice el mundo (2025-2026).** Ningún líder (Sierra, Decagon, Intercom Fin, Agentforce, Zendesk, Cresta, Parloa, Rasa CALM, Parlant, Google ADK 2.0) opera un "agente ReAct libre con decenas de tools y un prompt de 20 reglas". Todos convergieron en: (a) el LLM interpreta y propone dentro de un procedimiento explícito; (b) el código valida precondiciones y ejecuta; (c) la confirmación es un **estado** del procedimiento (pausar-serializar-reanudar), nunca una regla del prompt; (d) el mensaje de resultado se genera **desde** el resultado real de la tool; (e) tools acotadas por estado (≤10-15); (f) simulaciones + regresión con `pass^k` como gate. Los números lo respaldan: τ-bench muestra que incluso los mejores modelos caen por debajo del 25% en `pass^8`; el 45-48% de los fallos en τ²-bench son "false success" (afirmar lo que no ocurrió); la precisión de selección cae con el catálogo y sube al recortar a las tools relevantes; en BFCL v4 multi-turno gpt-4.1-mini saca 34,1% y DeepSeek-V3.2 37,4% frente a 53,6% de Haiku 4.5 y 61,4% de Sonnet 4.5. En WhatsApp, la industria LatAm (Botmaker, Yalo, Manychat, Kommo, Blip) no confía el "sí" al texto libre: la transacción corre sobre botones/listas/Flows y el LLM conversa alrededor. Y desde el **1-oct-2026 Meta cobra cada mensaje de servicio**: fragmentar en 3-4 burbujas o repetir cuesta 3-4× por turno.

**El plan (§11).** F0 *Estabilización quirúrgica* (días): 10 arreglos acotados y verificados —ninguno es "otra regla en el prompt"— empezando por el call-site del guardrail y el recorte de tools, y por ejecutar la operación pendiente en el servidor cuando llega el "sí" (como ya hace el FSM). F1 *Runtime de Operaciones* (4-6 semanas): el núcleo nuevo con 3 verticales piloto y un harness τ-style que gatea. F2 *18 verticales* (catálogo de operaciones, tools de cierre faltantes, citas absorbidas por el runtime). F3 *Calidad continua* (gates en CI, replay de fallos reales, canary por versión). F4 *Excelencia* (memoria entre conversaciones, Flows, empatía adaptativa, voz) — sólo después de la fiabilidad.

**Lo que hay que decidir ya (§12):** aprobar el rediseño del núcleo (opción B) · aceptar un modelo más caro sólo para el rol decisor · confirmación por botones como estándar en WhatsApp con texto como respaldo determinístico · un mensaje por turno · verticales piloto · congelar los parches al prompt/clasificador mientras dure F0-F1 · ningún cambio del agente sin pasar el harness.

---

## 1. Cómo funciona hoy el turno (mapa real, resumido)

Verificado sobre `origin/main` del 19-ago (incluye D1-D14). Números de línea de `apps/api/src/modules/conversations/conversations.service.ts` salvo indicación.

| Paso | Qué hace | Dónde | Observación clave |
|---|---|---|---|
| Entrada | Webhook encola en `inbound-messages` (attempts 3, backoff 5s, jobId por pmid); API y worker consumen ambos (concurrency 4+4) | `inbound-queue.*`, `app.module.ts:205`, `worker.main.ts:20` | Un turno puede correr en cualquiera de los dos procesos |
| Debounce | Ráfaga 800 ms en Redis `buf:conv` (Lua); fragmentos previos devuelven `null` y no se guardan como fila | `:307`, `:2548-2576` | En un reintento el buffer ya se drenó |
| Lock | `lock:conv` TTL 30 s + heartbeat; espera 18×2 s y **procesa igual** si no lo obtiene | `:346-369` | Dos turnos LLM concurrentes es un caso ordinario con turnos de 10-60 s |
| Salidas tempranas | sin persona / fuera de horario / `waiting_human` / dedupe / atajos de citas / opt-out / handoff por keyword / cuota | `:456-686` | Varias devuelven sin enviar nada y sin error → "silencio exitoso" |
| Sesión | >30 min sin mensajes → borra `booking:{conv}` y `metadata.toolContext/bookingState`; NO borra ledger ni `procedure:` ni afinidad | `:1541-1558` | TTLs desincronizados |
| Motor de citas | Si `tools.appointments.enabled` y no cede por regex ES → `BookingEngine.process` → directive + `tools=[]` | `:1721-1855`, `:2802-2835` | El único flujo determinístico de la plataforma |
| Registro de tools | Familias por flag (93 definiciones en total; turismo típico ≈31-33 ≈5,5k tokens); vertical al final | `:1886-1993` | Sin rama por industria |
| Recorte | Si >10 → `retrieveRelevantTools(userText+industry+step)` a 10 | `:1997-2002`, `tool-retrieval.service.ts` | Con "sí" → fallback a las 10 primeras (citas + catálogo) |
| Prompt | L1 contrato (~20 reglas + guardrails) + L2 persona + L3 turno | `prompt-assembler.service.ts:77-120` | Reglas 2b/13b/14/15/16/17 son parches acumulados |
| Historial | `SELECT direction, content_text … LIMIT 31`; directive → últimos 4; newSession → sólo actual | `:2120-2158` | **Sin tool_calls ni tool_results de turnos anteriores** |
| Loop LLM | 5 iteraciones; task `tool_calling` mientras haya tools (temp 0,3), si no `conversation` (temp persona); cada iteración vuelve a rutear | `:2221-2245`, `llm-router.service.ts:318-449` | El modelo puede cambiar a mitad de turno |
| Preflight de escritura | Ledger por `tool_name+args_hash`; challenge; sólo ejecuta cuando el LLM re-emite la misma tool con el mismo hash tras un inbound 'confirmed' | `tool-execution-control.service.ts:896-999, 1228-1288, 1329-1438` | La confirmación no la ejecuta el servidor: la ejecuta el modelo (si quiere y si puede) |
| Guardrails de salida | Claims sin tool (roto: sin `executedTools`) + precios | `:2424-2426`, `:2638-2690` | Reescribe confirmaciones verdaderas |
| Salida | Chunks de 600 chars con stagger 1,2 s; `dedupeId {pmid}:reply:{i}`; `saveAiMessage` sin dedupe | `:722-751`, `:1344-1361` | En resume, dos redacciones se mezclan y ambas quedan en el historial |
| Post | `failedAttempts`, pipeline, scoring, nurturing, memoria cada 6 msgs | `:2444`, `:2379-2384` | `failedAttempts ≥3` → handoff |

---

## 2. Síntoma → mecanismo → evidencia → verticales afectadas

Cada fila está verificada en código (no inferida de logs). "Todas" = las 18.

| Síntoma que ve el cliente | Mecanismos verificados (id del anexo A) | Archivo:línea | Verticales |
|---|---|---|---|
| **Confirma y el agente dice que "falta confirmar"; vuelve a pedir el sí; a veces repite la operación** | Guardrail sin `executedTools` reescribe toda confirmación real (FT-1/EC-1) · el "recuerdo de operación cumplida" sólo aplica con "sí" literal + hash idéntico (FT-2) · nada rehidrata la operación pendiente en el prompt (FT-4) · args con deriva → nuevo challenge en vez de escalar o cerrar (EC-7) · challenge caduca a los 15 min y newSession no lo invalida (DE-05) | `conversations.service.ts:2424,2645`; `outcome-claim.util.ts:89`; `tool-execution-control.service.ts:243,1259-1272,1363,1417,1740` | Todas (citas incluidas por el guardrail) |
| **Dice "sí" y no pasa nada / el agente responde texto sin ejecutar** | El recorte a 10 saca la tool escritora del turno del "sí" (HM-1/V-01) · la ejecución depende de que el modelo re-emita la tool idéntica sin ver los args (HM-2/V-02) · el resultado `confirmation_required` no le dice al modelo qué re-llamar (FT-4) · el modelo del turno corto es deepseek/gpt-4.1-mini (HM-3) | `tool-retrieval.service.ts:28,43,62`; `conversations.service.ts:1997-2002`; `tool-execution-control.service.ts:1745` | Todas las LLM+tools: turismo (alojamiento y tours), restaurantes, education, gimnasios, seguros, servicios_hogar, fotografía, veterinaria (register_pet), inmobiliaria |
| **Anuncia una reserva/pago/inscripción que no existe** | Sin la tool en la lista o sin re-emisión, el modelo "cierra" con texto (V-01, HM-2) · 6 verticales no tienen tool de cierre para su transacción principal y el prompt las empuja a vender (V-04) · reserva→pago exige dos rondas y un `payableReference` que el modelo ya no ve (HM-4) · el catch final borra el rastro de tools ya ejecutadas → el turno siguiente niega o repite (DE-04) | `tool-policy-registry.ts:239-245,322-330`; `payment-tools.ts:16`; `conversations.service.ts:2484-2503` | Turismo, restaurantes, education, gimnasios, retail/otro, automotriz, inmobiliaria, pet_services, pagos |
| **Doble confirmación en citas ("Error al crear la cita: confirmation_required")** | El FSM confirmado por TEXTO llama `create_appointment` sin `authorityEvidence` → el control central pide su propia confirmación (FT-3) | `booking-engine.service.ts:753-755,978`; `tool-execution-control.service.ts:1456-1462` | Las 13 verticales con agenda, en Telegram/IG/Messenger/widget siempre y en WhatsApp cuando escribe en vez de tocar el botón |
| **Repite preguntas / vuelve a listar lo mismo / repite el mismo texto** | Historial texto-only: el modelo no sabe qué tools llamó ni qué obtuvo (FT-6) · dedupe sólo intra-iteración · citas invisibles en `active_objects` para salud/seguros/finanzas/serv. profesionales/veterinaria e industria no canónica (FT-7) · reintento del turno mezcla dos redacciones y guarda ambas (DE-02) · lock ignorado tras 36 s → dos turnos concurrentes (DE-03) · fragmentos del debounce no se persisten (DE-08) · atajos de citas secuestran "sí"/"reagendar" genéricos (DE-10) | `conversations.service.ts:2120,2270,356,498,743,565`; `active-object-policy.ts:78,98`; `provider-message-id.util.ts:58` | Todas |
| **Pierde el hilo a mitad de una reserva vertical / agenda "cita" en vez de propiedad** | El FSM sólo cede por regex de objeto vertical en español; el turno "sí"/"el sábado a las 10" no matchea y el FSM recupera el turno (V-03, FT-8) · APPOINTMENT_TOOLS siempre registradas y primeras en el fallback del recorte (HM-6) | `conversations.service.ts:2813-2835`; `booking-engine.service.ts:659-664` | inmobiliaria, gimnasios, restaurantes, education, automotriz, veterinaria, pet_services; cualquier vertical en en/pt/fr |
| **Precios/datos inventados; se cambia el nombre** | Modelo débil + prompt de 20 reglas + `possible_knowledge` de score bajo; el guardrail de precios funciona pero llega tarde (validado en D14) · regla 2b añadida como parche | `prompt-assembler.service.ts:85,95`; `llm-router.service.ts:49-67` | Todas; más en planes emprendedor/starter (deepseek) |
| **No responde / responde tarde / "se desconectó"** | Silencios "exitosos" sin métrica ni alerta (DE-01) · handoff sin retorno automático: `waiting_human` calla para siempre y el auto-resolve 72 h lo excluye (DE-06) · auto-resolve abre conversación nueva con historial vacío (DE-07) · escalada a humano por bloqueos técnicos del ledger (FT-5) · 3-4 llamadas LLM por turno (retrieval no; guardrail retry sí, cierre forzado sí) con 45 s de timeout cada una | `conversations.service.ts:456,473,749,2346,2467`; `nurturing.service.ts:214`; `handoff.service.ts:371` | Todas |
| **Escalado a humano sin pedirlo** | `shouldHandoff:true` reutilizado con dos semánticas (intake de dominio vs bloqueo técnico) (FT-5) · `failedAttempts ≥3` tras fallbacks genéricos (DE-04) | `conversations.service.ts:2346`; `tool-execution-control.service.ts:1684,1698`; `handoff.service.ts:126` | Todas; más en pagos/descuentos (A4) |

---

## 3. Los dos defectos críticos vigentes en producción (detalle)

### 3.1 Guardrail de claims sin las tools ejecutadas (desde `c29c4e0f`, 18-ago 12:17)

```ts
// conversations.service.ts:2424-2426 — único call-site
finalResponse = await this.applyOutputGuardrails(
    finalResponse, systemPrompt, currentMessages, allowedTiers, tenantId, conversation.id,
);
// conversations.service.ts:2638-2650 — firma y uso
private async applyOutputGuardrails(response, systemPrompt, currentMessages, allowedTiers, tenantId, conversationId,
    executedTools?: Array<{ name: string; result: any }>) {
    ...
    const claimAudit = auditTurnClaim(response, executedTools);   // executedTools === undefined → backed = false SIEMPRE
```

- `executedToolsThisTurn` existe (`:2219`) y se llena (`:2313`), pero nunca llega al guardrail.
- `outcome-claim.util.ts:23-40` detecta frases de completitud en es/en/pt/fr ("quedó reservado", "está confirmada", "has been booked", "foi agendado"…). Con `backed=false`, cualquiera de ellas dispara la reescritura (`:2652-2672`) con el prompt literal *"ninguna herramienta ejecutó esa acción con éxito en este turno… explica qué está pendiente"*.
- Efecto en cadena: la reserva SÍ se creó → el cliente lee "está pendiente" → dice "sí" otra vez → el modelo re-llama la tool → si el hash coincide, `idempotentReplay` (bien); si no, **nuevo challenge sobre algo ya hecho**. Además una llamada LLM extra por transacción exitosa.
- También aplica al turno directivo del FSM de citas cuando el LLM vocaliza "quedó agendada": el FSM ejecuta fuera de `executedToolsThisTurn`.
- Por qué pasó el gate: `outcome-claim.util.spec.ts` prueba el util aislado; no hay ningún test que ejecute `generateResponse` con un tool result exitoso (EC-3/EC-4).

### 3.2 Recorte de tools a 10 que descarta la escritora en el turno del "sí" (desde `3cc9f6a9`, 18-ago 23:22)

```ts
// conversations.service.ts:1997-2002
if (!engineProducedText && tools.length > 10) {
    const retrievalQuery = `${userText || resolvedText || ''} ${industry || ''} ${bookingState.step || ''}`;
    tools = this.toolRetrieval.retrieveRelevantTools(retrievalQuery, tools, 10);
}
// tool-retrieval.service.ts:57-62 — tokens ≤2 chars se descartan → "sí", "ok", "va", "no" desaparecen
// tool-retrieval.service.ts:41-43 — si nada supera MIN_SCORE 0.15 → scored.slice(0, 10) = orden de registro
```

- Orden de registro (`conversations.service.ts:1886-1993`): appointments (8) → catalog → faqs/policies/knowledge → offers/orders/crm/ecommerce/payments → integraciones/MCP → **familias verticales al final** (properties, tours, restaurants, gyms, education, insurance, homeServices, petServices, photography, professionalServices).
- Un tenant de turismo con `appointments+catalog+knowledge+properties` supera 10 → en el turno "sí turismo idle" el set queda en 8 tools de citas + `search_products` + `get_product`. `create_property_booking` no está. El preflight sólo puede ejecutar si el modelo re-emite esa tool → **imposible por construcción**.
- El commit lo motivó una recomendación correcta del análisis previo ("tool retrieval") implementada de forma que rompe el eslabón más frágil. El espejo de pruebas (`agent-test.service.ts:174-207`) no aplica el recorte, así que la simulación no lo reproduce (HM-5).

**Nota sobre el estado del repositorio.** El 18 de agosto se hicieron 14 commits sobre el agente (03:50 → 23:26). Los últimos 8 (23:19-23:26, ítems D1-D14 del roadmap del análisis previo) entraron en siete minutos y están desplegados. Contienen cosas valiosas (slot hold, `state.date` stale, inbound lag/traceId, dedupe intra-turno, check→create en propiedades, normalización de precios, Watchtower 5%) y dos que conviene revisar antes de seguir: el recorte de tools (este §3.2) y `EmotionService + preámbulo empático en L1` (`d120c670`), que añade la regla 19 al contrato y una detección afectiva por palabras clave (sin llamada LLM) antes de resolver la fiabilidad (§5.4).

---

## 4. Por qué los parches del 17-18 de agosto no sirvieron

| Commit | Qué cambió | Hipótesis que asumió | Qué dejó abierto (verificado) |
|---|---|---|---|
| `a76d5441` 17-ago | Consentimiento por apertura afirmativa; warn cuando no acepta | "sí, confirmo la reserva" caía en `unclear` | Reconoce en su propio mensaje que args distintos crean otro ledger y no lo toca; nada si el modelo responde texto sin re-emitir |
| `58f3b4d7` 18-ago 03:50 | Args canónicos; replay de ledger `succeeded` si el inbound es 'confirmed'; regla 16 en L1; `outcome-claim.util` + `falseClaims` en simulación; 10 escenarios sin LLM | reserva cumplida invisible; el modelo anunciaba hechos | Replay sólo con "sí" literal + misma tool + mismo hash; sigue dependiendo de la re-emisión; el spec re-emite a mano la tool (EC-4) |
| `c29c4e0f` 18-ago 12:17 | Fix del truncado silencioso de parámetros en `PrismaService` (el token JWT del challenge se guardaba cortado a 500 → el "sí" nunca valía); args distintos → re-challenge; guardrail de claims | token truncado; deriva de args; alucinación | Heurística de truncado sigue global (EC-6); guardrail cableado sin `executedTools` (§3.1); "escalación" que no escala: re-pregunta (EC-7) |
| `758b27d9` 18-ago 14:14 | +tokens afirmativos ('perfecto', 'adelante', 'reserva', 'procede', 'de una', 'claro'); acepta como consentimiento el mensaje que originó el challenge | el cliente ya había dicho "sí" en el mensaje que disparó el reto | Un mensaje inicial "Reserva del 20 al 22 para 2" o "Claro, quiero ver fechas" puede ejecutar el writer sin resumen ni pregunta (EC-2) |
| `2f7892b7`, `4e2391ba` 18-ago 16:xx | Orden reserva→pago; evitar handoffs prematuros; descripción de la tool de pago | — | El `payableReference` sigue viviendo sólo en el turno anterior (HM-4) |
| `0428eb27`…`4fbcf8f5` 18-ago 23:19-23:26 (D1-D14) | Precio normalizado, dedupe intra-turno, check→create propiedades, inbound lag, **recorte a 10 tools**, `state.date` stale, slot hold, EmotionService + preámbulo, Watchtower | roadmap del análisis previo | El recorte introduce §3.2; el preámbulo empático añade la regla 19 (detección por palabras clave, sin LLM) antes de la fiabilidad |

**El patrón.** Todos los parches viven en la misma capa —clasificador de frases, ledger por `args_hash`, reglas del prompt, regex de claims— y cada uno respondió al último transcript del dueño. Ninguno pudo probarse de punta a punta porque el harness bloquea los writers antes del preflight (`ai-tool-executor.service.ts:127-129`), el simulador corre con `disableTools:true` (`simulation.service.ts:503`), el eval gate v2 "tools ON" es letra muerta (`eval.service.ts:305-310` vs `agent-test.service.ts:201-205`) y no existe un solo spec sobre `generateResponse`. El resultado neto de la semana es **negativo en dos puntos verificados** (§3) y neutro en el resto: la premisa —que un modelo débil re-emita una llamada exacta que no puede ver— quedó intacta.

**Lo que el análisis previo (`agent-system-analysis-2026-08.md`) acertó y lo que no.** Acertó en el veredicto de fondo ("híbrido determinístico + LLM vocaliza" es el patrón correcto), en varios hotfixes (slot hold, `state.date`, precios, inbound lag) y en la lectura de los logs. Falló en tres cosas: (1) afirmó "¿Funciona lo que hay? Sí" cuando la transacción de 5+ verticales depende de una cadena probabilística que no funciona; (2) diagnosticó "bloat de 71 tools ≈ 8-12k tokens" como problema principal cuando el peor tenant típico carga ~5,5k tokens (93 definiciones ≈ 12,9k sólo si se cargaran todas) — el problema no es cuántas tools sino **qué tools faltan en el turno crítico y quién ejecuta el commit**; (3) su Fase 1 se implementó como 8 commits en 7 minutos sin harness, y uno de ellos es hoy un defecto crítico. Su §9.7 (Sierra/Decagon/humano) es valioso pero es F4, no F0.

## 5. Diagnóstico estructural

### 5.1 La cadena de cinco eslabones probabilísticos

Para cerrar una reserva de propiedad, un pedido, una inscripción, una clase, una cotización o un pago (todo lo que no sea una cita), el sistema exige hoy que se cumplan **los cinco a la vez**:

1. El modelo elige la tool correcta entre un set recortado por palabras clave del mensaje actual (`tool-retrieval.service.ts`).
2. Recibe `confirmation_required` ("NADA se ha ejecutado… pide confirmación") y **pregunta** en vez de anunciar (regla 16 del contrato).
3. El cliente responde algo que `classifyExplicitToolConfirmation` acepta como 'confirmed' (texto; los botones sólo si el payload textual coincide).
4. El modelo, con un historial que **no contiene** su llamada anterior ni sus argumentos, y sin ningún `<pending_operation>` en el prompt, **decide** volver a llamar la misma tool y reconstruye los args byte a byte (`stableValue` no normaliza fechas, teléfonos ni tildes).
5. Esa tool **sigue en la lista** del turno del "sí" (el recorte la saca) y el modelo del turno es capaz de hacerlo (el router lo manda a deepseek/gpt-4.1-mini y lo deja pegado 30 min).

En citas, los eslabones 1, 4 y 5 no existen: el `BookingEngine` interpreta el "sí" (`isConfirmation`) y **el servidor** llama `create_appointment` con el estado que él mismo guardó en Redis; el LLM sólo vocaliza la directive con `tools=[]`. Es exactamente la lección que este proyecto aprendió en abril de 2026 tras "10+ iteraciones" con el flujo de citas (memoria `critical_booking_refactor`: *"LLM is the voice, not the brain"*) — y que después no se generalizó cuando llegaron 15 verticales y 93 tools sobre el patrón "el LLM decide".

### 5.2 El estado del turno no tiene dueño

Inventario verificado por conversación (DE-05 y tabla del auditor de estado):

| Estado | Almacén | TTL | Lo escribe | Lo limpia |
|---|---|---|---|---|
| `lock:conv` | Redis | 30 s + heartbeat | runTurn | finally |
| `buf:conv` (ráfaga) | Redis | 60 s | debounce | Lua flush |
| `turn:done:{pmid}` | Redis | 24 h | processIncomingMessage | expira |
| `booking:{conv}` (+ espejo PG) | Redis + PG | 1 h | BookingEngine | newSession, completeHandoff |
| `procedure:{conv}` | Redis | 1 h | ProcedureEngine | expira (NO newSession, NO handoff) |
| `llm:affinity:{conv}` | Redis | 30 min | router | expira |
| `tool_execution_ledger` (challenge) | PG tenant | 15 min | preflight | expira (NO newSession) |
| `handoff:{conv}` | Redis | 24 h | executeHandoff | completeHandoff |
| `metadata.failedAttempts / pendingDraft / toolContext` | PG | — | varios (`toolContext` no lo escribe nadie) | dispersos |
| `conversations.status` | PG | — | handoff / consola / cron 72 h | manual |
| **La respuesta que se envía** | ninguno antes de encolar | — | — | — |
| **Los tool_calls/tool_results del turno** | sólo en memoria del proceso | el turno | — | — |

Consecuencias verificadas: el challenge caduca antes que la sesión; una pausa de 31 min borra la reserva en curso pero deja vivo un procedimiento a medias; un reintento del turno regenera otra redacción y el cliente recibe la mitad de cada una (DE-02); dos turnos concurrentes se pisan (DE-03); tras el auto-resolve de 72 h el cliente "vuelve" a una conversación vacía (DE-07); y **el modelo nunca sabe qué hizo en el turno anterior** — la raíz de re-listar, re-consultar y re-preguntar.

### 5.3 El modelo que decide es el más débil, y el router lo pega

- Cadena `tool_calling`: `gpt-4.1-mini → gpt-4o-mini → grok-4-1-fast-non-reasoning → deepseek-chat → gpt-4o → claude-sonnet-4-6` (`llm-router.service.ts:60-67`). Plan-gating: emprendedor `tier_4` y starter `tier_3+4` → **deepseek-chat (64k) para todo el tool calling**; pro `tier_2` → gpt-4.1-mini; enterprise → también gpt-4.1-mini salvo score ≥85. Claude/GPT-4o casi no se usan (HM-3).
- Value-routing (`:290-315`): un "sí" o un "hola" puntúa ≈19 → `tier_4` → deepseek al frente **también en pro/enterprise**; la afinidad por conversación (`:372-387`, 30 min) corre después y "keeps the final say": el primer "hola" fija el modelo de toda la conversación. Presupuesto agotado → sólo deepseek para tools (Gemini no soporta tools en el registro).
- Cada iteración del loop vuelve a rutear: modelo y temperatura pueden cambiar dentro del mismo turno.
- Evidencia externa (§6.2): en BFCL v4 multi-turno gpt-4.1-mini 34,1%, DeepSeek-V3.2 37,4%, gpt-5-mini 27,5% vs Haiku 4.5 53,6%, Grok-4.1-fast-*reasoning* 58,9%, Sonnet 4.5 61,4%. Además DeepSeek deprecó el id `deepseek-chat` a favor de `deepseek-v4-flash` (verificar en la consola: puede estar fallando y cayendo al siguiente).
- Conclusión: el sistema está diseñado como si el modelo fuera fuerte y se ejecuta con el más barato, en el turno más delicado. Pero **subir el modelo solo no arregla R1**: reduce la deriva de args, no la dependencia de la re-emisión.

### 5.4 El prompt es una pila de reglas, no un contrato

L1 tiene hoy ~20 reglas + guardrails de seguridad + (desde `d120c670`) un preámbulo empático (regla 19) condicionado a `<affective>` que llena un detector por palabras clave. Las reglas 2b, 13b, 14, 15, 16, 17 son parches con nombre de incidente. Varias dependen de que el modelo razone sobre etiquetas XML (`<active_bookings>`, `<possible_knowledge>`, `<directive>`), y la 16 ("sólo afirma si llamaste la tool en ESTE turno") **contradice** el caso legítimo de recordar una reserva hecha ayer. La literatura (Agentforce, Parlant, Quesma) mide que las políticas largas en prosa se siguen mal en modelos pequeños y que cada regla nueva reduce la adherencia a las anteriores; reescribir la política como árbol de decisión subió a gpt-5-mini de 55% a 67,5% en τ²-telecom sin tocar nada más. La respuesta correcta no es "menos reglas": es **mover las reglas al código** (estado, precondiciones, plantillas post-acción) y dejar en el prompt sólo lo que el modelo tiene que decidir.

### 5.5 El harness mide cómo suena, no qué hizo

- Agent Test: `disableTools ? null : config.tools`, filtra a lecturas seguras, `readOnly:true`, MAX_ITERATIONS 3, sin retrieval, sin payments/MCP (`agent-test.service.ts:174-304`).
- Simulación T2.13: `{disableTools:true}` siempre (`simulation.service.ts:503`); `falseClaims` corre en un mundo sin tools; el replay no reproduce el estado (ledger, `booking:`) de la conversación original.
- Eval gate v2 "tools ON" con `expectedActions row_exists`: imposible de aprobar porque `agent-test.service.ts:201-205` ignora `evalMode`; sólo gatea `evalActivable` de la config, no el deploy.
- Juez de calidad: rúbrica sobre "Cliente:/Agente:" texto (`quality.service.ts:28-51, 233-247`); "resolved:true" con reserva anunciada y no creada puntúa alto.
- Métricas de producción: cero contadores de "inbound sin outbound", "misma tool+args ≥2", "claim sin backing" (sólo el flag libre del juez reclasificado por regex).
- Specs: los 10 escenarios deterministas re-emiten a mano la tool tras el "sí" (`agent-conversation-scenarios.spec.ts:188-200`); `processIncomingMessage|generateResponse` en `**/*.spec.ts` = 0 archivos.

Consecuencia: **el dueño es el harness**. Cualquier rediseño sin arreglar esto primero se juzgará por anécdotas y repetirá el ciclo.

---

## 6. Estado del arte 2025-2026 — lo que hacen los que funcionan

Síntesis de las 5 investigaciones (fuentes en Anexo B; se distingue evidencia de marketing).

### 6.1 Convergencia arquitectónica

Sierra (Agent SDK/Journeys, "constellation of models", supervisores de entrada/salida), Decagon (AOPs compilados, validaciones en código, Watchtower), Intercom Fin (Refine→Generate→Validate; Procedures con Conditions/Code/Loop-in teammate; "actions one-by-one, no parallel"; "add a Condition step after every Data Connector call"), Salesforce Agentforce (topic → actions del topic; advierte que "must/never/always" deja al agente "stuck"), Zendesk (identificación de tarea → procedimiento; scripted dialogues donde importa), Cresta ("deterministic code that tracks state and enforces required steps"), Parloa (subtask agents con guardrails "below the prompt"), Google Dialogflow CX / ADK 2.0 ("separar control de ejecución del procesamiento de lenguaje; el LLM sólo para tareas cognitivas": −56% tokens, −20% latencia en su benchmark), Amazon Connect (Return-to-Control hacia el flow), Rasa CALM (Dialogue Understanding → comandos → Flows determinísticos con dialogue stack y patrones de reparación), Parlant (guidelines cargadas por relevancia, journeys, canned responses en modo estricto). **Siete patrones comunes:**

1. **Router de intención → procedimiento/topic con tools acotadas** (≤10-15 visibles; 3-8 por estado).
2. **Procedure-as-code**: pasos, condiciones y código para lo crítico; el "cómo" no vive en el prompt.
3. **LLM propone / código dispone**: el modelo emite comandos o argumentos; el motor valida precondiciones y ejecuta o rechaza (~50% de los fallos de τ-bench son args mal rellenados con la tool correcta → validar en código captura la mitad).
4. **Confirmación como estado (pausar-serializar-reanudar)**: la acción irreversible sólo es alcanzable desde "confirmado", se ejecuta una vez con clave idempotente, y **la respuesta del cliente es un evento que reanuda**, no un mensaje que el LLM interpreta opcionalmente. Ningún framework serio la modela como regla de prompt.
5. **Grounding por construcción**: el mensaje de éxito se renderiza desde el resultado real de la tool; un verificador de salida es la red, no el mecanismo.
6. **Supervisores independientes con tasa de error acotada** ("bounded error rates, so the challenge becomes a systems problem" — Sierra); repetición, claim sin acción, silencio, fuga de política.
7. **Simulación + regresión + `pass^k` como gate** (Sierra 35.000 tests/día; Fin Evals/Releases ago-2026; Decagon offline→A/B con ramp).

### 6.2 Los números que importan

- τ-bench (Sierra, 2024): gpt-4o pass^1 61% retail / 35% airline; **pass^8 <25%**; fallos: ~50% args, ~25% decisión contra reglas, ~19% resolución parcial. τ²-bench (2025): gpt-4.1 74/56/34%; **el modo con usuario baja 18-25 pp** — el cuello de botella es coordinar/confirmar, no razonar. τ²-bench v1.0.1 (jul-2026) no es comparable con versiones previas.
- **False success** (arXiv 2606.09863, jun-2026): 45-48% de los fallos en τ²-bench single-control son "afirmar que se completó cuando el estado dice lo contrario"; los jueces LLM se dejan engañar por el "confident closing language"; detectores ligeros AUROC 0,83.
- Verified tool calls (arXiv 2608.02645, jul-2026): separar canal de efecto y de respuesta + verify-before-retry + claves idempotentes: éxito 64→100%, duplicados 72→20%; "verify-only" aporta la mayor parte.
- Número de tools: Anthropic degrada >30-50 (tool search 49→74% Opus 4, 79,5→88,1% Opus 4.5, −85% tokens); OpenAI "<20 al inicio del turno" y "algunos fallan con <10 solapadas"; Gemini 10-20; paper 2605.24660: K≈7 tools relevantes = 90,3% vs K=50 90,8%, y la selección sube 87,1→93,1% con K≈2; routing enterprise cae 16-23 pp de 10 a 110 tools (arXiv 2606.17519).
- Modelos (BFCL v4 multi-turno, abr-2026): Opus 4.5 68,4% · GLM-4.6 68,0% · Sonnet 4.5 61,4% · Grok-4.1-fast-reasoning 58,9% · **Haiku 4.5 53,6% (1,7 s, $1/$5)** · Grok-4.1-fast-non-reasoning 46,8% · GPT-4.1 38,9% · DeepSeek-V3.2 37,4% · Gemini-2.5-Flash 36,3% · **gpt-4.1-mini 34,1%** · gpt-5-mini 27,5%. τ²-telecom: gpt-5-mini 55→67,5% sólo reescribiendo la política como árbol de decisión (Quesma).
- Multi-turno en general: −39% promedio de single- a multi-turn y "se pierden y no se recuperan" tras una suposición temprana (Laban et al., may-2025).
- Simuladores de usuario: 40-47% de turnos con error si no están atados a tools/estado (τ²); hasta 9 pp de variación según el LLM simulador (ACL 2026); en ventas, el no-comprador simulado "nunca se va" (jun-2026, 2.790 conversaciones reales).
- Frameworks: LangGraph 1.0, OpenAI Agents SDK, Vercel AI SDK 6/7 (`activeTools`/`prepareStep`/`needsApproval`), Mastra, XState v5 = TS y producción; Rasa CALM, Parlant, Pydantic AI, ADK 2.0 = Python; Temporal TS + agentes = pre-release. **Ninguno trae hecho el modelo de diálogo transaccional (stack, correcciones, confirmación de dominio); todos traen loop/persistencia/HITL** — que este proyecto ya tiene (BullMQ, mutex, idempotencia, Redis/PG).
- WhatsApp: **desde 1-oct-2026 cada mensaje de servicio se cobra** (CO ~USD 0,0008; MX ~0,0085; BR ~0,0068; AR/CL/PE ~0,02 — verificar tabla oficial de Meta antes del 1-sep); Meta Business Agent (ago-2026, USD 2/1M tokens) compite en el mismo terreno; botones (3×20 chars), listas (10 filas), Flows (endpoint <10 s), typing indicator 25 s; la industria LatAm confirma por **payload de botón**, no por texto libre; buffer de ráfagas 3-15 s con un solo flush.

### 6.3 Qué NO hacer (anti-patrones documentados que hoy hacemos)

- Un LLM ReAct con 30-90 tools y ~20 reglas imperativas por turno.
- Confirmar por regla textual y dejar que el modelo decida si hubo consentimiento.
- Generar el mensaje de éxito a partir de la intención del modelo y confiar en un guardrail de salida para atraparlo.
- Reintentar writers sin verificar postcondición.
- Pasar el transcript crudo como memoria y no el estado.
- Medir con pass@1 y con jueces de texto; desplegar sin gate ni canary.
- Añadir reglas al prompt para tapar cada síntoma.
- Fragmentar en burbujas y mandar "un momento…" (coste por mensaje desde oct-2026).

---

## 7. Opciones y veredicto

| Opción | Qué implica | Pros | Contras | Veredicto |
|---|---|---|---|---|
| **A. Seguir parchando** la capa actual (clasificador, ledger, prompt, retrieval) | Corregir §3.1/§3.2 y seguir con reglas | Rápido, sin riesgo de arquitectura | Mantiene R1-R5; cada parche reduce adherencia; sin harness se repite el ciclo; no escala a 18 verticales | **No** como estrategia; **sí** como F0 acotado (10 arreglos, §11) |
| **B. Rediseñar el núcleo** del turno transaccional (Runtime de Operaciones) manteniendo colas, canales, router, RAG, CRM, handoff, simulación | Generalizar el patrón del FSM de citas a un motor de operaciones por vertical; LLM = comandos + redacción; confirmación como estado; grounding por construcción; tools por estado; estado único; harness τ-style que gatea | Ataca R1-R5 de raíz; es lo que hacen Fin/Decagon/Rasa/ADK; reutiliza el 80% del código; strangler por tenant/vertical; medible | 4-6 semanas para el núcleo + 3 pilotos; exige disciplina (nada de commits fuera del harness); exige decisiones de producto (botones, un mensaje por turno, modelo) | **Recomendado** |
| **C. Reescribir desde cero** (o adoptar LangGraph/Rasa/etc. como núcleo) | Nueva orquestación | Limpieza total | Tira lo que sí funciona (pipeline idempotente, multi-tenant, canales, router); los frameworks TS no traen el modelo de diálogo y los Python son sidecar (doble fuente de verdad); 3-6 meses sin mejora visible | **No** |

**Criterio de decisión de la literatura (§6.2, evaluación):** si con el pipeline actual los escenarios críticos superan ~80% pass^1 pero caen fuerte en pass^3 y el error se concentra en trayectoria/tools, se arregla; si fallan por diseño (FSM y LLM se pisan, la confirmación no tiene dueño único, el modelo debe re-emitir lo que no ve), el rediseño se justifica. La forense (§2-§5) muestra lo segundo. F0 + el harness de F1 lo confirmarán con números antes de que el núcleo nuevo entre a producción.

## 8. Arquitectura objetivo — el "Runtime de Operaciones"

> Diseño, no implementación. Nombres provisionales. Todo lo que no se menciona (ingreso por colas, identidad, persona por conexión, RAG, CRM, pipeline, nurturing, handoff, canales, billing) se conserva tal cual.

### 8.1 Principios (los que no se negocian)

1. **El servidor es dueño del estado, de la confirmación y del commit.** El LLM entiende, propone y redacta; nunca decide si hubo consentimiento ni ejecuta una escritura por iniciativa propia.
2. **Una operación, un estado, un dueño.** Cada transacción de cada vertical (cita, estadía, paquete, pedido, clase, inscripción, cotización, reclamo, solicitud, visita, prueba de manejo, pago) es una *Operación* con slots, precondiciones, confirmación, commit idempotente y mensaje post-acción — declarada en un catálogo, no improvisada por el modelo.
3. **Confirmación = estado + evento.** El "sí" es un payload de botón cuando el canal lo permite y, si no, un texto clasificado **contra una pregunta pendiente conocida**; en ambos casos el que ejecuta es el runtime, ANTES de llamar al LLM del turno.
4. **Verdad por construcción.** Los mensajes que anuncian un resultado (creado, cobrado, cancelado, no disponible, error) los redacta el backend desde el objeto devuelto por la tool (plantilla + opcional "rephrase" acotado); el modelo no puede afirmar un hecho que el runtime no le entregó. Los guardrails de salida quedan como red.
5. **Tools por estado.** El modelo ve 3-8 tools: las del paso actual + `cancelar` + `humano` + `conocimiento`. Nunca "todas las del tenant recortadas por palabras".
6. **Estado único con época de sesión.** Un solo documento de conversación (Redis primario, PG respaldo) con: pila de operaciones, slots, acciones ejecutadas (ledger semántico), pregunta pendiente, última respuesta enviada, época. `newSession` cambia la época y todo lo anterior queda inválido de una vez.
7. **El turno es transaccional.** Respuesta final + acciones + estado se persisten por `pmid` antes de encolar; un reintento reutiliza, no regenera. Nunca se procesa sin lock.
8. **Modelo por rol.** Comprender/decidir (comandos) con un modelo bueno en multi-turno; redactar con uno barato sin tools; clasificar con uno barato en JSON estricto. Suelo de tier para el rol decisor; afinidad por rol, no por conversación.
9. **Degradación explícita.** Cada fallo tiene un comportamiento definido y determinístico (proveedor caído, tool con timeout, ledger inconsistente, presupuesto agotado): mensaje conocido, estado preservado, alerta; nunca silencio, nunca "listo".
10. **Nada entra sin pasar el harness.** Escenarios por vertical con estado final esperado y `pass^3`.

### 8.2 Componentes

```
Inbound (cola, idéntico) → TurnCoordinator (lock estricto + burst desde DB + época)
  → PayloadRouter        : botones/listas/Flows/plantillas → evento de operación (sin LLM)
  → OperationRuntime     : ¿hay operación con pregunta pendiente? ¿el mensaje la responde?
        ├─ confirmar → commit idempotente (verify-before-retry) → ResultRenderer → responder
        ├─ corregir/cancelar/reanudar → transición → pregunta siguiente
        └─ no responde a lo pendiente → CommandGenerator
  → CommandGenerator (LLM, salida estructurada, contexto corto: estado + últimos N turnos + tools del estado)
        comandos: start_operation | set_slot | correct_slot | confirm | reject | cancel |
                  ask_clarification | knowledge_answer | chitchat | human_handoff | read_tool(name,args)
  → OperationRuntime aplica comandos (valida contra catálogo/slots/precondiciones; ejecuta lecturas; nunca escrituras sin estado 'confirmed')
  → ResponseComposer  : hechos autorizados (pregunta del paso, resultado de lecturas, plantilla post-acción, opciones)
        → Redactor (LLM barato, sin tools) o plantilla directa → un mensaje por turno (+ interactivo si aplica)
  → OutputSupervisor  : claim vs ledger, repetición vs últimos N salientes, idioma, precio, vacío → corrige/plantilla/alerta
  → TurnCommit        : persiste respuesta+acciones+estado por pmid → encola → marca done
```

**Catálogo de operaciones (por vertical, declarativo).** Ejemplo abreviado:

```yaml
operation: stay_booking            # turismo · alojamiento
slots: [property_id, check_in, check_out, guests, guest_name, guest_phone?]
reads: [list_properties, check_property_availability, get_property_details]
preconditions:
  - availability_checked(property_id, check_in, check_out) within turn|conversation
confirmation: required            # recap canónico + botones Confirmar / Cambiar / Cancelar
commit: create_property_booking   # idempotency_key = conv+op_instance+slots_hash; verify: booking_exists?
post_action: template stay_booking.created (id, fechas, huéspedes, total, siguiente paso: pago)
next: payment_link (auto-encadenada: una sola confirmación cubre reserva+link si el tenant lo configura)
repair: correct_slot → vuelve al paso afectado; cancel → libera hold; digresión → push FAQ y retorno con "¿seguimos con la reserva del 20 al 22?"
tools_visible_by_state:
  collecting: [list_properties, check_property_availability, get_property_details, cancel, human, kb]
  confirming: [cancel, human, kb]           # el 'sí' NO es una tool: es un evento
  committed:  [get_booking_details, create_payment_link?, cancel_booking, human, kb]
```

Lo importante del catálogo: **la misma maquinaria** sirve para cita, mesa, pedido, clase, inscripción, cotización, reclamo, solicitud, visita, prueba de manejo, alta de socio y pago; cambian los slots, las lecturas, las precondiciones y las plantillas. El FSM de citas actual se convierte en la primera operación del catálogo (no se tira; se envuelve).

### 8.3 El turno nuevo, paso a paso (lo que cambia respecto a §1)

| Paso | Hoy | Objetivo |
|---|---|---|
| Lock | espera y procesa igual | nunca sin lock: re-encolar con delay; el mensaje entra al turno siguiente o al buffer |
| Ráfaga | 800 ms en Redis, fragmentos sin fila | 3-6 s (8-12 con media), cada fragmento persistido como fila; el turno agrupa desde DB; typing/read al primer fragmento |
| Época | newSession borra 2 claves de 10 | cambia la época; todo lo demás queda inválido; el ledger pendiente expira con la sesión, no a los 15 min |
| Payload | botones sólo si el texto coincide con 'confirm_yes' | `button_reply.id / list_reply.id / nfm_reply / template payload` → evento tipado antes del LLM; `context.id` descarta respuestas a botones viejos |
| Confirmación | el LLM debe re-emitir la tool | el runtime ejecuta la operación pendiente al recibir el evento/‘sí’ y entrega el resultado como hecho; el modelo sólo redacta |
| Tools | 93 por flags → recorte a 10 por palabras | 3-8 por estado desde el catálogo; sin retrieval por keywords |
| Historial | 31 filas de texto | estado estructurado (operación, slots, ledger de acciones, pregunta pendiente) + últimos 4-6 turnos |
| Prompt | L1 de ~20 reglas | L1 corto (identidad, idioma, "propón, no ejecutes", grounding) + L3 con `<operation>` y `<pending_question>`; reglas de negocio en el catálogo/código |
| Modelo | el más barato del plan; pegado 30 min | decisor con suelo tier_2 (Haiku 4.5 / Grok-4.1-fast-reasoning / Sonnet para alto valor); redactor barato; afinidad por rol |
| Resultado | el modelo lo narra | plantilla desde el objeto de la tool (+ rephrase acotado opcional) |
| Guardrail | regex de claims (roto) + precios | supervisor: claim-vs-ledger, repetición, vacío, idioma, precio; siempre con fallback determinístico |
| Salida | 1-4 burbujas | un mensaje por turno (+ un interactivo); chunking sólo por límite de 4096 |
| Persistencia | respuesta no persistida | respuesta+acciones+estado por pmid antes de encolar; resume reutiliza |
| Handoff | mudo sin retorno; shouldHandoff con dos semánticas | paquete de contexto estructurado; mute duro por estado; retorno automático configurable; bloqueo técnico ≠ escalada de dominio |
| Observabilidad | inbound lag (D1) | + inbound-sin-outbound, claim-sin-backing, repeat/loop rate, re-challenges, tool success/args válidos, latencia por rol y proveedor, por versión de agente |

### 8.4 Controles, redundancia y modos de fallo (qué pasa cuando algo falla)

| Fallo | Comportamiento objetivo |
|---|---|
| Proveedor LLM caído / timeout en el decisor | fallback en cadena dentro del mismo tier o superior; si todos fallan: si hay operación con pregunta pendiente, re-emitir la pregunta desde plantilla; si no, mensaje de espera conocido + reintento del turno; nunca silencio; alerta |
| Redactor falla | enviar la plantilla del ResponseComposer tal cual (siempre existe) |
| Tool de lectura falla | el runtime lo sabe y compone "no pude consultar X ahora, ¿intento de nuevo o prefieres…?"; el modelo no inventa |
| Tool de escritura falla / timeout | verify-before-retry (¿existe la reserva?); si Unknown → no reintentar a ciegas: informar y abrir tarea humana; el estado queda en `commit_pending` visible al inbox |
| Ledger inconsistente / token inválido | no escalar al cliente; reconstruir desde el estado único; alerta interna |
| Cliente cambia de tema a mitad | push de FAQ/chitchat sobre la pila; al terminar, oferta de reanudar la operación con su resumen |
| Cliente corrige un dato | `correct_slot` → vuelve al paso afectado; re-confirmación sólo si cambia un slot material |
| Cliente confirma dos veces / reintento del turno | idempotencia por operación: replay del resultado, nunca segundo commit |
| Presupuesto LLM agotado | el decisor baja a un modelo permitido con tool-calling verificado (no deepseek-chat sin validar); nunca sin tools |
| Cuota IA / fuera de horario / handoff | como hoy, pero con mensaje siempre y estado preservado |
| Detección de bucle | misma pregunta o misma tool+args ≥2 en la conversación → cambiar de estrategia (opciones/botones) o humano; ≥3 → humano |

### 8.5 Modelo por rol (propuesta con evidencia; el precio y la disponibilidad se verifican en las páginas oficiales)

| Rol | Necesidad | Candidatos | Evita |
|---|---|---|---|
| Decisor / generador de comandos (y read-tools) | multi-turno, seguir un árbol de decisión, JSON estricto | Claude Haiku 4.5 (BFCL MT 53,6%, 1,7 s, $1/$5) por defecto; Sonnet 4.6 para enterprise/alto valor; Grok-4.1-fast-*reasoning* como opción barata (MT 58,9%, latencia 6-7 s) | gpt-4.1-mini, gpt-5-mini, deepseek-chat (deprecado), grok-fast-non-reasoning |
| Redactor | tono, idioma, brevedad; sin tools; salida estructurada | gemini-2.5-flash-lite / gpt-4.1-mini / deepseek-v4-flash | modelos caros aquí no aportan |
| Clasificador (idioma, intención gruesa, sentimiento) | JSON estricto, temp 0 | flash-lite / gpt-4.1-mini / grok-4-fast | — |
| Juez offline / Watchtower | tool-grounded, rúbricas por dimensión | Sonnet/GPT-5-clase con acceso a ledger y DB | juez que sólo ve texto |

Nota: la sub-tarea "decidir" se vuelve más pequeña con el runtime (comandos sobre un estado explícito y ≤8 tools) — por eso un modelo mediano bien elegido basta, mientras que hoy se le pide a uno débil que orqueste 30 tools sin memoria.

## 9. Mapa por vertical (18) — transacción, motor de hoy, riesgo, qué cambia

Fuente: bootstrap (`verticals.service.ts:917-993`, `vertical-definitions.ts:1298-1318`), registro de tools (`conversations.service.ts:1886-1993`), políticas (`tool-policy-registry.ts:104-331`). "FSM" = BookingEngine de citas. "LLM+tools" = el modelo decide y el tool-control pide confirmación runtime. Riesgo = probabilidad de que hoy la transacción principal falle por R1-R4.

| # | Vertical | Transacción principal | Motor hoy | Tool de cierre hoy | Confirmación hoy | Riesgo hoy | Qué cambia con el Runtime (operaciones del catálogo) | Flujo dorado (prueba mínima) |
|---|---|---|---|---|---|---|---|---|
| 1 | Salud | cita (dental: + plan) | FSM | create_appointment | FSM (botón; texto → doble confirmación FT-3) | Bajo-Medio | `appointment` como operación del runtime; citas visibles en `<operation>` (hoy invisibles por FT-7); Flows WA opcional | saluda → servicio → fecha → hora → confirmar → creado → "¿a qué hora era?" responde desde estado |
| 2 | Moda/belleza | cita | FSM | create_appointment | FSM | Bajo-Medio | igual + `appointment` con staff/servicio; recordatorio con botones | igual a salud |
| 3 | Inmobiliaria | visita a inmueble | FSM + LLM (yield por regex 'propiedad/visita') | ninguna propia (create_appointment sin listing) | mixta | **Alto** | nueva operación `property_visit` (listing_id + slot) que envuelve la cita con contexto | busca → detalle → foto → "quiero visitarlo" → fecha/hora → confirmar → visita creada ligada al listing |
| 4 | Restaurantes | pedido / mesa | LLM+tools (pedido) / FSM (mesa) | place_order | tool-control | **Alto** | `order` (menú → ítems → entrega/retiro → recap → confirmar → creado) y `table_reservation` como operaciones; conductores unificados | menú → 2 ítems → dirección → recap → sí → pedido #, hora estimada, pago |
| 5 | Automotriz | test drive / cotización | FSM (cita genérica) | ninguna (scheduleTestDrive existe en servicio, no como tool) | FSM | Medio-Alto | `test_drive` (vehicle_id + slot) y `vehicle_quote_request` | busca → detalle → "prueba de manejo" → fecha → confirmar → agendada con el vehículo |
| 6a | Turismo · alojamiento | reserva de estadía | LLM+tools (sin FSM) | create_property_booking | tool-control | **Crítico** (V-01, FT-1, HM-2/4) | `stay_booking` + `payment_link` encadenados; disponibilidad como precondición; una confirmación | lista → disponibilidad → detalle → recap → sí → creada + link de pago → "¿quedó?" responde desde estado |
| 6b | Turismo · tours/agencia | reserva de paquete | LLM+tools | create_tour_booking | tool-control | **Alto** (V-06: sin inventario = ilimitado, sin guard duplicado) | `tour_booking` con cupo/duplicado en precondición | busca paquete → fecha → personas → recap → sí → creada |
| 7 | Educación | inscripción a curso | LLM+tools + FSM (cita) | enroll_student | tool-control | **Alto** | `course_enrollment` (curso → horario → datos → confirmar) + `placement_test` | cursos → horario → datos → sí → inscrito → link de prueba |
| 8 | Finanzas | lead / cita asesoría | FSM | create_appointment | FSM | Bajo | `appointment` + `lead_intake` con handoff | consulta → FAQ → agenda → creada / solicitud formal → humano |
| 9 | Servicios profesionales | consulta (cita) | FSM | create_appointment | FSM | Bajo | `appointment`; `case_status` como lectura | consulta → agenda → creada; estado de caso |
| 10 | Retail | pedido / cotización | LLM+tools **sin escritura** | ninguna (place_order es de restaurantes) | — | **Alto** (alucina pedido) | `catalog_order` genérico (ítems → entrega → recap → sí → pedido/cotización) + `payment_link` | busca → detalle → stock → "lo quiero" → datos → sí → pedido creado |
| 11 | Tecnología | demo / cita | FSM | create_appointment | FSM | Bajo | `appointment` (demo) | igual a servicios profesionales |
| 12 | Veterinaria | cita + registro de mascota | FSM + LLM (register_pet con confirmación) | create_appointment; register_pet | FSM; tool-control | Medio | `pet_registration` sin confirmación (V-05) + `appointment` con mascota; triage → humano | mascota → registrar → cita → creada; emergencia → humano con datos |
| 13 | Gimnasios | reserva de clase / alta socio | LLM+tools + FSM (yield 'clase') | book_class (exige membresía); sin alta | tool-control | **Alto** | `class_booking` (horario → cupo/waitlist → sí) + `membership_signup` (lead + link de pago) | planes → alta → horario → clase → sí → reservada/waitlist |
| 14 | Seguros | cotización / reclamo | LLM+tools (sin FSM) | calculate_quote (con confirmación V-05); file_claim (identidad A2) | tool-control + código de identidad | **Alto** | `insurance_quote` sin confirmación + `claim_intake` con step-up e intake → humano | planes → datos → cotización → "quiero contratar" → humano con contexto |
| 15 | Servicios del hogar | solicitud de servicio | LLM+tools (sin FSM) | create_service_request | tool-control | Medio-Alto | `service_request` (problema → dirección → ventana → sí → ticket → humano) | describe → datos → sí → ticket # → estado |
| 16 | Servicios para mascotas | guardería / grooming | FSM (cita) | create_appointment | FSM | Medio | `daycare_booking` (check_daycare_availability como precondición, hoy desligada) | servicios → disponibilidad → fecha → sí → reservada |
| 17 | Fotografía | cotización de sesión | LLM+tools (sin FSM) | request_photo_quote (con confirmación V-05) | tool-control | Medio | `photo_quote` sin confirmación + `session_booking` (fecha como precondición) | paquetes → portafolio → fecha → cotización → "reservo" → sesión |
| 18 | Otro | ninguna definida | LLM+tools sin escritura | ninguna | — | **Alto** (alucina cierre) | `generic_order`/`generic_request` + `appointment` opcional + regla dura: sin operación → humano | FAQ → catálogo → "lo quiero" → solicitud registrada → humano |

**Lecturas del mapa.** (1) La plataforma tiene UN flujo robusto (citas) replicado en 13 verticales, y **todo lo que define comercialmente a turismo, restaurantes, educación, gimnasios, seguros, servicios del hogar, fotografía y retail** corre sobre la cadena probabilística de §5.1. (2) Seis verticales no tienen tool de cierre para su transacción principal (V-04): el prompt las empuja a "vender" sin nada que ejecutar. (3) Cotizar/registrar mascota/pedir cotización exigen confirmación como si fueran cobros (V-05): fricción y bucles gratuitos. (4) La `industryGuidance` por vertical nunca se puebla en producción (V-07): el modelo no recibe el "flujo dorado" — que en el runtime deja de ser prompt y pasa a ser catálogo. (5) El yield FSM↔LLM por regex español rompe en en/pt/fr (FT-8). Con el runtime, "vertical" pasa a significar **catálogo de operaciones + plantillas + terminología**, y el resto es horizontal (*thin vertical, deep horizontal*, como concluyeron los dossiers de julio).

---

## 10. Sistema de calidad — el harness que sí atrapa los cinco síntomas

Piezas que ya existen y se reutilizan: `eval.service.ts` (runGateV2, `verifyActions`, `cleanupSandbox`, `runPassK`), `simulation.service.ts` (cliente simulado, replay), `outcome-claim.util.ts`, `turnTrace`, `agent-conversation-scenarios.spec.ts` (estilo), Centro de calidad (`docs/agent-quality-center.md`), inbound lag/traceId (D1). Lo que falta es cablearlas al **pipeline real con escrituras** y gradar **estado**, no texto.

**Pirámide (de abajo arriba)**

1. **Contrato de la capa de decisión (sin LLM, milisegundos, cada PR):** runtime + catálogo con SQL fake: flujo feliz, corrección de slot, cancelación, digresión y retorno, confirmación por botón y por texto, "sí"+dato en ráfaga, doble sí, args con deriva, challenge vencido, tool falla, tool timeout, reintento del turno, dos turnos concurrentes. Cientos de casos, por operación del catálogo.
2. **Turn-level evals sobre trazas grabadas (cada PR, minutos):** dado estado + mensaje, ¿el decisor emitió los comandos esperados / la tool esperada con args que tracen a la conversación? ¿NO llamó cuando no debía? ¿respondió en el idioma? ¿el texto tiene claims sin backing? 100-300 casos; se corre por modelo del router.
3. **Escenarios multi-turno con usuario simulado (nightly y release):** persona con ficha (idioma es/pt/en/fr, prisa, si va a corregir, si se va sin comprar), acciones sólo vía tools reactivas, contra sandbox de escritura real (schema efímero o contacto sandbox + cleanup); grading = **estado final de la DB == esperado** + salidas obligatorias + trayectoria + juez acotado; `pass^3` (k=5 en nightly). 20-50 escenarios por vertical piloto sacados de fallos reales; después las 18 (el plan maestro de pruebas de agosto ya tiene 1.520 escenarios de bootstrap: se reutiliza su matriz).
4. **Regresión por replay de producción (release):** cada fallo real (bucle, promesa incumplida, silencio, handoff evitable) → caso congelado con estado, fecha y disponibilidad fijas y tools mockeadas; corre para siempre.
5. **Canary por versión de agente (post-release):** rutear un % de conversaciones de tenants piloto a la versión nueva; monitors online (claim-sin-backing, repeat/loop, no-response, escalación, latencia); rollback por versión.
6. **QA humano muestreado (semanal):** 50-100 conversaciones para calibrar al juez y descubrir modos de fallo nuevos (Watchtower D9 se reorienta a esto, con acceso a ledger/DB).

**Gate de despliegue (GitHub Actions):** bloquea si (a) algún escenario innegociable (crear/confirmar/cancelar la transacción principal de cada vertical piloto, no anunciar sin backing, no ejecutar sin confirmación) baja de `pass^3 = 100%`, (b) el pass global cae vs `main`, (c) suben claim-sin-backing o repeat rate. Nada del agente se despliega sin este job.

**Métricas mínimas de producción (por versión de agente, vertical, canal, idioma, proveedor):** resolution rate honesta (confirmada vs asumida a 24 h) · handoff rate y % evitable · tool success (selección ∧ args válidos ∧ resultado usado) · recovery tras fallo de tool · **ungrounded-claim rate** · **repeat rate / loop rate** · **no-response rate** (inbound sin outbound en 90 s; turnos terminados en excepción o fallback) · re-challenges por operación · latencia p50/p95 por rol y proveedor · coste por conversación (LLM + mensajes Meta) · CSAT/sentimiento.

**Simulador de usuario, con sus límites conocidos:** ficha estructurada, acciones sólo vía tools reactivas, personas que abandonan, dos LLM simuladores distintos para acotar la varianza, y 50-100 conversaciones anotadas a mano antes de confiar en el score.

---

## 11. Plan por fases (sin código todavía) con criterio de "listo"

### F0 — Estabilización quirúrgica (días; una sola rama; cada ítem con su test)

Diez arreglos acotados, todos verificados en §2-§5. **Ninguno es una regla nueva en el prompt.**
Rama: `fix/agent-f0-transactional-core`. Estado al 19-ago: **F0 COMPLETA (1-10) + el anexo de hallazgos cerrado**, salvo tres cosas que no son arreglos sino decisiones o dominio nuevo (§F0-bis, lote D): la visita inmobiliaria y la reserva de guardería no tienen capa de servicio que exponer; el alta de socio de gimnasio depende de cómo quiera cobrar el dueño; y `sanitizeParams` (EC-6) se dejó a propósito. Verificación: `tsc` limpio · DI del AppModule OK · **2.110 tests en 242 suites, 0 fallos** · eslint limpio. 66 tests nuevos, varios de ellos fallan a propósito si alguien revierte un arreglo.

1. ✅ **Guardrail:** `executedToolsThisTurn` llega al call-site; el `backed` usa el registro canónico (`isBusinessWriteTool`) en vez del prefijo de nombre, que se comía `place_order`/`book_class`/`enroll_student`/`register_pet`/`file_claim`; el FSM reporta lo que escribió (`EngineResult.executedTools`, incluido el replay del guard de duplicados); si el reintento correctivo insiste, se envía un texto determinístico en 4 idiomas en vez de la frase original. Una tool opaca (MCP) con éxito cuenta como respaldo. *(§3.1)*
2. ✅ **Recorte de tools:** `retrieveRelevantTools` acepta un conjunto `pinned` que **siempre** sobrevive al corte, y el call-site ancla todos los writers confirmables del tenant; el presupuesto crece en vez de exprimir las lecturas. Spec nuevo que reproduce la regresión ("sí" sin anclaje pierde `create_property_booking`). *(§3.2)*
3. ✅ **Confirmación server-side:** `findPendingConfirmation` lee la operación viva (status `awaiting_confirmation`, token firmado, no vencida) y, cuando el mensaje del cliente clasifica 'confirmed', el turno **la ejecuta con los argumentos que el cliente vio** antes de llamar al LLM; el modelo solo vocaliza un directive construido desde el resultado real (`buildExecutedOperationDirective`, éxito y fallo, 4 idiomas). Si vuelve `confirmation_required` (token vencido entre lectura y ejecución) no se inventa nada: cae al turno normal. Elimina la dependencia de la re-emisión (R1). *(HM-2, FT-4)*
4. ✅ **FSM de citas:** la confirmación por texto viaja con `authorityEvidence: 'text_confirmation'` y el control la valida con la misma exigencia que el botón (paso `confirm` + clasificador inequívoco + los 6 campos ligados). Fin de la doble confirmación en Telegram/IG/Messenger/widget y en WhatsApp por texto. *(FT-3)*
5. ✅ **Router:** piso de tier para `tool_calling` (lidera tier_1/tier_2; los baratos quedan de respaldo) que **cede ante el circuit breaker de presupuesto** (`budgetConstrained`); sin value-routing en turnos con tools (un "sí" puntúa ~19 y mandaba la reserva al modelo más débil); afinidad por `(conversación, task)`; `pinnedModel` mantiene el loop en el modelo que tomó la primera decisión del turno. *(HM-3, §5.3)*
6. ✅ **Lock:** nunca "processing anyway": si tras esperar no hay lock, la ráfaga ya fusionada vuelve al buffer y el turno lanza para que BullMQ lo reintente en orden. El widget pasa de 2 s de paciencia a 30 s y también se niega a correr en paralelo. El debounce colapsa líneas consecutivas iguales para que la restauración no duplique el último fragmento. *(DE-03)*
7. ✅ **Turno idempotente:** la respuesta se persiste en `turn:reply:{tenant}:{pmid}` **antes** de enviar el primer chunk y el resume la reutiliza en vez de regenerar (fin de la mezcla de dos redacciones); `saveAiMessage` acepta `external_id` (`out:{pmid}:reply:{i}`) con `ON CONFLICT DO NOTHING`. *(DE-02)*
8. ✅ **Época de sesión y TTLs:** el challenge dura lo que la sesión (15 → 30 min); `newSession` invalida junto `booking:`, `procedure:` y las tres claves de afinidad. *(DE-05)*
9. ✅ **Semántica de handoff:** los bloqueos del guard se marcan `controlBlocked` y ya no escalan al cliente, salvo los que pueden haber movido plata o cupo (`CONTROL_ERRORS_REQUIRING_HUMAN`); tope de 3 re-desafíos por operación → `confirmation_not_converging` a humano; fuera de `AFFIRMATIVE_TOKENS` los imperativos `reserva`/`reservalo`, que convertían una petición inicial en consentimiento. *(FT-5, EC-2, EC-7)*
10. ✅ **Observabilidad mínima, y alguien que la mire:** contadores diarios en Redis (`agent:signal:*`): `claim_unbacked`, `silent_turn`, `commit_then_failure`, `concurrent_turn_deferred`, `pending_confirmation_executed`, más el contador de re-desafíos por ledger. Escribirlos y que nadie los lea es lo mismo que no tenerlos, así que el Ops Center los vigila cada hora (`checkAgentReliability`): alerta con umbral por señal, **nombra los tenants** detrás de cada una, y cierra su propio incidente cuando la señal se calla. `commit_then_failure` es **crítica con umbral 1** — se creó algo real y el cliente nunca supo los detalles; sólo una persona cierra esa conversación. Los totales son por plataforma (conjunto de claves acotado) con un SET por día para el detalle por tenant: un chequeo que escanea todo el namespace se vuelve lento, y un chequeo lento se termina apagando. *(DE-01, EC-5)*

### F0-bis — El resto del anexo (19-ago, misma rama)

Cerrados después de F0, en tres lotes, cada uno con sus pruebas:

**Lote A · verdad y memoria transaccional.** ✅ **DE-04**: el catch final ya no borra el rastro — si el turno rompe DESPUÉS de haber creado algo, el cliente recibe "tu solicitud quedó registrada, no la repitas" en vez del error genérico que lo hacía pedirla otra vez (contador `commit_then_failure`). ✅ **FT-2**: `stableValue` normaliza fechas (`2026-08-20` = `20/08/2026`), teléfonos formateados y tildes, y el replay de una operación cumplida ya **no exige un "sí" literal** — basta que los argumentos sean los mismos, salvo que el cliente pida explícitamente *otra* (`requestsAnotherOperation`, 4 idiomas), que era un comportamiento deliberado y se conservó. ✅ **FT-6 + HM-4**: los resultados de las tools sobreviven al turno (`metadata.toolContext` → `<recent_actions>` + regla 18 de L1), así que el agente deja de re-listar lo que ya consultó y **el `payableReference` de la reserva sigue disponible para el link de pago**.

**Lote B · confirmaciones que sobran y duplicados.** ✅ **V-05**: cotizar, pedir cotización y registrar una mascota dejan de exigir confirmación — no comprometen nada y su desafío era fricción pura (con el riesgo de que la cotización nunca saliera). ✅ **V-06**: guard de duplicado por contacto+paquete+fecha en tours, que sin fila de inventario tenía capacidad ilimitada y aceptaba una segunda reserva idéntica. ✅ **FT-9**: un "sí" escrito en el paso `confirm` con `slots` vacío ya no vuelve a consultar disponibilidad. **HM-6**: la escritura de propiedades ya estaba protegida server-side (el `check→create` de `829a81e0` era sólo prosa en la descripción, pero `properties.service` valida en la transacción), así que se acotó a lo que faltaba de verdad.

**Lote C · conductores, contexto y continuidad.** ✅ **V-03/FT-8**: el yield FSM↔vertical pasa a los 4 idiomas — en inglés, portugués y francés el motor de citas se quedaba con "book a room" y la vertical perdía sus herramientas de venta. ✅ **V-07**: `industryGuidance` **por fin se puebla** (12 flujos dorados, uno por industria, nombrando las tools reales y gateado por lo que el tenant tiene encendido). ✅ **DE-06**: cron cada 10 min que devuelve a la IA las conversaciones escaladas que nadie atendió en 3 h y donde el cliente sigue escribiendo — antes ese silencio era permanente, porque el auto-resolve de 72 h sólo actúa si NADIE escribe; además ahora incluye `waiting_human`. ✅ **DE-07**: una conversación nueva hereda la cola de la anterior (`carriedContext`, 6 mensajes, 30 días), así que el cliente que vuelve no encuentra un desconocido. ✅ **DE-10**: el atajo de asistencia sólo responde al **primer** mensaje posterior al seguimiento, en vez de secuestrar todos los "sí" durante 48 h. ✅ **HM-7**: el adaptador de Anthropic ya no descarta un mensaje al fusionar roles con contenido en bloques (dejaba `tool_use` sin `tool_result` → 400). ✅ **DE-09**: el troceado de respuestas sube de 600 a 3500 caracteres — un turno, un mensaje: elimina el desorden por reintento, evita que el agente se pise a sí mismo y baja el costo por conversación ante el cobro por mensaje de Meta (1-oct-2026).

**FT-7 — revisado y NO cambiado a propósito.** Exponer la cita en verticales sensibles violaba una decisión de privacidad explícita y con pruebas (`DEC-06`: en salud, legal y veterinaria clínica ni la *existencia* de la cita entra al prompt). En vez de romperla se atacó la causa real de la ceguera: los tools de verificación de identidad —única llave del A2— **se publicaban sólo con el toolset de seguros**, así que esas verticales tenían el registro cerrado y ninguna llave. Ahora `IDENTITY_STEP_UP_TOOLS` viaja con cualquier agente que tenga una lectura A2.

**Lote D · el arnés que sí puede probar escrituras, y dos verticales que ya pueden cerrar.**

✅ **EC-3/EC-4 — el gate de evaluación deja de ser un falso rojo permanente.** El diseño del sandbox ya estaba entero (contacto fijo `EVAL_SANDBOX_CONTACT_ID`, `cleanupSandbox`, `verifyActions`, y `create_appointment` suprimiendo calendario y eventos bajo `evalMode`); lo que faltaba eran dos cosas que lo hacían **imposible de pasar**: `agent-test` filtraba a solo-lectura pase lo que pase, y llamaba al executor con `conversationId: undefined`, así que el guard central rechazaba con `conversation_context_required`. Cualquier escenario con `expectedActions` fallaba por un motivo ajeno al agente — un rojo permanente, que es peor que no tener gate porque enseña a ignorarlo. Ahora: el eval crea una **conversación sandbox** y registra cada mensaje del cliente como inbound real (el guard necesita ambos para poder leer el "sí"), y el executor deja pasar **exactamente los writers auditados** cuando la ejecución está atada al contacto sandbox (`canEvalExecuteWriter` exige las dos mitades: tool auditada **y** contacto sandbox). El preflight completo corre —ledger, idempotencia, confirmación—, que es justo lo que el gate debe ejercitar. La limpieza ahora barre también ledger, mensajes y conversación.

Deliberadamente **no** se tocó el contexto de ejecución global: poner `persistence: 'enabled'` habría reactivado migraciones perezosas, cachés y persistencia por eventos en *todos* los servicios. La puerta abierta es una sola tool (`EVAL_WRITABLE_TOOL_NAMES = ['create_appointment']`) y un spec la mantiene angosta: exige que la lista sea exactamente esa, que sus miembros sean writers reales, que **no** sean ejecutables en el Agent Test del dueño, y que un contacto real nunca sea escribible.

✅ **V-04 (parcial, lo que tenía servicio) — automotriz y retail ya pueden cerrar.** `schedule_test_drive` expone `VehicleInventoryService.scheduleTestDrive`, que llevaba meses construido con su propia detección de conflicto de horario y jamás se le ofreció al agente: automotriz podía buscar, describir y fotografiar un auto y no tenía con qué cerrar. `place_catalog_order` expone `OrdersService.createOrder` (transaccional, con `FOR UPDATE`) para retail y "otro", que tenían catálogo pero ninguna forma de vender —`place_order` pertenece al toolset de restaurantes—. Los precios nunca cruzan desde el modelo: sólo viajan `productId` y cantidad, y el servidor cotiza contra el catálogo. Ambas con política `contactWrite` (confirmación obligatoria), ancladas en el retrieval, y con su flujo dorado actualizado.

**Lo que queda de V-04, y por qué.** Inmobiliaria (visita a inmueble) y pet_services (guardería) **no tienen capa de servicio**: hay que construir el dominio, no exponerlo — es F2. Gimnasios tiene `GymsService.createMember`, pero dar de alta a un socio **sin cobrarle** es una promesa comercial falsa (y el pipeline de la vertical tiene una terminal `membresia_activada` con outcome ganado que se dispararía sin dinero): es una decisión del dueño sobre el modelo de cobro, no un arreglo.

Además: se corrigió un defecto latente en `EmotionService` — `capsRatio` se calculaba sobre texto ya pasado a minúsculas, así que **el cliente que ESCRIBE GRITANDO nunca registraba frustración**; ahora se mide sobre el texto original (con spec propio). Queda **deliberadamente sin tocar** `PrismaService.sanitizeParams` (EC-6): su heurística de truncado sigue siendo global y silenciosa, pero cambiarla altera el comportamiento de toda escritura del sistema y merece su propio cambio con verificación en producción, no el final de una tanda.

**Listo cuando:** existe una suite de integración que ejecuta `generateResponse`/`processIncomingMessage` reales con escrituras en sandbox para las cinco secuencias de FT (§2 fila 1-2 y anexo A) más los 10 arreglos, y pasa `pass^3` en la cadena real de modelos por plan; y en un tenant piloto de turismo el flujo dorado cierra 10/10 en WhatsApp con botones y con texto.

### F1 — Runtime de Operaciones + 3 verticales piloto (4-6 semanas)

- Diseño detallado (spec) del runtime (§8.2), del catálogo y del contrato de comandos; decisión de librería para statecharts (XState v5) o máquina propia tipada; contrato de `ResultRenderer` (plantillas por operación en 4 idiomas).
- Implementar el runtime detrás de flag por tenant, con **tres operaciones piloto**: `stay_booking`+`payment_link` (turismo alojamiento — el caso que hoy falla), `order` (restaurantes) y `appointment` envolviendo el FSM actual (control de no regresión en las 13 verticales de citas).
- Confirmación por botones en WhatsApp + texto contra pregunta pendiente en el resto; `PayloadRouter` antes del LLM; typing indicator; un mensaje por turno.
- Estado único con época; ledger semántico reinyectado; tools por estado; L1 podado; modelo por rol.
- Harness de §10 niveles 1-3 para las tres operaciones; gate en CI.
- **Listo cuando:** en los tenants piloto, `pass^3 = 100%` en escenarios innegociables, ungrounded-claim = 0 en la muestra semanal, repeat rate < 2%, no-response = 0, y el dueño no encuentra un fallo de flujo en una semana de prueba real.

### F2 — Las 18 verticales (4-6 semanas, en paralelo por familias)

- Catálogo completo (tabla §9): operaciones nuevas donde no hay tool de cierre (`property_visit`, `test_drive`, `catalog_order`, `daycare_booking`, `membership_signup`, `generic_request`), sin confirmación para cotizaciones/registro de mascota, cupos/duplicados como precondición en tours/educación.
- El FSM de citas queda absorbido (una operación más); desaparecen el yield por regex y los conductores dobles; 4 idiomas.
- Escenarios por vertical (reutilizando la matriz del plan maestro de agosto) en el gate.
- **Listo cuando:** cada vertical tiene su flujo dorado en el harness con `pass^3 = 100%` y una semana de canary sin regresión.

### F3 — Calidad continua (2-3 semanas, solapable)

- Replay de fallos reales como regresión permanente; canary por versión de agente; Watchtower con acceso a ledger/DB; métricas de §10 en Ops Center y en el Centro de calidad; OpenTelemetry GenAI en router y tools.
- **Listo cuando:** ningún cambio del agente llega a producción sin el job de evals y el rollback por versión funciona.

### F4 — Excelencia (después, con la fiabilidad demostrada)

- Memoria entre conversaciones por contacto (hoy DE-07), WhatsApp Flows para captura multi-campo, empatía adaptativa (D5/D6) medida con A/B, Ghostwriter-lite (SOP → catálogo de operaciones), voz. Es el §9.7 del análisis previo: valioso, pero después.

---

## 12. Decisiones que sólo el dueño puede tomar

1. **Aprobar la opción B** (rediseñar el núcleo del turno transaccional) y descartar tanto la reescritura como el "seguir parchando".
2. **Modelo y margen:** aceptar un modelo mejor sólo para el rol decisor (Haiku 4.5 por defecto; Sonnet en enterprise) y qué planes lo reciben; el redactor sigue barato. Verificar precios/ids en las consolas antes de fijar el registro.
3. **Confirmación por botones como estándar en WhatsApp** (texto como respaldo determinístico) y en el widget; en Telegram/IG/Messenger, texto contra pregunta pendiente. Cambia la UX de cierre.
4. **Un mensaje por turno** (el chunking de 600 chars desaparece salvo por el límite de 4096): coste Meta desde oct-2026 y menos repetición percibida.
5. **Verticales piloto de F1:** propuesta turismo·alojamiento + restaurantes + citas (belleza/salud) como control.
6. **Congelar** los cambios al prompt, al clasificador de "sí" y al ledger fuera de F0 mientras dure F0-F1: una sola rama, cada commit con su test; nada de "8 commits en 7 minutos".
7. **Política de confirmación por consecuencia** (no por clase de dato): cotizar/registrar/solicitar no confirman; reservar/cobrar/cancelar sí; pagos y descuentos con checkpoint humano hasta acumular evidencia.
8. **Ningún cambio del agente sin harness**: aceptar que F0 termina con una suite de integración con escrituras, no con una prueba manual.

---

## 13. Validación de `agent-audit-decente-2026-08.md` y la pregunta del modelo

> Añadido el 19-ago a pedido del dueño: contrastar el "Audit decente" (14 dimensiones de "no robot", matriz por familia, metodología de 720 conversaciones, roadmap D1-D14 de 4 semanas) con la forense de este documento, y responder si "batallamos tanto por el modelo de IA que usamos en cada turno".

### 13.1 Qué acierta el "Audit decente"

- **La ambición correcta y medible.** Definir "decente" como 14 dimensiones con métrica y umbral es el marco adecuado para la **capa de experiencia** (D4 un propósito, D5 lenguaje natural, D6 empatía, D7 fluidez vertical, D8 memoria, D9 proactividad, D11 identidad, D12 velocidad, D13 idioma local). Ese scorecard se conserva.
- **Hotfixes correctos** que ya entraron anoche y son valiosos: precio normalizado (D14 parcial), dedupe intra-turno (D2), `check→create` en propiedades (D2), `slot:hold` y `state.date` (D3), `traceId=wamid` + inbound lag + stalled alert (D1/D12), typing (D12).
- **Reconoce** que el simulador y el juez sólo ven texto y pide una rúbrica más rica; y que 8 de 14 dimensiones fallan hoy.

### 13.2 Dónde se equivoca (verificado contra `origin/main`)

| Afirmación del doc | Realidad verificada | Efecto |
|---|---|---|
| **D14 ✅** "`auditTurnClaim` bien" | Es el guardrail que corre **sin `executedTools`** (§3.1): reescribe como "pendiente" toda confirmación real. Es el defecto crítico #1, no un ✅ | Un ✅ falso en la dimensión más importante (no alucinar) |
| **D2 fix** "retrieval topK 8" | Implementado como `topK 10` por overlap de palabras (`3cc9f6a9`): en el turno del "sí" borra la tool escritora (§3.2). Es el defecto crítico #2 | El fix estrella del doc rompió la confirmación en 8+ verticales |
| **D1 ✅ 100%** "Skipping AI" | Verdadero para *callar*; falso para *cuándo entrar*: handoff mudo sin retorno automático (DE-06), atajos de citas que secuestran "sí"/"reagendar" (DE-10), escaladas a humano por bloqueos técnicos del ledger (FT-5) | D1 no está resuelta |
| **D3 ⚠️** "`booking:{conv}` OK" | Sólo para citas. La transacción principal de turismo, restaurantes, educación, gimnasios, seguros, servicios del hogar, fotografía y retail depende de la cadena probabilística de §5.1 y hoy no cierra de forma fiable | Subestima la dimensión que más duele |
| **D11 ✅** por la regla 2b de L1 | Una regla de prompt no es una medición; no hay métrica de identidad en producción | ✅ sin evidencia |
| **Metodología: 30 synthetic + 10 replay × 18 = 720 con `simulation` + juez de 14 dimensiones** | `simulation.service.ts:503` corre con `disableTools:true`; el juez (`quality.service.ts:28-51`) sólo ve "Cliente/Agente". **No puede medir D2, D3, D10 ni D14** (tools, orquestación, recuperación, alucinación de resultados) — mide cómo suena | Los 720 runs darían verde falso justo en lo que falla |
| **Criterio de aceptación** "p95 <4 s con `deepseek tier_4`" | Fija como objetivo el modelo más débil (BFCL MT 37%, id deprecado por DeepSeek) y contradice D2/D14 | Optimiza latencia del modelo equivocado |
| **D5 fix** "`temperature 0.3→0.5` para NLG" | La misma llamada decide tools y redacta; subir temperatura degrada los args (`conversations.service.ts:2225-2233`). Sólo válido tras separar decisor y redactor (§8.5) | Empeoraría D2 |
| **Matriz por familia** (Salud → `list_clinic_services`; moda_belleza → Retail/Catalog; hospitality → `get_restaurant_menu`) | `list_clinic_services`/`get_restaurant_menu` son tools de integraciones (Cliniko/Toast), no las por defecto; **moda_belleza usa el FSM de citas**, no catálogo (es la vertical #1 en demanda); la matriz no ve lo que sí importa: 8 verticales 100% LLM+tools, 6 sin tool de cierre (V-04), dos conductores (V-03) | Mapa vertical incompleto para lo transaccional (ver §9) |
| **Roadmap 4 semanas** | Sus semanas 1-2 se despacharon en 8 commits en 7 minutos sin harness; una fue regresión crítica | Sin gate, el roadmap produce lo contrario de lo que promete |
| Estado "❌" en dedupe, `check→create`, traceId; "fix" pendiente en EmotionService | Ya están en `HEAD` (D1, D2, D6); EmotionService es detección por palabras clave (sin LLM) + regla 19 en L1 (`prompt-assembler.service.ts:104`); tiene un `capsRatio` que nunca dispara (se calcula sobre texto ya en minúsculas) | Doc desactualizado respecto al código |

### 13.3 Síntesis: no compiten, se ordenan

El "Audit decente" describe **cómo debe sentirse** el agente (capa de experiencia). Este documento describe **por qué hoy no cierra una transacción** (capa de fiabilidad) y **cómo se mide de verdad**. Empatía, variación léxica, proactividad y memoria cross-channel sobre un agente que reescribe sus propias confirmaciones y pierde la tool en el turno del "sí" son maquillaje. La integración correcta:

- **Fiabilidad (F0-F3):** D1, D2, D3, D10, D14 se gradan por **estado y ledger** (harness de §10), nunca por juez de texto.
- **Experiencia (F1 parcial, F4):** D4-D9, D11-D13 con el scorecard del doc, juez calibrado con humanos, y A/B — cuando la fiabilidad ya está demostrada. D5/D6/D8/D9 son exactamente F4.
- Se adoptan sus 14 dimensiones como **scorecard oficial** con las correcciones de 13.2 y esta partición.

### 13.4 ¿Batallamos tanto por el modelo? — respuesta directa

**El modelo es un amplificador real, no la causa raíz.** Cuatro pruebas:

1. Los dos defectos críticos ocurren **con cualquier modelo**: el guardrail reescribe la confirmación aunque la redacte Opus; la tool ausente no la puede llamar nadie.
2. **El FSM de citas funciona con los mismos modelos baratos** porque el servidor interpreta el "sí" y ejecuta; el modelo sólo vocaliza. La diferencia entre "funciona" y "no funciona" en esta plataforma no es el modelo: es quién ejecuta el commit.
3. La literatura lo confirma: en τ-bench los mejores modelos caen por debajo del 25% en `pass^8`; el 45-48% de los fallos con GPT-4.1/Claude son "false success"; ADK 2.0 y Rasa CALM sacaron al LLM del control de flujo **precisamente** porque el modelo grande tampoco lo hace de forma consistente.
4. **Pero** el modelo actual pone un techo bajo y explica una parte medible de la deriva de args, la mala selección y las reglas ignoradas: `deepseek-chat` (64k, id deprecado, 37% multi-turno en BFCL v4) para emprendedor/starter y `gpt-4.1-mini` (34%) para pro/enterprise, elegidos por value-routing en los turnos cortos y pegados 30 min a la conversación (§5.3). Haiku 4.5 (54%) o Sonnet (61%) casi nunca se usan.

**Conclusión operativa:** subir el modelo *solo* = mejora marginal, coste extra y el bucle sigue (la premisa de re-emisión no cambia); arreglar la arquitectura *sin* subir el modelo = fiable pero mediocre en comprensión, correcciones y tono. **Hay que hacer las dos, en ese orden y en la misma fase F0**: ítems 1-3 (guardrail, recorte, ejecución server-side del "sí") primero; ítem 5 (suelo tier_2 para el rol decisor, afinidad por rol, sin value-routing a tier_4 con tools) inmediatamente después.

**Coste (estimación, verificar tarifas oficiales):** hoy un turno con tools hace 3-4 llamadas (decisión + tool loop + guardrail retry o cierre forzado) con ~6-8k tokens de entrada cada una en gpt-4.1-mini (~$0,40/1M in) ≈ $0,01-0,015 por turno. Con el runtime de §8: 1 llamada decisora **corta** (estado + ≤8 tools + últimos turnos ≈ 3-5k) en Haiku 4.5 (~$1/1M in) + 1 redacción barata ≈ $0,005-0,01 por turno. Es decir: **mejor modelo y no más caro**, porque se hacen menos llamadas y más cortas — y se ahorran las llamadas de guardrail-retry y de cierre forzado que hoy paga cada transacción.

### 13.5 Qué es "el mejor agente integral posible" (definición operativa)

Cinco propiedades en orden de dependencia — cada una presupone la anterior:

1. **Fiable:** la transacción cierra siempre que debe, nunca anuncia lo que no ocurrió, nunca calla, nunca ejecuta sin consentimiento (medida: `pass^3 = 100%` en flujos dorados, ungrounded-claim 0, no-response 0).
2. **Útil:** usa la tool correcta en el turno correcto, recuerda lo que ya sabe, recupera con alternativas cuando algo falla (tool success, recovery, repeat rate).
3. **Humano:** tono de la marca, empatía cuando toca, terminología del sector, idioma y registro local, un propósito por mensaje (las 14 dimensiones del "Audit decente").
4. **Rápido y económico:** p95 por canal, un mensaje por turno, coste por conversación (LLM + Meta).
5. **Medible y gobernable:** todo lo anterior por versión de agente, vertical y canal, con gate de despliegue y rollback.

El "Audit decente" define bien la propiedad 3. Este documento define la 1, la 2 y la 5, y muestra que hoy fallan la 1 y la 2. La visión integral es la unión de los dos documentos, **en ese orden**.

---

## Anexo A — Hallazgos verificados por lente (resumen; detalle completo en la salida de los auditores)

| Id | Sev | Hallazgo | Evidencia principal |
|---|---|---|---|
| FT-1 / EC-1 | crítico | Guardrail de claims sin `executedTools`: toda confirmación real se reescribe como "pendiente" | `conversations.service.ts:2424,2645`; `outcome-claim.util.ts:89` |
| HM-1 / V-01 | crítico | El recorte a 10 tools saca la escritora del turno del "sí" | `tool-retrieval.service.ts:28,43,62`; `conversations.service.ts:1997-2002,1952-1993` |
| HM-2 / V-02 / FT-4 | crítico | La confirmación depende de que el LLM re-emita la misma tool con hash idéntico sin ver los args; nada rehidrata la operación pendiente | `tool-execution-control.service.ts:1251,1329-1438,1417,1745`; `conversations.service.ts:2120` |
| DE-04 | crítico | El catch final borra el rastro de tools ya ejecutadas → niega o repite reservas reales | `conversations.service.ts:2484-2503` |
| FT-2 | alto | "Recuerdo de operación cumplida" sólo con "sí" literal + hash idéntico; `stableValue` no normaliza fechas/teléfonos; challenge 15 min | `tool-execution-control.service.ts:243,1259-1272,1363` |
| FT-3 | alto | Doble confirmación en citas por texto (`create_appointment` sin `authorityEvidence`) | `booking-engine.service.ts:753-755,978`; `tool-execution-control.service.ts:1456-1462` |
| HM-3 | alto | Value-routing manda turnos cortos a deepseek y la afinidad lo pega 30 min, también en pro/enterprise | `llm-router.service.ts:290-315,363,380,411` |
| HM-4 | alto | Reserva→pago: dos rondas y `payableReference` invisible en el turno siguiente | `payment-tools.ts:16`; `tool-policy-registry.ts:190` |
| V-03 / FT-8 | alto | Dos conductores (FSM/LLM) que se ceden el turno por regex sólo en español | `conversations.service.ts:2802-2835`; `booking-engine.service.ts:659-664` |
| V-04 | alto | Seis verticales sin tool de cierre para su transacción principal | `tool-policy-registry.ts:239-245,322-330`; `ai-tool-executor.service.ts:3093-3095` |
| EC-2 | alto | Consentimiento inferido del mensaje que originó el reto con tokens que son verbos de petición | `tool-execution-control.service.ts:142,148,1343-1352` |
| EC-3 / EC-4 / HM-5 | alto | Harness bloquea writers antes del preflight; el spec re-emite la tool a mano; sin specs sobre `generateResponse` | `ai-tool-executor.service.ts:127-129`; `agent-test.service.ts:174-205`; `simulation.service.ts:503`; `eval.service.ts:305-310` |
| DE-01 | alto | Silencios "exitosos" sin métrica ni alerta | `conversations.service.ts:456,473,749`; `platform-monitor.service.ts:144` |
| DE-02 | alto | Reintento del turno mezcla dos redacciones y duplica el historial | `provider-message-id.util.ts:58`; `conversations.service.ts:498,743` |
| DE-03 | alto | Lock ignorado tras 36 s (widget 2 s) → turnos concurrentes | `conversations.service.ts:356,2940` |
| DE-06 | alto | Handoff sin retorno automático; auto-resolve excluye `waiting_human` | `conversations.service.ts:473`; `nurturing.service.ts:214` |
| FT-5 | medio | Escalada a humano por bloqueos técnicos del ledger (`shouldHandoff` con dos semánticas) | `conversations.service.ts:2346,2467`; `tool-execution-control.service.ts:1684,1698` |
| FT-6 | medio | Repetición de lecturas: sin memoria de tool results entre iteraciones/turnos | `conversations.service.ts:2270`; `active-operations-context.service.ts:143` |
| FT-7 | medio | Citas invisibles en `active_objects` para verticales sensibles e industria no canónica | `active-object-policy.ts:78,98` |
| DE-05 | medio | TTLs desincronizados; `toolContext` clave muerta | `tool-execution-control.service.ts:13`; `conversations.service.ts:1541`; `procedure-engine.service.ts:17` |
| DE-07 | medio | Auto-resolve 72 h abre conversación vacía y deja estado huérfano | `conversations.service.ts:893,921` |
| DE-08 | medio | Fragmentos del debounce no persistidos; el reto lee sólo el último inbound | `conversations.service.ts:308,2572`; `tool-execution-control.service.ts:1338` |
| EC-5 | medio | Juez y métricas sólo de texto | `quality.service.ts:28-51,233`; `agent-quality.service.ts:1113` |
| EC-6 | medio | Truncado silencioso de parámetros en `PrismaService` (heurística global) | `prisma.service.ts:880,908` |
| EC-7 | medio | "Args mismatch escalation" no escala: re-pregunta sin tope | `tool-execution-control.service.ts:1402-1425` |
| HM-6 | medio | Writers sin precondición runtime de lectura previa; `create_appointment` obliga email; appointments primero en el fallback | `vacation-rental-tools.ts:59`; `appointment-tools.ts:52` |
| V-05 | medio | Cotizar/registrar mascota/pedir cotización confirman como si fueran cobros | `tool-policy-registry.ts:249,288,317,328` |
| V-06 | medio (hip.) | Tours sin inventario = ilimitado y sin guard de duplicado | `tours.service.ts:312-349` |
| V-07 | bajo | `industryGuidance` nunca se puebla | `prompt-assembler.service.ts:187`; `conversations.service.ts:1667-1713` |
| DE-09 / DE-10 | bajo | Chunks desordenables en reintento; atajos de citas secuestran "sí"/"reagendar" genéricos | `outbound-queue.service.ts:47`; `conversations.service.ts:556-607` |
| FT-9 | medio | **Hallazgo nuevo (19-ago, al escribir las pruebas de F0-4):** en el paso `confirm`, un "sí" escrito con `state.slots` vacío no reserva: cae en la rama `serviceId && date && !slots.length` y vuelve a consultar disponibilidad. El botón no lo sufre porque corta antes por el payload crudo. Reproducible cuando el estado se rehidrata sin `slots` (Redis vencido → respaldo PG) | `booking-engine.service.ts:748-758` |
| HM-7 | bajo | Adaptador Anthropic descarta mensajes al fusionar roles con contenido en array | `anthropic.provider.ts:167-171` |

**Cinco secuencias que hoy fallan (verificadas por código):** (1) alojamiento: reserva OK → "está pendiente" (guardrail) → "sí" → replay o nuevo challenge; (2) cualquier LLM+tools: reserva hecha → "¿ya quedó?" → nuevo ledger → "necesito que confirmes"; (3) citas por texto: "sí" → "Error al crear la cita: confirmation_required" → "sí" otra vez; (4) pago/reserva: "sí" + "para 2 personas" en ráfaga o después de 15 min → challenge otra vez; (5) salud/serv. profesionales/veterinaria: cita creada → "¿a qué hora era?" → el agente no sabe y ofrece agendar de nuevo.

## Anexo B — Fuentes externas principales (fecha · qué aporta)

- τ-bench (arXiv 2406.12045, jun-2024) y τ²-bench (arXiv 2506.07982, jun-2025; v1.0.1 jul-2026) · pass^k, fallos por args/política, caída con usuario.
- *From Confident Closing to Silent Failure* (arXiv 2606.09863, jun-2026) · false success 45-48%.
- *Verified Tool Calls Improve LLM Agent Reliability Under Non-Atomic Failures* (arXiv 2608.02645, jul-2026) · verify-before-retry, idempotencia.
- *ToolFailBench* (arXiv 2607.04686, jul-2026) · taxonomía tool-skip / result-ignore / fabrication / unnecessary-use.
- *Scaling Enterprise Agent Routing* (arXiv 2606.17519, jun-2026) y paper 2605.24660 · degradación con el número de tools; K≈7.
- FORGE (arXiv 2602.16708, feb-2026) · políticas en prompt "sin garantías".
- Laban et al. (arXiv 2505.06120, may-2025) · −39% multi-turno.
- Berkeley Function Calling Leaderboard v4 (abr-2026) · multi-turno por modelo.
- Anthropic: *Building effective agents* (dic-2024), tool use best practices / Tool Search (nov-2025), *Demystifying evals for AI agents* (ene-2026), context engineering.
- OpenAI: *A practical guide to building agents* (abr-2025), function calling guide, Agents SDK (guardrails/HITL).
- Google: ADK 2.0 rationale (jul-2026), Dialogflow CX playbooks vs flows.
- Rasa CALM (docs 2026: Dialogue Understanding, conversation patterns, flows) y comparativa CALM vs LangGraph (ago-2024, vendor).
- Parlant (docs 2026; ARQ arXiv 2503.03669, mar-2025).
- Sierra: *From LLMs to enterprise-grade agents* (oct-2025), *Constellation of models* (dic-2025), *Simulations* (ago-2025), Agent SDK/Journeys (nov-2025), ADLC (jun-2024).
- Decagon: AOP (abr-2025), evaluation engine (jul-2025), Simulations (sep-2025), Watchtower, DuetBench (jun-2026).
- Intercom: Fin 3 (oct-2025), Procedures docs (2026), *Announcing Evals and Releases* (ago-2026), definición de resolución.
- Salesforce Agentforce: instrucciones (ene-2025), Atlas, "five levels of determinism".
- Zendesk, Cresta (sep-2025), Parloa (nov-2025), Voiceflow (mar-2025), Botpress, Amazon Connect (2026), Ada (feb-2026).
- LangGraph 1.0 / interrupts, OpenAI Agents JS HITL, Mastra HITL (feb-2026), Vercel AI SDK 6/7, Pydantic AI deferred tools, Temporal TS + agents (pre-release), Diagrid (feb-2026), XState/Stately.
- Evaluación: LangSmith trajectory evals/agentevals, DeepEval, Arize, OpenAI trace grading, *Lost in Simulation* (ACL 2026), *Simulated Customers Never Walk Away* (jun-2026), OTel GenAI semconv (Development, jul-2026).
- WhatsApp/Meta: doc non-template-messages (per-message pricing jul-2025; service messages pagos 1-oct-2026; Meta Business Agent ago-2026), interactive messages/Flows/typing indicator, límites por portafolio (oct-2025), BSUID (jun-2026→H2), AI Providers policy (feb-2026); BSP: respond.io, Blip, Botmaker, Yalo, Wati, Kommo, Manychat, Chatfuel, Cliengo, Treble, Zenvia, B2Chat, Leadsales; tarifas por país (Patagon AI jul-2026, YCloud jul-2025 — verificar contra Meta).

## Anexo C — Preguntas abiertas a medir en producción antes de F1 (consultas, no código de producto)

1. ¿Qué proporción de turnos `tool_calling` termina en `deepseek-chat` / `gpt-4.1-mini` por plan? (`ai:stats`, logs `[LLM] tool_calling via …`). Dimensiona HM-3.
2. ¿Cuántos ledgers de `tool_execution_ledger` tienen >1 challenge por conversación en la última semana, y en cuántos el hash difiere entre intentos? Dimensiona EC-7/HM-2.
3. ¿Con qué frecuencia aparecen `[Guardrail] Response claimed completed action without backing tool execution` tras un `create_*` exitoso, `Could not acquire lock … processing anyway` y `Resuming interrupted turn`? Dimensiona FT-1, DE-03, DE-02.
4. ¿Cuántos tenants LLM+tools superan 10 tools registradas y cuál es su set de fallback real? Dimensiona V-01.
5. ¿Cuántos tenants tienen `verticalConfig.industry` ausente/legacy (fail-closed de `active-object-policy.ts:78`)? Dimensiona FT-7.
6. ¿El deploy hace drain (SIGTERM con espera) del API/worker antes de recrear contenedores? Si no, cada deploy produce turnos interrumpidos (DE-02).
7. ¿`deepseek-chat` sigue respondiendo o ya devuelve error por deprecación (cae al siguiente en silencio)?

---

*Documento vivo. Se actualiza al cerrar F0 (con las mediciones del Anexo C) y al aprobar la spec del Runtime de Operaciones (F1).*
