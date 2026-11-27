# Ambiente provisional en el Mac mini

**Estado:** vigente mientras no exista el ambiente de AWS (ver `docs/research/2026-11-23/`). Se retira cuando AWS reciba tráfico.
**Fuente de verdad en código:** `infra/docker/docker-compose.mac.yml`, `infra/scripts/mac/`.

El VPS se retiró el 2026-11-24 sin migrar datos. Mientras se monta AWS, la plataforma completa corre en un Mac mini (Apple Silicon) detrás de Cloudflare Tunnel, para pruebas y para que los dominios públicos respondan. **No es producción:** internet y energía de una casa, sin réplica y sin copia fuera del equipo. No conectes clientes reales sin activar antes el respaldo diario (`infra/backup/`, destino R2).

## Qué corre

`docker-compose.mac.yml` tiene los mismos servicios que `docker-compose.prod.yml` sin la pila de observabilidad (dozzle, uptime-kuma, grafana, loki, promtail). Los errores siguen yendo a Sentry si `SENTRY_DSN` está puesto.

| Servicio | Hostname público |
|---|---|
| landing | `parallly-chat.cloud`, `www.parallly-chat.cloud` |
| dashboard | `admin.parallly-chat.cloud` |
| api | `api.parallly-chat.cloud` |
| whatsapp | `wa.parallly-chat.cloud` |
| worker, postgres, pgbouncer, redis, tunnel | sin hostname |

Diferencias con el compose de producción, todas a propósito:

- Las imágenes **se construyen en el Mac** (`parallext-*:local`). Las de ghcr.io son amd64 y correrían emuladas en arm64.
- Los Dockerfiles de API y worker se construyen con `BUILD_NODE_OPTIONS=--max-old-space-size=6144`: en la VM de Colima (10 GB) V8 se queda en ~2 GB de heap y `nest build` muere con 137. En CI el argumento va vacío.
- PgBouncer usa `AUTH_TYPE=scram-sha-256`: un PostgreSQL 16 nuevo guarda las contraseñas en scram y con md5 falla con `wrong password type`.
- Los volúmenes se llaman `parallly-mac-*`, el proyecto de compose es `parallly` y ningún servicio publica puertos en el host.

## Instalación

Requisitos en el Mac: Docker (Colima o Docker Desktop), `git`, `cloudflared` (Homebrew), suspensión desactivada y `autorestart` activo (`pmset -g`).

```bash
git clone https://github.com/Nipko/sales-structure.git ~/parallly && cd ~/parallly
infra/scripts/mac/generate-env.sh       # genera los secretos internos; nunca sobrescribe un .env
# editar .env: al menos una clave de LLM (OpenAI también da los embeddings)
for s in api worker whatsapp dashboard landing; do infra/scripts/mac/dc.sh build $s; done   # de a una: en paralelo se queda sin memoria
infra/scripts/mac/dc.sh up -d postgres redis pgbouncer
infra/scripts/mac/dc.sh run --rm api npx prisma migrate deploy --schema=prisma/schema.prisma
infra/scripts/mac/dc.sh run --rm api npm run migrate:tenants
infra/scripts/mac/dc.sh run --rm api node prisma/seed-billing-plans.js
infra/scripts/mac/dc.sh up -d
```

El `.env` vive solo en el Mac. Respalda `ENCRYPTION_KEY` fuera del equipo: sin ella no se descifran los tokens de canal ni las credenciales de los tenants.

Usuario super_admin (lo crea el dueño, con su propia contraseña):

```bash
infra/scripts/mac/dc.sh run --rm -e ADMIN_EMAIL=<correo> -e ADMIN_PASSWORD='<12+ caracteres>' api npx ts-node prisma/seed-admin.ts
```

## Túnel

El túnel es *locally managed*: la configuración vive en `~/.cloudflared-parallly/` (montado en el contenedor `tunnel`), separada de `~/.cloudflared/`, que puede pertenecer a otra cuenta de Cloudflare.

```
~/.cloudflared-parallly/
  cert.pem            # de `cloudflared tunnel login` en la cuenta de parallly-chat.cloud
  <tunnel-id>.json    # credenciales del túnel
  config.yml
```

`config.yml`:

```yaml
tunnel: <tunnel-id>
credentials-file: /etc/cloudflared/<tunnel-id>.json
ingress:
  - hostname: parallly-chat.cloud
    service: http://landing:80
  - hostname: www.parallly-chat.cloud
    service: http://landing:80
  - hostname: admin.parallly-chat.cloud
    service: http://dashboard:3001
  - hostname: api.parallly-chat.cloud
    service: http://api:3000
  - hostname: wa.parallly-chat.cloud
    service: http://whatsapp:3002
  - service: http_status:404
```

Si los registros DNS ya apuntan a un túnel existente, basta con generar sus credenciales (`cloudflared --origincert ~/.cloudflared-parallly/cert.pem tunnel token --cred-file ~/.cloudflared-parallly/<id>.json <nombre>`). Con un túnel nuevo hay que apuntar cada hostname con `tunnel route dns --overwrite-dns`.

## Actualizar

```bash
cd ~/parallly && git pull
for s in api worker whatsapp dashboard landing; do infra/scripts/mac/dc.sh build $s; done
infra/scripts/mac/dc.sh run --rm api npx prisma migrate deploy --schema=prisma/schema.prisma
infra/scripts/mac/dc.sh run --rm api npm run migrate:tenants
infra/scripts/mac/dc.sh up -d
```

Las migraciones van antes de recrear contenedores, igual que en `deploy.yml`. El flujo de GitHub Actions no despliega aquí.

## Pendientes conocidos

- Colima no arranca solo después de reiniciar el Mac. Hasta configurarlo (`brew services start colima`), un reinicio deja la plataforma abajo.
- Sin respaldo fuera del equipo hasta configurar `infra/backup/` con R2.
