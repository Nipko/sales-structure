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
