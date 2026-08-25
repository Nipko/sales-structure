# Evidencia de implementación — Fase 5, Alquiler P11

Fecha: 25 de agosto de 2026

Estado: **núcleo nativo de `automotriz/alquiler` mecánicamente completo; migración tenant, rails externos, revisión experta, piloto y certificación permanecen separados**.

Este documento acompaña el [plan definitivo](./vertical-approved-implementation-plan-2026-08-24.md). No declara cerrada toda la Fase 5 ni convierte una verificación local en certificación productiva.

## 1. Veredicto

El subtipo dejó de ser un callejón entre inventario y una pantalla manual. La tarea diaria abre en **Reservas** y la flota permanece como catálogo separado. El agente puede consultar disponibilidad y **presentar una solicitud**, pero no afirmar que existe una reserva: identidad, licencia, cobertura/seguro y pago nacen `pending` y sólo un administrador o supervisor puede resolverlos con evidencia o una razón explícita de no aplicabilidad.

El flujo autoritativo es:

`solicitud → revisión humana → reservada → inspección/entrega → inspección/devolución`

Los rechazos, cancelaciones, decisiones de elegibilidad, inspecciones y daños quedan atribuibles. Una solicitud exitosa devuelve `requestSubmitted:true`, `pendingReview:true` y `reservationConfirmed:false`.

## 2. Cobertura de P11

| Criterio aprobado | Resultado implementado | Frontera conservada |
|---|---|---|
| Disponibilidad | Consulta y writer usan el mismo rango semiabierto y los mismos estados ocupantes. | Una solicitud pendiente no bloquea la flota; la aprobación vuelve a comprobar disponibilidad. |
| Concurrencia | Advisory lock por vehículo tanto en intake como al aprobar; sólo una solicitud puede convertirse en reserva para el rango. | Puede haber solicitudes pendientes competidoras; la segunda aprobación falla con conflicto tipado. |
| Intake de conductor | Contacto CRM obligatorio, nombre/teléfono, edad declarada, país/categoría de licencia, sedes y extras estructurados. | Edad o documento declarado no equivale a elegibilidad. |
| Verificación | Cuatro dimensiones `pending/verified/rejected/not_required`, actor, momento, evidencia y motivo. | Create descarta cualquier intento de colar verificación; tenant agent no revisa ni aprueba. |
| Depósito | Monto/moneda/estado y referencia de comprobante; retener exige motivo; estados con movimiento exigen evidencia. | No se declara cobro, devolución ni retención por PSP sin referencia humana/proveedor. |
| Contrato | Documento HTTPS, estado de firma, método y referencia de evidencia. | Nunca se guarda el OTP crudo; firma legal certificada sigue dependiendo del proveedor/país. |
| Entrega/devolución | Inspección inmutable con kilometraje, combustible, condición, evidencia de handoff y al menos una foto subida desde la misma pantalla. | El endpoint genérico no puede fabricar `picked_up` ni `returned`; el kilometraje no retrocede. |
| Daños | Reporte append-only, monto/moneda opcionales, fotos y vínculo opcional a inspección; evento inmutable. | Cobro/resolución externa del daño no se infiere del reporte local. |
| Operación humana | Lista, filtros, expediente, revisión, aprobación/rechazo, depósito/contrato, inspecciones, daño e historial en `/admin/resource-rentals`. | Móvil profundo y piloto de usabilidad pertenecen al rollout. |
| Agente | Tool A2 con step-up, contacto propietario, slots de conductor/sedes/extras y respuesta comercial honesta. | El agente no ejecuta elegibilidad, depósito, firma, entrega, devolución ni daño. |

## 3. Integridad y seguridad

El template tenant incorpora `version`, `resource_rental_events`, `resource_rental_inspections` y `resource_rental_damages`. El cambio de constraint es idempotente para schemas existentes y conserva los estados legacy.

Reglas verificadas:

- `create` acepta sólo campos de intake; elimina elegibilidad suministrada, kilometraje, depósito adjudicado y firma afirmada;
- aprobación y revisión usan optimistic version y roles de administrador/supervisor;
- aprobar serializa y relee vehículo, rango y reservas ya comprometidas;
- entrega requiere elegibilidad despejada y contrato firmado con evidencia;
- pickup/return requieren kilometraje, condición, handoff y foto tenant válida;
- una referencia OTP numérica de 4–8 dígitos se rechaza como secreto crudo;
- el kilometraje de devolución no puede ser menor al de entrega;
- montos y kilometraje respetan el rango `INTEGER` de PostgreSQL;
- fotos se validan contra `media_files` del mismo schema tenant;
- el historial guarda referencias y actores, no documentos, firmas ni secretos crudos.

## 4. Cohesión de menús, tools y contratos

La navegación efectiva del subtipo ordena:

1. **Reservas** — trabajo diario;
2. **Flota** — catálogo y disponibilidad;
3. superficies compartidas de CRM, conversaciones y configuración según rol.

La pantalla cambia a **Reservas de vehículos** para este subtipo y conserva **Estadías de mascotas** cuando el mismo módulo sirve al dominio pet. Las cadenas existen en español, inglés, portugués y francés.

El workflow determinista de alquiler quedó separado del de boarding: alquiler termina en revisión humana/reserva/rechazo; boarding conserva su reserva inmediata y su propia capacidad. El contrato de dominio agrega conductor, edad y país de licencia; todo dato sensible exige confirmación. Las suites focales nuevas quedan enumeradas en Deploy y Vertical Quality.

## 5. Compatibilidad productiva

- No se agregó ni modificó ninguna variable de entorno.
- No se exige un secreto nuevo para arrancar el deploy.
- No se modifican los fallbacks productivos existentes.
- No se habilitó writer externo ni se amplió `INTEGRATION_WRITE_PROVIDERS`.
- El DDL es aditivo; la sustitución del constraint nombrado preserva filas legacy válidas.
- Las reservas existentes continúan legibles; no se ejecuta reclasificación automática.
- Boarding de mascotas conserva su lifecycle y no hereda la revisión vehicular.
- El tenant sigue usando su moneda operativa; no se introdujo un default Colombia en runtime.

## 6. Evidencia local

Resultados observados sobre el worktree de este bloque:

- TypeScript: shared, API, dashboard, landing, WhatsApp y mobile limpios.
- API focal final: 6 suites / 174 pruebas, cero fallos.
- API completa: 382 suites aprobadas, 1 omitida; 3.638 pruebas aprobadas, 10 omitidas; cero fallos.
- Dashboard: 31 suites / 277 pruebas, cero fallos.
- Builds: shared, API, WhatsApp, dashboard (144 rutas) y landing (37 páginas) aprobados.
- Landing: claims y evidencia competitiva 18/18 aprobados.
- Prisma schema e i18n ES/EN/PT/FR: válidos.
- Browser E2E focal: 1/1 escenario Alquiler reportó `ok`; en Windows los web servers del runner requirieron cierre manual después del resultado.

El run Linux remoto, PostgreSQL/Redis, smoke tenant, Browser E2E completo y deploy son la evidencia de promoción. Este documento se actualiza con sus resultados; no los anticipa.

## 7. Qué no queda cerrado

P11 mecánico no autoriza afirmar paridad certificada con un proveedor vertical completo. Permanecen:

1. dry-run y aplicación del DDL en schemas productivos, con backup, smoke y rollback;
2. inventario/migración de alquileres legacy y revisión de datos incompletos;
3. PSP real para depósito, captura, devolución, retención, conciliación, contracargo y evidencia de settlement;
4. proveedor de e-signature/consentimiento certificado por país si el tenant necesita validez avanzada;
5. sistema externo de rental/fleet, telemática, pricing dinámico, multas, mantenimiento o contabilidad, sólo tras adapter/version/SoR certificados;
6. revisión experta por país de licencia, edad mínima, seguro, tratamiento de PII, contrato, depósito y daños;
7. UX móvil, canary y piloto con 3–5 rentadoras, incluyendo conflictos reales, entrega, devolución y reclamo;
8. promoción de availability y claims comerciales únicamente después del sign-off.

La siguiente cola interna de Fase 5 queda en P08 y P12–P24; las dependencias anteriores no se convierten en código ficticio ni en defaults obligatorios.
