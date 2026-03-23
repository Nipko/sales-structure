# 📱 WhatsApp Onboarding Service

Servicio NestJS independiente para manejar el flujo completo de **WhatsApp Embedded Signup v4** y el procesamiento de webhooks de Meta.

## 🏗️ Arquitectura

```
apps/whatsapp/
├── src/
│   ├── main.ts                    # Entry point — port 3002
│   ├── app.module.ts              # Root module
│   ├── config/                    # Typed config (app, database, redis, meta)
│   ├── common/
│   │   ├── guards/                # JwtAuthGuard, RolesGuard
│   │   ├── decorators/            # @Roles
│   │   └── enums/                 # OnboardingStatus (13 states), OnboardingErrorCode (16 codes)
│   └── modules/
│       ├── onboarding/            # Core onboarding flow
│       ├── webhooks/              # Meta webhook handler
│       ├── meta-graph/            # Graph API client
│       ├── jobs/                  # BullMQ workers
│       ├── assets/                # Template & phone sync
│       ├── audit/                 # Audit logging
│       ├── prisma/                # Database + tenant resolution
│       └── health/                # Liveness + readiness probes
```

## 🔄 Flujo de Onboarding (10 pasos)

```
1. Validar pre-condiciones (tenant activo, no duplicados, config válido)
2. Crear registro (STATUS: CODE_RECEIVED)
3. Exchange code → access_token con Meta Graph API
4. Descubrir WABAs y phone numbers
5. Persistir canal en tenant schema (whatsapp_channels)
6. Registrar channel_account público (routing de webhooks)
7. Almacenar credential cifrada (AES-256-GCM)
8. Suscribir webhook de la WABA
9. Sincronizar templates (background, no bloquea)
10. Marcar COMPLETED
```

## 🔌 API Endpoints

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| `POST` | `/onboarding/start` | Iniciar onboarding | `super_admin`, `tenant_admin` |
| `GET` | `/onboarding/:id` | Detalle completo | JWT |
| `GET` | `/onboarding/:id/status` | Estado (polling) | JWT |
| `POST` | `/onboarding/:id/retry` | Reintentar fallido | `super_admin`, `tenant_admin` |
| `POST` | `/onboarding/:id/resync` | Re-sync assets | `super_admin`, `tenant_admin` |
| `DELETE` | `/onboarding/:id` | Cancelar en progreso | `super_admin`, `tenant_admin` |
| `GET` | `/onboarding` | Listar todos (admin) | `super_admin` |
| `GET` | `/webhooks/whatsapp` | Verificación Meta | Público |
| `POST` | `/webhooks/whatsapp` | Recibir webhooks | HMAC-SHA256 |
| `GET` | `/health/live` | Liveness probe | Público |
| `GET` | `/health/ready` | Readiness probe | Público |

## 🔐 Seguridad

- **JWT compartido** con `apps/api` via `INTERNAL_JWT_SECRET`
- **HMAC-SHA256** para validar firma de webhooks de Meta
- **AES-256-GCM** para cifrar tokens de acceso almacenados
- **Role-based access** con `@Roles()` decorator
- **Timing-safe comparison** para validación de firmas

## ⚡ BullMQ Queues

| Cola | Prefijo | Workers |
|------|---------|---------|
| `webhooks` | `wa:` | process-message, process-status, template-status, account-update |
| `sync` | `wa:` | sync-templates, sync-phone-numbers, full-reconciliation |
| `onboarding` | `wa:` | (reserved for future async onboarding steps) |
| `ops` | `wa:` | (reserved for operational tasks) |

## 🐳 Docker

```bash
# Build local
docker build -f infra/docker/Dockerfile.whatsapp -t parallext-whatsapp .

# Run
docker run -p 3002:3002 --env-file .env parallext-whatsapp
```

**Imagen GHCR**: `ghcr.io/nipko/parallext-whatsapp:latest`

## 📋 Variables de Entorno

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_HOST` | ✅ | Redis host (container name in Docker) |
| `REDIS_PORT` | ✅ | Redis port (default: 6379) |
| `INTERNAL_JWT_SECRET` | ✅ | Shared JWT secret with API |
| `ENCRYPTION_KEY` | ✅ | 64-char hex key for AES-256-GCM |
| `META_APP_ID` | ✅ | Facebook App ID |
| `META_APP_SECRET` | ✅ | Facebook App Secret |
| `META_VERIFY_TOKEN` | ✅ | Custom webhook verify token |
| `META_CONFIG_ID` | ✅ | Facebook Login config ID |
| `META_GRAPH_VERSION` | ❌ | Graph API version (default: v21.0) |
| `PORT` | ❌ | Server port (default: 3002) |

## 🔗 Dependencias del Monorepo

- `@parallext/shared` — Tipos compartidos (`JwtPayload`, `AuthUser`, `UserRole`)
- `@prisma/client` — Prisma ORM (schema compartido con `apps/api`)
