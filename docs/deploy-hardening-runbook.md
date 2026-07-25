# Runbook de endurecimiento (Fase C) — acciones de infraestructura

> Estas son las acciones que se hacen **fuera del código**, en el dashboard de
> Cloudflare y en el VPS. El código que las acompaña ya está desplegado
> (throttling app-layer, flip SSH preparado). Fecha: 2026-07-21.
>
> **Contexto de arquitectura:** en producción el Cloudflare Tunnel rutea cada
> hostname **directo al contenedor** (`api:3000`, `dashboard:3000`, `grafana:3000`…).
> **No hay nginx en el camino** — la config de `infra/nginx/` no se aplica en prod.
> Por eso el rate-limit de borde y la protección de paneles van en Cloudflare.

---

## 1. Cloudflare Access — cerrar los paneles admin expuestos

El tunnel publica estos hostnames **sin ninguna auth de borde**:

| Hostname | Servicio | Riesgo actual |
|---|---|---|
| `logs.parallly-chat.cloud` | Dozzle | 🔴 **Visor de TODOS los logs, sin login** |
| `grafana.parallly-chat.cloud` | Grafana | 🟠 Password por defecto conocida |
| `status.parallly-chat.cloud` | Uptime Kuma | 🟡 Tiene login propio |

**Objetivo:** poner un gate de identidad (email OTP / Google / GitHub) en el borde,
**antes** de que la request llegue al contenedor. Así, aunque Dozzle no tenga auth
y Grafana tenga password débil, nadie entra sin pasar por Access.

Pasos (Cloudflare Zero Trust dashboard — `one.dash.cloudflare.com`):

1. **Settings → Authentication → Login methods**: agregá al menos un método.
   Lo más rápido: **One-time PIN** (envía un código al email, sin configurar IdP).
   Opcional: Google/GitHub OIDC si querés SSO.
2. **Access → Applications → Add an application → Self-hosted**.
   - **Application name:** `Grafana`
   - **Session Duration:** `24h` (o lo que prefieras)
   - **Application domain:** subdomain `grafana`, domain `parallly-chat.cloud`, path vacío (todo el host).
   - **Next → Add policy:**
     - Policy name: `Admins`
     - Action: **Allow**
     - Include → **Emails** → tu(s) correo(s) admin (o `Emails ending in @tudominio`).
   - Guardar.
3. **Repetir** el paso 2 para:
   - `logs` (Dozzle) ← el más urgente
   - `status` (Uptime Kuma)
4. Verificá: abrí `https://logs.parallly-chat.cloud` en incógnito → debe pedirte
   el código de Access antes de mostrar nada.

> Alternativa (más estricta, no elegida): sacar estos hostnames del `ingress` del
> tunnel (en `/opt/cloudflared/config.yml` del VPS / `infra/scripts/setup-vps.sh`)
> y acceder solo por `cloudflared access` o túnel SSH. Con Access alcanza para
> cerrar la exposición manteniendo el acceso remoto.

---

## 2. Rate-limiting en el borde (Cloudflare)

Complementa el throttling app-layer que ya está en el código (login, 2FA, OTP…).
Cloudflare cuenta por **IP real del cliente** de forma nativa.

Cloudflare dashboard → dominio `parallly-chat.cloud` → **Security → WAF → Rate limiting rules**.

> Nota de plan: en el plan **Free** hay una sola regla de rate-limiting. Si estás
> en Free, priorizá la regla de **login**. En Pro/Business podés crear las tres.

**Regla 1 — Login brute-force (prioridad máxima):**
- When incoming requests match:
  - `Hostname` equals `api.parallly-chat.cloud` **AND**
  - `URI Path` equals `/api/v1/auth/login`
- Rate: **10** requests per **1 minute**, con **misma IP**.
- Then: **Block** (o **Managed Challenge**) por **10 minutos**.

**Regla 2 — Endpoints sensibles de auth (si tu plan permite más reglas):**
- `Hostname` equals `api.parallly-chat.cloud` **AND**
  `URI Path` is in `{ /api/v1/auth/forgot-password, /api/v1/auth/reset-password, /api/v1/auth/2fa/verify, /api/v1/auth/signup }`
- Rate: **20** per **1 minute** por IP → **Managed Challenge**.

**Regla 3 — API general (opcional, protección amplia):**
- `Hostname` equals `api.parallly-chat.cloud`
- Rate: **300** per **1 minute** por IP → **Managed Challenge**.
- ⚠️ **Excluí los webhooks** para no cortar ráfagas legítimas de Meta/MercadoPago:
  agregá `AND URI Path does not contain "/webhook"` (cubre `/billing/webhook/*` y
  el webhook de WhatsApp). O subiles el límite a 600/min en una regla aparte.

---

## 3. Migrar el deploy a key SSH dedicada

Hoy el deploy entra al VPS con **contraseña** (`SERVER_PASSWORD`). El `deploy.yml`
**ya está preparado**: usa `key` si existe el secret `SERVER_SSH_KEY`, y si no,
cae a `password`. Así el cambio es sin corte.

1. **Generá una key dedicada** (en tu máquina, no en el VPS):
   ```bash
   ssh-keygen -t ed25519 -C "github-deploy-parallext" -f deploy_key -N ""
   # genera deploy_key (privada) y deploy_key.pub (pública)
   ```
2. **Instalá la pública en el VPS** (con el usuario de deploy = `SERVER_USER`):
   ```bash
   # en el VPS:
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   echo "CONTENIDO_DE_deploy_key.pub" >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```
3. **Cargá la privada como secret** (esto activa key auth en el próximo deploy):
   ```bash
   gh secret set SERVER_SSH_KEY < deploy_key
   ```
4. **Dispará un deploy** (push chico o re-run) y confirmá que el job `deploy`
   sigue en verde → ya está usando key auth.
5. **Endurecé** (una vez confirmado):
   - Quitá la línea `password: ${{ secrets.SERVER_PASSWORD }}` de `deploy.yml`.
   - En el VPS: `sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && sudo systemctl reload ssh`
     (⚠️ asegurate de tener otro acceso por key antes de deshabilitar password).
   - Rotá `SERVER_PASSWORD` y borrá el archivo local `deploy_key`.

> La clave privada viaja **una sola vez** al secret de GitHub. Nunca la pegues en
> chat ni la comitees.

---

## 4. Grafana — asegurar password fuerte en la instancia viva

El secret `GRAFANA_PASSWORD` **ya existe** y el deploy lo escribe al `.env`, pero
Grafana solo aplica `GF_SECURITY_ADMIN_PASSWORD` en la **primera** creación del
admin. Si el volumen se creó antes con el default, la instancia viva puede seguir
con `parallly-grafana-2026`. Reseteala al valor del secret (que ya está en el
`.env` del VPS):

```bash
# en el VPS:
docker exec parallext-grafana grafana-cli admin reset-admin-password \
  "$(grep -E '^GRAFANA_PASSWORD=' /opt/parallext-engine/.env | cut -d= -f2-)"
```

Verificá el login en `https://grafana.parallly-chat.cloud` (ahora además detrás de
Cloudflare Access del paso 1). Si `GRAFANA_PASSWORD` estuviera vacío en el `.env`,
primero seteá un valor fuerte: `gh secret set GRAFANA_PASSWORD` y redeploy.

---

## Estado del código (ya desplegado con este runbook)

- **Throttling app-layer** (`AuthThrottleGuard`): ahora llavea por `CF-Connecting-IP`
  (antes usaba `X-Forwarded-For[0]`, **falsificable** detrás de Cloudflare → se
  podía saltar el límite). Cobertura ampliada a `exchange-code` y a los endpoints
  OTP del customer-portal (`request-access` 10/h, `verify` 10/15min).
- **`deploy.yml`**: `key` SSH preparado (fallback a password hasta que exista el secret).

---

## 5. Rollback por SHA (jul 2026)

`docker-compose.prod.yml` ya no fija `:latest`: cada servicio de app usa
`image: ghcr.io/nipko/parallext-<svc>:${IMAGE_TAG:-latest}`, y el deploy escribe
`IMAGE_TAG=<commit sha>` en el `.env`. Las imágenes se publican con tag `:latest`
**y** `:<sha>`, así que volver atrás no requiere reconstruir nada.

```bash
# en el VPS — volver al commit anterior (sin rebuild ni pipeline):
cd /opt/parallext-engine
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=<sha-anterior>/" .env
docker compose --env-file .env -f infra/docker/docker-compose.prod.yml \
  up -d --no-deps api worker dashboard whatsapp landing
```

Avisos:

- **El rollback de código NO deshace una migración.** Si el deploy fallido migró
  el schema, restaurá primero el dump de `/backup/pre-deploy/` (ver
  `backup-restore-runbook.md`). Por eso el dump previo a migrar ahora **aborta el
  deploy si falla** en vez de solo advertir.
- `docker image prune --filter "until=24h"` corre al final de cada deploy: las
  imágenes de menos de 24h sobreviven, así que el rollback same-day es seguro.
  Para volver a algo más viejo, `docker pull ghcr.io/nipko/parallext-api:<sha>`.

---

## 6. Regla de migraciones: expand-contract (obligatoria)

El deploy corre **las migraciones antes** de recrear los contenedores (a
propósito: si fallan, aborta y quedan corriendo los contenedores viejos, que
siguen funcionando). La consecuencia es que **el código viejo convive varios
minutos con el schema nuevo** — el bucle por tenant y los seeds tardan.

Por eso toda migración debe ser **aditiva respecto al código desplegado**:

| Permitido en un solo deploy | Prohibido en un solo deploy |
|---|---|
| `ADD COLUMN` nullable o con default | `DROP COLUMN` de una columna que el código vivo lee |
| `CREATE TABLE` / `CREATE INDEX` | `RENAME COLUMN` / `RENAME TABLE` |
| Ampliar un tipo (`VARCHAR(50)`→`VARCHAR(255)`) | Estrechar un tipo o agregar `NOT NULL` sin default |
| Backfill idempotente | `DROP TABLE` en uso |

Un rename o un drop se hace en **dos deploys**: (1) agregar lo nuevo y escribir
en ambos lados; (2) una vez que ningún contenedor lee lo viejo, eliminarlo.

Precedente real en el repo: `tenant-schema.sql` llegó a traer `RENAME` condicionales
y un `DROP COLUMN` sobre `automation_rules`. Sobrevivieron por suerte (tablas
poco usadas); sobre una tabla caliente como `messages` habrían roto la plataforma
durante toda la ventana.
