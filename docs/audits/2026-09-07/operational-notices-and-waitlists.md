# Confirmación, listas de espera y entrega durable

## Resultado y alcance

La confirmación de una cita pagada conserva `calendar_sync_outbox` y añade el aviso al cliente en la misma transacción que confirma la cita. Una caída posterior de Redis ya no elimina el aviso. La promoción de una reserva de gimnasio y la promoción educativa también escriben su aviso dentro de la transacción que asigna el cupo y ajusta créditos/capacidad.

Educación ahora admite una lista de espera real. `enroll_student` requiere `allowWaitlist=true` y una nueva confirmación antes de entrar en espera. Los términos canónicos incluyen curso, cohorte, fechas, horario, ubicación, precio, moneda y requisitos. Se firman en la confirmación y se vuelven a comparar dentro de la transacción. Si cambian durante la espera, el registro pasa a `waitlist_review` y no consume cupo; el agente solicita una aceptación nueva. Los candidatos elegibles se promueven por orden de llegada. Cancelar una entrada en espera no devuelve un cupo que nunca recibió.

La matrícula conserva sus términos de venta en metadata. La resolución de pagos usa ese precio y esa moneda, no el catálogo editable. `waitlisted` y `waitlist_review` no son referencias pagables. Matricular o promover no cobra ni acredita un pago. Los registros históricos sin términos verificables requieren revisión antes de crear un enlace nuevo.

## Entrega y recuperación

`operational_notice_outbox` guarda sólo identidades, estado y referencia del proveedor. Redis recibe `{ operationalNotice: { tenantId, noticeId } }`. No recibe teléfono, correo, texto ni documentos. El consumidor usa el procesador de `outbound-messages` y el `ChannelGatewayService` existentes; para Web Chat usa el `WidgetMessageStore` común.

Antes de enviar, vuelve a leer el estado de la cita/reserva/matrícula, su contacto, conversación, canal y actividad del tenant. Retiene el fence de privacidad y bloqueos de lectura de los hechos durante el envío. Una cancelación, un contacto borrado o un cambio de identidad invalidan el aviso. El helper de borrado elimina los vínculos de contacto/conversación/referencia del proveedor y suprime el trabajo pendiente bajo el mismo fence de Compliance.

| Estado | Evidencia |
| --- | --- |
| `pending` / `queued` | Hay intención durable; no prueba envío. |
| `processing` | Hay un intento con lease; no prueba recepción. |
| `sent` | El proveedor devolvió aceptación. No prueba entrega al destinatario. |
| `stored` | Web Chat guardó el mensaje y el resultado del outbox en una transacción. El mensaje sigue `pending` hasta el ACK del navegador. |
| `failed` | Falló antes de comenzar el envío externo; admite reintento acotado. |
| `suppressed` | Los hechos, la identidad o una restricción vigente impiden enviar. |
| `reconciliation_required` | Hubo incertidumbre después de iniciar un efecto externo, o falta evidencia histórica. No se reenvía automáticamente. |

La recuperación por minuto conserva la identidad del trabajo BullMQ; recupera incluso un job completado cuya intención local sigue pendiente. Una lease de Web Chat vencida puede reintentarse porque mensaje y resultado comparten transacción. Una lease de transporte externo vencida queda para reconciliación. Los fallos previos al envío tienen un máximo de cinco intentos del outbox.

Los avisos históricos de citas ya confirmadas sin evidencia de entrega se registran como `historical_delivery_unverified`; no se presupone que nunca fueron enviados. Las promociones anteriores a este cambio no tienen un marcador confiable y no se reconstruye ni certifica su entrega. El consumidor de calendario existente mantiene sus propias revisiones y reglas de reconciliación.

`GET /operational-notices/:tenantId`, con JWT, aislamiento de tenant y rol admin/supervisor, expone los estados y referencias para revisión. No hay un endpoint que convierta un resultado incierto en un reenvío automático. La revisión del proveedor y una interfaz de resolución operativa dedicada quedan como trabajo posterior.

## Correo y límite temporal

El fallback de correo valida configuración antes de iniciar el efecto y abre una conexión SMTP privada por intento. El límite total es 25 segundos, inferior al fence transaccional de 110 segundos. Al terminar o agotar ese límite, destruye su socket y espera el cierre; no cierra el transporter compartido ni vuelve a enviar DATA. Esto incluye conexiones TLS directas y STARTTLS. Un timeout después de DATA sigue siendo incierto: cerrar la conexión no demuestra que el servidor no haya aceptado el correo.

## Evidencia

- 16 suites / 112 pruebas pasan en la tanda de regresión.
- `operational-notice.postgres.spec.ts`: 17 escenarios con DDL real y PostgreSQL desechable, incluido el adaptador Prisma real, rollback de cita+calendario+aviso, Redis caído, FIFO/cancelación/replay, términos cambiados, Web Chat persistido/ACK, borrado, leases, preflight fallido y entrega incierta.
- `isolated-canonical-commands.spec.ts`: 14 escenarios contra comandos, ledger y namespaces reales. El nuevo escenario prueba que el mismo «sí» de una matrícula sin cupo no autoriza entrar en espera: exige una propuesta y un mensaje posterior, sin cupo ni referencia de pago y sin duplicar el registro en replay.
- `conversations.runtime-integrity.spec.ts`: el core conserva el diálogo de aceptación recuperable y no ejecuta un segundo writer ni escala ese caso a una persona. La excepción acepta sólo resultados canónicos revisados de educación/citas, no un `requiresConfirmation` arbitrario de MCP.
- `bounded-smtp*.spec.ts`: siete pruebas con servidores TCP/TLS locales; incluyen acuse perdido después de DATA, independencia entre conexiones y cierre del socket tras STARTTLS.
- Regresión de calendario, pagos, propiedad de contacto, créditos y cola común. No se enviaron mensajes a personas ni a proveedores reales.

Esta tanda no certifica todos los escritores de la plataforma, todos los proveedores ni resultados económicos de producción. Tampoco agrega listas de espera nuevas a dominios distintos de educación ni reescribe el sistema de recordatorios generales.
