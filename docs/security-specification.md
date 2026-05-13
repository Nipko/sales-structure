# Parallext Engine — Especificacion de Seguridad

**Version:** 1.0
**Fecha:** 2026-05-13
**Alcance:** Plataforma completa (API, Dashboard, WhatsApp Service, Landing, Infraestructura)
**Auditoria base:** `docs/security-audit-2026-05-12.md` (51 de 63 hallazgos remediados)

---

## 1. Autenticacion y Gestion de Sesiones

### 1.1 JWT (JSON Web Tokens)

| Parametro | Valor | Ubicacion |
|-----------|-------|-----------|
| Algoritmo | HS256 | `auth.config.ts` |
| Secret access token | `JWT_SECRET` (env) | `auth.config.ts:8` |
| Secret refresh token | `JWT_REFRESH_SECRET` (separado) | `auth.config.ts:12` |
| TTL access token | 15 minutos | `auth.service.ts:71` |
| TTL refresh token | 8 horas (default) / 14 dias (remember me) | `auth.service.ts:75` |
| TTL token 2FA | 5 minutos | `auth.service.ts:35` |
| Validacion en produccion | Falla si `JWT_SECRET` no esta definido | `auth.config.ts:5-7` |

**Rotacion de refresh tokens:** Cada refresh genera un nuevo par (access + refresh). El token anterior se revoca inmediatamente en Redis. Si se detecta reutilizacion de un token ya revocado (ataque de replay), se revocan TODAS las sesiones del usuario.

```
Redis key: refresh:{userId}:{tokenId}
Deteccion de replay: auth.service.ts:470-477
```

### 1.2 Hashing de Contrasenas

| Parametro | Valor |
|-----------|-------|
| Algoritmo | bcrypt |
| Rondas | 12 |
| Validacion de fuerza | Min 8 chars, 1 mayuscula, 1 minuscula, 1 numero, 1 especial |

**Archivo:** `auth.service.ts:213-223` (validacion), lineas 252/299/528/872 (hash)

### 1.3 Sesiones

| Parametro | Valor |
|-----------|-------|
| Almacenamiento | Redis (`session:{userId}`) |
| TTL | 360 segundos (extendido por ping de actividad cada 5 min) |
| Conflictos | Un usuario no-super_admin puede tener solo 1 sesion activa |
| Limites por tenant | Controlados por plan de suscripcion via `TenantThrottleService` |
| Sesiones tenant | Redis Set `tenant_sessions:{tenantId}` |

**Invalidacion de sesiones:**
- Cambio de contrasena (usuario): revoca todas las sesiones (`auth.service.ts:1157-1158`)
- Reset de contrasena (admin): revoca todas las sesiones del usuario (`auth.service.ts:533-534`)
- Reset de contrasena (publico): revoca sesiones post-cambio (`auth.service.ts:882-883`)

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

### 1.7 Impersonacion (Super Admin)

| Parametro | Valor |
|-----------|-------|
| Quien puede | Solo `super_admin` |
| TTL tokens | 1 hora (access y refresh) |
| Refresh bloqueado | Los tokens de impersonacion NO se pueden renovar |
| Metadata | `isImpersonation: true`, `impersonatedBy: superAdminId` |
| Audit trail | Almacenado en Redis con el refresh token |

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

| Dato | Servicio | Archivo |
|------|----------|---------|
| Tokens de acceso WhatsApp | `WhatsappCryptoService` | `whatsapp-crypto.service.ts` |
| Secretos TOTP (2FA) | `AuthService` (encryptTotpSecret) | `auth.service.ts:1491-1504` |
| Tokens Google Calendar | `CalendarIntegrationService` | `calendar-integration.service.ts` |

**Compatibilidad hacia atras (TOTP):** Si el valor almacenado no contiene `:` (formato antiguo, texto plano base32), se retorna sin descifrar. Esto permite migrar gradualmente secretos existentes.

---

## 3. Rate Limiting

### 3.1 Nivel de Aplicacion (Auth Endpoints)

**Implementacion:** Guard personalizado `AuthThrottleGuard` con Redis como backend.

| Endpoint | Limite | Ventana | Key Redis |
|----------|--------|---------|-----------|
| `POST /auth/login` | 10 intentos | 15 min | `auth_rl:login:{ip}` |
| `POST /auth/signup` | 5 intentos | 60 min | `auth_rl:signup:{ip}` |
| `POST /auth/forgot-password` | 5 intentos | 60 min | `auth_rl:forgot-password:{ip}` |
| `POST /auth/reset-password` | 10 intentos | 15 min | `auth_rl:reset-password:{ip}` |
| `POST /auth/verify-email` | 10 intentos | 15 min | `auth_rl:verify-email:{ip}` |
| `POST /auth/2fa/verify` | 10 intentos | 15 min | `auth_rl:2fa-verify:{ip}` |

**Mecanismo:** Redis `INCR` atomico + `EXPIRE` condicional. IP del cliente extraida de `x-forwarded-for` (proxy-aware).

**Archivos:** `common/guards/auth-throttle.guard.ts`, `common/decorators/auth-throttle.decorator.ts`

### 3.2 Nivel de Infraestructura (Nginx)

| Zona | Rate | Uso |
|------|------|-----|
| `api` | 30 req/s por IP | Endpoints generales de API |
| `webhook` | 100 req/s por IP | Webhooks de canales |

**Archivo:** `infra/nginx/nginx.conf:41-42`

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

### 5.3 Twilio (SMS)

| Parametro | Valor |
|-----------|-------|
| Algoritmo | HMAC-SHA1 (standard Twilio) |
| Proceso | URL completa + POST params ordenados → HMAC → base64 |
| Comparacion | `crypto.timingSafeEqual()` |
| Secret | `channelAccount.metadata.twilioAuthToken` o `TWILIO_AUTH_TOKEN` env |
| Graceful degradation | Si no hay auth token, log warning y skip (no rompe flujo existente) |

### 5.4 MercadoPago (Billing)

| Parametro | Valor |
|-----------|-------|
| Algoritmo | HMAC-SHA256 |
| Idempotencia | Redis SETNX key con 24h TTL |
| Verificacion | `provider.verifyWebhookSignature(rawBody, headers)` |

**Archivo:** `billing/webhook.controller.ts`

---

## 6. Prevencion de XSS

### 6.1 Escapado de HTML

**Patron aplicado:** Escapar entidades HTML (`&`, `<`, `>`, `"`) ANTES de aplicar transformaciones de markdown.

| Componente | Archivo | Contexto |
|------------|---------|----------|
| KB Articulos (publico) | `kb/[tenantSlug]/[slug]/page.tsx` | Renderizado de articulos con `dangerouslySetInnerHTML` |
| Copilot Widget | `CopilotWidget.tsx` | Respuestas de LLM mostradas como HTML |

**Orden de operaciones:**
1. `escapeHtml(text)` — neutraliza tags maliciosos
2. Transformaciones markdown (bold, italic, headers, listas)
3. `dangerouslySetInnerHTML={{ __html: result }}`

### 6.2 Content Security Policy (CSP)

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://connect.facebook.net https://www.googletagmanager.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: https: blob:;
connect-src 'self' https://api.parallly-chat.cloud https://graph.facebook.com https://graph.instagram.com wss:;
frame-src https://www.facebook.com https://web.facebook.com;
object-src 'none';
base-uri 'self';
```

**Archivo:** `infra/nginx/nginx.conf:38`

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
| `super_admin` | Acceso total, bypass de RolesGuard, impersonacion |
| `tenant_admin` | Gestion completa de su tenant |
| `tenant_supervisor` | Supervision de agentes y conversaciones |
| `tenant_agent` | Manejo de conversaciones asignadas |

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
| Persistencia | AOF (Append-Only File) habilitado |
| Imagen | `redis:7-alpine` |

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

### 15.2 Redis Password (C-08 — Pendiente)

Redis actualmente no tiene password configurado. Para habilitarlo:

1. En `docker-compose.prod.yml`, agregar al servicio redis:
   ```yaml
   command: redis-server --appendonly yes --maxmemory-policy noeviction --requirepass ${REDIS_PASSWORD}
   ```

2. Actualizar `DATABASE_URL` de Redis en los servicios que se conectan:
   ```
   REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
   ```

3. Agregar `REDIS_PASSWORD` a GitHub Secrets y al deploy workflow.

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
| Autenticacion | Fuerte | JWT + bcrypt 12 + 2FA + OAuth + SAML |
| Cifrado en reposo | Fuerte | AES-256-GCM para tokens y secretos TOTP |
| Rate limiting | Fuerte | Redis (app) + Nginx (infra) |
| Inyeccion SQL | Fuerte | Parametrizado + whitelists + validacion schema |
| Webhooks | Fuerte | HMAC + timing-safe en 4 canales |
| XSS | Bueno | Escape HTML + CSP (mejorable con DOMPurify) |
| CSRF | Bueno | OAuth state + CORS strict + SameSite cookies |
| SSRF | Bueno | Validacion URL en 2 servicios |
| Multi-tenancy | Fuerte | Schema isolation + SET LOCAL + tenant guards |
| Infraestructura | Bueno | Helmet + HSTS + CSP + PgBouncer (falta: non-root Docker, Redis password) |
