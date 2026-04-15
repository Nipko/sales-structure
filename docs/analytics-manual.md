# Parallly Analytics — Manual Completo

## Resumen

El sistema de analytics de Parallly proporciona visibilidad completa sobre el rendimiento del tenant: conversaciones, agentes, IA, canales, automatizaciones, campanas, anomalias y retension de clientes. Incluye alertas por umbral, reportes programados por email, y una API externa para herramientas de BI.

---

## 1. Dashboard de Analytics (`/admin/analytics-v2`)

### 8 Tabs disponibles

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

#### Tab 3: Automatizacion
- **KPIs**: reglas totales, reglas activas, ejecuciones totales, tasa de exito
- **Grafico barras apiladas**: ejecuciones por dia (exito vs fallido)
- **Tabla de rendimiento por regla**: nombre, disparador, estado (activa/inactiva), ejecuciones, exitos, fallos

#### Tab 4: Campanas (Broadcast Funnel)
- **Funnel visual**: barras proporcionales mostrando Total -> Enviados -> Entregados -> Leidos -> Fallidos
- **Tabla por campana**: nombre, canal, total, enviados, entregados, leidos, fallidos, tasa de entrega (%), tasa de lectura (%)

#### Tab 5: Canales
- **4 cards**: una por canal con total de conversaciones, porcentaje del total, barra de progreso
- **Grafico de area apilada**: volumen por canal a lo largo del tiempo

#### Tab 6: CSAT
- **Score prominente**: numero grande con estrellas visuales, color-coded (verde >= 4, naranja >= 3, rojo < 3)

#### Tab 7: Anomalias
- **Deteccion automatica**: usa z-score sobre ventana de 30 dias. Si una metrica se desvia mas de 2 desviaciones estandar en los ultimos 3 dias, se marca como anomalia
- **Tabla**: metrica, fecha, valor, promedio, z-score (badge sigma)
- **Indicador verde**: cuando no hay anomalias detectadas
- **Metricas monitoreadas**: conversations, messages, handoffs

#### Tab 8: Cohortes
- **Matriz de retencion**: contactos agrupados por mes de primer contacto
- **Cada celda**: porcentaje de contacts que volvieron a tener conversaciones en meses subsiguientes
- **Color-coded**: gradiente de verde (0% transparente a 100% intenso)

### Controles del Dashboard
- **Date Range Picker**: presets (7 dias, 30 dias, 90 dias) + rango personalizado
- **Export CSV**: descarga completa de KPIs, volumen, tiempos de respuesta, metricas IA
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
2. Un cron evalua TODAS las reglas activas cada 15 minutos
3. Si una metrica supera el umbral Y el cooldown ha pasado, se dispara la alerta
4. La alerta se registra en `alert_history` y se envia email a los destinatarios

### Metricas disponibles para alertas
| Metrica | Descripcion |
|---------|-------------|
| `active_conversations` | Conversaciones abiertas actualmente |
| `queue_depth` | Conversaciones esperando agente humano |
| `agents_online` | Agentes con status "online" |
| `messages_today` | Total de mensajes procesados hoy |
| `handoffs_today` | Escalaciones a humano hoy |
| `llm_cost_today` | Costo de LLM acumulado hoy |

### Operadores soportados
`>`, `>=`, `<`, `<=`, `=`

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

---

## 3. Informes Programados

### Configuracion
En `/admin/settings/alerts` (seccion inferior):
- **Frecuencia**: Semanal (lunes 8 AM) o Mensual (dia 1, 8 AM)
- **Destinatarios**: lista de emails separados por coma
- **Activo**: toggle on/off

### Contenido del email
El reporte HTML incluye:
- **Header** con gradiente Parallly + nombre del tenant + periodo
- **Tabla de KPIs**: Conversaciones, Mensajes, Resolucion IA, Tiempo Respuesta, CSAT, Costo LLM — cada uno con valor, tendencia (flechas color), % cambio
- **Metricas de IA**: 3 cards (Resolucion IA, Contencion, Escalaciones)
- **Footer** con nota de generacion automatica

---

## 4. API para BI Tools (`/bi-api/`)

### Autenticacion
- Header: `X-API-Key: <api-key>`
- La API key se almacena en `tenant.settings.biApiKey` (campo JSONB del tenant)
- No requiere JWT — disenado para integracion con Grafana, Metabase, etc.

### Endpoints disponibles

```
GET /api/v1/bi-api/kpis?start=2026-04-01&end=2026-04-15
GET /api/v1/bi-api/time-series?start=2026-04-01&end=2026-04-15
GET /api/v1/bi-api/ai-metrics?start=2026-04-01&end=2026-04-15
GET /api/v1/bi-api/realtime
GET /api/v1/bi-api/export?start=2026-04-01&end=2026-04-15
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

## 5. Deteccion de Anomalias

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

## 6. Analisis de Cohortes

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

## 7. Cron Jobs del Sistema

| Cron | Horario | Servicio | Que hace |
|------|---------|----------|----------|
| Agregacion de metricas | Diario 2:00 AM | MetricsAggregationService | Agrega datos del dia anterior en `daily_metrics` para consultas historicas rapidas |
| Evaluacion de alertas | Cada 15 min | AlertsService | Evalua reglas activas, dispara alertas si se supera umbral + cooldown |
| Reporte semanal | Lunes 8:00 AM | ScheduledReportsService | Genera y envia email con KPIs de los ultimos 7 dias |
| Reporte mensual | Dia 1, 8:00 AM | ScheduledReportsService | Genera y envia email con KPIs de los ultimos 30 dias |
| Auto-offline agentes | Cada 5 min | AgentAvailabilityService | Marca offline a agentes sin actividad en 15 min |
| Auto-resolve conversaciones | Cada 6 horas | NurturingService | Resuelve conversaciones con 72h sin actividad |
| Stale check + nurturing | Cada 2 horas | NurturingService | Detecta conversaciones con 4h+ sin respuesta del cliente y programa follow-up |

---

## 8. Tablas de Base de Datos (Analytics)

```sql
-- Eventos de analytics (log general)
analytics_events (id, event_type, conversation_id, contact_id, data JSONB, created_at)

-- Metricas diarias pre-agregadas (para consultas historicas rapidas)
daily_metrics (id, tenant_id, metric_date, dimension_type, dimension_id, metrics_json JSONB)
  -- dimension_type: 'global', 'channel', 'agent', 'hourly'

-- Encuestas CSAT
csat_surveys (id, conversation_id UNIQUE, contact_id, agent_id, rating 1-5, feedback, sent_at, responded_at)

-- Asignaciones de conversacion (para response time tracking)
conversation_assignments (id, conversation_id, agent_id, assigned_at, first_response_at, resolved_at)

-- Reglas de alerta
alert_rules (id, tenant_id, name, metric, operator, threshold, channel, notify_emails[], is_active, last_triggered_at, cooldown_minutes)

-- Historial de alertas
alert_history (id, rule_id, metric_value, threshold, notified_via, created_at)

-- Configuracion de reportes programados
scheduled_reports (id, tenant_id, frequency, recipients[], is_active, last_sent_at)

-- Preferencias de dashboard por usuario
dashboard_preferences (id, user_id UNIQUE, layout_json JSONB)
```

---

## 9. Redis Keys (Referencia Completa)

```
-- Analytics counters (7-day TTL)
analytics:{tenantId}:{date}:conversation_started
analytics:{tenantId}:{date}:total
analytics:{tenantId}:{date}:handoff_triggered
analytics:{tenantId}:{date}:cost
analytics:{tenantId}:{date}:model:{modelName}
analytics:{tenantId}:{date}:hourly:{0-23}

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
