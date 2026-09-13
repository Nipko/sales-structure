# Revisión independiente posterior al cierre de WhatsApp

Fecha: 2026-09-10

HEAD revisado: `cee0cd5cc1f48bbf09ce48cdc7a7fa9672bc722a`

Rango atribuido a la tanda: `d720370d..cee0cd5c` (16 commits)

## Dictamen

**NO-GO para despliegue y NO-GO para activar `enforce`.**

La tanda construyó piezas valiosas y verificables: los tres sumideros de salida
llaman a una autoridad económica, existen reservas multialcance, topes, señales,
pausa 131042, resolución de zona horaria, inventario estructural, panel en cuatro
idiomas y una ruta de imágenes por digest. Sin embargo, la ruta normal todavía no
puede determinar correctamente pagador, mercado, moneda ni categoría; puede
enviar sin reserva; y la aritmética de los contadores puede crear presupuesto.
La ruta de candidato también contiene fallos que impiden usarla como procedimiento
seguro de publicación.

El reporte histórico `7 aceptadas / 18 bloqueadas / 0 abiertas` sólo mide A1-H3.
No incluye el programa ampliado M0-M6/R0-R6 ni demuestra que esta nueva frontera
económica sea operable.

## Lo que sí quedó confirmado

- El rango contiene exactamente 16 commits y `git diff --check
  d720370d..cee0cd5c` está limpio.
- El generador de tarifas está al día: 4 tarjetas, 850 precios y 192 combinaciones
  declaradas como no disponibles.
- El inventario actual pasa: 38 call sites, 34 que requieren gate y cero marcados
  fuera de la frontera. El documento derivado conserva 37 efectos cobrables y 26
  productores fuera del carril durable; son métricas diferentes.
- La puerta está importada y aparece antes del POST nominal en los tres sumideros.
- Los locks y updates condicionales protegen el techo entre efectos distintos.
- Pasaron 12 suites unitarias focales, 160 pruebas; una suite Dashboard, 8 pruebas;
  y 5 suites focales contra PostgreSQL/Valkey, 135 pruebas.
- El reporte de 640 suites API y 7.225 pruebas corresponde a la corrida de Claude;
  esta revisión no repitió toda esa matriz.
- No hubo push, despliegue, activación ni llamadas reales durante esta revisión.

El censo prueba presencia nominal de la llamada al gate. No prueba que una reserva
domine cada POST ni que exista cardinalidad uno-a-uno entre efecto, reserva y
solicitud remota.

## Bloqueos críticos del motor económico

### 1. La ruta normal no crea una reserva utilizable

`WhatsappSendAdmissionService` decide `payerKind` sólo a partir de
`request.connection.payerWabaId`, aunque después recupera el WABA desde metadata:

- `apps/api/src/modules/billing/whatsapp-spend/whatsapp-send-admission.service.ts:179`
- `apps/api/src/modules/billing/whatsapp-spend/whatsapp-send-admission.service.ts:188`

Ninguno de los tres sumideros entrega pagador o credencial completos. Además,
`billingCurrency` y `billingMarket` se leen en las líneas 328-329, pero no existe
un writer productivo que los configure. `authorize()` responde `payer_unknown` o
`currency_unknown`.

Consecuencia:

- en `observe`, el bloqueo se convierte en permiso sin `reservationId`, por lo
  que el POST sale sin medirse;
- en `enforce`, prácticamente todos los envíos quedarían bloqueados.

El mercado tampoco puede ser una propiedad única del número emisor: la tarifa se
determina por el país del destinatario. Debe derivarse el ISO alpha-2 desde el
destino antes de anonimizarlo, con una autoridad versionada y sin guardar el
teléfono en el ledger.

### 2. La aritmética devuelve crédito dos veces

La disponibilidad y la presión usan:

`settled_minor + reserved_minor - released_minor`

en `apps/api/src/modules/billing/whatsapp-spend/spend-ledger.ts:350` y `:525-538`.
Pero `applyToCounters()` ya reduce `reserved_minor` y además aumenta
`released_minor` en `:955-962`.

Casos reproducidos:

- reservar 10 y liquidar 6 deja `(reserved=0, settled=6, released=4)`; la fórmula
  cree que se usaron 2 y ofrece 8, aunque sólo quedan 4;
- rechazar una reserva de 8 deja `(0,0,8)`; el contador ofrece `cap + 8`.

Los releases sucesivos pueden ampliar el límite. `released_minor` puede ser una
métrica histórica, pero no debe restarse otra vez del saldo operativo.

### 3. Dos autorizaciones del mismo efecto pueden reservar dos veces

`authorize()` concede franquicia y modifica todos los contadores en
`whatsapp-spend.service.ts:228-283`; sólo después intenta el
`claimReservation()` único en `:284-299`. Dos transacciones que no ven la fila
inicial pueden incrementar contadores; la perdedora adopta la fila ganadora y
confirma sus incrementos sin allocations que permitan revertirlos.

La propiedad única debe reclamarse antes de tocar contadores, o el efecto debe
adquirirse con un protocolo transaccional que haga que un solo owner reserve.
Hace falta una prueba con dos llamadas concurrentes a `authorize()` usando el
mismo `effectKey`, no sólo pruebas de primitives aislados.

### 4. `effectKey` no identifica un efecto lógico y una adopción retransmite

La clave omite una identidad durable como `dispatchItemId`, `batchId`, `taskId`,
`inboundMessageId` o un `logicalEffectId`. Dos campañas distintas con la misma
cuenta, destinatario, categoría, productor, ordinal y contenido colisionan.

La adopción devuelve permiso aunque la reserva encontrada ya esté `settled`,
`released`, `pending_reconciliation` o `indeterminate`. La función
`mayTransmit()` existe, pero ningún sink la aplica. Un retry puede repetir un
mensaje liquidado o de resultado incierto.

La decisión de transmisión debe salir del estado durable: sólo un owner nuevo de
una reserva `held` puede hacer el POST; los demás retornan el resultado previo,
esperan reconciliación o crean un intento explícito autorizado.

### 5. Una admisión puede producir dos POST a Meta

`ChannelGatewayService.sendMessage()` intenta un Flow y captura cualquier error,
incluidos timeout y resultado desconocido, para enviar texto de respaldo:

- `apps/api/src/modules/channels/channel-gateway.service.ts:124-146`

La invocación sólo posee una reserva. Se reprodujo un POST Flow seguido de un
POST de texto. Cada efecto remoto necesita su propia identidad, reserva y recibo.
Sólo un rechazo concluyente previo a aceptación permite un fallback automático;
un resultado desconocido entra a reconciliación y no dispara otro POST.

## Bloqueos altos del runtime

1. **No hay cierre productivo del ledger.** Un ACK se registra como
   `delivered_unpriced` y `remote_state='delivered'`, aunque sólo prueba
   aceptación. El webhook de estados no liquida el ledger; no existe
   reconciliador económico ni cron/caller productivo de `sweep()`. Las reservas
   quedan retenidas y el gasto real no aparece.
2. **Retry incompatible con estados retenidos.** Un timeout/rechazo transitorio
   puede reprogramarse, retransmitirse y luego no liquidarse porque las
   transiciones sólo aceptan `held`.
3. **Categorías incorrectas.** Los carriles strict/loose omiten categoría y caen
   en `service`; REST usa el literal no canónico `template`. Marketing, utility y
   authentication quedan subvalorados o sin precio.
4. **La franquicia de 1.000 no está operable.** `number_month` nace en `observe`,
   no existe inicializador productivo a 1.000, y el grant actual no restringe la
   franquicia a `service`.
5. **131042 está incompleto.** No todos los caminos registran el error inmediato;
   no existe acción operativa para limpiar/verificar la pausa; y readiness no
   devuelve `paused`, por lo que el aviso del panel es inalcanzable.
6. **El presupuesto de lote falla abierto.** Un error de declaración permite el
   fanout. Además, la declaración usa mes UTC y el worker el mes local de la WABA.
7. **El gate falla abierto por infraestructura.** Inyección opcional, schema no
   resuelto o excepción de DB producen `null` y el envío continúa sin medir. La
   indisponibilidad económica debe diferir el efecto durable y alertar; no puede
   convertirse en permiso silencioso.
8. **Persisten 26 productores fuera del carril durable.** Están marcados dentro
   de la frontera, pero no todos tienen lease, recibo, recuperación y protección
   ante COMMIT incierto.

## Bloqueos del candidato y del cutover

1. **Autorización pegajosa y no ligada a SHA.** La etiqueta `build-candidate`
   sigue autorizando `synchronize` y `reopened`; el job ejecuta código de la PR
   con secretos y `packages: write`. La aprobación debe quedar ligada a un SHA y
   a un entorno protegido o actor/repositorio permitido.
2. **`workflow_dispatch` está roto.** `candidate.yml:94` lee
   `steps.subject.outputs.sha` dentro del propio step. Debe leer `inputs.sha`.
3. **Cuatro variables públicas no se hornean.** `Dockerfile.dashboard` no declara
   ni propaga Messenger config, Instagram app/redirect ni VAPID, aunque el
   workflow las entrega como build args.
4. **El manifiesto admite una referencia YAML degradable.** El consumidor acepta
   un tag con ` # ` y escribe la imagen sin comillas; YAML convierte el digest en
   comentario. Debe validar versión 2, repositorios permitidos, tag exacto
   `candidate-<sha>` y serializar de forma segura.
5. **El runbook reemplaza servicios antes del backup.** El Paso 1 ejecuta
   `compose up`; el restore y la quiescencia aparecen después. El orden ejecutable
   debe ser inventario, ensayo, ventana, barrera global de escritura, drenaje,
   backup, preflight, migraciones, imágenes y reapertura.
6. **La evidencia de inventario no persiste.** `/evidence` no está montado y el
   script no crea el directorio.
7. **Rollback no ejecutable.** El runbook afirma `pg_dumpall`, el workflow usa
   `pg_dump --format=custom` y `restore.sh` espera otro formato. No hay restauración
   exacta probada del dump predeploy.
8. **No hay quiescencia global.** Pausar worker/crons no impide que API,
   WhatsApp y Cloudflare sigan escribiendo. El VPS y sus schemas son compartidos,
   por lo que la ventana afecta a todos los tenants.
9. **El candidate no prueba lo que el runbook afirma.** Jest omite las suites
   PostgreSQL sin DB, y no corre Dashboard ni Playwright. `upload-artifact` puede
   publicar artefactos de un run rojo; el runbook debe exigir conclusión verde.

## Errores del panel de gasto

- Consulta 30 días móviles y suma todos los números; luego compara el total con
  una sola franquicia de 1.000. Meta opera por número y mes calendario de WABA.
- Un fallo de API se muestra como “sin mensajes cobrables”. Debe distinguir
  loading, unavailable, empty y populated.
- `charged_deliveries` incluye `held`, `pending_reconciliation` e
  `indeterminate`, pero se presenta como entregado.
- La guía de zona horaria llega siempre en inglés.
- El copy comercial omite excepciones de franquicia/entry point y no muestra
  inequívocamente quién cobra y quién guarda el método de pago.

## Trabajo funcional todavía abierto

- Selector obligatorio de conexión en automatizaciones y cada productor
  proactivo de un tenant multinúmero.
- Corregir `nurturing.executeAttempt2`: hoy declara plantilla, encola texto y no
  hereda de forma completa ventana, opt-out, frecuencia ni cuenta exacta.
- Readiness real del funding: prueba/persistencia/frescura de `primary_funding_id`
  y relectura al regresar de Meta.
- Identidad por usuario exigida por Meta cuando aplique (BSUID/BISU o contrato
  vigente equivalente); no basta el token tenant-wide.
- Superficie API/UI para límites y transición auditada `observe -> enforce`.
- Recorrido guiado conexión -> tarjeta en Meta -> readiness -> presupuesto ->
  canario seguro -> lectura/reconciliación de gasto.
- Landing, manuales y KB de Assist en es/en/pt/fr.
- Cierre del programa M0, M4 y M5: inventarios derivados completos, propuesta y
  migración comercial de planes, propósito/origen WhatsApp en learning y control
  de agentes externos de Meta.

## Gates externos después de cerrar el código

- Push/PR y CI verde del SHA definitivo.
- Inventario real del VPS, capacidad, responsables y ventana comunicada a todos
  los tenants afectados.
- Backup y restore ensayados con tiempos y conteos reales.
- Once inputs de build y consumo del manifiesto contra los contenedores del VPS.
- WABA/número, permisos, tarjeta/funding, plantilla aprobada, destinatario con
  consentimiento y presupuesto de canario.
- Credencial y presupuesto de modelo. El canario actual declara 244 casos, 724
  llamadas y techo US$1,24; 0/76 perfiles están certificados.
- Humo real de inbound, outbound, estados, categoría, pagador, costo, 131042,
  retry y recuperación.
- Activación gradual de `enforce` por tenant piloto, con rollback operativo.

## Lectura de avance

- Núcleo técnico local: aproximadamente **84%**.
- Preparación para un piloto real seguro: aproximadamente **58%**.
- Programa completo certificado: aproximadamente **45%**.
- Indicador único de preparación: aproximadamente **68%**.
- Validación en producción: **0%**.

Estas cifras miden dimensiones distintas. El volumen de código terminado es alto,
pero los defectos restantes están en la ruta de dinero y publicación; por eso el
porcentaje no autoriza un despliegue parcial.
