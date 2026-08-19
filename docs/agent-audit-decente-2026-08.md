# Auditoría Completa — Agente Decente Parallext (Todas las dimensiones, todas las verticales)

> **Objetivo:** agente funcional en las **18 verticales** que no se siente robot: entiende, reacciona, usa herramientas a tiempo, orquesta con reglas del negocio y habla como humano del sector.  
> **Fecha:** 2026-08-18 · **Actualizado:** 2026-08-18 alcance total  
> **Baseline:** `docs/agent-system-analysis-2026-08.md` (§2-9.7) + logs `6a5110788e12` y `a3c4d43bec2a` tenant `3e8ad32e` `573208010737` `Laura Sofia wizard` · Punta 2026 `Sierra Ghostwriter/Horizon/Context`, `Decagon AOPs/Watchtower`, `Hume EVI`.

## 1. Qué es “no robot” — 14 dimensiones auditables (todas medibles)

Antes 4 dimensiones; ahora 14. “Decente” = pasa **todas** con umbral por vertical.

| # | Dimensión | Qué siente el cliente si falla | Criterio decente | Métrica | Umbral | Hoy |
|---|---|---|---|---|---|---|
| **D1** | **Cuándo entrar / cuándo callar** | Habla cuando humano atiende, o calla cuando debe escalar | No interrumpe `waiting_human/with_human` `468`; escala a humano si `frustration>0.7` 2 turnos | `handoff_precision` + `skip_when_human` | >98% | ✅ 100% `Skipping AI` |
| **D2** | **Qué herramienta y cuándo** | Pregunta dato que ya podría consultar; inventa precio | 1-3 tools relevantes, respeta `check→create`, no duplica, retrieval topK 8 | `tool_relevance` / `duplicate_rate` / `dependency_ok` | rel>0.85 dup 0% | ❌ rel~0.4 `2× check_property_availability` `1787112547697` `list_properties` 4× |
| **D3** | **Orquestación multi-paso** | Olvida fecha dicha hace 2 mensajes, repite `¿qué servicio?` | Estado `idle→booked` sin repetir pregunta, hold anti-doble-reserva | `state_retention` `no_repeat_question` | >95% | ⚠️ `booking:{conv}` OK pero `ctx:{contact}` falta; sin `slot:hold` `836` |
| **D4** | **Respuesta fácil / 1 propósito** | Párrafo largo con 3 preguntas | `One message one purpose` `prompt-assembler:77` + 1 pregunta por bubble | `one_question_rate` | >90% | ✅ L1 bien, pero `slice(-4)` pierde anáfora |
| **D5** | **Lenguaje natural (no plantilla)** | “Entiendo su solicitud. Le estoy transfiriendo...” suena script | Variación léxica, no repite misma frase >2 veces, longitud 1-3 oraciones | `template_repetition` `avg_tokens` | repetición <5% | ❌ `handoffText` determinista idéntico `handoff.service.ts:113` |
| **D6** | **Empatía y reacción emocional** | Cliente frustrado recibe “No tengo precio verificado” frío | Valida emoción si `frustration>0.7` antes de dato; espeja energía | `empathic_preamble_rate` `sentiment_delta` | >80% cuando frustrado | ❌ `1787112549618` evasiva fría tras 2 guardrails |
| **D7** | **Fluidez vertical (habla como del sector)** | “Cliente” cuando debe ser “paciente/huésped/estudiante” | Usa `customer_noun/transaction_noun/service_noun` `vertical_context` `1645` natural | `vertical_term_accuracy` | 100% | ⚠️ `vertical_context` existe pero `wizard` no lo personaliza |
| **D8** | **Memoria episódica** | “¿cuál es tu nombre?” 2ª vez | Recuerda nombre/fecha/objeción 24h cross-channel `ctx:{contact}` | `memory_recall` | >90% | ❌ `booking:{conv}` pierde al `DELETE` `70b36d04` |
| **D9** | **Proactividad** | Espera a que cliente pregunte por oferta | Sugiere siguiente paso relevante 1 vez por turno sin ser pushy | `proactive_suggestion_rate` | 30-50% | ❌ Nurturing `delays [4h,24h,72h]` pero no `nextBestAction` Horizon |
| **D10** | **Recuperación de error** | “Property not available” sin alternativa | Si tool falla, explica por qué + 2 alternativas/fechas | `recovery_with_alternative` | >90% | ❌ `create_property_booking failed` → `ya tienes reserva` `1787079394289` sin alternativa |
| **D11** | **Consistencia identidad** | “Soy Laura Sofía” luego “Soy asistente de IA” | Nombre exacto `<persona><identity><name>` `prompt-assembler:88` L1 regla 2b | `identity_consistency` | 100% | ✅ L1 2b bien |
| **D12** | **Velocidad percibida** | 9.5s silencio tras mensaje | p95 <4s, typing indicator `657` + chunks 600 chars `2669` staggered 1200ms | `p95_latency` `typing_shown` | <4s | ❌ `9558ms` `1787112552082` vs `3979ms` |
| **D13** | **Multilingüe y local** | Español neutro cuando cliente es `es-CO` coloquial | Detecta `es-CO` y usa `vos`/`sumercé` según vertical, no traduce nombre | `lang_match` | >95% | ⚠️ `LanguageDetectorService` `1566` stickiness ok pero sin `es-CO` local |
| **D14** | **Cumplimiento por vertical** | Da consejo médico/financiero fuera de guión | Guardrails + `get_policy`/`get_treatment_plan` nunca alucina, `A4` requiere aprobación | `policy_grounding` `hallucination_rate` | 0% halluc | ✅ `get_policy` + `auditTurnClaim` `2600` bien, pero `validatePrices` falla formato |

**Fallo decente = cualquiera < umbral.** Hoy fallan 8/14.

## 2. Matriz por vertical — 18 verticales, qué cambia por cada una

`verticals/vertical-definitions.ts` 18 canónicas + `vertical-strategy.md`. No todas usan mismas tools; auditar por familia.

| Familia | Verticales | Tools críticas | Riesgo “robot” específico | Check vertical |
|---|---|---|---|---|
| **Salud** | `salud` (dental, médica, estética, psicología) | `list_clinic_services` `check_clinic_availability` `TRIAGE` | Tono frío ante dolor; dar diagnóstico sin `triage_pet_emergency` handoff | Empatía + `clinical` skill `handoff 428` + nunca diagnosticar |
| **Hospitality** | `turismo` `restaurantes` `vacation_rental` | `list_properties` `check_property_availability` `get_restaurant_menu` `get_menu` | Precio inventado `180000` `1787112549618`, no ofrecer alternativa fecha | Price accuracy 100% + hold + alternativa |
| **RealEstate/Automotriz** | `inmobiliaria` `automotriz` | `search_listings` `search_vehicles` `send_listing_image` | Descripción genérica sin `send_*_image` `_mediaToSend` `2388` | `_mediaToSend` staggered 2000+1200ms |
| **Educación/Servicios** | `education` `professionalServices` `pet_services` `homeServices` | `get_placement_test_link` `create_service_request` `get_case_status` | Preguntar 3 datos a la vez rompe L1 `one purpose` | `collectMissingInfo` 1 dato por turno |
| **Retail/Catalog** | `moda_belleza` `retail` `technology` | `search_products` `recommend_products` `check_stock` | Ofrecer producto sin stock | `check_stock` antes de prometer |
| **Gyms/Pets** | `gimnasios` `veterinaria` `pet_services` | `book_class` waitlist `triage_pet_emergency` | `triage` debe escalar humano inmediato | `shouldHandoff` `frustration_detected→complaints` |
| **Finanzas/Seguros** | `finanzas` `seguros` | `calculate_quote` `file_claim` `request_identity_code` step-up `A4` | Dar consejo financiero sin licencia | Guardrail financiero + `A4 humanApproval` `tool-policy-registry:346` |

**Auditoría por vertical =** correr `simulation` 30 synthetic + 10 replay por vertical (540 + 180 total) con `customer_noun` correcto (`paciente` salud, `huésped` turismo, `estudiante` educación).

## 3. Auditoría por capa — hallazgos expandidos

### 3.1 D1 Cuándo entrar
| Check | Archivo:línea | Estado | Fix |
|---|---|---|---|
| Handoff keywords | `handoff.service.ts:75` `617` | ✅ | — |
| Skip si humano | `468` | ✅ | — |
| Debounce 800ms sin trace | `302` | ❌ | `traceId=wamid` en `TurnTraceContext` |
| Yield vertical regex | `2752` | ❌ | Clasificador `grok-4-1-fast` topK vertical |
| isNewSession 30m vs Redis 1h | `1531` | ❌ | `¿seguimos con {date}?` recovery |
| Typing | `657` | ✅ | — |

### 3.2 D2 Qué herramienta
| Check | Estado | Fix |
|---|---|---|
| Registro 71 por flag `1882` | ❌ | `searchRelevantTools topK 8` embedding `shared:600` + `vertical:{tenant}` `950` |
| Sin examples few-shot | ❌ | 2-3 examples por tool +18% Gorilla |
| Dependencia `check→create` vacation | ❌ | Policy `requires check success` `tool-execution-control:845` |
| Dedup intra-turno | ❌ | `Map<sha256(args)>` antes de `execute` `2255` |
| Policy oculta a LLM | ❌ | Inyectar `confirmation required` en `description` |

### 3.3 D3 Orquestación
`BookingEngine` stringly-typed `259` → `XState`; añadir `slot:hold NX EX 120` `836`; validar `state.date < todayISO` reset; migrar `booking:{conv} 1h` `2808` → `ctx:{contact} 24h` cross-channel; exponer `ProcedureEngine` como AOPs `Decagon` (upload SOP → graph).

### 3.4 D5-D6 Humano (nuevo)
| Check | Estado | Fix punta 2026 |
|---|---|---|
| Template repetición `handoffText` `113` | ❌ | `Voice Personas` `Sierra` — 3 variantes por `frustration` level + `vertical_term` |
| Sin `affective` | ❌ | `EmotionService` `frustration/confusion/urgency` cheap LLM `697` → `TurnContext.affective` `L1` addendum: `if frustration>0.7 → 1 frase validación` `prompt-assembler:77` |
| Sin variación léxica | ❌ | `temperature hasTools 0.3` `2209` subir a `0.5` para NLG + `responseValidator` mantiene factualidad |
| Sin proactive `nextBestAction` | ❌ | `Horizon` `nurturing.service.ts` → planner LLM elige `follow-up` con `ticketValue/complexity` `292` |

### 3.5 D7-D8 Vertical + memoria
`vertical_context` `1645` cache 600s correcto pero `wizard` no personaliza; añadir `goals` `bizgoals:{tenant}` en prompt con ejemplos por vertical. Memoria: `customerMemory` cada 6 msgs `1593` sin extracción automática de `lastObjection`; añadir `extractMemory` tras tool success `appointment.created` `ai-tool-executor`.

## 4. Metodología de investigación — cómo auditar “no robot” en todas las verticales

**Muestreo:** 30 synthetic + 10 replay por vertical = 720 conversaciones. Synthetic generadas con `simulation` `T2.13` `synthetic (LLM per-vertical)` + `QualityService.judgeTranscript` `quality.service.ts` con rubric 14 dimensiones (1-5 cada una). Replay: anonimizar `b638d8c5` reales, re-jugar con `AgentTestService` `isAgentTestSafeToolName` `203` vs `persistence:disabled`.

**Rúbrica humana (1-5, decente ≥4):**
- `fluidez 5` = 0 repeticiones plantilla, 1 pregunta, variación léxica, `vertical_term` correcto
- `empatía 5` = valida emoción antes de dato si frustrado, espeja energía
- `tool timing 5` = tool relevante en turno correcto, no duplica, dependencia ok

**Instrumentación (3 días):**
1. `traceId=wamid` `Inbound→Conversations→Outbound` `TurnTraceContext`
2. `SELECT tool, args, latency, success, tenant, vertical FROM tool_execution_ledger WHERE created_at > now()-7d` `tool-execution-control:243`
3. `SELECT prompt, tools, ragHits FROM turn_traces WHERE tenant=3e8ad32e`
4. Baseline hoy: `tool_relevance 0.4`, `duplicate 12%`, `price_retry 100%` en `b638`, `p95 9.5s`, `template_repetition` handoff 100%.

**A/B (1 semana):**
- Control vs `retrieval topK 8` + `EmotionService` + `ctx:{contact}`
- Control vs `temperature 0.3→0.5` con `validatePrices` guardrail
- Por vertical: `wizard` vs `AOP` SOP-compiled

## 5. Roadmap ampliado — de robot a humano en 4 semanas

| Semana | Dimensiones | Entregable | Archivo |
|---|---|---|---|
| 1 | D2 D10 D14 | Normalizar precio `\D` + dedup `sha256` + `check→create` policy + `slot:hold` | `validator:2631` `executor:191` `registry:217` `booking:836` |
| 1 | D1 D12 | `traceId=wamid` + métricas `tool_relevance/inbound.lag/guardrail` + `platform-status` 304 polling no afecta | `TurnTraceContext` `dashboard-analytics` |
| 2 | D2 D5 D7 | `searchRelevantTools topK 8` + `description+examples` + `vertical_term` variantes handoff | `shared:600` `1882` `vertical:950` `handoff:113` |
| 2 | D3 D8 | `ctx:{contact} 24h` + validar `state.date` + `XState` draft | `2808` `259` |
| 3 | D6 D5 D11 D13 | `EmotionService` → `affective` → L1 empatía + `temperature 0.5` NLG + `lang es-CO` | `697` `prompt-assembler:77` `language-detector` |
| 3 | D9 | `Horizon` `nextBestAction` planner `nurturing` + `dripSequence` | `nurturing.service.ts` |
| 4 | D4 D10 D14 | `simulation` gate `pass >92%` 720 runs + `Watchtower` cron 5% sample | `simulation.service.ts` `alerts.service.ts:*/15` |

**Criterios de aceptación humano:**
- [ ] 0% `Enqueued` sin `Processing` trazable
- [ ] 0% duplicate, 0% `price_retry`, `tool_relevance` >0.85 en 720 sample todas las verticales
- [ ] p95 <4s `deepseek` `tier_4` (hoy 9.5s)
- [ ] `one_question` >90%, `vertical_term` 100%, `empathic_preamble` >80% cuando frustrado
- [ ] `template_repetition` <5%, `memory_recall` >90% 24h cross-channel
- [ ] `quality overall` median >7.5 (hoy 6 `1787079165769`) y `csat` >4.2 por vertical

## 6. Referencias

- `docs/agent-system-analysis-2026-08.md` §7-9.7 §9.7 punta 2026 Sierra/Decagon/Hume
- `conversations.service.ts:302` debounce `617` handoff `1882` tools `2162` loop `2808` ctx
- `prompt-assembler.service.ts:77` L1 17 reglas `148` L2 persona `125` L3 turn
- `knowledge.service.ts:652` RRF `handoff.service.ts:75` `ai-tool-executor:87` `tool-policy-registry:104` `tool-execution-control:845`
