# Entrega posterior a herramientas aprobadas

La aprobación y ejecución del comando conservan su registro original. Al finalizar una reanudación, el resultado confirmado del ledger crea los efectos de entrega y el evento `tool.approval.effects_requested` en la misma transacción. El consumidor continúa la entrega; nunca vuelve a ejecutar el comando.

## Contrato y recuperación

- `tool_approval_effects` guarda ticket, tipo, índice del resultado, estados, leases y códigos de error. No duplica contenido, teléfonos, URLs ni credenciales.
- BullMQ recibe únicamente `tenantId`, `ticketId` y `effectId`, con identidad determinística. Una excepción al agregar el trabajo no elimina esa identidad. Los reintentos seguros conservan el mismo trabajo.
- El trabajador obtiene el resultado autorizado desde el ledger y verifica tenant activo, conversación, contacto, canal, aprobación y borrado. Revisa suscripción y credenciales actuales antes del envío.
- Una transacción compartida con el mecanismo de privacidad impide que el borrado del contacto concurra con la hidratación y el intento de entrega. El lease se comprueba nuevamente antes de llamar al proveedor; los correos de handoff lo comprueban después del renderizado, junto al envío.
- El intento queda persistido antes de cualquier efecto externo. Un timeout, caída posterior al inicio o lease vencido deja `reconciliation_required`; no provoca un segundo envío o handoff. Los fallos previos al intento pueden reintentarse hasta cinco veces.
- El evento y la cola se recuperan desde el cron existente. El panel lee el estado separado de ejecución mediante su refresco periódico y al recuperar foco/conexión.

## Alcance verificado

Se entregan imágenes de las herramientas locales de producto, propiedad, anuncio, vehículo y portafolio; enlaces que coinciden con una operación de pago canónica exitosa; y handoff solicitado por el resultado del dominio. Marcadores de herramientas MCP o bloqueos técnicos no se convierten en instrucciones locales de entrega.

Los canales de entrega asíncrona incluidos son WhatsApp, Instagram, Messenger, Telegram y Web Chat. `sent` demuestra aceptación del proveedor; no demuestra recepción ni lectura. En Web Chat, `stored` indica que el mensaje quedó guardado en el historial, inicialmente con estado `pending`. Sólo un recibo de la sesión autenticada cambia ese mensaje a `delivered`; tampoco demuestra lectura humana. El efecto `completed` de handoff indica que el comando local terminó. Un fallo posterior a registrar el handoff conserva ese estado de conversación y expone la incertidumbre de la notificación.

El envío de plantillas de correo devuelve un booleano que no distingue ausencia de plantilla de un fallo SMTP después de un posible envío. Por ello la ruta durable no intenta un correo alternativo después de `false` o una excepción: registra reconciliación sin duplicar mensajes. Los llamadores anteriores conservan su comportamiento de fallback.

Desde `e8cea802`, las imágenes y enlaces aprobados de Web Chat comprueban también la autoridad operativa de la propuesta en la misma transacción del mensaje y su recibo. Los recibos ya guardados no se revocan por publicar otra configuración. Los fallos locales que revierten la transacción se registran mediante CAS después del rollback, conservando el límite de recuperación y sin convertir un resultado confirmado en un fallo por perder el ACK. Pruebas y límites en [Autoridad del agente en entregas aprobadas](approved-webchat-agent-authority.md); las demás rutas de entrega todavía requieren su propio control de versión.

Desde `92f9d2fa`, esa comprobación incluye el routing vigente de la conexión. La identidad histórica de la conversación no bloquea la propuesta legítima de otro agente; un cambio de prioridad sí impide guardar una entrega pendiente del agente desplazado. El scope se obtiene del ledger privado y la comprobación termina junto con el COMMIT del mensaje.

## Evidencia

- 12 casos con PostgreSQL 17.11 desechable: transacción de finalización/evento, cola por referencias, envío único, borrado, fallo previo al envío, timeout del proveedor, handoff parcialmente comprometido, URL de pago verificada, lease vencido, cambio de conversación, exclusión mutua con borrado y servicio de handoff real con éxito/error/resultado SMTP falso.
- Suites de contratos de cola, workflow, controles, handoff, autorización de suscripción, fence de correo y bootstrap de NestJS. Última tanda: 16 suites, 117 pruebas aprobadas.
- Los ensayos no enviaron mensajes, correos ni pagos a proveedores reales. Los datos pertenecen exclusivamente a namespaces desechables; cada suite elimina sus propias tablas al terminar.

## Límites explícitos

- Web Chat comparte transporte persistido para respuestas del asistente, de personas y de efectos aprobados. Su recuperación, aislamiento y pruebas se describen en [web-chat-durable-delivery.md](web-chat-durable-delivery.md).
- La recepción/lectura del cliente y la reconciliación manual de intentos inciertos requieren recibos o procesos adicionales. No se ofrece reanudación ciega desde el panel.
- El outbox de notificaciones del settlement de citas queda fuera de esta tanda; este documento no lo declara resuelto.
