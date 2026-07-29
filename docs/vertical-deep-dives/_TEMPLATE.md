# Plantilla del deep-dive por vertical

> Spec compartida para los 18 dossiers de `docs/vertical-deep-dives/`. Cada agente la lee entera antes de escribir el suyo. El objetivo: el documento definitivo de UNA vertical — el que se abre antes de tocar cualquier cosa de esa industria.

## Contexto que TODO dossier debe asumir (estado al 29-jul-2026)

La auditoría de madurez (`docs/vertical-maturity-audit-2026-07.md`) y su bloque "Ahora" **ya implementado 12/12** (commits `b9bd6332`, `5c2581db`, `60049164`). NO reportar como roto nada de esto:

- `95f758f3`: persona vertical en shape canónico (`config.persona.*`/`config.behavior.*`); `updateAgent` fusiona `tools`; bootstrap siembra `availability_slots` desde `businessHours`; `tools.faqs` encendido; booking escala a humano ante `appointments_not_configured`; localización pt/fr/en desde el registry; índices únicos + ON CONFLICT con target; ortografía y neutralización de políticas en FAQs semilla.
- `b9bd6332`: `tools.vehicles` encendido para automotriz; tabla `courses` de education desbloqueada (5 ALTERs + `slug DROP NOT NULL`); `tools.appointments` en tpl_finanzas_calificador; `tools.restaurants` en tpl_restaurante_delivery; "Hotel — noche" con `duration_type 'open'` (y `seedServices` propaga `durationType`); Mindbody filtra clases pasadas + flag `stale`; guard `.has()` + 6 claves `verticalWelcome`; ToolsTour de inmobiliaria → `/admin/listings`.
- `5c2581db`: `offer_required` quitada de 6 verticales (conservada en education); `alquiler_vacacional` en SUB_TYPES + `tools.properties` para hotel/alquiler_vacacional; `createDefaultAgentFromGoals` elige plantilla por sub-tipo (tours/agencia/tienda/delivery/dark_kitchen); listener de emergencias de servicios_hogar (email a admin+supervisores); `chatReasons`/`customerTypes` del alta llegan al prompt L3 (`<vertical_context>`, cache `bizgoals:*` 600s).
- `60049164`: página `/admin/vehicles` completa (cards, stats, test drives, marcar vendido) + ítem sidebar + tour.

Huecos estructurales CONOCIDOS y transversales (no re-descubrirlos; solo evaluar el impacto específico en tu vertical): motor de reservas mono-recurso (capacidad 1 vía chat, `staffId` descartado, `max_concurrent` solo en la ruta pública); integraciones T3.19 sin probar en vivo y sin re-sync automático; sub-tipos mayormente cosméticos; `slaHours`/`itemOrder`/`deferred` sin destino; cosmética (checklist/empty states) faltante en las 6 verticales nuevas.

## Fuentes obligatorias

1. Tu ficha en `docs/vertical-maturity-audit-2026-07.md` (§4) y tu clúster en `docs/vertical-audit-workdir/cluster-*.json` — es el punto de partida, no lo repitas: profundizalo.
2. El código real: `vertical-definitions.ts` (tu bloque), `verticals.service.ts` (tu rama del bootstrap), `persona.service.ts` (tus plantillas), `ai-tool-executor.service.ts` (tus tools), tus módulos dedicados si existen, tu superficie en el dashboard (sidebar/página/KPIs/checklist).
3. Mercado SOLO desde nuestros docs: `market-research-latam.md`, `competitive-analysis-2026-q2.md`, `vertical-strategy.md`, `plan-profitability-2026-07.md`. Nada inventado.

## Reglas

- Cada afirmación con archivo:línea LEÍDO. Distinguir "no existe" de "no lo encontré".
- Español. Sin relleno. Lo que está BIEN se dice igual de claro.
- **Escribir el .md temprano e ir reescribiéndolo por sección completada** — sesiones anteriores murieron por límites; un dossier parcial en disco vale más que uno perfecto perdido.
- Al terminar: actualizar la fila propia en `docs/vertical-deep-dives/_PROGRESS.md` (estado + fecha).

## Estructura EXACTA del dossier

```
# <Vertical> — deep-dive (Jul 2026)

## 1. Veredicto y tesis de inversión
3-6 frases: qué es hoy, qué podría ser, y la recomendación (INVERTIR / MANTENER / GENÉRICA-HONESTA) con el porqué de mercado y de código.

## 2. Radiografía end-to-end
El recorrido REAL: alta (sub-tipos, objetivos) → agente creado (plantilla, tools) → bootstrap (qué siembra) → conversación (qué puede hacer la IA de verdad, tool por tool) → agenda/inventario → pipeline → dashboard del tenant → integraciones. Con archivo:línea. Tabla de tools: | tool | qué hace | gating | ¿funciona e2e? |

## 3. La experiencia hoy, contada honestamente
(a) El dueño en sus primeros 30 minutos. (b) El cliente final por WhatsApp en sus primeros 3 mensajes. Dónde brilla, dónde se cae, dónde miente.

## 4. Huecos finos
Más granulares que la matriz. | # | Hueco | Severidad | Evidencia | Arreglo | Esfuerzo |

## 5. Lo que esta industria necesita y no tenemos
Features del rubro, flujos, integraciones LatAm concretas. Separar "mesa de entrada" (sin esto no somos creíbles en el rubro) de "diferenciador".

## 6. Competencia del rubro
Solo desde nuestros docs, con citas. Quién gana este vertical hoy en LatAm y con qué.

## 7. Plan de inversión de ESTA vertical
Quick wins (días) / Mediano (semanas) / Apuesta (si se decide invertir). Cada ítem con archivos y esfuerzo. Coherente con el veredicto de §1.

## 8. Qué no se verificó
```
