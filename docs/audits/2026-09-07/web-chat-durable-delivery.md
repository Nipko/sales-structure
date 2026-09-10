# Transporte durable de Web Chat

El Web Chat utiliza `WidgetMessageStore` como límite común para las respuestas del asistente, las respuestas humanas y las imágenes, enlaces de pago y traspasos derivados de herramientas aprobadas. Un mensaje se confirma en PostgreSQL antes de anunciarlo al gateway. El anuncio entre trabajador y API contiene únicamente tenant, conversación e identificador del mensaje.

## Identidad y recuperación

- El token JWT, su copia persistida, tenant, configuración activa, origen permitido, contacto y conversación deben coincidir antes de leer, escribir, emitir o confirmar recepción.
- El identificador público del visitante sirve para seguimiento; no concede acceso a una conversación anterior. Una sesión nueva crea una identidad propia. Reanudar una sesión exige su token anterior y lo rota mediante compare-and-swap. Un cliente con un token revocado no recibe los mensajes posteriores.
- La creación inicial de contacto y conversación bloquea la sesión en una transacción: dos pestañas concurrentes comparten una sola conversación autorizada.
- La identidad del mensaje de salida es determinística. Las reanudaciones de un efecto aprobado y los reintentos del mismo turno no crean otro mensaje.
- La reconexión recupera el historial; un sondeo cada 15 segundos recupera mensajes pendientes si se pierde el aviso Redis. Antes de emitir se vuelven a validar las credenciales persistidas y el origen. El loader combina eventos e historial por identificador, conserva el orden y representa imágenes, audio, video, documentos y enlaces HTTPS.
- El historial público excluye notas internas y no expone metadatos de aprobación, ledgers ni identificadores de agentes.

## Qué significa cada resultado

`stored` en un efecto aprobado significa que su mensaje quedó guardado en el historial. La creación del mensaje y el cierre de ese efecto ocurren en la misma transacción. No se repite el comando original para recuperar una entrega local. Un worker que cae antes del commit puede reintentar media o enlaces usando la misma identidad; un handoff con resultado externo incierto sigue requiriendo reconciliación.

Los mensajes nuevos permanecen en `pending` aunque el servidor haya emitido el evento Socket.IO. El navegador confirma `widget:received` para el identificador recibido; sólo la sesión propietaria puede cambiar el mensaje a `delivered`. Eso demuestra recepción por ese cliente autenticado, no lectura humana, visualización de una imagen ni pago realizado. El panel mantiene ejecución y entrega separadas y presenta `stored` en sus cuatro idiomas.

El traspaso conserva el comando canónico de atención. Su aviso describe una conversación registrada en la bandeja, sin prometer que una persona ya respondió. La respuesta humana utiliza el mismo historial y conserva `was_handed_off`, la limpieza del borrador y el tiempo de primera respuesta de la asignación.

El fence de privacidad se mantiene durante la persistencia y la emisión autenticada. Un contacto borrado no puede volver a recibir, escribir ni confirmar un mensaje desde una sesión antigua. El helper `eraseWidgetContactSessions` elimina las credenciales y los datos del formulario previo de todos los contactos vinculados, delimitados por tenant; Compliance lo integra dentro de su transacción de borrado. La cola de aprobaciones y el relay no almacenan contenido ni URLs del cliente.

## Evidencia reproducible

- `widget-delivery.postgres.spec.ts`: PostgreSQL 17.11 desechable con tablas e índices de producción, UUIDs y FKs reales. Incluye separación de visitante/sesión, rotación, creación concurrente, deduplicación, autorización por destinatario y conexión, recibos, borrado, exclusión mutua con privacidad, migración concurrente del constraint, imágenes/enlaces/traspasos aprobados, métricas de respuesta humana y recuperación con una conexión Socket.IO real en loopback.
- `widget-loader.delivery.spec.ts`: ejecuta el JavaScript generado en una VM y verifica deduplicación, orden, recibos repetidos seguros, representación de media y enlace de pago, escape de contenido y eventos humanos intercalados con un stream anterior.
- `conversations.widget-containment.spec.ts`: el mismo coordinador del runtime recibe el canal y la conexión reales; rechaza conversaciones de otra conexión. Se conservan las pruebas de cuotas, borradores, locks y entrega humana condicionada.
- Las suites anteriores de seguridad del widget, aprobación durable, handoff, controles y bootstrap de NestJS forman la regresión. No se realizaron envíos a proveedores externos ni operaciones con datos de producción.
- Resultado de la tanda completa: 28 suites y 198 pruebas aprobadas. Tras la corrección final de recuperación de lease local, se repitieron las dos suites PostgreSQL afectadas: 28 pruebas aprobadas, 16 de Web Chat y 12 de aprobación/entrega. TypeScript del API pasó sin errores.

## Límites de la evidencia

La prueba del loader usa ejecución del código y un DOM mínimo; no sustituye una revisión visual en navegadores móviles. Los recibos provienen del cliente autenticado y no son comprobantes de lectura. El protocolo antiguo puede mostrar los mensajes nuevos por compatibilidad, pero necesita recargar el loader actualizado para emitir recibos. Los timeouts de proveedores externos y el outbox de notificaciones del settlement de citas conservan los límites documentados en la tanda A3.

La API actual de respuesta humana no recibe un identificador de solicitud estable. Un nuevo reenvío HTTP de la misma respuesta puede crear otro mensaje; los eventos y replays de cada mensaje guardado sí se deduplican. La identidad estable de comandos aprobados y turnos del asistente no tiene esa limitación.
