# Staging: qué está construido, qué falta y cómo se corre

> **Staging no existe todavía.** Lo que existe es el código: el workflow, las
> guardas y los scripts, con sus pruebas. Nada de esto corrió nunca contra un
> host. Mientras eso siga así, la frase honesta es «staging está preparado», no
> «staging está listo», y ninguna evidencia de este documento describe una
> corrida real.

## Por qué

Todo lo que este repositorio desplegó fue de una suite verde a producción. La
primera vez que una migración, un orden de contenedores o un adaptador de canal
se encontró con un host de verdad fue la vez que importaba. Staging es el lugar
donde equivocarse antes.

## Las tres reglas que dan forma a todo

1. **No corre solo.** `workflow_dispatch` únicamente, con confirmación escrita a
   mano y un `image_tag` que tiene que ser un SHA. Un deploy de staging que se
   dispara con un push está a un merge equivocado de ser un deploy sin revisar.
2. **No comparte nada con producción.** El primer job compara los secretos de
   staging contra *digests salados* de los de producción y aborta si coinciden,
   si aparece un host de producción o si el nombre de la base es el de
   producción. Un staging que comparte el `JWT_SECRET` **es** producción: una
   sesión emitida acá vale allá.
3. **Sus datos son sintéticos.** `STAGING_SEED_SOURCE` tiene que decir
   `synthetic`; la guarda rechaza cualquier otra cosa. Copiar la base de
   producción a un ambiente inferior mueve mensajes, teléfonos y registros de
   pago de personas reales a un lugar con menos control de acceso, y eso no es
   algo que un input de workflow pueda autorizar.

## Lo que falta de afuera (ninguna es código)

| Falta | Quién la da | Sin ella |
|---|---|---|
| Un host separado (VPS o equivalente) con Docker | dueño | el job `deploy` aborta con `STAGING_SERVER_HOST is not set` |
| PostgreSQL, PgBouncer y Valkey propios en ese host | dueño | no hay dónde migrar |
| Un túnel Cloudflare propio y dos hostnames de staging | dueño | el dashboard y el widget no son alcanzables |
| Los 16 secretos/variables de la tabla siguiente | dueño | la guarda de aislamiento aborta nombrando cada uno |
| El bloque `PRODUCTION_SECRET_DIGESTS` y su sal | dueño | la comparación contra producción no corre, y **eso también aborta** |

## El contrato de variables

Nombres exactos. Faltar es abortar: **nunca** hay fallback a un valor de
producción, porque el fallback es justamente cómo los dos ambientes terminan
compartiendo un valor.

### Secretos de repositorio (Settings → Secrets → Actions)

| Nombre | Qué es | Chequeo que se le hace |
|---|---|---|
| `STAGING_SERVER_HOST` | host del VPS de staging | no puede ser un host de producción |
| `STAGING_SERVER_USER` | usuario SSH | presencia |
| `STAGING_SERVER_PORT` | puerto SSH (opcional, default 22) | — |
| `STAGING_SERVER_SSH_KEY` | clave privada de deploy propia | distinta de la de producción |
| `STAGING_DATABASE_URL` | cadena vía PgBouncer de staging | host, nombre de base y valor distintos |
| `STAGING_DIRECT_DATABASE_URL` | cadena directa (migraciones) | ídem |
| `STAGING_DATABASE_PASSWORD` | clave de PostgreSQL de staging | distinta |
| `STAGING_REDIS_HOST` | Valkey de staging | no puede ser un host de producción |
| `STAGING_REDIS_PASSWORD` | clave de Valkey de staging | distinta |
| `STAGING_JWT_SECRET` | firma de sesión | distinta |
| `STAGING_JWT_REFRESH_SECRET` | firma de refresh | distinta |
| `STAGING_INTERNAL_JWT_SECRET` | servicio a servicio | distinta |
| `STAGING_INTERNAL_API_KEY` | endpoint interno | distinta |
| `STAGING_ENCRYPTION_KEY` | 64 hex, AES-256-GCM | distinta |
| `STAGING_CLOUDFLARE_TUNNEL_TOKEN` | túnel propio | distinto |
| `PRODUCTION_SECRET_DIGESTS` | digests salados de los secretos de producción | ver abajo |
| `STAGING_ISOLATION_DIGEST_SALT` | la sal con la que se generaron | sin ella con digests presentes, **exit 2** |

### Variables de repositorio (no secretas)

| Nombre | Valor |
|---|---|
| `STAGING_PUBLIC_API_URL` | `https://api.<tu-dominio-de-staging>/api/v1` |
| `STAGING_PUBLIC_DASHBOARD_URL` | `https://admin.<tu-dominio-de-staging>` |
| `STAGING_SEED_SOURCE` | `synthetic` (cualquier otro valor aborta) |
| `PRODUCTION_HOSTS` | opcional: IPs/hosts extra de producción a rechazar |

### Generar el bloque de digests

Una sola vez, **en tu máquina**, con los valores de producción ya en el shell.
Nunca en CI:

```bash
export STAGING_ISOLATION_DIGEST_SALT="$(openssl rand -hex 24)"
node apps/api/scripts/print-production-secret-digests.cjs > /tmp/digests.txt
```

Pegá `/tmp/digests.txt` en `PRODUCTION_SECRET_DIGESTS` y la sal en
`STAGING_ISOLATION_DIGEST_SALT`. El script imprime **sólo** digests; los nombres
de lo que faltó van a stderr. Regenerá el bloque cada vez que rotes un secreto
de producción.

## El orden, y dónde aborta

El deploy de staging repite el orden de producción a propósito: una corrida cuya
secuencia difiere prueba la secuencia que corrió, no la que se despliega.

| # | Paso | Aborta si |
|---:|---|---|
| 1 | Confirmación escrita | no dice `staging` |
| 2 | `image_tag` es un SHA | es `latest` o cualquier etiqueta móvil |
| 3 | **Guarda de aislamiento** | falta una variable, comparte un valor con producción, nombra un host de producción, el nombre de la base es el de producción, o `STAGING_SEED_SOURCE` no es `synthetic` |
| 4 | Host configurado | `STAGING_SERVER_HOST` vacío (**error**, no skip) |
| 5 | Registrar la imagen que está sirviendo | — (avisa si no hay: primer deploy sin rollback) |
| 6 | Pull de imágenes del SHA | la imagen no existe |
| 7 | Generar `.env` de staging | — |
| 8 | Postgres/PgBouncer/Valkey sanos | postgres no responde en 60s |
| 9 | **Backup previo** | el dump falla → no se migra |
| 10 | **Preflight de términos huérfanos** | exit ≠ 0, o la línea resumen no dice `blocks=0` |
| 11 | Migración `public` | Prisma falla |
| 12 | Migración de schemas de tenant | no imprime `MIGRATE_TENANTS_SUMMARY` |
| 13 | Recrear contenedores | — |
| 14 | Salud de la API | no responde en 3 min |
| 15 | Semilla sintética `--reset` | el target no es demostrablemente staging (**exit 2**) |
| 16 | Salud de las cuatro superficies | cualquiera no responde |
| 17 | Smoke API/dashboard/widget/WhatsApp | cualquier chequeo falla |
| 18 | Recorrido de publicación y rollback | cualquier paso falla |
| 19 | Piloto de outbox **ON** (1 tenant sintético, `web_widget`) | el alcance no es exactamente ese tenant y ese canal |
| 20 | Smoke con despacho durable | el piloto no está activo o su alcance creció |
| 21 | Métricas y logs sin PII | — |
| 22 | Piloto de outbox **OFF** | corre con `always()`: también después de un fallo |
| 23 | Rollback | sólo si 4–22 fallaron, o si se pidió `action: rollback` |

Los pasos 9 y 10 son el ensayo que más justifica staging: es el mismo control
que produce corre, en la misma posición, y acá se puede ver fallar sin que le
cueste a nadie.

## Correrlo

```
Actions → "Staging (manual)" → Run workflow
  action:     deploy
  image_tag:  <SHA de 7-40 hex ya construido y publicado en GHCR>
  confirm:    staging
```

Volver atrás a mano:

```
  action:     rollback
  image_tag:  <SHA anterior>
  confirm:    staging
```

El rollback mueve **imágenes, no schema**. Las migraciones son aditivas por
contrato, así que el código anterior corre contra el schema nuevo; revertir el
schema rompería esa propiedad en vez de restaurarla.

## Qué evidencia queda

| Artefacto | Qué dice |
|---|---|
| `staging-isolation.json` | cada variable revisada y por qué pasó o falló (nunca su valor) |
| `staging-seed.json` | los tenants sintéticos creados y cuántas sentencias DDL se aplicaron |
| `health-api.json`, `health-whatsapp.json` | el reporte detallado de dependencias |
| `staging-smoke.json` | los seis chequeos de superficie, uno por línea |
| `staging-publication.json` | los siete pasos del recorrido de publicación y rollback |
| `staging-dispatch-pilot.json` | el alcance exacto con el que se encendió el outbox |
| `metrics-after.json` | contadores después de la corrida |
| `staging-logs.txt` | 400 líneas de API y worker, con correos y teléfonos reemplazados |

El criterio de éxito del rollback no es el exit code de un `docker compose up`:
es que `docker inspect parallext-api` reporte la etiqueta pedida **y** que la API
responda. Cualquier otra cosa es un error explícito.

## Lo que un ensayo en staging todavía NO prueba

Decirlo importa tanto como el resto.

- **Nada sobre el modelo.** No hay credencial de proveedor en staging. La
  evidencia de evaluación del recorrido de publicación es sintética y no
  certifica calidad de agente.
- **Nada sobre un canal real.** No hay app de Meta, ni número, ni cuenta de
  Instagram/Messenger/Telegram. El smoke de WhatsApp prueba el *handshake* de
  verificación, no la entrega.
- **Nada sobre cobro.** No hay credenciales de Wompi ni de Factus.
- **Nada sobre carga.** Un host de staging es un host, no el tráfico de
  producción.

## Cuándo se puede decir que staging está cerrado

Cuando esta lista esté completa, y no antes:

- [ ] existe un host separado, y `STAGING_SERVER_HOST` apunta a él;
- [ ] las 16 variables están puestas y la guarda de aislamiento pasó **en una
      corrida real**, con al menos un digest de producción comparado;
- [ ] un deploy completo (pasos 1–22) terminó verde en ese host;
- [ ] el preflight de huérfanos fue visto **fallar** a propósito ahí, y frenó el
      deploy;
- [ ] el recorrido de publicación y su rollback quedaron verdes contra ese stack;
- [ ] un rollback de imagen fue ejecutado y su criterio verificable pasó;
- [ ] los artefactos de esa corrida están archivados.

Hasta entonces, este documento describe código construido y probado localmente,
y nada más.
