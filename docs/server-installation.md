# Parallly — Guia de Instalacion en Servidor Nuevo

> Version jul-2026 | Guia de referencia para levantar la plataforma desde un VPS Ubuntu en blanco.
> Consolida el antiguo `installation-manual.md` (troubleshooting, monitoreo, backups) en un solo documento.

## Requisitos del Servidor

- **OS**: Ubuntu 22.04+ (LTS)
- **RAM**: 8GB minimo (4GB app + 700MB observabilidad + margen)
- **CPU**: 2 nucleos minimo
- **Disco**: 40GB+ SSD
- **Docker**: Docker Engine 24+ con Docker Compose v2
- **Acceso**: Root o usuario con sudo

## Cuentas Externas Necesarias

Antes de empezar, necesitas tener configuradas estas cuentas. Solo Cloudflare, Meta,
GitHub y ≥1 LLM son obligatorias para arrancar; el resto habilita features concretas
(billing, facturacion electronica, alertas, CRM externo, push, backups offsite).

| Servicio | Requerido | Que necesitas | Donde obtenerlo |
|----------|-----------|--------------|-----------------|
| **Cloudflare** | Si | Cuenta + dominio + Tunnel token | dash.cloudflare.com |
| **Meta Developer** | Si | App ID, App Secret, Config ID, Business ID, Solution ID, Verify Token, System User ID | developers.facebook.com |
| **GitHub** | Si | PAT para GHCR (o el GITHUB_TOKEN de Actions) | github.com/settings/tokens |
| **LLM (OpenAI/Anthropic/Gemini/xAI/DeepSeek)** | Si (≥1) | Al menos 1 API key | platform.openai.com / console.anthropic.com / … |
| **Instagram / Messenger** | Opcional | App ID + App Secret + Config ID (misma app Meta) | developers.facebook.com |
| **Google OAuth + Calendar** | Opcional | Client ID + Secret (login + sync de calendario) | console.cloud.google.com |
| **Microsoft OAuth + Calendar** | Opcional | Client ID + Secret (login + Outlook Calendar) | portal.azure.com |
| **Wompi** | Si para suscripciones pagadas | Public/Private key, Events secret, Integrity secret, webhook | comercios.wompi.co |
| **Wompi/Mercado Pago por tenant** | Opcional (cobros tenant→cliente) | Cada tenant conecta sus propias llaves Wompi o credenciales Mercado Pago en el panel; no son secretos de plataforma | comercios.wompi.co / mercadopago.com.co/developers |
| **Factus (DIAN Colombia)** | Opcional (factura electronica) | Base URL, Client ID/Secret, Username/Password | factus.com.co |
| **Twilio** | Opcional (alertas + SMS creditos) | Account SID, Auth Token, numero/sender | twilio.com |
| **S3-compatible (Cloudflare R2 / Backblaze B2 / AWS S3)** | Opcional (backups offsite) | Bucket, endpoint, access/secret key | dash.cloudflare.com (R2) / backblaze.com |
| **HubSpot / Pipedrive** | Opcional (CRM externo) | OAuth Client ID + Secret | developers.hubspot.com / pipedrive.com |
| **Sentry** | Opcional | DSN + Auth Token/Org/Project (source maps) | sentry.io |
| **SMTP** | Opcional | Host, user, password (emails) | Tu proveedor de email |
| **VAPID (Web Push)** | Opcional | Par de llaves publica/privada (`npx web-push generate-vapid-keys`) | genera localmente |

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
REDIS_PASSWORD=$(openssl rand -hex 24)
BULL_BOARD_TOKEN=$(openssl rand -hex 32)
GRAFANA_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
META_VERIFY_TOKEN=$(openssl rand -hex 32)

cat > .env << EOF
# ============================================
# Parallly — Production Configuration
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# ============================================
# NOTA: este es el conjunto COMPLETO de variables que el deploy
# (.github/workflows/deploy.yml) regenera en cada push. En produccion NO se
# edita a mano: la fuente de verdad son los GitHub Secrets (ver Paso 11). Los
# valores CAMBIAR son placeholders — dejalos vacios si no usas esa integracion.

# ---- General ----
NODE_ENV=production
LOG_LEVEL=info

# ---- Database (via PgBouncer, transaction mode) ----
DB_PASSWORD=${DB_PASSWORD}
DATABASE_URL=postgresql://parallext:\${DB_PASSWORD}@pgbouncer:6432/parallext_engine
DIRECT_DATABASE_URL=postgresql://parallext:\${DB_PASSWORD}@postgres:5432/parallext_engine
# docker-compose.prod.yml fija el puerto interno efectivo de PgBouncer (5432)
# para api/worker/whatsapp via 'environment:' (precede a env_file).

# ---- Redis (noeviction; password requerido en prod) ----
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=${REDIS_PASSWORD}

# ---- JWT Auth (los 3 secrets deben diferir) ----
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
INTERNAL_JWT_SECRET=${INTERNAL_JWT_SECRET}

# ---- Encryption (AES-256-GCM, 64 hex) ----
ENCRYPTION_KEY=${ENCRYPTION_KEY}
# Opcional: keyring dedicado para credenciales Wompi/MP de tenants. Si no se
# define, usa ENCRYPTION_KEY con el key id "primary".
# TENANT_PAYMENT_CREDENTIAL_KEY=<64-hex>
# TENANT_PAYMENT_CREDENTIAL_KEY_ID=payments-2026-08
# TENANT_PAYMENT_CREDENTIAL_PREVIOUS_KEYS={"payments-previous":"<64-hex>"}

# ---- Internal Service Auth ----
INTERNAL_API_KEY=${INTERNAL_API_KEY}

# ---- Meta / WhatsApp ----
META_APP_ID=CAMBIAR
META_APP_SECRET=CAMBIAR
META_CONFIG_ID=CAMBIAR
META_VERIFY_TOKEN=${META_VERIFY_TOKEN}
WHATSAPP_VERIFY_TOKEN=${META_VERIFY_TOKEN}
SYSTEM_USER_ID=CAMBIAR

# ---- Messenger OAuth ----
MESSENGER_FB_LOGIN_CONFIG_ID=CAMBIAR
MESSENGER_REDIRECT_URI=https://admin.TU-DOMINIO.com/admin/channels/messenger

# ---- Instagram OAuth ----
INSTAGRAM_APP_ID=CAMBIAR
INSTAGRAM_APP_SECRET=CAMBIAR
INSTAGRAM_REDIRECT_URI=https://admin.TU-DOMINIO.com/admin/channels/instagram/callback

# ---- AI Providers (al menos 1 requerido) ----
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
XAI_API_KEY=
DEEPSEEK_API_KEY=

# ---- Google OAuth + Calendar ----
GOOGLE_OAUTH_CLIENT_ID=CAMBIAR
GOOGLE_OAUTH_CLIENT_SECRET=CAMBIAR
GOOGLE_CALENDAR_REDIRECT_URI=https://api.TU-DOMINIO.com/api/v1/calendar/google/callback

# ---- Microsoft OAuth + Calendar (misma app) ----
MS_AUTH_CLIENT_ID=CAMBIAR
MS_AUTH_CLIENT_SECRET=CAMBIAR
MS_AUTH_REDIRECT_URI=https://api.TU-DOMINIO.com/api/v1/auth/microsoft/callback
MS_CLIENT_ID=CAMBIAR
MS_CLIENT_SECRET=CAMBIAR
MS_TENANT_ID=common
MS_CALENDAR_REDIRECT_URI=https://api.TU-DOMINIO.com/api/v1/calendar/microsoft/callback

# ---- Sentry ----
SENTRY_DSN=CAMBIAR
SENTRY_AUTH_TOKEN=CAMBIAR
SENTRY_ORG=CAMBIAR
SENTRY_PROJECT=CAMBIAR
SENTRY_API_URL=

# ---- SMTP (email) ----
SMTP_HOST=CAMBIAR
SMTP_PORT=587
SMTP_USER=CAMBIAR
SMTP_PASS=CAMBIAR
SMTP_FROM=Parallly <no-reply@parallly-chat.cloud>
# Solo para el adaptador Email inbound administrado (JSON autenticado; no
# multipart directo del proveedor). Generar con `openssl rand -hex 32`; si
# queda vacio, el endpoint responde 503.
EMAIL_INBOUND_WEBHOOK_SECRET=CAMBIAR
EMAIL_INBOUND_WEBHOOK_HEADER=x-email-webhook-secret
EMAIL_INBOUND_MAX_BODY_BYTES=1048576
EMAIL_INBOUND_RATE_LIMIT_PER_MINUTE=600
EMAIL_INBOUND_RECIPIENT_RATE_LIMIT_PER_MINUTE=120

# ---- Frontend / App URLs ----
NEXT_PUBLIC_API_URL=https://api.TU-DOMINIO.com/api/v1
NEXT_PUBLIC_WA_SERVICE_URL=https://wa.TU-DOMINIO.com/api/v1
NEXT_PUBLIC_META_APP_ID=CAMBIAR
NEXT_PUBLIC_META_CONFIG_ID=CAMBIAR
DASHBOARD_URL=https://admin.TU-DOMINIO.com
NEXT_PUBLIC_DASHBOARD_URL=https://admin.TU-DOMINIO.com
API_URL=https://api.TU-DOMINIO.com
API_PUBLIC_URL=https://api.TU-DOMINIO.com/api/v1

# ---- Media / embeddings ----
MEDIA_STORAGE_PATH=/data/media
BODY_SIZE_LIMIT=50mb
EMAIL_LOGO_URL=https://TU-DOMINIO.com/parallly-logo.svg
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536

# ---- Wompi (suscripciones plataforma → tenant) ----
# Las cuatro llaves deben pertenecer al mismo ambiente. El prefijo test/prod
# selecciona sandbox o producción; no existe un flag de ambiente separado.
WOMPI_PUBLIC_KEY=CAMBIAR
WOMPI_PRIVATE_KEY=CAMBIAR
WOMPI_EVENTS_SECRET=CAMBIAR
WOMPI_INTEGRITY_SECRET=CAMBIAR
# Límites contractuales en centavos COP. El motor falla cerrado si falta el
# límite por transacción y difiere cobros al alcanzar el tope diario.
WOMPI_MAX_TRANSACTION_COP_CENTS=CAMBIAR
WOMPI_DAILY_CAP_COP_CENTS=CAMBIAR
WOMPI_MERCHANT_TIMEZONE=America/Bogota
# Solo staging aislado; producción real debe dejarlo false.
WOMPI_ALLOW_SANDBOX_IN_PRODUCTION=false
WOMPI_WEBHOOK_URL=https://api.TU-DOMINIO.com/api/v1/billing/webhook/wompi

# Los proveedores tenant→cliente no tienen credenciales globales: cada tenant
# configura su cuenta Wompi o Mercado Pago en Configuración → Integraciones →
# Pagos. Nunca se reutilizan para pagar una suscripción de Parallly.

# ---- Factus (DIAN — factura electronica Colombia) ----
FACTUS_BASE_URL=https://api-sandbox.factus.com.co
FACTUS_CLIENT_ID=CAMBIAR
FACTUS_CLIENT_SECRET=CAMBIAR
FACTUS_USERNAME=CAMBIAR
FACTUS_PASSWORD=CAMBIAR
# Retencion legal 5 anios (XML+PDF) en el volumen parallext-fiscal-data
FISCAL_STORAGE_PATH=/data/invoices

# ---- SMS platform alerts (Twilio) ----
SMS_ALERT_ACCOUNT_SID=CAMBIAR
SMS_ALERT_AUTH_TOKEN=CAMBIAR
SMS_ALERT_FROM=CAMBIAR
SMS_ALERT_TO=CAMBIAR
SMS_SENDER_ID=CAMBIAR

# ---- Telegram platform alerts (Ops Center) ----
TELEGRAM_ALERT_BOT_TOKEN=CAMBIAR
TELEGRAM_ALERT_CHAT_ID=CAMBIAR

# ---- External CRM integrations ----
HUBSPOT_CLIENT_ID=CAMBIAR
HUBSPOT_CLIENT_SECRET=CAMBIAR
PIPEDRIVE_CLIENT_ID=CAMBIAR
PIPEDRIVE_CLIENT_SECRET=CAMBIAR

# ---- VAPID (Web Push) ----
VAPID_PUBLIC_KEY=CAMBIAR
VAPID_PRIVATE_KEY=CAMBIAR

# ---- Offsite backups (S3-compatible via rclone; vacio = solo local) ----
OFFSITE_BUCKET=
OFFSITE_PATH=parallext
OFFSITE_PROVIDER=AWS
OFFSITE_REGION=us-east-1
OFFSITE_ENDPOINT=
OFFSITE_ACCESS_KEY=
OFFSITE_SECRET_KEY=

# ---- Cloudflare Tunnel ----
CLOUDFLARE_TUNNEL_TOKEN=CAMBIAR

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
| `TENANT_PAYMENT_CREDENTIAL_KEY` | Opcional: clave AES-256-GCM dedicada (64 hex) para credenciales de cobro de tenants; si falta usa `ENCRYPTION_KEY` |
| `TENANT_PAYMENT_CREDENTIAL_KEY_ID` | Identificador no secreto de la clave vigente; por defecto `primary` |
| `TENANT_PAYMENT_CREDENTIAL_PREVIOUS_KEYS` | JSON opcional `keyId → clave 64-hex` durante una rotación; retirar sólo después del rewrap |
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
| `EMAIL_INBOUND_WEBHOOK_SECRET` | Secret de al menos 32 caracteres para autenticar el ingreso administrado de Email; obligatorio para habilitarlo |
| `EMAIL_INBOUND_WEBHOOK_HEADER` | Header que debe inyectar el proveedor/proxy administrado (por defecto `x-email-webhook-secret`) |
| `CLOUDFLARE_TUNNEL_TOKEN` | Token del Cloudflare Tunnel |
| `BULL_BOARD_TOKEN` | Token para acceder al dashboard de colas BullMQ |
| `GRAFANA_PASSWORD` | Password del admin de Grafana |

**IMPORTANTE**: El deploy workflow regenera el `.env` completo desde estos secrets en CADA deploy. Si agregas una variable manual al `.env` del VPS sin agregarla a GitHub Secrets, se perdera en el proximo deploy.

El endpoint administrado `POST /api/v1/channels/email/inbound` acepta únicamente
`Content-Type: application/json`. El adaptador o reverse proxy confiable debe
convertir el evento del proveedor, inyectar el header secreto y enviar un
`envelope.to` con **exactamente un destinatario SMTP canónico**. El campo visible
`to` no se usa para resolver el tenant y un envelope con varios destinatarios se
rechaza para impedir cruces por CC/BCC. Los eventos multipart directos de
SendGrid Inbound Parse u otros proveedores responden `415`.

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
