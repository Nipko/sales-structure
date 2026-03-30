# 🔐 Seguridad y Autenticación — Parallext Engine

> Versión 1.1 · Actualizado: Marzo 29, 2026

---

## Tabla de Contenidos

1. [Flujo de Autenticación](#1-flujo-de-autenticación)
2. [JWT — Tokens de Acceso](#2-jwt--tokens-de-acceso)
3. [bcrypt — Contraseñas](#3-bcrypt--contraseñas)
4. [Roles y Permisos (RBAC)](#4-roles-y-permisos-rbac)
5. [Guards y Decoradores](#5-guards-y-decoradores)
6. [Protección del Dashboard](#6-protección-del-dashboard)
7. [Infraestructura de Seguridad](#7-infraestructura-de-seguridad)
8. [Seguridad del Servicio WhatsApp](#8-seguridad-del-servicio-whatsapp)
9. [Idempotencia y Protección contra Duplicados](#9-idempotencia-y-protección-contra-duplicados)
10. [Gestión de Usuarios](#10-gestión-de-usuarios)
11. [Buenas Prácticas](#11-buenas-prácticas)

---

## 1. Flujo de Autenticación

### Login completo (paso a paso):

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
│     - refreshToken   (7 días)                                    │
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
│     → Genera nuevo Access Token                                  │
│                                                                  │
│  9. LOGOUT: borra localStorage → redirige /login                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Endpoints de Auth:

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|------------|
| `/auth/login` | POST | ❌ | Login → tokens + user |
| `/auth/register` | POST | ✅ admin | Crear usuario |
| `/auth/refresh` | POST | ❌ | Renovar access token |
| `/auth/me` | POST | ✅ | Info del usuario actual |

### Payloads:

**Request Login:**
```json
{ "email": "admin@parallext.com", "password": "Parallext2026!" }
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

## 2. JWT — Tokens de Acceso

### Estructura del token (payload):

```json
{
  "sub": "user-uuid",
  "email": "admin@parallext.com",
  "role": "super_admin",
  "tenantId": null,
  "iat": 1709500000,
  "exp": 1709500900
}
```

### Configuración:

| Parámetro | Valor | Variable de entorno |
|-----------|-------|-------------------|
| Access Token TTL | 15 minutos | `JWT_EXPIRATION` |
| Refresh Token TTL | 7 días | `JWT_REFRESH_EXPIRATION` |
| Algoritmo | HS256 | — |
| Secret (access) | Aleatorio, 64 chars | `JWT_SECRET` |
| Secret (refresh) | Aleatorio, 64 chars | `JWT_REFRESH_SECRET` |

### Generación de secrets (producción):
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## 3. bcrypt — Contraseñas

Las contraseñas **nunca** se almacenan en texto plano. Se usa bcrypt con 12 rounds de salting.

### Cómo funciona:
1. Usuario envía contraseña: `Parallext2026!`
2. bcrypt genera salt aleatorio y hashea: `$2b$12$95qKCG/djm1h4pJzpIM3wu...`
3. Solo el hash se guarda en la tabla `users.password`
4. Al login, `bcrypt.compare()` verifica sin exponer la contraseña original

### Anatomía del hash:
```
$2b$12$95qKCG/djm1h4pJzpIM3wupq9PQ5WaugUXDSv4GO4/IX74njlKZr2
 │   │  └────────────────────── Hash resultado
 │   └── 12 rounds (cost factor)
 └── Algoritmo bcrypt
```

### Generar hash manualmente:
```bash
# Desde el VPS
docker exec -it parallext-api node -e "require('bcrypt').hash('MI_PASSWORD', 12).then(h => console.log(h))"
```

### Cambiar contraseña de un usuario:
```bash
# 1. Generar hash
HASH=$(docker exec parallext-api node -e "require('bcrypt').hash('NUEVA_PASS', 12).then(h => console.log(h))")

# 2. Actualizar en DB
docker exec parallext-postgres psql -U parallext -d parallext -c "UPDATE users SET password = '$HASH' WHERE email = 'admin@parallext.com'"
```

---

## 4. Roles y Permisos (RBAC)

### Roles del sistema:

| Rol | Scope | Descripción |
|-----|-------|------------|
| `super_admin` | Global | Acceso total a toda la plataforma |
| `tenant_admin` | Su tenant | Admin de su empresa, crea usuarios |
| `tenant_supervisor` | Su tenant | Supervisa agentes, ve analytics |
| `tenant_agent` | Su tenant | Atiende conversaciones |

### Matriz de permisos:

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

### Tenant isolation:
- `super_admin`: `tenantId = NULL` → ve todo
- Otros roles: `tenantId = UUID` → solo ven datos de su tenant
- Las queries SQL filtran por `SET search_path TO 'tenant_schema'`

---

## 5. Guards y Decoradores

### Archivos clave del backend:

| Archivo | Función |
|---------|---------|
| `auth.service.ts` | Login, register, refresh, validateUser |
| `auth.controller.ts` | Endpoints REST de auth |
| `jwt.strategy.ts` | Passport strategy para validar JWTs |
| `roles.guard.ts` | Guard que verifica roles del usuario |
| `roles.decorator.ts` | Decorador `@Roles('super_admin', ...)` |
| `tenant.decorator.ts` | Decorador `@CurrentUser()` para inyectar usuario |

### Uso en controllers:

```typescript
// Endpoint protegido (solo admins)
@Post('register')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin', 'tenant_admin')
async register(@Body() dto, @CurrentUser() currentUser) {
    // currentUser contiene { id, email, role, tenantId }
    // tenant_admin solo puede crear agents en su tenant
}

// Endpoint protegido (cualquier usuario autenticado)
@Get('inbox/:tenantId')
@UseGuards(AuthGuard('jwt'))
async getInbox(@Param('tenantId') tenantId) { ... }
```

---

## 6. Protección del Dashboard

### Componentes de auth en el frontend:

| Componente | Ubicación | Función |
|-----------|-----------|---------|
| `AuthContext.tsx` | `contexts/` | Provider con login, logout, hasRole, estado |
| `Providers.tsx` | `components/` | Envuelve toda la app con AuthProvider |
| `login/page.tsx` | `app/login/` | Página de login premium |
| `admin/layout.tsx` | `app/admin/` | Guard: redirige si no autenticado |

### Flow del frontend:

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

### Top bar del dashboard:
- Muestra nombre + rol del usuario autenticado
- Click en avatar → `logout()` → borra tokens → redirige a /login

---

## 7. Infraestructura de Seguridad

| Capa | Tecnología | Protección |
|------|-----------|-----------|
| **Red** | Cloudflare Tunnel | Zero puertos abiertos, DDoS protection |
| **SSL** | Cloudflare | HTTPS obligatorio, TLS 1.3 |
| **API Gateway** | NestJS Guards | JWT validation en cada request |
| **Passwords** | bcrypt (12 rounds) | Resistente a brute force |
| **Tokens** | JWT (HS256) | Firmados, con expiración corta |
| **CORS** | NestJS | Solo orígenes permitidos |
| **DB** | Schema isolation | Cada tenant en schema separado |
| **Secrets** | .env (non-committed) | Variables de entorno, no hardcodeadas |

---

## 8. Seguridad del Servicio WhatsApp

### HMAC-SHA256 — Validación de Webhooks:
Cada webhook entrante de Meta incluye un header `X-Hub-Signature-256` con la firma HMAC del body.
El servicio WhatsApp (puerto 3002) calcula `HMAC-SHA256(body, META_APP_SECRET)` y compara con la firma recibida.
Si no coincide, el webhook se rechaza con 401.

### AES-256-GCM — Cifrado de Tokens:
Los tokens de acceso de WhatsApp Business se almacenan cifrados en la tabla `whatsapp_credentials`.
- Algoritmo: AES-256-GCM
- Clave: `ENCRYPTION_KEY` (64 caracteres hexadecimales = 256 bits)
- Cada registro tiene su propio IV y auth tag
- El token solo se descifra en memoria al momento de usarse para llamadas a la Meta API

### Auth Guard Interno (x-internal-key):
La comunicación entre el WhatsApp Service (3002) y la API (3000) se protege con un guard dual:
1. **JWT**: El servicio WhatsApp puede autenticarse con un JWT firmado con `INTERNAL_JWT_SECRET`
2. **x-internal-key**: Alternativamente, se envía el header `x-internal-key` con el valor de `INTERNAL_API_KEY`

El guard acepta cualquiera de los dos mecanismos. Esto permite llamadas service-to-service sin necesidad de un usuario real.

---

## 9. Idempotencia y Protección contra Duplicados

### Webhooks WhatsApp:
Meta puede enviar el mismo webhook más de una vez. Para evitar procesamiento duplicado:
- Al recibir un webhook, se genera la clave `idem:wa:{waMessageId}` en Redis
- Si la clave ya existe, el webhook se descarta (ya fue procesado)
- TTL de la clave: 24 horas
- Esto garantiza procesamiento exactly-once dentro de la ventana de 24h

### Onboarding:
El flujo de onboarding también usa dedupe keys en Redis para evitar que un tenant inicie múltiples procesos simultáneos.

---

## 10. Gestión de Usuarios

### Crear usuario admin (VPS):
```bash
# Opción A: Seed SQL (precargado)
docker exec -i parallext-postgres psql -U parallext -d parallext \
  < apps/api/prisma/migrations/005_seed_admin_users.sql

# Opción B: Script TypeScript
cd apps/api && npx ts-node prisma/seed-admin.ts
```

### Usuarios precargados:

| Email | Password | Rol | Tenant |
|-------|----------|-----|--------|
| `admin@parallext.com` | `Parallext2026!` | super_admin | Global |
| `gecko@parallext.com` | `Parallext2026!` | tenant_admin | Gecko Aventura |

> ⚠️ **CAMBIAR CONTRASEÑAS DESPUÉS DEL PRIMER LOGIN**

### Crear usuario via API:
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

## 11. Buenas Prácticas

1. **Contraseñas**: Mínimo 12 caracteres, incluir mayúsculas, números y símbolos
2. **JWT Secrets**: Usar `crypto.randomBytes(64)`, nunca reusar entre access y refresh
3. **Refresh Tokens**: Rotar en cada uso si se implementa blacklisting
4. **Logs de auditoría**: Cada login queda registrado con `lastLoginAt`
5. **Session timeout**: Access token expira en 15 min para limitar ventana de ataque
6. **HTTPS**: Todo el tráfico es encriptado via Cloudflare
7. **Variables de entorno**: Nunca commitear `.env` al repositorio
8. **Tenant isolation**: Verificar siempre que el `tenantId` del JWT coincida con los datos solicitados
