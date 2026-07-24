# WhatsApp Service — Claude Code Context

> Actualizado: 2026-07-23. Microservicio NestJS 10, puerto 3002, contenedor `parallext-whatsapp` (imagen `ghcr.io/nipko/parallext-whatsapp`).

## Qué es (y qué NO es)

Servicio de **ingesta de WhatsApp** y **onboarding vía Meta Embedded Signup v4**. NO es un simple forwarder de webhooks: al recibir un evento de Meta, este servicio

1. **valida** la firma HMAC-SHA256 y responde 200 en <5s (Meta lo exige),
2. **resuelve el tenant** a partir de `phone_number_id` consultando la tabla global `channel_accounts`,
3. **deduplica** el evento en Redis (idempotencia),
4. **encola** el trabajo en BullMQ (`webhooks`) y, en el worker,
5. **persiste** en el schema del tenant (`whatsapp_webhook_events`, upsert de `contacts`, avance de `messages.status`),
6. y **recién entonces** hace `POST /internal/inbound-message` a la API para que `ConversationsService` genere la respuesta de IA.

El procesamiento por IA (persona, RAG, booking, respuesta) vive en la API (puerto 3000). Este servicio se ocupa de la **frontera con Meta**: onboarding, verificación de firma, routing multi-tenant, idempotencia, persistencia de auditoría y coexistencia.

## Módulos (`src/modules/`)

- `onboarding/` — Pipeline completo de Embedded Signup v4.
  - `OnboardingController` — protegido con `JwtAuthGuard` + `RolesGuard` (`@Roles('super_admin','tenant_admin')`; el listado global es solo `super_admin`). Rutas: `POST /start`, `GET /:id`, `GET /:id/status` (polling), `POST /:id/retry`, `POST /:id/resync`, `DELETE /:id` (cancelar), `GET /` (admin).
  - `OnboardingService` — orquesta el flujo (ver sección Onboarding). Super_admin **sin tenant implícito**: `resolveTenantIdForAction` exige `tenantId` explícito para super_admin; un tenant_admin solo opera su propio tenant. Cron `*/10 * * * *` que auto-expira onboardings atascados >30 min.
- `webhooks/` — Receptor de webhooks de Meta.
  - `WebhooksController` — `GET /webhooks/whatsapp` (verificación challenge/response con `WHATSAPP_VERIFY_TOKEN`) y `POST /webhooks/whatsapp` (valida HMAC-SHA256 con `WHATSAPP_APP_SECRET` sobre el raw body; responde 200 y procesa async). En producción, sin `WHATSAPP_APP_SECRET` la firma se rechaza.
  - `WebhooksService` — `processChange()` enruta por `field`: `messages`, `message_template_status_update`, `account_update`, `smb_message_echoes` (coex), `history` (coex), `smb_app_state_sync` (coex). Resuelve tenant, deduplica en Redis y encola en `webhooks`. Cache de tenant en memoria (5 min) + Redis (`wa:tenant:{phoneNumberId}`, 5 min).
- `meta-graph/` — Cliente de Meta Graph API con retry. Métodos: `exchangeOnboardingCode`, `exchangeForLongLivedToken`, `debugToken`, `getBusinessAccountsForToken`, `getWabaDirectly`, `getPhoneNumbersForWaba`, `registerPhoneNumber`, `subscribeAppToWaba`/`unsubscribeAppFromWaba`, `generateSystemUserToken`, `getTemplatesForWaba`, `getBusinessVerificationStatus`, `sendTestMessage`.
- `jobs/` — **Un solo consumer**: `WebhookProcessor` con `@Processor('webhooks')` (extiende `WorkerHost`). Maneja: `process-message`, `process-status`, `template-status-update`, `account-update`, `process-coex-echo`, `process-coex-history`, `process-coex-contacts`. El módulo registra las colas `webhooks`, `sync`, `onboarding`, `ops`, pero solo `webhooks` tiene consumer aquí.
- `assets/` — `AssetsService` **solo encola** a la cola `sync` (`sync-templates`, `sync-phone-numbers`, `full-reconciliation`). El consumo de `sync` ocurre fuera de este servicio; la sincronización de templates/números durante el onboarding se hace **inline** en `OnboardingService` (`syncTemplatesInBackground` / `resyncAssets`), no por esta cola.
- `audit/` — `AuditService.log()` escribe en la tabla global `audit_log` vía Prisma (`resource = entityType:entityId`, `details.source = 'whatsapp-service'`). Nunca rompe el flujo principal.
- `health/` — `GET /health/live` (liveness) y `GET /health/ready` (readiness: chequea PostgreSQL `SELECT 1` + Redis `ping`). El healthcheck de Docker pega a `/api/v1/health/live`.
- `prisma/` — `PrismaService` compartido. `getTenantByPhoneNumberId()` (routing webhook→tenant vía `channel_accounts`) y `executeInTenantSchema()` (usa `$transaction` + `SET LOCAL search_path` para no filtrar el schema entre conexiones del pool; valida el nombre de schema con regex).

## Comunicación con la API (puerto 3000)

- URL base: `API_INTERNAL_URL` (default `http://api:3000/api/v1`).
- Auth service-to-service: header `x-internal-key` con `INTERNAL_API_KEY` (fallback histórico a `INTERNAL_JWT_SECRET`).
- Endpoints consumidos:
  - `POST /internal/inbound-message` — reenvía el `NormalizedMessage` para procesamiento por IA (o para solo-almacenar cuando `metadata.source = 'waba_echo' | 'historical'`). Timeout 5s; si falla se re-lanza para que BullMQ reintente (el mensaje nunca se pierde: los inserts de auditoría/contacto son idempotentes con `ON CONFLICT`).
  - `POST /internal/channel-account-quota-check` — gate del límite `features.maxChannelAccounts` del plan (fuente de verdad en la API, incluye overrides por tenant). Un 403 aborta la conexión de un número adicional; fallos de red se loguean y se dejan pasar para no romper el onboarding.
- Comparte la misma base PostgreSQL y el mismo Prisma schema que la API.

## Flujo de webhook (real)

```
Meta → POST /api/v1/webhooks/whatsapp
  → WebhooksController: valida HMAC-SHA256 (raw body) → responde 200 (<5s)
  → WebhooksService.processChange(wabaId, change)  [async, aislado por change]
      → resolveTenant(phone_number_id)  [cache memoria → Redis wa:tenant → getTenantByPhoneNumberId (channel_accounts)]
      → dedupe Redis (SET NX EX 24h)  → BullMQ 'webhooks'.add(...)
  → WebhookProcessor (@Processor('webhooks'))
      → persiste whatsapp_webhook_events (ON CONFLICT dedupe_key DO NOTHING)
      → upsert contacts / avanza messages.status (monótono: sent<delivered<read<failed)
      → POST /internal/inbound-message → API ConversationsService → IA
```

Nota: cada `change` del payload se procesa aislado en un try/catch — un template update malformado no puede tumbar los mensajes de cliente que vienen en el mismo payload.

## Onboarding (Embedded Signup v4)

`OnboardingService.startOnboarding()` ejecuta un pipeline de ~15 pasos con reintento reanudable (guarda el long-lived token en `exchangePayload` para retomar desde discovery si algo falla después del exchange). Modos: `OnboardingMode.NEW | EXISTING | COEXISTENCE`.

1. Validaciones previas (tenant activo, `configId` válido, sin otro onboarding en progreso; gate de cuota temprano si viene `phoneNumberId`; coexistencia requiere `coexistenceAcknowledged`).
2. Crear registro `whatsapp_onboarding` (`CODE_RECEIVED`).
3. Exchange del `code` OAuth → **short-lived** user token.
4. Convertir a **long-lived** token (~60 días); se persiste en `exchangePayload`.
5. `debugToken` (valida tipo/scopes; no bloqueante; extrae WABA de granular scopes si aplica).
6. Descubrir WABA (usa `wabaId` de session info si viene; si no, scopes o `/me/businesses`).
7. Resolver el número (`phoneNumberId` de session info o el primero del WABA).
8. `registerPhoneNumber` con Meta (no fatal si ya estaba registrado).
9. Persistir el canal en el schema del tenant (`whatsapp_channels`; DELETE+INSERT con verificación de fila).
10. **Registrar `channel_account`** (tabla global) para el routing de webhooks — gate autoritativo de `maxChannelAccounts` aquí.
11. Intentar **System User Token** permanente (flujo Tech Partner; no bloqueante) → guardar el mejor token disponible **cifrado AES-256-GCM** en `whatsapp_credentials` (`credential_type = 'system_user_token'`, con verificación de persistencia).
12. `subscribeAppToWaba` (suscripción de webhooks). En coexistencia se esperan además los fields `history`, `smb_message_echoes`, `smb_app_state_sync`.
13. Chequear estado de verificación del negocio (Meta); si no está verificado → `COMPLETED_WITH_WARNINGS`.
14. Sync de templates en background (inline, no bloqueante).
15. Marcar `COMPLETED` / `COMPLETED_WITH_WARNINGS` + audit log.

Estados: `OnboardingStatus` (CREATED → CODE_RECEIVED → EXCHANGE_COMPLETED → ASSETS_DISCOVERED → WEBHOOK_VALIDATED → COMPLETED/…). Terminales: COMPLETED, COMPLETED_WITH_WARNINGS, FAILED, CANCELLED.

## Coexistencia (WhatsApp Business App ↔ Cloud API)

Cuando el número se onboarda en modo `COEXISTENCE`, Meta envía fields adicionales que el `WebhookProcessor` maneja **sin disparar IA ni automatizaciones**:

- **Echoes** (`smb_message_echoes` → `process-coex-echo`): mensajes salientes enviados desde la app del negocio. Se almacenan como `outbound` con `metadata.source = 'waba_echo'`; aparecen en el inbox pero no gatillan IA ni la ventana de sesión de 24h.
- **History** (`history` → `process-coex-history`): hasta **6 meses** de historial. Llega en fases (0 = 24h, 1 = 1–90d, 2 = 90–180d) y en chunks (posiblemente desordenados, se reensamblan por `chunk_order`). Texto hasta 180 días; media solo últimos 14 días. `metadata.source = 'historical'`. Progreso trackeado en Redis (`coex:sync:{tenantId}:{phoneNumberId}`).
- **Contact sync** (`smb_app_state_sync` → `process-coex-contacts`): agenda de la app. Acciones `add`/`update`/`remove` (los `remove` no borran el contacto).

## Multi-canal por tipo y routing

- El routing webhook→tenant es por **`phone_number_id` → `channel_accounts`** (`channel_type = 'whatsapp'`, `is_active = true`), lo que soporta **N conexiones del mismo tipo** (varios números WhatsApp) sin conflación de conversaciones.
- Límite por plan: `features.maxChannelAccounts` (default 1) + override por tenant, verificado contra la API antes de registrar un `channel_account` adicional.
- Regla de agentes (enforced en la API): **un agente por conexión** vía `agent_personas.channel_bindings` (índice GIN), no un agente por canal.
- Los tokens son **por-cuenta** (`channel_accounts.access_token` / credencial cifrada referenciada), permitiendo disconnect por-cuenta sin afectar otros números.

## Idempotencia e infraestructura

- **Dedupe keys en Redis** (SET NX / SETEX, TTL 24h): `wa:msg:{id}`, `wa:status:{id}:{status}`, `wa:echo:{id}`, `wa:hist:{phoneNumberId}:p{phase}:c{chunkOrder}`. El claim de mensajes es atómico (`SET NX EX`) y se libera si el `enqueue` falla, para que el retry de Meta lo reprocese.
- **Cache de tenant**: memoria (5 min) + `wa:tenant:{phoneNumberId}` en Redis (5 min).
- **BullMQ**: prefijo global `wa` (colas `wa:webhooks`, `wa:sync`, `wa:onboarding`, `wa:ops`). Retries con backoff exponencial; `removeOnComplete`/`removeOnFail` configurados por tipo.
- **`messages.status`** avanza de forma **monótona** (sent<delivered<read<failed) para tolerar webhooks fuera de orden.

## Build & run / verificación

```bash
npm run dev:whatsapp                         # solo este servicio (puerto 3002)
cd apps/whatsapp && npx tsc --noEmit         # type check
cd apps/whatsapp && npm run test:bootstrap   # errores de DI de NestJS (tsc no los detecta)
```

## Env vars relevantes

- `PORT` (3002), `NODE_ENV`, `DASHBOARD_URL` (CORS).
- `API_INTERNAL_URL`, `INTERNAL_API_KEY` (fallback `INTERNAL_JWT_SECRET`).
- `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` (verificación + firma HMAC), `META_CONFIG_ID`.
- `ENCRYPTION_KEY` (hex, AES-256-GCM para credenciales).
- `DATABASE_URL` (Prisma), `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD`.
- Auth JWT: `JWT_SECRET` / `INTERNAL_JWT_SECRET` (el guard prueba ambos; también acepta `x-internal-key`).
