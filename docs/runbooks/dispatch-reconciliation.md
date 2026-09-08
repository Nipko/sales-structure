# Runbook: despacho durable y reconciliación

Operativo para el camino durable de salida normal (`agent_dispatch_outbox`). Cubre el interruptor de despliegue, la cola de reconciliación y el diagnóstico. Todo lo de aquí es **super_admin**.

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
| `suppressed` con `transport_not_migrated:<canal>` | El interruptor nombra un canal sin transporte estricto. Quitarlo de `channels`. |
| `suppressed` con `predecessor_not_delivered` | Es correcto: el caption de una imagen que no llegó. |
| `reconciliation_required` con `lease_expired_after_admission` | Un worker murió con el permiso en la mano. Reconciliar como arriba. |
| Muchos `meta_131047` | Fuera de la ventana de 24 h. No es un fallo del despacho. |

## Reversión

1. `POST /dispatch-rollout/disable` — deja de crear lotes nuevos de inmediato.
2. Los lotes ya creados se terminan de entregar. Para inspeccionarlos: la consulta de backlog de arriba.
3. Nada que revertir en base de datos: las tablas son aditivas y el camino viejo nunca se desconectó.
