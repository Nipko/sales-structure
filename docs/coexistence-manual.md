# WhatsApp Coexistence Mode — Manual Técnico

## Resumen

El modo Coexistencia permite que un número de WhatsApp Business App opere simultáneamente
con el Cloud API. El negocio mantiene su app activa en el teléfono mientras la plataforma
(Parallly) recibe y procesa mensajes a través de la API.

**Lanzamiento**: Mayo 2025 (disponibilidad global mayo 2026)
**Embedded Signup**: Se activa con `featureType: 'whatsapp_business_app_onboarding'`

---

## Arquitectura de datos

### Flujo de webhooks de Coexistencia

```
Meta Cloud API
  │
  ├── field: "history"              → Historial de chats (hasta 6 meses)
  │     └─ WebhooksService.handleHistoryEvent()
  │          └─ BullMQ job: process-coex-history
  │               └─ WebhookProcessor.processCoexHistory()
  │                    └─ forwardToConversationsService() con source='historical'
  │
  ├── field: "smb_message_echoes"   → Mensajes enviados desde la app (tiempo real)
  │     └─ WebhooksService.handleMessageEchoEvent()
  │          └─ BullMQ job: process-coex-echo
  │               └─ WebhookProcessor.processCoexEcho()
  │                    └─ forwardToConversationsService() con source='waba_echo'
  │
  └── field: "smb_app_state_sync"   → Contactos de la app
        └─ WebhooksService.handleContactSyncEvent()
             └─ BullMQ job: process-coex-contacts
                  └─ WebhookProcessor.processCoexContacts()
                       └─ Upsert directo en tabla contacts
```

### Diferencia entre tipos de mensaje

| Campo webhook          | Job BullMQ             | `metadata.source` | Dirección   | Trigger IA | Trigger automación | Abre ventana 24h |
|------------------------|------------------------|--------------------|-------------|------------|--------------------|--------------------|
| `messages`             | `process-message`      | (ninguno/normal)   | `inbound`   | Sí         | Sí                 | Sí                 |
| `smb_message_echoes`   | `process-coex-echo`    | `waba_echo`        | `outbound`  | **No**     | **No**             | **No**             |
| `history`              | `process-coex-history` | `historical`       | Ambas       | **No**     | **No**             | **No**             |

---

## Webhook: `history` — Sincronización de historial

### Estructura del payload

```json
{
  "field": "history",
  "value": {
    "messaging_product": "whatsapp",
    "metadata": {
      "display_phone_number": "+5491112345678",
      "phone_number_id": "PHONE_NUMBER_ID"
    },
    "history": [
      {
        "metadata": {
          "phase": "1",
          "chunk_order": "3",
          "progress": "45"
        },
        "threads": [
          {
            "id": "+5491199887766",
            "messages": [
              {
                "from": "+5491100000001",
                "to": "+5491199887766",
                "id": "wamid.xxx",
                "timestamp": "1715000000",
                "type": "text",
                "text": { "body": "Hola" },
                "history_context": { "status": "read" }
              }
            ]
          }
        ]
      }
    ]
  }
}
```

### Fases de sincronización

| Fase | Rango            | Contenido                        |
|------|------------------|----------------------------------|
| 0    | Últimas 24 horas | Texto + media (con media_id)     |
| 1    | Días 1–90        | Texto + media (<14d con media_id)|
| 2    | Días 90–180      | Solo texto (media sin archivo)   |

### Reglas de procesamiento

1. Los chunks pueden llegar **fuera de orden** → usar `chunk_order` para ordenar
2. `progress=100` indica que la sincronización está completa
3. Si no hay datos para una fase, Meta no envía webhook para esa fase
4. **Ventana de 24h**: El negocio tiene 24 horas post-onboarding para autorizar el sync
5. Media con `media_id` (solo <14 días): descargar vía `GET graph.facebook.com/v25.0/{media_id}`
6. Media >14 días: solo metadata (tipo, timestamp), sin archivo disponible

### Deduplicación

- Redis key: `wa:hist:{phoneNumberId}:p{phase}:c{chunkOrder}` (TTL 24h)
- Audit: `whatsapp_webhook_events` con `dedupe_key=hist:{phoneNumberId}:p{phase}:c{chunkOrder}`

### Tracking de progreso

Redis key: `coex:sync:{tenantId}:{phoneNumberId}` (TTL 1h, actualizado por chunk)

```json
{
  "phase": "1",
  "chunkOrder": 5,
  "progress": 67,
  "updatedAt": "2026-05-14T12:00:00Z"
}
```

Cuando `progress=100`:
```json
{
  "phase": "2",
  "chunkOrder": 3,
  "progress": 100,
  "completedAt": "2026-05-14T12:30:00Z"
}
```

---

## Webhook: `smb_message_echoes` — Mensajes desde la app

### Estructura del payload

```json
{
  "field": "smb_message_echoes",
  "value": {
    "messaging_product": "whatsapp",
    "metadata": {
      "display_phone_number": "+5491112345678",
      "phone_number_id": "PHONE_NUMBER_ID"
    },
    "message_echoes": [
      {
        "from": "+5491112345678",
        "to": "+5491199887766",
        "id": "wamid.xxx",
        "timestamp": "1715001234",
        "type": "text",
        "text": { "body": "Te confirmo tu turno" }
      }
    ]
  }
}
```

### Reglas de procesamiento

1. Se almacena como mensaje `outbound` con `metadata.source='waba_echo'`
2. **No** dispara el pipeline de IA
3. **No** dispara reglas de automatización
4. **No** reinicia el timer de sesión de 24h
5. Si el contacto no existe, se crea automáticamente
6. Aparece en el timeline de la conversación en el inbox

### Deduplicación

- Redis key: `wa:echo:{messageId}` (TTL 24h)

---

## Webhook: `smb_app_state_sync` — Contactos

### Estructura del payload

```json
{
  "field": "smb_app_state_sync",
  "value": {
    "messaging_product": "whatsapp",
    "metadata": {
      "display_phone_number": "+5491112345678",
      "phone_number_id": "PHONE_NUMBER_ID"
    },
    "state_sync": [
      {
        "type": "contact",
        "contact": {
          "full_name": "Juan Pérez",
          "first_name": "Juan",
          "phone_number": "+5491155443322"
        },
        "action": "add",
        "metadata": { "timestamp": "1715001234" }
      }
    ]
  }
}
```

### Acciones

| Action   | Comportamiento                                       |
|----------|------------------------------------------------------|
| `add`    | Upsert contacto (INSERT ON CONFLICT UPDATE)          |
| `update` | Upsert contacto (actualiza nombre si cambió)         |
| `remove` | No se elimina (puede tener conversaciones asociadas) |

### Modos de operación

1. **Batch inicial**: Después del onboarding, Meta envía todos los contactos
2. **Incremental**: Cada nuevo contacto agregado/modificado en la app dispara un webhook individual

---

## Configuración requerida en Meta

### Meta App Dashboard → WhatsApp → Configuration

Los siguientes campos de webhook deben estar habilitados:

- [x] `messages` (ya existente)
- [x] `message_template_status_update` (ya existente)
- [x] `account_update` (ya existente)
- [ ] `history` ← **Nuevo para coexistencia**
- [ ] `smb_message_echoes` ← **Nuevo para coexistencia**
- [ ] `smb_app_state_sync` ← **Nuevo para coexistencia**

> **IMPORTANTE**: Estos campos se configuran manualmente en el App Dashboard de Meta.
> La API `subscribed_apps` no permite especificar campos individuales.

---

## Embedded Signup — Modo Coexistencia vs Estándar

### Frontend (`WhatsAppEmbeddedSignup.tsx`)

```typescript
// Estándar (número nuevo o migración)
extras: {
  setup: { solutionID, business_id },
  version: "v4",
}

// Coexistencia (Business App)
extras: {
  setup: { solutionID, business_id },
  featureType: "whatsapp_business_app_onboarding",  // ← Activa coexistencia
  sessionInfoVersion: "3",                          // ← Requerido para coex
  version: "v4",
}
```

### Backend (payload a `/onboarding/start`)

```typescript
{
  mode: "coexistence",            // vs "new" para estándar
  coexistenceAcknowledged: true,  // El usuario confirmó las limitaciones
}
```

### Base de datos (`whatsapp_channels`)

```sql
-- Campo is_coexistence indica si el canal está en modo coexistencia
SELECT is_coexistence FROM whatsapp_channels WHERE phone_number_id = '...';
```

---

## Limitaciones del modo Coexistencia

| Limitación | Detalle |
|---|---|
| Throughput | ~20 mensajes/segundo (vs 80+ en modo estándar) |
| App obligatoria | Debe abrirse cada 14 días o la conexión expira |
| Dispositivos companion | Se desvinculan al activar (reconectables después) |
| WhatsApp Windows/WearOS | Mensajes desde estos clientes NO generan webhooks |
| Listas de difusión | Pasan a read-only en la app |
| Verificación negocio | Standard Business Verification no disponible |
| OBA (badge azul) | No soportado en coexistencia |
| Migración entre WABAs | No permitida mientras coexistencia está activa |

---

## Redis keys

| Key | TTL | Propósito |
|---|---|---|
| `wa:echo:{messageId}` | 24h | Deduplicación de message echoes |
| `wa:hist:{phoneNumberId}:p{phase}:c{chunk}` | 24h | Deduplicación de chunks de historial |
| `coex:sync:{tenantId}:{phoneNumberId}` | 1h | Progreso de sincronización (para dashboard) |

---

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `apps/whatsapp/src/modules/webhooks/webhooks.service.ts` | 3 nuevos handlers: `handleMessageEchoEvent`, `handleHistoryEvent`, `handleContactSyncEvent` |
| `apps/whatsapp/src/modules/jobs/webhook.processor.ts` | 3 nuevos procesadores: `processCoexEcho`, `processCoexHistory`, `processCoexContacts` |
| `apps/whatsapp/src/modules/onboarding/onboarding.service.ts` | Log de campos webhook esperados en modo coexistencia |
| `apps/whatsapp/src/modules/meta-graph/meta-graph.service.ts` | Sin cambios (campos se configuran en Meta Dashboard) |
| `apps/dashboard/src/app/admin/channels/whatsapp/page.tsx` | UI con 3 rutas de conexión |
| `apps/dashboard/src/app/admin/channels/whatsapp/WhatsAppEmbeddedSignup.tsx` | Prop `mode` para toggle standard/coexistence |

---

## Pendiente (futuro)

1. **Dashboard de progreso de sync**: Mostrar barra de progreso en el dashboard usando `coex:sync:*` Redis keys
2. **Descarga de media histórica**: Implementar descarga de archivos vía `GET graph.facebook.com/v25.0/{media_id}` para media <14 días
3. **Indicador visual en inbox**: Badge "Enviado desde app" para mensajes con `source=waba_echo`
4. **Indicador visual en inbox**: Badge "Histórico" para mensajes con `source=historical`
5. **API `/conversations/service`**: Filtrar mensajes `historical` y `waba_echo` del procesamiento de IA (verificar que `metadata.source` se respeta)
6. **Reconexión automática**: Detectar `account_update` con evento `PARTNER_REMOVED` (expiración por 14 días sin abrir app) y notificar al usuario
7. **Webhook field subscription via API**: Meta no expone API para suscribir campos individuales — requiere configuración manual en App Dashboard
