# Runbook: despacho durable y reconciliación

Operativo para el camino durable de salida normal (`agent_dispatch_outbox`). Cubre el interruptor de despliegue, la cola de reconciliación y el diagnóstico. Todo lo de aquí es **super_admin**.

Los SLOs de este camino —pérdida, duplicado, backlog, edad de reconciliación y latencia—, los números medidos que los sostienen y qué alerta vigila cada uno están en **`dispatch-load-and-slo.md`**, junto con el harness de carga y caos que los produjo y los hallazgos abiertos que encontró.

## Qué significa cada estado

| Estado de la fila | Qué pasó | Qué hacer |
| --- | --- | --- |
| `prepared` | El lote se registró; nada se publicó todavía. | Nada. La recuperación lo publica. |
| `queued` | Publicado a la cola. | Nada. |
| `admitted` | Hay permiso vivo para **un** intento. | Nada. Si el lease vence, la pasada lo mueve a `reconciliation_required`. |
| `sent` | El proveedor emitió recibo. **No** significa entregado. | Nada. Los webhooks mueven el mensaje a `delivered`/`read`. |
| `failed` | Rechazo conocido y reintentable; `available_at` dice cuándo. | Nada. PostgreSQL es el único planificador. |
| `suppressed` | Rechazo definitivo o presupuesto agotado. | Revisar `error_code` si se repite por tenant. |
| `reconciliation_required` | **El intento pudo haber llegado al proveedor y nadie lo sabe.** | Ver abajo. |

El estado del mensaje en la conversación es distinto y no se confunde con el anterior: `pending` → `sent` (aceptado) → `delivered` → `read`, o `failed`. Una aceptación HTTP **nunca** se escribe como `delivered`; eso solo llega por webhook del proveedor.

## Interruptor de despliegue

Clave `dispatch.normalOutbox` en `platform_settings`. **Apagado por defecto.**

```bash
# Estado efectivo: lo pedido, lo migrado, lo que realmente aplica y lo ignorado
curl -s -H "Authorization: Bearer $TOKEN" https://api.parallly-chat.cloud/api/v1/dispatch-rollout
```

```bash
# Piloto: un tenant, un canal
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"enabled":true,"channels":["whatsapp"],"tenantIds":["<tenant-uuid>"]}' \
  https://api.parallly-chat.cloud/api/v1/dispatch-rollout
```

```bash
# Kill switch: todos apagados, efecto inmediato
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  https://api.parallly-chat.cloud/api/v1/dispatch-rollout/disable
```

Reglas que conviene tener presentes:

- Un canal solo aplica si está **pedido y migrado**. `ignoredChannels` en la respuesta dice cuáles se pidieron sin transporte estricto.
- `tenantIds` vacío con el interruptor encendido significa **todos** los tenants. Para un piloto, listar explícitamente.
- Apagar el interruptor **no** revoca lotes ya creados: un lote existente sigue siendo dueño de su respuesta y se termina de entregar. Es deliberado — lo contrario entregaría la misma respuesta dos veces por el camino viejo.
- Cada escritura queda auditada (`dispatch.rollout.updated`) con el valor anterior y el actor real.

## Cola de reconciliación

`reconciliation_required` significa exactamente una cosa: **no sabemos si el efecto ocurrió**. No es un fallo ni un éxito.

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.parallly-chat.cloud/api/v1/dispatch-rollout/reconciliation/<tenant-uuid>"
```

Devuelve `entries` (más antiguo primero) y `backlog` con `total`, `oldestAgeSeconds` y `breachingSla`. **SLA: 3600 s.** Una fila por encima de eso es un problema operativo, no una curiosidad.

La lista no expone el texto del mensaje ni el número completo: la reconciliación trata de si el efecto ocurrió, nunca de qué decía. El destinatario viene enmascarado (últimos 4).

Se puede buscar por recibo del proveedor, id de la fila, inbound o conversación:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  ".../dispatch-rollout/reconciliation/<tenant-uuid>?search=wamid.HBgMNTcz..."
```

### Cómo resolver una fila

1. **Buscar la evidencia en el proveedor.** Para WhatsApp: WhatsApp Manager → el número → historial de mensajes, o la Graph API con el `wamid` si la fila trae `receipt`. La ventana a mirar es `updated_at ± 2 min`.
2. **Decidir** con una de estas tres, siempre con evidencia escrita:

```bash
# Sí salió: cerrar con el recibo encontrado
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"resolution":"delivered","receipt":"wamid.XXXX","evidence":"WhatsApp Manager, entregado 10:04"}' \
  ".../dispatch-rollout/reconciliation/<tenant-uuid>/<dispatch-uuid>"
```

```bash
# No salió y no se reenvía
curl -s -X POST ... -d '{"resolution":"not_delivered","evidence":"Sin registro en la ventana completa"}' ...
```

```bash
# No salió y se autoriza otro intento
curl -s -X POST ... -d '{"resolution":"retry","evidence":"El log del proveedor no muestra la petición"}' ...
```

Restricciones que el sistema impone y **no** conviene intentar rodear:

- `evidence` es obligatorio en las tres. `retry` es la única que puede producir otro POST, así que exige por escrito que el efecto **no** ocurrió. El silencio es lo que significa este estado; nunca puede ser la justificación.
- `delivered` exige el recibo del proveedor. Sin recibo no se puede afirmar que salió.
- Una fila que ya se resolvió sola no acepta una decisión posterior (`dispatch_not_reconcilable:<estado>`).
- Una fila cuyo contenido borró un derecho de supresión **no se reenvía nunca**, con la evidencia que sea (`dispatch_redacted`).
- Si el presupuesto de intentos está agotado, `retry` se rechaza (`dispatch_attempts_exhausted`); usar `not_delivered` y, si corresponde, que el agente vuelva a responder en un turno nuevo.

Cada resolución queda auditada (`dispatch.reconciliation.resolved`) con el actor, la evidencia y el estado resultante.

## Retención: qué deja de estar en una fila liquidada

Una fila terminal —`sent`, `stored`, `suppressed`— pierde su contenido a los **30 días**
(`DISPATCH_PAYLOAD_RETENTION_DAYS`), en el barrido diario `dispatch-recovery.redactSettled`
(`40 4 * * *`, una sola instancia, hasta 2.000 filas por tenant por pasada).

**Qué se va:** `payload`, `recipient`, `conversation_id`, `contact_id`, `learning_footprint`.
**Qué queda:** la fila, su `state`, su `receipt`, sus `attempts` y sus tiempos. Así que
«¿salió esto, cuándo y con qué acuse?» se sigue respondiendo para siempre; «¿qué decía?»
no, y para eso está `messages`, que es la historia que lee una persona.

Por qué existe: el `payload` es una **copia**. Esa columna sólo está para que un efecto no
enviado todavía se pueda enviar, y una fila terminal no se puede enviar de nuevo. Nada la
borraba, así que la tabla crecía sin techo y cada mensaje que el agente hubiera mandado
alguna vez seguía ahí, con su destinatario, alcanzable únicamente por un borrado que
nombrara a ese contacto exacto.

Se usa **la misma forma que el borrado**: `redacted_at` puesto y el contenido en NULL, que
es lo que exige el CHECK de la tabla —una fila está redactada o está completa, nunca a
medias—. Consecuencia deliberada: una fila retenida y una borrada por GDPR son
indistinguibles para cualquier lector. Ninguna de las dos tiene ya las palabras.

**Tres estados quedan afuera a propósito:**

- `reconciliation_required` — es la cola que trabaja una persona, y necesita el
  destinatario y el contenido para ir a mirar en el proveedor;
- `failed` — está esperando su próximo intento, no terminó;
- `admitted` — tiene un permiso vivo.

Si necesitás el contenido de una fila liquidada de hace más de 30 días, no está: mirá
`messages` por `message_id`.

## Diagnóstico rápido

```sql
-- Backlog y antigüedad por tenant (dentro del schema del tenant)
SELECT state, COUNT(*), MAX(NOW() - updated_at) AS oldest
FROM agent_dispatch_outbox GROUP BY state ORDER BY 2 DESC;
```

```sql
-- Motivos más frecuentes de supresión en 24 h
SELECT error_code, COUNT(*) FROM agent_dispatch_outbox
WHERE state='suppressed' AND updated_at > NOW() - INTERVAL '24 hours'
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;
```

```sql
-- Permisos vencidos que la pasada todavía no retiró
SELECT id, attempts, lease_expires_at FROM agent_dispatch_outbox
WHERE state='admitted' AND lease_expires_at <= NOW();
```

Síntomas y causa habitual:

| Síntoma | Causa probable |
| --- | --- |
| Filas en `prepared` que no avanzan | La pasada de recuperación no corre (cron `*/2`, `dispatch-recovery.recoverPending`, corre en una sola instancia). |
| `suppressed` con `transport_not_migrated:<canal>` | El interruptor nombra un canal sin transporte estricto. Hoy son WhatsApp, Messenger, Instagram y Telegram los que sí lo tienen; correo no. Quitarlo de `channels`. |
| `suppressed` con `predecessor_not_delivered` | Es correcto: el caption de una imagen que no llegó. |
| `reconciliation_required` con `lease_expired_after_admission` | Un worker murió con el permiso en la mano. Reconciliar como arriba. |
| Muchos `meta_131047` | Fuera de la ventana de 24 h. No es un fallo del despacho. |

## Migración de las tablas a los tenants existentes

`prisma/migrations/20260908150000_backfill_agent_dispatch_tenant_tables` crea `agent_dispatch_outbox`, `agent_dispatch_outbox_sources` y `agent_handoff_receipts` en **todos** los schemas de `public.tenants`, y ensancha los que arrancaron con una versión anterior. Es idempotente y sólo aditiva: aplicarla dos veces no cambia nada, y una fila que nombra un schema ya purgado se salta sin abortar la pasada. No escribe ninguna fila y no enciende nada — el interruptor sigue siendo una decisión aparte.

### Dry-run: qué falta antes de aplicarla

```sql
-- Qué tenants no tienen todavía cada objeto. Cero filas = nada que hacer.
SELECT t.schema_name, o.object_name
FROM public.tenants t
CROSS JOIN (VALUES
    ('agent_dispatch_outbox'),('agent_dispatch_outbox_sources'),('agent_handoff_receipts')
) AS o(object_name)
WHERE EXISTS (SELECT 1 FROM information_schema.schemata s WHERE s.schema_name = t.schema_name)
  AND to_regclass(format('%I.%I', t.schema_name, o.object_name)) IS NULL
ORDER BY 1, 2;
```

```sql
-- Y qué tenants tienen la tabla pero les faltan las columnas posteriores.
SELECT t.schema_name, c.needed
FROM public.tenants t
CROSS JOIN (VALUES
    ('agent_dispatch_outbox','settled_lease_token'),
    ('agent_dispatch_outbox','message_id'),
    ('agent_handoff_receipts','effects')
) AS c(tbl, needed)
WHERE to_regclass(format('%I.%I', t.schema_name, c.tbl)) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = t.schema_name AND table_name = c.tbl AND column_name = c.needed)
ORDER BY 1, 2;
```

Las dos consultas son de sólo lectura y se pueden correr contra producción antes del deploy. Después de migrar tienen que devolver **cero filas**; ese es el criterio de éxito, no el hecho de que la migración no haya lanzado error.

### Observabilidad

```sql
-- Cuántos tenants quedaron con cada objeto, para comparar contra el total.
SELECT count(*) FILTER (WHERE to_regclass(format('%I.agent_dispatch_outbox', schema_name)) IS NOT NULL) AS outbox,
       count(*) FILTER (WHERE to_regclass(format('%I.agent_handoff_receipts', schema_name)) IS NOT NULL) AS receipts,
       count(*) AS tenants
FROM public.tenants;
```

Un tenant que salga en el dry-run después de migrar suele significar que su fila de `tenants` nombra un schema que ya no existe: comprobar con `information_schema.schemata` antes de tocar nada.

### Reversión de la migración

Con el interruptor apagado las tablas están **vacías**, así que revertirla es soltar objetos sin datos. Comprobarlo primero:

```sql
-- Los schemas que hoy tienen la tabla; sobre cada uno hay que contar filas.
SELECT t.schema_name
FROM public.tenants t
WHERE to_regclass(format('%I.agent_dispatch_outbox', t.schema_name)) IS NOT NULL
ORDER BY 1;
```

Y por cada schema, `SELECT count(*) FROM "<schema>".agent_dispatch_outbox`. **Si alguno devuelve más de cero, no se revierte**: esas filas son el registro de efectos que pudieron llegar a un cliente, y sin ellas una recuperación entregaría lo mismo dos veces. En ese caso lo que se apaga es el interruptor, no la tabla.

Con todo en cero, la reversión es `DROP TABLE` de `agent_dispatch_outbox_sources`, `agent_dispatch_outbox` y `agent_handoff_receipts` en cada schema. El bootstrap perezoso las vuelve a crear si alguna vez se necesitan, así que la reversión no rompe el código nuevo; sólo devuelve el schema a como estaba.

## Reversión del despliegue

1. `POST /dispatch-rollout/disable` — deja de crear lotes nuevos de inmediato.
2. Los lotes ya creados se terminan de entregar. Para inspeccionarlos: la consulta de backlog de arriba.
3. Nada que revertir en base de datos para volver al camino viejo: las tablas son aditivas y el camino viejo nunca se desconectó. La reversión de la migración es aparte y sólo tiene sentido con las tablas vacías.
