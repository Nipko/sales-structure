# Revisión independiente del runtime WhatsApp en `fd09179a`

**Fecha:** 11-sep-2026

**Rango revisado:** `584d15c3..fd09179a` — 21 commits

**Dictamen:** **NO-GO para despliegue, piloto o activación de `enforce`.**

Esta revisión contrasta el informe de la tanda con los caminos que realmente
ejecutan `apps/whatsapp`, `apps/api`, los sumideros de salida y el candidato de
despliegue. Los generadores están al día y la tanda contiene correcciones
valiosas, pero varias pruebas estructurales se satisfacen por presencia de una
palabra o por probar un helper aislado sin alcanzar el camino desplegado.

## Lo que sí quedó construido

- Los 33 call sites que pueden generar cobro WhatsApp atraviesan la frontera
  económica; el censo actual reporta cero fuera de ella.
- El pagador, la conexión, el país del destinatario y la categoría ya se
  resuelven con mucha más precisión. La herencia accidental de una cuenta de
  Instagram como remitente de WhatsApp fue corregida.
- La reserva multialcance, los presupuestos de lote, la identidad lógica y la
  propiedad exclusiva del intento existen y tienen cobertura PostgreSQL.
- Los cuatro formatos conocidos de `131042`, el fallback de Flow, nurturing y
  la compactación de captions recibieron caminos explícitos.
- Los once valores públicos del Dashboard llegan al Dockerfile y el manifiesto
  de candidato rechaza varias formas de input peligroso.
- `mediaType` ya sobrevive desde el tool hasta el batch durable.

Estas mejoras no cierran todavía el recorrido extremo a extremo.

## P0 reproducidos

### 1. La ruta de receipts desplegada no toca el ledger

`apps/whatsapp/src/modules/jobs/webhook.processor.ts` envía el estado a
`POST /internal/channel-delivery-status`, pero:

- no incluye `status.pricing` en el body;
- `apps/api/src/modules/internal/internal.controller.ts` no pasa
  `spendLedger: this.spendLedger` a `recordChannelDeliveryStatuses`;
- tampoco aplica la pausa de financiación tardía en esta ruta.

Resultado: `sent`, `delivered`, `read` y `failed` del camino normal no liquidan
ni liberan la reserva; un `131042` tardío no pausa el número. La prueba actual
sólo busca el texto `spendLedger` en el archivo y pasa porque el constructor lo
inyecta, aunque el método no lo use.

### 2. Un ACK se registra como entrega y termina convertido en gasto

Los tres sumideros convierten un `wamid` de la respuesta HTTP en
`delivered_unpriced`. Ese ACK demuestra aceptación, no entrega. El ledger lo
guarda como `remote_state='delivered'` y el reconciliador, después de 72 horas,
lo liquida al monto reservado sin consultar una factura o evidencia de Meta.

Un mensaje aceptado que nunca se entregó puede aparecer como gasto liquidado.
Debe existir un estado `accepted` separado; sólo `delivered/read`, un
`billable:false` autoritativo o una conciliación real pueden decidir el cargo.

### 3. Un `in_flight` vencido puede adquirir otro derecho de POST

`claimTransmission` permite recapturar tanto `claimed` como `in_flight` cuando
vence el lease. `claimed` representa crash antes del POST y es recuperable;
`in_flight` representa que el request empezó y su resultado es incierto. Darle
otro token permite un segundo POST. La prueba existente barre primero y no
prueba la recaptura directa durante la ventana entre barridos.

### 4. Una entrada de caché permite usar un token revocado

`ChannelTokenService.resolveWhatsApp` devuelve la caché por número antes de
consultar estado del canal, `channel_accounts` y la credencial. La lectura de
caché sólo verifica forma e identidad. Se reprodujo una BD con canal
`disconnected`, cuenta inactiva y credencial revocada: la entrada caliente
devolvió el token anterior sin una sola lectura de BD. Offboarding aún borra la
clave tenant-wide antigua, no todas las claves actuales por cuenta.

## P1 altos

1. **El mantenimiento destruye la recuperación previa al POST.** Barre el lease
   de transmisión `claimed → idle` y enseguida convierte la reserva `held`
   vencida en `indeterminate`. El test sólo cubre el primer helper aislado.
2. **La franquicia cuenta intentos.** Los mensajes gratuitos se consumen en
   `authorize`; no existe una asignación provisional que vuelva con
   `failed/rejected`. Mil fallos pueden agotar las mil entregas gratuitas.
3. **Flow retiene el original ante rechazo concluyente.** Si el fallback no se
   puede autorizar, el rechazo del Flow termina registrado como timeout y la
   reserva queda retenida.
4. **Se mezclan monedas en un contador.** La PK del contador no contiene moneda;
   un mes que empezó con USD asumido puede sumar después unidades menores COP.
5. **Los errores del ledger de receipts no son durables en todos los ingresos.**
   Hay caminos que conservan la actualización visual de la conversación, tragan
   el fallo económico y confirman el webhook.
6. **25 productores carecen de mensaje durable.** Todos pasan por el gate
   económico, pero no tienen outbox/reanudación integral tras crash. La cifra 26
   del batch report quedó obsoleta.
7. **`observe` mezcla telemetría y autorización.** Ante varios bloqueos devuelve
   `permitted:true`, a veces sin reserva ni identidad durable. La observación
   puede ignorar un tope para medirlo, pero nunca debe perder identidad,
   contabilidad ni capacidad de recuperación.
8. **Un fallo de infraestructura al resolver un proactivo se pierde.** Se
   registra en logs y retorna `null`; sólo los rechazos de configuración crean
   tarea.
9. **Rotación tenant-wide deja cachés hermanas.** Cambiar el System User token
   invalida sólo el número conectado; token-health cambia estado o expiración
   sin invalidar las entradas afectadas.
10. **Operaciones de plantillas aún pueden elegir mal dentro de una WABA.** El
    representante puede ser un número desconectado y omitir el conectado;
    recordatorios y resolución de categoría aún pueden cruzar plantillas de otra
    WABA con el mismo nombre.

## Candidato y cutover

El candidato sigue bloqueado por estas condiciones:

1. La etiqueta `build-candidate` persiste a través de `synchronize/reopened` y el
   job conserva secretos y `packages:write`; la autorización no queda ligada al
   SHA revisado ni a un environment protegido.
2. El manifiesto acepta intercambiar repositorios permitidos entre servicios.
   Se reprodujo `api → parallext-dashboard` y `dashboard → parallext-api`; la
   allowlist es global y no un mapa servicio/repositorio.
3. `upload-artifact` usa `if:always()` y el consumidor no exige conclusión verde
   del run ni atestación release del mismo SHA.
4. Candidate no levanta PostgreSQL/PgBouncer ni ejecuta las suites DB, Dashboard
   y Playwright que el candidato necesita acreditar.
5. El runbook ejecuta `compose up` antes del ensayo de restore y antes de la
   barrera de escrituras. No hay una barrera global ejecutable para API,
   webhooks, WhatsApp, workers, crons, colas y túnel.
6. `/evidence` no tiene volumen persistente ni hash verificado.
7. El runbook dice `pg_dumpall`; deploy produce `pg_dump --format=custom`; el
   restore degrada algunos fallos a avisos.
8. Las rutas/cwd de compose, `GIT_SHA`, proyecto efectivo y cinco digests no se
   atan aún como un solo sujeto verificable.
9. Faltan el ensayo upgrade y la migración bajo carga sobre el HEAD final.

## Producto y programa todavía abiertos

- Selector obligatorio de conexión en reglas y productores proactivos.
- Readiness de financiación real: cuenta correcta, `primary_funding_id`, fuente,
  frescura, estado desconocido separado, relectura y UI guiada.
- API/UI para alerta, soft stop, techo, exposición retenida y transición auditada
  `observe → enforce`, por número y mes calendario de la WABA.
- Recorridos guiados, teclado, móvil, accesibilidad y cuatro idiomas.
- Landing, manuales y `apps/api/kb/assistant/{es,en,pt,fr}` alineados con pago
  Meta, seguridad, costo y alcance real del agente.
- BSUID/BISU extremo a extremo y control de doble respuesta/handover con el
  agente externo de Meta.
- M0–M6 y R0–R6 dentro del generador de cierre, con estados derivados del código.
- Oferta/planes versionados y transición de contratos basada en costos medidos.
- Número del canario calculado por una autoridad ejecutable.
- Certificación real: siguen en cero los 76 perfiles y los canales con proveedor
  real.

## Estado estimado

- **Núcleo económico local:** aproximadamente 65–70 %, por piezas implementadas;
  los P0 impiden activarlo.
- **Programa integral M0–M6/R0–R6 + producto + release:** aproximadamente 45 %.
- **Evidencia productiva real:** 0 % para perfiles/canales certificados.

Son estimaciones de ingeniería; el repositorio todavía no tiene un generador que
calcule M0–M6/R0–R6. El reporte A1–H3 con “0 abiertas” no mide este programa.

## Gates externos legítimos, después del cierre local

- Push/PR y primera ejecución remota del candidato en el SHA final.
- Ventana, responsable y ejecución sobre el VPS existente.
- Variables/secretos reales del build.
- WABA/número/permisos/moneda/tarjeta/funding/plantillas reales.
- Destinatario con consentimiento, presupuesto y autorización para llamadas.
- Credencial y presupuesto de modelos, usuarios nuevos y revisores.
- Aprobación explícita de migración, despliegue y activación de `enforce`.

Nada de lo anterior convierte un hueco de código en gate externo.
