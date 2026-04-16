# Parallly Observability — Manual Completo

## Resumen

El stack de observabilidad de Parallly proporciona logging estructurado, monitoreo de endpoints, dashboards de metricas, alertas automaticas, y un panel de gestion de colas BullMQ. Todo auto-hospedado en el mismo VPS (8GB RAM).

---

## 1. Arquitectura del Stack

```
                    Internet
                       |
              Cloudflare Tunnel
                       |
    +------------------+------------------+
    |                  |                  |
status.parallly    grafana.parallly   logs.parallly
    |                  |                  |
Uptime Kuma       Grafana             Dozzle
  (3003)           (3004)             (9999)
                     |
                   Loki (3100) <-- Promtail (lee Docker logs)
                     
Interno (embebido en API):
    Bull Board (/api/v1/admin/queues) — Dashboard BullMQ
    Sentry (@OnWorkerEvent) — Error tracking en jobs
    Pino — Logging JSON estructurado
```

### Containers del stack

| Container | Imagen | RAM | Puerto | Proposito |
|-----------|--------|-----|--------|-----------|
| parallext-dozzle | amir20/dozzle:latest | ~15MB | 9999 | Visor de logs Docker en tiempo real |
| parallext-uptime-kuma | louislam/uptime-kuma:1 | ~80MB | 3003 | Monitoreo endpoints + alertas |
| parallext-grafana | grafana/grafana:latest | ~200MB | 3004 | Dashboards + alertas avanzadas |
| parallext-loki | grafana/loki:3.0.0 | ~300MB | 3100 | Almacenamiento de logs |
| parallext-promtail | grafana/promtail:3.0.0 | ~100MB | — | Recolecta logs Docker y los envia a Loki |
| **Total observabilidad** | | **~700MB** | | |

---

## 2. URLs de Acceso

| Servicio | URL | Autenticacion |
|----------|-----|---------------|
| **Bull Board** | `https://api.parallly-chat.cloud/api/v1/admin/queues?token={BULL_BOARD_TOKEN}` | Token en query param o header X-Admin-Token |
| **Uptime Kuma** | `https://status.parallly-chat.cloud` | Admin account (creado primera vez) |
| **Grafana** | `https://grafana.parallly-chat.cloud` | admin / {password configurada} |
| **Dozzle** | `https://logs.parallly-chat.cloud` | Sin auth (proteger con Cloudflare Access si necesario) |
| **Sentry** | `https://sentry.io` (cloud) | Tu cuenta existente |

---

## 3. Pino — Logging Estructurado

### Que es
Pino reemplaza el logger default de NestJS. Produce logs en formato JSON estructurado en produccion y formato legible (pretty) en desarrollo.

### Formato de log en produccion
```json
{
  "level": 30,
  "time": 1713200000000,
  "tenantId": "cf0d5cc5-...",
  "userId": "a1b2c3d4-...",
  "req": { "method": "POST", "url": "/api/v1/conversations/..." },
  "responseTime": 45,
  "msg": "request completed"
}
```

### Niveles de log
| Level | Numero | Significado |
|-------|--------|-------------|
| fatal | 60 | Error critico, app va a cerrar |
| error | 50 | Error que necesita atencion |
| warn | 40 | Situacion anormal pero no critica |
| info | 30 | Operacion normal (default en prod) |
| debug | 20 | Detalle para debugging (default en dev) |

### Buscar en logs por CLI
```bash
# Por tenant
docker logs parallext-api 2>&1 | grep '"tenantId":"cf0d5cc5"'

# Solo errores
docker logs parallext-api 2>&1 | grep '"level":50'

# Por servicio/contexto
docker logs parallext-api 2>&1 | grep '"context":"OutboundQueueProcessor"'

# Con jq (mas potente)
docker logs parallext-api 2>&1 | jq 'select(.level >= 50)'
```

### Endpoints excluidos del auto-logging
- `/api/v1/health`
- `/docs`
- `/api/v1/admin/queues`

---

## 4. Bull Board — Dashboard BullMQ

### Acceso
```
https://api.parallly-chat.cloud/api/v1/admin/queues?token={BULL_BOARD_TOKEN}
```

### Colas monitoreadas

| Cola | Concurrencia | Rate Limit | Proposito |
|------|-------------|-----------|---------|
| outbound-messages | 5 | 20/s | Entrega de mensajes a canales |
| broadcast-messages | 10 | 80/s | Campanas masivas |
| automation-jobs | 10 | 30/s | Acciones de automatizacion |
| nurturing | 5 | 10/s | Follow-up sequences |
| conversation-snooze | 1 | — | Wake-up de conversaciones |

### Que puedes hacer
- **Ver jobs por estado**: waiting, active, completed, failed, delayed
- **Inspeccionar job data**: ver el payload (tenantId, channelType, mensaje, etc.)
- **Ver errores**: stacktrace completo de cada job fallido
- **Retry**: reintenta un job fallido con un click
- **Limpiar**: elimina jobs completados o fallidos antiguos

### Cuando usar Bull Board
- Un usuario no recibio un mensaje -> busca en outbound-messages/failed
- Campana de broadcast pegada -> revisa broadcast-messages/waiting
- Nurturing no envia follow-ups -> revisa nurturing/failed

---

## 5. Uptime Kuma — Monitoreo + Alertas

### Monitors recomendados

| Monitor | Tipo | Target | Intervalo |
|---------|------|--------|-----------|
| API Health | HTTP(s) | `http://api:3000/api/v1/health` | 60s |
| Dashboard | HTTP(s) | `http://dashboard:3001` | 60s |
| WhatsApp Service | HTTP(s) | `http://whatsapp:3002/api/v1/health/live` | 60s |
| Landing | HTTP(s) | `http://landing:80` | 120s |
| PostgreSQL | TCP Port | `postgres:5432` | 60s |
| Redis | TCP Port | `redis:6379` | 60s |
| PgBouncer | TCP Port | `pgbouncer:5432` | 60s |

NOTA: Los hostnames usan el nombre del servicio del docker-compose (sin prefijo). Docker resuelve estos nombres internamente en la misma red.

### Canales de notificacion
- **Telegram Bot** (recomendado) — alertas instantaneas al celular
- **Email** (SMTP) — para el equipo
- **Slack/Discord** — si usas alguno
- **Webhook** — para integraciones custom

### Configurar Telegram
1. Busca @BotFather en Telegram, envia `/newbot`, sigue los pasos
2. Copia el token del bot
3. Envia `/start` a tu nuevo bot
4. Abre `https://api.telegram.org/bot{TOKEN}/getUpdates` — busca `"chat":{"id":NUMERO}`
5. En Uptime Kuma: Settings > Notifications > Add > Telegram > pega token y chat_id

---

## 6. Grafana + Loki + Promtail

### Como funciona
1. **Promtail** lee los logs de todos los containers Docker via el Docker socket
2. **Promtail** envia los logs a **Loki** via HTTP
3. **Loki** almacena y indexa los logs
4. **Grafana** consulta Loki y muestra dashboards

### Configurar Data Source
1. Grafana > Connections > Data Sources > Add > Loki
2. URL: `http://loki:3100`
3. Save & Test

### Queries utiles (LogQL)
```logql
# Todos los logs del API
{container_name="parallext-api"}

# Solo errores
{container_name="parallext-api"} |= "error"

# BullMQ failures
{container_name=~"parallext-api|parallext-worker"} |= "failed"

# Por tenant especifico (JSON parsing)
{container_name="parallext-api"} | json | tenantId = "cf0d5cc5-..."

# Por numero de telefono
{container_name=~"parallext-.*"} |= "573123302706"

# Webhooks de WhatsApp
{container_name="parallext-api"} |= "webhook/whatsapp"
```

### Paneles recomendados para dashboard

| Panel | Query | Tipo |
|-------|-------|------|
| Volumen de logs | `sum(count_over_time({container_name=~"parallext-.*"}[5m])) by (container_name)` | Time series |
| Errores por minuto | `sum(count_over_time({container_name=~"parallext-.*"} \|= "error" [5m])) by (container_name)` | Time series |
| Requests/min | `count_over_time({container_name="parallext-api"} \|= "request completed" [1m])` | Stat |
| Jobs fallidos (1h) | `count_over_time({container_name=~"parallext-api\|parallext-worker"} \|= "Job failed" [1h])` | Stat |
| Ultimos errores | `{container_name=~"parallext-.*"} \|= "error"` | Logs |
| Webhooks WhatsApp | `count_over_time({container_name="parallext-api"} \|= "webhook/whatsapp" [5m])` | Time series |

---

## 7. Sentry — Error Tracking en BullMQ

### Processors instrumentados
Todos los processors BullMQ tienen `@OnWorkerEvent('failed')` que envia errores a Sentry:

| Processor | Tags | Extra |
|-----------|------|-------|
| outbound-messages | queue, tenantId, channel | jobId, to, attempt |
| broadcast-messages | queue, campaignId | jobId, phone |
| automation-jobs | queue, tenantId | jobId, ruleId |
| nurturing | queue, tenantId | jobId, conversationId, attempt |

### Filtrar en Sentry
- Issues > filtrar por tag `queue:outbound-messages`
- Crear alertas: "When there are more than 5 events with tag queue:outbound-messages in 10 minutes"

---

## 8. Docker Log Rotation

Todos los containers usan el driver `json-file` con rotacion automatica:

```yaml
x-logging: &default-logging
  driver: json-file
  options:
    max-size: "50m"    # Rotar al llegar a 50MB
    max-file: "5"      # Mantener max 5 archivos
```

- Cada container: max 250MB en logs (5 x 50MB)
- Volumenes dedicados para API y Worker que sobreviven deploys

---

## 9. Flujos de Diagnostico

### "Un usuario no recibio un mensaje"
1. **Bull Board** > outbound-messages/failed > buscar por numero
2. Si hay job fallido > ver error (token? channelAccountId vacio? rate limit?)
3. **Retry** el job desde Bull Board
4. Si no hay job > buscar en Grafana: `{container_name="parallext-api"} |= "573XXXXXXX"`

### "La plataforma esta lenta"
1. **Uptime Kuma** > ver response time graphs
2. **Grafana** > requests lentos: `{container_name="parallext-api"} | json | responseTime > 5000`
3. En el VPS: `docker stats` para ver CPU/RAM

### "No llegan las alertas de automatizacion"
1. **Bull Board** > automation-jobs > ver si hay jobs waiting/failed
2. **Sentry** > filtrar por tag `queue:automation-jobs`
3. **Grafana** > `{container_name="parallext-api"} |= "AutomationListener"`

### "Embedded Signup de WhatsApp se quedo pegado"
1. Los onboardings se auto-expiran despues de 30 minutos
2. Si necesitas forzar: `UPDATE whatsapp_onboardings SET status='FAILED', error_code='MANUAL', completed_at=NOW() WHERE tenant_id='...' AND status NOT IN ('COMPLETED','FAILED','CANCELLED');`
3. El cron `*/10 * * * *` limpia onboardings stuck automaticamente

### "El deploy rompio algo"
1. **Uptime Kuma** > deberia detectar downtime
2. **Dozzle** > `logs.parallly-chat.cloud` > ver logs en tiempo real del container
3. **Grafana** > comparar errores antes/despues del deploy

---

## 10. Variables de Entorno

Agregar al `.env` de produccion:

```bash
# Bull Board (acceso al dashboard de colas)
BULL_BOARD_TOKEN=un-token-secreto-largo

# Grafana (password del admin)
GRAFANA_PASSWORD=una-password-segura
```

Estas variables NO van en GitHub Actions — son solo para el VPS.

---

## 11. Configuracion de Cloudflare Tunnel

Los servicios de observabilidad se exponen via el Cloudflare Tunnel existente.

### Hostnames en Cloudflare Zero Trust > Tunnels > Public Hostname

| Subdomain | Domain | Service Type | URL |
|-----------|--------|-------------|-----|
| status | parallly-chat.cloud | HTTP | `uptime-kuma:3001` |
| grafana | parallly-chat.cloud | HTTP | `grafana:3000` |
| logs | parallly-chat.cloud | HTTP | `dozzle:8080` |

IMPORTANTE: Los hostnames del Service URL usan el **nombre del servicio** del docker-compose (sin prefijo `parallext-`), NO el `container_name`.

### DNS Records necesarios (CNAME)
- `status` > `{tunnel-id}.cfargotunnel.com` (Proxied)
- `grafana` > `{tunnel-id}.cfargotunnel.com` (Proxied)
- `logs` > `{tunnel-id}.cfargotunnel.com` (Proxied)

---

## 12. Mantenimiento

### Semanal
- Revisar Uptime Kuma > verificar todos los monitors en verde
- Revisar Bull Board > limpiar jobs completados antiguos
- Revisar Sentry > resolver o silenciar issues conocidos

### Mensual
- Verificar espacio en disco: `df -h`
- Verificar volumenes: `docker system df -v`
- Limpiar imagenes Docker antiguas: `docker image prune -a --filter "until=720h"`

### En cada deploy
- Verificar que todos los containers arrancaron: `docker ps`
- Verificar Bull Board: las 5 colas visibles
- Verificar Uptime Kuma: todos monitors en verde despues de 2 min

---

## 13. Archivos de Configuracion

| Archivo | Proposito |
|---------|-----------|
| `infra/docker/docker-compose.prod.yml` | Stack completo: app + observabilidad |
| `infra/promtail/config.yml` | Config de Promtail (que logs enviar a Loki) |
| `apps/api/src/main.ts` | Pino logger init + Bull Board auth middleware |
| `apps/api/src/app.module.ts` | LoggerModule (Pino) + BullBoardModule config |
