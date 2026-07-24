# Parallly Analytics — Manual Completo

_Ultima actualizacion: jul-2026 · v2_

## Resumen

El sistema de analytics de Parallly proporciona visibilidad completa sobre el rendimiento del tenant: conversaciones, agentes, IA (resolucion + calidad), canales, automatizaciones, campanas, anomalias y retension de clientes. Incluye alertas por umbral, reportes programados por email (plan-gated), un constructor de reportes personalizados (Custom Report Builder) y una API externa para herramientas de BI (plan-gated).

**Rutas de endpoints (prefijo global `/api/v1`):**

| Grupo | Base path | Auth |
|-------|-----------|------|
| Dashboard analytics del tenant | `/dashboard-analytics/*` | JWT + RolesGuard + TenantGuard |
| Alertas / reportes programados / saved reports | `/analytics-config/*` | JWT + RolesGuard + TenantGuard |
| Calidad (LLM-judge) | `/quality/*` | JWT + RolesGuard + TenantGuard |
| Analytics legacy (dashboards antiguos + compliance + audit) | `/analytics/*` | JWT + RolesGuard + TenantGuard |
| BI API externa | `/bi-api/*` | `X-API-Key` (sin JWT) |

---

## 1. Dashboard de Analytics (`/admin/analytics-v2`)

### 12 Tabs disponibles

El orden real de tabs (de `analytics-v2/page.tsx`, constante `TABS`) es:
`overview → aiBotTab → aiResolutionTab → qualityTab → crmTab → agentsTab → automationTab → broadcastTab → channelsTab → csatTab → anomaliesTab → cohortsTab`.

#### Tab 1: Vista General (Overview)
- **6 KPI Cards** con comparacion automatica vs periodo anterior:
  - Conversaciones totales
  - Mensajes procesados
  - Tasa de resolucion IA (%)
  - Tiempo promedio de respuesta
  - CSAT promedio (1-5)
  - Costo LLM total ($)
- **Grafico de barras apiladas**: volumen diario por canal (WhatsApp/Instagram/Messenger/Telegram)
- **Grafico de lineas**: tiempos de respuesta (mediana + P90) y tiempos de resolucion
- **Heatmap de horas pico**: grid 7 dias x 24 horas con intensidad de color

#### Tab 2: IA & Bot
- **KPIs**: tasa de resolucion IA, tasa de contencion, conversaciones totales, resueltas por IA, escalaciones, costo total
- **Pie chart**: uso por modelo de LLM (GPT-4o, Claude, Gemini, etc.) con conteo de requests y costo
- **Bar chart horizontal**: razones de escalacion (handoff)

#### Tab 3: Resolucion IA (AI Resolution)
- Widget dedicado (`AiResolutionWidget`). Endpoint: `GET /dashboard-analytics/ai-resolution/:tenantId?start&end&granularity` — **solo `super_admin` y `tenant_admin`** (`@Roles`)
- **Summary**: total de conversaciones, resueltas por IA / por agente / auto-resueltas / sin resolver, tasa de resolucion IA, promedio de mensajes hasta la resolucion y promedio de mensajes de IA antes del handoff
- **Trend**: serie temporal de la tasa de resolucion (granularidad `day` por defecto, tambien `week`)
- **Breakdown por canal**: tasa de resolucion desglosada por canal

#### Tab 4: Calidad (Quality)
- Widget dedicado (`QualityWidget`). Endpoints: `GET /quality/:tenantId?start&end` y `GET /quality/:tenantId/flagged?start&end&limit` (modulo `quality`, mismo motor LLM-judge de la simulacion de agentes T2.13)
- **Summary**: conversaciones evaluadas (`scored`), scores promedio (overall, resolution, tone, accuracy, empathy), distribucion excellent/ok/poor, conteo de conversaciones marcadas (`flagged`) y `verifiedResolutionRate`
- **Flagged**: lista de conversaciones marcadas (overall, flags, tipo de resolucion, `resolutionVerified`, motivo de verificacion)

#### Tab 5: CRM (redirect)
- No renderiza datos: es una tarjeta que redirige a la pagina dedicada `/admin/crm-analytics` (funnel, velocity, win/loss, leaderboard, sources)

#### Tab 6: Agentes (redirect)
- No renderiza datos: tarjeta que redirige a la pagina dedicada `/admin/agent-analytics` (reportes por agente: Overview/Agents/Channels/CSAT)

#### Tab 7: Automatizacion
- **KPIs**: reglas totales, reglas activas, ejecuciones totales, tasa de exito
- **Grafico barras apiladas**: ejecuciones por dia (exito vs fallido)
- **Tabla de rendimiento por regla**: nombre, disparador, estado (activa/inactiva), ejecuciones, exitos, fallos

#### Tab 8: Campanas (Broadcast Funnel)
- **Funnel visual**: barras proporcionales mostrando Total -> Enviados -> Entregados -> Leidos -> Fallidos
- **Tabla por campana**: nombre, canal, total, enviados, entregados, leidos, fallidos, tasa de entrega (%), tasa de lectura (%)

#### Tab 9: Canales
- **4 cards**: una por canal con total de conversaciones, porcentaje del total, barra de progreso
- **Grafico de area apilada**: volumen por canal a lo largo del tiempo
- Nota: el pivot de canales cubre solo WhatsApp/Instagram/Messenger/Telegram (ver seccion **Limitaciones**)

#### Tab 10: CSAT
- **Score prominente**: numero grande con estrellas visuales, color-coded (verde >= 4, naranja >= 3, rojo < 3)

#### Tab 11: Anomalias
- **Deteccion automatica**: usa z-score sobre ventana de 30 dias. Si una metrica se desvia mas de 2 desviaciones estandar en los ultimos 3 dias, se marca como anomalia
- **Tabla**: metrica, fecha, valor, promedio, z-score (badge sigma)
- **Indicador verde**: cuando no hay anomalias detectadas
- **Metricas monitoreadas**: conversations, messages, handoffs

#### Tab 12: Cohortes
- **Matriz de retencion**: contactos agrupados por mes de primer contacto
- **Cada celda**: porcentaje de contacts que volvieron a tener conversaciones en meses subsiguientes
- **Color-coded**: gradiente de verde (0% transparente a 100% intenso)

### Controles del Dashboard
- **Date Range Picker**: presets (7 dias, 30 dias, 90 dias) + rango personalizado
- **Export CSV**: descarga completa de KPIs, volumen, tiempos de respuesta, metricas IA (`GET /dashboard-analytics/export/:tenantId`)
- **Panel Real-time**: barra superior con 6 indicadores en vivo (polling cada 30 segundos):
  - Conversaciones activas
  - Agentes online (con pulso verde)
  - Agentes ocupados
  - En cola de espera
  - Agentes offline
  - Mensajes hoy

---

## 2. Sistema de Alertas (`/admin/settings/alerts`)

### Como funciona
1. El administrador crea reglas de alerta con: nombre, metrica, operador, umbral, destinatarios email, cooldown
2. Un cron evalua TODAS las reglas activas cada 15 minutos (`AlertsService`, `@Cron('*/15 * * * *')`)
3. Si una metrica supera el umbral Y el cooldown ha pasado, se dispara la alerta
4. La alerta se registra en `alert_history` y se envia email a los destinatarios

### Metricas disponibles para alertas
| Metrica | Descripcion | Fuente |
|---------|-------------|--------|
| `active_conversations` | Conversaciones abiertas actualmente | realtime |
| `queue_depth` | Conversaciones esperando agente humano | realtime |
| `agents_online` | Agentes con status "online" | realtime |
| `messages_today` | Total de mensajes procesados hoy | realtime |
| `handoffs_today` | Escalaciones a humano hoy | contador Redis `analytics:{tenantId}:{date}:handoff_triggered` |
| `llm_cost_today` | Costo de LLM acumulado hoy | contador Redis `analytics:{tenantId}:{date}:cost` |

### Operadores soportados
`>`, `>=`, `<`, `<=`, `=` (el motor tambien acepta los alias `gt`/`gte`/`lt`/`lte`/`eq`)

### Cooldown
Tiempo minimo entre dos disparos de la misma alerta. Evita spam de notificaciones. Default: 60 minutos.

### Ejemplo de regla
- **Nombre**: "Cola alta"
- **Metrica**: `queue_depth`
- **Operador**: `>`
- **Umbral**: 10
- **Cooldown**: 30 min
- **Emails**: admin@empresa.com
- **Resultado**: Si hay mas de 10 conversaciones esperando agente, envia email cada 30 minutos max

Endpoints (base `/analytics-config`): `GET alerts/:tenantId`, `POST alerts/:tenantId`, `PUT alerts/:tenantId/:ruleId`, `DELETE alerts/:tenantId/:ruleId`, `GET alerts/:tenantId/:ruleId/history`. Crear/editar/borrar requiere `tenant_admin`/`super_admin`.

---

## 3. Informes Programados

> **Plan-gated**: la funcion requiere el feature `scheduledReports`. Sin el, los endpoints de configuracion devuelven `403 { error: 'feature_not_available', feature: 'scheduledReports' }` y el cron de envio salta al tenant.

### Configuracion
En `/admin/settings/alerts` (seccion inferior):
- **Frecuencia**: Semanal (lunes 8 AM) o Mensual (dia 1, 8 AM)
- **Destinatarios**: lista de emails separados por coma
- **Activo**: toggle on/off

Endpoints (base `/analytics-config`): `GET reports/:tenantId`, `POST reports/:tenantId` (upsert; `tenant_admin`/`super_admin`). Ambos verifican el feature `scheduledReports` antes de responder.

### Contenido del email
El reporte HTML incluye:
- **Header** con gradiente Parallly + nombre del tenant + periodo
- **Tabla de KPIs**: Conversaciones, Mensajes, Resolucion IA, Tiempo Respuesta, CSAT, Costo LLM — cada uno con valor, tendencia (flechas color), % cambio
- **Metricas de IA**: 3 cards (Resolucion IA, Contencion, Escalaciones)
- **Footer** con nota de generacion automatica

Los crones `sendWeeklyReports` (`@Cron('0 8 * * 1')`) y `sendMonthlyReports` (`@Cron('0 8 1 * *')`) recorren los tenants activos y, por cada uno, verifican `scheduledReports` antes de generar y enviar.

---

## 4. Custom Report Builder (`/admin/report-builder`)

Constructor de reportes personalizados: el tenant elige metricas y tipo de grafico y guarda la configuracion como reporte reutilizable (16 metricas, 4 tipos de grafico; save / edit / duplicate / favorite).

- Persistencia: tabla lazy **`saved_reports`** por-tenant (`id`, `name`, `description`, `config JSONB`, `created_by`, `is_favorite`, `created_at`, `updated_at`). La config del grafico/metricas vive en `config`
- Endpoints (base `/analytics-config`, servicio `SavedReportsService`):

```
GET    analytics-config/saved-reports/:tenantId              # listar (favoritos primero)
GET    analytics-config/saved-reports/:tenantId/:reportId    # obtener uno
POST   analytics-config/saved-reports/:tenantId              # crear (guarda created_by = usuario)
PUT    analytics-config/saved-reports/:tenantId/:reportId    # actualizar (incl. is_favorite)
DELETE analytics-config/saved-reports/:tenantId/:reportId    # borrar
```

Crear/actualizar/borrar requieren `tenant_admin`/`super_admin`; listar/obtener estan disponibles para roles del tenant.

---

## 5. Analitica de Citas (Appointment Analytics)

Endpoint dedicado para tenants con agenda/reservas: `GET /dashboard-analytics/appointments/:tenantId?start&end`.

Devuelve KPIs de citas, volumen diario, desglose por servicio, desglose por fuente (source) y horas pico. Comparte los guards del resto del dashboard (JWT + Roles + Tenant).

---

## 6. API para BI Tools (`/bi-api/`)

> **Plan-gated**: ademas de la API key, se valida el feature `biApi`. Si el plan del tenant no lo incluye, devuelve `403 Forbidden` ("BI API is not available on your current plan"). El tenant tambien debe estar activo (`isActive`).

### Autenticacion
- Header: `X-API-Key: <api-key>`
- La API key se almacena en `tenant.settings.biApiKey` (campo JSONB del tenant)
- No requiere JWT — disenado para integracion con Grafana, Metabase, etc.

### Endpoints disponibles

```
GET /api/v1/bi-api/kpis?start=2026-07-01&end=2026-07-15
GET /api/v1/bi-api/time-series?start=2026-07-01&end=2026-07-15
GET /api/v1/bi-api/ai-metrics?start=2026-07-01&end=2026-07-15
GET /api/v1/bi-api/realtime
GET /api/v1/bi-api/export?start=2026-07-01&end=2026-07-15
GET /api/v1/bi-api/anomalies
GET /api/v1/bi-api/cohorts?months=6
```

### Ejemplo de uso con curl
```bash
curl -H "X-API-Key: tu-api-key-aqui" \
  "https://api.parallly-chat.cloud/api/v1/bi-api/realtime"
```

### Ejemplo de respuesta (realtime)
```json
{
  "success": true,
  "data": {
    "activeConversations": 23,
    "agentsOnline": 5,
    "agentsBusy": 3,
    "agentsOffline": 2,
    "queueDepth": 4,
    "messagesToday": 847
  }
}
```

---

## 7. Deteccion de Anomalias

### Algoritmo
1. Consulta los ultimos 30 dias de datos (conversations, messages, handoffs) por dia
2. Calcula media (avg) y desviacion estandar (stdDev) para cada metrica
3. Para los ultimos 3 dias, calcula el z-score: `|value - avg| / stdDev`
4. Si z-score > 2.0, se marca como anomalia
5. Requiere minimo 7 dias de datos para funcionar

### Interpretacion del z-score
| z-score | Significado |
|---------|-------------|
| < 2.0 | Normal (dentro del rango esperado) |
| 2.0 - 3.0 | Anomalia moderada (ocurre ~5% de las veces) |
| > 3.0 | Anomalia significativa (ocurre ~0.3% de las veces) |

---

## 8. Analisis de Cohortes

### Como funciona
1. Agrupa contactos por mes de primer contacto (campo `first_contact_at`)
2. Para cada cohorte, verifica cuantos contactos tuvieron conversaciones en meses subsiguientes
3. Calcula retencion como: `(activos en mes N / tamano de cohorte) * 100%`

### Ejemplo de lectura
| Cohorte | Tamano | Mes 0 | Mes 1 | Mes 2 | Mes 3 |
|---------|--------|-------|-------|-------|-------|
| 2026-01 | 150 | 100% | 45% | 32% | 28% |
| 2026-02 | 200 | 100% | 52% | 38% | — |
| 2026-03 | 180 | 100% | 48% | — | — |

Interpretacion: De los 150 contactos que llegaron en enero, 45% volvieron en febrero, 32% en marzo, etc.

---

## 9. Cron Jobs del Sistema

| Cron | Horario | Servicio | Que hace |
|------|---------|----------|----------|
| Agregacion de metricas | Diario 2:00 AM | MetricsAggregationService | Agrega datos del dia anterior en `daily_metrics` (dimensiones global/channel/hourly) para consultas historicas rapidas |
| Evaluacion de alertas | Cada 15 min | AlertsService | Evalua reglas activas, dispara alertas si se supera umbral + cooldown |
| Reporte semanal | Lunes 8:00 AM | ScheduledReportsService | Genera y envia email con KPIs de los ultimos 7 dias (solo tenants con `scheduledReports`) |
| Reporte mensual | Dia 1, 8:00 AM | ScheduledReportsService | Genera y envia email con KPIs de los ultimos 30 dias (solo tenants con `scheduledReports`) |
| Auto-offline agentes | Cada 5 min | AgentAvailabilityService | Marca offline a agentes sin actividad en 15 min |
| Auto-resolve conversaciones | Cada 6 horas | NurturingService | Resuelve conversaciones con 72h sin actividad |
| Stale check + nurturing | Cada 2 horas | NurturingService | Detecta conversaciones con 4h+ sin respuesta del cliente y programa follow-up |

---

## 10. Tablas de Base de Datos (Analytics)

```sql
-- Eventos de analytics (log general)
analytics_events (id, event_type, conversation_id, contact_id, data JSONB, created_at)

-- Metricas diarias pre-agregadas (para consultas historicas rapidas)
daily_metrics (id, tenant_id, metric_date, dimension_type, dimension_id, metrics_json JSONB)
  -- dimension_type que ESCRIBE el cron nocturno: 'global', 'channel', 'hourly'
  -- ('agent' esta reservado en el esquema pero NO lo pobla MetricsAggregationService)

-- Encuestas CSAT
csat_surveys (id, conversation_id UNIQUE, contact_id, agent_id, rating 1-5, feedback, sent_at, responded_at)

-- Asignaciones de conversacion (para response time tracking)
conversation_assignments (id, conversation_id, agent_id, assigned_at, first_response_at, resolved_at)

-- Reglas de alerta (tabla lazy por-tenant: se crea on-demand)
alert_rules (id, tenant_id, name, metric, operator, threshold, channel, notify_emails[], is_active, last_triggered_at, cooldown_minutes)

-- Historial de alertas (tabla lazy por-tenant)
alert_history (id, rule_id, metric_value, threshold, notified_via, created_at)

-- Configuracion de reportes programados (tabla lazy por-tenant)
scheduled_reports (id, tenant_id, frequency, recipients[], is_active, last_sent_at)

-- Reportes personalizados guardados (Custom Report Builder, tabla lazy por-tenant)
saved_reports (id, name, description, config JSONB, created_by, is_favorite, created_at, updated_at)

-- Preferencias de dashboard por usuario
dashboard_preferences (id, user_id UNIQUE, layout_json JSONB)
```

> **Tablas lazy**: `alert_rules`, `alert_history`, `scheduled_reports` y `saved_reports` se crean con `CREATE TABLE IF NOT EXISTS` la primera vez que el tenant usa la funcion (no vienen del bootstrap). `alert_rules`/`scheduled_reports` incluyen una migracion in-place de `tenant_id` text -> uuid para esquemas antiguos.

---

## 11. Redis Keys (Referencia Completa)

```
-- Analytics counters (7-day TTL)
analytics:{tenantId}:{date}:conversation_started
analytics:{tenantId}:{date}:total
analytics:{tenantId}:{date}:handoff_triggered
analytics:{tenantId}:{date}:cost
analytics:{tenantId}:{date}:model:{modelName}
analytics:{tenantId}:{date}:hourly:{0-23}

-- Cache de "tabla ya creada" (evita re-CREATE por request)
alert_tables:{schema}          — 24h TTL
sched_report_tables:{schema}   — 24h TTL

-- Session management
refresh:{userId}:{tokenId}  — 8h o 14d TTL segun Remember Me

-- Caching
tenant:{tenantId}:schema    — 1h TTL
broadcast:tables:v2:{schema} — 24h TTL

-- Idempotency
idem:wa:{messageId}  — 24h
idem:ig:{messageId}  — 24h
idem:fb:{messageId}  — 24h
idem:tg:{updateId}   — 24h

-- CSAT
csat:pending:{conversationId} — 24h

-- Rate limiting
ratelimit:{tenantId}:{window}
```

---

## 12. Limitaciones conocidas

- **Sin segmentacion por `channel_account`**: con multi-cuenta por tipo (p. ej. 2 numeros WhatsApp o 2 cuentas de Instagram), el pivot de volumen agrupa por `channel_type` (`GROUP BY DATE(created_at), channel_type`), por lo que las conexiones del mismo tipo se **colapsan** en un solo bucket. No hay desglose por numero/cuenta emisora.
- **Pivot de canales incompleto**: el grafico y el CSV de volumen por canal solo contemplan `whatsapp`, `instagram`, `messenger`, `telegram`. **SMS queda fuera** (es notificacion one-way por creditos reseller, no canal conversacional), y **Email** y **Web Chat Widget** tampoco figuran en el pivot de canales.
- **Realtime es puntual**: los 6 indicadores del panel en vivo son un snapshot del momento (polling 30s), no una serie historica.
- **Alertas sobre metricas realtime/diarias**: las 6 metricas de alerta se leen de `getRealtime` + contadores Redis del dia; no cubren metricas historicas arbitrarias.

---

## 13. Referencias cruzadas

- **Analitica de agentes** — pagina `/admin/agent-analytics` (tenant): reportes por agente (Overview/Agents/Channels/CSAT). Tab "Agentes" del dashboard redirige aqui.
- **Analitica CRM** — pagina `/admin/crm-analytics` (tenant): funnel, velocity, win/loss, leaderboard, sources. Tab "CRM" del dashboard redirige aqui. Backend: `crm/services/crm-analytics/`.
- **Analitica por vertical** — pagina `/admin/vertical-analytics` (plataforma, super_admin): metricas agregadas por industria/vertical. Modulo `vertical-analytics/`.
- **Referencia consolidada de endpoints** (12 dashboard + BI) + schemas + billing: `docs/analytics-billing-reference.md`.
