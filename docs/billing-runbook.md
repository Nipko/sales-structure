# Billing — Guía operativa

Guía operativa para la facturación por suscripción de Parallly. Para el plan estratégico, decisiones de precio y justificaciones, ver [`docs/billing-plan.md`](./billing-plan.md). Para la arquitectura del código, ver [`apps/api/src/modules/billing/README.md`](../apps/api/src/modules/billing/README.md).

Este documento es el **runbook**: qué pasa en cada deploy, cómo agregar un país, cómo actualizar precios, cómo recuperar de incidentes.

---

## 1. Lo que hace el deploy automáticamente

Cada push a `main` dispara `.github/workflows/deploy.yml`. Después de compilar imágenes y correr migraciones, el deploy ejecuta tres pasos específicos de billing en este orden:

### 1.1 Migración de schema Prisma
```bash
docker compose run --rm api npx prisma migrate deploy --schema=prisma/schema.prisma
```
Aplica cualquier `prisma/migrations/*/migration.sql` nuevo al schema global `public`. Idempotente — migraciones ya aplicadas se saltean.

El schema de billing viene en la migración `20260423000000_add_billing`:
- 7 columnas nuevas en `tenants` (billingEmail, billingCountry, subscriptionStatus, trialEndsAt, currentPeriodEnd, paymentProvider, paymentProviderCustomerId)
- 4 tablas nuevas: `billing_plans`, `billing_subscriptions`, `billing_events`, `billing_payments`

### 1.2 Seed de billing_plans
```bash
docker compose run --rm api node prisma/seed-billing-plans.js
```
Upsertea los 4 planes (`starter`, `pro`, `enterprise`, `custom`) en `billing_plans`. Los precios están en USD cents — son la fuente de verdad. Correrlo en cada deploy es seguro; actualiza nombre/precio/límites si cambian en el archivo fuente, sino es no-op.

### 1.3 Sync de planes a MercadoPago (Colombia)
```bash
docker compose run --rm api node scripts/sync-mp-plans.js --country=CO --fx=4200
```
Registra los 3 tiers pagos (`starter`, `pro`, `enterprise`) como `preapproval_plan` en MercadoPago Colombia y guarda los IDs en `billing_plans.priceLocalOverrides[CO]` + mirror en la columna `mpPlanId`. El FX rate se lee del secret `PROD_MP_FX_CO` (default `4200`).

**Cómo agregar otro país**: al deploy.yml, después de la línea de Colombia, duplicá la invocación con el código ISO correcto. Ejemplo México:
```yaml
docker compose -f infra/docker/docker-compose.prod.yml run --rm api node scripts/sync-mp-plans.js --country=MX --fx="${PROD_MP_FX_MX:-18.5}" || true
```
Y cargá el secret `MP_FX_MX` en GitHub si querés overridear el default.

**Garantía de idempotencia**: un tier ya sincronizado para un país se saltea por default. Correrlo en cada deploy es seguro y barato (un SELECT por tier, cero llamadas a MP API si nada cambió).

---

## 2. Variables de entorno

### Requeridas (billing se rompe sin estas)
| Variable | Dónde | Para qué |
|---|---|---|
| `MP_ACCESS_TOKEN` | GitHub Secret | Auth del servidor a MP API. TEST-* en sandbox, APP_USR-* en producción |
| `MP_WEBHOOK_SECRET` | GitHub Secret | Clave de firma HMAC-SHA256 para webhooks entrantes |

### Opcionales (los defaults aplican si no están)
| Variable | Default | Para qué |
|---|---|---|
| `MP_PUBLIC_KEY` | vacío | Usada por el frontend del dashboard para tokenizar tarjetas (Sprint 3) |
| `MP_FX_CO` | `4200` | Tipo de cambio USD→COP. Cambiar cuando fluctúe |
| `MP_FX_AR` | `1200` | Tipo de cambio USD→ARS |
| `MP_FX_MX` | `18` | Tipo de cambio USD→MXN |
| `MP_FX_CL` | `950` | Tipo de cambio USD→CLP |
| `MP_FX_PE` | `3.8` | Tipo de cambio USD→PEN |
| `MP_FX_UY` | `40` | Tipo de cambio USD→UYU |
| `MP_FX_BR` | `5.5` | Tipo de cambio USD→BRL |

Los secrets `MP_FX_*` son todos opcionales. Los seteás en GitHub → Settings → Secrets and variables → Actions cuando necesités sobreescribir un default.

---

## 3. Agregar un país nuevo

La API de Suscripciones de MP es por país — necesitás una cuenta merchant de MercadoPago en ese país. Una vez que la tengas:

1. **Conseguí las credenciales** desde el portal developer específico del país (ej. `mercadopago.com.mx/developers` para México) — cada país tiene su propio Access Token y Webhook Secret. En el corto plazo soportamos solo las credenciales de un país a la vez vía `MP_ACCESS_TOKEN` — el soporte multi-cuenta es trabajo de Fase 4.
2. **Setear el FX** en GitHub Secrets. Ejemplo México:
   ```
   MP_FX_MX = 18.5
   ```
3. **Agregar el código de país** a `MP_SYNC_COUNTRIES`:
   ```
   MP_SYNC_COUNTRIES = CO,MX
   ```
4. **Deploy** — pusheá cualquier commit a `main`. El script de deploy recoge el país nuevo, llama a `/preapproval_plan` de MP una vez por tier, y persiste los IDs en `billing_plans.priceLocalOverrides[MX]`.
5. **Verificá** — entrá a la VPS y chequeá:
   ```bash
   docker exec parallext-postgres psql -U parallext -d parallext_engine -c \
     "SELECT slug, price_local_overrides FROM billing_plans WHERE slug != 'custom';"
   ```
   Cada fila debería tener una clave `MX` al lado de `CO` en `price_local_overrides`.

---

## 4. Actualizar precios de planes

### Para un cambio permanente (aplica a todos los signups futuros)

1. Editá `apps/api/prisma/seed-billing-plans.js` → cambiá `priceUsdCents`.
2. Commit + push → el deploy upsertea el precio nuevo en `billing_plans`.
3. **Pero los planes de MP están congelados** — los registros `preapproval_plan` ya creados conservan su monto original. Las suscripciones nuevas creadas después de este deploy siguen referenciando el plan ID viejo hasta que hagas el paso 4.
4. Para forzar que MP use el precio nuevo, tenés que **recrear el plan en MP**:
   ```bash
   docker exec parallext-api sh -c \
     'MP_ACCESS_TOKEN=$MP_ACCESS_TOKEN node scripts/sync-mp-plans.js --country=CO --fx=4200 --force'
   ```
   El flag `--force` crea un plan nuevo en MP y sobreescribe el ID en `priceLocalOverrides[CO].mpPlanId`. Los suscriptores actuales se quedan con el ID viejo — solo los nuevos signups agarran el precio nuevo. **Las suscripciones existentes hay que migrarlas manualmente** con una llamada a `BillingService.upgradeSubscription` si querés pasarlas al precio nuevo.

### Para un ajuste de FX solamente (ej. devaluación)

Igual que arriba pero solo cambia el secret `MP_FX_*`. El precio USD en `billing_plans` se queda igual. Force-sync recrea el plan de MP en el monto local nuevo.

---

## 5. Operaciones manuales

Todas las operaciones de abajo asumen acceso SSH a la VPS de producción.

### Re-correr seed (ej. después de un cambio de schema)
```bash
docker exec parallext-api node prisma/seed-billing-plans.js
```

### Re-correr sync para un solo país
```bash
docker exec parallext-api sh -c \
  'MP_ACCESS_TOKEN=$MP_ACCESS_TOKEN node scripts/sync-mp-plans.js --country=CO --fx=4200'
```

### Dry-run del sync (imprime los bodies de MP, no llama a MP)
```bash
docker exec parallext-api sh -c \
  'MP_ACCESS_TOKEN=$MP_ACCESS_TOKEN node scripts/sync-mp-plans.js --country=CO --fx=4200 --dry-run'
```

### Recrear planes forzadamente para un país (MP no upsertea)
```bash
docker exec parallext-api sh -c \
  'MP_ACCESS_TOKEN=$MP_ACCESS_TOKEN node scripts/sync-mp-plans.js --country=CO --fx=4200 --force'
```
Usalo cuando cambió un precio o el plan se borró por accidente en MP.

### Inspeccionar el estado actual de los planes
```bash
# ¿Qué tenemos en nuestra DB?
docker exec parallext-postgres psql -U parallext -d parallext_engine -c \
  "SELECT slug, price_usd_cents, trial_days, mp_plan_id, price_local_overrides FROM billing_plans ORDER BY sort_order;"

# ¿Qué tiene MP sandbox?
# Andá a https://www.mercadopago.com.co/developers → tu app → Suscripciones
```

### Inspeccionar la suscripción de un tenant específico
```bash
docker exec parallext-postgres psql -U parallext -d parallext_engine -c \
  "SELECT tenant_id, status, provider_subscription_id, trial_ends_at, current_period_end FROM billing_subscriptions WHERE tenant_id = '<TENANT_UUID>';"
```

### Ver eventos de billing recientes de un tenant
```bash
docker exec parallext-postgres psql -U parallext -d parallext_engine -c \
  "SELECT processed_at, event_type, provider, provider_event_id FROM billing_events WHERE tenant_id = '<TENANT_UUID>' ORDER BY processed_at DESC LIMIT 20;"
```

---

## 6. Respuesta a incidentes

### Un cliente dice "me cancelaron la suscripción pero pagué"
1. Conseguí su tenant id + ID de suscripción MP:
   ```sql
   SELECT tenant_id, provider_subscription_id, status
   FROM billing_subscriptions WHERE tenant_id = '...';
   ```
2. Pollea MP directo — el cron de reconciliación horario ya debería hacerlo, pero si querés forzarlo:
   ```bash
   docker exec parallext-api node -e "
     const { MercadoPagoConfig, PreApproval } = require('mercadopago');
     const c = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
     new PreApproval(c).get({ id: '<SUB_ID>' }).then(r => console.log(JSON.stringify(r, null, 2)));
   "
   ```
3. Si MP dice `authorized` y nuestra DB dice `cancelled` → el webhook falló en algún momento. El cron horario se auto-cura, pero podés forzarlo llamando a BillingService con un evento sintético (ver `reconciliation.processor.ts`).

### Los webhooks dejaron de llegar en producción
1. Chequeá que el endpoint del webhook sea alcanzable desde el lado de MP:
   ```bash
   curl -I https://api.parallly-chat.cloud/api/v1/billing/webhook/mercadopago
   ```
   Debería devolver `405 Method Not Allowed` (GET no está soportado; POST sí).
2. Mirá en el dashboard de MP → Webhooks → entregas recientes. Buscá respuestas 401 (signature mismatch — ver sección siguiente) o 5xx.
3. Revisá los logs del API:
   ```bash
   docker logs parallext-api --tail 200 | grep -i webhook
   ```

### Falla la verificación de firma de webhook (`401 invalid_signature`)
1. Confirmá que `MP_WEBHOOK_SECRET` coincida con la "Signing Key" del dashboard de MP (los rotan — revisá las entregas recientes con `x-signature`).
2. Si el secret está bien, MP puede haber cambiado el formato de firma (ya pasó — ver `sdk-nodejs#318`). Logueá headers crudos para debuggear:
   ```bash
   docker logs parallext-api --tail 500 | grep -E 'x-signature|webhook'
   ```
3. Rotá el webhook secret en el dashboard de MP + actualizá el GitHub Secret `MP_WEBHOOK_SECRET` + redeployá.

### El sync de planes falló en el deploy (revisá el log del deploy)
Causas comunes:
- `MP_ACCESS_TOKEN is not set` → falta el GitHub Secret. Agregalo y redeployá.
- `Invalid --fx value` → el secret `MP_FX_<CC>` tiene un valor no-numérico.
- MP devolvió un body de error → leé la línea "FAILED: MP returned..." en el log del deploy para la razón específica de MP.

Las fallas de seed se ven igual. Los dos pasos tienen `|| true` en el pipeline para que no frenen el deploy — si uno falla, billing queda en su estado previo. Arreglá la causa y redeployá.

---

## 7. Credenciales sandbox vs producción

| Prefijo de token | Ambiente | Dónde |
|---|---|---|
| `TEST-xxxxxxxxxxxxxxxx-xxxxxx-xxxxx` | MP Sandbox | Usalas en desarrollo. No se mueve plata real |
| `APP_USR-xxxxxxxxxxxxxxxx-xxxxxx-xxxxx` | MP Producción | Clientes reales, cobros reales |

El método `MercadoPagoConfigService.environment()` infiere sandbox vs producción del prefijo del token — loguea qué modo está activo al arrancar la API. No hay cambio de código al swapear — solo actualizás el valor del GitHub Secret.

**Plan de cutover para salir en vivo en Colombia:**
1. Crear una cuenta merchant de producción en MP (requiere entidad legal colombiana o la LLC de Delaware con cuenta bancaria local).
2. Conseguir el Access Token con prefijo APP_USR- + Webhook Secret nuevo.
3. Reemplazar los valores en GitHub Secrets `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET`.
4. Disparar un deploy → el script de sync crea los planes de producción (IDs nuevos) y los persiste en `billing_plans.priceLocalOverrides[CO].mpPlanId`, reemplazando los de sandbox.
5. Actualizar la URL del webhook en el dashboard de MP de producción a `https://api.parallly-chat.cloud/api/v1/billing/webhook/mercadopago`.
6. Probar con una tarjeta real (monto bajo) end-to-end antes de anunciar.

---

## 8. Referencia rápida — mapa de archivos

| Tema | Archivo |
|---|---|
| Plan estratégico y decisiones | `docs/billing-plan.md` |
| Este runbook | `docs/billing-runbook.md` |
| Arquitectura de código | `apps/api/src/modules/billing/README.md` |
| Columnas de billing en tenant | `apps/api/prisma/schema.prisma` (`model Tenant`) |
| Tablas globales de billing | `apps/api/prisma/schema.prisma` (4 modelos `BillingX`) |
| Migración de schema | `apps/api/prisma/migrations/20260423000000_add_billing/migration.sql` |
| Script de seed | `apps/api/prisma/seed-billing-plans.js` |
| Script de sync MP | `apps/api/scripts/sync-mp-plans.js` |
| Automatización del deploy | `.github/workflows/deploy.yml` (sección de billing) |
| Interfaz del provider | `apps/api/src/modules/billing/adapters/payment-provider.interface.ts` |
| Adapter de MercadoPago | `apps/api/src/modules/billing/adapters/mercadopago.adapter.ts` |
| Servicio de billing | `apps/api/src/modules/billing/billing.service.ts` |
| Receptor de webhooks | `apps/api/src/modules/billing/webhook.controller.ts` |
| Cron de reconciliación | `apps/api/src/modules/billing/processors/reconciliation.processor.ts` |
