# Billing — Guía operativa

> **Actualizado: jul 2026.** 5 planes (emprendedor / starter / pro / enterprise / custom). MercadoPago (Colombia) para suscripciones + pago único de créditos SMS. Factus para facturación electrónica DIAN (cross-ref abajo). La **fuente de verdad de precios/límites en runtime es la tabla `billing_plans`**, editada desde el panel super_admin (`/admin/plans`) — el seed sólo bootstrapea planes faltantes.

Guía operativa para la facturación por suscripción de Parallly. Para el plan estratégico, decisiones de precio y justificaciones, ver [`docs/archive/billing-plan.md`](./archive/billing-plan.md) y [`docs/plan-profitability-2026-07.md`](./plan-profitability-2026-07.md). Para la puesta a punto de MercadoPago, ver [`docs/billing-mp-setup.md`](./billing-mp-setup.md). Para la arquitectura del código, ver [`apps/api/src/modules/billing/README.md`](../apps/api/src/modules/billing/README.md).

Este documento es el **runbook**: qué pasa en cada deploy, cómo operar desde el panel Billing Ops, cómo agregar un país, cómo actualizar precios, cómo recuperar de incidentes.

> **Vía primaria = panel, no SSH.** Casi todo lo operativo (ver suscripciones/pagos/eventos cross-tenant, refund, reconciliar, sincronizar planes a MP, editar el catálogo, comp-plans) se hace desde el panel super_admin sin tocar la VPS. Ver [Panel Billing Ops](#panel-billing-ops-super_admin--vía-primaria-sin-ssh). Los comandos SSH de las secciones 5–6 quedan como fallback.

---

## Panel Billing Ops (super_admin) — vía primaria (sin SSH)

Controlador `apps/api/src/modules/billing/billing-admin.controller.ts` bajo `/api/v1/billing-admin` (guard `AuthGuard('jwt') + RolesGuard`, `@Roles('super_admin')`). Es la superficie de operación por defecto y reemplaza casi todos los `docker exec … psql` y los scripts por-SSH de abajo. UI en el dashboard: **`/admin/billing-ops`** (subs/pagos/eventos + refund + reconcile) y **`/admin/plans`** (editor de catálogo + sync-MP + badge sandbox/prod).

**Vistas cross-tenant (read):**
- `GET /billing-admin/subscriptions` — filtros `status`, `provider`, `plan`, `q` (nombre/slug de tenant), paginado. Reemplaza el `SELECT … FROM billing_subscriptions`.
- `GET /billing-admin/payments` — filtros `status`, `provider`, `tenantId`, paginado.
- `GET /billing-admin/events` — filtros `eventType`, `provider`, `tenantId`, paginado (omite el payload crudo, que puede ser grande).

**Acciones:**
- `POST /billing-admin/payments/:paymentId/refund` — refund inline (parcial vía `amountCents` o total) con `reason`.
- `POST /billing-admin/reconcile` — reconciliación on-demand (`scope: 'full' | 'past_due'`) sin esperar los crons. Útil justo tras un cutover para confirmar que DB y MP coinciden.
- `POST /billing-admin/tenants/:tenantId/reconcile` — reconciliar la suscripción de un solo tenant contra el provider (`BillingService.syncFromProvider`).
- `POST /billing-admin/plans/:slug/sync-mp` — registra/recrea el `preapproval_plan` en MP para `{ country, fx?, force?, cycle: 'month' | 'year' }` desde el panel (equivale a `sync-mp-plans.js`, sin SSH). `custom` no es sincronizable (sales-led).
- `PUT /billing-admin/plans/:slug` — editor del catálogo (precio, trial, `maxAgents`, `features`, `priceLocalOverrides`). **Valida `features` contra `plan-features.registry.ts`** (merge, no reemplazo → un payload parcial no borra claves omitidas) e invalida el cache de plan de los tenants afectados.
- `POST /billing-admin/tenants/:tenantId/comp-plan` — regalo temporal de plan (`planSlug`, `durationDays`, `reason` obligatorio).
- `PUT /billing-admin/tenants/:tenantId/plan` — cambio de plan permanente (entitlement override; NO toca la suscripción de pago).
- `GET /billing-admin/provider-status` — entorno MP (`sandbox`/`production`), `configured`, `webhookConfigured`. Alimenta el badge sandbox/prod en `/admin/plans`.
- `GET /billing-admin/plans` / `GET /billing-admin/feature-registry` — catálogo (con `tenantCount` por plan) + registry de features conocidas.

Todas las mutaciones escriben en `audit_log` con el **actor real** (`audit-actor.util.ts`): en modo impersonación queda registrado el super_admin real, no el tenant.

---

## 1. Lo que hace el deploy automáticamente

Cada push a `main` dispara `.github/workflows/deploy.yml`. Después de compilar imágenes, el deploy ejecuta cuatro operaciones relevantes para billing: migración, seed, preflight read-only del collector y sync de planes. **Las cuatro son fail-fast**: si falla una migración, el seed, la identidad del collector o el sync de MercadoPago, el deploy aborta y no se publica como exitoso. Antes de migrar, toma un **pg_dump completo en `/backup/pre-deploy/`** (dentro del contenedor `parallext-postgres`) como punto de rollback — ver §6.

### 1.1 Migración de schema Prisma
```bash
docker compose run --rm api npx prisma migrate deploy --schema=prisma/schema.prisma
```
Aplica cualquier `prisma/migrations/*/migration.sql` nuevo al schema global `public`. Idempotente — migraciones ya aplicadas se saltean. En el pipeline corre **fail-fast** (sin `|| true`): un fallo aborta el deploy sin recrear contenedores.

El schema de billing arrancó en la migración `20260423000000_add_billing`:
- columnas nuevas en `tenants` (billingEmail, billingCountry, subscriptionStatus, trialEndsAt, currentPeriodEnd, paymentProvider, paymentProviderCustomerId)
- 4 tablas base: `billing_plans`, `billing_subscriptions`, `billing_events`, `billing_payments`

Migraciones posteriores extendieron el modelo (p. ej. `20260507120000_add_billing_coupons` → cupones; y columnas de ciclo anual / cambio de plan pendiente como `pendingPlanId`, `pendingPlanChangeAt`, `cancelAtPeriodEnd` en `billing_subscriptions`). El schema vivo está en `apps/api/prisma/schema.prisma`.

### 1.2 Seed de billing_plans
```bash
docker compose run --rm api node prisma/seed-billing-plans.js
```
Bootstrapea los **5 planes** (`emprendedor` USD $21, `starter` $49, `pro` $129, `enterprise` $349, `custom` a cotizar) en `billing_plans`. Corre **fail-fast** en el pipeline (sin `|| true`): un fallo indica un problema real de DB y aborta el deploy.

**El seed es CREATE-ONLY por default** (no upsert): en un DB fresco crea los planes faltantes, pero **si un plan ya existe lo saltea y NO lo sobreescribe**. La razón: la fuente de verdad en runtime es la tabla `billing_plans` editada desde el panel (`PUT /billing-admin/plans/:slug`), así que un seed en cada deploy no debe pisar las ediciones del panel. Para restaurar un plan a los valores de fábrica del archivo (p. ej. tras una mala edición manual) hay que pasar **`--force`** — ese path sí sobreescribe, preservando sólo los `mpPlanId` ya sincronizados vía el merge de overrides. Los precios en el archivo están en USD cents; los precios locales (COP, mensual y anual) viven en `priceLocalOverrides`.

### 1.3 Preflight del collector de MercadoPago (Colombia)

```bash
docker compose run --rm api node scripts/diagnose-mp-collector.js --expected-site=MCO
```

Este diagnóstico hace únicamente consultas **read-only** (`/users/me`, estado del usuario y búsqueda de planes) con el `MP_ACCESS_TOKEN` que realmente ve el contenedor. El deploy exige `MCO`, cuenta activa, términos aceptados y ausencia de acciones globales pendientes antes de intentar crear planes. Los flags `billing`, `sell` y `list` del estado de Mercado Libre —incluido `address_pending`— se conservan como advertencias diagnósticas: no documentan por sí solos la elegibilidad de escritura de `preapproval_plan`, cuya prueba autoritativa es el `POST` que ejecuta el sync. El código interpreta un prefijo `APP_USR-` como modo producción, pero el prefijo por sí solo **no demuestra** país, merchant correcto ni cumplimiento del collector.

Para fijar también el merchant exacto, obtené su ID numérico desde el portal y usá `--expected-collector-id=<ID>` o definí `MP_EXPECTED_COLLECTOR_ID` dentro del contenedor. La comparación ocurre en memoria: el reporte sólo expone `collector_identity.expected_configured` y `matches`, nunca el ID esperado ni el recibido. El workflow toma el valor del GitHub Secret opcional `MP_EXPECTED_COLLECTOR_ID`; si queda vacío, el diagnóstico puede terminar `ok: true`, pero incluye la advertencia no bloqueante `collector_identity_not_pinned`: MCO/KYC pasaron, la identidad exacta del merchant no quedó probada.

El preflight tampoco imprime el Access Token. Si falla por token ausente/inválido, site distinto, collector distinto, estado global inactivo, términos no aceptados, una acción global pendiente o una respuesta inválida/no autorizada de MP, el deploy aborta antes del `POST /preapproval_plan`. Las advertencias de `billing`/`sell`/`list` no abortan el deploy. Como sólo ejecuta tres `GET`, un resultado exitoso conserva `read_only_scope.write_eligibility_tested: false`: reduce causas posibles, pero no garantiza que MercadoPago autorice el `POST`.

### 1.4 Sync de planes a MercadoPago (Colombia)
```bash
docker compose run --rm api node scripts/sync-mp-plans.js --country=CO --fx=4200
docker compose run --rm api node scripts/sync-mp-plans.js --country=CO --cycle=annual --derive-missing-annual=15
```
Registra los **4 tiers pagos** (`emprendedor`, `starter`, `pro`, `enterprise`; `custom` es sales-led y se omite) como `preapproval_plan` en MercadoPago Colombia. Guarda el ID mensual en `billing_plans.priceLocalOverrides[CO].mpPlanId` y, para Colombia, mantiene el mirror legacy en la columna `mpPlanId`. El FX rate se lee del secret `PROD_MP_FX_CO` (default `4200`), aunque un precio local fijo existente tiene precedencia. `--derive-missing-annual=15` repara filas legacy calculando el total anual desde el mensual; los precios e IDs solo se guardan en una transacción después de que los cuatro planes del ciclo fueron aceptados, por lo que un fallo parcial no habilita un checkout incompleto.

El deploy valida primero, sin escrituras, los payloads mensual y anual que salen de la base productiva (`--force --dry-run`). Sólo si ambos son válidos sincroniza los dos ciclos de forma **fail-fast**. El ciclo anual usa `priceLocalOverrides.CO.annual.amountCents` o, únicamente para una fila legacy sin ese campo, deriva el total desde el precio mensual con el descuento explícito; ver `docs/billing-annual-cycle.md`.

**Cómo agregar otro país**: al deploy.yml, después de la línea de Colombia, duplicá la invocación con el código ISO correcto. Ejemplo México:
```yaml
docker compose -f infra/docker/docker-compose.prod.yml run --rm api node scripts/sync-mp-plans.js --country=MX --fx="${PROD_MP_FX_MX:-18.5}"
```
El diagnóstico incluido hoy es deliberadamente **MCO-only**. Antes de habilitar otro país hay que extender su allowlist y pruebas para el `site_id` correspondiente, además de proveer las credenciales de ese merchant. Cargá `MP_FX_MX` en GitHub si querés overridear el default.

**Idempotencia con validación remota**: si un tier ya tiene `mpPlanId` para el país/ciclo, el sync hace `GET` de ese plan con el token activo y sólo lo saltea cuando es accesible y coincide en moneda, frecuencia, monto y estado. Un `404` —caso habitual al pasar de TEST a `APP_USR`— o una configuración distinta provoca la creación y persistencia automática de un reemplazo. El ID por sí solo no guarda ambiente ni collector; `--force` queda reservado para una recreación intencional aun cuando el plan existente sea válido (§7).

---

## 2. Variables de entorno

### Requeridas (billing se rompe sin estas)
| Variable | Dónde | Para qué |
|---|---|---|
| `MP_ACCESS_TOKEN` | GitHub Secret | Auth del servidor a MP API. TEST-* en sandbox, APP_USR-* en producción; en prod debe pasar `/users/me` con el `site_id` esperado |
| `MP_WEBHOOK_SECRET` | GitHub Secret | Clave de firma HMAC-SHA256 para webhooks entrantes |

### Opcionales (los defaults aplican si no están)
| Variable | Default | Para qué |
|---|---|---|
| `MP_PUBLIC_KEY` | vacío | Usada por el frontend del dashboard para tokenizar tarjetas (Sprint 3) |
| `MP_EXPECTED_COLLECTOR_ID` | vacío | Fija el merchant esperado durante el preflight sin serializar su ID; configurarlo como GitHub Secret es muy recomendado en producción |
| `MP_FX_CO` | `4200` | Tipo de cambio USD→COP. Cambiar cuando fluctúe |
| `MP_FX_AR` | `1200` | Tipo de cambio USD→ARS |
| `MP_FX_MX` | `18` | Tipo de cambio USD→MXN |
| `MP_FX_CL` | `950` | Tipo de cambio USD→CLP |
| `MP_FX_PE` | `3.8` | Tipo de cambio USD→PEN |
| `MP_FX_UY` | `40` | Tipo de cambio USD→UYU |
| `MP_FX_BR` | `5.5` | Tipo de cambio USD→BRL |

Los secrets `MP_FX_*` son todos opcionales. Los seteás en GitHub → Settings → Secrets and variables → Actions cuando necesités sobreescribir un default. El prefijo del token no reemplaza el preflight: verificá siempre la identidad runtime con `diagnose-mp-collector.js`.

---

## 3. Agregar un país nuevo

La API de Suscripciones de MP es por país — necesitás una cuenta merchant de MercadoPago en ese país. **Hoy el deploy sólo tiene un `MP_ACCESS_TOKEN` runtime y sincroniza CO de forma explícita**; definir `MP_SYNC_COUNTRIES` no activa un loop ni selecciona credenciales por país. Antes de abrir otro país hay que resolver el soporte de credenciales por merchant o reemplazar intencionalmente la única cuenta activa.

1. **Conseguí las credenciales** desde el portal developer específico del país (ej. `mercadopago.com.mx/developers` para México) — cada país tiene su propio Access Token y Webhook Secret. En el corto plazo soportamos solo las credenciales de un país a la vez vía `MP_ACCESS_TOKEN` — el soporte multi-cuenta es trabajo de Fase 4.
2. **Setear el FX** en GitHub Secrets. Ejemplo México:
   ```
   MP_FX_MX = 18.5
   ```
3. **Extender primero el preflight MCO-only** para aceptar y probar el `site_id` del nuevo país; después agregar líneas explícitas y fail-fast al deploy: diagnóstico del collector y `sync-mp-plans.js --country=MX ...`. No sincronices MX con el token colombiano.
4. **Deploy** — el preflight debe confirmar el merchant/site correcto antes de llamar a `/preapproval_plan`; luego el sync persiste los IDs en `billing_plans.priceLocalOverrides[MX]`.
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

El seed y el sync son fail-fast; el preflight también aborta ante sus blockers fuertes. Las advertencias diagnósticas de `billing`/`sell`/`list` no son errores. No agregues `|| true`: un deploy verde con planes sin sincronizar deja el checkout inoperante y oculta el incidente.

### `403 rejected_by_regulations_collector_non_compliant` al crear `preapproval_plan`

Este código indica que MercadoPago rechazó al **collector asociado al Access Token** por una regla de cumplimiento. No lo corrigen `back_url`, `notification_url`, el webhook secret ni cambiar el JSON del precio. Tampoco basta con ver `APP_USR-`: ese prefijo no prueba país, collector, KYC ni habilitación del producto Suscripciones.

El request de Parallly usa el cuerpo mínimo documentado (`reason`, `auto_recurring` y `back_url`). `payment_methods_allowed` es opcional y se omite para que MercadoPago aplique los métodos habilitados para el collector MCO; así no queda una allowlist local como variable adicional del diagnóstico.

1. Ejecutá el diagnóstico dentro del mismo contenedor/entorno que hace el sync:
   ```bash
   docker compose -f infra/docker/docker-compose.prod.yml run --rm api \
     node scripts/diagnose-mp-collector.js --expected-site=MCO \
       --expected-collector-id="$EXPECTED_MP_COLLECTOR_ID"
   ```
   Cargá `EXPECTED_MP_COLLECTOR_ID` desde el ID numérico que muestra el portal; también podés pasar el mismo valor como `MP_EXPECTED_COLLECTOR_ID` dentro del contenedor.
2. Confirmá `ok: true`, `expected_site_id: MCO`, `collector_identity.expected_configured: true`, `collector_identity.matches: true` y ningún blocker. Puede haber advertencias de `billing`/`sell`/`list` (por ejemplo, `address_pending`); quedan registradas, pero no sustituyen ni impiden la prueba real del `POST /preapproval_plan`. Por privacidad, el script no imprime ninguno de los dos IDs. Si omitís la identidad esperada, `collector_identity_not_pinned` es una advertencia: no bloquea, pero tampoco prueba que el token sea del merchant correcto. Nunca pegues el Access Token en tickets o logs.
3. Si el site o collector no coincide, generá las credenciales desde la aplicación del merchant correcto, reemplazá `MP_ACCESS_TOKEN` y repetí el preflight.
4. Si identidad y site son correctos pero el `POST /preapproval_plan` sigue devolviendo el mismo 403, escalá a soporte de MercadoPago con el `collector_id` obtenido de forma segura en el portal, `site_id`, aplicación, timestamp, endpoint y request-id del rechazo. Pedí confirmación explícita de que ese collector está habilitado para **Suscripciones / preapproval_plan en producción MCO**.

No borres IDs de planes ni uses `--force` hasta que el preflight pase. Un intento forzado crea un plan nuevo; si la respuesta se pierde antes de persistir el ID, un reintento puede dejar duplicados en MercadoPago.

---

## 7. Credenciales sandbox vs producción

| Prefijo de token | Ambiente | Dónde |
|---|---|---|
| `TEST-xxxxxxxxxxxxxxxx-xxxxxx-xxxxx` | MP Sandbox | Usalas en desarrollo. No se mueve plata real |
| `APP_USR-xxxxxxxxxxxxxxxx-xxxxxx-xxxxx` | MP Producción | Clientes reales, cobros reales |

El método `MercadoPagoConfigService.environment()` infiere sandbox vs producción del prefijo del token y loguea ese modo al arrancar. Esa inferencia es informativa: el único chequeo de identidad del merchant/site es el preflight contra `/users/me`.

Los `preapproval_plan_id` son específicos del ambiente, aplicación y collector que los creó. La DB sólo guarda el string del ID; no registra si provino de TEST o producción. Reemplazar el secret **no convierte** esos IDs, pero el sync compensa esa falta de procedencia: consulta cada ID con el token activo y lo reemplaza cuando no es visible (`404`) o no coincide con la configuración esperada.

**Plan de cutover para salir en vivo en Colombia:**
1. Crear y completar la verificación de la cuenta merchant colombiana de producción; confirmar que la aplicación tiene habilitado el producto Suscripciones.
2. Guardar un respaldo del mapeo actual de IDs y confirmar que no existen suscripciones reales que dependan de ellos. Un cambio de catálogo no migra suscripciones activas.
3. Conseguir el Access Token y Public Key de producción de la **misma aplicación**, más el Webhook Secret de producción.
4. Reemplazar los GitHub Secrets `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY` y `MP_WEBHOOK_SECRET`, guardar también `MP_EXPECTED_COLLECTOR_ID` con el ID numérico del merchant correcto, y disparar un deploy para que el runtime y el dashboard reciban las nuevas credenciales. El preflight debe terminar con `MCO`, `expected_configured: true` y `matches: true`; si falla, el deploy aborta antes del sync.
5. Durante el deploy, cada ID mensual y anual guardado se valida con la credencial nueva. Los IDs TEST normalmente responden `404` para el token de producción y se reemplazan automáticamente. Revisá ambos resúmenes finales: deben mostrar `failures=0`; en un cutover íntegramente desde TEST normalmente habrá cuatro creaciones mensuales y cuatro anuales.
6. Antes del primer POST, el deploy ejecuta ambos ciclos con `--force --dry-run` para mostrar y validar los ocho payloads respaldados por la DB. El precio anual debe existir en `priceLocalOverrides.CO.annual.amountCents`; si falta alguno, el deploy aborta antes de crear cualquier plan.
7. Usá `--force` sólo si necesitás recrear intencionalmente planes que el sync considera accesibles y correctos, por ejemplo durante un cambio controlado de catálogo:
   ```bash
   docker compose -f infra/docker/docker-compose.prod.yml run --rm api \
     node scripts/sync-mp-plans.js --country=CO --fx="${PROD_MP_FX_CO:-4200}" --force
   ```
   Este flag crea reemplazos incluso si los IDs actuales son válidos; ejecutalo en una ventana controlada y verificá el resultado antes de reintentar para no dejar planes duplicados.
8. Verificá en DB y en MercadoPago que los ocho IDs resultantes (4 mensuales + 4 anuales) pertenecen al collector MCO de producción, tienen moneda/frecuencia correctas y están activos. Conservá el respaldo de los IDs anteriores para auditoría; no los reutilices con el token nuevo.
9. Actualizá la URL del webhook en la aplicación de producción a `https://api.parallly-chat.cloud/api/v1/billing/webhook/mercadopago` y confirmá la firma con el secret nuevo.
10. Probá end-to-end con una tarjeta real y un cobro controlado antes de anunciar: creación de suscripción, webhook firmado, estado local, reconciliación, factura y eventual reembolso.

---

## 8. Gate adicional antes del go-live: conversión trial → pago

Resolver el sync de `preapproval_plan` no alcanza para cobrar al terminar un trial. En el flujo actual, `BillingService.createTrialSubscription()` omite la creación remota cuando `trialDays > 0`. Para Pro/Enterprise recibe un `cardTokenId`, pero ese token de un solo uso no se persiste ni se canjea por una suscripción de MercadoPago; los campos `providerSubscriptionId` y `providerCustomerId` quedan vacíos. Al expirar, el cron mueve el registro local a `past_due`, y la activación del mismo plan/ciclo queda bloqueada tanto por `same_plan` en backend como por el botón de plan actual en dashboard.

Por tanto, **Pro/Enterprise no convierten automáticamente de trial a primer cobro hoy**. Antes de abrir producción hay que escoger e implementar una de estas políticas y probarla end-to-end:

1. Crear la autorización remota al iniciar el trial con una variante de plan que tenga `free_trial`, conservando planes sin trial para upgrades; o
2. Mantener el trial local sin tarjeta y, al terminar, pedir un token nuevo, permitir la activación del mismo plan/ciclo y crear entonces `/preapproval`.

La prueba de aceptación debe demostrar: tokenización, creación de `/preapproval`, persistencia de IDs provider, fecha del primer cobro, webhook firmado, transición local a `active`, reconciliación y reembolso controlado. No se debe reutilizar ni guardar un `card_token_id` de MercadoPago.

---

## 9. Referencia rápida — mapa de archivos

| Tema | Archivo |
|---|---|
| Plan estratégico y decisiones | `docs/billing-plan.md` |
| Este runbook | `docs/billing-runbook.md` |
| Arquitectura de código | `apps/api/src/modules/billing/README.md` |
| Columnas de billing en tenant | `apps/api/prisma/schema.prisma` (`model Tenant`) |
| Tablas globales de billing | `apps/api/prisma/schema.prisma` (4 modelos `BillingX`) |
| Migración de schema | `apps/api/prisma/migrations/20260423000000_add_billing/migration.sql` |
| Script de seed | `apps/api/prisma/seed-billing-plans.js` |
| Preflight read-only del collector | `apps/api/scripts/diagnose-mp-collector.js` |
| Script de sync MP | `apps/api/scripts/sync-mp-plans.js` |
| Automatización del deploy | `.github/workflows/deploy.yml` (sección de billing) |
| Interfaz del provider | `apps/api/src/modules/billing/adapters/payment-provider.interface.ts` |
| Adapter de MercadoPago | `apps/api/src/modules/billing/adapters/mercadopago.adapter.ts` |
| Servicio de billing | `apps/api/src/modules/billing/billing.service.ts` |
| Receptor de webhooks | `apps/api/src/modules/billing/webhook.controller.ts` |
| Cron de reconciliación | `apps/api/src/modules/billing/processors/reconciliation.processor.ts` |
