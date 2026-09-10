# Directiva para Claude — cerrar runtime, economía y candidato de octubre

Empieza leyendo:

1. `docs/audits/2026-09-10/whatsapp-spend-batch-independent-review.md`
2. `docs/handoffs/2026-09-10/claude-october-release-parallel-execution.md`
3. `docs/whatsapp-meta-pricing-2026-10.md`
4. `apps/api/src/modules/billing/whatsapp-rates/RESERVATION-DESIGN.md`
5. `docs/runbooks/october-cutover.md`

Parte de `2df6922af5e3b1893fc84ae0845231467745e25a`. Si otra sesión avanzó HEAD,
inspecciona e integra esos commits; no hagas reset ni descartes trabajo. Conserva
sin modificar los cambios ajenos en `CLAUDE.md`,
`docs/plan-profitability-2026-07.md`, `.validate-index.cjs` y
`docs/whatsapp-meta-pricing-2026-10.md`. Revisa también el `NUL` sin seguimiento,
determina quién lo creó y no lo incluyas en un commit sin probar su procedencia.

## Mandato

Continúa implementando. No entregues otro análisis que enumere huecos que puedes
cerrar localmente. Cierra todos los defectos reproducidos, el motor de gasto, la
migración de productores, la experiencia de configuración y la ruta de
candidato. Haz commits pequeños y coherentes, con rutas explícitas; nunca
`git add .` ni `git add -A`.

El dueño prioriza el cambio completo de plataforma. No mantengas el carril
anterior por compatibilidad si impide una única frontera segura. Sí debes
preservar datos de negocio, consentimientos, historial, efectos, recibos y
reservas, y evitar cobros o envíos duplicados durante la transición.

No hagas push, merge, deploy, activación, llamadas a proveedores ni gasto real
sin autorización explícita. Puedes construir y probar todo lo local, incluidos
PostgreSQL, Valkey, PgBouncer, workflows, imágenes y ensayos sintéticos.

## Orden obligatorio

### 1. Corrige primero los defectos de continuidad e identidad

Antes de conectar una sola reserva:

- Migra `agent_turn_ledger_result` para permitir un resultado con `outcome` sin
  `envelope` en los tres caminos canónicos. Prueba `wait` y `suppress` desde
  `open` hasta `settled`, reinicio sin Redis y replay sin despacho.
- Separa decisión de envío de evidencia de entrega. Un `failure_notice` sólo
  cuenta contra el episodio cuando el outbox/recibo prueba el estado elegido por
  el contrato. Prueba crash antes de admission, rechazo, resultado desconocido,
  aceptado sin delivery y delivery confirmado.
- Haz que ambos resolvedores fallen cerrados para conexión inactiva,
  `channel_status` distinto de conectado, credencial revocada/expirada o WABA
  deshabilitada. La desconexión debe actualizar las autoridades coherentemente e
  invalidar cache después del commit. Conexión, reconexión y rotación también
  invalidan exactamente las claves afectadas.
- Corrige el origen multicanal. Nunca pases un account id de Instagram,
  Messenger, Telegram o widget como remitente WhatsApp. Automatización, drip y
  recordatorios deben heredar sólo una conversación WhatsApp; de otro modo la
  configuración nombra una conexión WhatsApp o la tarea queda bloqueada con un
  código accionable.
- Opera plantillas una vez por WABA, no una vez por número. El webhook de estado
  sólo actualiza las conexiones de la WABA que produjo el evento.
- Conserva `mediaType` hasta el adaptador y prueba audio/video/documento en el
  batch E2E. Para Telegram decide el límite sobre el payload ya serializado o
  conserva un efecto separado si no cabe.
- Completa `sameSendContext()` con toda identidad que deba permanecer igual en
  un reintento y añade pruebas de cada campo.

No ocultes fallos de persistencia que cambian la semántica. Un settle que falla
debe quedar recuperable y observable.

### 2. Corrige el modelo antes de implementar el motor

Las migraciones aún no fueron desplegadas, así que corrige ahora la forma del
ledger. Debe representar como mínimo:

- un efecto/reserva único por `effect_key`, ligado al item/batch/outbox durable;
- snapshot inmutable de tenant, canal, conexión, WABA/negocio pagador,
  credencial por identidad, destinatario por referencia segura, categoría,
  país/mercado, tarifa, moneda, fecha tarifaria y razón de admisión;
- asignaciones de una reserva a todos los contadores que aplique: cuenta,
  negocio, contacto, número/mes, tarea/campaña/lote y cualquier allowance;
- unicidad de asignación, moneda consistente y exactamente una unidad de cap por
  contador, o un estado explícito de sólo observación;
- relación con recibo/provider message id, estado remoto y evidencia usada para
  liberar o liquidar;
- leases, intentos, adopción, timestamps y estado suficiente para resolver
  crash y COMMIT incierto por lookup del mismo `effect_key`.

Bloquea los contadores en un orden determinista. Prueba dos transacciones
concurrentes intentando cruzar cada combinación de topes. Ningún cap puede
sobreautorizarse por una carrera.

### 3. Implementa el motor monetario completo

Construye una única autoridad runtime con estas transiciones:

1. derivar identidad, pagador, precio máximo y todos los contadores;
2. reservar atómicamente antes de cualquier POST remoto;
3. adoptar la misma reserva en reintentos;
4. mantener exposición tras `accepted` hasta que la evidencia elegida por el
   contrato permita liquidar o liberar;
5. liquidar el cargo real una sola vez;
6. liberar rechazo probado/no envío;
7. retener y reconciliar resultado desconocido sin repetir el POST;
8. barrer leases vencidos sin liberar efectos que pudieron salir;
9. pausar cuenta/tarea y producir diagnóstico accionable cuando falte precio,
   moneda, pagador, funding, zona horaria o conexión.

Expón métricas separadas para reservado, liquidado, retenido/desconocido,
rechazado y gratuito. El consumo mensual debe leerse por número y pagador, sin
sumar monedas incompatibles.

### 4. Lleva todos los envíos a una sola frontera

El objetivo derivado es **cero productores WhatsApp cobrables fuera del carril
durable y económico**. Migra o retira los 26 bypass actuales, incluidos mensajes
humanos, REST `send/*`, campañas, reglas, drip, recordatorios, avisos operativos,
handoff, media, plantillas y efectos aprobados. No añadas excepciones por nombre
de método; deriva el censo de call sites y haz que CI falle si aparece otro.

Cada efecto debe seguir este orden:

```text
identidad exacta -> autorización/cap -> outbox durable -> reserva -> POST remoto
-> recibo/estado -> liquidación o reconciliación -> historial/telemetría
```

Prueba caída antes/después de cada frontera, duplicado, dos workers, COMMIT
incierto, status repetido/fuera de orden, desconexión y borrado en vuelo.

### 5. Cierra protección contra gasto inútil

- Topes por cuenta, negocio, contacto, número/mes y tarea/campaña, con warning,
  soft stop y hard stop configurables.
- Límite y cooldown de respuestas sin progreso; dedupe semántico/operativo y
  debounce de bursts de texto/media sin perder intención.
- Política configurable de avisos de fallo; elimina el valor de prueba fijo.
- Presupuesto de tareas proactivas antes de fanout, de modo que un lote no pueda
  reservar por encima de su techo al ejecutarse en paralelo.
- Señales de abuso, loops, contactos que sólo provocan gasto y categorías/países
  caros, sin bloquear una solicitud válida de humano ni inventar intención.

Los límites deben explicar qué se bloqueó, cuánto se evitó y cómo resolverlo.

### 6. Completa readiness Meta y quién paga

- Modela la relación exacta conexión -> WABA -> business/payer -> credencial.
- Obtén y conserva evidencia de funding/readiness disponible sin recibir ni
  almacenar datos de tarjeta. La tarjeta se gestiona en la superficie autorizada
  de Meta; la UI de Parallly explica que ese cobro es de Meta y que la suscripción
  Parallly usa un pago separado.
- Mapea `timezone_id` numérico de Meta a una zona IANA autorizada, conserva la
  evidencia y ofrece corrección guiada. Una WABA con varios números no puede
  quedar con zonas contradictorias.
- Maneja 131042 y demás señales de pago/funding tanto en respuesta HTTP como en
  webhook: pausa sólo la cuenta afectada, conserva entradas, impide reintentos
  cobrables ciegos y muestra recuperación verificable.
- Completa la identidad exigida por las políticas vigentes de Meta, incluida la
  identidad por usuario cuando aplique, antes de activar el envío.

### 7. Termina UI, onboarding, i18n y transparencia comercial

En Dashboard, Assist y onboarding:

- selector obligatorio de conexión en reglas y productores proactivos para
  tenants multinúmero;
- readiness por número/WABA, zona horaria, funding, método de pago pendiente,
  última evidencia y pasos exactos para resolver;
- topes, consumo reservado/liquidado, estimación por categoría/país, alertas y
  pausas;
- cinco códigos de rechazo y todo texto nuevo en es/en/pt/fr;
- explicación inequívoca de cobro Meta versus cobro Parallly y seguridad de cada
  flujo;
- tours simples que lleven desde conexión hasta una prueba económica segura.

Actualiza landing, manuales y conocimiento de Assist desde las mismas fuentes de
verdad. No dupliques precios o límites runtime en prosa estática.

### 8. Repara la ruta de candidato y cutover

- Resuelve que un `workflow_dispatch` nuevo no puede ejecutarse antes del merge
  mientras no exista en la rama por defecto. Implementa una ruta de bootstrap
  segura o un trigger revisable que realmente pueda correr sobre el SHA de la
  rama, sin capacidad accidental de desplegar.
- Valida todos los `NEXT_PUBLIC_*` requeridos por el dashboard candidato,
  incluidos Meta/Google/versión. Incluye valores no secretos o sus digests en el
  manifiesto de procedencia.
- Liga la publicación a los checks release del mismo SHA y alinea typecheck,
  tests, builds y generadores con el gate real.
- Implementa un consumidor del `candidate-manifest.json` que genere/valide un
  override de compose con cada imagen `repo@sha256:...`. Verifica los digests de
  los contenedores en ejecución. No digas «pin por digest» mientras el host use
  sólo `IMAGE_TAG`.
- Corrige el EOF del inventario en el generador, no a mano.
- Mantén el cutover completo sobre el VPS actual, con pausa de productores,
  drenaje, backup, preflight, migraciones, imágenes, salud, canario y rollback de
  datos/imágenes como conjunto. El procedimiento se prepara y ensaya localmente;
  su ejecución real espera autorización.

## Verificación mínima antes de declarar cierre local

1. Inventario generado: 0 bypass WhatsApp cobrables y 0 productores sin
   identidad/conexión económica.
2. Unitarias y contratos adversariales de cada hallazgo anterior.
3. PostgreSQL real: concurrencia de caps, adopción, settle/release, lease,
   unknown, COMMIT incierto y replay sin Redis.
4. Turno E2E real con Valkey/BullMQ/Socket.IO para texto, link, imagen, audio,
   video, documento, wait, suppress, rechazo y disconnect/rotation.
5. Migración limpio/upgrade/bajo carga en varios schemas, incluida paridad de
   todas las definiciones e invariantes nuevas.
6. Suite API completa con todas las PostgreSQL habilitadas, cero omitidas;
   Playwright completo; typecheck/build/bootstrap de todas las aplicaciones;
   `git diff --check`; generadores `--check`.
7. Candidate probado desde el mecanismo que realmente estará disponible antes
   del merge; manifiesto consumido por digest en un destino desechable.
8. Reporte de cierre derivado del código, con toda afirmación humana identificada
   y con estado `accepted`, `open` o `external_gate`.

No certifiques perfiles ni llames modelos reales hasta que el canario tenga
credencial, presupuesto y autorización. Deja preparado el comando, costo máximo,
deadline, pausa/reanudación y evidencia. Los únicos pendientes aceptables al
final son los gates verdaderamente externos: cuentas/canales reales, tarjeta en
Meta, destinatarios con consentimiento, presupuesto/autorización del canario,
credencial de modelo y la ventana de despliegue aprobada.

## Entrega esperada

Al terminar, informa:

- rango exacto de commits y una línea por commit;
- censo derivado antes/después;
- invariantes del motor y pruebas de carrera/crash;
- resultados completos, con omitidas contadas explícitamente;
- estado de cada gate externo y comando exacto que lo abre;
- evidencia de que no hubo push, deploy, activación, proveedor real ni gasto;
- todo cambio ajeno preservado.

No declares «listo para desplegar» mientras exista un P0/P1 local, un productor
cobrable fuera de la frontera, un workflow imposible de lanzar o un digest que
el host no consuma realmente.
