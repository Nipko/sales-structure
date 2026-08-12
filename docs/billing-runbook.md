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

Cada push a `main` dispara `.github/workflows/deploy.yml`. Después de compilar
imágenes, el deploy ejecuta dos operaciones relevantes para billing: migraciones y
bootstrap create-only de planes. Ambas son fail-fast. Antes de migrar toma un
**pg_dump completo en `/backup/pre-deploy/`** (dentro del contenedor
`parallext-postgres`) como punto de rollback — ver §6.

El preflight y la sincronización de MercadoPago fueron retirados del deploy en agosto
de 2026 porque el collector fue rechazado por cumplimiento. La integración está en
pausa: el workflow publica el runtime sin crear ni sincronizar planes en MP. Los
scripts siguientes son herramientas manuales y solo deben ejecutarse cuando la
pasarela vuelva a estar habilitada y el merchant haya superado el preflight.

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
Bootstrapea las filas faltantes del catálogo factory en `billing_plans`. Los nombres,
precios y cuotas aplicables se consultan en la tabla runtime y el panel; no se copian
en este runbook. El paso corre **fail-fast** en el pipeline: un error real de DB
aborta el deploy.

**El seed es CREATE-ONLY por default** (no upsert): en un DB fresco crea los planes faltantes, pero **si un plan ya existe lo saltea y NO lo sobreescribe**. La razón: la fuente de verdad en runtime es la tabla `billing_plans` editada desde el panel (`PUT /billing-admin/plans/:slug`), así que un seed en cada deploy no debe pisar las ediciones del panel. Para restaurar un plan a los valores de fábrica del archivo (p. ej. tras una mala edición manual) hay que pasar **`--force`** — ese path sí sobreescribe, preservando sólo los `mpPlanId` ya sincronizados vía el merge de overrides. Los precios en el archivo están en USD cents; los precios locales (COP, mensual y anual) viven en `priceLocalOverrides`.

### 1.3 Preflight manual del collector de MercadoPago (Colombia)

```bash
docker compose run --rm api node scripts/diagnose-mp-collector.js --expected-site=MCO
```

Este diagnóstico manual hace únicamente consultas **read-only** (`/users/me`,
estado del usuario y búsqueda de planes) con el `MP_ACCESS_TOKEN` que ve el
contenedor. Antes de cualquier intento manual de crear planes debe confirmar `MCO`,
cuenta activa, términos aceptados y ausencia de acciones globales pendientes. Los
flags `billing`, `sell` y `list` —incluido `address_pending`— son advertencias; no
demuestran elegibilidad para escribir `preapproval_plan`. Un prefijo `APP_USR-`
tampoco demuestra país, merchant correcto ni cumplimiento del collector.

Para fijar también el merchant exacto, obtené su ID numérico desde el portal y usá
`--expected-collector-id=<ID>` o definí `MP_EXPECTED_COLLECTOR_ID` dentro del
contenedor de la operación manual. La comparación ocurre en memoria: el reporte solo
expone si el valor está configurado y coincide, nunca los IDs. Sin ese pin, un
resultado `ok: true` conserva la advertencia `collector_identity_not_pinned`.

El preflight no imprime el Access Token. Si falla, **detén la operación manual** y no
ejecutes el sync. Como solo hace `GET`, incluso un resultado exitoso conserva
`read_only_scope.write_eligibility_tested:false`: reduce causas posibles, pero no
garantiza que MercadoPago autorice el `POST`.

### 1.4 Sync manual de planes a MercadoPago (Colombia; integración en pausa)
```bash
docker compose run --rm api node scripts/sync-mp-plans.js --country=CO --fx=4200
docker compose run --rm api node scripts/sync-mp-plans.js --country=CO --cycle=annual --derive-missing-annual=15
```
Registra los **4 tiers pagos** (`emprendedor`, `starter`, `pro`, `enterprise`; `custom` es sales-led y se omite) como `preapproval_plan` en MercadoPago Colombia. Guarda el ID mensual en `billing_plans.priceLocalOverrides[CO].mpPlanId` y, para Colombia, mantiene el mirror legacy en la columna `mpPlanId`. El FX rate se lee del secret `PROD_MP_FX_CO` (default `4200`), aunque un precio local fijo existente tiene precedencia. `--derive-missing-annual=15` repara filas legacy calculando el total anual desde el mensual; los precios e IDs solo se guardan en una transacción después de que los cuatro planes del ciclo fueron aceptados, por lo que un fallo parcial no habilita un checkout incompleto.

El deploy actual **no ejecuta** estos comandos. Cuando la integración vuelva a estar
habilitada, valida primero los payloads mensual y anual con `--force --dry-run` y
solo después realiza una sincronización manual controlada. El ciclo anual usa
`priceLocalOverrides.CO.annual.amountCents` o, únicamente para una fila legacy sin
ese campo, deriva el total desde el precio mensual con el descuento explícito; ver
`docs/billing-annual-cycle.md`.

**Cómo preparar otro país cuando la pasarela esté habilitada**: añade su catálogo
local y ejecuta el diagnóstico y el sync como una operación separada, nunca como
condición del deploy general. Ejemplo manual para México:
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

La API de Suscripciones de MP es por país — necesitás una cuenta merchant de
MercadoPago en ese país. **El deploy actual no sincroniza ningún país** y solo puede
entregar un `MP_ACCESS_TOKEN` runtime; definir `MP_SYNC_COUNTRIES` no activa un loop
ni selecciona credenciales. Antes de abrir otro país hay que reactivar la pasarela y
resolver el soporte de credenciales por merchant o reemplazar intencionalmente la
única cuenta activa.

1. **Conseguí las credenciales** desde el portal developer específico del país (ej. `mercadopago.com.mx/developers` para México) — cada país tiene su propio Access Token y Webhook Secret. En el corto plazo soportamos solo las credenciales de un país a la vez vía `MP_ACCESS_TOKEN` — el soporte multi-cuenta es trabajo de Fase 4.
2. **Setear el FX** en GitHub Secrets. Ejemplo México:
   ```
   MP_FX_MX = 18.5
   ```
3. **Extender primero el preflight MCO-only** para aceptar y probar el `site_id` del
   nuevo país. No agregues ese diagnóstico/sync como blocker del deploy general y no
   sincronices MX con el token colombiano.
4. **Operación manual** — el preflight debe confirmar merchant/site antes de llamar a
   `/preapproval_plan`; luego el sync manual persiste los IDs en
   `billing_plans.priceLocalOverrides[MX]`.
5. **Verificá** — entrá a la VPS y chequeá:
   ```bash
   docker exec parallext-postgres psql -U parallext -d parallext_engine -c \
     "SELECT slug, price_local_overrides FROM billing_plans WHERE slug != 'custom';"
   ```
   Cada fila debería tener una clave `MX` al lado de `CO` en `price_local_overrides`.

---

## 4. Actualizar precios de planes

### Para un cambio permanente (aplica a todos los signups futuros)

1. Entra como `super_admin` a **Planes** (`/admin/plans`), edita el precio
   USD y/o los overrides locales y guarda. Esa operación usa
   `PUT /billing-admin/plans/:slug` y actualiza la fuente runtime
   `billing_plans` con auditoría e invalidación de caché.
2. Verifica la lectura en el mismo panel y, para una comprobación operativa, consulta
   la fila de `billing_plans` antes de continuar. **Un commit o deploy por sí solo no
   cambia una fila existente**: el seed normal es create-only.
3. Actualiza también `apps/api/prisma/seed-billing-plans.js` si quieres que un entorno
   nuevo nazca con el mismo valor de fábrica. Ese cambio queda como baseline para DB
   frescas; no sustituye el paso 1 ni debe aplicarse con `--force` de forma rutinaria,
   porque `--force` restaura el plan completo desde el archivo.
4. **Los planes de MP ya creados conservan su monto original.** Para que las nuevas
   suscripciones usen el precio local actualizado, recrea/sincroniza el plan del
   proveedor desde el panel o, tras el preflight del merchant correcto, con:
   ```bash
   docker exec parallext-api sh -c \
     'MP_ACCESS_TOKEN=$MP_ACCESS_TOKEN node scripts/sync-mp-plans.js --country=CO --fx=4200 --force'
   ```
   El flag `--force` de `sync-mp-plans.js` crea un plan nuevo en MP y reemplaza su ID
   en `priceLocalOverrides[CO].mpPlanId`; no es el mismo flag que el del seed. Los
   suscriptores actuales permanecen en el ID anterior. Una migración de suscripciones
   existentes requiere un procedimiento explícito, validado y auditado; no la
   infieras de un deploy ni la ejecutes como efecto lateral de este cambio.

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

### El sync manual de planes falló
Causas comunes:
- `MP_ACCESS_TOKEN is not set` → falta la credencial en el entorno de la operación.
- `Invalid --fx value` → el secret `MP_FX_<CC>` tiene un valor no-numérico.
- MP devolvió un body de error → lee `FAILED: MP returned...` en el log de la
  operación manual.

El seed create-only del deploy es fail-fast. El preflight y el sync manual también
deben detener su propia operación ante blockers fuertes, pero **no forman parte del
deploy actual**. No conviertas su fallo en un falso éxito ni vuelvas a acoplarlo a la
publicación general de código.

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
4. Reemplazar los secrets `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY` y
   `MP_WEBHOOK_SECRET`, y guardar `MP_EXPECTED_COLLECTOR_ID` con el merchant correcto.
   Publicar el runtime es un paso separado; no ejecuta preflight ni sync.
5. Ejecutar manualmente el preflight. Debe terminar con `MCO`,
   `expected_configured:true` y `matches:true`; si falla, detener el cutover.
6. Ejecutar ambos ciclos con `--force --dry-run` para validar los payloads respaldados
   por la DB y, solo entonces, realizar el sync manual. Los IDs TEST normalmente
   responden `404` con la credencial de producción y se reemplazan durante esa
   operación. Revisa que ambos resúmenes terminen con `failures=0`.
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
