# C2/E1 — Ciclo canónico de catálogo y pedidos

Fecha: 7 de septiembre de 2026. Evidencia local sobre código y bases sintéticas; no certificación comercial del agente ni prueba de proveedores externos.

## Defectos reproducidos

Antes del cambio, las cinco primeras pruebas con PostgreSQL 17.11 y PrismaClient real fallaron:

| Caso | Resultado anterior | Contrato corregido |
| --- | --- | --- |
| Cancelar un producto sin inventario controlado | `stock NULL` se convertía en 2 | Se registra por línea si hubo descuento. Cero significa que no lo hubo; NULL histórico significa desconocido. |
| Dos creaciones concurrentes con la misma clave | Dos órdenes distintas | Lock transaccional de solicitud, huella exacta y clave única. Un replay devuelve la orden existente. |
| Cliente borrado | Se creaba una orden | Fence compartido de privacidad y tombstone antes de leer o escribir objetos del contacto. |
| Conversación de otro contacto | Se aceptaba la referencia | Validación del contacto exacto de la conversación. |
| Fallo al registrar un movimiento de ajuste | El stock quedaba en 13, aunque el movimiento fallaba | Ajuste y movimiento en la misma transacción; vuelve a 10. |

La revisión posterior reprodujo otro defecto de recuperación histórica: dos líneas del mismo producto se compensaban desde el mismo saldo inicial, dejando stock 8 en vez de 10. La compensación ahora acumula cada línea sobre el saldo bloqueado actualizado.

Otros hallazgos corregidos: cantidades fraccionarias truncadas por el executor, precios leídos antes del bloqueo de compra, consentimiento sin precio/moneda vinculados, resultados fabricados en el adaptador de simulación, fallos de lectura presentados como datos vacíos, errores SQL expuestos al agente y documento comercial que confundía el estado manual «pagado» con comprobante de pago.

## Contrato operativo

`CatalogOrderCommands` concentra cotización, creación, consulta propia, cancelación y revisión histórica. `OrdersService` es la fachada administrativa; el executor utiliza el mismo comando con esquema proporcionado por el servidor.

- Crear exige productos únicos y cantidades enteras entre 1 y 10000. Precios y moneda provienen de productos bloqueados en orden de UUID. El cálculo usa centavos enteros exactos y respeta `numeric(15,2)`; no inventa moneda ni precio cero ante datos faltantes.
- El desafío de consentimiento incluye productos, cantidades, precios unitarios, total, moneda y notas. El writer vuelve a calcular estos términos bajo lock. Un cambio posterior a la cotización exige nueva confirmación.
- Cabecera, líneas, descuento de stock y auditoría se publican juntos. Un fallo revierte todo. La misma clave con distinto contenido devuelve conflicto; el mismo contenido permite recuperación sin duplicar.
- `list_my_catalog_orders`, `get_catalog_order` y `cancel_catalog_order` operan únicamente sobre el contacto conversacional actual. Se mantiene la autorización A1 del contrato existente; no se afirma identidad legal adicional.
- La cancelación exige estado pendiente/confirmado y pago pendiente/fallido. Pagos conocidos, estados desconocidos, referencias de proveedor y cobros pendientes o ambiguos requieren revisión separada. Reserva de pago y cancelación toman el mismo lock de orden: no pueden ganar ambas.
- La cancelación restituye sólo los descuentos originales conocidos, una vez por línea. No mueve stock de ventas sin control de unidades, incluso si el negocio comienza a controlarlo después. Un producto eliminado, saldo incompatible o evidencia histórica ausente exige reconciliación.
- Un error técnico de resultado desconocido no afirma rollback. El agente debe consultar la orden propia antes de repetir. Si el comando sí terminó y falla la confirmación del ledger, se devuelve `reconciliation_required` con `persisted:true`, sin exponer contenido potencialmente borrado.

La creación sólo registra una orden pendiente. No implica cobro, liquidación del proveedor, despacho, recepción, receta aprobada ni reembolso. Las herramientas de catálogo no ejecutan pagos o envíos. Los medicamentos que requieren receta siguen bloqueados para compra por agente; la respuesta identifica el producto y requiere revisión humana. Los perfiles cuyo catálogo pertenece a un sistema externo mantienen esa frontera también para los nuevos lectores y cancelador.

## Recuperación histórica humana

La ruta administrativa `POST /orders/:tenantId/:orderId/stock-evidence` admite sólo administradores y supervisores. La decisión nunca se delega al LLM.

El revisor debe indicar todas las líneas desconocidas, una fuente verificable, un motivo y la versión que está viendo. Por línea elige explícitamente cero unidades descontadas o la cantidad original de esa línea. El servidor registra actor autenticado, fecha, fuente, motivo, versión y huella de revisión. Una revisión obsoleta devuelve conflicto; repetir exactamente una revisión aplicada es idempotente.

Registrar evidencia no altera stock ni crea movimientos. La restitución sucede únicamente en una cancelación posterior que supera las demás guardas. No se deduce evidencia a partir del saldo actual ni se reasigna un producto eliminado.

## API y experiencia web

La creación administrativa usa `POST /orders/quote/:tenantId`, presenta los términos y después envía `expectedTermsHash` e `idempotencyKey` a `POST /orders/:tenantId`. Toda edición invalida la revisión anterior. Los cambios de estado envían `expectedVersion`; el dashboard vuelve a consultar después de mutaciones y errores.

La página de pedidos distingue carga fallida de catálogo vacío, permite reintentar, separa estado comercial y pago del proveedor y presenta importes agrupados por moneda. No suma monedas distintas ni suma como ingresos independientes las columnas de pago manual y pago del proveedor. El documento HTML comercial conserva la moneda y escapa los datos; no se presenta como factura fiscal ni prueba de entrega o reembolso. Textos y herramientas incorporan es/en/pt/fr.

El cliente móvil también usa cotización revisada, clave estable de creación y versión esperada para cambiar estado. Editar el formulario invalida la cotización; una respuesta incierta conserva la clave para recuperar el mismo pedido. La interfaz distingue stock desconocido y pago del proveedor, en cuatro idiomas. El flujo real del formulario y los contratos pasaron 88 pruebas en seis suites, y TypeScript móvil pasó. Los binarios anteriores requieren actualización coordinada con el contrato del backend.

## Evaluación y evidencia

Sólo `place_catalog_order` y `cancel_catalog_order` se habilitan como writers canónicos auditados de esta familia. Siguen bloqueados sin namespace propio o autoridad efectiva. Se retiró el INSERT ficticio de catálogo del adaptador antiguo. Los fixtures incluyen órdenes propias existentes, una pagada y una ajena, productos con receta y sin stock, y líneas/movimientos reales.

Los perfiles con catálogo reciben 13 escenarios canónicos por idioma: compra completa, repetición, rechazo, pregunta sin consentimiento, cambio de cantidad, stock insuficiente, receta, consulta propia y cancelaciones positiva, repetida, rechazada, pagada y ajena. Los casos de creación cuentan únicamente órdenes nuevas con una nota sintética explícita; las órdenes preexistentes no producen éxitos falsos. El verificador genérico mantiene su alcance al contacto evaluado: las invariantes exactas del objeto ajeno y los movimientos se comprueban además en las pruebas PostgreSQL.

Validación del corte:

- Suite ampliada de API: 286 casos en 20 suites, con las dos expectativas estáticas antiguas actualizadas y sus suites reejecutadas correctamente. Incluye 24 escenarios con PrismaClient y PostgreSQL reales de catálogo.
- Bootstrap del API aprobado. Suite compartida `isolated-canonical-commands.spec.ts` aprobada en PostgreSQL real, con fixtures de catálogo y sin alterar la fuente.
- Web: 50 pruebas en 3 suites aprobadas; `tsc --noEmit` de API y dashboard aprobado antes de ediciones concurrentes del módulo de releases, sin errores de catálogo en la comprobación posterior.
- Los ciclos reales del executor, consentimiento y namespace se probaron en es/en/pt/fr con mensajes guionados. Pregunta y rechazo no ejecutan; cambiar precio requiere nuevo consentimiento; repetición no duplica; cancelación pagada o ajena no modifica la orden.
- Fallos forzados de movimiento durante creación, cancelación y ajuste revierten los cambios; el reintento posterior funciona. Las pruebas de concurrencia cubren clave repetida, últimas unidades, cancelación repetida, ajustes y reserva de pago frente a cancelación.

No se ejecutó un proveedor LLM ni se midió la calidad semántica de respuestas libres. Tampoco hubo llamadas de cobro, canal, receta o despacho. La inspección visual real sigue impedida por el error del entorno de navegador documentado en la auditoría visual anterior; las pruebas de UI son de componentes, contratos y tipos.

Para reproducir PostgreSQL: configurar `CATALOG_ORDERS_TEST_DATABASE_URL` con una base desechable en loopback cuyo nombre termine en `_eval_isolation` y ejecutar `catalog-orders.postgres.spec.ts` con Jest. Sin variable se omite explícitamente. La prueba utiliza DDL canónico, PrismaClient real, un esquema `tenant_catalog_<uuid>` y leases aislados; limpia exactamente esos objetos al finalizar. La instancia usada fue el contenedor temporal propio `parallly-knowledge-d2-20260907-k17`, puerto 55439, tmpfs. El run compartido usó otro esquema propio en 55437. No se accedió a datos de producción.
