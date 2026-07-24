# Parallly Observability — Manual Completo

_Actualizado: jul 2026 (2026-07-23) · v2_

## Resumen

El stack de observabilidad de Parallly combina dos capas:

1. **Stack externo auto-hospedado** en el mismo VPS: logging estructurado (Pino), agregacion de logs (Loki + Promtail + Grafana), monitoreo de endpoints con alertas (Uptime Kuma), visor de logs en tiempo real (Dozzle), panel de colas BullMQ (Bull Board) y error tracking (Sentry cloud).
2. **Ops Center embebido en la API** (`modules/health/`, solo `super_admin`): `PlatformMonitorService` corre crons que vigilan disco/RAM/Redis/PostgreSQL/PgBouncer/colas/SLA/tokens de canal/presupuesto LLM/pagos/backups y persiste **incidentes** deduplicados (`IncidentService`), con alertas por **email + Telegram + SMS** (`AlertConfigService`, cooldown 1h). UI en el dashboard bajo `/admin/ops`, `/admin/health`, `/admin/incidents`, `/admin/storage`, `/admin/ops/alerts`.

Produccion corre ~15 contenedores: `parallext-{api, worker, dashboard, whatsapp, landing, postgres, redis, pgbouncer, tunnel, watchtower}` + observabilidad (`grafana, loki, promtail, uptime-kuma, dozzle`). VPS Hostinger (8GB RAM).

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
                     
Interno (embebido en API — modules/health/):
    Ops Center (PlatformMonitorService) — crons de salud + incidentes + alertas
      -> email + Telegram + SMS (AlertConfigService, cooldown 1h)
      -> UI super_admin: /admin/ops, /admin/health, /admin/incidents, /admin/storage
    Bull Board (/api/v1/admin/queues) — Dashboard BullMQ (9 colas)
    Sentry (@OnWorkerEvent) — Error tracking en jobs (10 processors) + stats_v2 (error rate)
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
| **Ops Center** | `https://admin.parallly-chat.cloud/admin/ops` (+ `/admin/health`, `/admin/incidents`, `/admin/storage`, `/admin/ops/alerts`) | Login dashboard, rol `super_admin` |
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

Bull Board registra **9 colas** (`BullBoardModule.forFeature` en `app.module.ts`):

| Cola | Concurrencia | Rate Limit | Proposito |
|------|-------------|-----------|---------|
| outbound-messages | 5 | 20/s | Entrega de mensajes a canales |
| broadcast-messages | 10 | 80/s | Campanas masivas (WA/Email/SMS) |
| automation-jobs | 10 | 30/s | Acciones de automatizacion |
| nurturing | 5 | 10/s | Follow-up sequences |
| conversation-snooze | 1 | — | Wake-up de conversaciones |
| crm-sync | — | — | Sync a CRMs externos |
| crm-import | 2 | — | Importacion masiva de CRM |
| agent-simulation | baja | — | Simulacion de agente pre-deploy |
| fiscal-invoice | 3 | — | Emision factura electronica DIAN (Factus) |

NOTA: hay mas colas BullMQ en la plataforma (`eval-gate`, `quality`) que NO se registran en Bull Board pero si estan instrumentadas en Sentry (ver §7). El `PlatformMonitorService` (Ops Center) solo vigila la profundidad de 4 colas core: outbound-messages, broadcast-messages, automation-jobs y nurturing.

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
**10 processors** BullMQ envian el error a Sentry desde su handler `@OnWorkerEvent('failed')` (`Sentry.captureException`). Varios solo capturan tras agotar los reintentos (`job.attemptsMade >= job.opts.attempts`); el de fiscal escala en fallo permanente:

| Processor (cola) | Tags | Extra |
|-----------|------|-------|
| outbound-messages | queue, tenantId, channel | jobId, to, attempt |
| broadcast-messages | queue, campaignId, channel | jobId |
| automation-jobs | queue, tenantId | jobId, ruleId |
| nurturing | queue, jobName, tenantId | jobId, data |
| crm-sync | provider, entity, queue | tenantId, connectionId, jobName |
| crm-import | provider, queue | tenantId, importId |
| quality | queue | tenantId, conversationId |
| agent-simulation | queue | tenantId, runId |
| eval-gate | queue | tenantId, agentId |
| fiscal-invoice | module (`fiscal`), tenantId | — (Error sintetico con el motivo) |

NOTA: la cola `conversation-snooze` (visible en Bull Board) NO instrumenta Sentry. `fiscal-invoice` usa `tags.module=fiscal` (no `tags.queue`); una factura fallida = incumplimiento fiscal silencioso, por eso se escala de inmediato.

### Filtrar en Sentry
- Issues > filtrar por tag `queue:outbound-messages` (o `module:fiscal` para facturacion)
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
1. **Ops Center** > `/admin/ops` y `/admin/health` > revisar incidentes activos (RAM/disco/Redis/conexiones/PgBouncer maxwait)
2. **Uptime Kuma** > ver response time graphs
3. **Grafana** > requests lentos: `{container_name="parallext-api"} | json | responseTime > 5000`
4. En el VPS: `docker stats` para ver CPU/RAM

### "Llego una alerta del Ops Center (email/Telegram/SMS)"
1. **Ops Center** > `/admin/incidents` > localizar el incidente por su `key` (ej. `disk:critical`, `queue:outbound-messages:critical`, `llm:unhealthy`, `backup:stale`)
2. El cuerpo del incidente trae la remediacion concreta. Ackear mientras se atiende, resolver al despejar (o el sistema lo auto-resuelve cuando la condicion baja del umbral)
3. Umbral demasiado sensible? Ajustar en `/admin/ops/alerts` (persistido en `platform_settings`)
4. Forzar re-evaluacion sin esperar al cron: boton "correr checks" (`POST /health/checks/run`)

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

Las siguientes variables deben estar tanto en **GitHub Actions Secrets** como en el `.env` del VPS:

| Variable | GitHub Secret Name | Proposito |
|----------|-------------------|-----------|
| `BULL_BOARD_TOKEN` | `BULL_BOARD_TOKEN` | Token para acceder al dashboard de colas BullMQ |
| `GRAFANA_PASSWORD` | `GRAFANA_PASSWORD` | Password del admin de Grafana |
| `TELEGRAM_ALERT_BOT_TOKEN` / `TELEGRAM_ALERT_CHAT_ID` | idem | Canal Telegram de alertas del Ops Center (§17) |
| `SMS_ALERT_ACCOUNT_SID` / `SMS_ALERT_AUTH_TOKEN` / `SMS_ALERT_FROM` / `SMS_ALERT_TO` | idem | Alertas SMS criticas via Twilio (§17) |
| `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_API_URL` | idem | Lectura de la tasa de errores de Sentry para `sentry:errors:*` (§17) |
| `OFFSITE_BUCKET` / `OFFSITE_PROVIDER` / `OFFSITE_REGION` / `OFFSITE_ENDPOINT` / `OFFSITE_ACCESS_KEY` / `OFFSITE_SECRET_KEY` | idem | Backup offsite via rclone a bucket S3-compatible (R2/S3/B2) (§18) |

**CRITICO**: El deploy workflow (`deploy.yml`) regenera el `.env` completo desde GitHub Secrets en cada push a main. Si agregas variables solo al `.env` del VPS sin agregarlas a GitHub Secrets y al workflow, se perderan en el proximo deploy.

### Para agregar una variable nueva:
1. GitHub repo > Settings > Secrets > Actions > New secret
2. Editar `.github/workflows/deploy.yml`: agregar en env, envs, y script
3. Para efecto inmediato: `echo "VAR=valor" >> .env && docker compose up -d api`

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
- Verificar que todos los containers arrancaron: `docker ps` (~15 en prod)
- Verificar Bull Board: las 9 colas visibles
- Verificar Uptime Kuma: todos monitors en verde despues de 2 min
- Verificar Ops Center: `/admin/ops` sin incidentes criticos inesperados tras el deploy

---

## 13. Archivos de Configuracion

| Archivo | Proposito |
|---------|-----------|
| `infra/docker/docker-compose.prod.yml` | Stack completo: app + observabilidad (~15 contenedores) |
| `infra/promtail/config.yml` | Config de Promtail (que logs enviar a Loki) |
| `infra/loki/local-config.yaml` | Config de Loki (montada en el contenedor) |
| `infra/backup/backup.sh` | Backup DB (dentro del contenedor) + media + fiscal + Redis + offsite rclone + heartbeat (§18) |
| `apps/api/src/main.ts` | Pino logger init + Bull Board auth middleware |
| `apps/api/src/app.module.ts` | LoggerModule (Pino) + BullBoardModule (9 colas) config |
| `apps/api/src/modules/health/*` | Ops Center: `platform-monitor`, `incident`, `platform-storage`, `alert-config`, `telegram-alert`, `sms-alert`, `sentry-stats` services + controller (§15-19) |

---

## 14. LLM Provider Health Monitoring

Sistema de monitoreo de salud de los 5 proveedores LLM (openai, anthropic, google, xai, deepseek). Implementado en `ai/router/llm-router.service.ts`.

### Circuit Breaker (en Redis, compartido API + worker)

El breaker **no vive en memoria**: el estado de "abierto" se guarda en Redis, por lo que API y worker lo comparten. En cada fallo:

1. `isBreakableError()` filtra: 4xx client/config/rate-limit (400/401/403/404/422/429) **no** cuentan (fallarian en cualquier proveedor). Solo 5xx, timeouts y errores de red cuentan.
2. Un contador de ventana corta (`llm:health:{provider}:errwin`, TTL 60s) se incrementa; al llegar a **`BREAKER_THRESHOLD = 3`** fallos en la ventana, se abre el breaker escribiendo `llm:health:{provider}:open` con TTL = **`CIRCUIT_BREAKER_TTL_MS` = 120s (2 min)**.
3. Cuando el TTL de `:open` expira, la siguiente request prueba el proveedor de forma natural (half-open). No hay job de recuperacion.

Señal adicional **TTFT** (time-to-first-token, solo medible en el stream del Web Chat Widget): si el p95 reciente de un proveedor supera `TTFT_P95_THRESHOLD_MS = 8000` (con ≥20 muestras en `llm:ttft:{provider}:samples`, TTL 300s), el proveedor se degrada fuera de rotacion sin tocar el breaker de errores.

### Alert Thresholds

Un contador de ventana larga `llm:health:{provider}:failures` (TTL 600s = 10 min) alimenta las alertas. Al cruzar 3, 10 o 25 fallos, `EventEmitter2` emite `llm.provider.alert`:

| Failures | severity emitida |
|----------|------------------|
| 3 | warning |
| 10 | critical |
| 25 | critical |

Solo hay dos severidades (`warning`/`critical`, via `c >= 10 ? 'critical' : 'warning'`); **no existe un nivel `down`**. Si TODOS los candidatos de la cadena fallan en un turno, se emite ademas `llm.provider.alert` con `provider: 'all'` y `severity: 'critical'`.

### Capa 1 — WebSocket en tiempo real

`conversations.gateway.ts` escucha `@OnEvent('llm.provider.alert')` y emite `system:llm_alert` a las rooms WebSocket de `super_admin` y `tenant_admin` (campana en el TopBar + push notification del navegador para criticas).

### Capa 2 — Cron del Ops Center

`platform-monitor.service.ts → checkLlmProviders()` (dentro del cron `checkSystem`, cada 10 min) revisa `getProviderHealth()` y levanta incidentes/alertas: proveedores `configured && !healthy` (`llm:unhealthy`, critico), proveedores con `recentFailures >= 5` (`llm:failures:{provider}`), o ningun proveedor configurado (`llm:none_configured`, critico). Auto-resuelve cuando la condicion se despeja. Ver §15.

### Capa 3 — API Endpoint

`GET /api/v1/health/llm-providers` (solo `super_admin`) retorna un array; por proveedor:

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| provider | string | openai / anthropic / google / xai / deepseek |
| configured | boolean | Si tiene API key configurada (`llmKeys.isConfigured`) |
| healthy | boolean | `configured && !breakerAbierto` |
| recentFailures | number | Contador `llm:health:{provider}:failures` (ventana 10 min) |
| unhealthyUntil | string \| null | ISO del instante en que el breaker vuelve a probar (open + 2 min), o `null` |

> No existen los campos `name`, `lastFailure` ni `failureCount` — usar `provider`, `recentFailures` y `unhealthyUntil`.

### Circuit breaker de COSTO (por tenant)

Distinto del breaker de disponibilidad: `trackStats()` acumula el gasto mensual en `llm:cost:{tenantId}:{YYYY-MM}` (centi-USD, TTL ~40 dias). `TenantThrottleService.getLlmSpendUsdCents()` lo lee y, al alcanzar el `llmCostBudgetUsdCents` del plan, se corta el acceso a LLM. El Ops Center alerta al `llmBudgetPct` (default 90%) antes del corte (`llm:budget:{tenantId}`, ver §15).

### Redis Keys (salud + costo LLM)

| Key | Proposito | TTL |
|-----|-----------|-----|
| `llm:health:{provider}:open` | Estado "breaker abierto" (guarda el timestamp de apertura) | 120s |
| `llm:health:{provider}:errwin` | Contador de fallos breakables en ventana corta (abre el breaker a 3) | 60s |
| `llm:health:{provider}:failures` | Contador de fallos para alertas (umbrales 3/10/25) | 600s |
| `llm:ttft:{provider}:samples` | Reservoir de muestras TTFT para el p95 (degradado por lentitud) | 300s |
| `llm:affinity:{conversationId}` | Sticky routing provider:model por conversacion (cache warmth) | 1800s |
| `llm:cost:{tenantId}:{YYYY-MM}` | Gasto LLM mensual (centi-USD) para el breaker de costo | ~40 dias |
| `llm:stats:{tenantId}:{date}:{provider}:{counter}` | Rollup diario de uso (calls/tokens/cost/latency/errors) | 90 dias |

> El key antiguo `llm:failures:{provider}` quedo obsoleto; el actual es `llm:health:{provider}:failures`.

---

## 15. Ops Center — PlatformMonitorService

`modules/health/platform-monitor.service.ts` es el corazon del Centro de Operaciones (`super_admin`). Corre crons que evaluan señales de infraestructura, colas y negocio; cada condicion **persiste un incidente** deduplicado (§16) y dispara alertas throttleadas por email/Telegram/SMS (§17). Los umbrales son configurables en runtime via `AlertConfigService` (defaults abajo).

### Crons y checks

| Cron | Metodo | Que revisa |
|------|--------|------------|
| `*/10 * * * *` | `checkSystem` | disco, RAM, memoria Redis, conexiones cliente PostgreSQL, saturacion del pool PgBouncer (`SHOW POOLS`), errores de la app (Sentry), salud proveedores LLM + `incidents.sweepStale(48)` |
| `2,7,…,57 * * * *` (cada 5 min) | `checkQueues` | profundidad (waiting+active) y `failed` de las 4 colas core (outbound/broadcast/automation/nurturing) |
| `8,18,…,58 * * * *` (cada 10 min, desfasado) | `checkSlaBreaches` | conversaciones en handoff esperando >10 min sin respuesta de agente, por tenant |
| `0 * * * *` | `checkChannelTokens` | credenciales de canal con `rotationState='error'` (`tokens:error`) y las que vencen en ≤7 dias (`tokens:expiring`) |
| `0 * * * *` | `refreshAdmins` | refresca la lista de emails de super_admin destinatarios |
| `15 3 * * *` | `checkStorage` | snapshot de storage + proyeccion de llenado de disco (<14 dias) + cuota de media por-tenant (≥90%) |
| `30 7 * * *` | `checkRiskSignals` | pagos fallidos 24h, fallos del webhook de pagos (firma/procesamiento), presupuesto de IA por tenant, heartbeat de backup |

El boton "correr checks ahora" (`POST /health/checks/run`) invoca `runChecksNow()`, que ejecuta todos los checks sin esperar a los crons.

### Umbrales por defecto (`AlertConfigService`, editables en `/admin/ops/alerts`)

| Señal | warn | crit |
|-------|------|------|
| Disco (%) | 80 | 90 |
| RAM (%) | 85 | 95 |
| Redis mem (%) | 75 | 90 |
| Conexiones cliente PostgreSQL (%) | 80 | 90 |
| PgBouncer maxwait (s) | 5 | 20 |
| Errores app/Sentry (1h) | 50 | 200 |
| SLA breaches (conversaciones) | 10 | 30 |
| Profundidad cola outbound-messages | 500 | 2000 |
| Profundidad cola broadcast-messages | 1000 | 5000 |
| Profundidad cola automation-jobs | 300 | 1000 |
| Profundidad cola nurturing | 200 | 500 |

Escalares: `queueFailed=100`, `paymentFailures=5`, `llmBudgetPct=90`, `storageQuotaPct=90`, `diskProjectionDays=14`, `backupStaleHours=26`. Canales por defecto: `email:true, telegram:true, sms:false`. La config se guarda como JSON en `platform_settings` (key `ops.alert_config`) y se cachea en Redis (`ops:alert_config`, TTL 300s).

### Claves de alerta / incidente (`key`)

`disk:{warning|critical}`, `disk:projection`, `ram:*`, `redis:*`, `db:connections:*`, `pgbouncer:pool:*`, `sentry:errors:*`, `sla:breaches:*`, `queue:{name}:{warning|critical|failed}`, `storage:tenant:{tenantId}`, `tokens:error`, `tokens:expiring`, `billing:payment_failures`, `billing:webhook_signature`, `billing:webhook_processing`, `llm:budget:{tenantId}`, `llm:unhealthy`, `llm:failures:{provider}`, `llm:none_configured`, `backup:stale`.

Las claves criticas fijas (mapeadas por `severityFromKey`): `llm:none_configured`, `llm:unhealthy`, `tokens:error`, `backup:stale`, mas cualquier key terminada en `:critical`.

---

## 16. Incidents — IncidentService

`modules/health/incident.service.ts` convierte las alertas efimeras en registros persistentes, deduplicados y accionables (tabla global `platform_incidents`).

- **`record(key, severity, title, body, value)`**: en cada disparo hace upsert del incidente ABIERTO de esa `key` (bump `count`/`lastSeenAt` si existe, si no lo crea con `status='active'`). Se llama SIEMPRE, independiente del cooldown de email, para que las re-emisiones sobrevivan reinicios.
- **`resolveByKey(key)`**: cuando la condicion se despeja, marca `resolved` (`resolvedBy='system'`) todos los abiertos de esa key.
- **`sweepStale(staleHours=48)`**: backstop que auto-resuelve incidentes abiertos no vistos en 48h (para alertas diarias que dejan de re-emitirse). Corre dentro de `checkSystem`.
- Estados: `active` → `acknowledged` → `resolved`.

### Endpoints (todos `super_admin`, prefijo `/api/v1/health`)

| Metodo + ruta | Proposito |
|---------------|-----------|
| `GET /incidents?status=&severity=&limit=&offset=` | Lista incidentes (paginado; orden: abiertos primero, luego `lastSeenAt` desc) |
| `GET /incidents/summary` | Conteos: `activeCritical`, `activeWarning`, `acknowledged`, `resolved24h` |
| `POST /incidents/:id/ack` | Reconocer (guarda `acknowledgedBy` = email del super_admin) |
| `POST /incidents/:id/resolve` | Resolver manualmente |

UI: `/admin/incidents` (lista + ack/resolve) y el resumen en `/admin/ops`.

---

## 17. Alertas de plataforma (email + Telegram + SMS)

El metodo `PlatformMonitorService.alert(key, subject, html, value)` centraliza el envio:

1. **Siempre** llama `incidents.record(...)` (persistencia/dedup).
2. Aplica el **cooldown de 1 hora por key** (`COOLDOWN_MS`, en memoria) a los envios; el incidente igual se persiste aunque el envio este en cooldown.
3. Emite por los canales activos en `AlertConfigService.channels`:
   - **Telegram** (`TelegramAlertService`): bot dedicado del canal de ops (`TELEGRAM_ALERT_BOT_TOKEN` + `TELEGRAM_ALERT_CHAT_ID`), HTML subset. No-op si falta config.
   - **SMS** (`SmsAlertService`, Twilio REST): **solo severidad critica** (intrusivo/costoso). Vars `SMS_ALERT_ACCOUNT_SID` / `SMS_ALERT_AUTH_TOKEN` / `SMS_ALERT_FROM` / `SMS_ALERT_TO` (E.164 separados por coma). Separado del canal SMS de tenants.
   - **Email** (`EmailService`, nodemailer): a todos los super_admin activos (`role='super_admin', isActive=true`), plantilla HTML.

`SentryStatsService` (`SENTRY_AUTH_TOKEN` + `SENTRY_ORG`, opcional `SENTRY_PROJECT` numerico y `SENTRY_API_URL`) lee la tasa de errores de la ultima hora via la API stats_v2 de Sentry para alimentar `sentry:errors:*`. No-op (retorna `null`) si no esta configurado.

**Vars de entorno nuevas** (recordar: agregar a GitHub Secrets **y** a `deploy.yml`): `TELEGRAM_ALERT_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID`, `SMS_ALERT_ACCOUNT_SID`, `SMS_ALERT_AUTH_TOKEN`, `SMS_ALERT_FROM`, `SMS_ALERT_TO`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_API_URL`.

---

## 18. Backups y heartbeat

`infra/backup/backup.sh` (crontab `0 2 * * *`, log en `/var/log/parallext-backup.log`):

- **DB**: `pg_dump`/`psql` corren **DENTRO del contenedor `parallext-postgres`** (`docker exec`), asi el host no necesita `postgresql-client` y la version de cliente siempre coincide con el server. Respalda schema `public` + todos los schemas de tenant.
- Tambien respalda media (`parallext-media-data`), facturas fiscales (`parallext-fiscal-data`) y Redis.
- **Offsite** opcional via `rclone` a bucket S3-compatible (Cloudflare **R2** / AWS S3 / Backblaze B2), config desde `OFFSITE_*` en el `.env` (sobrevive al `git reset --hard` del deploy).
- **Heartbeat**: al completar y verificar el backup, hace `docker exec parallext-redis redis-cli SET backup:last_success <epoch_ms>`. Si el backup queda incompleto, **NO** actualiza el heartbeat a proposito, para que el monitor alerte.

El Ops Center (`checkBackupHeartbeat`, cron diario 7:30 AM) lee `backup:last_success` y levanta el incidente critico **`backup:stale`** si la antiguedad supera `backupStaleHours` (default **26h**). Si el heartbeat nunca se seteo, se mantiene en silencio (evita falso positivo).

> Fix 2026-07-23: los scripts de infra se versionan con bit de ejecucion **100755** (antes se perdia el exec-bit y el cron no corria). No hand-editar scripts trackeados en el VPS: el deploy hace `git reset --hard`.

Detalle operativo completo (restauracion, verificacion, RTO/RPO) en `docs/backup-restore-runbook.md`.

---

## 19. Superficie /health (resumen)

Prefijo global `/api/v1`. Liveness es publico; el resto requiere `super_admin`.

| Ruta | Auth | Proposito |
|------|------|-----------|
| `GET /health` | publico | Liveness (Docker healthcheck + Uptime Kuma): pings DB + Redis, `status: healthy\|degraded` |
| `GET /health/detailed` | publico | Memoria proceso/sistema, memoria Redis, CPU/load, profundidad de colas, `activeAlerts` |
| `GET /health/llm-providers` | super_admin | Salud de los 5 proveedores LLM (§14) |
| `GET /health/storage` | super_admin | Reporte de media (`MediaCleanupService`) |
| `GET /health/storage/overview` | super_admin | Disco + totales de storage |
| `GET /health/storage/tenants` | super_admin | Storage por-tenant (schema DB + media + cuota) |
| `GET /health/storage/history?days=&tenantId=` | super_admin | Historico de snapshots para la grafica de tendencia |
| `GET /health/incidents[/summary]` · `POST /health/incidents/:id/{ack,resolve}` | super_admin | Incidentes (§16) |
| `GET \| PUT /health/alert-config` | super_admin | Leer/editar umbrales y canales (§15) |
| `POST /health/checks/run` | super_admin | Ejecuta todos los checks del monitor on-demand |
| `POST /health/media-cleanup?dryRun=` | super_admin | Limpieza de media huerfana (dry-run por defecto) |

Ver tambien: gobernanza de acceso `super_admin` (impersonacion con motivo, sesion emparejada, actor real en auditoria) en `docs/superadmin-governance.md`; ciclo de facturacion mensual/anual en `docs/billing-annual-cycle.md`.
