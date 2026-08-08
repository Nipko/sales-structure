# Ejecución consolidada de las Olas 0–5

**Sistema:** Parallly / Parallext Engine
**Corte técnico:** 8 de agosto de 2026
**Auditoría base:** [`vertical-system-audit-2026-08.md`](./vertical-system-audit-2026-08.md)
**Plan de certificación:** [`vertical-master-test-plan-2026-08.md`](./vertical-master-test-plan-2026-08.md)
**Detalle de contención:** [`wave-0-execution-2026-08.md`](./wave-0-execution-2026-08.md)
**Decisiones diferidas:** [`vertical-decision-register-2026-08.md`](./vertical-decision-register-2026-08.md)
**Matriz competitiva:** [`vertical-competitive-matrix-2026-08.md`](./vertical-competitive-matrix-2026-08.md)

## 1. Veredicto ejecutivo

El trabajo de análisis, contención y remediación transversal de las Olas 0–5 quedó consolidado en un **contrato operativo compuesto y versionado**: identificadores/aliases, capability manifest, definiciones verticales, ToolPolicy y contratos de planes/factory. El sistema reconoce **18 verticales, 75 subtipos y 76 configuraciones**, y la matriz estática verifica cada configuración en **4 idiomas y 5 planes: 1.520 escenarios aprobados, 0 fallidos**.

Esto no equivale todavía a certificar una vertical en producción. El estado correcto es:

- contrato estático canónico: **1.520/1.520 aprobado**;
- certificación E2E con PostgreSQL, Redis, BullMQ, proveedores, canales y modelos reales: **0/18**;
- bloqueadores de seguridad y consistencia de Ola 0: corregidos en código y cubiertos por regresiones focales;
- decisiones de producto o arquitectura: separadas del trabajo inequívoco y registradas al final del programa;
- despliegue: la matriz estática quedó conectada al job `validate` de CI, pero no reemplaza los gates de infraestructura.

La distinción es deliberada: `implemented`, `staticVerified` y `e2eCertified` son estados independientes.

## 2. Convención de estado

| Estado | Significado |
|---|---|
| **Implementado** | El cambio inequívoco está en código y tiene regresión focal. |
| **Contenido** | La superficie riesgosa se bloqueó o redujo de forma segura; ampliar el alcance requiere una decisión. |
| **Decisión** | Existen alternativas válidas con impacto de producto, datos, compliance o arquitectura; no se eligió silenciosamente. |
| **Gate externo** | Requiere infraestructura, credenciales, proveedores o modelos reales; un mock no certifica el resultado. |

## 3. Estado por ola

| Ola | Objetivo | Resultado del corte | Estado de certificación |
|---|---|---|---|
| **0** | Contención, tenant isolation, provisioning, outcomes, prompt, red, purge y verdad comercial | Los 12 P0 tienen remediación de código; readiness de lifecycle/auth es fail-closed; pipeline/outcomes y purge son transaccionales; XML y SSRF tienen defensas; Agent Test no escribe negocio | Gate externo pendiente; 0/18 |
| **1** | Contratos comunes de manifest, tools, contexto, identidad, widget, staff, automatización e integraciones | Manifest operativo v1, ToolPolicy de 90 tools, ActiveObjects, integration health, persona por goals, navegación subtype-aware, analítica 18/18 y contratos de moneda/duración | Varias expansiones quedan como decisión; 0/18 |
| **2** | Profundizar inmobiliaria, restaurantes, automotriz, turismo, education y gimnasios | Se corrigieron rutas, writes, moneda/duración, ETA, contexto activo, reservas, agenda, disponibilidad, reprogramación e invariantes | Falta E2E por vertical y proveedores reales |
| **3** | Profundizar salud, belleza, retail, veterinaria, seguros, hogar, pet services y fotografía | Assurance reforzado en seguros, ownership, moneda, claims, citas, operaciones y analítica; los dominios sensibles no se preinyectan sin política | Decisiones de assurance, pagos y modelos de capacidad pendientes |
| **4** | Replantear finanzas, technology, servicios profesionales y `otro` | Contratos, analítica y navegación ya no fallan por ausencia; no se inventaron toolsets profundos sin definir objetos y permisos | Profundidad funcional depende de decisión de producto |
| **5** | Diferenciación con IA y operación | Handoff estructurado con evidencia, contexto activo versionado, health de integraciones, outcomes explícitos y evaluación estática; guardrails y uso operacional reforzados | NBA, voz/multimodal, lineage completo y eval real-model siguen como programa evolutivo |

## 4. Cierre de los doce P0

| ID | Resultado implementado | Evidencia que aún certifica release |
|---|---|---|
| `P0-01` | `VerticalsController` usa JWT, roles y `TenantGuard`; UUID y pertenencia se validan | HTTP cross-tenant con cuatro roles y dos tenants |
| `P0-02` | Agent Test usa DTO estricto, límites, rate limit, cuota/tier/budget, sandbox identity, allowlist y `persistence: disabled`; contabiliza proveedor sin habilitar writers | Snapshot DB/Redis/colas/eventos y red stub/real permitida |
| `P0-03` | Resolución canónica por `(industry, subtype)`; no hay colisión global de `hotel` | Bootstrap DB de las 76 configuraciones |
| `P0-04` | Veterinaria 24/7 genera siete días válidos | Consulta de disponibilidad contra PostgreSQL real |
| `P0-05` | Floors de pipeline/servicios compatibles con plan y defaults quota-aware | Bootstrap de 76 × 5 planes |
| `P0-06` | Readiness de lifecycle/auth fail-closed, lock común con token/heartbeat, estado durable y activación final atómica. El readiness operativo del catálogo/checklist permanece advisory | Dos procesos/Redis/DDL con fallos inyectados |
| `P0-07` | Outcome terminal explícito, slug canónico, correlación durable por `deal_id`, writes y history en una transacción | Rollback PostgreSQL y KPIs reales 18/18 |
| `P0-08` | Escape XML único, saneamiento XML 1.0 y fuzz de campos dinámicos | Eval adversarial con modelos reales en 4 idiomas |
| `P0-09` | HTTPS, DNS público fijado con deadline, redirect/proxy bloqueados, allowlist, caps y deadline absoluto en rutas Axios | Servidor malicioso y cap/deadline de Web Push real |
| `P0-10` | Purge con preflight temprano, 12 colas, fences, cold archive, sesiones/tokens, fiscal lock y commit público final | Saga completa con PostgreSQL/Redis/BullMQ/proveedores reales |
| `P0-11` | Alta admin comparte catálogo, readiness, bootstrap y activación final del onboarding | UI/API/DB/billing/invitación E2E |
| `P0-12` | DTO/whitelist, aliases versionados y fallo explícito sin fallback a `otro` | HTTP legacy y migración auditada de datos históricos |

## 5. Estado de los P1

| ID | Estado | Resultado o frontera explícita |
|---|---|---|
| `P1-01` | **Implementado** | Contrato compuesto v1: identifier/alias contract, capability manifest, definiciones, ToolPolicy y factory-plan contract; la matriz verifica que sus proyecciones coincidan. |
| `P1-02` | **Implementado** | Registro estricto para `pet_services`, `servicios_hogar`, `fotografia` y los demás subtipos. |
| `P1-03` | **Implementado** | Alias `finanzas/seguros` converge a `seguros/broker`; combinaciones imposibles fallan cerradas. |
| `P1-04` | **Contenido** | Agent Test es preview seguro y honesto, no sandbox writer ni réplica E2E de Booking Engine. Crear ese sandbox es una decisión de producto/costo. |
| `P1-05` | **Implementado** | Agentes nuevos heredan capabilities efectivas desde manifest sin sobrescribir configuración explícita. |
| `P1-06` | **Contenido** | Widget quedó protegido por origen, DTO, token, readiness, rate/quota/tier/budget, mutex e historia correcta. Unificar writers, booking y entrega de handoff requiere definir su alcance de canal. |
| `P1-07` | **Implementado parcial** | `ActiveObjects v1` es seguro, acotado y compartido por producción/Agent Test; loaders actuales cubren appointments, properties, tours, orders y food orders con fallos aislados. Claims, casos y datos clínicos permanecen tool-only hasta decidir assurance. |
| `P1-08` | **Contenido** | El cambio directo de vertical está bloqueado con `vertical_migration_required`; preview/mapeo/rollback es una decisión de migración. |
| `P1-09` | **Contenido** | Reseed es aditivo e idempotente y preserva cambios del usuario; reconciliación destructiva/conflict policy requiere decisión. |
| `P1-10` | **Implementado** | Booking y rutas derivan capabilities efectivas, no el nombre de industria. |
| `P1-11` | **Implementado** | Catálogo/readiness/sidebar/tours/checklist resuelven por capability y subtipo, con fallback legacy explícito. |
| `P1-12` | **Implementado** | Analítica específica para las 18 verticales; distingue `ok`, `no_data`, `query_error`, `partial_error` y `unsupported`. |
| `P1-13` | **Implementado** | Trigger contract compartido, ejecución/cuota atómica y plantillas alineadas con slugs/eventos reales. |
| `P1-14` | **Implementado** | Persona determinista por vertical, subtipo y goals; matriz de 18/75/8 goals/4 idiomas. |
| `P1-15` | **Implementado** | Prompt ofrece acciones solo con capability/contexto efectivo y responde en el idioma del turno. |
| `P1-16` | **Implementado parcial** | OTP/identity fail-closed, ownership y minimización de PII; seguros/claims usan step-up. Extender niveles a salud, legal, pagos y documentos requiere política formal. |
| `P1-17` | **Implementado parcial** | Agenda de staff valida horarios/breaks/duración, usa writes atómicos y overlap correcto. Unificar `staff_members`, usuarios, recursos, sedes y UI administrativa requiere un modelo elegido. |
| `P1-18` | **Decisión** | No se agregaron payment/deposit/refund tools sin proveedor, aprobación, ledger e idempotencia definidos. |
| `P1-19` | **Implementado** | Integraciones usan health durable, scopes, frescura, errores sanitizados y estados fail-closed antes de exponer tools. |
| `P1-20` | **Implementado parcial** | Copy riesgoso y regresiones conocidas se corrigieron. La denylist actual no sustituye un registro positivo claim → capability → evidencia. |
| `P1-21` | **Implementado** | Ruta estática de búsqueda de vehículos precede a `:vehicleId`; regresión de metadata/precedencia. |
| `P1-22` | **Implementado sintáctico** | Writers validan/persisten currency y preservan lineage; no se relabelan importes. Moneda operativa/FX y agregados multimoneda son decisión. |
| `P1-23` | **Implementado sintáctico** | Toda duración seed es entera positiva; tours persisten valor+unidad. El paquete fin de semana y servicios `open` requieren un modelo semántico de días/capacidad. |

## 6. Lectura operacional de las 18 verticales

| Vertical | Base disponible y reforzada | Frontera antes de certificar |
|---|---|---|
| Salud | Servicios, citas, agenda, persona, pipeline y analítica | Assurance clínico, tratamientos/planes activos, EHR/PMS, consentimiento y pagos |
| Moda y belleza | Servicios/citas, staff, analítica y catálogo legacy | Cabinas/recursos, paquetes/membresías, POS, consumibles y comisiones |
| Inmobiliaria | Listings, visitas/citas vinculadas, contexto de appointment y analytics | Fuente MLS/portal viva, favoritos/alertas, crédito y owner explícito del calendario |
| Restaurantes | Menú/pedido atómico, moneda, ETA autoritativa y food orders activos | POS/KDS, modificadores/alérgenos, stock/pacing y delivery real |
| Automotriz | Inventario, búsqueda inequívoca, test drive/citas y analítica | VIN/DMS, reparación, trade-in, aprobaciones y pagos |
| Turismo | Tours/properties, reservas activas, duración/moneda y agenda | PMS/channel manager, rate plans, noches/impuestos, vouchers y proveedores |
| Education | Cursos/matrículas, duración, citas y analítica | Lifecycle applicant→student, documentos, SIS/LMS, pagos y permisos de menores |
| Finanzas | Manifest, CRM, agenda y analítica transversal | Toolset propio, productos/tasas versionados, KYC/AML, disclosures y approvals |
| Servicios profesionales | CRM, citas, case status, persona y analítica | Matter/project lifecycle, conflicto, firma, documentos, tiempos, retainer y assurance |
| Retail | Catálogo, inventario, orders, currency lineage y analítica | Checkout/payment link, tracking, devoluciones, loyalty y autorización de descuentos |
| Technology | CRM, knowledge, citas, handoff y analítica | Cuenta/entitlement, tickets/SLA, status/telemetría y redacción de secretos |
| Veterinaria | Mascotas, vacunas, agenda y siete días de disponibilidad para el subtipo `hospital_24h` | PIMS, resultados liberados, refill profesional, dosis prohibidas y depósitos |
| Gimnasios | Membresías/clases, duraciones, capacidad y analítica | Waitlist, créditos/cobro, freeze/upgrade, acceso, waiver y contexto de reservas |
| Seguros | Planes/cotización/póliza/claims, OTP/ownership y analítica | Carrier/FNOL, firma, licencia, renewal, documentos y pagos |
| Servicios del hogar | Requests, estimates con moneda, agenda y analítica | Workforce/dispatch, zonas, media, partes, factura/pago, garantía y rework |
| Pet services | Mascotas, citas, catálogo, subtype resolver y analítica | Boarding/daycare por rango, kennels, vacunas/medicación, paquetes y membresías |
| Fotografía | Quote fail-closed, sesiones/duración, agenda y analítica | Holds, contrato/depósito, milestones, gallery, releases y recuperación de sesiones |
| Otro | Manifest, catálogo, CRM, persona, pipeline y analítica | Decidir si permanece fallback o se convierte en vertical builder declarativo |

## 7. Evidencia automatizada relevante

Las cifras siguientes corresponden a lotes focales; no se suman porque varias suites fueron repetidas como regresión:

- matriz estática CLI: **1.520/1.520**, `bootstrapCertified: false`;
- pipeline/outcome/correlación: **71/71** en el núcleo focal y TypeScript aprobado;
- readiness/lifecycle: **49/49**;
- purge/fiscal/media/colas: **29/29**;
- Agent Test (DTO, rate, plan, usage, allowlist y cero writes de negocio): **31/31**;
- widget containment y regresiones: **23/23 + 17/17**;
- integration health: **31/31**;
- persona manifest/goals/inheritance: **48/48** en la carpeta persona;
- active context/prompt: **43/43 + 9/9** en sus lotes focales;
- handoff/assignment: **15/15**;
- vertical analytics: **13/13**;
- vehicle/restaurants/insurance: **9/9**;
- automation trigger/quota/templates: **12/12**;
- scheduling/reprogramación/calendario: **8/8 + 11/11 + 2/2**;
- moneda/duración: **18/18** nuevas + **18/18** de regresión;
- ToolPolicy/schema-runtime: 90/90 tools clasificadas y suites focales aprobadas; clasificación no equivale a enforcement: 37 tools reportan al menos un gap (23 idempotencia, 23 confirmación, 1 assurance y 1 aprobación humana);
- transporte seguro: **28/28** para sintaxis, IPs reservadas, DNS mixto/deadline, pinning y opciones Axios acotadas;
- verificación secuencial final **posterior a la recuperación del contrato shared**: shared TypeScript **PASS**, API TypeScript **PASS** y **62 suites API / 489 pruebas PASS** en cinco lotes disjuntos (contratos/matriz/handoff; Agent Test/ToolPolicy; lifecycle/purge/pipeline; verticales/persona/integraciones; automation/widget);
- superficies cliente: mobile TypeScript **PASS** y **2 suites / 196 pruebas PASS**; resolver dashboard **1 suite / 3 pruebas PASS**; nueve catálogos i18n modificados parsean correctamente;
- gates estáticos finales: matriz CLI **1.520/1.520 PASS** con `bootstrapCertified:false`; claims principal y cuatro regresiones negativas **PASS**;
- dashboard TypeScript: bloqueado únicamente por tres `TS2307` del módulo local ausente `onborda`; no se presenta como pase global;
- un intento concurrente anterior agotó heap; se reruneó secuencialmente con 8 GB. Un OOM se registra como limitación de ambiente, no como PASS/FAIL funcional.

Comandos canónicos:

```powershell
node apps/api/scripts/run-vertical-contract-matrix.cjs
node_modules\.bin\tsc.cmd -p packages/shared/tsconfig.json --noEmit --pretty false
node_modules\.bin\tsc.cmd -p apps/api/tsconfig.json --noEmit --pretty false
node apps/landing/scripts/validate-marketing-claims.cjs
```

El workflow `.github/workflows/deploy.yml` está **cableado** para ejecutar el control de claims y la matriz de 1.520 escenarios antes del typecheck/build. No se observó una corrida remota de CI en esta sesión. La salida estática jamás debe etiquetarse como bootstrap certificado.

## 8. Gates de certificación que no pueden simularse

1. Provisioning real con PostgreSQL y Redis: 380 escenarios base (76 × 5) y 1.520 localizados (76 × 5 × 4).
2. HTTP cross-tenant/RBAC con dos tenants y los cuatro roles.
3. Agent Test con snapshots de DB, Redis, BullMQ, eventos y red permitida.
4. Rollback real de pipeline, historial y outcomes; KPIs ganados/perdidos para las 18.
5. Purge con queues/producers en carrera, proveedores fallando, cold archive y fiscal lock.
6. DNS/redirect/rebinding/drip response/Web Push contra infraestructura maliciosa controlada.
7. E2E de cada acción primaria por vertical, en 4 idiomas y con plan mínimo/máximo.
8. Integraciones reales con scopes, expiración, rate limits, webhook, retry y reconciliación.
9. Concurrencia de reserva/reprogramación con DB y calendario reales.
10. Evaluación de modelos reales: grounding, abstención, tool selection, safety, idioma y handoff.

## 9. Criterio de cierre del programa

Una vertical pasa de `implemented` a `certified` solo si cumple el plan maestro y conserva un paquete de evidencia reproducible: versión de manifest/prompt/modelo, seed, ambiente, JUnit, snapshots, trazas, fallos inyectados y decisión firmada. Hasta entonces, el contador público y técnico permanece en **0/18**, aunque la base común ya esté significativamente reforzada.

## 10. Decisiones al final del programa

Las decisiones se mantuvieron fuera de las correcciones inequívocas. El registro final contiene 19 decisiones agrupadas por foco comercial, Agent Test/widget/IA, assurance/tools/pagos, moneda/tiempo/staff/calendario/migración y gobierno de claims/CI/red. Cada una incluye opciones, recomendación y lo que bloquea: [`vertical-decision-register-2026-08.md`](./vertical-decision-register-2026-08.md).
