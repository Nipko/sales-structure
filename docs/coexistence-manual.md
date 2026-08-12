# WhatsApp Coexistence Mode — Manual Técnico

> **Actualizado**: 2026-08-09 — Verificado contra el código. Ingesta de coexistencia en `apps/whatsapp` (puerto 3002); el procesamiento de IA vive en la API (`apps/api`, puerto 3000). Incluye multi-canal por tipo (gate de plan) y marca los guards `metadata.source` que **todavía no** están implementados en la API.

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

| Campo webhook          | Job BullMQ             | `metadata.source` | Dirección   | Trigger IA¹ | Trigger automación¹ | Abre ventana 24h¹ |
|------------------------|------------------------|--------------------|-------------|-------------|---------------------|--------------------|
| `messages`             | `process-message`      | (ninguno/normal)   | `inbound`   | Sí          | Sí                  | Sí                 |
| `smb_message_echoes`   | `process-coex-echo`    | `waba_echo`        | `outbound`  | **No** (objetivo) | **No** (objetivo) | **No** (objetivo) |
| `history`              | `process-coex-history` | `historical`       | Ambas       | **No** (objetivo) | **No** (objetivo) | **No** (objetivo) |

> ⚠️ **¹ Estado real (jul-2026): este guard NO está implementado en la API.**
> El microservicio de WhatsApp (`apps/whatsapp/src/modules/jobs/webhook.processor.ts`, `processCoexEcho`/`processCoexHistory`)
> reenvía echoes e historial a `POST /internal/inbound-message` con `metadata.source = 'waba_echo' | 'historical'`
> y `direction: 'outbound'`, **esperando** que la API los guarde sin procesarlos. Pero
> `ConversationsService.processIncomingMessage` (`apps/api/src/modules/conversations/conversations.service.ts`)
> **no ramifica por `metadata.source` ni por `direction`**: hoy todo mensaje reenviado a `/internal/inbound-message`
> corre el pipeline completo (debounce → `resolveConversation` → IA). Las celdas marcadas "No (objetivo)" describen
> el comportamiento **deseado**, no el vigente. Cierre pendiente: agregar el guard en `processIncomingMessage`
> (early-return de solo-almacenar cuando `metadata.source ∈ {waba_echo, historical}`). Ver **Pendiente #5**.

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
5. Media con `media_id` (solo <14 días): descargar vía `GET graph.facebook.com/v21.0/{media_id}` (versión Graph alineada con `apps/api/src/modules/media-processing/media-download.service.ts`). **Nota**: la descarga de media histórica **aún no está implementada** — `processCoexHistory` hoy solo guarda metadata vía `parseContent` (ver Pendiente #2)
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

> ⚠️ Los puntos 2–4 son el **comportamiento objetivo**: la API todavía no respeta `metadata.source`
> (`processIncomingMessage` no lo lee), así que hoy el echo reenviado dispararía el pipeline como
> cualquier inbound. Ver la nota de la tabla arriba y **Pendiente #5**.

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

## Coexistencia y multi-canal por tipo

Un tenant puede conectar **N conexiones del mismo tipo** (varios números de WhatsApp, varias cuentas IG…),
y un número en coexistencia es simplemente **una conexión más**. El routing y el aislamiento son por-cuenta.

### Gate por plan (`features.maxChannelAccounts`)

- El límite es **por tipo de canal** y se representa en
  `features.maxChannelAccounts`; admite override autorizado por tenant en
  `quotaOverrides.maxChannelAccounts`.
- `TenantThrottleService` resuelve en runtime el override, la feature del plan y el
  fallback conservador. La tabla activa `billing_plans` es la fuente de verdad; el
  seed es solo una base de aprovisionamiento.
- Este manual no reproduce precios ni una matriz por plan. Consulta el cupo efectivo
  en **Configuración → Facturación** o en la operación de conexión correspondiente.

### Enforcement en el onboarding de un número adicional

```
OnboardingService.registerChannelAccount(tenantId, phone)
  → assertChannelAccountQuotaViaApi(tenantId, 'whatsapp', phone.id)     [apps/whatsapp]
       → POST /internal/channel-account-quota-check { tenantId, channelType, excludeAccountId }
            → TenantThrottleService.enforceChannelAccountLimit(...)      [apps/api]
                 → 403 { error: 'plan_limit_reached', limitKey: 'maxChannelAccounts', ... }  (sobre cuota)
       → onboarding re-lanza BadRequestException({ code: 'PLAN_LIMIT_REACHED', userMessage })
  → si pasa: upsert en channel_accounts (tabla global)
```

- El gate es **autoritativo en la API** (incluye overrides por tenant). Un **403 aborta** la conexión del número
  adicional; fallos de red/infra se **loguean y se dejan pasar** para no romper el onboarding por un hipo transitorio.
- `excludeAccountId` = `phone_number_id` permite **reconectar/actualizar** un número ya existente sin contarlo
  contra el límite.

### Registro y routing por-cuenta (`channel_accounts`)

- `registerChannelAccount` hace **upsert** en la tabla global `channel_accounts`
  (`channel_type = 'whatsapp'`, `account_id = phone_number_id`, `is_active = true`, `access_token = 'encrypted_ref'`).
- El routing webhook→tenant es por **`phone_number_id` → `channel_accounts`**
  (`PrismaService.getTenantByPhoneNumberId`), lo que soporta varios números del mismo tenant **sin conflación
  de conversaciones**.
- Cada mensaje normalizado que el microservicio reenvía lleva **`channelAccountId: phoneNumberId`**
  (echoes e historial incluidos), para que la API resuelva conversación, token y respuesta con la cuenta correcta.

### Un agente por conexión

- La regla es **un agente por conexión**, no un agente por canal: `agent_personas.channel_bindings` (índice GIN)
  enlaza cada agente a cuentas concretas (`channelType` / `accountId`). El editor de agente del dashboard
  enlaza cuentas (`ChannelAccountLite`), no tipos de canal.

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
  setup: { solutionID },
  version: "v4",
}

// Coexistencia (Business App)
extras: {
  setup: { solutionID },
  featureType: "whatsapp_business_app_onboarding",  // ← Activa coexistencia
  sessionInfoVersion: "3",                          // ← Requerido para coex
  version: "v4",
}
```

`business_id` no se inyecta globalmente en `setup`: Meta puede devolver el Business Portfolio
ID del cliente en el evento de finalización. En coexistencia, el evento puede incluir solo
`waba_id`; en ese caso el backend intenta correlacionar esa WABA mediante `/me/businesses` y
deja el Business Portfolio sin resolver si Meta no lo expone. Si se preselecciona explícitamente
un portfolio del cliente, la forma documentada es `setup.business.id` y el usuario debe tener
acceso a él.

### Backend (payload a `/onboarding/start`)

```typescript
{
  mode: "coexistence",            // vs "new" para estándar
  coexistenceAcknowledged: true,  // El usuario confirmó las limitaciones
  businessId,                     // Opcional: Business Portfolio ID devuelto por Meta
}
```

### Base de datos (`whatsapp_channels`)

```sql
-- Campo is_coexistence indica si el canal está en modo coexistencia
SELECT is_coexistence FROM whatsapp_channels WHERE phone_number_id = '...';
```

### Tokens y credenciales (coexistencia y estándar)

El onboarding (`OnboardingService`, paso ~11) intenta un **System User Token permanente**
(`metaGraph.generateSystemUserToken`, flujo Tech Partner; **no bloqueante**: si falla se conserva el
long-lived ~60 días). El mejor token disponible se guarda **cifrado AES-256-GCM**
(`storeEncryptedCredential` → `encryptToken`) en la tabla `whatsapp_credentials`
(`credential_type = 'system_user_token'`, `rotation_state = 'active'`), con verificación de persistencia.

Los registros de canal **no guardan el token en claro**, solo punteros a la credencial cifrada:

```sql
-- whatsapp_channels: puntero, no el token
SELECT access_token_ref FROM whatsapp_channels WHERE phone_number_id = '...';
-- → 'credential_ref'

-- channel_accounts (tabla global, routing de webhooks): placeholder, NO texto plano
SELECT access_token FROM channel_accounts WHERE account_id = '<phone_number_id>';
-- → 'encrypted_ref'
```

En runtime, `ChannelTokenService.getChannelToken(tenantId, 'whatsapp', accountId?)` resuelve el token
real por-cuenta desde la credencial cifrada (cache 5 min en Redis), sin migración global de esquema.

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
| `coex:sync:{tenantId}:{phoneNumberId}` | 1h por chunk / 24h al completar | Progreso de sincronización. Se escribe por chunk (TTL 1h, `webhooks.service.ts`) y, cuando `progress=100`, se reescribe con `completedAt` y TTL 24h (`webhook.processor.ts`) |

---

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `apps/whatsapp/src/modules/webhooks/webhooks.service.ts` | 3 nuevos handlers: `handleMessageEchoEvent`, `handleHistoryEvent`, `handleContactSyncEvent` |
| `apps/whatsapp/src/modules/jobs/webhook.processor.ts` | 3 nuevos procesadores: `processCoexEcho`, `processCoexHistory`, `processCoexContacts` |
| `apps/whatsapp/src/modules/onboarding/onboarding.service.ts` | Modos `NEW/EXISTING/COEXISTENCE`; System User Token cifrado (`storeEncryptedCredential`); `registerChannelAccount` + gate `assertChannelAccountQuotaViaApi` |
| `apps/whatsapp/src/modules/meta-graph/meta-graph.service.ts` | `generateSystemUserToken` (Tech Partner); los campos de webhook se configuran en Meta Dashboard |
| `apps/api/src/modules/internal/internal.controller.ts` | `POST /internal/channel-account-quota-check` (gate `maxChannelAccounts`, 403 `plan_limit_reached`) |
| `apps/api/src/modules/throttle/tenant-throttle.service.ts` | `enforceChannelAccountLimit` (plan × canal + override por tenant) |
| `apps/dashboard/src/app/admin/channels/whatsapp/page.tsx` | UI con 3 rutas de conexión |
| `apps/dashboard/src/app/admin/channels/whatsapp/WhatsAppEmbeddedSignup.tsx` | Prop `mode` para toggle standard/coexistence |

---

## Pendiente (estado real jul-2026)

Estado verificado contra el código. Los items 1, 3, 4, 5 y 6 siguen **abiertos**.

1. 🔴 **Abierto — Dashboard de progreso de sync**: mostrar barra de progreso en el dashboard usando las keys
   `coex:sync:*`. El backend ya las escribe (por chunk 1h + al completar 24h), pero **no hay UI** que las consuma.
2. 🔴 **Abierto — Descarga de media histórica**: `processCoexHistory` guarda solo metadata; falta descargar los
   archivos vía `GET graph.facebook.com/v21.0/{media_id}` para media <14 días (endpoint alineado con
   `media-download.service.ts`).
3. 🔴 **Abierto — Indicador visual en inbox**: badge "Enviado desde app" para mensajes con `source=waba_echo`.
4. 🔴 **Abierto — Indicador visual en inbox**: badge "Histórico" para mensajes con `source=historical`.
5. 🔴 **Abierto (crítico) — Guard `metadata.source` en la API**: `ConversationsService.processIncomingMessage`
   **no ramifica** por `metadata.source` ni `direction`, así que los echoes/históricos reenviados a
   `/internal/inbound-message` **corren el pipeline de IA completo**. Hay que agregar el early-return de
   solo-almacenar para `waba_echo` / `historical`. (Esto es lo que las tablas de este manual describen como
   "objetivo", no como vigente.)
6. 🔴 **Abierto — Reconexión automática**: `WebhookProcessor.processAccountUpdate` hoy solo mapea
   `FLAGGED → flagged` y `DISABLED → disconnected`; **cualquier otro evento** (incluido `PARTNER_REMOVED` por
   expiración de 14 días sin abrir la app) cae al default `connected`. Falta detectar la expiración y notificar
   al usuario.
7. ⚪ **Limitación permanente de Meta — Webhook field subscription via API**: Meta no expone API para suscribir
   campos individuales; `history`, `smb_message_echoes` y `smb_app_state_sync` se habilitan **manualmente** en el
   App Dashboard. No es deuda propia.
