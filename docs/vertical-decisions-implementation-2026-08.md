# Implementación de las 19 decisiones verticales

**Corte:** 8 de agosto de 2026

**Registro de origen:** [`vertical-decision-register-2026-08.md`](./vertical-decision-register-2026-08.md)
**Regla de lectura:** `adoptada` significa que la recomendación quedó convertida en política o contrato ejecutable. No significa que el gate externo esté aprobado. La certificación E2E permanece en **0/18**.

## Resultado ejecutivo

Las 19 recomendaciones fueron adoptadas con una frontera fail-closed. En los casos que dependen de proveedor, infraestructura, mappings o evidencia externa, se implementó el contrato, el preview o la contención, y la ejecución permanece deshabilitada hasta satisfacer el gate correspondiente. No se reemplazó una dependencia real por un mock para declarar certificación.

| Decisión | Elección adoptada | Evidencia ejecutable | Estado operativo | Gate que permanece |
|---|---|---|---|---|
| `DEC-01` | Primer cohorte: Restaurantes, Turismo y Servicios del hogar. | `vertical-product-policy.ts`, endpoint `/verticals/product-policy` y matriz 1.520. | Anclas `implemented_not_certified`; marketing profundo deshabilitado. | PostgreSQL, Redis, BullMQ, canal y proveedor E2E. |
| `DEC-02` | Finanzas, Technology y Servicios profesionales permanecen presets horizontales. | Product policy compartida y copy del landing. | CRM/RAG/agenda sin prometer lifecycle de dominio. | Definir objetos, permisos, assurance y conectores por dominio. |
| `DEC-03` | `otro` queda como fallback; builder separado, declarativo y versionado. | `vertical-builder-contract.ts` valida schema bounded y genera preview/tests. | `applySupported:false`; nunca modifica un tenant. | Motor de migración, permisos, rollback y aprobación. |
| `DEC-04` | Agent Test sigue siendo preview seguro; sandbox efímero es producto separado. | `ephemeral-agent-sandbox.ts` define namespace, TTL, deadline, stubs, teardown y detección de residuos. | El endpoint actual conserva `persistence:disabled`. | Provisionador real de DB/Redis/colas efímeras y E2E. |
| `DEC-05` | Widget formal como `web_widget`, habilitado por capability. | Policy cerrada, revalidación en gateway y contención en conversaciones. | Conversación automática disponible; handoff bloqueado sin entrega humana verificable. | Adapter humano bidireccional y pruebas de canal real. |
| `DEC-06` | Política por kind para ActiveObjects. | Registry exhaustivo de 22 kinds y filtro antes del prompt. | Objetos no sensibles bounded; claims/casos/clínica/finanzas/legal tool-only A2. | Ampliaciones requieren política y pruebas de no divulgación. |
| `DEC-07` | Lineage + freshness + eval por outcome antes de NBA; media bajo consentimiento. | Gate común usado por NBA de conversación/CRM y policy de media. | NBA falla cerrado sin certificación; metadata inline no otorga autoridad; hoy todo procesamiento multimodal falla cerrado porque runtime aún no aporta consentimiento/retención server-authoritative. | Eval real-model vigente y registry server-authoritative de consentimiento/retención. |
| `DEC-08` | Matriz formal A0–A4. | `ASSURANCE_LEVEL_MATRIX` compartida y enforcement central. | A2 step-up, A3 confirmación/operación sensible y A4 aprobación humana. | Evidencia E2E de OTP/approval en verticales reguladas. |
| `DEC-09` | Controles antes del switch, con ledger durable. | `ToolExecutionControlService`, `ToolApprovalWorkflowService`, ToolPolicy y tests adversariales. | Idempotencia ligada a tenant/contacto/conversación/tool/args; confirmación por turno; A4 lista, notifica, decide y reanuda una sola vez. Inbound posterior invalida en el mismo CAS y un lease vencido exige reconciliación, nunca retry ciego. | PostgreSQL real con carreras/crash y operación humana en dashboard. |
| `DEC-10` | Contrato de pago provider-neutral y ledger interno. | `PaymentOperationService`, tools A3/A4 y tablas de operación. | Ownership debe devolver y persistir referencia canónica; sólo ésta llega al provider. Sin adapter explícito se registra/hace handoff; no se simula cobro exitoso. | Seleccionar adapter, webhook firmado, conciliación y sandbox financiero. |
| `DEC-11` | Moneda operativa explícita, lineage por línea y FX snapshot. | Migración Prisma, `OperatingCurrencyService` y `money_lineage`. | El boundary bloquea la moneda tras su primer ledger; no relabela ni suma monedas ambiguas. | Adoptarlo en cada writer, política comercial de FX y migración histórica. |
| `DEC-12` | Cinco contratos temporales/capacidad separados. | `TemporalCapacityContractService` y guard transaccional de capacidad con advisory locks. | La creación manual, pública e IA exige rango y servicio activos, serializa por servicio/staff y revalida cupo dentro de la transacción; `open` ambiguo se rechaza. | Llevar el mismo writer canónico a update/reschedule y series recurrentes; migrar los demás modelos y datos legacy. |
| `DEC-13` | Staff, user, location, calendar y resources son entidades ligadas explícitamente. | `StaffOperationsModelService`, `assertActiveTenantUser` y tablas de bindings/resources. | Writes y lecturas de agenda quedan tenant-scoped; el usuario dueño de disponibilidad se traduce por binding al perfil staff y nunca por igualdad accidental de UUID. | UI administrativa y backfill validado para retirar la compatibilidad legacy. |
| `DEC-14` | Owner/provider/event/revision + outbox de calendario. | `CalendarSyncOutboxService`, owner canónico, OAuth state one-time y worker idempotente. | Escritura de dominio separada del proveedor; MSAL/cache queda aislado por cuenta; FreeBusy usa el día/zona del tenant; agotamiento o ambigüedad pasa a `reconciliation_required`, nunca a fallback de cuenta. | UI/cola operativa para reconciliación manual, workflow delete/upsert de reasignación, sandbox Google/Microsoft y chaos post-commit. |
| `DEC-15` | Migración vertical permanece bloqueada; preview durable primero. | `VerticalMigrationService`, archive/outbox y `mappingCoverage`. | `applySupported:false` mientras no exista adapter de mapping completo. | Implementar y certificar adapter versionado por par origen/destino. |
| `DEC-16` | Registro positivo versionado para claims visibles; denylist semántica secundaria. | `marketing-claims.ts`, política pública compartida, marcadores `data-claim-id`, validación de locales/planes/JSON-LD y build estático. | Claims registrados fallan cerrado si evidencia vence o falta; el catálogo de canales declara disponibilidad por plan; marketing profundo permanece oculto para las 18 verticales no certificadas. | Ampliar el registro positivo a toda superficie narrativa nueva y conservar revisión humana del HTML/JSON-LD renderizado. |
| `DEC-17` | Benchmark con fuente, fecha, región/tier, madurez y test interno por vertical. | `vertical-competitive-evidence.json` y validador de 18 entradas. | El registro valida estructura, vigencia y cruce con la matriz; no demuestra por sí mismo el contenido remoto. | Snapshot/hash, revisor identificable y revalidación humana de fuentes antes de cada claim competitivo. |
| `DEC-18` | Gates distintos para PR, merge/nightly, weekly y release. | `vertical-quality.yml`, readiness snapshot y conversor JUnit. | Contract/static no puede marcar bootstrap/E2E como certificado; producción exige una atestación protegida, vigente, ligada al commit y con alcance exacto de las 18 verticales. El parser valida estructura, no la existencia remota de artefactos. | Corridas reales, revisión de URLs/digests, performance, chaos, rollback y canary. |
| `DEC-19` | Web Push aislado y hosts conocidos; Expo también bounded. | Worker con memory cap/deadline/response cap y transporte Expo con deadline/stream cap. | DNS/IP/host/payload/respuesta se validan; drip response se corta. | Staging malicioso controlado y proveedores push reales. |

## Fronteras que no deben reinterpretarse

1. `implemented_not_certified` no autoriza copy de paridad o profundidad total.
2. Los tres productos ancla son el orden de certificación, no un resultado certificado.
3. Builder vertical y migración vertical son previews separados; ambos tienen `applySupported:false`.
4. El sandbox efímero tiene contrato y runner aislado, pero aún no provisiona infraestructura real.
5. Widget no ofrece entrega humana hasta existir adapter bidireccional verificable.
6. A4 nunca se satisface por texto del usuario: requiere ticket humano durable y vigente.
7. Ninguna operación de pago se declara exitosa sin adapter, ownership y conciliación.
8. Una variable o JSON de readiness no sustituye evidencia: los revisores del environment deben verificar los artefactos y ambientes reales.
9. El writer canónico de creación no autoriza declarar reschedule o recurrencias atómicos: esas dos rutas conservan gate explícito hasta adoptar el mismo lock/recheck.

## Paquete mínimo para promover una vertical

Una de las tres anclas solo podrá cambiar a `certified` cuando el artefacto de release incluya, como mínimo:

- versión de product policy, manifest, prompt, ToolPolicy, modelo y seeds;
- bootstrap PostgreSQL del subtipo/plan/locales cubiertos;
- Redis/BullMQ con carreras, reintentos y rollback;
- canal y proveedor sandbox con webhooks/reconciliación;
- pruebas de ownership, assurance, confirmación e idempotencia;
- eval de grounding, abstención, selección de tool, safety e idioma;
- performance, chaos, rollback y canary aprobados;
- JUnit, snapshots y trazas retenidos por CI.

Hasta entonces, la salida correcta del programa sigue siendo **contrato estático 1.520/1.520 y certificación E2E 0/18**.

## Evidencia local del corte

- gate contractual actualizado: **42/42 suites, 337/337 pruebas, 0 snapshots**;
- TypeScript: shared, API, dashboard y WhatsApp **PASS**; ESLint API completo **PASS**;
- matriz contract/static: **1.520/1.520**, con `bootstrapCertified:false`;
- claims: 18 verticales, `es/en/pt/fr` + `es-AR`, cuatro fixtures negativos y evidencia competitiva **PASS**;
- landing: build/export **PASS**, 34/34 páginas y 2/2 artefactos exportados;
- Prisma, YAML, scripts JS/CJS, shell y `git diff --check`: **PASS**.

Esta evidencia es local y code-backed. No sustituye PostgreSQL/Redis/BullMQ reales, sandbox de canales/proveedores, eval de modelos, performance, chaos, rollback, canary ni aprobación de release; por eso la certificación permanece en **0/18**.
