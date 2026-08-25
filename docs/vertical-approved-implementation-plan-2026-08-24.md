# Plan definitivo de implementación vertical — posterior a decisiones

Fecha: 24 de agosto de 2026

Estado: ejecución autorizada. **Fases 1 y 2 implementadas en código el 24 de agosto de 2026. El inventario read-only de Fase 1 debe ejecutarse en producción antes de cualquier `apply` o migración; la promoción de Fase 2 conserva CI y Browser E2E como gate.**

## 1. Autoridad, objetivo y alcance

Este documento convierte las 34 resoluciones del [registro de decisiones de producto](./product-decision-ledger-2026-08-24.md) en un programa ejecutable. Sustituye como cola vigente las preguntas abiertas del [plan maestro original](./vertical-full-implementation-plan-2026-08.md), pero conserva de aquel documento la auditoría 1:1 de los 76 perfiles históricos y sus criterios de calidad.

Orden de autoridad para ejecutar:

1. este plan para secuencia, paquetes, gates y Definition of Done;
2. el registro P01–P34 para alcance aprobado y exclusiones;
3. el [cierre técnico](./vertical-intervention-status-2026-08-23.md) para conocer qué ya existe y qué sigue externo;
4. los registros compartidos y el runtime para la verdad code-backed;
5. el [runbook de release](./vertical-release-runbook-2026-08.md) para evidencia de promoción.

Objetivo final: que cada subtipo comercial tenga una experiencia defendible y cohesionada en taxonomía, menús, prompts, variables, templates, lenguaje, tools, fuente de verdad, permisos, objetos operativos, observabilidad y soporte regional; y que la plataforma no prometa una capacidad antes de demostrarla con el sistema real.

Este programa incluye:

- las nuevas taxonomías aprobadas;
- la intervención 1:1 de P01–P24;
- las decisiones transversales P25–P32;
- la política regional P33–P34;
- revisión experta y terminológica;
- integraciones, migraciones, pilotos, certificación y claims.

No incluye como autorización automática:

- habilitar writers externos;
- cambiar `strategy`, `availability` o claims en producción;
- migrar un tenant sin preflight y consentimiento cuando corresponda;
- declarar cumplimiento legal, cultural o de proveedor;
- sustituir los cores excluidos en el registro de decisiones.

## 2. Línea base que no debe reconstruirse

La implementación parte del código ya desplegado y de su cierre interno, no del estado que existía al comenzar la auditoría.

| Frente | Línea base disponible | Regla del plan |
|---|---|---|
| Registro de perfil | Perfil, estrategia, scope, availability, aliases, exclusiones y benchmark compartidos. | Extender a la taxonomía v2; no crear un segundo registro. |
| Contrato efectivo | Intersección de perfil, agente, plan, canal, readiness, proveedor, subpermisos y autoridad. | Toda capacidad nueva debe pasar por el mismo resolver y ejecutor default-deny. |
| Prompt | Contrato L1 + persona L2 + contexto estructurado L3 por turno. | Ningún subtipo crea un prompt paralelo ni pierde las invariantes universales. |
| Herramientas | Tool policy, ownership, assurance, confirmación, idempotencia y traza. | El manifiesto autoral no publica una tool que el runtime no pueda ejecutar. |
| SoR | Políticas `native`, `conditional_provider` y `provider_required`; bindings y fail-closed. | Una caída del proveedor nunca reactiva un writer local para el mismo objeto. |
| País | Packs, formatos, terminología, aliases de reconocimiento y normalizadores. | `draft` no equivale a certificado; país del tenant y lenguaje son ejes distintos. |
| Navegación | Semántica compartida, rutas operativas y clasificación catálogo/operación. | La tarea diaria precede al catálogo y la oportunidad CRM no suplanta el objeto operativo. |
| Auditoría | Ledger, panel de auditoría, trazas redactadas y estados tipados. | Cada fase debe producir evidencia visible, no únicamente tests aislados. |
| Integraciones | Scaffolding provider-neutral, secretos cifrados, outbox/inbox y health/freshness. | Los adapters reales y writers continúan apagados hasta certificación. |
| Producción | Código de intervención promovido con migración tenant compatible y health checks verdes. | Los nuevos cambios se entregarán en canary; no se mezclan con una migración irreversible. |

El ledger histórico de 54 perfiles `build/hybrid` cerró con `open=0`. Este plan solo reabre trabajo donde una resolución P01–P34 agrega o cambia requisitos, o donde falta evidencia externa. No se volverán a implementar como nuevas las reparaciones ya verificadas.

## 3. Catálogo objetivo y compatibilidad

### 3.1 Conteo objetivo

El catálogo objetivo tendrá **20 verticales y 76 configuraciones canónicas** (75 subtipos y `otro`). El registro resolverá además cinco IDs heredados necesarios para compatibilidad, por lo que el total técnico será de **81 IDs resolubles** y no debe confundirse con el conteo canónico. Los destinos nuevos permanecen en `waitlist`; canónico no significa comercializable.

Cambios sobre las 18 verticales y 76 perfiles históricos:

- sale `fotografia/wedding_planner` del catálogo activo y entra `event_planning/weddings`;
- `inmobiliaria/construccion` se divide en `inmobiliaria/promotora` y `construccion/contratista_general`;
- `finanzas/fintech` migra a `finanzas/pagos_recaudos`;
- `technology/consultoria_ti` migra a `technology/soporte_ti_msp`;
- `retail/marketplace`, `seguros/aseguradora` y `seguros/salud` conservan ID, pero reciben contrato y estrategia nuevos.

El resultado canónico es `76 - 5 + 5 = 76`: salen de la lista activa los cuatro IDs que requieren migración y `veterinaria/peluqueria_canina`, que ya era alias; entran cinco destinos correctos. Los cinco IDs anteriores siguen resolviendo solo por compatibilidad. Las dos verticales nuevas son `event_planning` y `construccion`.

### 3.2 Matriz de taxonomía aprobada

| P | ID heredado | ID canónico objetivo | Estrategia objetivo | Availability inicial | Regla de compatibilidad |
|---|---|---|---|---|---|
| P01 | `finanzas/fintech` | `finanzas/pagos_recaudos` | `hybrid`/provider-bound | `waitlist`, luego `pilot` | Alias/migración explícita; ninguna wallet, inversión, crédito o remesa se reclasifica automáticamente. |
| P02 | `retail/marketplace` | igual | `hybrid` + PSP marketplace requerido | `waitlist` | El ID resuelve, pero writers permanecen bloqueados hasta contrato seller/PSP. |
| P03 | `fotografia/wedding_planner` | `event_planning/weddings` | `build`/`hybrid` | `waitlist`, luego `pilot` | El ID viejo queda `legacy_only`; migración con vista previa, consentimiento y rollback. |
| P04a | `inmobiliaria/construccion` | `inmobiliaria/promotora` | `build`/`hybrid` | `waitlist`, luego `pilot` | Requiere `business_model=developer`; no existe alias único. |
| P04b | `inmobiliaria/construccion` | `construccion/contratista_general` | `hybrid` | `waitlist`, luego `pilot` | Requiere `business_model=contractor`; tenants híbridos usan dos espacios. |
| P05 | `technology/consultoria_ti` | `technology/soporte_ti_msp` | `hybrid` | `waitlist`, luego `pilot` | El legacy no se convierte en proyecto profesional ni en mesa de servicio sin clasificación. |
| P06 | `seguros/aseguradora` | igual | `integrate` | `waitlist` | Se publica solo con PAS/core, jurisdicción y revisión experta. |
| P07 | `seguros/salud` | igual | `integrate` | `waitlist` | Se publica solo con core de pagador, controles PHI y revisión experta. |

### 3.3 Regla de migración de identidad

Ninguna migración modifica simultáneamente taxonomía, datos operativos y activación de proveedor. El flujo será:

1. snapshot de perfil, agente, tools, menús, integraciones, objetos y métricas;
2. clasificación propuesta con razones y campos faltantes;
3. dry-run sin escritura y diff visible;
4. aceptación del tenant cuando el significado del negocio cambia;
5. backup y token de rollback;
6. migración idempotente de identidad/aliases;
7. shadow mode con writers todavía apagados;
8. verificación de datos, navegación, prompt y tools;
9. activación independiente mediante feature flag/availability;
10. auditoría y ventana de rollback.

`inmobiliaria/construccion` requiere migración multi-destino y, por tanto, no puede usar un `migratesTo` único. El contrato compartido deberá representar candidatos, `business_model`, estado de revisión y decisión confirmada.

## 4. Principios de ejecución

1. **Un solo contrato:** perfil, prompt, menú, tools, permisos, Agent Test, móvil y marketing se derivan de registros compartidos.
2. **Compatibilidad primero:** un ID, variable o secreto nuevo nunca rompe el valor productivo anterior; se usa precedencia `nuevo explícito → legacy compatible → default seguro`.
3. **Fail-closed:** ausencia de provider, binding, permiso, freshness, consentimiento o revisión produce motivo tipado y handoff, nunca una escritura alternativa silenciosa.
4. **Objeto operativo distinto del CRM:** oportunidad, reserva, pedido, ticket, póliza, obra, evento y reparación conservan IDs, labels, permisos y rutas propios.
5. **LLM como interfaz:** el modelo entiende y redacta; backend, workflow determinista y SoR autorizan estado y commits.
6. **País no es acento:** los packs reconocen variantes sin estereotipos y no convierten expresiones ambiguas en consentimiento.
7. **Una promoción por vez:** schema, migración de datos, adapter y claim comercial no se encienden en el mismo paso.
8. **Evidencia proporcional:** un test unitario prueba contrato interno; sandbox prueba proveedor; piloto prueba operación; experto prueba dominio/jurisdicción.
9. **Sin variables obligatorias sorpresivas:** el primer deploy de cada paquete debe arrancar con las variables actuales; nuevos secretos o flags son opcionales y seguros hasta cutover explícito.
10. **No degradar producción:** Browser E2E, CI de migración tenant, typechecks, lint, builds, health y rollback son gates de cada release.

## 5. Nueve fases y puertas de salida

| Fase | Resultado | Estado inicial | Puerta de salida |
|---:|---|---|---|
| 0. Decisión y baseline | 34 resoluciones, alcance, exclusiones y estado real fijados. | **Cerrada** | P01–P34 aprobadas; backlog externo separado; plan versionado. |
| 1. Taxonomía y preflight | Registro v2, IDs, aliases, clasificador y reporte de tenants afectados. | **Código cerrado; ejecución del inventario productivo pendiente** | 20 verticales/76 configuraciones canónicas y 81 IDs resolubles validados; 100% de tenants legacy clasificados o marcados para revisión; dry-run sin escrituras. |
| 2. Contratos compartidos | Tipos, schemas, resolvers, entitlements, availability y compatibilidad de configuración. | **Código cerrado; promoción sujeta a CI/Browser E2E** | Web/API/mobile/test/marketing consumen el mismo snapshot; cero fork paralelo. |
| 3. Autoría 1:1 y país | Prompts, variables, templates, términos, menús, tools, SoR y evals por perfil/locale. | **Código cerrado; revisión experta/país permanece fail-closed** | 76/76 paquetes canónicos completos y compatibilidad legacy validada; regulados no promocionados sin firma; cuatro idiomas base verdes. |
| 4. Plataforma transversal | P25–P32: identidad, analytics, canales, planner, freshness, binding y Mindbody. | Pendiente | Ocho decisiones demostradas E2E sin divergencia backend/UI/BI. |
| 5. Profundidad de producto | Nuevos objetos y workflows nativos/híbridos, más P08–P24. | Pendiente | Cada writer produce objeto visible, reversible e idempotente; task principal a ≤2 interacciones. |
| 6. Proveedores y regulación | PSP, ITSM, PAS/core, LMS/GDS/DMS/PMS y revisiones expertas. | Dependencia externa | Adapter/version/SoR certificados; 21 expert gates firmados; writers allowlisted individualmente. |
| 7. Migración y canary | Taxonomía/datos en shadow, tenants piloto, rollback y observabilidad. | Pendiente | Dry-run/apply verificable; cero migración silenciosa; métricas y conciliación dentro de umbrales. |
| 8. Certificación y escala | Claims, availability y expansión por perfil/país. | Pendiente | Piloto 3–5 tenants, nueve artefactos, sign-off y promotion record por perfil/país/proveedor. |

No existe salto válido de Fase 3 a Fase 8. Un perfil puede avanzar independientemente si sus dependencias están completas, pero los componentes compartidos de Fases 1–2 se estabilizan antes de abrir pilotos.

## 6. Paquetes de trabajo transversales

| WP | Fase | Entregable | Dependencias | Criterio de aceptación |
|---|---:|---|---|---|
| GOV-01 | 0 | Registro P01–P34 y este plan. | Ninguna | 34/34 resoluciones trazables. |
| TAX-01 | 1 | `SubtypeExperienceProfile` v2 y manifest para 20 verticales/76 configuraciones canónicas, más cinco IDs legacy. | GOV-01 | Conteo generado; IDs únicos; selector, landing y API coinciden. |
| TAX-02 | 1 | Clasificador y migrador multi-destino con `business_model`. | TAX-01 | Dry-run lista tenant, destino, razones, riesgos y rollback; no escribe. |
| TAX-03 | 1 | Inventario read-only de producción y owners de migración. | TAX-02 | Ningún legacy sin estado `candidate`, `needs_owner`, `approved`, `migrated` o `rejected`. |
| CTR-01 | 2 | Contrato compartido de disponibilidad/certificación por perfil, país y provider. | TAX-01 | Runtime, UI, Agent Test y marketing muestran el mismo estado y razón. |
| CTR-02 | 2 | Objeto/acción/permisos/readiness/SoR versionados. | CTR-01 | Cada writer tiene objeto, owner, efecto, assurance, confirmación e idempotencia. |
| CFG-01 | 2 | Matriz de variables, secrets, precedencia y cutover. | CTR-01 | Deployment arranca con variables actuales; fallbacks probados; secretos nunca impresos. |
| AUTH-01 | 3 | Paquete autoral por las 76 configuraciones canónicas, con cobertura de compatibilidad legacy. | CTR-02 | Schema completo y validado; ningún campo crítico se hereda silenciosamente. |
| TERM-01 | 3/6 | Revisión de los 60 perfiles con terminología heredada. | AUTH-01 + experto | Glosario/aliases/términos prohibidos/template firmados y versionados. |
| LOC-01 | 3/6 | 15 packs existentes + US/CA + política de mercados. | CFG-01 | Estados `recognized/preview/pilot/certified`, evals y fallbacks consistentes. |
| NAV-01 | 3/4 | IA de menú, rutas, roles y paridad móvil por perfil. | AUTH-01 | Trabajo diario primero; catálogo separado; todas las rutas existen y respetan permisos. |
| TOOL-01 | 3/4 | Tool plans y Active Objects por perfil. | CTR-02 + AUTH-01 | Plan autoral = capacidad efectiva o explica `missingTools`; writer visible en UI. |
| FSM-01 | 4/5 | Workflows deterministas para commits críticos. | CTR-02 | Estado, expiración, confirmación, reanudación, handoff, idempotencia y rollback probados. |
| DATA-01 | 5 | DDL y servicios de nuevos objetos operativos. | TAX-01 + CTR-02 | Migración compatible, constraints/FK/locks y API tenant-isolated. |
| UI-01 | 5 | Superficies web/móvil y deep links. | DATA-01 + NAV-01 | Crear por agente aparece en vista humana y viceversa. |
| TRANS-01 | 4 | P25–P32 implementadas. | CTR/CFG/NAV | Ocho contratos con pruebas backend, dashboard, BI y E2E. |
| INT-01 | 6 | Certificación provider/version/binding. | CTR-02 + CFG-01 | Sandbox, mapping, health, freshness, outbox/inbox, idempotencia y reconciliación. |
| EXP-01 | 6 | 21 revisiones regulatorias/de dominio. | AUTH-01 | Policy y eval firmados; versión/jurisdicción/owner registrados. |
| MIG-01 | 7 | Motor de migración y shadow comparison. | TAX-02 + DATA/UI/TRANS | Backup, dry-run, apply, verify y rollback por tenant. |
| PILOT-01 | 7/8 | Canaries de 3–5 tenants por perfil priorizado. | MIG-01 + gates externos | Métricas, incidentes, feedback y conciliación dentro de umbral. |
| CERT-01 | 8 | Promotion record y claims. | PILOT-01 + EXP/INT | Sign-off producto/dominio/seguridad/ops; availability y marketing cambian juntos. |

## 7. Implementación 1:1 de los perfiles decididos

### 7.1 Siete perfiles fundamentales

#### P01 — Pagos y recaudos

**Objetos/proyecciones mínimos:** caso de onboarding, cliente/comercio, cuenta externa de proveedor, payment link/intent, transacción proyectada, conciliación, devolución/disputa y caso de soporte. No se crea saldo ni ledger contable.

**Superficies:** Operación/pagos, Clientes/comercios, Onboarding KYC/KYB, Conciliación, Casos/disputas e Integraciones. Cada estado muestra provider, ambiente, referencia, `asOf`, freshness y autoridad.

**Tools mínimas:** consultar estado de onboarding/pago/reembolso/disputa, crear enlace alojado mediante provider autorizado, recibir documentos, abrir caso y escalar. Crear/refund/disputar requiere subpermiso, confirmación, idempotency key y adapter certificado.

**Datos y SoR:** el PSP/core conserva KYC/KYB, fondos, estado final, fees y settlement. Parallly almacena referencias, proyección mínima, trazabilidad y casos. Los webhooks son firmados, deduplicados y reconciliados por polling.

**Gate:** país/PSP/producto, sandbox con estados completos, revisión legal/AML, conciliación, rollback y piloto. `finanzas/fintech` no se migra si el tenant declaró wallet, remesa, crédito, inversión o neobanco.

#### P02 — Marketplace de intermediación

**Objetos mínimos:** seller, seller membership/role, connected account externo, listing/catalog ownership, stock por seller, checkout de un seller, orden, comisión, payout projection, refund/chargeback y disputa.

**Invariantes:** todo listing, stock, orden, política y caso tiene `seller_id`; un checkout inicial contiene exactamente un seller; PSP conectado procesa KYB/split/payout; Parallly no custodia fondos ni actúa como merchant of record.

**Superficies:** Vendedores, Catálogo, Pedidos, Compradores, Comisiones/payouts, Disputas e Integraciones. RBAC separa operador, seller admin y seller agent; un seller nunca lee otro seller.

**Tools mínimas:** buscar catálogo con seller explícito, validar disponibilidad, crear checkout alojado de un seller, consultar pedido/payout, solicitar devolución y abrir disputa/caso. La búsqueda global conserva seller y política en cada resultado.

**Gate:** contrato operador-vendedor, fiscal/consumidor, PSP marketplace, KYB, payouts, refund/chargeback, aislamiento y piloto. Carrito multivendedor queda fuera hasta un paquete posterior con split determinista.

#### P03 — Event Planning / Weddings

**Objetos mínimos:** evento, clientes/pareja, venue, guest/household, RSVP, seating group, vendor, solicitud/contrato de vendor, presupuesto/partida, timeline, task/checklist, documento, pago referenciado e incidente.

**Superficies:** Hoy/timeline, Eventos, Invitados/RSVP, Proveedores, Presupuesto, Checklist, Espacios, Contratos/pagos y Documentos. Fotografía puede ser un vendor/servicio relacionado, nunca el objeto padre.

**Tools mínimas:** crear solicitud/evento, consultar timeline/presupuesto, registrar RSVP con verificación, crear tarea, solicitar cotización a vendor, agendar visita/reunión y escalar conflicto. Contratar, pagar o cambiar presupuesto requiere confirmación y permisos.

**Invariantes:** PII de invitados por rol; presupuesto no equivale a pago; disponibilidad de vendor/venue viene de su SoR; timeline usa zona horaria del evento; templates y lenguaje cubren pareja/cliente sin asumir género o estructura familiar.

**Gate:** modelo de permisos/privacidad, capacidad de invitados, pagos/contratos, i18n, piloto con planners y migración consentida de legacy.

#### P04a — Desarrollo inmobiliario / Promotora

**Objetos mínimos:** development, etapa, torre/bloque, tipología, unidad, media/planos, price list versionada, disponibilidad, hold/separación, plan de pago propuesto, visita, lead y documento.

**Superficies:** Disponibilidad/unidades, Proyectos, Visitas, Separaciones, Clientes/leads, Precios/planes de pago, Documentos y Media. Pipeline de oportunidades permanece separado.

**Tools mínimas:** buscar unidades por filtros, obtener ficha/galería/precio vigente, consultar disponibilidad, agendar visita, crear hold con expiración, liberar hold y solicitar plan de pago.

**Invariantes:** hold transaccional por unidad con lock y vencimiento; price list con versión/moneda/validez; no prometer financiación/aprobación; fotos y planos con ownership y orden; provider externo desplaza el writer solo para unidades mapeadas.

**Gate:** datos de inventario reales, política de separación, pagos/fiducia si aplica, revisión inmobiliaria país, migración `business_model=developer` y piloto.

#### P04b — Construcción / Contratista general

**Objetos mínimos:** proyecto/obra, cliente, sitio, presupuesto, fase, milestone, daily/progress log, work order, change order, subcontratista, material/lote, inspección, incidente, documento y aprobación.

**Superficies:** Obras, Hoy/avances, Presupuestos, Fases/hitos, Órdenes de trabajo, Cambios/aprobaciones, Subcontratistas, Materiales, Inspecciones e Incidentes.

**Tools mínimas:** consultar avance/hitos, crear solicitud de trabajo, registrar actualización de campo, proponer change order, solicitar aprobación, agendar inspección y abrir incidente. Los commits económicos o de seguridad requieren humano autorizado.

**Invariantes:** Parallly no sustituye BIM, contabilidad de obra ni scheduling crítico; presupuesto, change order y factura son objetos distintos; evidencia de campo conserva autor/fecha/media; SoR baja por proyecto/recurso.

**Gate:** experto de construcción/seguridad, provider/PM si existe, permisos de campo, retención documental, migración `business_model=contractor` y piloto.

#### P05 — Soporte TI / MSP

**Objetos mínimos:** ticket, requester, organization, site, asset reference, category, impact/urgency/priority, SLA, assignment, approval, dispatch, work note, resolution y knowledge/runbook reference.

**Superficies:** Mesa de servicio, Tickets, Organizaciones, Activos, Agenda/dispatch, SLA, Conocimiento e Integraciones. Consultoría por proyectos se enruta a Consultores.

**Tools mínimas:** buscar KB autorizada, crear/consultar/actualizar ticket, recopilar diagnóstico no sensible, solicitar aprobación, agendar visita y escalar. No existen tools para shell, acceso remoto, secretos o cambio de infraestructura.

**Invariantes:** nunca pedir contraseña/MFA; notas privadas separadas; SLA calculado por calendario/contrato; asset externo usa reference y freshness; integración ITSM/PSA decide estado cuando está bound.

**Gate:** clasificación de legacy, revisión de seguridad, ITSM/PSA si se promete operación integrada, E2E de SLA/dispatch y piloto MSP.

#### P06 — Aseguradora

**Modelo:** proyección provider-required sobre PAS/core; no tablas nativas que pretendan ser póliza, reserva o ledger autoritativo. Se permite caché/proyección mínima cifrada y casos de servicio con retención definida.

**Superficies:** Clientes, Pólizas, Solicitudes/cotizaciones, Siniestros, Pagos/documentos, Casos y Compliance. Cada vista expone fuente, `asOf`, identidad verificada y acciones permitidas.

**Tools mínimas:** consultar producto/póliza/recibo/siniestro, capturar solicitud o FNOL, cargar documento, agendar y escalar. Bind, issue, endoso, cancelación, cobertura, reserva, decisión y pago solo mediante acción explícita del PAS y autoridad reforzada.

**Gate:** ramo/país, PAS/core, identidad, privacidad, revisión regulatoria, sandbox con lifecycle completo, auditoría y piloto. Hasta entonces `waitlist` y writers bloqueados.

#### P07 — Seguro de salud

**Modelo:** proyección provider-required sobre core de pagador/red. Datos PHI se minimizan, cifran, auditan y retienen según policy; ningún contexto innecesario llega al LLM.

**Superficies:** Afiliados, Elegibilidad/beneficios, Red, Autorizaciones, Reclamaciones/EOB, Casos y Privacidad.

**Tools mínimas:** consultar elegibilidad/beneficio/red/estado con verificación reforzada, recibir documento, crear caso y escalar. No diagnosticar, recomendar, decidir medical necessity, interpretar clínicamente ni aprobar cobertura/reclamación.

**Gate:** jurisdicción, base legal/consentimiento, threat model PHI, core real, data processing agreements, adapter, revisión de privacidad/seguros y piloto. Hasta entonces `waitlist`.

### 7.2 Diecisiete decisiones sobre perfiles existentes

| P | Cambio de implementación | Componentes afectados | Prueba de aceptación específica |
|---|---|---|---|
| P08 | Farmacia: habilitar OTC/pedidos y recepción Rx; validación/dispensación permanece humana/PMS. | Contrato farmacia, order writer, cola Rx, categorías, menú Pedidos/Recetas, prompts clínicos, permisos y privacy. | OTC crea pedido visible; Rx queda `pending_pharmacist`; ninguna respuesta prescribe, sustituye o declara dispensado sin SoR. |
| P09 | Taller liviano con intake, agenda, estimación, aprobación y seguimiento. | Services/appointments, vehicle/customer, estimate, technician/resources, UI taller y prompt diagnóstico seguro. | Síntoma declarado no se convierte en diagnóstico; estimado/final se distinguen; operación aparece en RO. |
| P10 | `repair_order` como Active Object canónico. | DDL/API/permissions/deep links/nav/analytics y migración desde objetos legacy. | Oportunidad, cita, estimate y RO tienen IDs/labels distintos; concurrencia e historial no duplican RO. |
| P11 | Alquiler: disponibilidad, reserva, elegibilidad intake, depósito, contrato, entrega/devolución y daños. | Rental service, capacity locks, driver profile, OTP/firma, payments, inspections y UI. | Dos reservas no toman el mismo vehículo; identidad/pago/seguro no se autoaprueban; devolución/daño queda trazable. |
| P12 | Agencia de viajes como intermediaria, separada de Tours. | Perfil/claim/nav, quote/request, traveler, itinerary y disclosure. | Un quote no aparece como reserva; agent informa rol de intermediario y escala si falta disponibilidad live. |
| P13 | Ownership dividido: Parallly lead/requisitos/draft; GDS/provider precio, PNR y final. | SoR policy por objeto, provider mapping, freshness, tools de quote/book/cancel y reconciliación. | Precio vencido o provider caído nunca confirma; cada opción muestra proveedor, moneda, vigencia y `asOf`. |
| P14 | Online: venta, matrícula, acceso y soporte; LMS decide progreso/evaluación/certificado. | LMS adapter, enrollment/access, nav, prompts, guardian consent y tools. | Agente no altera nota/progreso; estado mostrado coincide con LMS y degrada con marca temporal. |
| P15 | Abogados: intake/conflicto/agenda/documentos/estado administrativo sin consejo. | Matter connector, conflict workflow, roles, confidentiality, disclaimers y evals jurisdiccionales. | Sin conflicto aprobado no se abre matter ni se comparte información; prompts no interpretan ley ni resultado. |
| P16 | Contadores: checklist, documentos, vencimientos y estado; criterio/filing en sistema profesional. | Jobs/deadlines, accounting/tax connector, document portal, templates y país. | Ningún cálculo o filing se declara completo sin SoR/profesional; período y autoridad son obligatorios. |
| P17 | Consultores: Ventas→SOW→engagement; PSA para staffing/tiempo/gastos/rentabilidad. | Objetos separados, approvals, PSA binding, nav delivery y analytics. | Opportunity, SOW y engagement no comparten etiqueta; capacidad/margen nunca se inventan. |
| P18 | SaaS: adquisición/onboarding/soporte; producto API decide entitlement/billing/admin. | SaaS connector, account/user references, tool assurance, incident/support nav y security. | Acción admin sin API/permiso falla cerrado; plan, uso y factura incluyen fuente/frescura. |
| P19 | Fumigación: inspección, orden, recurrencia, químicos/lotes, licencia y compliance. | Field service, inventory/lots, technician license, SDS, aftercare, prompts y país. | Solo técnico autorizado elige tratamiento; lote/licencia/ubicación quedan registrados antes de completar. |
| P20 | Cerrajería: authority verification antes de dispatch/acceso. | Identity policy, evidence/OTP, risk levels, dispatch, audit, retention y safety evals. | Solicitud sensible sin autoridad queda bloqueada/handoff; nunca genera instrucciones de bypass ni guarda códigos. |
| P21 | Guardería: retirar contención cuando estén listos cupos, vacunas, cuidados y check-in/out. | Pet profile, capacity, health requirements, consent, incidents, deposits y daily UI. | Reserva sin requisitos/cupo no confirma; check-in/out y cuidados aparecen en ocupación humana. |
| P22 | Hotel: estadía nocturna propia, no appointment. | Boarding rental, nights/units, capacity locks, medication/feed, contract, deposits y UI. | Fechas/ocupación serializadas; una estadía nunca se materializa solo como cita. |
| P23 | Fotografía producto: brief, SKUs, shot list, muestras, retoque, revisiones/licencia/entrega. | Production job, media versions, approvals, logistics, pricing y templates. | Paquete/quote deriva de reglas; archivos, derechos, versión y aprobación son visibles y auditables. |
| P24 | Mantener en Fotografía con `production_job`; no DAM/PIM. | Taxonomía, persona, tools, menú y Active Object. | No hereda wedding planning ni sesión genérica; necesidad DAM/PIM produce integración/handoff, no claim falso. |

P08–P24 no cambian automáticamente `availability`. Cada perfil se vuelve candidato a promoción únicamente después de pasar autoría, expert/provider gates aplicables y piloto.

## 8. Implementación de decisiones transversales y regionales

### 8.1 P25 — Verificación progresiva de correo

**Backend:** política única `EmailVerificationCapabilityPolicy` aplicada a endpoints y workers, no solo a UI. Estados mínimos: `unverified`, `pending_change`, `verified`, `restricted`. Las acciones sensibles se declaran en un registro compartido y default-deny.

**Permitido sin verificar:** autenticarse, corregir/reintentar correo, completar configuración no operativa y usar Agent Test/sandbox sin writers productivos.

**Bloqueado sin verificar:** activar canal/agente/integración; enviar outbound o broadcast; invitar usuarios; cargar/rotar secretos; configurar cobros; comprar/activar entitlement pagado; exportar datos o ejecutar acciones administrativas sensibles.

**Compatibilidad:** usuarios productivos verificados no cambian. Legacy sin timestamp entra en shadow audit antes de enforcement. Google OAuth no se considera verificado si el claim/provider no cumple la policy aceptada. Banner, resend, change-email y rescue comparten el mismo estado.

**Aceptación:** pruebas por endpoint/rol, rate limiting, rebote/cambio de correo, multi-tab y Browser E2E. Ninguna acción sensible depende exclusivamente de esconder un botón.

### 8.2 P26 — SMS retirado

- eliminar del selector, onboarding, pricing, claims y conexión de agentes;
- conservar únicamente callbacks/status y datos requeridos para obligaciones legacy;
- marcar adapters/rutas legacy como internos/deprecated y excluirlos del pivot conversacional;
- añadir guard contractual que impida reintroducir SMS como `ChannelType` certificado por accidente;
- no construir pricing, credits o conversación SMS dentro de este programa.

**Aceptación:** cero alta nueva y cero claim; tenants legacy no pierden trazabilidad. Reapertura requiere ADR/programa independiente.

### 8.3 P27 — Analytics por `channel_account`

**Modelo:** dimensión estable `channel_account_id`, label histórico y channel type en eventos y agregados. Para eventos anteriores, backfill solo cuando la atribución sea demostrable; lo demás queda `unknown`, nunca asignado por conjetura.

**API/UI/BI:** aggregate por tipo continúa default; filtro/drill-down por cuenta en KPIs, series, export CSV y BI; totals deben reconciliar. RBAC filtra según tenant, rol y asignación; super_admin requiere tenant explícito.

**Aceptación:** dos números WhatsApp del mismo tenant muestran métricas separadas y su suma coincide con WhatsApp total; cuentas desconectadas/renombradas conservan historia; identificadores/credenciales no se exponen.

### 8.4 P28 — Email interno

- ocultar o retirar `/admin/channels/email` mientras no exista API tenant que lo respalde;
- documentar adapter inbound como interno y no certificado;
- excluir Email del selector de agentes, setup self-service, pivot conversacional, pricing y claims;
- mantener ingestión legacy con observabilidad y seguridad si tiene consumidores reales;
- crear ADR de reapertura con threading, attachments, bounce/spam, OAuth/provider, outbound, identidad, analytics, soporte y E2E como prerequisitos.

**Aceptación:** no hay callejón UI ni promesa operativa; el adapter interno no se rompe.

### 8.5 P29 — Planner híbrido

El registro de intents clasificará cada flujo como:

- `informational`: LLM + readers;
- `guided`: LLM + `toolPlan` + ejecutor default-deny;
- `transactional`: máquina de estados determinista;
- `regulated`: máquina de estados + autoridad/handoff/provider/expert policy.

Cada workflow determinista declara estados, slots, validadores, transiciones, expiración, reanudación, cancelación, confirmación, aprobación, idempotencia, side effects y recovery. Booking existente sirve de patrón, no se crea un motor paralelo por vertical.

Primera cola obligatoria: pagos, checkout marketplace, hold inmobiliario, alquiler, repair approval, RSVP sensible, dispatch cerrajería, Rx intake, FNOL y health-insurance identity gate.

**Aceptación:** reintento/reanudación no duplica commits; el LLM no decide el próximo estado autoritativo; Agent Test expone state/tool plan/motivo y E2E cubre abandono, expiración y handoff.

### 8.6 P30 — Freshness común

Crear una proyección única por provider/tenant/binding con:

`provider`, `connectionId`, `resourceType`, `resourceId`, `lastAttemptAt`, `lastSuccessAt`, `asOf`, `expectedInterval`, `freshUntil`, `health`, `freshness`, `degradedReason`, `sourceVersion` y `observedAt`.

`syncInterval` continúa como input tenant; runtime, UI, alertas y auditoría consumen la evaluación común. Ownership no cambia por health. La migración corre en shadow y compara el reloj viejo/nuevo antes del cutover.

**Aceptación:** mismo estado en API/UI/prompt/trace; cron metadata coincide; proveedor stale no aparece como lista vacía ni reactiva writer nativo.

### 8.7 P31 — Binding granular

- modelo de binding con tenant, provider, connection, resource type/id, external id, scope/site/property/calendar y estado;
- resolución determinista con versión/generación para invalidar caché;
- revisión de duplicados, remapeo, tombstone, disconnect y reconciliación;
- UI de mapping con preview y conflicto; ninguna credencial en payload;
- fallback tenant-wide conservador hasta tener binding suficiente.

**Aceptación:** dos sedes pueden usar SoR distintos sin cruzar datos; caída del externo no abre writer local; remapeo invalida inmediatamente la decisión anterior; toda acción registra binding usado.

### 8.8 P32 — Mindbody live

- separar `scheduled`/`mirrored` de `available_live`;
- mirror con `asOf` solo alimenta descubrimiento y lenguaje condicionado;
- availability/hold/book/cancel exigen API live, adapter versionado y reconciliación;
- si no hay consulta live, respuesta tipada `live_capacity_unavailable` con handoff/waitlist;
- no activar `INTEGRATION_WRITE_PROVIDERS` por health solamente.

**Aceptación:** un cupo agotado entre sync y conversación nunca se confirma desde espejo; rate limit/timeout/stale generan mensaje honesto; booking idempotente coincide con Mindbody y Parallly.

### 8.9 P33 — Estados Unidos y Canadá

| Pack | Generación | Reconocimiento | Formatos | Gate inicial |
|---|---|---|---|---|
| `US/en-US` | Inglés estadounidense neutral/profesional por subtipo. | Variantes frecuentes sin forzar slang. | USD, +1, estado/ZIP, zona tenant; fecha inequívoca en operaciones. | `draft` → `pilot` con hablante, corpus, legal/sector y tenants. |
| `US/es-US` | Español de EE. UU. configurable; no importa modismos de un país LatAm. | Code-switch y términos comunes del tenant. | USD, +1, estado/ZIP; confirmación explícita. | Igual; revisión bilingüe. |
| `CA/en-CA` | Inglés canadiense. | Aliases canadienses documentados. | CAD, provincia/postal, zona; fecha inequívoca. | `draft` → `pilot`; revisión federal/provincial. |
| `CA/fr-CA` | Francés canadiense, no copia automática de `fr-FR`. | Variantes revisadas por hablante. | CAD, provincia/postal, zona; fecha inequívoca. | Igual; Quebec se valida aparte cuando aplique. |

El tenant country determina reglas; el contacto puede elegir idioma. `+1` nunca decide país ni identidad por sí solo.

### 8.10 P34 — Mercados no comercializados

Implementar un registro único de estado de mercado:

| Estado | Onboarding | Capacidades | Claim |
|---|---|---|---|
| `recognized` | Waitlist o asistido; conserva datos ISO. | Genéricas no reguladas, formatos explícitos; country tools apagadas. | Ninguno. |
| `preview` | Asistido con disclosure. | Limitadas y fail-closed donde falta país/proveedor. | Preview, no certificado. |
| `pilot` | Solo tenants aprobados. | Pack/proveedor/soporte controlados. | Piloto privado. |
| `certified` | Self-service según plan. | Contrato completo y monitorizado. | Claim aprobado por perfil/país. |

Landing, onboarding, billing, agente, tool resolver y soporte leen el mismo estado. El fallback no usa modismos ajenos ni infiere moneda, consentimiento, impuestos o regulación.

## 9. Programa de autoría de prompts, variables, templates y terminología

### 9.1 Paquete obligatorio por perfil

Cada una de las 76 configuraciones canónicas tendrá un artefacto versionado con estos campos; los cinco IDs legacy tendrán fixture de compatibilidad y migración:

1. identidad del negocio, cliente objetivo y jobs-to-be-done;
2. objeto primario y objetos relacionados;
3. alcance comercial permitido y exclusiones;
4. intents informativos, guiados, transaccionales y regulados;
5. slots requeridos, opcionales, sensibles, derivados y prohibidos;
6. fuentes de verdad, freshness, fallback y autoridad por slot;
7. tools readers/writers esperadas, confirmación, aprobación e idempotencia;
8. estado degradado y handoff por ausencia de capacidad;
9. menú por importancia, rutas, roles y clasificación operación/catálogo;
10. términos preferidos, aliases reconocibles, registros prohibidos y frases que nunca implican consentimiento;
11. templates de bienvenida, descubrimiento, confirmación, bloqueo, handoff, éxito y seguimiento;
12. variantes ES/EN/PT/FR, más overlays de país disponibles;
13. reglas de privacidad, retención, datos sensibles y disclosure de rol;
14. evals positivos, negativos, adversariales, de idioma, de provider y de tool honesty;
15. benchmark, claim autorizado y nivel `draft/pilot/certified`.

No se copiarán 77 prompts completos. Los invariantes y componentes compartidos viven una vez; cada perfil declara únicamente diferencias de dominio. Custom prompt permanece dentro de L1/L3 y no puede quitar safety, SoR, permisos, country pack ni disclosure.

### 9.2 Programa para los 60 perfiles con terminología heredada

El cierre se hará por lotes de riesgo, no alfabéticamente:

1. salud, farmacia, finanzas, seguros y legal;
2. acceso físico, construcción, automotriz, mascotas y servicios de campo;
3. turismo, educación, SaaS/MSP y profesionales;
4. retail, restaurantes, belleza, fitness, fotografía y resto.

Por perfil se requieren experto, revisor lingüístico, owner de producto y evidencia. La herencia podrá mantenerse solo si el revisor la aprueba explícitamente; deja de ser “heredada sin revisar” y registra versión/fecha.

### 9.3 Templates y modismos

- El reconocimiento acepta confirmaciones, negativas, opt-out, handoff y expresiones de urgencia del país; la generación usa un registro profesional configurable.
- Una expresión coloquial ambigua nunca confirma un pago, contrato, cita, reserva, dispatch o tratamiento.
- Fechas, cantidades, monedas, direcciones e identificadores críticos se repiten en formato inequívoco antes del commit.
- Los templates no contienen precios, políticas, disponibilidad, plazos o claims sin fuente de verdad.
- El mismo término preferido aparece en prompt, menú, notificación y pantalla; los IDs internos permanecen estables.

### 9.4 Gate de autoría

Un paquete puede quedar `mechanically_complete` cuando pasa schema/i18n/evals deterministas. Solo pasa a `expert_reviewed`, `pilot_ready` o `certified` con las firmas correspondientes. La UI de auditoría mostrará estas etapas por separado.

## 10. Datos, configuración y migraciones

### 10.1 Separación de cambios

Cada paquete se divide en releases recuperables:

1. tipos/lectura compatible;
2. DDL aditivo y backfill seguro;
3. escritura en shadow o dual-write controlado cuando sea imprescindible;
4. UI/agent read-only;
5. migración de identidad/datos por tenant;
6. writer nativo bajo flag;
7. adapter externo read-only;
8. adapter writer allowlisted;
9. claim/availability.

Nunca se juntan en una misma promoción la primera migración de datos y la primera escritura externa.

### 10.2 Reglas DDL y multi-tenancy

- Global: catálogo de perfiles/versiones, estado de mercado, provider certification, migration jobs y promotion records.
- Tenant schema: objetos operativos nativos y referencias/proyecciones permitidas.
- Toda tabla tenant incluye aislamiento, timestamps, actor/source y claves idempotentes donde haya writers.
- FKs, unique constraints, partial indexes y locks se diseñan antes de la tool; no se delega integridad al prompt.
- Migraciones multi-statement se ejecutan como statements individuales compatibles con PgBouncer.
- Scripts tenant prueban schema nuevo, schema legacy mínimo, tenant activo y tenant retenido/offboarded aplicable.
- Un índice nunca precede la columna que necesita; CI crea fixtures legacy deliberadamente incompletos.
- Media y documentos usan el servicio existente, tags/ownership y retención; no crean stores paralelos.

### 10.3 Migraciones especiales

| Caso | Clasificación | Transformación | Rollback |
|---|---|---|---|
| `finanzas/fintech` | Confirmar `pagos_recaudos`; otros modelos quedan legacy/waitlist. | Copiar identidad/config compatible; no crear transacciones ni KYC ficticio. | Volver al profile/version legacy; datos nuevos quedan inactivos y auditados. |
| `fotografia/wedding_planner` | Confirmar planner real. | Crear evento desde business profile; importar contactos/documentos únicamente con mapping revisado; no convertir photo sessions en timeline. | Restaurar profile legacy y ocultar objetos nuevos sin borrarlos. |
| `inmobiliaria/construccion` | `developer`, `contractor`, `both` o `unknown`. | `developer` crea espacio promotora; `contractor` crea obra; `both` crea dos espacios con contactos compartidos y objetos separados. | Revertir binding de perfil/espacios; no fusionar datasets. |
| `technology/consultoria_ti` | `msp`, `project_consulting`, `both` o `unknown`. | MSP migra a soporte; proyectos apuntan a Consultores; ambos conservan dos espacios. | Volver a legacy sin convertir tickets en engagements. |
| P10 `repair_order` | Detectar citas/solicitudes con evidencia de trabajo real. | Crear RO solo con mapping determinista o revisión; enlazar, no renombrar, oportunidad/cita/estimate. | Desactivar vínculo/RO importada; preservar fuente. |
| Analytics cuenta | Atribución demostrable por channel account. | Backfill con account ID histórico; ambiguos quedan `unknown`. | Recalcular agregados sin borrar raw events. |

### 10.4 Compatibilidad de variables y secretos

La precedencia obligatoria es:

1. variable/secret nuevo explícito y válido;
2. variable productiva anterior compatible;
3. configuración persistida existente;
4. default seguro/fail-closed documentado.

Reglas específicas:

- un despliegue no falla solo porque una variable nueva todavía no existe en producción;
- `TENANT_SECRET_KEY` conserva fallback a `ENCRYPTION_KEY` durante transición;
- key ID ausente conserva `primary` mientras no inicie rotación;
- una rotación configura nueva key, nuevo ID y key anterior en previous keys de forma atómica;
- `TENANT_SECRET_PLAINTEXT` permanece compatible hasta que dry-run/apply demuestre cero plaintext; solo entonces cambia a rechazo;
- hosts oficiales de proveedores mantienen defaults allowlisted de lectura cuando ya existen; hosts custom son explícitos;
- `INTEGRATION_WRITE_PROVIDERS` permanece vacío hasta certificar provider **y versión**; la evolución deberá admitir allowlist granular por capability/binding;
- flags tenant/profile viven en runtime config/DB y no se sustituyen por una variable global;
- logs, GET settings, UI y errores nunca devuelven secretos; `***` preserva el valor existente en updates.

Cada PR que introduce configuración añade tabla de nombre, scope, sensibilidad, owner, default, fallback legacy, validación, entorno, método de rotación y rollback.

### 10.5 Procedimiento por tenant

1. validar backup y restore point;
2. ejecutar inventario y dry-run;
3. revisar conflictos y campos `unknown`;
4. obtener aprobación necesaria;
5. aplicar DDL aditivo;
6. ejecutar migración CAS/idempotente con correlation ID;
7. comparar snapshot anterior/nuevo;
8. correr smoke de perfil, menú, prompt, tools y objetos;
9. activar shadow y observar;
10. habilitar canary si gates completos;
11. verificar métricas/conciliación;
12. cerrar o ejecutar rollback dentro de la ventana.

## 11. Proveedores, fuentes de verdad y revisión experta

### 11.1 Ciclo de certificación de una integración

Una integración avanza por:

`registered → credentials_validated → read_only → shadow_compared → write_sandbox → reconciled → pilot → certified → suspended/retired`.

Cada versión registra:

- provider, producto, versión API y ambiente;
- perfiles/capabilities permitidos;
- modelo de ownership y binding;
- scopes y secreto requeridos;
- rate limits, paginación y webhooks;
- health/freshness y comportamiento stale;
- idempotencia, retries, ordering y tombstones;
- mapping y resolución de conflictos;
- reconciliación y evidencia de rollback;
- datos sensibles/retención;
- fixtures/sandbox y owner operativo.

`health=healthy` no equivale a `writes=certified`. El ejecutor consulta certificación efectiva por provider, versión, capability, perfil y binding.

### 11.2 Orden recomendado de proveedores

| Ola | Proveedor/sistema | Perfiles que desbloquea | Condición para iniciar |
|---:|---|---|---|
| 1 | Hostaway/Channel Manager | Hotel/alquiler vacacional y tenant turístico prioritario. | Sandbox, versión, unidades reales de prueba, mapping y write-back contract. |
| 1 | PSP marketplace/connected accounts | P01 Pagos y P02 Marketplace. | País/modelo contractual, connected accounts, KYB, payout/refund/chargeback sandbox. |
| 1 | ITSM/PSA elegido | P05 MSP y P17 Consultores según producto. | Tenant piloto, ticket/asset/SLA o engagement/time contract definido. |
| 2 | Mindbody | Fitness/bienestar con cupo live. | Cuenta/sandbox que exponga availability/hold/book y rate limits. |
| 2 | Cliniko/PMS clínico | Salud/belleza regulada. | País, privacy, paciente/provider/resource mapping y tenant piloto. |
| 2 | Toast/POS/KDS | Restaurantes. | Catálogo/modifiers/stock/order/status, sede y sandbox. |
| 3 | LMS/GDS/DMS/field service | Educación, viajes, taller y servicios de campo. | Perfil y tenant demandante, scope/SoR y API comprobada. |
| 4 | PAS/core asegurador y payer core | P06/P07. | Jurisdicción, DPA, experto, identidad reforzada y sandbox autorizado. |

Las olas expresan dependencia, no contrato comercial ni fecha.

### 11.3 Los 21 `expert_gate`

Cada gate se convierte en una revisión con:

- `profileId`, país/jurisdicción y versión del contrato;
- pregunta exacta y riesgo que resuelve;
- especialista, credencial/rol y declaración de conflictos;
- policy aprobada, excepciones y fecha de expiración;
- cambios requeridos en prompt, slots, tools, permisos, retención, handoff y evals;
- evidencia adjunta y firma de Product/Security/Legal cuando aplique.

Una llamada o comentario no cierra el gate. La policy debe ser machine-readable donde controle ejecución y legible en el panel de auditoría.

### 11.4 Protección de datos por riesgo

- `public/business`: disponible según perfil y tenant.
- `customer_private`: identidad y rol tenant.
- `sensitive`: step-up, minimización, retention y purpose.
- `regulated`: jurisdicción, authority, source y audit obligatorios.
- `secret`: nunca al LLM, logs, traces ni GET; solo secret store/service.

PHI, documentos legales/financieros, llaves/accesos, menores, invitados, conductores y connected accounts tendrán threat model y pruebas de aislamiento específicas.

## 12. Estrategia de pruebas y evals

### 12.1 Pirámide obligatoria

| Capa | Qué demuestra | Ejecución mínima |
|---|---|---|
| Schema/contract | Catálogo, manifest, i18n, rutas, tools, permisos y SoR completos. | Cada PR; 76/76 configuraciones canónicas, compatibilidad legacy y cuatro idiomas. |
| Unit/policy | Validadores, resolvers, assurance, normalizadores y estados. | Cada PR; casos positivos/negativos/boundary. |
| DB/Redis/queue | Integridad, locks, idempotencia, cache generation, jobs y tenant isolation. | CI con PostgreSQL/Redis efímeros. |
| Migration compatibility | Schema actual y legacy mínimo por tenant. | Cada cambio DDL; dry-run y apply repetido. |
| API/UI contract | Writer→objeto→reader→deep link y RBAC. | Cada capability; web y móvil donde aplique. |
| Browser E2E | Onboarding, auth, menús, operación y regresiones críticas. | Antes de merge/promoción; pipeline verde obligatorio. |
| LLM eval | Selección de intent/tool, slots, lenguaje, claims, handoff e inyección. | Golden set versionado por profile/language/risk. |
| Provider sandbox | Mapping, freshness, webhooks, failures, write-back y reconciliación. | Por provider/version/capability. |
| Security/privacy | Cross-tenant, escalation, PII/PHI/secret leakage, prompt injection y abuse. | Por release de riesgo y red team antes de piloto. |
| Pilot E2E | Resultado real con canal, modelo, DB, provider y usuario. | 3–5 tenants por perfil priorizado. |

### 12.2 Matriz mínima por perfil

Cada configuración tiene al menos 25 escenarios base por idioma soportado. Para 76 configuraciones y ES/EN/PT/FR, el baseline mecánico es **7.600 ejecuciones scenario-language**, generadas desde contratos y complementadas con casos específicos; no 7.600 prompts copiados. Los fixtures legacy se ejecutan adicionalmente y no inflan el conteo canónico.

Los escenarios cubren:

- happy path por intención;
- dato faltante, ambiguo, inválido, corregido y sensible;
- interrupción, reanudación, expiración y cancelación;
- replay/duplicate/idempotencia y concurrencia;
- plan, permiso, readiness, quota o email verification insuficientes;
- provider down, stale, timeout, partial success y reconciliación;
- `empty` real frente a `stale`, `error` y `unauthorized`;
- after-hours, handoff y SLA;
- confirmación, aprobación y revocación de autoridad;
- PII/PHI/menor/propiedad/acceso/KYC según perfil;
- prompt injection en mensaje, RAG, tool result, MCP y custom prompt;
- dialecto, aliases, tildes, code-switch y negación/opt-out;
- fechas DMY/MDY, DST, timezone, moneda, E.164 y dirección;
- active object y deep link después de cada writer;
- paridad live/Agent Test/web/móvil;
- fuente/jurisdicción correcta y contaminación negativa.

Cada writer añade seis contratos mínimos: success, denied, missing readiness, stale/down, duplicate/replay y handoff/recovery. Cada workflow determinista añade transición inválida, expiración y reanudación.

### 12.3 Métricas de promoción

| Métrica | Umbral/gate |
|---|---|
| Escritura no autorizada | **0**. |
| Duplicado por replay/concurrencia | **0** en golden/concurrency suite. |
| Fuga cross-tenant/cross-seller/cross-resource | **0**. |
| Claim sin fuente en precio, stock, cupo, política, cobertura o estado | **0**. |
| Acción crítica seleccionada correctamente | 100% del golden set de alto impacto. |
| Slots críticos | 100% validados; cero inferencia prohibida. |
| Writer integrity | 100% deja evidencia persistida, Active Object, source/`asOf` y deep link. |
| Confirmación de dinero/consentimiento | ≥99,5% y cero alias aislado ejecuta. |
| Cancelación/seguridad/opt-out | Recall ≥99% en golden set de cada pack. |
| Navegación | Tarea primaria a ≤2 interacciones y cero 403 visibles. |
| Regional certified pack | ≥95% exactitud; cero default CO/+57/COP/Bogotá fuera de contexto. |
| Jurisdicción RAG | Cero fuente no aplicable en dominios regulados. |
| Reconciliación proveedor | 100% de objetos del canary explicados; divergencia no resuelta bloquea. |
| Browser E2E/CI/migration smoke | 100% verde antes de promover. |

Los outcome metrics —conversión, resolución, handoff útil, abandono y tiempo— se fijan contra baseline del tenant piloto; no sustituyen los gates absolutos de seguridad/integridad.

## 13. Observabilidad, operación y alertas

Cada turno/acción registrará de forma redactada:

- tenant, profile/version, country pack/version y certification state;
- canal y `channel_account_id`;
- locale, timezone, currency y operating country;
- intent class, workflow/state y evidencia normalizada;
- slots presentes/faltantes y clasificación de sensibilidad;
- plan, permisos, readiness y email verification snapshot;
- tool plan, tools descartadas, policy/source versions y resultado;
- provider/version/binding, ownership, health, freshness y `asOf`;
- confirmación/aprobación, idempotency key hash y Active Object;
- handoff reason, deep link y correlation ID.

Dashboards obligatorios:

- catálogo/profile/market/country certification;
- migraciones legacy y conflictos de clasificación;
- tools anunciadas, publicadas, descartadas y fallidas;
- reads `empty|stale|error|unauthorized`;
- writers sin Active Object o sin deep link;
- divergencia nativo/provider y reconciliación;
- binding/ownership por recurso;
- workflow abandon/recovery/duplicate;
- desempeño por perfil/idioma/país/cuenta de canal;
- handoff precision/recall y SLA;
- prompts/terms/templates pendientes de experto;
- storage/retention y accesos a datos sensibles.

Alertas P0:

- commit sin confirmación/aprobación requerida;
- dos SoR escribiendo el mismo objeto;
- disponibilidad, precio, cobertura o pago divergente;
- objeto duplicado o cross-tenant/cross-seller leak;
- provider error mostrado como “no existe”;
- writer publicado sin readiness/certificación;
- PHI/secret/credential en trace o prompt;
- migración a taxonomía incorrecta;
- menú/Active Object que abre el objeto equivocado;
- country/jurisdiction pack incorrecto en acción regulada.

## 14. Release, canary y rollback

### 14.1 Gates de un PR

1. decisión P y WP enlazados;
2. contrato compartido actualizado, sin registro paralelo;
3. i18n ES/EN/PT/FR;
4. migration/compat test cuando aplique;
5. unit/integration/contract/eval focales;
6. lint/typecheck/build;
7. security/privacy review según clasificación;
8. docs/runbook/observability;
9. diff sin secretos, mocks productivos o cambios ajenos.

### 14.2 Gates de promoción

1. CI completo y Browser E2E verde;
2. backup/rollback ensayado;
3. variables presentes o fallback productivo probado;
4. migración dry-run revisada;
5. feature flags default-off;
6. provider writes fuera de allowlist salvo certificación explícita;
7. canary tenant identificado;
8. dashboards/alertas activos;
9. health checks API/DB/Redis/workers/fronts;
10. nueve artefactos del runbook adjuntos.

### 14.3 Rollout

`internal → shadow → canary 1 tenant → canary 3–5 → pilot → certified`.

- Shadow compara tools, prompts, navigation y SoR sin commits externos.
- Primer canary habilita un perfil/country/provider/capability, no una vertical completa.
- Error P0, duplicado, divergencia, fuga, migración incierta o provider no reconciliado detiene promoción y revierte flag/binding/profile version.
- Rollback de aplicación precede a rollback de datos; los datos nuevos se preservan inactivos salvo que la policy exija eliminación.
- Claims/landing/onboarding cambian al final y se revierten junto con availability.

### 14.4 Nueve artefactos obligatorios

1. manifest/profile snapshot;
2. effective tools/permissions/readiness snapshot;
3. migration dry-run/apply/verify report;
4. test/eval report;
5. provider certification/reconciliation report;
6. security/privacy/domain approvals;
7. canary metrics e incident log;
8. rollback evidence;
9. promotion record con sign-off y claims autorizados.

## 15. Organización, responsabilidades y capacidad

### 15.1 RACI mínimo

| Entregable | Product | Platform | Domain/i18n | Integration/Data | Security/Legal | QA/Evals | Ops |
|---|---|---|---|---|---|---|---|
| Taxonomía/claim | A/R | C | C | I | C | I | I |
| Contrato compartido | A | R | C | C | C | C | I |
| Prompt/variables/templates | A | C | R | C | C | R | I |
| Objetos/tools/UI | A | R | C | R | C | R | C |
| Provider/SoR | A | C | C | R | C | R | C |
| Expert/country policy | A | C | R | I | R | C | I |
| Migración | A | R | C | R | C | R | R |
| Piloto/certificación | A | C | R | R | R | R | R |

`A` accountable, `R` responsible, `C` consulted, `I` informed. Una persona puede cubrir varios roles, pero ninguna promoción regulada queda aprobada solo por quien implementó.

### 15.2 Tamaño relativo

Las cifras son esfuerzo de equipo, no fechas comprometidas:

| Fase | Tamaño | Motivo dominante |
|---:|---|---|
| 1 | M | Taxonomía, inventario productivo y migración multi-destino. |
| 2 | L | Contratos/configuración compartidos en API, dashboard, móvil, landing y test. |
| 3 | XL | 77 paquetes, 60 revisiones terminológicas, cuatro idiomas y packs país. |
| 4 | L/XL | Ocho cambios transversales con analytics, auth, workflows e integración. |
| 5 | XXL | Nuevos objetos/workflows y profundidad de 24 decisiones de perfil. |
| 6 | Variable externa | Cada provider/core y experto tiene sandbox/contrato propio. |
| 7 | L por ola | Migración, shadow, canary, conciliación y rollback. |
| 8 | Continua | Certificación por perfil/país/provider, no big-bang. |

Para planificar sprints se estimará cada WP en `S ≤1`, `M 2–3`, `L 4–6`, `XL 7–12` team-weeks equivalentes antes de asignar fecha. Los WPs externos no reciben fecha hasta tener credenciales/experto/tenant.

## 16. Camino crítico y paralelización segura

Camino crítico:

`GOV-01 → TAX-01 → CTR-01/CTR-02/CFG-01 → AUTH-01/NAV-01/TOOL-01 + fundamentos TRANS-01 → DATA-01/FSM-01/UI-01 → MIG-01 → PILOT-01 → CERT-01`.

Trabajo paralelizable después de TAX-01/CTR-01:

- autoría terminológica por lotes;
- US/CA y packs existentes;
- discovery/sandbox de proveedores;
- diseño de objetos de Event Planning, Promotora, Construcción, Pagos, Marketplace y MSP;
- P08–P24 por squads de dominio;
- P25–P32 por owners transversales;
- reclutamiento de expertos y tenants piloto.

No se paraleliza de forma independiente:

- creación de IDs en cada app;
- políticas de tools/permisos fuera del resolver central;
- schemas divergentes web/mobile/API;
- aliases/migraciones antes de cerrar el contrato compartido;
- adapters writers antes de binding/certificación;
- marketing antes de promotion record.

## 17. Definition of Done por perfil

Un perfil solo está `certified` si:

1. tiene ID canónico/versionado y legacy compatibility sin fallback silencioso;
2. alcance, exclusiones, benchmark y claim están aprobados;
3. objetos operativos, CRM y catálogo tienen semántica separada;
4. prompts, variables, templates y términos están completos en cuatro idiomas y packs habilitados;
5. cada variable declara pregunta, validación, sensibilidad, SoR, freshness, persistencia y destino;
6. custom prompt no puede borrar safety, SoR, permisos, país o disclosure;
7. tool plan autoral coincide con snapshot efectivo o explica lo faltante;
8. readers distinguen `empty|stale|error|unauthorized`;
9. writers son autorizados, confirmados, idempotentes y dejan objeto/deep link;
10. workflow crítico tiene estado determinista, recovery y handoff;
11. navegación prioriza trabajo diario, respeta roles/plan y tiene paridad necesaria;
12. SoR/binding/provider/version están declarados y reconciliados;
13. datos sensibles están minimizados, cifrados, auditados y sujetos a retención;
14. contract/unit/DB/migration/API/UI/Browser E2E/evals están verdes;
15. experto y país están firmados donde aplique;
16. migración/rollback se probaron con legacy realista;
17. piloto 3–5 tenants cumple métricas y no tiene P0 abierto;
18. nueve artefactos y sign-off están adjuntos;
19. availability, docs, soporte, landing y claims cambian coordinadamente;
20. observabilidad y alertas operan antes de escalar.

Los estados previos son `defined`, `contracted`, `mechanically_complete`, `expert_reviewed`, `integrated`, `evaluated`, `pilot_ready`, `piloted` y `certified`. Ningún estado se deduce de una frase en documentación: se registra con evidencia.

## 18. Primera cola de ejecución cuando se autorice código

El primer bloque de implementación debe limitarse a fundamentos reversibles:

1. `TAX-01`: registro objetivo de 20 verticales/76 configuraciones canónicas y cinco IDs legacy, sin publicar destinos `waitlist` en el selector productivo;
2. `TAX-02`: contrato de migración multi-destino y clasificador, solo dry-run;
3. `TAX-03`: reporte read-only de tenants afectados, sin imprimir secretos ni PII innecesaria;
4. `CTR-01`: certification/availability por perfil-país-provider;
5. `CFG-01`: matriz/fallbacks y tests con variables productivas actuales;
6. specs de conteo, aliases, no-silent-migration, i18n, rutas y Browser E2E;
7. design review y Gate 1 antes de crear tablas u objetos de dominio.

Después del Gate 1 se abren en paralelo P03 Event Planning, P04 Promotora/Construcción, P05 MSP y el programa de autoría; P01/P02/P06/P07 avanzan primero en contrato/read-only mientras se consiguen proveedores y expertos.

## 19. Condiciones de parada

Se detiene el frente afectado si:

- un tenant no puede clasificarse sin inferir su negocio;
- una migración no tiene rollback verificable;
- aparece un segundo registro de perfil/tool/menú;
- una variable nueva rompe el flujo con variables productivas actuales;
- el provider no prueba ownership, idempotencia o reconciliación;
- una acción regulada carece de experto/jurisdicción;
- el LLM determina un commit o fuente de verdad;
- un error/stale aparece como dato negativo o confirmación;
- Browser E2E, tenant migration smoke, isolation o security fallan;
- el claim excede el estado certificado.

## 20. Control de cambio

Cualquier cambio posterior a P01–P34 requiere una nueva decisión enlazada, impacto en catálogo/tenants/menús/prompts/variables/tools/SoR/país/migración y actualización de este plan. Los cambios compatibles incrementan versión menor; cambios de objeto, autoridad, taxonomía o exclusión incrementan versión mayor y exigen nueva migración/piloto.

El programa se considera completamente terminado únicamente cuando las 76 configuraciones canónicas y los cinco IDs legacy tienen estado explícito y ninguna configuración comercializada conserva gates obligatorios abiertos. Los perfiles no certificados pueden seguir en `waitlist`, `legacy_only`, `preview` o `pilot` sin convertir esa dependencia externa en deuda de código oculta.
