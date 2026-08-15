# Manual de Offboarding — Parallly

> Actualizado: 2026-07-23 · Código de referencia: `apps/api/src/modules/offboarding/*`, `apps/api/src/modules/billing/*`, `apps/api/src/modules/meta-compliance/*`

## Resumen

Este documento describe cómo cancelar, suspender, reactivar o eliminar (hard-delete) un tenant de Parallly, incluyendo todos sus canales (WhatsApp, Instagram, Messenger, Telegram, Email, Web Chat Widget) y servicios integrados (Google Calendar, Microsoft/Outlook Calendar, Google Business Profile).

Todo el ciclo está codificado en `OffboardingService` (`executeOffboarding`, `purgeTenant`, `reactivate`, `voluntaryCancel`, `extendTrial`) + `OffboardingCronService` (4 crons + 2 listeners de billing). **No hay que tocar la base de datos a mano**: se opera por la API `/api/v1/offboarding/*` y por el panel super_admin.

> **SMS**: el canal SMS conversacional fue descartado. SMS hoy es solo notificación one-way por créditos (modelo reseller, Twilio de plataforma). Ver el gap de `sms_credit_*` en §7.

---

## 1. Modelo de estado del tenant

No existe una máquina de estados tipo Stripe `active→grace→suspended→archived→deleted`. El estado real se compone de **dos campos en la tabla global `tenants`** más temporizadores en Redis.

| Campo (`tenants`) | Tipo | Valores | Uso |
|---|---|---|---|
| `is_active` | boolean | `true` / `false` | Gate de acceso duro. `false` = tenant offboarded (bloqueado, datos intactos) |
| `subscription_status` | string | `pending_auth` \| `trialing` \| `active` \| `past_due` \| `cancelled` \| `expired` | Estado de la suscripción |
| `payment_provider` | string | `mercadopago` \| `stripe` \| `mock` | PSP asignado (MercadoPago primario) |
| `current_period_end` | timestamp | — | Fin del periodo pagado (dispara offboard al cancelar) |
| `trial_ends_at` | timestamp | — | Fin de trial (dispara `past_due`) |

**Fuente:** `apps/api/prisma/schema.prisma` (modelo `Tenant`), `apps/api/src/modules/billing/types/billing-event.enum.ts`.

### Temporizadores y flags en Redis

| Key | TTL | Significado |
|---|---|---|
| `offboard:past_due:{tenantId}` | 30 días | Inicio del periodo de gracia. Se offboardea a los **7 días** |
| `billing:soft_lock_notified:{tenantId}` | 7 días | Dedup del aviso de soft-lock (día 3) |
| `sub_status:{tenantId}` | — | Cache de estado de suscripción (se invalida en cada cambio) |
| `tenant_plan:{tenantId}` | — | Cache de plan (se invalida en cada cambio) |

### Estados en la práctica

| Situación | `is_active` | `subscription_status` | Canales | Login |
|---|---|---|---|---|
| Operación normal | `true` | `active` / `trialing` | Activos | Permitido |
| Pago fallido / trial vencido | `true` | `past_due` | Activos (banner + soft-lock al día 3) | Permitido |
| Cancelación voluntaria (aún en periodo) | `true` | `cancelled` | Activos hasta `current_period_end` | Permitido |
| Gracia agotada (día 7) | `true` | `expired` | Activos hasta el offboard | Permitido |
| Offboarded (suspendido/expirado/cancelado y ejecutado) | `false` | `cancelled` / `expired` | Desconectados, credenciales revocadas | Bloqueado (`SuspendedScreen`) |
| Schema eliminado (archiveCleaner @90d, o purge) | fila borrada en purge | — | N/A | N/A |

---

## 2. Escenarios de offboarding

### 2.1 Cancelación voluntaria

Endpoint: `POST /api/v1/offboarding/:tenantId/cancel` (`tenant_admin`, `super_admin`) → `OffboardingService.voluntaryCancel`.

1. Marca `subscription_status = 'cancelled'` en `tenants`.
2. Si hay `billing_subscriptions`, setea `status='cancelled'`, `cancelAtPeriodEnd=true`, `cancelledAt`, `cancellationReason`.
3. El tenant **sigue activo** hasta `current_period_end`.
4. Audit log `voluntary_cancel` + invalida `tenant_plan:{tenantId}`.
5. El cron `graceEnforcer` (@3AM) offboardea cuando `current_period_end < now`.

En el dashboard el tenant lo dispara desde `settings/billing` (`api.cancelAccount`).

### 2.2 Fallo de pago / trial vencido → gracia

- **Webhook MercadoPago** `POST /api/v1/billing/webhook/mercadopago` → adaptador verifica firma (HMAC-SHA256) + idempotencia Redis → `BillingService` emite `billing.payment.failed`.
- `OffboardingCronService.onPaymentFailed` arranca el timer `offboard:past_due:{tenantId}` (30d TTL) si no existía.
- En paralelo, `trialExpiryDetector` (cada 30 min) transiciona `trialing` con `trial_ends_at < now` → `past_due` y arranca el mismo timer.
- `graceEnforcer` (@3AM): al **día 3** emite `billing.subscription.soft_locked` (una sola vez, dedup con `billing:soft_lock_notified`); al **día 7** pasa a `expired` y emite `SUBSCRIPTION_EXPIRED`.
- Si el pago entra (`billing.payment.succeeded`), `onPaymentSucceeded` limpia `offboard:past_due`, `soft_lock_notified`, `sub_status` y `tenant_plan` → acceso restaurado.

### 2.3 Suspensión por admin (violación de políticas)

Endpoint: `POST /api/v1/offboarding/:tenantId/suspend` (`super_admin`) → `adminSuspend` → **ejecuta `executeOffboarding` de inmediato** (ver §4). Desconexión inmediata de canales, sesiones revocadas, tenant y usuarios `is_active=false`, razón en audit log.

### 2.4 Downgrade de plan

- Los canales **no** se desconectan.
- Los agentes/calendarios/números que excedan el nuevo límite quedan gateados por las features del plan (`maxChannelAccounts`, `maxCalendars`, etc.).
- El downgrade se sincroniza con MercadoPago desde el panel de billing.

---

## 3. Desconexión canal por canal (modelo por-cuenta)

Desde la implementación **multi-canal por tipo** (jul 2026), la unidad de conexión es la **cuenta de canal** (`channel_accounts`), no el canal. Un tenant puede tener N conexiones del mismo tipo (2 números WhatsApp, 2 IG…), cada una con su token y su agente (`agent_personas.channel_bindings`). El offboarding las trata **una por una**.

Todo esto lo hace `OffboardingService.disconnectAllChannels(tenantId)` de forma best-effort (un fallo de proveedor no bloquea el resto). Lee `channel_accounts WHERE is_active = true` y, por cada cuenta:

### 3.1 WhatsApp (Embedded Signup / Cloud API)

- El `waba_id` **no** vive en `channel_accounts.metadata`, sino en el **schema del tenant**: `SELECT meta_waba_id FROM whatsapp_channels WHERE phone_number_id = $1` (donde `$1` es `channel_accounts.account_id`).
- El token es la credencial `whatsapp_credentials` con `credential_type = 'system_user_token'` (desencriptada AES-256-GCM).
- Desuscribe la app del WABA: `DELETE https://graph.facebook.com/v21.0/{waba_id}/subscribed_apps?access_token={token}`.
- El número **permanece** en el WABA del cliente; puede reconectarlo con cualquier BSP. Los templates se quedan en su WABA.

### 3.2 Telegram

- Credencial `credential_type = 'telegram_token'`.
- `POST https://api.telegram.org/bot{token}/deleteWebhook?drop_pending_updates=true`.
- El bot sigue existiendo (lo creó BotFather); deja de responder al removerse el webhook. El cliente conserva el token.

### 3.3 Messenger

- Credencial `credential_type = 'messenger_page_token'` (no `messenger_token`).
- `DELETE https://graph.facebook.com/v21.0/{pageId}/subscribed_apps?access_token={page_token}` (`pageId` = `account.account_id`).
- La página de Facebook del cliente no se ve afectada.

### 3.4 Instagram

- Credencial `credential_type = 'instagram_token'`.
- Revocación en el host de Instagram (no en `graph.facebook.com`): `DELETE https://graph.instagram.com/me/permissions?access_token={ig_token}`.
- La cuenta de IG del cliente no se ve afectada.

### 3.5 Marcado por-cuenta + revocación de credenciales

Después del intento de detach en el proveedor, cada cuenta se actualiza individualmente:

```sql
UPDATE channel_accounts
   SET is_active = false,
       metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
           'disconnected_at', NOW()::text,
           'disconnected_by', 'offboarding',
           'disconnected_at_provider', <bool>   -- true si Meta/Telegram confirmó el detach
       ),
       updated_at = NOW()
 WHERE id = $1::uuid;
```

El flag `disconnected_at_provider` es clave para la reactivación: si es `true`, flipear `is_active` no basta — hace falta **reconectar por OAuth** (Meta ya soltó el webhook).

Luego revoca todas las credenciales del tenant vía cliente tipado (no raw, porque `whatsapp_credentials.tenant_id` puede ser `text` en algunos despliegues):

```
whatsapp_credentials.rotation_state = 'revoked'   (updateMany where tenantId)
```

### 3.6 Calendarios (Google / Microsoft-Outlook)

En `disconnectAllChannels` se desactivan en el schema del tenant:

```sql
UPDATE calendar_integrations SET is_active = false WHERE is_active = true;
```

La **revocación real de OAuth** de calendarios solo ocurre en el hard-delete (`purgeTenant` → `revokeExternalOAuth`, ver §5), porque los tokens viven dentro del schema y hay que leerlos antes del `DROP SCHEMA`:

- **Google Calendar** (`provider='google'`): `POST https://oauth2.googleapis.com/revoke` con el `refresh_token` desencriptado.
- **Microsoft/Outlook** (`provider='microsoft'`): guarda un blob de cache MSAL, **no** un refresh token limpio → no hay revoke; el acceso simplemente expira.
- **Google Business Profile** (reviews): token en `tenant.settings.googleBusiness.encryptedRefreshToken` → mismo revoke de Google.

Los eventos ya creados en el calendario del cliente permanecen (son datos suyos).

---

## 4. `executeOffboarding` — pipeline de 7 pasos

`OffboardingService.executeOffboarding(tenantId, trigger, reason?)`. Es lo que corre en la suspensión por admin y en el offboard automático de tenants cancelados cuyo periodo terminó. **Cada paso va en su propio try/catch**: un fallo se loguea pero no impide los siguientes.

| Paso | Acción | Detalle |
|---|---|---|
| 1 | `disconnectAllChannels` | Detach en proveedores + `is_active=false` por cuenta + revoca `whatsapp_credentials` + desactiva `calendar_integrations` |
| 2 | `revokeAllSessions` | Escanea Redis `refresh:{userId}:*` de cada usuario del tenant y los borra |
| 3 | `drainTenantQueues` | Quita jobs `waiting`+`delayed` del tenant en 5 colas BullMQ: `outbound-messages`, `broadcast-messages`, `automation-jobs`, `nurturing`, `conversation-snooze` |
| 4 | Desactivar | `tenants.is_active=false`, `subscription_status='cancelled'`; `users.is_active=false` (todos) |
| 5 | Invalidar caches Redis | `tenant:{id}:config`, `tenant:{id}:schema`, `tenant_plan:{id}`, `analytics:{id}:*`, y los token-cache `wa_token` / `instagram_token` / `messenger_token` / `telegram_token` / `sms_token` `:{id}` |
| 6 | Audit log | `action='tenant_offboarded'`, `resource='offboarding'`, `details={trigger,reason}` |
| 7 | Emitir evento | `tenant.offboarded` (`{tenantId, trigger, reason}`) para listeners downstream |

---

## 5. `purgeTenant` — hard-delete (irreversible)

Endpoint: `DELETE /api/v1/offboarding/:tenantId/purge` (`super_admin`). Botón "Purge" del panel de tenant, con confirmación por tipeo del slug. Orquesta el borrado completo en orden FK-safe:

1. **Detach de proveedores** + flag de `channel_accounts` (reusa `disconnectAllChannels`).
2. Captura los `userIds` antes de borrarlos (para limpiar sus refresh tokens luego).
3. `drainTenantQueues` (nada in-flight debe tocar el schema durante el drop).
4. **`billing.cancelSubscription(tenantId, {immediate:true, reason:'tenant_purge'})`** — para no dejar un cobro vivo huérfano. Con Wompi no hay mandato remoto que cancelar. Lo que frena al motor propio es el estado: el barrido de `renewal-scheduler` solo toma `ACTIVE|TRIALING|PAST_DUE` con `cancelAtPeriodEnd=false`, así que tanto la baja inmediata (`CANCELLED`) como la diferida quedan fuera. `nextChargeAt` se deja como estaba —es historia, no una orden de cobro—.<br>Una fila legada **con mandato de un proveedor retirado** (MercadoPago) es el único caso donde el purge pasa `allowStrandedMandate: true`: no podemos cancelar allá sin credenciales, y negarnos a borrar no frena ese cobro — sólo dejaría al tenant imposible de eliminar. Se acepta, se devuelve en `strandedMandate` y queda un `audit_logs` sin `tenant_id` que sobrevive al borrado. La baja normal lo sigue rechazando con `provider_retired`. Best-effort (trials y ya-canceladas lanzan y se ignoran). MercadoPago fue retirado en ago 2026, ver `docs/mercadopago-retirement-2026-08.md`.
5. **`revokeExternalOAuth`** — revoca Google Calendar (por-tenant schema) + Google Business Profile (`tenant.settings`). Microsoft solo expira. **Debe correr antes del DROP SCHEMA.**
6. **Borrado de filas del schema public** en orden FK-safe. La lista autoritativa es `TENANT_PUBLIC_PURGE_ORDER` en `prisma.service.ts` (hijos primero); no se repite acá porque se desactualiza sola. Antes de tocar nada, `preflightTenantPublicPurge()` cruza las tablas públicas que tienen `tenant_id` contra esa clasificación y **rechaza con 409 `tenant_purge_unclassified_public_data`** si aparece una sin política de purga.<br>⚠ Ese gate corre **antes de todo lo destructivo**, así que una tabla global nueva sin registrar no degrada el borrado: **lo bloquea para todos los tenants**, no solo para el que usa la tabla. Pasó en ago 2026 con las tres del motor de recurrencia. Lo previene la prueba de deriva de `prisma.service.spec.ts`, que escanea las tres vías por las que nace una tabla global (modelo Prisma, migración SQL, `CREATE TABLE ... public.x` en runtime).
7. **`DROP SCHEMA "tenant_x" CASCADE`** (nombre sanitizado con `[^a-zA-Z0-9_]`). Borra contactos, conversaciones, mensajes, propiedades, listings, media_files del schema, etc.
8. **Wipe de disco**: `mediaService.deleteAllTenantFiles(tenantId)` → `/data/media/{tenantId}/`.
9. **RETENIDO a propósito**: `fiscal_invoices` (+ artefactos XML/PDF en el volumen `parallext-fiscal-data`, `/data/invoices/{tenantId}/`). Retención legal DIAN (~5 años). Antes de borrar la fila del tenant, se estampa en `fiscal_invoices.metadata`: `tenantPurgedAt`, `tenantNameSnapshot`, `tenantSchemaSnapshot` (porque `tenant_id` queda como referencia colgante).
10. Borra la fila de `tenants`.
11. **Redis**: `tenant:{id}:config/schema`, `tenant_plan:{id}`, `vertical:{id}`, `offboard:past_due:{id}`, wildcard `tenant:{id}:*`, y `refresh:{uid}:*` por cada usuario.
12. Emite `tenant.purged` (`{tenantId, tenantName, schemaName, purgedAt}`).

Devuelve un resumen (`channelsDisconnected`, `publicRowsDeleted`, `schemaDropped`, `mediaFilesRemoved`, `usersRevoked`) que el panel muestra.

El resumen que devuelve incluye una entrada por tabla, así que `publicRowsDeleted` es la evidencia de qué se borró realmente.

---

## 6. Crons de offboarding (`OffboardingCronService`)

Todos los emisores de eventos deduplican vía `billing_events UNIQUE(provider, providerEventId)` (evita emails duplicados si corren varias instancias de API).

| Cron | Schedule | Qué hace |
|---|---|---|
| `trialExpiryDetector` | `*/30 * * * *` | `trialing` con `trial_ends_at < now` → `past_due`; arranca `offboard:past_due`; emite `TRIAL_ENDED` |
| `graceEnforcer` | `0 3 * * *` | (1) `past_due` **≥7d** → `expired` + `SUBSCRIPTION_EXPIRED`; **≥3d** → `soft_locked`. (2) `cancelled` con `current_period_end < now` → `executeOffboarding` |
| `archiveCleaner` | `0 4 * * *` | `is_active=false` **y** `updated_at < now-90d` → `DROP SCHEMA "tenant_x" CASCADE` + audit `schema_dropped`. (No borra la fila de `tenants` ni el media; es distinto de `purgeTenant`.) |
| `purgeStaleInactiveChannels` | `0 5 * * *` | `DELETE FROM channel_accounts WHERE is_active=false AND COALESCE(metadata->>'disconnected_at')::timestamp, updated_at) < now-90d` + 1 audit por lote |

**Listeners de billing:**
- `@OnEvent('billing.payment.failed')` → arranca `offboard:past_due`.
- `@OnEvent('billing.payment.succeeded')` → limpia timers + caches → acceso restaurado.

---

## 7. Retención de datos (real)

No hay export a ZIP ni cold storage por fases (día 37/97): eso no existe en el código. El flujo real:

| Momento | Qué pasa |
|---|---|
| Offboard (día 0) | Canales desconectados, credenciales revocadas, tenant + usuarios `is_active=false`. **Datos intactos** en el schema. |
| Reactivable | Mientras `is_active=false` y el schema **no** haya sido dropeado (dentro de 90d y sin purge). Ver §8. |
| `archiveCleaner` (día ~90) | `updated_at < now-90d` → `DROP SCHEMA CASCADE`. La fila de `tenants` permanece; el schema desaparece. |
| `purgeTenant` (inmediato) | Hard-delete total por acción de super_admin. Irreversible. |

### Se conserva permanentemente
- **`fiscal_invoices` + XML/PDF DIAN** (`/data/invoices/{tenantId}/`, volumen `parallext-fiscal-data`) — retención legal ~5 años. Incluso en purge.
- **`audit_logs`** — solo `purgeTenant` los borra; `archiveCleaner` no los toca.
- **Backups** (`infra/backup/backup.sh`): dumps `pg_dump --format=custom` corridos **dentro del contenedor `parallext-postgres`** (public + cada schema de tenant activo + full), Redis RDB, media y fiscal-invoices. Retención 7 diarios / 4 semanales / 2 mensuales. Offsite opcional vía **rclone** a bucket S3-compatible (Cloudflare R2). Heartbeat `backup:last_success` en Redis (epoch ms) que el Ops Center (`PlatformMonitorService`) vigila y alerta si supera **26h**.

### Se elimina (en purge / drop schema)
- Conversaciones, mensajes, contactos, leads/oportunidades, media (`/data/media/{tenantId}/`), credenciales encriptadas, configuración de agentes, y todo el schema del tenant.

### Créditos SMS — gap cerrado
`sms_credit_balances`, `sms_credit_ledger` y `sms_package_orders` **sí** los borra `purgeTenant`: están en `TENANT_PUBLIC_PURGE_ORDER` y el gate de clasificación no dejaría purgar si no lo estuvieran. El saldo pendiente se resuelve antes de eliminar por criterio comercial, no por una limitación técnica.

### Rescate manual
`infra/scripts/delete-tenant.sql` es el fallback si el endpoint no está disponible. Cubre menos tablas que el purge del servicio y se apoya en los `ON DELETE CASCADE` hacia `tenants` para el resto; las que no tienen esa FK necesitan su `DELETE` explícito o quedan huérfanas (es lo que pasaba con `billing_credit_ledger`, cuya única FK es a la suscripción y es `SET NULL`). Preferir siempre el endpoint.

> **Nota de scripts de infra**: `backup.sh` y demás scripts deben quedar `100755` en git — el `git reset --hard` del deploy borra el bit +x si no está commiteado como ejecutable.

---

## 8. Reactivación

### Reactivar el tenant
Endpoint: `POST /api/v1/offboarding/:tenantId/reactivate` (`super_admin`) → `OffboardingService.reactivate`:

1. `tenants.is_active=true`, `subscription_status='active'`; usuarios `is_active=true`.
2. Restaura `channel_accounts` a `is_active=true` **salvo** las que tienen `metadata.disconnected_at_provider=true` — esas necesitan **reconexión OAuth** (Meta/Telegram ya soltaron el webhook) y se dejan inactivas con warning.
3. Restaura `billing_subscriptions` (`status='active'`, limpia flags de cancelación).
4. Limpia `offboard:past_due` + caches.
5. Audit log `tenant_reactivated`.

**Condición**: solo funciona mientras el schema exista. Si `archiveCleaner` o `purgeTenant` ya lo dropearon, no hay reactivación — habría que crear un tenant nuevo (schema nuevo, datos limpios).

### Reactivar solo canales (reparación)
Endpoint: `POST /api/v1/offboarding/:tenantId/reactivate-channels` (`super_admin`) → `reactivateChannels`. Para tenants que perdieron sus canales en un cron pero fueron rescatados a mano sin flipear `channel_accounts`. Misma lógica de skip por `disconnected_at_provider`. Devuelve `{restored, needsReconnect}`.

---

## 9. API y panel (fuente única de operación)

### Endpoints (`OffboardingController`, prefijo `/api/v1`, guards `AuthGuard('jwt') + RolesGuard + TenantGuard`)

| Método | Ruta | Rol | Acción |
|---|---|---|---|
| `POST` | `/offboarding/:tenantId/cancel` | `tenant_admin`, `super_admin` | Cancelación voluntaria |
| `POST` | `/offboarding/:tenantId/suspend` | `super_admin` | Suspensión inmediata (`executeOffboarding`) |
| `GET` | `/offboarding/:tenantId/status` | `super_admin`, `tenant_admin` | Estado (isActive, subscriptionStatus, canales/usuarios activos, `pastDueSince`) |
| `POST` | `/offboarding/:tenantId/reactivate` | `super_admin` | Reactivar tenant |
| `POST` | `/offboarding/:tenantId/reactivate-channels` | `super_admin` | Reactivar solo canales |
| `DELETE` | `/offboarding/:tenantId/purge` | `super_admin` | Hard-delete (irreversible) |
| `POST` | `/offboarding/:tenantId/extend-trial` | `super_admin` | Extender trial N días |

### Panel super_admin
`/admin/tenants/[id]` → componente `TenantAdminActions`: Extender trial (solo si `trialing`), Suspender/Reactivar (botón status-aware), Reactivar canales, Comp plan, Cambiar plan, **Impersonar**, y **Purge** (con confirmación tipeando el slug, patrón Stripe/Vercel). El tenant se autocancela desde `settings/billing`.

### Acceso al workspace del tenant (gobernanza)
El super_admin **no tiene tenant implícito** (modo plataforma; `roles.ts` deny-by-default). Para entrar al workspace de un tenant durante una revisión de offboarding hay que **impersonar**: `impersonate(superAdminId, tenantId, { reason, ticketId })` — **motivo obligatorio**, sesión emparejada (`impersonationSid`) y el **actor real** queda en la auditoría (`audit-actor.util.ts`). No hay atajo por DB.

> **Emergencias**: preferir siempre la API. Si por un incidente hay que forzar por DB, el mínimo correcto es
> `UPDATE tenants SET is_active=false, subscription_status='cancelled' WHERE id='<tenant-id>';`
> pero eso **no** revoca sesiones, credenciales ni canales — usar `/offboarding/:id/suspend` en cuanto se pueda.

---

## 10. Callbacks de Meta (ya implementados)

Módulo `meta-compliance` (`MetaComplianceController`, prefijo `/api/v1`). Los callbacks
públicos de Meta verifican `signed_request` (HMAC-SHA256 contra `META_APP_SECRET`); la
actualización del estado es exclusiva de `super_admin` autenticado.

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/meta/data-deletion-callback` | Meta lo llama cuando un usuario de Facebook revoca la app. Persiste `meta:deletion:{code}` (Redis 90d), notifica al buzón de compliance, devuelve `{ url, confirmation_code }` |
| `POST` | `/meta/data-deletion-request` | Formulario público: solicita eliminar una cuenta Parallly y sus datos (email + descripción). Límite: 5/h por IP y 2/día por email hasheado; solo notifica al buzón fijo de compliance |
| `GET` | `/meta/data-deletion/status?code=` | Consulta de estado por código (solo campos seguros) |
| `PATCH` | `/meta/data-deletion/status/:code` | `super_admin`: avanza `received → processing → completed/rejected`; nunca devuelve email, `fb_user_id` ni notas |

Configuración en **Facebook App Dashboard → Settings → Advanced → Data Deletion Callback URL**.

Flujo operativo obligatorio para una solicitud de usuario:

1. Verificar por el correo registrado la identidad y autoridad del solicitante.
2. Marcar `processing` con el endpoint protegido y documentar internamente el alcance.
3. Ejecutar el borrado aprobado de la cuenta y datos asociados; conservar únicamente lo
   exigido por ley, seguridad o prevención de fraude y registrar esa retención.
4. Marcar `completed` al terminar, o `rejected` con justificación si no se verifica la identidad.

> El callback de Meta **acusa y encola** el borrado (email a `COMPLIANCE_NOTIFY_EMAIL`
> para completar el cascade a mano): aún no se linkean `fb_user_id` ↔ cuentas de tenant.
> No hay endpoint separado de "Deauthorize Callback"; el mecanismo es el
> `data-deletion-callback`.

---

## 11. Gestión desde Meta Business Suite

### Ver clientes conectados
1. [business.facebook.com](https://business.facebook.com) → Settings (⚙️) → Business Settings.
2. **Users → Partners**: negocios que compartieron su WABA con la app.
3. **Accounts → WhatsApp Accounts**: todos los WABAs vinculados.

### Desconectar un cliente desde Meta
Business Settings → WhatsApp Accounts → seleccionar el WABA → "Remove". Revoca el acceso de la app; el cliente conserva su número. Esto lo detecta el data-deletion-callback (§10) cuando aplica.

---

## 12. Checklist de offboarding

Con la API todo esto es automático; el checklist sirve para verificación manual.

- [ ] Notificar al cliente por email (fecha, qué pasa con sus datos).
- [ ] Ejecutar `/offboarding/:id/suspend` (o esperar el offboard automático del `graceEnforcer`).
- [ ] Verificar Paso 1: canales `is_active=false` y credenciales `rotation_state='revoked'`.
- [ ] Verificar Paso 2: sin `refresh:{userId}:*` en Redis para los usuarios del tenant.
- [ ] Verificar Paso 3: sin jobs del tenant en las 5 colas BullMQ.
- [ ] Verificar Paso 4: `tenants.is_active=false`, usuarios `is_active=false`.
- [ ] Confirmar audit log `tenant_offboarded`.
- [ ] Confirmar que los webhooks ya no llegan (revisar logs 24h).
- [ ] (Si aplica) resolver saldo `sms_credit_*` antes de un eventual purge.

---

## 13. FAQ

**¿Qué pasa con el número de WhatsApp?**
Permanece en el WABA del cliente. Puede conectarlo a cualquier BSP. Los templates siguen en su WABA. Parallly solo pierde el acceso.

**¿Los message templates se pierden?**
No, pertenecen al WABA del cliente.

**¿Puedo ver los mensajes después del offboard?**
Sí, mientras el schema exista (hasta `archiveCleaner` @90d o un `purgeTenant`). Después, no.

**¿Qué pasa con las citas y los calendarios?**
Las citas quedan en el schema hasta que se dropea. Los eventos en Google/Microsoft del cliente permanecen. En offboard se desactiva la integración; en purge se revoca el OAuth de Google (Microsoft solo expira).

**¿El offboarding es reversible?**
Sí, mientras `is_active=false` y el schema no haya sido dropeado (`/offboarding/:id/reactivate`). Los canales marcados `disconnected_at_provider=true` requieren reconexión OAuth. Tras el drop/purge, no.

**¿Se conserva algo tras un purge?**
Sí: `fiscal_invoices` + sus XML/PDF DIAN (retención ~5 años), estampados con la identidad del tenant. También los backups hasta su rotación. (Y, por el gap conocido, los `sms_credit_*`.)
