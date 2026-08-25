# Evidencia de cierre de código — Fase 4 P25–P32

Fecha: 24 de agosto de 2026

Estado: **cierre mecánico local completo; promoción y certificación todavía separadas**.

Este registro acompaña el [plan definitivo](./vertical-approved-implementation-plan-2026-08-24.md). Demuestra qué quedó implementado para las decisiones transversales P25–P32 y evita confundir tres estados distintos:

1. `mechanically_complete`: contrato, runtime, UI y pruebas existen;
2. `promoted`: migraciones, CI, Browser E2E y despliegue concluyeron;
3. `certified`: sandbox/proveedor, canary, evidencia operativa y sign-off aplicables concluyeron.

Ninguna decisión de producto P25–P32 queda abierta. Lo pendiente al cerrar este documento son gates de promoción, operación o proveedor, no preguntas de alcance.

## Matriz de cierre

| Decisión | Resultado implementado | Evidencia local | Gate que no se simula |
|---|---|---|---|
| P25 — correo progresivo | Estado persistente `unverified/pending_change/verified/restricted`; policy compartida; guard de servidor para activaciones, secretos, pagos, invitaciones, exportaciones, outbound y administración sensible; workers revalidan al actor; lectura, onboarding y Agent Test siguen disponibles; cambio/resend y Google `email_verified` cubiertos. | Contratos de guard, lifecycle, OAuth, invitaciones, auth y Browser E2E; el banner no es la frontera de seguridad. | Entrega/rebote/rescate y métricas con el proveedor real de correo; auditoría shadow de legacy antes de enforcement masivo. |
| P26 — SMS retirado | Alta, conexión, test, compra, paquetes, pricing, selector y menús retirados; endpoints de alta responden `410` tipado; callbacks, saldos, ledger, órdenes y trazabilidad legacy se conservan. | Contrato de producto retirado, navegación, i18n y dashboard. | Política de retención/cierre de obligaciones de tenants legacy; cualquier reapertura exige ADR nuevo. |
| P27 — analytics por cuenta | Eventos incluyen cuenta y label histórico; atribución explícita/conversación/contacto reciente; agregados/API/BI/CSV/dashboard separan cuentas, desconectadas y `unknown`; identificadores no son credenciales. | Pruebas de reconciliación, canales certificados, API, BI, export y vista. | Backfill productivo solo cuando exista evidencia; lo ambiguo permanece `unknown`; reconciliación canary contra totales reales. |
| P28 — Email interno | Ruta self-service redirige, tile/setup/selector/claims se retiran y el adapter inbound interno se preserva. | Navegación, documentación y superficies públicas consistentes. | Reapertura únicamente con los prerequisitos del [ADR](./email-channel-reopening-adr-2026-08-24.md). |
| P29 — planner híbrido | Contrato compartido versionado para intents `informational/guided/transactional/regulated`; paquetes autorales declaran workflow/readiness; prompt recibe autoridad y `defaultDeny`; primera cola de diez flujos queda identificada y bloqueada si faltan tools. | Contratos de intención, proyección exacta de tools y ensamblado del turno. | Las máquinas de estado completas de la primera cola se construyen en Fase 5; este paquete no finge que un manifiesto equivale a un FSM ejecutable. |
| P30 — freshness común | Proyección canónica con provider, conexión, recurso, intentos, éxito, `asOf`, intervalo, `freshUntil`, health, freshness, motivo, versión y observación; tool trace y UI consumen la misma evaluación. | Unitarios de health/freshness, providers, tools y proyección visual. | Comparación shadow del reloj antiguo/nuevo y alertas contra cadencia real en producción. |
| P31 — binding granular | Tabla tenant idempotente, resolución por generación, conflictos, tombstone, remapeo y UI de mapping; tools registran binding y fallan cerrado en conflicto o resolución inválida. Sin mapping exacto se conserva lectura externa tenant-wide y se bloquean writers. | Servicio/controller/UI y pruebas de aislamiento, conflicto, invalidación y traza. | Operación mixta por sede/recurso requiere adapters que propaguen un `resourceId` real y certificación provider; el runtime actual usa recurso tenant-wide `all` donde el adapter todavía no discrimina. |
| P32 — Mindbody live | Se separan `mirrored_discovery` y `available_live`; el espejo nunca se usa para disponibilidad; sin capacidad live se responde `live_capacity_unavailable` con handoff, sin reservar. | Boundary tests, health, tool response, UI y Browser E2E. | Credenciales sandbox, versión de API, rate limits, book/cancel idempotente y conciliación con Mindbody. |

## Compatibilidad productiva y variables

- No se agregó ninguna variable de entorno obligatoria.
- No se habilitó ningún provider writer ni se amplió `INTEGRATION_WRITE_PROVIDERS`.
- La precedencia continúa siendo `nuevo explícito → configuración legacy compatible → default seguro`.
- Los tenants verificados mantienen su flujo. Los no verificados pueden entrar y configurar en modo no operativo, pero el servidor bloquea los efectos sensibles.
- Cuando un adapter todavía no entrega identidad de recurso, la lectura externa tenant-wide existente se conserva; las escrituras quedan apagadas para evitar split-brain.
- Email inbound, SMS legacy y sus datos históricos no se eliminan durante este corte.

## Cambios de esquema y orden seguro

1. La migración pública `20260824230000_add_email_verification_state` añade y backfillea el estado desde `email_verified/is_active`, conserva el booleano durante la ventana compatible y aplica un `CHECK` cerrado.
2. La migración tenant añade atribución de cuenta a `analytics_events` e `integration_resource_bindings` mediante DDL idempotente (`IF NOT EXISTS`).
3. El pipeline ejecuta `prisma migrate deploy` y luego `test:migrate:tenants` antes de recrear contenedores.
4. El primer arranque funciona con las variables actuales; ningún secreto nuevo es prerrequisito.
5. Activar adapters, writers o claims sigue siendo una promoción posterior y separada.

## Verificación local previa a promoción

- API: **380 suites aprobadas**, una suite omitida; **3.607 tests aprobados**, 10 omitidos, cero fallos.
- Dashboard: **31 suites / 275 tests**, cero fallos.
- TypeScript: `shared`, `api`, `dashboard`, `landing`, `whatsapp` y `mobile` limpios.
- Catálogos i18n: nueve JSON modificados parsean correctamente.
- Builds: shared, landing (37 páginas estáticas/SSG y contrato de claims) y dashboard (143 rutas) completaron correctamente.
- Browser E2E local: **28/28 escenarios reportaron `ok`** (15 landing y 13 dashboard). En Windows el runner no cerró sus web servers después del último resultado y se detuvo manualmente; no quedaron puertos de prueba escuchando. El workflow Linux remoto sigue siendo la autoridad de promoción y de cleanup.
- Prisma: schema validado con URLs locales efímeras; la ejecución contra PostgreSQL corresponde al gate de migración de CI.
- `git diff --check`: limpio.

## Pendientes después de promover este corte

1. Ejecutar inventario read-only y shadow checks en producción antes de migrar o activar tenants.
2. Obtener sandbox/credenciales/versiones de Hostaway, Mindbody y las olas de proveedores aplicables.
3. Implementar en Fase 5 los FSM transaccionales/regulados identificados por P29 y los objetos P08–P24 todavía pendientes.
4. Hacer revisión experta de dominio/país donde el paquete permanece `draft` o `waitlist`.
5. Ejecutar canaries, backfill demostrable de analytics, conciliación, rollback y sign-off de Fases 7–8.

Estas dependencias permanecen tipadas y fail-closed. No bloquean promover el contrato transversal, pero sí bloquean declarar una integración, perfil o país como `certified`.
