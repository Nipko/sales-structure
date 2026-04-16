# Parallly — Guia de Instalacion en Servidor Nuevo

## Requisitos del Servidor

- **OS**: Ubuntu 22.04+ (LTS)
- **RAM**: 8GB minimo (4GB app + 700MB observabilidad + margen)
- **CPU**: 2 nucleos minimo
- **Disco**: 40GB+ SSD
- **Docker**: Docker Engine 24+ con Docker Compose v2
- **Acceso**: Root o usuario con sudo

## Cuentas Externas Necesarias

Antes de empezar, necesitas tener configuradas estas cuentas:

| Servicio | Que necesitas | Donde obtenerlo |
|----------|--------------|-----------------|
| **Cloudflare** | Cuenta + dominio configurado | dash.cloudflare.com |
| **Meta Developer** | App ID, App Secret, Config ID, Verify Token | developers.facebook.com |
| **GitHub** | Personal Access Token (para GHCR) | github.com/settings/tokens |
| **Sentry** | DSN del proyecto | sentry.io |
| **SMTP** | Host, user, password (para emails) | Tu proveedor de email |
| **Google OAuth** | Client ID | console.cloud.google.com |
| **OpenAI/Anthropic/etc** | Al menos 1 API key de LLM | platform.openai.com / console.anthropic.com |

---

## Paso 1: Preparar el Servidor

```bash
# Actualizar sistema
apt update && apt upgrade -y

# Instalar Docker (si no esta instalado)
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# Verificar
docker --version
docker compose version

# Crear directorio del proyecto
mkdir -p /opt/parallext-engine
cd /opt/parallext-engine

# Autenticar con GitHub Container Registry
echo "TU_GITHUB_PAT" | docker login ghcr.io -u TU_GITHUB_USER --password-stdin
```

---

## Paso 2: Clonar el Repositorio

```bash
cd /opt
git clone https://github.com/Nipko/sales-structure.git parallext-engine
cd parallext-engine
```

---

## Paso 3: Crear el archivo .env

```bash
# Generar secrets automaticamente
JWT_SECRET=$(openssl rand -base64 48)
JWT_REFRESH_SECRET=$(openssl rand -base64 48)
ENCRYPTION_KEY=$(openssl rand -hex 32)
INTERNAL_API_KEY=$(openssl rand -base64 32)
INTERNAL_JWT_SECRET=$(openssl rand -base64 48)
DB_PASSWORD="p4r4ll3xt$(openssl rand -hex 4)"
BULL_BOARD_TOKEN=$(openssl rand -hex 32)
GRAFANA_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
META_VERIFY_TOKEN=$(openssl rand -hex 32)

cat > .env << EOF
# ============================================
# Parallly — Production Configuration
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# ============================================

# ---- General ----
NODE_ENV=production

# ---- Database ----
DB_PASSWORD=${DB_PASSWORD}
DATABASE_URL=postgresql://parallext:\${DB_PASSWORD}@pgbouncer:5432/parallext_engine?pgbouncer=true
DIRECT_DATABASE_URL=postgresql://parallext:\${DB_PASSWORD}@postgres:5432/parallext_engine

# ---- Redis ----
REDIS_HOST=redis
REDIS_PORT=6379

# ---- JWT Auth ----
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=8h

# ---- Encryption (AES-256-GCM) ----
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# ---- Internal Service Auth ----
INTERNAL_JWT_SECRET=${INTERNAL_JWT_SECRET}
API_INTERNAL_URL=http://api:3000/api/v1
INTERNAL_API_KEY=${INTERNAL_API_KEY}

# ---- Meta / WhatsApp ----
META_APP_ID=CAMBIAR
META_APP_SECRET=CAMBIAR
META_CONFIG_ID=CAMBIAR
META_VERIFY_TOKEN=${META_VERIFY_TOKEN}
WHATSAPP_VERIFY_TOKEN=${META_VERIFY_TOKEN}
SYSTEM_USER_ID=

# ---- Google OAuth ----
GOOGLE_OAUTH_CLIENT_ID=CAMBIAR
NEXT_PUBLIC_GOOGLE_CLIENT_ID=CAMBIAR

# ---- AI Providers (al menos 1 requerido) ----
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
XAI_API_KEY=
DEEPSEEK_API_KEY=

# ---- Sentry ----
SENTRY_DSN=CAMBIAR

# ---- SMTP (email) ----
SMTP_HOST=CAMBIAR
SMTP_PORT=587
SMTP_USER=CAMBIAR
SMTP_PASS=CAMBIAR
SMTP_FROM=Parallly <no-reply@parallly-chat.cloud>

# ---- Frontend URLs ----
NEXT_PUBLIC_API_URL=https://api.TU-DOMINIO.com/api/v1
NEXT_PUBLIC_WA_SERVICE_URL=https://wa.TU-DOMINIO.com/api/v1
NEXT_PUBLIC_META_APP_ID=CAMBIAR
NEXT_PUBLIC_META_CONFIG_ID=CAMBIAR
DASHBOARD_URL=https://admin.TU-DOMINIO.com

# ---- Media ----
MEDIA_STORAGE_PATH=/data/media

# ---- Observabilidad ----
BULL_BOARD_TOKEN=${BULL_BOARD_TOKEN}
GRAFANA_PASSWORD=${GRAFANA_PASSWORD}
EOF

chmod 600 .env
```

**IMPORTANTE**: Edita el `.env` y reemplaza todos los `CAMBIAR` con tus valores reales:

```bash
nano .env
```

---

## Paso 4: Configurar Cloudflare Tunnel

### 4.1 Crear el Tunnel en Cloudflare

1. Ve a **dash.cloudflare.com** > **Zero Trust** > **Networks** > **Tunnels**
2. Click **Create a tunnel** > nombre: `parallext` > **Save**
3. Copia el **Tunnel Token** que aparece
4. **NO configures los hostnames todavia** — primero levanta los containers

### 4.2 Instalar cloudflared en el VPS

```bash
mkdir -p /opt/cloudflared

# Crear el config local (backup, la config real es remota)
cat > /opt/cloudflared/config.yml << 'EOFCF'
tunnel: TU_TUNNEL_ID
credentials-file: /etc/cloudflared/TU_TUNNEL_ID.json
ingress:
  - service: http_status:404
EOFCF
```

NOTA: El tunnel de Parallly usa **configuracion remota** (managed desde el dashboard de Cloudflare). El archivo local es solo backup. La config real se gestiona en Zero Trust > Tunnels > Configure > Public Hostname.

### 4.3 Configurar hostnames en Cloudflare (despues de levantar containers)

En **Zero Trust > Tunnels > tu tunnel > Configure > Public Hostname**, agrega:

| Subdomain | Domain | Service Type | URL |
|-----------|--------|-------------|-----|
| api | tu-dominio.com | HTTP | `api:3000` |
| admin | tu-dominio.com | HTTP | `dashboard:3001` |
| wa | tu-dominio.com | HTTP | `whatsapp:3002` |
| (vacio) | tu-dominio.com | HTTP | `landing:80` |
| www | tu-dominio.com | HTTP | `landing:80` |
| status | tu-dominio.com | HTTP | `uptime-kuma:3001` |
| grafana | tu-dominio.com | HTTP | `grafana:3000` |
| logs | tu-dominio.com | HTTP | `dozzle:8080` |

**IMPORTANTE**: Los URLs del Service usan el **nombre del servicio** del docker-compose (sin prefijo), NO el `container_name`.

### 4.4 Crear DNS Records en Cloudflare

En **DNS** de tu dominio, agrega estos CNAME:

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | api | `{tunnel-id}.cfargotunnel.com` | Proxied |
| CNAME | admin | `{tunnel-id}.cfargotunnel.com` | Proxied |
| CNAME | wa | `{tunnel-id}.cfargotunnel.com` | Proxied |
| CNAME | @ | `{tunnel-id}.cfargotunnel.com` | Proxied |
| CNAME | www | `{tunnel-id}.cfargotunnel.com` | Proxied |
| CNAME | status | `{tunnel-id}.cfargotunnel.com` | Proxied |
| CNAME | grafana | `{tunnel-id}.cfargotunnel.com` | Proxied |
| CNAME | logs | `{tunnel-id}.cfargotunnel.com` | Proxied |

---

## Paso 5: Levantar la Infraestructura

```bash
cd /opt/parallext-engine

# Levantar DB y Redis primero
docker compose -f infra/docker/docker-compose.prod.yml up -d postgres redis

# Esperar a que PostgreSQL este listo
echo "Esperando PostgreSQL..."
until docker exec parallext-postgres pg_isready -U parallext > /dev/null 2>&1; do sleep 2; done
echo "PostgreSQL listo"

# Setup inicial de la base de datos
bash infra/scripts/setup-fresh.sh

# Levantar TODOS los servicios
docker compose -f infra/docker/docker-compose.prod.yml up -d
```

---

## Paso 6: Verificar que todo arranco

```bash
# Ver todos los containers
docker ps --format "table {{.Names}}\t{{.Status}}"

# Deberian aparecer (16 containers):
# parallext-api          Up
# parallext-worker       Up
# parallext-dashboard    Up
# parallext-whatsapp     Up
# parallext-landing      Up
# parallext-postgres     Up (healthy)
# parallext-pgbouncer    Up (healthy)
# parallext-redis        Up (healthy)
# parallext-tunnel       Up
# parallext-watchtower   Up
# parallext-dozzle       Up
# parallext-uptime-kuma  Up
# parallext-grafana      Up
# parallext-loki         Up
# parallext-promtail     Up
```

---

## Paso 7: Configurar Grafana

1. Abrir `https://grafana.tu-dominio.com`
2. Login: `admin` / `admin` (primera vez)
3. Te pedira cambiar la password — usa la que generaste en `.env` (GRAFANA_PASSWORD)
4. **Si no acepta `admin/admin`**: reset manual:
   ```bash
   docker exec parallext-grafana /usr/share/grafana/bin/grafana cli admin reset-admin-password TU_PASSWORD --homepath /usr/share/grafana --config /etc/grafana/grafana.ini
   ```
5. Agregar Loki: Connections > Data Sources > Add > Loki > URL: `http://loki:3100` > Save & Test
6. Crear dashboard con queries:
   - `sum(count_over_time({container_name=~"parallext-.*"}[5m])) by (container_name)` (Time series)
   - `{container_name=~"parallext-.*"} |= "error"` (Logs)

---

## Paso 8: Configurar Uptime Kuma

1. Abrir `https://status.tu-dominio.com`
2. Crear cuenta admin (primera vez)
3. Agregar monitors (ver tabla en Paso 4.3 — usar los `container_name`)
4. Configurar notificaciones: Settings > Notifications > Telegram/Email

---

## Paso 9: Verificar Bull Board

Abrir:
```
https://api.tu-dominio.com/api/v1/admin/queues?token={BULL_BOARD_TOKEN}
```

Deben aparecer 5 colas: outbound-messages, broadcast-messages, automation-jobs, nurturing, conversation-snooze.

---

## Paso 10: Verificar Logs Estructurados

```bash
# Logs del API en JSON
docker logs parallext-api --tail 5

# Buscar errores
docker logs parallext-api 2>&1 | grep '"level":50'
```

---

## Paso 11: Configurar GitHub Actions (CI/CD)

En el repositorio de GitHub, ve a Settings > Secrets and variables > Actions.

### Secrets de conexion al VPS

| Secret | Valor |
|--------|-------|
| `SERVER_HOST` | IP del servidor |
| `SERVER_USER` | root (o usuario SSH) |
| `SERVER_PASSWORD` | Password SSH |
| `SERVER_PORT` | 22 (o tu puerto SSH) |

### Secrets de la aplicacion

| Secret | Descripcion |
|--------|-------------|
| `DATABASE_URL` | `postgresql://parallext:PASSWORD@pgbouncer:5432/parallext_engine?pgbouncer=true` |
| `DATABASE_PASSWORD` | Password de PostgreSQL |
| `REDIS_HOST` | `redis` |
| `INTERNAL_JWT_SECRET` | Secret para JWT (generado con `openssl rand -base64 48`) |
| `JWT_REFRESH_SECRET` | Secret para refresh tokens (generado con `openssl rand -base64 48`) |
| `ENCRYPTION_KEY` | 64 hex chars para AES-256-GCM (`openssl rand -hex 32`) |
| `INTERNAL_API_KEY` | API key servicio-a-servicio (`openssl rand -base64 32`) |
| `META_APP_ID` | Facebook App ID |
| `META_APP_SECRET` | Facebook App Secret |
| `META_VERIFY_TOKEN` | Token de verificacion de webhooks |
| `META_CONFIG_ID` | Meta Config ID para Embedded Signup |
| `SYSTEM_USER_ID` | Meta Business System User ID |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_AI_KEY` | Google Gemini API key |
| `XAI_API_KEY` | xAI Grok API key |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Sign-In client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google Sign-In client secret |
| `SENTRY_DSN` | Sentry DSN |
| `SMTP_HOST` | SMTP server host |
| `SMTP_PORT` | SMTP port (587) |
| `SMTP_USER` | SMTP user/email |
| `SMTP_PASS` | SMTP password |
| `CLOUDFLARE_TUNNEL_TOKEN` | Token del Cloudflare Tunnel |
| `BULL_BOARD_TOKEN` | Token para acceder al dashboard de colas BullMQ |
| `GRAFANA_PASSWORD` | Password del admin de Grafana |

**IMPORTANTE**: El deploy workflow regenera el `.env` completo desde estos secrets en CADA deploy. Si agregas una variable manual al `.env` del VPS sin agregarla a GitHub Secrets, se perdera en el proximo deploy.

### Como funciona el deploy
Push a `main` > GitHub Actions > build 5 Docker images > push a GHCR > SSH al VPS > pull images > regenerar `.env` > migrate DB > recreate containers.

---

## Resumen de URLs

| Servicio | URL |
|----------|-----|
| Landing | `https://tu-dominio.com` |
| Dashboard | `https://admin.tu-dominio.com` |
| API | `https://api.tu-dominio.com` |
| WhatsApp | `https://wa.tu-dominio.com` |
| KB Portal | `https://admin.tu-dominio.com/kb/{tenant-slug}` |
| Bull Board | `https://api.tu-dominio.com/api/v1/admin/queues?token={TOKEN}` |
| Uptime Kuma | `https://status.tu-dominio.com` |
| Grafana | `https://grafana.tu-dominio.com` |
| Dozzle | `https://logs.tu-dominio.com` |
| BI API | `https://api.tu-dominio.com/api/v1/bi-api/` (X-API-Key header) |

---

## Resumen de Credenciales a Guardar

| Credencial | Donde esta | Proposito |
|------------|-----------|-----------|
| `.env` completo | Regenerado por GitHub Actions desde secrets | Todas las variables de entorno |
| Admin login | `admin@parallext.com` / `Parallext2026!` | Super admin del dashboard |
| JWT_REFRESH_SECRET | GitHub Secrets + `.env` | Firma de refresh tokens (session management) |
| BULL_BOARD_TOKEN | GitHub Secrets + `.env` | Acceso al dashboard de colas BullMQ |
| GRAFANA_PASSWORD | GitHub Secrets + `.env` | Login de Grafana admin |
| Uptime Kuma password | Creada manualmente al configurar | Monitoreo + alertas |
| GitHub Actions secrets | GitHub repo > Settings > Secrets | 25+ secrets que generan el `.env` en cada deploy |

**CRITICO**: El `.env` se regenera completamente en cada deploy desde GitHub Secrets. NUNCA agregar variables solo al `.env` del VPS — siempre agregarlas tambien a GitHub Secrets y al workflow `deploy.yml`.

---

## Troubleshooting

### Variables de entorno no se aplican
- Despues de editar `.env`, los containers NO releen automaticamente
- Para aplicar: `cd infra/docker && docker compose -f docker-compose.prod.yml up -d SERVICIO`
- `docker restart` relee el `.env` pero `docker compose up -d` es mas seguro porque recrea el container
- NUNCA el `.env` debe estar en git (esta en `.gitignore`). Verificar que no se pierda al hacer `git pull`

### Variables nuevas agregadas post-instalacion
El `.env` se regenera en cada deploy desde GitHub Secrets. Para agregar una variable nueva permanentemente:

```bash
# 1. Agregar a GitHub: repo > Settings > Secrets and variables > Actions > New secret
#    Nombre: PROD_MI_VARIABLE  /  Valor: el-valor

# 2. Agregar al workflow deploy.yml:
#    - En la seccion 'env' del step "Deploy to VPS": PROD_MI_VARIABLE: ${{ secrets.MI_VARIABLE }}
#    - En la seccion 'envs': agregar PROD_MI_VARIABLE a la lista
#    - En la seccion del script que genera .env: echo "MI_VARIABLE=${PROD_MI_VARIABLE}" >> .env

# 3. Para efecto inmediato sin esperar deploy:
echo "MI_VARIABLE=el-valor" >> /opt/parallext-engine/.env
cd /opt/parallext-engine/infra/docker
docker compose -f docker-compose.prod.yml up -d api

# 4. Verificar
docker exec parallext-api printenv | grep MI_VARIABLE
```

**IMPORTANTE**: Si solo editas el `.env` en el VPS sin agregar a GitHub Secrets, el proximo deploy lo sobreescribira y perdera la variable.

### Container no arranca
```bash
docker logs parallext-NOMBRE --tail 50
```

### Webhooks de Meta retornan 401
- Verificar que `META_APP_SECRET` esta en `.env`
- Verificar que la app tiene `rawBody: true` en NestJS

### Embedded Signup se queda pegado
- Los onboardings se auto-expiran a los 30 minutos
- Manual cleanup: `UPDATE whatsapp_onboardings SET status='FAILED', error_code='MANUAL', completed_at=NOW() WHERE tenant_id='...' AND status NOT IN ('COMPLETED','FAILED','CANCELLED');`

### Grafana no acepta password
```bash
docker exec parallext-grafana /usr/share/grafana/bin/grafana cli admin reset-admin-password NUEVA_PASSWORD --homepath /usr/share/grafana --config /etc/grafana/grafana.ini
```

### Loki no tiene datos
- Verificar que Promtail esta corriendo: `docker ps | grep promtail`
- Verificar labels: `curl -s http://127.0.0.1:3100/loki/api/v1/labels`
- Si no hay labels, Promtail no puede conectar a Loki. Verificar que estan en la misma red Docker.

### Bull Board da 404
- La URL correcta es `/api/v1/admin/queues` (NO `/admin/queues`)
- Incluir el token: `?token={BULL_BOARD_TOKEN}`

### Cloudflare Tunnel no enruta a un servicio
- El tunnel es **remote-managed** — la config se gestiona en Cloudflare dashboard (Zero Trust > Tunnels > Configure), NO en el archivo local `config.yml`
- Los hostnames del Service URL usan el **nombre del servicio** del docker-compose (ej: `grafana:3000`, `dashboard:3001`, `api:3000`), NO el `container_name`
- Despues de agregar un hostname, esperar 30-60 segundos

### Mensajes de nurturing no llegan
- Verificar que `channelAccountId` no esta vacio en Bull Board > outbound-messages/failed
- El fix esta en `nurturing.service.ts` > `resolveChannelCredentials()` que devuelve token + accountId
