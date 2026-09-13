# Los dos canales que faltaban, el turno entero y los tenants que ya existen

8 de septiembre de 2026. Continuación del [bloque de bloqueos cerrados](dispatch-blockers-closed.md), sobre los tres huecos que ese documento dejaba anotados de E3. Sin push, sin despliegue, sin activación productiva, sin llamadas a proveedores reales.

## Commits

| Commit | Qué cierra | Validación |
| --- | --- | --- |
| `527cc7b6` | Transporte estricto de Instagram y Telegram | 2 suites / 40 casos; respuestas de proveedor sintéticas |
| `6ddd1a70` | El lote durable se adueña del turno entero, no sólo de sus palabras | 2 suites / 29 casos, más las cuatro suites de entrega de medios |
| `498e7592` | Migración de las tablas nuevas para los tenants existentes | 1 suite / 6 casos, PostgreSQL real |

## 1. Instagram y Telegram tenían la puerta cerrada, no abierta

Los dos se rechazaban con `transport_not_migrated` si una fila del outbox llegaba a ellos. Ese rechazo era **correcto** —mejor uno visible que degradar al gateway suelto, que convierte cualquier excepción en `null` y hace que un número rechazado y una conexión perdida se vean igual— pero dejaba dos canales sin la única ruta capaz de decir qué hizo el proveedor.

**Instagram** habla el mismo sobre de la Graph API que Messenger: un id o un objeto `error`, nunca los dos. Comparte clasificador. Lo que no comparte es la ruta: el remitente de un DM es el id de usuario de Instagram y sale del binding de la fila, no de un `me` fijo, así que dos cuentas del mismo tenant no pueden salir por la misma. Rechaza un documento en vez de degradarlo a foto —un DM no tiene forma de documento, y mandarlo como imagen entregaría algo que el cliente no puede abrir y contaría como entregado— y no acepta el caption que su `sendMediaMessage` viejo recibía y nunca enviaba.

**Telegram** no es un proveedor Graph y trae su propio clasificador. Su contrato es `ok`: una llamada exitosa lleva `result` y una fallida lleva `error_code`. Eso es lo que separa un rechazo del silencio, el mismo papel que cumple el sobre de error de Meta. Dos casos deliberadamente **no** son rechazo:

- **429**, que es el único código documentado que invita a otro intento, porque documenta que no envió;
- **cualquier 5xx**, porque Telegram no promete que una respuesta fallida signifique que el update no se procesó. Llamarlo rechazo invitaría exactamente al duplicado que el outbox existe para evitar.

Su llamada de medios ya no lleva caption ninguno —ni siquiera vacío—: ese empaquetado es la razón por la que un solo `<` en un caption se llevaba puesta la foto entera y el reintento la mandaba de nuevo.

El interruptor de despliegue deriva del gateway lo que considera migrado, así que implementar `sendStrict` es lo que vuelve elegible a un canal. Una prueba ata las dos cosas y comprueba que correo, que no tiene transporte estricto, siga siendo invisible para el interruptor.

## 2. El lote se adueñaba de las palabras, no del turno

El enlace de pago y las fotos son efectos del **mismo turno** que las burbujas. Pero salían desde dentro de `generateResponse`, mientras que las burbujas las despachaba su llamador. Consecuencia: un lote durable sólo podía adueñarse del texto. El enlace salía al lado del lote que es dueño de la respuesta, en un lugar donde nada lo recupera, nada lo deduplica y nadie sabe si llegó — justo el hueco que el outbox existe para cerrar, abierto para el único efecto que mueve plata.

`generateResponse` ahora entrega esos efectos hacia arriba por un colector en vez de enviarlos, y el llamador toma **una** decisión para el turno entero: todo en el lote, o todo por el camino viejo con los mismos retrasos e identificadores de deduplicación de siempre. Web Chat, Agent Test y evaluación no pasan colector y no cambian: siguen agregando la URL a la respuesta validada, que es lo que entrega ese transporte.

`buildDispatchItems` pasó a emitir el enlace **antes** que las fotos. El productor ya los mandaba en ese orden y decía por qué —es lo que el cliente está esperando—, así que alinear los dos significa que encender el interruptor no reordena la respuesta de nadie.

Un turno cuyo efecto no se puede expresar rechaza el lote entero en vez de confirmar el resto. Media respuesta entregada sin que nadie se entere de la mitad que falta es peor que el camino viejo, que al menos puede entregar el texto.

## 3. Los tenants vivos no tenían dónde escribir

Las tablas llegaban a un tenant por dos rutas que ambas se saltan a los que ya están corriendo: el bootstrap perezoso, que las crea la primera vez que ese tenant las usa, y `tenant-schema.sql`, que sólo define un tenant nuevo. Un tenant vivo no las tenía hasta que alguien encendiera el interruptor para él, y ese primer turno pagaba el DDL en el camino crítico de una respuesta a un cliente.

La migración las crea para todos los existentes, antes de que el interruptor pueda encenderse. Es **aditiva** —`CREATE TABLE` / `CREATE INDEX` / `ADD COLUMN`, todo `IF NOT EXISTS`—, así que el código viejo la ignora durante el rolling restart, que es lo que exige expand-contract. No escribe ninguna fila: no hay nada que rellenar, sólo el lugar donde escribir. Los `ADD COLUMN` no son decoración: un tenant que arrancó el outbox con una versión anterior tiene la tabla pero le faltan `settled_lease_token`, `message_id` y `effects`, y un `CREATE TABLE IF NOT EXISTS` lo dejaría así.

Eso deja **tres definiciones de la misma tabla que no pueden verse entre sí**. Una prueba con PostgreSQL real aplica las tres a esquemas separados y compara columnas, restricciones e índices, así que una deriva rompe una compilación en vez de aparecer meses después en el tenant que resultó haberse creado por el camino raro. También fija las dos propiedades operativas que la migración necesita: aplicarla dos veces no cambia nada, y una fila de `tenants` que nombra un schema que una purga ya borró no aborta la pasada.

## Límites explícitos

- **Nada cambia en producción.** El interruptor sigue apagado por defecto, apagado para todo canal no listado y apagado ante cualquier configuración ilegible. La migración crea tablas vacías; no enciende nada.
- **Ningún proveedor real fue llamado.** Las respuestas de Instagram y Telegram de las pruebas son sintéticas, con la forma de las reales y los identificadores reemplazados. Un piloto con credenciales de prueba autorizadas sigue siendo un gate externo.
- El **Flow** sigue sin productor: tiene primitiva y transporte de WhatsApp, pero ningún camino lo produce en la salida normal.
- La **procedencia de aprendizaje** sigue sin recogerse en turnos de mensajería, así que se registra footprint vacío y el borrado por release no alcanza esas filas. El borrado por contacto sí.
- La migración no se ha aplicado a ninguna base: se ejecutó únicamente contra la instancia local desechable de la prueba de paridad.
