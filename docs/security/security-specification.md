# Parallext Engine — Especificacion de Seguridad

**Version:** 1.2
**Fecha:** 2026-10-30 (K3: fusiona `docs/SECURITY.md`; corrige nginx, Mercado Pago y SMS)
**Alcance:** Plataforma completa (API :3000, Dashboard :3001, WhatsApp Service :3002, Landing :80, app Mobile React Native/Expo `@parallext/mobile`, Infraestructura ~15 contenedores)
**Base:** Postura endurecida de forma iterativa; controles verificados contra el codigo a 2026-07-23. Referencias operativas: Anexo A de este documento, `docs/security/superadmin-governance.md`, `docs/operations/backup-restore-runbook.md`.

> **v1.1 (jul 2026)** — Actualiza: extraccion de IP anti-spoof tras Cloudflare (§3.1), gobernanza de impersonacion con motivo obligatorio + actor real en auditoria (§1.7), modelo de acceso super_admin sin tenant implicito (§9.2), Twilio per-account + validacion de firma del webhook SMS (§5.3, §16), bloqueo del provider `mock` en produccion (§5.4). Agrega: Multi-canal por tipo (§17), SMS reseller monetizado (§18), Fiscal DIAN (§19), Backup / DR (§20), Ops Center + hardening de deploy (§21).

---

## 1. Autenticacion y Gestion de Sesiones

### 1.1 JWT (JSON Web Tokens)

| Parametro | Valor | Ubicacion |
|-----------|-------|-----------|
| Algoritmo | HS256 | `auth.config.ts` |
| Secret access token | `JWT_SECRET` (env) | `auth.config.ts` |
| Secret refresh token | `JWT_REFRESH_SECRET` (separado) | `auth.config.ts` |
| TTL access token | 15 minutos | `AuthService` (login/refresh) |
| TTL refresh token | 8 horas (default) / 14 dias (remember me) | `AuthService` |
| TTL token 2FA | 5 minutos | `AuthService` |
| Validacion en produccion | Falla si `JWT_SECRET` no esta definido | `auth.config.ts` |

**Rotacion de refresh tokens:** Cada refresh genera un nuevo par (access + refresh). El token anterior se revoca inmediatamente en Redis. Si se detecta reutilizacion de un token ya revocado (ataque de replay), se revocan TODAS las sesiones del usuario (`AuthService.refreshToken()`).

```
Redis key: refresh:{userId}:{tokenId}
```

### 1.2 Hashing de Contrasenas

| Parametro | Valor |
|-----------|-------|
| Algoritmo | bcrypt |
| Rondas | 12 |
| Validacion de fuerza | Min 8 chars, 1 mayuscula, 1 minuscula, 1 numero, 1 especial |

**Archivo:** `auth.service.ts` — validacion de fuerza en `validatePasswordStrength()`; hashing con `bcrypt.hash(..., 12)` en los flujos de signup / reset / cambio de contrasena

### 1.3 Sesiones

| Parametro | Valor |
|-----------|-------|
| Almacenamiento | Redis (`session:{userId}`) |
| TTL | 360 segundos (extendido por ping de actividad cada 5 min) |
| Conflictos | Un usuario no-super_admin puede tener solo 1 sesion activa |
| Limites por tenant | Controlados por plan de suscripcion via `TenantThrottleService` |
| Sesiones tenant | Redis Set `tenant_sessions:{tenantId}` |

**Invalidacion de sesiones** (`auth.service.ts`, `revokeAllUserSessions()`):
- Cambio de contrasena (usuario): revoca todas las sesiones
- Reset de contrasena (admin): revoca todas las sesiones del usuario
- Reset de contrasena (publico): revoca sesiones post-cambio

### 1.4 Autenticacion de Dos Factores (2FA)

#### TOTP (Authenticator App)
- Libreria: `otpauth`
- Ventana de validacion: ±1 periodo (30 segundos)
- Secreto almacenado **cifrado** con AES-256-GCM (ver seccion 2)
- QR code generado para setup inicial

#### Email
- Codigo de 6 digitos generado con `crypto.randomInt(100000, 1000000)` (CSPRNG)
- Almacenado en Redis con TTL de 300 segundos
- Key: `2fa:email:{userId}`

#### Codigos de Respaldo
- 10 codigos de 8 caracteres hexadecimales
- Hasheados con bcrypt (10 rondas) antes de almacenar
- Uso unico: el codigo se elimina de la lista tras verificacion exitosa

#### Proteccion contra fuerza bruta
- Maximo 5 intentos fallidos de 2FA
- Bloqueo de 15 minutos (Redis key: `2fa:attempts:{userId}`, TTL 900s)

### 1.5 OAuth (Google)

- Libreria: `google-auth-library`
- Verificacion: `verifyIdToken()` valida firma del ID token contra Google
- Client ID: variable de entorno `GOOGLE_OAUTH_CLIENT_ID` (sin fallback hardcodeado)
- Vinculacion: busca por email o googleId, vincula cuentas existentes

### 1.6 SAML SSO

| Parametro | Valor |
|-----------|-------|
| Libreria | `@node-saml/passport-saml` (MultiSamlStrategy) |
| Config por tenant | `tenant.settings.saml` (JSONB) |
| Lookup por dominio | Redis cache (TTL 300s), key `saml_domain:{domain}` |
| Plan requerido | Enterprise o Custom |

**JIT (Just-In-Time) Provisioning:**
- Valida que el dominio del email esta en `emailDomains` de la config SAML
- Rechaza con `ForbiddenException` si el dominio no esta permitido
- Rol por defecto: `tenant_agent` (configurable)
- Email marcado como verificado automaticamente

### 1.7 Impersonacion (Super Admin) — gobernada

Un super_admin no tiene tenant implicito: para operar dentro del workspace de un tenant emite una sesion de impersonacion acotada. La gobernanza vive en `AuthService.impersonate()` / `AuthService.endImpersonation()` (`auth.service.ts`) y el endpoint `POST /auth/impersonate/:tenantId` (`auth.controller.ts`).

| Parametro | Valor |
|-----------|-------|
| Quien puede | Solo `super_admin` (revalidado contra la DB dentro de `impersonate()`, no solo por el rol del JWT) |
| **Motivo obligatorio** | `impersonate()` recibe `{ reason, ticketId? }`. El controlador rechaza con `400` si falta `reason` — una sesion act-as que nadie puede justificar despues es indistinguible de una intrusion |
| Usuario objetivo | Primer `tenant_admin` activo del tenant (orden `createdAt` asc) |
| TTL tokens | 1 hora (access y refresh) |
| Sesion emparejada | `impersonationSid` (= `tokenId`) viaja en ambos tokens; el refresh se guarda en Redis `refresh:{targetUserId}:{sid}` con TTL 1h |
| Cierre | `endImpersonation()` mata el refresh en Redis (`del refresh:{impersonatedUserId}:{sid}`) para que una copia del token no pueda reanudar la sesion tras "salir" |
| Metadata JWT | `isImpersonation: true`, `impersonatedBy: superAdminId`, `impersonationSid` |
| **Auditoria persistida** | Filas en `AuditLog` (tabla global): `super_admin.impersonation_started` al abrir y `super_admin.impersonation_ended` al cerrar (con `durationSeconds`). **`userId` = el super_admin real, nunca el usuario impersonado**; `details` guarda `reason`, `ticketId`, `impersonatedUserId`, `sessionId` |
| Actor real en escrituras | `common/utils/audit-actor.util.ts` resuelve el actor real para las escrituras hechas *durante* una impersonacion, de modo que la accion no se atribuye al tenant_admin suplantado |
| Fallo de auditoria | La escritura de auditoria nunca bloquea la sesion (`.catch` con `logger.error`), pero el fallo se registra de forma ruidosa |

---

## 2. Cifrado de Datos en Reposo

### 2.1 AES-256-GCM

**Algoritmo:** AES-256 en modo GCM (Galois/Counter Mode)
- Proporciona: confidencialidad + integridad + autenticacion
- IV: 16 bytes aleatorios por operacion (nunca reutilizado)
- Authentication Tag: incluido en el formato almacenado
- Formato almacenado: `{iv_hex}:{tag_hex}:{ciphertext_hex}`

**Clave:** Variable de entorno `ENCRYPTION_KEY` (64 caracteres hexadecimales = 256 bits)
- Produccion: falla si no esta configurada
- Desarrollo: warning en logs, almacena en texto plano

#### Datos cifrados

| Dato | Servicio / simbolo | Archivo |
|------|--------------------|---------|
| Tokens de acceso WhatsApp | `WhatsappCryptoService.encryptToken/decryptToken` | `whatsapp/services/whatsapp-crypto.service.ts` |
| **Tokens de canal por-cuenta** (multi-canal por tipo) | `channel_accounts.access_token` cifrado; resuelto por `ChannelTokenService.getChannelToken(tenantId, channelType, accountId?)` (descifra con `WhatsappCryptoService`) | `channels/channel-token.service.ts` |
| **Credenciales Twilio por-cuenta** (`accountSid:authToken`) | Guardadas en `channel_accounts.access_token` cifrado; `SmsAdapter.parseCredentials()` las separa en uso | `channels/sms/sms.adapter.ts` |
| Secretos TOTP (2FA) | `AuthService.encryptTotpSecret()` / `decryptTotpSecret()` | `auth/auth.service.ts` |
| Tokens Google Calendar | `CalendarIntegrationService` | `appointments/calendar-integration.service.ts` |
| **Refresh token Google Business Profile** (Reviews) | `ReviewsService.encrypt()` (AES-256-GCM, formato `{iv}:{tag}:{ct}`) en `tenant.settings.googleBusiness.encryptedRefreshToken` | `reviews/reviews.service.ts` |

**Compatibilidad hacia atras (TOTP):** Si el valor almacenado no contiene `:` (formato antiguo, texto plano base32), se retorna sin descifrar. Esto permite migrar gradualmente secretos existentes.

**Nota multi-canal:** las filas legacy de `channel_accounts` guardan el placeholder `encrypted_ref`/`credential_ref` (credencial compartida a nivel tenant); solo las filas con token real por-cuenta se descifran. Ver §17.

---

## 3. Rate Limiting

### 3.1 Nivel de Aplicacion (Auth Endpoints)

**Implementacion:** Guard personalizado `AuthThrottleGuard` con Redis como backend, activado por el decorador `@AuthThrottle(limit, windowSeconds)` por-handler.

Endpoints con `@AuthThrottle` (inventario real, `auth.controller.ts` + `customer-portal.controller.ts`):

| Endpoint | Limite | Ventana | Notas |
|----------|--------|---------|-------|
| `POST /auth/exchange-code` | 20 | 15 min | Canje de codigo OAuth de un solo uso |
| `POST /auth/login` | 10 | 15 min | |
| `POST /auth/signup` | 5 | 60 min | |
| `POST /auth/verify-email` | 10 | 15 min | |
| `POST /auth/forgot-password` | 5 | 60 min | |
| `POST /auth/reset-password` | 10 | 15 min | |
| `POST /auth/2fa/verify` | 10 | 15 min | |
| `POST /portal/:tenantId/request-access` | 10 | 60 min | Cap OTP del Customer Portal (costo Twilio + phone bombing) |
| `POST /portal/:tenantId/verify` | 10 | 15 min | Defensa en profundidad sobre el limite de 5 intentos por codigo |

**Key Redis:** `auth_rl:{routePath}:{ip}`, donde `routePath` se deriva de `request.route?.path` (p. ej. `/api/v1/auth/login`) — no un tag escrito a mano. Redis `INCR` atomico + `EXPIRE` condicional (TTL solo en el primer incremento); al superar el limite responde `429` con header `Retry-After`.

**Extraccion de IP (anti-spoofing tras Cloudflare):** el orden es `cf-connecting-ip` → primer valor de `x-forwarded-for` → `request.ip` → `'unknown'`. Detras del tunnel de Cloudflare, `CF-Connecting-IP` lo fija Cloudflare con la IP real del cliente y **no** puede sobrescribirse; el primer elemento de `X-Forwarded-For`, en cambio, es spoofeable (el cliente puede enviar `X-Forwarded-For: 1.2.3.4` y Cloudflare *anexa* la IP real despues), asi que rotarlo dejaria evadir el limitador. Por eso se prefiere `CF-Connecting-IP` y solo se cae a XFF/`req.ip` en rutas no-Cloudflare (dev/directo).

**Archivos:** `common/guards/auth-throttle.guard.ts`, `common/decorators/auth-throttle.decorator.ts`

### 3.2 Nivel de Infraestructura

No hay nginx en el camino de produccion: el ingreso es el servicio `tunnel` (Cloudflare Tunnel) de `docker-compose.prod.yml`, con la proteccion DDoS/WAF de Cloudflare. El limite por IP lo aplica la propia API (§3.1, IP real via `CF-Connecting-IP`). Las zonas `api` (30 r/s) y `webhook` (100 r/s) que este documento citaba vivian en `infra/nginx/`, que nunca se monto en produccion y se retiro en K3 (2026-10-30).

### 3.3 Rate Limiting por Tenant

**Servicio:** `TenantThrottleService` — limites basados en plan de suscripcion.
- Controla: mensajes/hora, agentes, calendarios, propiedades, asientos concurrentes
- Cache en Redis: `tenant_plan:{tenantId}` (invalidado al cambiar plan)

---

## 4. Prevencion de Inyeccion SQL

### 4.1 Consultas Parametrizadas

**Regla:** Todas las consultas usan placeholders `$1`, `$2`, etc. con parametros separados. Los UUIDs siempre llevan cast `::uuid`.

```typescript
// Correcto
await this.prisma.executeInTenantSchema(schema,
    `SELECT * FROM leads WHERE id = $1::uuid AND contact_id = $2::uuid`,
    [leadId, contactId],
);
```

### 4.2 Whitelists de Campos (ALLOWED_FIELDS)

Cuando los campos vienen del request body (JSON keys), se filtran contra una lista blanca antes de interpolarse como nombres de columna SQL.

| Archivo | Tabla | Campos permitidos |
|---------|-------|-------------------|
| `leads.repository.ts` | leads | first_name, last_name, phone, phone_normalized, email, stage, source, score, assigned_to, is_vip, notes, metadata, tags, customer_profile_id, archived_at, converted_at |
| `opportunities.repository.ts` | opportunities | lead_id, title, value, currency, stage, probability, expected_close_date, assigned_to, notes, metadata, source, lost_reason, won_date, lost_date |
| `segments.service.ts` | leads (filtros) | first_name, last_name, phone, email, stage, source, score, assigned_to, is_vip, created_at, updated_at, converted_at, archived_at, tags |
| `import-export.service.ts` | leads (filtros) | Misma lista que segments |

**Campos metadata:** Validados con regex `^[a-zA-Z0-9_]+$` para prevenir inyeccion en keys de JSONB.

### 4.3 Validacion de Nombre de Schema

**Archivo:** `prisma.service.ts:39-50`

```
Regex: /^tenant_[a-z0-9_]+$/
Longitud maxima: 63 caracteres (limite de identificador PostgreSQL)
```

Aplicado en: `executeInTenantSchema()`, `createTenantSchema()`, `dropTenantSchema()`, `getTenantTableList()`

### 4.4 Aislamiento por Schema (SET LOCAL)

```sql
SET LOCAL search_path TO "tenant_xxx"
```

Ejecutado dentro de transaccion. `SET LOCAL` garantiza que el search_path aplica SOLO a la transaccion actual — no puede filtrarse a otras conexiones del pool (PgBouncer en modo transaccion).

---

## 5. Seguridad de Webhooks

### 5.1 Meta (WhatsApp / Instagram / Messenger)

| Parametro | Valor |
|-----------|-------|
| Algoritmo | HMAC-SHA256 |
| Secret | `META_APP_SECRET` (env) |
| Header | `x-hub-signature-256` |
| Formato | `sha256={hex_digest}` |
| Comparacion | `crypto.timingSafeEqual()` |
| Fail-closed | Si no hay secret configurado, retorna `false` (rechaza) |

**Archivo:** `channels/meta-signature.util.ts:1-28`

### 5.2 Telegram

| Parametro | Valor |
|-----------|-------|
| Mecanismo | `secret_token` en header `x-telegram-bot-api-secret-token` |
| Generacion | `crypto.randomBytes(32).toString('hex')` al conectar bot |
| Almacenamiento | `channelAccount.metadata.webhookSecret` |
| Validacion | Comparacion en `channels.controller.ts` |

### 5.3 Twilio (SMS entrante)

Validado en `ChannelsController.processSmsWebhook()` / `validateTwilioSignature()` (`channels/channels.controller.ts`), **antes de cualquier efecto secundario**.

| Parametro | Valor |
|-----------|-------|
| Algoritmo | HMAC-SHA1 (estandar Twilio) |
| Proceso | URL completa del webhook + POST params ordenados por clave → HMAC-SHA1 → base64 |
| Comparacion | `crypto.timingSafeEqual()` (con guard de longitud previo) |
| Resolucion del auth token | 1) `channelAccount.metadata.twilioAuthToken` (legacy); 2) **credencial cifrada por-cuenta** via `ChannelTokenService.getChannelToken(tenantId, 'sms', phoneNumber)` → `accessToken.split(':')[1]` (formato `accountSid:authToken`); 3) `TWILIO_AUTH_TOKEN` env |
| Idempotencia **despues** de la firma | El claim atomico `idem:sms:{MessageSid}` (SET NX, 24h) se hace **tras** validar la firma. Ponerlo antes permitia que un `MessageSid` spoofeado quemara la key y el mensaje real firmado se descartara como duplicado |
| Graceful degradation | Si tras la cascada no hay auth token, log warning y skip de la validacion (no rompe flujo) |

> **Fix (commit `5c7da544`, jul 2026):** antes el webhook buscaba el token solo en `metadata.twilioAuthToken` (nunca se guarda) o en `TWILIO_AUTH_TOKEN` (env inexistente) → `authToken` quedaba `undefined` → la validacion de firma se saltaba y el POST entrante se aceptaba **sin verificar** (vector de spoofing de SMS entrante). La resolucion per-account cerro el hueco.

**Nota:** SMS es solo notificacion one-way por creditos (§18); el adaptador conversacional Twilio (`channels/sms/sms.adapter.ts`) queda como legacy.

### 5.4 Wompi / Stripe (Billing)

Validado en `BillingWebhookController.receive()` (`billing/webhook.controller.ts`).

| Parametro | Valor |
|-----------|-------|
| Algoritmo | Checksum de eventos Wompi (`WOMPI_EVENTS_SECRET`) / firma Stripe sobre el `rawBody` |
| Verificacion | `provider.verifyWebhookSignature(rawBody, headers)` sobre el `rawBody` crudo; firma invalida → `401` + `recordWebhookFailure('signature')` |
| Idempotencia | Dedup por `billing_events UNIQUE(provider, providerEventId)` |
| **Provider `mock` bloqueado en produccion** | El provider `mock` tiene una verificacion de firma que siempre retorna `true`; exponer su ruta publica en prod dejaria forjar eventos `PAYMENT_SUCCEEDED` sin autenticacion y activar una suscripcion gratis. `receive()` restringe `allowed` a `['stripe','wompi']` cuando `NODE_ENV === 'production'` (solo agrega `'mock'` fuera de prod); un provider no permitido responde `501` |

---

## 6. Prevencion de XSS

### 6.1 Escapado de HTML

**Patron aplicado:** Escapar entidades HTML (`&`, `<`, `>`, `"`) ANTES de aplicar transformaciones de markdown.

| Componente | Archivo | Contexto |
|------------|---------|----------|
| KB Articulos (publico) | `kb/[tenantSlug]/[slug]/page.tsx` | Renderizado de articulos con `dangerouslySetInnerHTML` |

**Orden de operaciones:**
1. `escapeHtml(text)` — neutraliza tags maliciosos
2. Transformaciones markdown (bold, italic, headers, listas)
3. `dangerouslySetInnerHTML={{ __html: result }}`

### 6.2 Content Security Policy (CSP)

- **API:** `helmet` con su CSP por defecto en todas las rutas salvo Bull Board (`/api/v1/admin/queues`, que necesita scripts inline) — `apps/api/src/main.ts`.
- **Dashboard y landing:** sin CSP propia. La politica que este documento citaba estaba en `infra/nginx/nginx.conf`, que no se aplicaba en produccion (retirado en K3). Queda como hallazgo M-18 (§14).

---

## 7. Prevencion de CSRF

### 7.1 OAuth State Parameter

**Instagram OAuth:** El callback valida el parametro `state` contra el valor almacenado en `localStorage`.

```typescript
const returnedState = params.get("state");
const savedState = localStorage.getItem("ig_oauth_state");
if (!returnedState || !savedState || returnedState !== savedState) {
    finish("error", "Invalid OAuth state — possible CSRF attack");
}
```

**Archivo:** `dashboard/src/app/admin/channels/instagram/callback/page.tsx`

### 7.2 CORS

| Origen permitido | Tipo |
|------------------|------|
| `DASHBOARD_URL` (env) o `http://localhost:3001` | Dashboard |
| `https://admin.parallly-chat.cloud` | Produccion dashboard |
| `https://parallly-chat.cloud` | Landing |
| Widget endpoints (`/api/v1/widget/*`) | CORS permisivo (embeddable) |

**Archivo:** `main.ts:46-54`

---

## 8. Prevencion de SSRF

### 8.1 Validacion de URLs

**Patron aplicado en 2 servicios:**

```typescript
const parsed = new URL(url);
if (!['http:', 'https:'].includes(parsed.protocol)) { /* reject */ }
const blocked = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|::1|fd|fe80)/;
if (blocked.test(hostname)) { /* reject */ }
```

| Servicio | Contexto | Archivo |
|----------|----------|---------|
| iCal Sync | URLs de feeds externos | `ical-sync.service.ts:36-51` |
| Webhooks | URLs destino de webhooks | `webhooks.service.ts` |

**IPs bloqueadas:** localhost, 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1, fd00::/8, fe80::/10

---

## 9. Control de Acceso

### 9.1 Guards (Capas de Proteccion)

```typescript
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
```

| Guard | Funcion | Archivo |
|-------|---------|---------|
| `AuthGuard('jwt')` | Verifica JWT valido, extrae usuario | `jwt.strategy.ts` |
| `RolesGuard` | Verifica rol del usuario vs `@Roles()` decorator | `roles.guard.ts` |
| `TenantGuard` | Asegura acceso solo al tenant propio (UUID validado) | `tenant.guard.ts` |
| `InternalAuthGuard` | Acepta API key interna O JWT | `internal-auth.guard.ts` |
| `AuthThrottleGuard` | Rate limiting por endpoint | `auth-throttle.guard.ts` |

### 9.2 Roles

| Rol | Permisos |
|-----|----------|
| `super_admin` | Operador de plataforma. **Sin tenant implicito** (ver abajo). Puede impersonar con motivo |
| `tenant_admin` | Gestion completa de su tenant |
| `tenant_supervisor` | Supervision de agentes y conversaciones |
| `tenant_agent` | Manejo de conversaciones asignadas |

**Modelo de acceso de `super_admin` (matizado — no es "acceso total").** Hay que distinguir tres capas:

1. **`RolesGuard` (API, `roles.guard.ts`):** en el chequeo de `@Roles()`, `super_admin` pasa (`if (user.role === 'super_admin') return true`). Es un bypass **del chequeo de rol**, no un acceso a datos de cualquier tenant.
2. **Sin tenant implicito:** el JWT de un super_admin no lleva `tenantId`. `TenantGuard` y las consultas `executeInTenantSchema` necesitan un contexto de tenant que un super_admin **solo obtiene impersonando** — la impersonacion emite un token con la identidad de un `tenant_admin` real y su `tenantId` (§1.7). Sin impersonar, no hay schema de tenant sobre el cual operar.
3. **Deny-by-default en el dashboard (`apps/dashboard/src/lib/roles.ts`):** la matriz `PAGE_RULES` + `canAccessPath()` gobierna que puede *ver* cada rol. Si **ninguna** regla matchea una ruta, `super_admin` fuera de impersonacion es **denegado** (`return !(isSuperAdmin(role) && !impersonating)`) — cada pagina de plataforma nueva nace gateada hasta que se le agrega su regla explicita. Las rutas tenant-operacionales llevan `requiresImpersonationForSuperAdmin: true`, asi que el super_admin solo las ve mientras impersona.

> Las capacidades a nivel de componente (`getCapabilities()`) siguen el mismo patron: `canManageBilling/Users/Channels/...` requieren `tenant_admin` **o** `super_admin impersonando` (`saImp`), nunca `super_admin` suelto.

### 9.3 Controladores Protegidos

Todos los controladores con datos sensibles tienen los 3 guards a nivel de clase:

| Controlador | Guards |
|-------------|--------|
| `BillingController` | JWT + Roles + Tenant |
| `OffboardingController` | JWT + Roles + Tenant |
| `KnowledgeController` (legacy endpoints) | JWT + Roles + Tenant |
| `CouponsController` | JWT + Roles + Tenant |
| `SettingsController` | JWT + Roles + Tenant |

### 9.4 Comparacion Timing-Safe de API Key Interna

```typescript
const expected = Buffer.from(expectedKey);
const provided = Buffer.from(internalKey);
if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    throw new UnauthorizedException();
}
```

**Archivo:** `internal-auth.guard.ts:49-56`

---

## 10. Aislamiento Multi-Tenant

### 10.1 Schema-per-Tenant

Cada tenant tiene su propio schema PostgreSQL (`tenant_{slug}`). Las tablas globales (users, tenants, billing) estan en el schema `public`.

```
public.tenants          → id, slug, schema_name, plan, ...
public.users            → id, email, tenantId (FK), role, ...
tenant_acme.leads       → datos aislados del tenant
tenant_acme.conversations → datos aislados del tenant
```

### 10.2 Validacion de Schema

- Regex: `^tenant_[a-z0-9_]+$`
- Longitud: 1-63 caracteres
- Aplicado en TODAS las funciones que interpolan schema name en SQL

### 10.3 SET LOCAL + Transacciones

```typescript
await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}"`);
    return tx.$queryRawUnsafe(query, ...params);
});
```

`SET LOCAL` asegura que el search_path es visible SOLO dentro de la transaccion actual. Con PgBouncer en modo `transaction`, cada transaccion obtiene una conexion fresca — no hay contaminacion entre tenants.

### 10.4 Channel Account Scoping

Todas las busquedas de channel accounts incluyen `tenantId` en el WHERE clause:

```typescript
await this.prisma.channelAccount.findFirst({
    where: { channelType: 'telegram', accountId, tenantId },
});
```

Esto previene que un tenant pueda encontrar o actualizar la cuenta de canal de otro tenant.

---

## 11. Seguridad de Infraestructura

### 11.1 Headers HTTP

| Header | Valor | Ubicacion |
|--------|-------|-----------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | nginx.conf |
| `X-Frame-Options` | `SAMEORIGIN` | nginx.conf |
| `X-Content-Type-Options` | `nosniff` | nginx.conf |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | nginx.conf |
| `Content-Security-Policy` | Ver seccion 6.2 | nginx.conf |
| Helmet (aplicacion) | Headers por defecto + CORP cross-origin | main.ts |

### 11.2 Docker

| Medida | Detalle |
|--------|---------|
| `.dockerignore` | Excluye `.env`, `.git`, `node_modules`, `docs`, `scratch` |
| PostgreSQL port | `expose` (interno solo), no `ports` (no expuesto al host) |
| Sin passwords fallback | `DB_PASSWORD` sin valor por defecto en docker-compose.prod |
| Swagger | Deshabilitado en produccion (`NODE_ENV !== 'production'`) |

### 11.3 Redis

| Parametro | Valor |
|-----------|-------|
| Politica de memoria | `noeviction` (nunca descarta keys — BullMQ requiere esto) |
| Persistencia | AOF (Append-Only File) habilitado; `--maxmemory 512mb` |
| Imagen | `redis:7-alpine` |
| Password | Soportado (opt-in): `docker-compose.prod.yml` arranca `redis-server` con `--requirepass "$REDIS_PASSWORD"` **cuando** `REDIS_PASSWORD` esta definido; sin el secreto arranca sin auth. Ver §15.2 |

### 11.4 PgBouncer

| Parametro | Valor |
|-----------|-------|
| Modo | `transaction` (aislamiento por transaccion) |
| Auth | `md5` |
| Pool default | 50 conexiones |
| Max clientes | 1000 |
| Query timeout | 120s |

### 11.5 Sentry (Error Tracking)

- Importado antes de todos los modulos: `import './instrument'` en `main.ts:1`
- Paquete: `@sentry/nestjs` con profiling
- Captura errores no manejados en produccion

---

## 12. Widget Domain Validation

**Archivo:** `widget-public.controller.ts:67-79`

Validacion estricta de hostname:
1. Parsea `Origin` header como URL (extrae hostname)
2. Comparacion case-insensitive
3. Match exacto O subdominio estricto (`.${domain}`)
4. Previene bypass via `evil-example.com` cuando `example.com` esta permitido

Rate limiting del widget: 5 sesiones por hora por visitor (`widget:rate:{visitorId}:{widgetId}`)

---

## 13. Dependencias

| Medida | Detalle |
|--------|---------|
| SDK Anthropic | Pinned a `^0.78.0` (era `latest` — riesgo supply chain) |
| Audit | `npm audit` recomendado como parte del CI |

---

## 14. Hallazgos Pendientes

### ALTO

| ID | Descripcion | Esfuerzo | Riesgo |
|----|-------------|----------|--------|
| H-14 | Dockerfiles usan usuario root | 30 min | Escalacion de privilegios si hay RCE |

### MEDIO

| ID | Descripcion | Esfuerzo | Riesgo |
|----|-------------|----------|--------|
| M-05 | Super admin salta validacion de sesion | Diseno | Bajo (requiere super_admin) |
| M-07 | Signup retorna tokens antes de verificar email | Diseno | Bajo (patron comun en SaaS) |
| M-08 | SAML AuthnRequests no firmados | 2h | Medio (depende del IdP) |
| M-17 | 13 archivos usan `$queryRawUnsafe` con schema interpolado (ya validado por regex) | 4h | Bajo (mitigado por validacion) |
| M-18 | Dashboard y landing sin Content-Security-Policy (la de `infra/nginx` nunca se aplico en produccion) | 2h | Medio (XSS sin segunda barrera) |

### BAJO

| ID | Descripcion | Esfuerzo | Riesgo |
|----|-------------|----------|--------|
| L-02 | Codigo de password reset no se invalida tras intentos fallidos | 1h | Bajo |
| L-04 | Endpoint `/users` sin restriccion de rol granular | 30 min | Bajo |
| L-06 | Endpoint `2fa/send-email` sin rate limit propio | 15 min | Bajo |
| L-07 | Registro acepta string de rol no validado | 15 min | Bajo |
| L-08 | TTL de sesion (6 min) depende de ping del cliente | Diseno | Bajo |
| L-10 | PII (telefono, email) en logs en texto plano | 2h | Medio (compliance) |
| L-12 | Telegram: fallback de resolucion de tenant puede enviar a tenant incorrecto | 1h | Medio |

---

## 15. Acciones Manuales Requeridas

Las siguientes acciones requieren intervencion manual del operador y NO fueron implementadas automaticamente por codigo:

### 15.1 Variables de Entorno (CRITICO)

Verifica que estas variables esten configuradas en **GitHub Secrets** Y en el **deploy workflow** (`.github/workflows/deploy.yml`):

| Variable | Proposito | Donde verificar |
|----------|-----------|-----------------|
| `JWT_SECRET` | Firma de access tokens | GitHub Secrets: `PROD_JWT_SECRET` |
| `JWT_REFRESH_SECRET` | Firma de refresh tokens (DEBE ser diferente de JWT_SECRET) | GitHub Secrets |
| `INTERNAL_JWT_SECRET` | Token inter-servicio (DEBE ser diferente de JWT_SECRET) | GitHub Secrets |
| `ENCRYPTION_KEY` | AES-256-GCM (64 chars hex) | GitHub Secrets |
| `INTERNAL_API_KEY` | API key para comunicacion interna | GitHub Secrets |
| `META_APP_SECRET` | Validacion webhooks Meta | GitHub Secrets |
| `DB_PASSWORD` | Password de PostgreSQL (ya no tiene fallback) | GitHub Secrets |
| `BULL_BOARD_TOKEN` | Acceso al dashboard de colas (sin este, se deshabilita) | GitHub Secrets |
| `GOOGLE_OAUTH_CLIENT_ID` | Google login (ya no tiene fallback hardcodeado) | GitHub Secrets |

**Como generar `ENCRYPTION_KEY`:**
```bash
openssl rand -hex 32
```

**Como generar `JWT_SECRET` / `JWT_REFRESH_SECRET`:**
```bash
openssl rand -base64 48
```

### 15.2 Redis Password (C-08 — mecanismo listo, requiere setear el secreto)

El soporte ya esta en `docker-compose.prod.yml`: el servicio redis arranca con `--requirepass "$REDIS_PASSWORD"` **cuando** `REDIS_PASSWORD` esta presente (el healthcheck tambien pasa `-a` condicionalmente). Falta unicamente aprovisionar el secreto:

1. Generar el secreto: `openssl rand -base64 32`.
2. Agregar `REDIS_PASSWORD` a **GitHub Secrets** y al `deploy.yml` (si no esta, se pierde en el proximo deploy — ver §15.1).
3. Verificar que `REDIS_URL` de cada servicio incluya la password: `redis://:${REDIS_PASSWORD}@redis:6379`.

Mientras `REDIS_PASSWORD` este vacio, Redis arranca **sin** auth (comportamiento por defecto actual).

### 15.3 Docker Non-Root Users (H-14 — Pendiente)

Agregar a cada Dockerfile antes del `CMD`:
```dockerfile
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs
USER nestjs
```

Verificar que los volumenes tengan permisos adecuados.

### 15.4 Verificacion Post-Deploy

Despues de cada deploy, verificar:

```bash
# 1. Secretos configurados (no debe haber warnings en logs)
docker logs parallext-api 2>&1 | grep -i "warn\|error\|required"

# 2. PgBouncer funcional
docker exec parallext-pgbouncer pg_isready -h localhost -p 6432

# 3. Redis sin password warning
docker exec parallext-redis redis-cli PING

# 4. Swagger NO accesible en produccion
curl -s https://api.parallly-chat.cloud/docs | head -1
# Debe retornar 404 o redirect, NO la pagina de Swagger

# 5. Bull Board protegido
curl -s https://api.parallly-chat.cloud/api/v1/admin/queues
# Debe retornar 503 (si no hay token) o 401 (si hay token pero no coincide)
```

### 15.5 Rotacion de Secretos

**Cada 90 dias (recomendado):**
1. Generar nuevos `JWT_SECRET` y `JWT_REFRESH_SECRET`
2. Actualizar en GitHub Secrets
3. Re-deploy (las sesiones activas se invalidaran — esperado)

**Al sospechar compromiso:**
1. Rotar `ENCRYPTION_KEY` (requiere re-cifrar tokens almacenados)
2. Rotar `INTERNAL_API_KEY`
3. Rotar `META_APP_SECRET` (actualizar en Meta Developer Console tambien)
4. Revocar todas las sesiones Redis: `FLUSHDB` en Redis (destruye sesiones, jobs BullMQ — usar con cuidado)

---

## 16. Resumen de Postura de Seguridad

| Dominio | Estado | Cobertura |
|---------|--------|-----------|
| Autenticacion | Fuerte | JWT + bcrypt 12 + 2FA + OAuth + SAML; impersonacion gobernada (§1.7) |
| Cifrado en reposo | Fuerte | AES-256-GCM: tokens WA/canal per-account, TOTP, Google Calendar, refresh GBP (§2.1) |
| Rate limiting | Fuerte | Redis (app, IP anti-spoof `CF-Connecting-IP`) + Nginx (infra) |
| Inyeccion SQL | Fuerte | Parametrizado + whitelists + validacion schema |
| Webhooks | Fuerte | HMAC + timing-safe en Meta, Telegram, Twilio (firma validada tras `5c7da544`) y MercadoPago/Stripe; provider `mock` bloqueado en prod |
| Control de acceso | Fuerte | 3 guards + super_admin sin tenant implicito + deny-by-default en dashboard (§9.2) |
| XSS | Bueno | Escape HTML + CSP (mejorable con DOMPurify) |
| CSRF | Bueno | OAuth state + CORS strict + SameSite cookies |
| SSRF | Bueno | Validacion URL en 2 servicios |
| Multi-tenancy | Fuerte | Schema isolation + SET LOCAL + tenant guards + scoping per-account |
| Backup / DR | Bueno | pg_dump in-container + offsite rclone (R2) + heartbeat monitorizado (§20) |
| Infraestructura | Bueno | Helmet + HSTS + CSP + PgBouncer + VPS hardening (ufw/fail2ban, SSH key-only) (falta: non-root Docker) |

---

## 17. Multi-canal por Tipo (tokens per-account)

Un tenant puede conectar N conexiones del mismo tipo de canal (p. ej. 2 numeros WhatsApp, 2 cuentas IG). Implicaciones de seguridad:

- **Tokens por-cuenta cifrados:** cada conexion guarda su propio token en `channel_accounts.access_token` (cifrado con `WhatsappCryptoService`, sin migracion global). `ChannelTokenService.getChannelToken(tenantId, channelType, accountId?)` resuelve y descifra el token de la cuenta indicada; filas legacy con `encrypted_ref`/`credential_ref` caen a la credencial compartida a nivel tenant. Ver §2.1.
- **Gating por plan × canal:** el limite es `features.maxChannelAccounts[channelType]` (default **1**), con override por tenant en `quotaOverrides.maxChannelAccounts`. Orden de resolucion (`TenantThrottleService`): override por tenant → feature del plan → default 1. Al exceder, se lanza `403 { error: 'plan_limit_reached', limitKey: 'maxChannelAccounts' }`. El mismo chequeo aplica a los flujos de conexion del dashboard (`channel-management.controller.ts`) y al alta interna (`internal.controller.ts`).
- **Anti-conflacion de conversaciones:** los lookups de channel account incluyen `tenantId` (y el `accountId`/numero concreto), de modo que una conexion no cruza mensajes con otra del mismo tenant ni de otro (ver §10.4). El webhook de Telegram resuelve el bot exacto y **nunca** cae a "cualquier bot activo" (evita fuga cross-tenant).
- **Un agente por conexion:** el binding vive en `agent_personas.channel_bindings` (`ChannelAccountLite`: channelType/accountId), no "un agente por canal". Disconnect es por-cuenta.

## 18. SMS (producto retirado)

El producto SMS esta **retirado** desde agosto de 2026: el kill switch de plataforma `sms.platform_enabled` esta apagado por defecto y creditos, checkout y notificaciones responden `sms_product_retired` (`sms-kill-switch.service.ts`). Las tablas globales `sms_credit_balances`, `sms_credit_ledger` y `sms_package_orders` se conservan por trazabilidad contable; su retiro requiere decision del dueño (ver ADR 0005). La validacion de firma Twilio (§5.3) sigue vigente mientras el adaptador legacy exista. El diseño historico esta en `docs/archive/2026-07-sms/`.

## 19. Fiscal DIAN (Colombia) — gate collect-before-pay

Facturacion electronica via Factus (`IFiscalInvoiceProvider`, modelo `FiscalInvoice`), desacoplada del PSP. Modulo `fiscal/`.

- **Gate OFF por defecto:** `fiscal.gate_enabled` (platform_settings) arranca en `false` (`FiscalConfigService`) — desplegar el codigo no cambia el comportamiento hasta activarlo. Con el gate ON, se exigen los datos fiscales del tenant (NIT/cedula) **antes** de cobrar (collect-before-pay); UI: `FiscalBanner` + `FiscalGateModal` bloqueante en el dashboard.
- **Retencion de PII fiscal:** los datos fiscales (identificacion tributaria) se retienen aun en el purge del tenant (obligacion DIAN) — ver el modelo de teardown; nunca se revoca el `system_user_token` de WhatsApp compartido.
- **Recuperacion de errores Factus:** contrato de codigos y auto-recuperacion `409` (delete+reissue / reconcile) en el adaptador.

## 20. Backup y Recuperacion (DR)

Scripts `infra/backup/backup.sh` + `restore.sh`, orquestados por cron de produccion.

- **Dump dentro del contenedor:** `pg_dump`/`psql` corren **dentro** de `parallext-postgres` (`docker exec`, socket auth, version coincidente) — el host no necesita cliente de Postgres ni credenciales expuestas. Se respaldan schema `public` + cada schema `tenant_*` + Redis (`BGSAVE`) + media.
- **Offsite via rclone:** sync a bucket S3-compatible (Cloudflare **R2**, AWS S3 o Backblaze B2). rclone se configura por variables de entorno (sin `rclone.conf`) para que el remoto sea reproducible desde `.env`.
- **Heartbeat monitorizado:** al completar con exito, `backup.sh` escribe `backup:last_success` (epoch ms) en Redis. `PlatformMonitorService` (Ops Center) lo lee y **alerta si la edad supera `backupStaleHours` (default 26h)**. Si el backup queda incompleto, el script **no** escribe el heartbeat a proposito, para que el monitor dispare la alerta.
- **Incidente de exec-bit (fix `f95e0719`):** los scripts de infra deben estar marcados ejecutables en git (**100755**); de lo contrario el cron del VPS no los ejecutaba. Corolario operativo: el VPS sigue a `origin` exactamente (deploy hace stash + `reset --hard`) — **no** editar a mano scripts de infra versionados en el servidor.

## 21. Ops Center y Hardening de Deploy

**Ops Center (super_admin), modulo `health/`:** liveness `GET /health` + `GET /health/detailed`; `PlatformMonitorService` corre chequeos con cooldown y alerta via email/Telegram/SMS. Cubre salud de contenedores, backup heartbeat (§20), budget/salud de proveedores LLM, y storage por-tenant con quota (`platform-storage.service`). Endpoints de incidentes (`/health/incidents/:id/ack|resolve`) y config de alertas (`GET|PUT /health/alert-config`).

**Hardening de deploy (Fase C):**
- **SSH key-only:** se retiro la password del flujo de deploy (`3505f32b`); llaves de deploy en `.gitignore` (`7c39f1a2`). `harden-vps.sh` deja `PermitRootLogin prohibit-password` y prepara el flip a `PasswordAuthentication no`.
- **Throttling por IP real:** el limitador de auth usa `CF-Connecting-IP` (§3.1) para no ser evadible tras Cloudflare; se ampliaron los endpoints con `@AuthThrottle` (`f112d423`).
- **Deploy defensivo:** gate de pre-conexion SSH con backoff, backup pre-migracion, fail-fast en migrate/seed y alertas de webhook de pago (`38a6a984`, `dbe31c73`).
- **VPS baseline:** `ufw` (deny incoming, solo 22 abierto), `fail2ban`, Postgres bindeado a `127.0.0.1`.

---

## Anexo A — Operacion de autenticacion y usuarios

Fusionado desde el antiguo `docs/SECURITY.md` (K3, 2026-10-30). Las secciones de ese documento que duplicaban a este (JWT, guards, cifrado, webhooks, idempotencia, infraestructura) se retiraron; aqui queda lo operativo que no estaba en otro lugar.

### A.1 Flujo de autenticación

#### Login completo (paso a paso):

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUJO DE AUTENTICACIÓN                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. USUARIO abre /login en el Dashboard                          │
│     └─ Ve formulario de email + contraseña (glassmorphism)       │
│                                                                  │
│  2. DASHBOARD envía POST /auth/login { email, password }         │
│     └─ HTTPS via Cloudflare → API NestJS                         │
│                                                                  │
│  3. API (AuthService.login):                                     │
│     a) Busca usuario por email en tabla public.users             │
│     b) Verifica que isActive = true                              │
│     c) Compara password con bcrypt.compare(input, hash)          │
│        - Hash almacenado: $2b$12$... (12 rounds)                │
│     d) Si NO coincide → 401 Unauthorized                         │
│     e) Si SÍ coincide → genera 2 tokens JWT:                    │
│                                                                  │
│  4. RESPUESTA al Dashboard:                                      │
│     { accessToken, refreshToken, user: { id, email, role ... } } │
│                                                                  │
│  5. DASHBOARD guarda en localStorage:                            │
│     - accessToken    (15 min)                                    │
│     - refreshToken   (8h; 14 días con "Recordarme")              │
│     - user           (JSON con perfil)                           │
│                                                                  │
│  6. Redirige a /admin → AdminLayout verifica token               │
│                                                                  │
│  7. CADA REQUEST a la API:                                       │
│     Authorization: Bearer <accessToken>                          │
│     → JwtStrategy valida firma y expiración                      │
│     → RolesGuard verifica permisos del rol                       │
│                                                                  │
│  8. ACCESS TOKEN expira (15 min):                                │
│     POST /auth/refresh { refreshToken }                          │
│     → Valida contra Redis, ROTA el refresh (nuevo tid) y         │
│       revoca el anterior. Reuse detection: si el tid ya no       │
│       existe → revoca TODAS las sesiones del usuario.            │
│                                                                  │
│  9. LOGOUT: POST /auth/logout { refreshToken } →                 │
│     revoca ese refresh en Redis + destruye la sesión →           │
│     el front borra localStorage → redirige /login                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

> Antes de `AuthService.login()` el flujo pasa por `AuthThrottleGuard` (10 intentos / 15 min
> por IP real, ver §15), por la verificación 2FA si el usuario la tiene activa (§10) y por el
> reconocimiento de dispositivo de confianza (§11). El login OAuth (Google/Microsoft) y SAML
> devuelven un `code` de un solo uso (`oauth_exchange:{code}`, TTL corto) que el dashboard
> canjea vía `POST /auth/exchange-code`.

#### Endpoints de Auth (`auth.controller.ts` + `saml.controller.ts`):

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|------------|
| `/auth/login` | POST | ❌ (throttle 10/15m) | Login email+password → tokens + user (o reto 2FA) |
| `/auth/signup` | POST | ❌ (throttle 5/1h) | Alta self-service: crea empresa + admin |
| `/auth/register` | POST | ✅ super_admin/tenant_admin | Crear usuario (admin crea solo agents de su tenant) |
| `/auth/refresh` | POST | ❌ | Renovar access token (**rota** el refresh) |
| `/auth/logout` | POST | ❌ | Revoca el refresh + destruye sesión |
| `/auth/exchange-code` | POST | ❌ (throttle 20/15m) | Canjea code OAuth/SAML de un solo uso por tokens |
| `/auth/me` | POST | ✅ | Info del usuario actual |
| `/auth/activity-ping` | POST | ✅ | Mantiene viva la sesión (cada 5 min) |
| `/auth/google` | POST | ❌ | Login/registro con Google OAuth |
| `/auth/microsoft/url` · `/auth/microsoft/callback` | GET | ❌ | Inicio y callback de Microsoft OAuth |
| `/auth/forgot-password` | POST | ❌ (throttle 5/1h) | Solicitar código de reseteo |
| `/auth/reset-password` | POST | ❌ (throttle 10/15m) | Confirmar reseteo con código |
| `/auth/change-password` | POST | ✅ | Cambiar contraseña (requiere la actual) |
| `/auth/setup-password` | POST | ✅ | Fijar contraseña a usuarios de Google |
| `/auth/send-verification` · `/auth/verify-email` | POST | ✅ | Verificación de email (OTP 6 dígitos) |
| `/auth/update-profile` | POST | ✅ | Actualizar nombre/teléfono/cargo |
| `/auth/complete-onboarding` | POST | ✅ | Crear empresa + tenant al terminar onboarding |
| `/auth/users` | GET | ✅ | Listar usuarios del tenant (o todos si super_admin) |
| `/auth/users/:id` | PATCH/DELETE | ✅ super_admin/tenant_admin | Editar / desactivar usuario (soft delete + revoca sesiones) |
| `/auth/users/:id/skills` | PUT | ✅ super_admin/tenant_admin | Editar skill tags |
| `/auth/admin/reset-password` | POST | ✅ super_admin | Reset de contraseña de un usuario |
| `/auth/impersonate/:tenantId` | POST | ✅ super_admin | Impersonar tenant admin (motivo obligatorio, §14) |
| `/auth/impersonate/exit` | POST | ✅ super_admin | Cerrar sesión de impersonación |
| `/auth/2fa/status` · `/setup` · `/verify-setup` · `/disable` | GET/POST | ✅ | Gestión de 2FA TOTP (§10) |
| `/auth/2fa/verify` | POST | ❌ (throttle 10/15m) | Verificar código 2FA en login (usa `twoFAToken`) |
| `/auth/2fa/send-email` · `/auth/2fa/send-sms` | POST | ❌ | Enviar OTP fallback por email / SMS |
| `/auth/2fa/backup-codes` | POST | ✅ | Regenerar backup codes (requiere password) |
| `/auth/trusted-devices` | GET | ✅ | Listar dispositivos de confianza (§11) |
| `/auth/trusted-devices/:id/revoke` · `/revoke-all` | POST | ✅ | Revocar uno / todos |
| `/auth/saml/check` · `/login` · `/acs` · `/metadata/:tenantId` | GET/POST | ❌ | Flujo SAML público (§12) |
| `/auth/saml/config` · `/auth/saml/forced/:tenantId` | GET/PUT | ✅/❌ | Config IdP por tenant + estado force-SSO |

*(La tabla resume el set real; para firmas y DTOs exactos ver `auth.controller.ts`.)*

#### Payloads:

**Request Login:**
```json
{ "email": "admin@empresa.com", "password": "••••••••", "rememberMe": true }
```

**Response Login:**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "uuid",
      "email": "admin@parallext.com",
      "firstName": "Admin",
      "lastName": "Parallext",
      "role": "super_admin",
      "tenantId": null,
      "tenantName": null
    }
  }
}
```

---

### A.2 bcrypt — contraseñas

Las contraseñas **nunca** se almacenan en texto plano. Se usa bcrypt con 12 rounds de salting.

#### Cómo funciona:
1. Usuario envía contraseña: `<contraseña-del-usuario>`
2. bcrypt genera salt aleatorio y hashea: `$2b$12$95qKCG/djm1h4pJzpIM3wu...`
3. Solo el hash se guarda en la tabla `users.password`
4. Al login, `bcrypt.compare()` verifica sin exponer la contraseña original

#### Anatomía del hash:
```
$2b$12$95qKCG/djm1h4pJzpIM3wupq9PQ5WaugUXDSv4GO4/IX74njlKZr2
 │   │  └────────────────────── Hash resultado
 │   └── 12 rounds (cost factor)
 └── Algoritmo bcrypt
```

#### Generar hash manualmente:
```bash
# Desde el VPS
docker exec -it parallext-api node -e "require('bcrypt').hash('MI_PASSWORD', 12).then(h => console.log(h))"
```

#### Cambiar contraseña de un usuario:
```bash
# 1. Generar hash
HASH=$(docker exec parallext-api node -e "require('bcrypt').hash('NUEVA_PASS', 12).then(h => console.log(h))")

# 2. Actualizar en DB
docker exec parallext-postgres psql -U parallext -d parallext -c "UPDATE users SET password = '$HASH' WHERE email = 'admin@parallext.com'"
```

---

### A.3 Matriz de roles y permisos (RBAC)

#### Roles del sistema:

| Rol | Scope | Descripción |
|-----|-------|------------|
| `super_admin` | Global | Acceso total a toda la plataforma |
| `tenant_admin` | Su tenant | Admin de su empresa, crea usuarios |
| `tenant_supervisor` | Su tenant | Supervisa agentes, ve analytics |
| `tenant_agent` | Su tenant | Atiende conversaciones |

#### Matriz de permisos:

| Acción | super_admin | tenant_admin | supervisor | agent |
|--------|:-----------:|:------------:|:----------:|:-----:|
| Ver todos los tenants | ✅ | ❌ | ❌ | ❌ |
| Crear/editar tenants | ✅ | ❌ | ❌ | ❌ |
| Crear usuarios | ✅ | ✅ (su tenant) | ❌ | ❌ |
| Ver inbox | ✅ | ✅ | ✅ | ✅ |
| Enviar mensajes | ✅ | ✅ | ✅ | ✅ |
| Asignar conversaciones | ✅ | ✅ | ✅ | ❌ |
| Resolver conversaciones | ✅ | ✅ | ✅ | ✅ |
| Gestionar pipeline | ✅ | ✅ | ✅ | ✅ |
| Crear automation rules | ✅ | ✅ | ❌ | ❌ |
| Ver analytics/leaderboard | ✅ | ✅ | ✅ | ❌ |
| Gestionar API keys | ✅ | ✅ | ❌ | ❌ |
| Gestionar configuración | ✅ | ✅ | ❌ | ❌ |

#### Tenant isolation:
- `super_admin`: `tenantId = NULL` → ve todo
- Otros roles: `tenantId = UUID` → solo ven datos de su tenant
- Las queries SQL filtran por `SET search_path TO 'tenant_schema'`

---

### A.4 Protección del dashboard

#### Componentes de auth en el frontend:

| Componente | Ubicación | Función |
|-----------|-----------|---------|
| `AuthContext.tsx` | `contexts/` | Provider con login, logout, hasRole, estado |
| `Providers.tsx` | `components/` | Envuelve toda la app con AuthProvider |
| `login/page.tsx` | `app/login/` | Página de login premium |
| `admin/layout.tsx` | `app/admin/` | Guard: redirige si no autenticado |

#### Flow del frontend:

```
App start → AuthProvider lee localStorage
  ├─ Token existe → setUser → mostrar /admin
  └─ No token → /login

/admin/layout.tsx:
  ├─ isLoading → mostrar spinner
  ├─ !isAuthenticated → router.push('/login')
  └─ isAuthenticated → mostrar sidebar + topbar + children

/login:
  ├─ Submit → AuthContext.login() → fetch /auth/login
  ├─ Éxito → localStorage.set → router.push('/admin')
  └─ Error → mostrar mensaje "Credenciales inválidas"
```

#### Top bar del dashboard:
- Muestra nombre + rol del usuario autenticado
- Click en avatar → `logout()` → borra tokens → redirige a /login

---

### A.5 Gestión de usuarios

#### Crear usuario admin (VPS):
```bash
# ADMIN_PASSWORD es obligatoria (12+ caracteres); no hay contraseña por defecto en el repo.
cd apps/api && ADMIN_PASSWORD='<elige-una>' npx ts-node prisma/seed-admin.ts
```

#### Usuarios precargados:

Ninguno. No se versionan usuarios ni contraseñas; el admin se crea con `seed-admin.ts` y `ADMIN_PASSWORD`.

> ⚠️ **CAMBIAR CONTRASEÑAS DESPUÉS DEL PRIMER LOGIN**

#### Crear usuario via API:
```bash
curl -X POST https://api.parallly-chat.cloud/auth/register \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "agente@empresa.com",
    "password": "SecurePass123!",
    "firstName": "Juan",
    "lastName": "Agente",
    "role": "tenant_agent",
    "tenantId": "uuid-del-tenant"
  }'
```

---

### A.6 Google OAuth, 2FA por email, reset de contraseña y opt-out
- ID token verification via google-auth-library (OAuth2Client)
- Client ID: env GOOGLE_OAUTH_CLIENT_ID (fallback hardcoded)
- Creates user with authProvider='google', no password, emailVerified=true
- Links to existing email accounts if same email

#### Email-based 2FA
- 6-digit OTP code, 5-minute expiry
- Sent via SMTP (nodemailer)
- Stored in users.email_verify_code (same field as email verification)

#### Password Reset
- POST /auth/forgot-password: always returns success (prevents email enumeration)
- 6-digit code, 10-minute expiry
- POST /auth/reset-password: validates code + password strength

#### Opt-Out Compliance
- Word-boundary regex detection (prevents false positives like "trabajan" ≠ "baja")
- Pending review workflow: admin confirms or rejects
- Messages continue to AI pipeline (not dropped)
