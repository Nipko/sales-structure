# Parallly Observability — Manual Completo

## Resumen

El stack de observabilidad de Parallly proporciona logging estructurado, monitoreo de endpoints, dashboards de metricas, alertas automaticas, y un panel de gestion de colas BullMQ. Todo auto-hospedado en el mismo VPS.

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
Uptime Kuma       Grafana + Loki       Dozzle
  (3003)           (3004)  (3100)      (9999)
    |                  |                  |
    +------ Docker Socket / Logs ---------+
    |                                     |
    +---- parallext-api (Pino JSON) ------+
    |---- parallext-worker (Pino JSON) ---+
    |---- parallext-whatsapp -------------+
    |---- parallext-postgres -------------+
    |---- parallext-redis ---------------+

Interno (embebido en API):
    Bull Board (/admin/queues) — Dashboard BullMQ
    Sentry (@OnWorkerEvent) — Error tracking en jobs
```

### RAM estimado

| Componente | RAM |
|------------|-----|
| Dozzle | ~15-30MB |
| Uptime Kuma | ~80-120MB |
| Grafana | ~150-250MB |
| Loki | ~250-380MB |
| **Total observabilidad** | **~500-780MB** |
| App stack (API, Worker, WA, Dashboard, PG, Redis, etc.) | ~3-4GB |
| **Total VPS** | **~4-5GB de 8GB** |

---

## 2. Pino — Logging Estructurado

### Que es
Pino es el logger mas rapido de Node.js (5-8x mas rapido que Winston). Reemplaza el logger default de NestJS y produce logs en formato JSON estructurado.

### Formato de log

**Produccion (JSON):**
```json
{
  "level": 30,
  "time": 1713200000000,
  "pid": 1,
  "hostname": "parallext-api",
  "tenantId": "cf0d5cc5-5816-433a-8766-4fd578edf1ec",
  "userId": "a1b2c3d4-...",
  "req": { "method": "POST", "url": "/api/v1/conversations/..." },
  "msg": "Processing incoming WhatsApp message",
  "context": "ConversationsService"
}
```

**Desarrollo (pretty):**
```
[12:08:17] INFO (ConversationsService): Processing incoming WhatsApp message
  tenantId: "cf0d5cc5-..."
  userId: "a1b2c3d4-..."
```

### Contexto automatico
Cada request HTTP automaticamente incluye:
- `tenantId` — del JWT del usuario autenticado
- `userId` — del JWT (sub claim)
- `req.method`, `req.url` — metodo y ruta HTTP

### Endpoints excluidos del auto-logging
- `/api/v1/health` — health checks
- `/docs` — Swagger UI
- `/admin/queues` — Bull Board

### Buscar en logs

```bash
# Por tenant
docker logs parallext-api 2>&1 | grep '"tenantId":"cf0d5cc5"'

# Por nivel de error
docker logs parallext-api 2>&1 | grep '"level":50'  # level 50 = error

# Por servicio
docker logs parallext-api 2>&1 | grep '"context":"OutboundQueueProcessor"'

# Con jq (mas potente)
docker logs parallext-api 2>&1 | jq 'select(.level >= 50)'
docker logs parallext-api 2>&1 | jq 'select(.tenantId == "cf0d5cc5-...")'
```

### Persistencia
- Docker json-file driver: 50MB x 5 archivos por container (rotacion automatica)
- Volumenes Docker: `parallext-api-logs`, `parallext-worker-logs` sobreviven deploys
- Loki: agrega logs para busqueda en Grafana (retencion configurable)

---

## 3. Bull Board — Dashboard BullMQ

### Acceso
```
https://api.parallly-chat.cloud/admin/queues?token={BULL_BOARD_TOKEN}
```

O con header:
```bash
curl -H "X-Admin-Token: {BULL_BOARD_TOKEN}" https://api.parallly-chat.cloud/admin/queues
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
- **Inspeccionar job data**: ver el payload completo (tenantId, channelType, mensaje, etc.)
- **Ver errores**: stacktrace completo de cada job fallido
- **Retry**: reintenta un job fallido con un click
- **Limpiar**: elimina jobs completados o fallidos antiguos
- **Pausar/reanudar**: pausar una cola completa

### Cuando usar Bull Board
- Un usuario reporta que no recibio un mensaje → busca en outbound-messages/failed
- Campana de broadcast se "quedo pegada" → revisa broadcast-messages/waiting y active
- Nurturing no esta enviando follow-ups → revisa nurturing/failed
- Despues de un deploy, verificar que las colas estan procesando

---

## 4. Uptime Kuma — Monitoreo + Alertas

### Acceso
```
https://status.parallly-chat.cloud
```

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
| SSL Certificate | HTTPS | `https://api.parallly-chat.cloud` | 86400s (1/dia) |

### Canales de notificacion
Uptime Kuma soporta 90+ canales. Los mas utiles:
- **Telegram Bot** — alertas instantaneas al celular
- **Email** (SMTP) — para el equipo
- **Slack/Discord** — si usas alguno
- **Webhook** — para integraciones custom

### Status Page publica
Uptime Kuma puede generar una pagina de estado publica (como status.github.com) que muestra a tus clientes si los servicios estan operativos.

---

## 5. Grafana + Loki — Dashboards y Busqueda de Logs

### Acceso
```
https://grafana.parallly-chat.cloud
User: admin
Password: {GRAFANA_PASSWORD del .env}
```

### Configurar Loki como Data Source
1. Menu lateral → Connections → Data Sources
2. Add data source → Loki
3. URL: `http://loki:3100`
4. Click "Save & Test" (debe mostrar "Data source connected")

### Queries utiles en Loki (LogQL)

```logql
# Todos los logs del API
{container_name="parallext-api"}

# Solo errores
{container_name="parallext-api"} |= "error"

# Logs de un tenant especifico
{container_name="parallext-api"} | json | tenantId = "cf0d5cc5-..."

# Logs del outbound processor
{container_name="parallext-api"} |= "OutboundQueueProcessor"

# Jobs fallidos
{container_name="parallext-api"} |= "failed"

# Logs de BullMQ worker
{container_name="parallext-worker"} |= "Outbound"

# Buscar por numero de telefono
{container_name=~"parallext-api|parallext-worker"} |= "573123302706"
```

### Dashboards recomendados
Crea un dashboard con estos paneles:

1. **Log Volume**: grafico de barras con `sum(count_over_time({container_name="parallext-api"}[5m]))` — muestra volumen de logs por minuto
2. **Errors**: panel con `{container_name=~"parallext-.*"} |= "error"` — muestra errores recientes
3. **BullMQ Failures**: `{container_name=~"parallext-api|parallext-worker"} |= "Job failed"` — jobs que fallaron
4. **Per-Tenant Activity**: filtro variable por tenantId

### Alertas en Grafana
Grafana puede enviar alertas basadas en queries de Loki:
- "Si hay mas de 10 errores en 5 minutos → alerta por email"
- "Si no hay logs del API en 2 minutos → alerta por Telegram"

---

## 6. Sentry — Error Tracking en BullMQ

### Que se captura
Todos los processors de BullMQ tienen `@OnWorkerEvent('failed')` que envia a Sentry:

| Processor | Tags | Extra |
|-----------|------|-------|
| outbound-messages | queue, tenantId, channel | jobId, to, attempt |
| broadcast-messages | queue, campaignId | jobId, phone |
| automation-jobs | queue, tenantId | jobId, ruleId |
| nurturing | queue, tenantId | jobId, conversationId, attempt |

### Como ver en Sentry
1. Abre el proyecto en sentry.io
2. Issues → filtrar por tag `queue:outbound-messages`
3. Cada issue muestra: error message, stacktrace, tenantId, jobId, datos del job

### Alertas de Sentry
En sentry.io → Alerts → Create Alert:
- "When there are more than 5 events with tag queue:outbound-messages in 10 minutes"
- "When a new issue is seen with tag queue:nurturing"

---

## 7. Docker Log Rotation

### Configuracion
Todos los containers usan el driver `json-file` con rotacion:

```yaml
x-logging: &default-logging
  driver: json-file
  options:
    max-size: "50m"    # Rotar al llegar a 50MB
    max-file: "5"      # Mantener max 5 archivos
```

Esto significa:
- Cada container puede usar max 250MB en logs (5 x 50MB)
- Con 14 containers: max ~3.5GB total en disco para logs
- La rotacion es automatica por Docker

### Volumenes de logs
Ademas de los logs de Docker, la API y Worker escriben a volumenes dedicados:

```
parallext-api-logs    → /data/logs/ dentro del container API
parallext-worker-logs → /data/logs/ dentro del container Worker
```

Estos volumenes NO se eliminan cuando Watchtower recrea containers, asi que los logs sobreviven deploys.

---

## 8. Flujo de Diagnostico

### "Un usuario dice que no recibio un mensaje"

1. **Bull Board** → `outbound-messages/failed` → buscar por numero de telefono en el job data
2. Si hay job fallido → ver el error (token expirado? channelAccountId vacio? rate limit?)
3. **Retry** el job desde Bull Board
4. Si no hay job → el mensaje nunca se encolo → buscar en logs:
   ```bash
   docker logs parallext-api 2>&1 | grep "573XXXXXXX"
   ```

### "La plataforma esta lenta"

1. **Uptime Kuma** → ver response time graphs
2. **Grafana** → `{container_name="parallext-api"} | json | responseTime > 5000` (requests > 5s)
3. `docker stats` → ver CPU/RAM de cada container

### "No llegan las alertas de automatizacion"

1. **Bull Board** → `automation-jobs` → ver si hay jobs waiting/failed
2. **Sentry** → filtrar por tag `queue:automation-jobs`
3. **Logs** → `docker logs parallext-api 2>&1 | grep "AutomationListener"`

### "El deploy rompio algo"

1. **Uptime Kuma** → deberia haber detectado el downtime
2. **Dozzle** → `https://logs.parallly-chat.cloud` → ver logs en tiempo real del container que fallo
3. **Grafana + Loki** → comparar volumen de errores antes/despues del deploy

---

## 9. URLs del Stack

| Servicio | URL | Autenticacion |
|----------|-----|---------------|
| Bull Board | `https://api.parallly-chat.cloud/admin/queues?token={TOKEN}` | Query param o header |
| Uptime Kuma | `https://status.parallly-chat.cloud` | Admin account (primera vez) |
| Grafana | `https://grafana.parallly-chat.cloud` | admin / {GRAFANA_PASSWORD} |
| Dozzle | `https://logs.parallly-chat.cloud` | Sin auth (proteger con CF Access) |
| Sentry | `https://sentry.io` (cloud) | Tu cuenta existente |

---

## 10. Variables de Entorno

Agregar al `.env` de produccion:

```bash
# Bull Board
BULL_BOARD_TOKEN=un-token-secreto-largo

# Grafana
GRAFANA_PASSWORD=una-password-segura

# Ya existentes (verificar que estan):
SENTRY_DSN=https://xxx@sentry.io/xxx
SMTP_HOST=...
SMTP_USER=...
SMTP_PASS=...
```

---

## 11. Mantenimiento

### Semanal
- Revisar Uptime Kuma → verificar que todos los monitors estan en verde
- Revisar Bull Board → limpiar jobs completados antiguos
- Revisar Sentry → resolver o silenciar issues conocidos

### Mensual
- Verificar espacio en disco: `df -h`
- Verificar tamano de volumenes de logs: `docker system df -v`
- Limpiar imagenes Docker antiguas: `docker image prune -a --filter "until=720h"`
- Revisar dashboards de Grafana → ajustar alertas si es necesario

### En cada deploy
- Verificar que todos los containers arrancaron: `docker ps`
- Verificar Bull Board: las 5 colas deben estar visibles
- Verificar Uptime Kuma: todos los monitors en verde despues de 2 minutos
