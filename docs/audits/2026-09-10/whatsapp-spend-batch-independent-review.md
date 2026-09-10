# Revisión independiente de la primera tanda de control de gasto de WhatsApp

Fecha: 2026-09-10  
Revisión: `80f56077..2df6922af5e3b1893fc84ae0845231467745e25a` (31 commits)

## Dictamen

La tanda construye una base útil: selección explícita de remitente, tabla de
tarifas derivada, estructura inicial de reservas, reducción de efectos y mejores
rechazos. No es todavía un candidato desplegable. Hay fallos locales que pueden
dejar clientes sin respuesta, enviar con una conexión revocada o atribuir un
envío de WhatsApp a una cuenta de otro canal. El control monetario existe sólo
como DDL; ningún envío real reserva ni liquida presupuesto.

## Lo que quedó validado

- El generador de tarifas reproduce 4 tarjetas, 850 precios y 192 combinaciones
  no disponibles.
- El inventario deriva 38 call sites, 37 cobrables y 26 fuera del carril
  durable. Hay 35 sitios que pueden alcanzar WhatsApp.
- Una conexión explícita ausente ya no se sustituye por otro número del tenant;
  una petición sin número sólo se resuelve cuando existe exactamente una.
- El caso WhatsApp de texto, enlace canónico e imagen con caption produce dos
  efectos durables. Instagram y Messenger conservan la separación cuando son
  dos solicitudes remotas reales.
- Los rechazos de conexión se traducen a 404, 409 y 424 en los casos cubiertos.
- Las migraciones son aditivas, crean las dos tablas por schema y añaden
  `agent_turn_ledger.outcome` a tenants nuevos y existentes.
- `@nestjs/axios` 4.0.1 está presente en `apps/api/package.json` y en
  `package-lock.json`, con `resolved` e `integrity`.

Verificación independiente ejecutada:

```text
Generadores: tarifas, inventario y artefactos, todos en --check
Unitarias focales: 12 suites / 193 pruebas, verdes
PostgreSQL focal: 4 suites / 46 pruebas, verdes
Turno normal + exposición de certificación, PostgreSQL/Valkey reales:
  2 suites / 23 pruebas, verdes
Contratos de cutover: 1 suite / 26 pruebas, verdes
Migración bajo carga repetida: 12 migraciones, 8 schemas, 0 escrituras perdidas
```

El número total de escrituras del arnés depende de cuánto dura la corrida. Se
observaron 2.036, 2.097 y el reporte original indicó 2.133. La evidencia estable
es cero fallos/pérdidas, no un contador exacto. Las «ocho mutaciones» reportadas
no tienen manifiesto o salida persistida en HEAD y por eso no son auditables.

## Bloqueos encontrados

### P0 — una conexión desconectada puede seguir enviando

El endpoint desactiva `public.channel_accounts` y revoca credenciales, pero los
resolvedores consultan `tenant.whatsapp_channels` sin exigir estado conectado y
seleccionan `system_user_token` sin comprobar `rotationState` ni expiración:

- `apps/api/src/modules/whatsapp/whatsapp.controller.ts:193`
- `apps/api/src/modules/channels/channel-token.service.ts:160`
- `apps/api/src/modules/channels/channel-token.service.ts:206`
- `apps/api/src/modules/whatsapp/services/whatsapp-connection.service.ts:399`
- `apps/api/src/modules/whatsapp/services/whatsapp-connection.service.ts:448`

Se reprodujo con las clases reales: `channel_status='disconnected'` y una
credencial `rotationState='revoked'` devolvieron el token revocado. Reconectar o
rotar tampoco invalida las entradas de `ChannelTokenService`, de modo que el
token anterior puede sobrevivir en cache durante cinco minutos.

### P1 — `wait/suppress` no se asienta de forma durable

La migración añade `outcome`, pero `agent_turn_ledger_result` sigue exigiendo un
`envelope` para cualquier estado distinto de `open`:

- `apps/api/prisma/tenant-schema.sql:5191`
- `apps/api/src/modules/conversations/agent-turn-ledger.ts:62`
- `apps/api/src/modules/conversations/agent-turn-ledger.store.ts:153`

Un turno silencioso tiene `outcome` y no `envelope`. Al cambiarlo a `settled`,
PostgreSQL rechaza el UPDATE y el store sólo deja un warning. Hace falta migrar
el constraint en tenants existentes, corregir las tres definiciones y probar
`open -> outcome(wait|suppress) -> settled -> replay sin Redis`.

### P1 — una decisión se cuenta como mensaje entregado antes del despacho

`ConversationsService` registra `send/failure_notice` antes de llamar al outbox.
`readRecentTurnOutcomes` cuenta ese valor sin recibo de proveedor. Un crash o un
rechazo entre ambos puntos hace que el siguiente turno crea que el cliente ya
fue avisado y lo deje esperando:

- `apps/api/src/modules/conversations/conversations.service.ts:1233`
- `apps/api/src/modules/conversations/conversations.service.ts:1288`
- `apps/api/src/modules/conversations/agent-turn-ledger.ts:365`
- `apps/api/src/modules/conversations/turn-outcome-wait.ts:111`

La decisión y la entrega deben ser hechos distintos. Sólo evidencia de entrega
puede consumir el cupo de avisos.

### P1 — origen multicanal convertido en remitente de WhatsApp

`lead.captured` conserva `channelAccountId` de cualquier canal, pero fija el
source como WhatsApp. Automatizaciones, drip y recordatorios aceptan después el
id sin probar el tipo de canal. Se reprodujo un evento Instagram que terminó con
`IG_ACCOUNT` como `fromPhoneNumberId` de WhatsApp:

- `apps/api/src/modules/conversations/conversations.service.ts:1626`
- `apps/api/src/modules/automation/automation-jobs.processor.ts:200`
- `apps/api/src/modules/automation/drip-sequence.service.ts:760`
- `apps/api/src/modules/appointments/appointment-reminders.service.ts:175`

Una conversación sólo puede heredar la conexión cuando su canal es WhatsApp.
En los demás casos la regla/tarea debe nombrar una conexión WhatsApp válida o
quedar explícitamente bloqueada.

### P1 — plantillas operadas por número en lugar de WABA

El seeding y el sync recorren números aunque el catálogo de plantillas pertenece
a la WABA. Dos números de la misma WABA pueden duplicar el POST y el webhook
proyecta estado por nombre/idioma sin restringir WABA:

- `apps/api/src/modules/whatsapp/services/whatsapp-template.service.ts:112`
- `apps/api/src/modules/whatsapp/services/whatsapp-webhook.service.ts:162`

El productor debe agrupar por WABA, ejecutar una vez y proyectar el resultado
sólo a las conexiones de esa WABA.

### P1 — `mediaType` se pierde antes de construir el batch

`compactTurnAnswer` conoce el tipo, pero `toDispatchTurnOutput()` sólo copia URL
y caption. El builder interpreta el valor ausente como imagen. Un audio, video o
documento puede terminar tratado como imagen:

- `apps/api/src/modules/conversations/turn-outcome-effects.ts:302`
- `apps/api/src/modules/conversations/conversations.service.ts:5752`
- `apps/api/src/modules/channels/native-caption.ts:55`

La prueba actual de audio valida las notas de compactación, no el batch final.

### P1 — el modelo de reserva no representa topes simultáneos

Cada reserva tiene un único `scope_kind/scope_key`. Un efecto debe afectar a la
vez, según su política, cuenta, negocio, contacto, número/mes y tarea/campaña.
No hay relación durable de una reserva con varios contadores, batch/outbox,
identidad inmutable del envío ni recibo de proveedor. No existe uso runtime de
`whatsapp_spend_reservations` o `whatsapp_spend_counters` fuera de pruebas.

El esquema debe corregirse antes de conectar productores. La forma esperada es
un efecto/reserva único más asignaciones únicas a N contadores, con orden de
bloqueo determinista y toda la identidad necesaria para adoptar un reintento y
reconciliar un crash.

### P1 — el workflow de candidato aún no es operable antes del merge

`candidate.yml` sólo escucha `workflow_dispatch` y no existe en `origin/main`.
GitHub procesa un despacho manual sólo cuando el archivo del workflow existe en
la rama por defecto. Por tanto, la ruta descrita en el runbook no puede arrancar
mientras este archivo viva únicamente en la rama candidata. Referencias
oficiales: [sintaxis de workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) y
[ejecución manual](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

Además:

- el dashboard candidato sólo recibe URL de API y WhatsApp; omite Meta App ID,
  Meta Config/Solution ID, Google Client ID y versión que su Dockerfile hornea;
- las variables no se validan ni forman parte de la procedencia del manifiesto;
- el manifiesto publica digests, pero `docker-compose.prod.yml` sólo consume un
  `IMAGE_TAG` común y no existe un mecanismo que convierta el manifiesto en
  referencias `repo@sha256:...`;
- el workflow llama «el mismo gate de producción» a un subconjunto de checks y
  no liga la publicación a evidencia release verde del mismo SHA.

Hay que construir una ruta real de bootstrap, build, verificación y consumo de
digests antes de usar el VPS actual.

### P1/P2 — otros defectos que deben entrar en la siguiente tanda

- Telegram decide si pliega un caption por longitud cruda y después expande
  entidades HTML. 1.024 caracteres `&` se convierten en 5.120 caracteres de
  payload y el caption separado ya se perdió.
- `sameSendContext()` omite `payer.businessId`, `credential.source` y
  `channelAddress`; el reintento puede aceptar un contexto económicamente
  distinto.
- `num_nonnulls(cap_minor, cap_deliveries) <= 1` permite un contador sin tope
  aunque el contrato afirma que hay exactamente uno; tampoco fija todas las
  invariantes de moneda y signo.
- La prueba de `charged_minor <-> settled` no cubre `settled + NULL`.
- La UI de automatizaciones no puede elegir conexión para un tenant multinúmero.
- Faltan mapeo automático de `timezone_id`, UI, topes, consumo por número/mes,
  i18n de cinco rechazos, debounce de bursts de media y parametrización de
  `MAX_FAILURE_NOTICES_PER_EPISODE`.
- `git diff --check 80f56077..HEAD` falla por una línea vacía al final del
  inventario generado. El propio generador reproduce el defecto.

## Estado de despliegue

No desplegar esta revisión. No se ha ejecutado el candidate workflow, no hay
motor económico, quedan 26 productores cobrables fuera del carril durable y los
fallos anteriores afectan continuidad, identidad y revocación. Los gates de
cuentas reales, tarjeta, proveedor y evaluación sólo deben abrirse después de
cerrar estos bloqueos locales.

