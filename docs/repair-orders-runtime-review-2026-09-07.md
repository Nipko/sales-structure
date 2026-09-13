# C2/E1 — Ciclo canónico de taller

Fecha: 7 de septiembre de 2026. Revisión de implementación y pruebas locales; no certificación comercial del agente ni prueba de proveedores.

## Hallazgos reproducidos

La primera ejecución sobre PostgreSQL 17.11 y PrismaClient real produjo siete fallos en ocho escenarios. El octavo —rollback al fallar el evento— ya funcionaba.

| Problema anterior | Comportamiento corregido |
| --- | --- |
| Seis aperturas concurrentes de la misma solicitud podían colisionar al crear el vehículo. | Locks transaccionales por clave y contacto preceden cualquier modificación de vehículo; una apertura, un vehículo y un evento. |
| Reutilizar una clave con síntomas diferentes devolvía éxito para la orden anterior. | Huella del intake en metadata; payload distinto devuelve conflicto. Otra clave legítima puede crear otra orden del mismo vehículo. |
| Se aceptaban cita ajena/cancelada y conversación ajena. | Referencias exactas del mismo contacto; la cita debe estar confirmada o completada. El rechazo ocurre antes de modificar el vehículo. |
| Una aprobación leída antes de editar el presupuesto aprobaba el nuevo importe. | Términos canónicos en los argumentos firmados de consentimiento y verificación de versión/hash bajo lock de fila antes de decidir. |
| Un contacto borrado podía abrir o modificar órdenes. | Fence compartido de privacidad, incompatible con el borrado exclusivo, y tombstone por contact_id. También se bloquean lecturas del cliente borrado. |
| La misma placa con VIN distinto sobrescribía la identidad del vehículo. | Conflicto explícito; VIN/placa que apuntan a vehículos distintos requieren revisión del taller. |

Se reprodujeron además dos fallos durante la integración: el lock de privacidad del control de herramientas devolvía `void`, incompatible con Prisma, y retirar una fecha prometida enviando `null` conservaba la fecha anterior por `COALESCE`. El lock lleva `::text`; las actualizaciones operativas distinguen campo omitido de retiro explícito. La prueba de retiro de fecha/diagnóstico falló antes y pasó después.

## Contrato operativo

`RepairOrdersService` sigue siendo el único writer de las cinco herramientas existentes. No se agrega otro motor de órdenes al sandbox.

- `create_repair_order` registra relato del cliente, vehículo y referencias válidas. No inventa diagnóstico, presupuesto, técnico, capacidad o entrega. La transacción conserva evento e intake juntos. Un fallo de evento revierte también el vehículo.
- `list_my_repair_orders` y `get_repair_order` restringen la lectura al contacto actual y conservan la distinción entre síntoma y diagnóstico del técnico.
- `approve_repair` sólo registra la decisión sobre el presupuesto existente. Los términos incluyen orden y versión, vehículo, conceptos, importe exacto, moneda, notas y fecha prometida si existe. Un cambio requiere nueva confirmación; la comparación se repite dentro del writer para cubrir cambios posteriores al preflight. El cliente no puede proporcionar términos alternativos.
- Un «no» al desafío de aprobación no aprueba ni se transforma en rechazo financiero automáticamente. Registrar el rechazo del presupuesto es una decisión distinta, propuesta y confirmada explícitamente.
- `cancel_repair_order` permite los estados previos al trabajo; `in_progress`, `ready` y los cierres se remiten a revisión del taller. No cancela citas enlazadas, no libera un recurso que nunca reservó y no realiza reembolsos. Iniciar trabajo y cancelar contra la misma versión no pueden triunfar ambos.
- La API humana de decisión requiere `expectedVersion`, actor autenticado y evidencia. El dashboard envía la versión que muestra y vuelve a consultar después de un error antes de repetir una decisión.
- Diagnóstico, inspección, presupuesto, técnico, totales finales, estados de ejecución y entrega siguen siendo operaciones humanas. Una entrega registrada no prueba cobro, recepción por el cliente ni cumplimiento técnico de la reparación.

La autorización del contacto corresponde al nivel A1 ya declarado por las herramientas. No certifica propiedad legal del vehículo. Los registros humanos conservan su ruta administrativa; los lectores conversacionales no obtienen datos de otro contacto.

Las decisiones y cancelaciones conservan términos y hash en metadata y evento. Un reintento puede devolver el resultado ya registrado sin otro evento. Un presupuesto nuevo elimina la decisión anterior vigente; el historial de eventos permanece. Las claves legacy sin huella no se reinterpretan como solicitudes nuevas equivalentes: si alcanzan el writer, exigen revisión en lugar de producir un replay ambiguo.

## Evaluación aislada y plantilla

Sólo los tres writers de taller pasan a `audited`, con `canonicalOnly`. Continúan bloqueados en Agent Test de lectura y en la ruta antigua sin namespace. El namespace incluye vehículo, orden y eventos, replica constraints y claves foráneas, y valida su lease antes de ejecutar el writer real. No se habilita ninguna otra familia en este cambio.

Fixtures explícitos incorporan presupuesto propio pendiente, reparación propia en curso y orden de otro contacto. Las pruebas de intake cuentan únicamente filas nuevas (`external_id IS NULL`); las órdenes sembradas no producen éxitos o fallos falsos de esas aserciones. La tabla de contactos sintética respeta sus columnas obligatorias reales.

La plantilla `automotriz/taller` gana 13 escenarios propios por idioma (52 en es/en/pt/fr), además de sus escenarios de citas ya existentes: apertura, repetición, consulta sin confirmar, lectura de orden existente, aprobación, rechazo, ausencia de consentimiento, objeto ajeno y cancelación permitida/prohibida. Las acciones positivas requieren herramienta y estado persistido propio. Los packs se integran en la composición común y sus referencias se resuelven con los fixtures del run.

## Evidencia y límites

Validación final: **169 pruebas, 12 suites, todas aprobadas**, incluyendo **20 escenarios PostgreSQL reales**. API y dashboard `tsc --noEmit` aprobados; bootstrap del API aprobado.

La suite `repair-orders.postgres.spec.ts` ejecuta `PrismaClient`, `RepairOrdersService`, `AIToolExecutorService`, `ToolExecutionControlService` y `IsolatedEvalNamespace` reales. Comprueba:

- DDL productivo de taller, constraints, claves foráneas, CAS, reintentos simultáneos, fallo de evento y recuperación;
- ledger y firma de consentimiento, pregunta y rechazo sin aprobación, cambio de presupuesto con nueva confirmación, decisión/cancelación repetidas;
- ciclo humano hasta entrega, retiro de datos operativos obsoletos, rechazo de referencias ajenas y privacidad;
- escritura bloqueada por el lock de borrado, comprobada en `pg_locks`, y rechazo después del tombstone;
- recorrido de herramientas en los cuatro idiomas dentro de namespaces propios, fuente intacta y eliminación del namespace al finalizar.

Los mensajes están guionados para probar controles; no se ejecutó un proveedor LLM ni se midió la calidad semántica de sus respuestas. Los nuevos packs permiten esa evaluación posterior mediante el gate existente. No se hicieron llamadas de canal, OTP, cobros, notificaciones o calendarios. No se afirma haber validado visualmente el dashboard: el entorno de navegador continúa bloqueado según la auditoría visual previa.

Reproducción: usar `REPAIR_ORDERS_TEST_DATABASE_URL` contra una base desechable de loopback cuyo nombre termine en `_eval_isolation`, y ejecutar la suite con Jest. Sin esa variable la suite se omite. Cada ejecución crea un esquema fuente con UUID, namespaces con leases y una fila de tenant sintética; al terminar elimina exactamente esos objetos. La instancia utilizada fue el contenedor propio `parallly-knowledge-d2-20260907-k17`, puerto 55439, almacenamiento tmpfs. No se accedió a datos de producción.
