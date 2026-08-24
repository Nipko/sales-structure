# Cierre autoritativo de la intervención vertical — 23 de agosto de 2026

## 1. Dictamen

La intervención interna quedó **cerrada y verificada localmente para el alcance declarado en el ledger** de los perfiles `build` y `hybrid`: el ledger ejecutable no reporta trabajo de código abierto y el sello agregado de pruebas, tipos, builds, lint y workflows de esta tanda quedó verde con resultados observados en la sección 6. El ledger reconcilia las alertas registradas; no sustituye una nueva auditoría de mercado ni puede descubrir una omisión que nunca se declaró. Esto **no** significa que 54 subtipos estén certificados en producción ni que las 18 verticales hayan alcanzado paridad comercial con sus benchmarks. Significa algo más preciso: las brechas históricas registradas que dependían únicamente del repositorio tienen contrato ejecutable y regresión verde; lo que queda está clasificado como decisión, revisión experta, evidencia de proveedor, migración/preflight de producción o piloto.

No se debe volver a convertir una dependencia externa en “código incompleto”. Tampoco se debe usar este cierre para activar writers externos, migrar taxonomías o publicar claims de certificación sin cumplir la cola final de este documento.

Fuentes autoritativas:

- Registro de perfiles: `packages/shared/src/subtype-experience-profile.ts`.
- Manifiesto de capacidades: `packages/shared/src/vertical-capability-manifest.ts`.
- Ledger derivado: `apps/api/src/modules/verticals/native-backlog.ts`.
- API y panel de auditoría: `apps/api/src/modules/verticals/vertical-audit.controller.ts` y `apps/dashboard/src/app/admin/vertical-audit/page.tsx`.
- Plan que originó la intervención: [plan maestro](./vertical-full-implementation-plan-2026-08.md).
- Plan de ejecución posterior a las decisiones: [plan definitivo](./vertical-approved-implementation-plan-2026-08-24.md).
- Historial de ejecución: [log de implementación](./vertical-implementation-execution-log.md).

## 2. Contabilidad exacta del ledger

El ledger cubre los 54 perfiles cuya estrategia actual es `build` o `hybrid`. Deriva cada alerta desde los registros que ejecuta el producto; no altera la alerta histórica y no posee un cajón genérico `needs_review`.

| Métrica | Resultado | Interpretación |
|---|---:|---|
| Perfiles auditados | 54 | Solo `build` + `hybrid`; no incluye perfiles detenidos por definición de producto. |
| Alertas históricas | 260 | Unidades de auditoría, no 260 features ni 260 bloqueos. |
| `open` | **0** | No queda trabajo de código identificado por este ledger. |
| `stale` | 82 | La alerta interna quedó obsoleta porque hoy existe evidencia verificable. |
| `external_gate` | 140 | La parte interna está verificada; falta evidencia real de SOR, pagos o E2E. |
| `decision_gate` | 17 | Decisiones heredadas de alertas `STOP`/`MISCLASS` en 14 perfiles auditables. |
| `expert_gate` | 21 | Revisión experta o legal; el código no puede certificar una jurisdicción. |
| Gates internos verificados | **222** | Incluye la mitad interna de los 140 ítems mixtos. |
| Gates internos abiertos | **0** | `profilesWithOpenCode` es una lista vacía. |

La suma de estados es `82 + 140 + 17 + 21 = 260`. La suma de responsabilidades coincide: 82 internas, 140 mixtas, 17 de decisión y 21 externas/experto.

Qué significa cada estado:

- `stale`: el hallazgo original fue real, pero ya no describe el código actual.
- `external_gate`: el contrato, policy o riel existe; aún se necesitan credenciales, sandbox, sistema real, transacción o piloto para demostrarlo.
- `decision_gate`: no se puede retirar una contención histórica sin una respuesta de producto trazable.
- `expert_gate`: ninguna prueba de software reemplaza la revisión de un especialista del rubro o de la jurisdicción.

## 3. Alcance implementado

| Dimensión | Estado interno | Evidencia principal |
|---|---|---|
| Identidad 1:1 del subtipo | Registro único, aliases canónicos, estrategia, alcance, exclusiones y disponibilidad comercial. | `subtype-experience-profile.ts`, `vertical-capability-manifest.ts`, `vertical-identifiers.ts`. |
| Contrato efectivo del agente | Intersección de perfil, agente, plan, canal, readiness, proveedor, subpermisos y autoridad antes de ejecutar. Revalidación de confirmaciones y aprobaciones contra el snapshot vigente. | `turn-capability-composer.service.ts`, `effective-capability.service.ts`, `ai-tool-executor.service.ts`. |
| Prompts, variables y herramientas | Contrato de dominio por perfil, terminología, intents, slots, límites y Active Objects; writers con policy, ownership, assurance, confirmación e idempotencia. El `toolPlan` autoral se proyecta en cada turno contra las tools realmente publicadas y expone `runtimeToolPlan`, `missingTools` y `runtimeStatus`; el ejecutor sigue siendo la autoridad default-deny. Es orientación estructurada para el LLM, no una máquina de estados determinista. | `vertical-subtype-persona-contract.ts`, `vertical-turn-context.service.ts`, `prompt-assembler.service.ts`, `tool-policy-registry.ts`, `ai-tool-executor.service.ts`. |
| Lenguaje y país | Packs versionados, normalizador determinista de confirmación/opt-out/handoff y formatos regionales. El reconocimiento acepta aliases del país y la generación recibe `preferredTerms` y `prohibitedRegisters`; los packs siguen sujetos a validación cultural. | `country-language-pack.ts`, `intent-normalizer.ts`, `regional-profile.service.ts`, `prompt-assembler.service.ts`. |
| Navegación y operación diaria | Menús por importancia y clasificación; registros operativos separados del catálogo. En turismo, Reservas/estadías es acceso directo y Propiedades permanece como catálogo/recurso. | `navigation-semantics.ts`, `navigation-contract.ts`, manifiestos y rutas `/admin/stays`, `/admin/tours`, `/admin/cases`. |
| Profundidad nativa | Writers, superficies, readiness y pares lectura→commit para las alertas internas; capacidad atómica en agenda, hogar, tours, alojamiento, cursos, clases, alquiler, guardería y fotografía. | `native-backlog.ts`, contratos de capacidad y servicios verticales. |
| Fuente de verdad | Política `native`, `conditional_provider` o `provider_required`. Un perfil condicional conserva su operación nativa hasta que exista binding explícito; un recurso mapeado a proveedor falla cerrado ante conflicto. | `packages/shared/src/system-of-record-policy.ts`, `modules/integrations/system-of-record-boundary.service.ts`, `modules/channel-manager/lodging-source-of-truth.service.ts`. |
| Integraciones | Configuración provider-neutral, secretos cifrados, health/freshness, sync con revisión y desplazamiento de writers solo cuando corresponde. Los writers externos permanecen bajo allowlist. | `vertical-integrations.service.ts`, `integration-health.ts`, adaptadores/sync de proveedor. |
| Auditoría y trazabilidad | Panel de auditoría code-backed y trazas de turno sin valores sensibles: contexto, contrato, origen/efecto de tools y resultado operativo. | `vertical-audit.controller.ts`, `turn-trace-context.ts`, módulo `trace`. |
| Resiliencia transversal | Reintento y re-drive acotado de inbound, dedupe de media/historial, drenaje de API alineado con el turno, adquisición durable, WhatsApp multi-número, cobertura de token, factura `blocked_config` recuperable y almacenamiento hot/cold atribuible/purgable. | Módulos `inbound`, `conversations`, `auth/onboarding`, `whatsapp`, `fiscal`, `media` y `offboarding`. |

### 3.1 Cierres de endurecimiento de la última tanda

Estos cierres están presentes y verificados en el worktree. La columna “cierre interno” describe el contrato implementado; **no** declara que se haya desplegado, migrado producción, ejecutado el CI remoto o certificado un proveedor.

| Frente | Cierre interno presente | Evidencia contractual |
|---|---|---|
| Reservas nativas de alojamiento | Fechas estrictas, `checkout > checkin` y serialización por recurso con advisory lock, relectura `FOR UPDATE`, conflicto e inserción dentro de una sola transacción. Hostaway/Guesty continúan fail-closed. | `channel-manager-reservations.spec.ts`. |
| Ownership / System of Record | Un binding durable decide el ownership; una caída de health no reabre writers locales ni crea dos calendarios. La supresión se mantiene incluso si un proveedor allowlisted aún no tiene adapter certificado. | `lodging-source-of-truth.spec.ts`, `system-of-record-boundary.spec.ts`, `system-of-record-capability.spec.ts`. |
| Outbox e inbox de integración | Claim token, generación y lease con compare-and-set protegen cada transición; un worker con lease vencido no puede completar ni reintentar trabajo reclamado por otro. | `integration-outbox.worker.spec.ts`, `integration-webhook.worker.spec.ts`, `integration-scaffolding.spec.ts`. |
| Secretos tenant | Channel Manager, integraciones verticales, MCP, e-commerce y Slack usan cifrado por tenant/AAD; las respuestas enmascaran, `***` conserva el valor y el cutover puede rechazar plaintext. El migrador cubre las mismas listas que el runtime. | `tenant-secret-migration.spec.ts`, `channel-manager-secrets.spec.ts`, `vertical-integrations.credentials.spec.ts`, `mcp-secrets.spec.ts`, `ecommerce-secrets.spec.ts`, `slack-secrets.spec.ts`. |
| Frontera genérica de `settings` | El endpoint genérico solo acepta las preferencias inocuas declaradas; ramas con dueño —credenciales, billing, SAML, flags, fiscal, verticales y operación— se rechazan en vez de fusionarse o borrarse accidentalmente. | `tenant-settings.util.spec.ts`, `tenants.controller.spec.ts`, `tenants.service.spec.ts`. |
| Claves BI | `/bi-api/*` valida una clave hasheada, activa, revocable, del tenant activo y con scope `read:analytics`; ya no autoriza desde `settings.biApiKey`. Existe migrador CAS que nunca imprime el secreto. | `bi-api.guard.spec.ts`, `bi-api-key-migration.spec.ts`. |
| Aislamiento `TenantGuard` | Se validan `tenantId` de ruta y query, se rechazan arrays, UUID inválidos, conflicto ruta↔query y acceso cross-tenant; el tenant efectivo se fija en el request. | `tenant.guard.spec.ts`. |
| Writers CRM concurrentes | Crear lead, oportunidad y tarea usa bloqueo transaccional y relectura idempotente; dos ejecuciones simultáneas no producen objetos duplicados. | `crm-writer-concurrency.spec.ts`, `crm-writers.spec.ts`. |
| Atribución de signup | La fuente/UTM durable del usuario prevalece sobre payloads de onboarding; el cliente no puede reatribuir la adquisición. El backfill evita super admins y registros sin origen. | `auth-onboarding-provisioning.spec.ts`, `signup-attribution-migration.spec.ts`, `signup-attribution.util.spec.ts`, `apps/dashboard/src/lib/signup-attribution.spec.ts`. |
| Seguridad de trazas | Roles y pertenencia/asignación controlan lectura; contexto, pasos, claves, arrays y strings se acotan; emails, teléfonos, IPs, tokens, credenciales y mensajes de excepción se redactan antes de persistir. | `trace.controller.spec.ts`, `turn-trace-context.spec.ts`. |
| Integridad de solicitudes de servicio | `service_requests.service_id` queda con FK y `ON DELETE RESTRICT`; los huérfanos heredados se reparan de forma trazable y un servicio con historia operacional devuelve conflicto tipado al intentar borrarlo. | `services.service.integrity.spec.ts`, migración/DDL del schema tenant. |
| Invalidación SoR de alojamiento | La caché usa una generación Redis por tenant; un remapeo hace inalcanzable inmediatamente la generación anterior y una resolución tardía no puede repoblarla como vigente. | `lodging-cache-invalidation.spec.ts`, `channel-manager-mapping.spec.ts`. |
| Operación de outbox/inbox | `/admin/ops/integrations` permite revisión global `super_admin` sin exponer payloads. Un registro durable global se actualiza atómicamente al encolar y permite que los workers consulten solo tenants con trabajo, sin barrer toda la base. | `integration-outbox-review.contract.spec.ts`, `integration-scaffolding.spec.ts`, workers de integración. |
| Contrato analítico de canales | Web Chat (`web_widget`) participa en volumen, CSV y BI junto con los cuatro canales conversacionales previos. SMS permanece fuera por diseño y Email queda pendiente de decisión de producto. | `dashboard-analytics.channels.spec.ts`, `dashboard-analytics.service.ts`. |
| Gate de promoción | Calidad y deploy cubren las **47 specs nuevas observadas** y conservan vacío `INTEGRATION_WRITE_PROVIDERS` mientras no exista un adapter certificado. API, dashboard y WhatsApp fallan además ante errores de lint. | `.github/workflows/deploy.yml`, `.github/workflows/vertical-quality.yml`; evidencia en sección 6. |

Límites honestos del alcance:

- Los 15 packs de país siguen en estado `draft`; código integrado no equivale a validación cultural.
- Los contratos de dominio/evals deterministas no equivalen a evidencia contra un modelo, tenant, canal o proveedor reales.
- La existencia de un adapter o worker no prueba que la versión de API de un tercero esté certificada.
- El sello local verde no sustituye un run verde del CI remoto, su PostgreSQL/Redis efímero ni la evidencia de producción.
- No se declara que migraciones de producción, cutover de secretos, deploy, canary o pilotos hayan sido ejecutados.

## 4. Los 17 `decision_gate` auditables

> **Actualización del 24 de agosto de 2026:** las 34 decisiones del dueño —incluidos estos 17 gates, los siete perfiles `strategy: stop`, ocho decisiones transversales y dos de mercados/locales— fueron cerradas en el [registro de decisiones de producto](./product-decision-ledger-2026-08-24.md). Esta sección conserva la cola que originó la decisión; el alcance aprobado y sus condiciones de implementación se leen en el registro nuevo. Las revisiones expertas, culturales, de proveedor y piloto continúan abiertas.

Estos 17 gates pertenecen al ledger de los 54 perfiles `build/hybrid`. Son 17 alertas en 14 perfiles; **no son las decisiones de los siete perfiles cuya estrategia runtime sí es `stop` y que aparecen en la sección 5.1**. Algunos perfiles `build/hybrid` conservan una alerta histórica `STOP` aunque no tengan estrategia `stop`. La decisión requerida es retirar formalmente la alerta/contención o redefinir el alcance, no asumir que una etiqueta histórica bloquea por sí sola el runtime.

| Perfil | Gates | Decisión auditable pendiente |
|---|---|---|
| `salud/farmacia` | `STOP` | Confirmar el límite comercial entre OTC/pedidos y dispensación regulada. |
| `automotriz/taller` | `STOP`, `MISCLASS` | Confirmar que el producto liviano cubre taller y fijar el objeto `repair order` sin prometer DMS/diagnóstico. |
| `automotriz/alquiler` | `STOP` | Aprobar el alcance nativo de disponibilidad, elegibilidad, depósito, contrato y daños. |
| `turismo/agencia_viajes` | `STOP`, `MISCLASS` | Definir agencia/intermediación frente a tour operator y el ownership de itinerario/cotización. |
| `education/online` | `STOP` | Delimitar coordinación/venta frente a LMS, progreso, evaluación y certificado. |
| `servicios_profesionales/abogados` | `STOP` | Aprobar captación/coordinación sin ejercer asesoría ni sustituir matter management. |
| `servicios_profesionales/contadores` | `STOP` | Aprobar coordinación documental sin ejecutar criterio fiscal/contable. |
| `servicios_profesionales/consultores` | `STOP` | Delimitar CRM/propuesta frente a proyecto, staffing, tiempo y rentabilidad. |
| `technology/saas` | `STOP` | Delimitar venta/soporte frente a entitlement, billing y acciones administrativas. |
| `servicios_hogar/fumigacion` | `STOP` | Aprobar alcance con licencia, químicos/lotes, recurrencia y compliance explícitos. |
| `servicios_hogar/cerrajeria` | `STOP` | Definir verificación de autoridad antes de dispatch o acceso. |
| `pet_services/guarderia` | `STOP` | Retirar o mantener la contención histórica ahora que existe capacidad/writer, previa revisión de requisitos. |
| `pet_services/hotel` | `STOP` | Ídem para noches, alimentación, medicación, contrato y depósito. |
| `fotografia/producto` | `STOP`, `MISCLASS` | Confirmar si sigue como fotografía o migra a un flujo DAM/producción comercial. |

## 5. Cola FINAL de toma de decisiones y evidencia

> **Estado vigente:** la toma de decisiones del dueño está cerrada 34/34 en el [registro del 24 de agosto](./product-decision-ledger-2026-08-24.md). Las tablas de decisiones siguientes son el inventario histórico previo al acta y no deben volver a tratarse como preguntas abiertas. La cola vigente comienza en revisión experta, proveedores, taxonomía/migración, packs de país y pilotos.

Esta es la única cola posterior al cierre interno. Su orden evita construir sobre una taxonomía equivocada o encender una integración sin evidencia.

### 5.1 Decisiones fundamentales de producto

| Prioridad | Tipo | Decisión | Por qué no se resuelve con más código |
|---:|---|---|---|
| 1 | Taxonomía/producto | `finanzas/fintech`: elegir familia concreta —pagos, wallet, remesas, neobanco, inversión u otra—. | Cada familia cambia ledger, regulación, KYC/AML, disputas, tools y benchmark. El perfil sigue `strategy: stop`. |
| 2 | Taxonomía/producto | `retail/marketplace`: definir merchant of record, modelo multi-vendedor, KYB, comisión, payouts y disputas. | Reusar e-commerce monovendedor generaría órdenes que no se pueden liquidar. Sigue `strategy: stop`. |
| 3 | Taxonomía/producto | `fotografia/wedding_planner`: crear/migrar a Event Planning o rechazar esa familia. | Cambia industria, objeto primario, proveedores, invitados, budget, timeline, datos y conteo canónico. Sigue `strategy: stop`. |
| 4 | Taxonomía/producto | `inmobiliaria/construccion`: separar promotor/venta de proyecto de contratista/obra. | Son compradores, objetos, ciclos, menús y SOR distintos; `business_model` debe preceder la migración. Sigue `strategy: stop`. |
| 5 | Alcance/integración | `technology/consultoria_ti`: elegir mesa de servicio MSP o consultoría por proyectos. | Ticket/SLA/activos/dispatch y scope/entregables/capacidad son productos con objetos y operación incompatibles. Sigue `strategy: stop`. |
| 6 | Alcance/integración | `seguros/aseguradora`: mantener solo capa conversacional integrada o definir el PAS/core autorizado. | Underwriting, billing, claims, reservas y reaseguro requieren autoridad y sistema de registro de carrier; Parallly no puede asumirlos nativamente. Sigue `strategy: stop`. |
| 7 | Alcance/integración | `seguros/salud`: definir core de pagador, verificación reforzada y alcance permitido sobre PHI. | Sin fuente viva de elegibilidad, autorizaciones y EOB no existe una respuesta operativa correcta. Sigue `strategy: stop`. |
| 8 | Alcance comercial | Resolver los 17 gates de la sección 4 con acta por perfil. | El ledger puede mostrar la contradicción histórica, pero no aprobar alcance comercial. |
| 9 | Política transversal | Verificación de correo: bloquear provisión completa o conservar verificación progresiva. | Hoy existen rescate, banner y gates en acciones sensibles; la fricción/riesgo aceptable es una decisión del dueño. |
| 10 | Producto retirado | Mantener retirado SMS reseller o reabrirlo como producto. | Mientras está apagado no hay fuga activa. Reabrir exige política fiscal, precio mínimo/margen, callback final, join por SID y refund selectivo. |
| 11 | Analytics multi-cuenta | Mantener el agregado por `channel_type` o añadir drill-down, filtro, CSV y BI por `channel_account`. | El agregado actual es correcto para el total del canal, pero deliberadamente colapsa dos conexiones del mismo tipo; la granularidad comercial deseada es una decisión de producto y privacidad. |
| 12 | Alcance de Email | Mantener Email como adapter inbound interno fuera del pivot conversacional certificado o convertirlo en canal tenant self-service con configuración, soporte y analytics propios. | Hoy no existe contrato de configuración tenant que sostenga esa promesa. Incluirlo en el pivot antes de resolver el producto produciría una superficie aparentemente operativa que no lo es. |
| 13 | Orquestación de intents | Conservar el `toolPlan` declarativo proyectado contra runtime, con LLM guiado y ejecutor default-deny, o financiar un planner/FSM determinista. | El runtime actual hace visible qué parte del plan está disponible y bloquea escrituras no autorizadas; no garantiza por máquina el orden completo de una intención. Cambiar de arquitectura exige criterios de estado, recuperación y UX. |
| 14 | Reloj de Channel Manager | Mantener `syncInterval` por tenant como riel separado o unificarlo con el registro común de freshness/telemetría. | Ambos contratos son coherentes por separado; unificarlos cambia configuración, alarmas y semántica de frescura, no corrige un defecto de seguridad vigente. |
| 15 | Binding de proveedor | Conservar desplazamiento conservador por proveedor/tenant o exigir binding por recurso/sede antes de certificar escenarios mixtos. | La granularidad correcta depende de cómo cada proveedor representa propiedades, sedes, agendas y ownership; sin ese mapping, el comportamiento seguro es desplazar de más, no escribir en dos SOR. |
| 16 | Disponibilidad Mindbody | Permitir agenda espejada con `asOf`/stale explícito o exigir consulta de cupo en vivo antes de prometer disponibilidad. | El espejo puede demostrar que la clase existe, no que todavía conserva cupo. La decisión comercial necesita evidencia de API/sandbox y tolerancia de frescura. |

### 5.2 Revisión experta

- Resolver los 21 `expert_gate` `REG` con especialista del rubro y, cuando aplique, asesor por jurisdicción. La salida debe ser una policy y eval versionados; no un comentario informal.
- Revisar los 60 perfiles que todavía heredan terminología de industria (16 de 76 tienen autoría propia). Heredar no es un defecto mecánico, pero tampoco prueba que el vocabulario sea 1:1.
- Validar los 15 packs `draft` con hablante nativo/corpus y tenants del país antes de promoverlos a `pilot` o `certified`.
- Elegir y validar política de locale para Estados Unidos/Canadá y para países reconocidos por backend pero no comercializados.
- Revisar por subtipo la matriz proveedor↔industria y definir cuándo el ownership debe bajar a recurso, propiedad, agenda o sede; la taxonomía del proveedor no se puede derivar con seguridad solo desde código.

### 5.3 Proveedores y sistemas reales

- Obtener credenciales sandbox, versión de API y certificación de Hostaway/Channel Manager.
- Aportar sandbox/credenciales para las olas posteriores: Toast, Mindbody, Cliniko y los PMS/DMS/PAS/core aplicables al perfil priorizado.
- Por cada binding real, validar mapeo, ownership, paginación, tombstones, freshness, reconciliación e idempotencia. Los 140 `external_gate` son gates de evidencia por perfil/alerta, no 140 conectores distintos.
- Para Mindbody, validar si la versión contratada expone cupo en vivo y no certificar `available` como dato live mientras solo exista el espejo con marca temporal.
- Para tenants con varias sedes/propiedades/cuentas, demostrar el binding por recurso antes de habilitar operación mixta; el desplazamiento tenant-wide permanece como contención segura hasta entonces.
- Aportar PSP/país/transacción de prueba para pagos de tenants. El gate fail-closed no demuestra liquidación, webhook ni conciliación real.
- Mantener `INTEGRATION_WRITE_PROVIDERS` vacío hasta certificar explícitamente cada proveedor/versión. No usar un health verde como permiso de escritura.

### 5.4 Rollout, migraciones y pilotos

- Aplicar primero las migraciones estructurales con el procedimiento normal de producción y verificar la migración global de atribución de signup y el DDL tenant, incluida la FK de `service_requests`; disponer backup y rollback antes de mutar datos.
- Desde `apps/api`, ejecutar `node scripts/migrate-tenant-secrets.js --dry-run`, revisar alcance y keyring, luego `--apply`; solo un `--cutover` con cero plaintext autoriza configurar `TENANT_SECRET_PLAINTEXT=reject`. Incluye Channel Manager, integraciones verticales, MCP, e-commerce y Slack. No se declara ese corte ejecutado aquí.
- Desde `apps/api`, ejecutar `npm run migrate:bi-api-keys -- --dry-run`, luego `--apply` y finalmente `--cutover`; confirmar que no quede `settings.biApiKey` y que cada integración BI conserva una clave activa con `read:analytics`. No se declara esa migración ejecutada aquí.
- Ejecutar dry-run de aliases/taxonomía únicamente después de resolver las decisiones de la sección 5.1; revisar diff, tenants afectados y rollback antes de `apply`.
- Ejecutar la matriz final con DB/Redis/colas reales, canal real, modelo real y sandbox de proveedor; adjuntar los nueve artefactos del [runbook de release](./vertical-release-runbook-2026-08.md).
- Pilotear con 3–5 tenants por perfil priorizado, primero en shadow/canary; medir outcome, handoff, error, latencia, duplicados y reconciliaciones.
- Obtener sign-off de producto, dominio, seguridad y operaciones. Solo entonces cambiar certificación, availability o claims competitivos.
- Preparar rollback por config/allowlist y no mezclar una migración taxonómica irreversible con el primer encendido de un proveedor.

## 6. Evidencia técnica y validación final

Sello final observado el 24 de agosto de 2026 sobre el worktree de la intervención iniciada el día 23:

| Validación | Resultado observado |
|---|---|
| Specs focales de endurecimiento | La tanda U69 pasó **22/22 suites, 179/179 pruebas**; las ampliaciones posteriores de SoR/outbox/analytics quedaron incluidas en la regresión completa final y en sus suites focales anotadas en el log. |
| Regresión completa API, sin `--forceExit` | **363 suites y 3.512 pruebas aprobadas**; 1 suite/10 pruebas omitidas de forma explícita por requerir PostgreSQL. El proceso cerró por sí solo, sin fuga reproducible. |
| Dashboard | **31/31 suites, 273/273 pruebas** y build verde de **143 rutas**. |
| WhatsApp | **3/3 suites, 13/13 pruebas** y build verde. |
| Mobile | **24/24 suites, 319/319 pruebas** y `tsc --noEmit` verde. |
| Shared/API/Landing | Builds verdes; landing validó claims para 18 verticales y generó **37/37 páginas**. |
| TypeScript | `shared`, API, dashboard, landing, WhatsApp y mobile sin errores, por `tsc` directo o el typecheck del build correspondiente. |
| Lint | API, dashboard y WhatsApp con **0 errores**. Se corrigieron los blockers encontrados y ambos workflows los ejecutan con `--quiet`; el dashboard conserva 285 advertencias no bloqueantes de higiene histórica. |
| Matriz/i18n | Matriz estática **1.560/1.560**; JSON ES/EN/PT/FR válidos. |
| Workflows | Ambos YAML parsean correctamente. Los dos cubren **47/47 specs nuevas observadas**. Cada lista API tiene **83 rutas únicas**, 0 inexistentes y 0 duplicadas, reconocidas **83/83** por Jest. `Vertical Quality` tiene 11 rutas dashboard y deploy 13, todas existentes, únicas y reconocidas **11/11** y **13/13** respectivamente; ambos tienen 2 rutas WhatsApp, existentes, únicas y reconocidas **2/2**. |
| Prisma | `prisma generate` y `prisma validate` verdes. |
| Higiene de diff | `git diff --check` sin errores; `deliverables/` se mantuvo fuera de la intervención. |

La suite omitida es `primary-pipeline.pg.spec.ts`: solo se activa con `RUN_PIPELINE_OWNERSHIP_PG_TESTS=1` y necesita PostgreSQL. Este equipo no tiene Docker, por lo que no se falsificó un resultado local; los workflows de calidad/deploy levantan PostgreSQL/Redis efímeros, aplican migraciones, ejecutan ese smoke, prueban compatibilidad del schema tenant y realizan un boot real. El run remoto sigue siendo evidencia obligatoria antes de promover.

Estado correcto: **cierre interno verificado localmente**. No equivale a deploy, migración de producción, certificación de proveedor, prueba E2E con canal/modelo real ni piloto.

## 7. Regla de reapertura

El programa se reabre como trabajo interno únicamente si:

1. `summariseNativeBacklogDetailed().internalGates.open` deja de ser cero;
2. aparece un perfil en `profilesWithOpenCode`;
3. una prueba contractual demuestra que el runtime no cumple el manifiesto; o
4. una decisión/expert review/proveedor produce requisitos nuevos aceptados formalmente.

Una credencial ausente, un sandbox no entregado, una revisión legal no firmada o un piloto no ejecutado mantienen su gate correspondiente; no convierten por sí solos el repositorio en “incompleto”.
