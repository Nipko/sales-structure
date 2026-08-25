# Evidencia de implementación — Fase 5, Taller P09–P10

Fecha: 25 de agosto de 2026

Estado: **núcleo nativo de Taller mecánicamente completo; promoción, migración legacy, DMS y piloto permanecen separados**.

Este documento acompaña el [plan definitivo](./vertical-approved-implementation-plan-2026-08-24.md) y registra el primer bloque de Profundidad de producto. No declara cerrada toda la Fase 5 ni certifica Taller en producción.

## 1. Veredicto

`automotriz/taller` dejó de heredar la experiencia de un concesionario. Su objeto operativo canónico es ahora `repair_order`, separado de:

- el vehículo de inventario que vende o alquila un concesionario;
- la cita de recepción o agenda;
- la oportunidad comercial del CRM;
- el estimado sometido a aprobación;
- el total final del trabajo.

La tarea diaria llega en una interacción desde el menú a **Órdenes de taller**. El agente y el equipo humano leen y escriben sobre el mismo registro; cada writer devuelve Active Object y deep link al registro visible.

## 2. Cobertura de P09 y P10

| Criterio aprobado | Resultado implementado | Frontera conservada |
|---|---|---|
| Intake seguro | RO exige contacto, vehículo identificado por placa o VIN y motivo reportado. Los síntomas se guardan como relato del cliente. | El agente no escribe diagnóstico ni inventa causa, repuesto, duración o precio. |
| Agenda y recepción | Taller conserva `appointments`; la RO puede enlazar una cita sin convertirse en cita. | Una cita legacy no se transforma automáticamente en RO. |
| Vehículo/cliente | `customer_vehicles` representa vehículos propiedad del cliente y exige ownership. | No comparte SoR con `vehicles`, que sigue siendo inventario de concesionario/alquiler. |
| Estimado y aprobación | Estimado versionado, líneas y total exacto; estado `awaiting_approval`; aprobación/rechazo por ruta exclusiva y evidencia atribuible. | El endpoint genérico de estado no puede falsificar aprobación. El estimado y el total final siguen separados. |
| Técnico | Sólo puede asignarse un `staff_member` activo; la UI usa el catálogo humano existente. | Bahías, parts catalog y dispatch avanzado requieren el alcance DMS/recursos posterior. |
| Seguimiento | Lifecycle explícito: recepción, diagnóstico/cotización, espera de aprobación, reparación, listo, entrega, rechazo o cancelación. | No se saltan estados ni se reabren terminales. |
| Operación visible | Registro web con búsqueda, filtros, detalle, creación manual, estimado, decisión, detalle técnico, transición e historial. | Móvil profundo y piloto de usabilidad pertenecen a promoción/certificación. |
| Analítica operativa | Contadores autoritativos de abiertas, esperando aprobación, listas y entregadas en 30 días. | KPIs históricos/costeo DMS y benchmarks de taller requieren fuente y piloto. |
| Active Object | `repair_order` está en manifest, contexto activo, policy, writer mapping y deep link `/admin/repair-orders`. | Oportunidad, cita y estimado nunca reciben el mismo label/ID. |
| Migración legacy | El modelo admite vínculos `appointment_id`, `opportunity_id`, `source_system` y `external_id`; no hay renombre destructivo. | El preview/dry-run y revisión de candidatos se ejecutan en Fase 7, después del inventario productivo. |

## 3. Contrato de datos e integridad

Se agregaron tres tablas tenant al único template canónico:

- `customer_vehicles` con FK a contacto, identidad mínima placa/VIN, kilometraje no negativo y unicidad por propietario;
- `repair_orders` con FKs, estados cerrados, montos en centavos, moneda ISO, optimistic version, idempotency key y referencia externa única;
- `repair_order_events` como historial inmutable de actor, transición, evidencia y momento.

Reglas relevantes:

- replay de creación se resuelve antes de actualizar kilometraje, evitando un segundo efecto comercial;
- la oportunidad se vincula sólo con evidencia nativa y ownership del contacto;
- un total suministrado debe coincidir exactamente con sus líneas y ser entero seguro;
- la moneda no tiene default Colombia: se exige al publicar el primer estimado y proviene del perfil regional del tenant;
- una decisión de staff exige actor y evidencia; una decisión del agente exige ownership del contacto;
- el total final es obligatorio antes de entregar;
- el kilometraje nunca retrocede;
- el control de versión evita que dos operadores sobrescriban silenciosamente la misma RO.

## 4. Cohesión agente, tools, prompts y menús

El grupo `repairOrders` publica cinco tools bajo el resolver efectivo y el ejecutor default-deny:

- `create_repair_order`;
- `list_my_repair_orders`;
- `get_repair_order`;
- `approve_repair`;
- `cancel_repair_order`.

El dominio declara intents para abrir, consultar, aprobar/rechazar y cancelar. Los prompts reciben `repair_order` como objeto principal, términos propios de taller y la prohibición de convertir síntomas en diagnóstico. Taller deja de publicar `vehicle_inventory`, `search_vehicles`, test drive y `/admin/vehicles`.

La navegación queda ordenada como trabajo diario:

1. Agenda/recepción existente;
2. Órdenes de taller;
3. CRM e Inbox compartidos;
4. configuración/catálogos en sus secciones correspondientes.

Las cadenas nuevas existen en español, inglés, portugués y francés. El Browser E2E verifica que el tenant Taller entra al registro correcto y no ve **Vehículos** de concesionario.

## 5. Compatibilidad productiva

- No se agregó ninguna variable de entorno.
- No se modificó ninguna variable productiva ni se exigió un secreto nuevo.
- No se habilitó DMS ni writer externo.
- No se amplió `INTEGRATION_WRITE_PROVIDERS`.
- Las configuraciones legacy de agentes conservan sus valores; el manifest agrega la capacidad efectiva únicamente al subtipo canónico Taller.
- El DDL es aditivo e idempotente. Aplicarlo en producción continúa sujeto al smoke PostgreSQL del pipeline, backup y verificación tenant.
- Los demás subtipos automotrices conservan su SoR: concesionario usa inventario, repuestos usa catálogo y alquiler usa reservas de recurso.

## 6. Evidencia local

Resultados observados sobre el worktree de este bloque:

- TypeScript: shared, API, dashboard, landing, WhatsApp y mobile limpios.
- API focal: 2 suites / 22 pruebas, cero fallos.
- API completa: 382 suites aprobadas, 1 omitida; 3.631 pruebas aprobadas, 10 omitidas; cero fallos.
- Dashboard: 31 suites / 277 pruebas, cero fallos.
- Dashboard production build: 144 rutas, incluida `/admin/repair-orders`.
- Landing: claims competitivos 18/18 y build de 37 páginas.
- Prisma schema: válido con URLs efímeras sólo para validación.
- Matriz contractual estática: 1.660/1.660 escenarios aprobados; `bootstrapCertified:false`.
- i18n ES/EN/PT/FR: JSON válido.
- Browser E2E focal: 1/1 escenario Taller reportó `ok`; en Windows los web servers del runner requirieron cierre manual después del resultado.

Los workflows de Deploy y Vertical Quality incluyen las nuevas suites de servicio y tools. El run Linux remoto, su PostgreSQL/Redis, migración tenant, Browser E2E y deploy son la evidencia de promoción.

## 7. Qué no queda cerrado

Este bloque no autoriza afirmar que Taller está certificado. Permanecen:

1. preview/dry-run de citas o solicitudes legacy candidatas a RO, con revisión humana y rollback;
2. ejecución de la migración tenant y verificación en PostgreSQL real;
3. DMS/parts catalog, bahías/capacidad, inventario de repuestos, facturación y pagos profundos;
4. revisión experta de terminología, estimate/garantía y política por país;
5. Browser E2E completo remoto, canary y piloto con 3–5 talleres;
6. reconciliación y certificación por versión antes de habilitar cualquier DMS externo;
7. promoción de availability o claims comerciales únicamente después del sign-off.

Al emitir este corte, el siguiente bloque recomendado era P11 Alquiler. Ese bloque quedó implementado después en U74 y su evidencia vive en [`vertical-phase5-rental-evidence-2026-08-25.md`](./vertical-phase5-rental-evidence-2026-08-25.md). La cola vigente de Fase 5 continúa con P08 y P12–P24.
