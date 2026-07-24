# MercadoPago — Configuración y pruebas iniciales (sandbox)

_Actualizado: jul 2026_

Guía paso a paso para dejar MercadoPago funcionando en Parallly **con credenciales de prueba** (sandbox). Sin plata real, sin clientes reales. Para el cutover a producción, ver [`docs/billing-runbook.md` → Sección 7](./billing-runbook.md#7-credenciales-sandbox-vs-producción). Para el detalle del ciclo anual (planes separados, prorrateo, descuento ~15%), ver [`docs/billing-annual-cycle.md`](./billing-annual-cycle.md).

> **Dos caminos.** Todo lo de esta guía se puede hacer por SSH (scripts) **o** desde el panel **`/admin/plans`** (super admin), que expone `sync-mp`, `reconcile`, `refund` y el badge sandbox/producción sin tocar la VPS. Ver la sección [Panel de MercadoPago (super admin)](#panel-de-mercadopago-super-admin). El SSH sigue siendo el camino que corre en cada deploy de forma automática.

---

## ¿Qué vas a lograr con esta guía?

Al terminar, vas a tener:
1. Una cuenta de desarrollador en MP con una aplicación creada.
2. Credenciales de sandbox (Access Token + Webhook Secret + Public Key) cargadas en GitHub Secrets.
3. El webhook apuntando al endpoint de Parallly con los 4 topics correctos.
4. Los **5 planes** de Parallly (emprendedor, starter, pro, enterprise, custom) sembrados en la DB; los **4 de pago sincronizados en MP sandbox de Colombia** (ciclo **mensual**). El ciclo **anual** se crea aparte — es un `preapproval_plan` separado por plan (ver Paso 6.b). `custom` es sales-led y no se sincroniza.
5. Una prueba end-to-end confirmando que los webhooks llegan y se verifican bien.

**Tiempo estimado**: 25–40 minutos de trabajo tuyo (una sola vez).

---

## Pre-requisitos

- Tener acceso al repo `Nipko/sales-structure` en GitHub (para cargar Secrets).
- Tener SSH a la VPS de producción (para verificar en DB).
- Tener un navegador. Nada más.

No necesitás:
- Una tarjeta de crédito (sandbox es 100% gratis).
- Una entidad legal (eso es solo para producción, cuando salgas en vivo).

---

## Paso 1 — Crear cuenta de desarrollador en MercadoPago

> Saltear este paso si ya tenés cuenta.

1. Andá a **https://www.mercadopago.com.co/developers** (si ya tenés sesión en MP Colombia, usá ese mismo login).
2. Registrate con email y contraseña. Usá un email que vayas a seguir viendo — MP manda notificaciones importantes ahí.
3. Completá los datos básicos. No hace falta CUIT/NIT ni cuenta bancaria para sandbox.
4. Verificá el email cuando te llegue el correo de MP.

**Resultado esperado**: llegás a un dashboard con un menú lateral que incluye "Tus integraciones", "Credenciales", "Webhooks", etc.

---

## Paso 2 — Crear la aplicación dentro del portal

Cada "aplicación" en MP es como un proyecto. Nosotros tenemos una sola: Parallly.

1. En el dashboard de developers, andá a **"Tus integraciones"** (menú lateral).
2. Clic en **"Crear aplicación"**.
3. Completá:
   - **Nombre de la aplicación**: `Parallly` (o `Parallly Sandbox` si querés distinguir).
   - **Producto que usás**: seleccioná **"Pagos online"** y dentro de eso, **"Suscripciones"**.
   - **Modelo de integración**: **"CheckoutPro / API"** o similar (no "Dashboard", queremos integración programática).
   - **Sitio web o comercio**: `https://parallly-chat.cloud` (aunque sea sandbox, poné el dominio real).
4. Guardá.

**Resultado esperado**: te deja en la página de tu aplicación con tabs "Credenciales", "Webhooks", "Configurar notificaciones", etc.

---

## Paso 3 — Obtener las credenciales de sandbox

Cada aplicación tiene **dos juegos de credenciales**: sandbox (TEST-) y producción (APP_USR-). Para probar, solo necesitás las de sandbox.

1. Dentro de tu aplicación, andá a **"Credenciales"** (tab lateral).
2. Asegurate de estar en la tab **"Credenciales de prueba"** (no "Credenciales de producción").
3. Vas a ver dos valores:
   - **Public Key**: algo tipo `TEST-xxxxxxxxxxxxxxxx-xxxxxx-xxxxx`. Es la llave que va al frontend.
   - **Access Token**: algo tipo `TEST-xxxxxxxxxxxxxxxx-xxxxxx-xxxxx`. Es la llave que va al backend. **Jamás la compartas en público**.
4. Copiá los dos valores. Los vas a necesitar en el Paso 5.

**Importante**: si alguna vez tenés que rotar el Access Token (ej. por sospecha de fuga), tenés un botón "Recrear token" en esta misma página. Al hacer eso, el anterior queda invalidado al instante.

---

## Paso 4 — Configurar el webhook en el dashboard de MP

Acá le decimos a MP: "cuando pase algo en una suscripción o pago, avísale a este endpoint".

1. En tu aplicación, andá a **"Webhooks"** → **"Configurar notificaciones"**.
2. **URL de producción**: poné
   ```
   https://api.parallly-chat.cloud/api/v1/billing/webhook/mercadopago
   ```
3. **URL de pruebas**: la misma. Podés dejarla igual — nuestro endpoint no distingue sandbox/prod por URL sino por credenciales.
4. **Eventos a notificar**: marcá los 4 siguientes (y solo estos):
   - ✅ `payment` (cada cobro aprobado o rechazado)
   - ✅ `subscription_preapproval` (cambios de estado de suscripción)
   - ✅ `subscription_authorized_payment` (cobros recurrentes exitosos)
   - ✅ `subscription_preapproval_plan` (informativo, cuando se edita un plan)

   **No** marques los demás (payment refund, merchant_order, point_integration, etc.). No los necesitamos y solo agregan ruido en los logs.

5. Clic en **"Generar clave secreta"** (botón al lado de "Signing Key" o "Secret").
6. Copiá el valor que aparece. Eso es el `MP_WEBHOOK_SECRET`. **Esta es la última vez que lo vas a ver completo** — MP solo lo muestra una vez por seguridad, así que guardalo en un password manager antes de cerrar la página.
7. Guardá la configuración del webhook.

**Resultado esperado**: la página muestra la URL configurada + los 4 eventos tildados + un "Signing Key" con los últimos 4 caracteres visibles.

---

## Paso 5 — Subir credenciales a GitHub Secrets

Ahora cargamos las 3 credenciales en el repo para que los deploys las inyecten en producción automáticamente.

1. Andá a **https://github.com/Nipko/sales-structure/settings/secrets/actions**.
2. Clic en **"New repository secret"** para cada uno de los 3 siguientes:

| Nombre del secret | Valor |
|---|---|
| `MP_ACCESS_TOKEN` | El `TEST-...` del backend (Paso 3) |
| `MP_WEBHOOK_SECRET` | El Signing Key del webhook (Paso 4) |
| `MP_PUBLIC_KEY` | El `TEST-...` del frontend (Paso 3) |

3. Confirmá que los 3 aparecen en la lista. No podés ver sus valores después de guardar (GitHub los enmascara) — eso es normal.

**Verificación visual**: en la lista deberías ver 3 entries nuevos al lado de `META_APP_SECRET`, `DATABASE_URL`, etc.

---

## Paso 6 — Disparar un deploy

Cada push a `main` dispara un deploy completo que incluye el auto-setup de planes en MP (lo que dejamos automatizado en Sprint 2.12).

**Opción A — Re-ejecutar el último deploy:**
1. Andá a https://github.com/Nipko/sales-structure/actions
2. Buscá el último workflow exitoso (debería ser "Deploy Parallext Engine")
3. Clic en él → botón **"Re-run all jobs"** arriba a la derecha.

**Opción B — Pushear cualquier cambio:**
Cualquier commit a `main` dispara el deploy. Si no tenés nada que pushear, podés hacer un commit vacío:
```bash
git commit --allow-empty -m "chore: trigger deploy for MP sandbox setup" && git push
```

**Mientras corre** (5–8 minutos):
- Seguí el log en la tab Actions → run actual → job "deploy" → step "Deploy to VPS".
- El seed (`prisma/seed-billing-plans.js`) es **create-only**: en una DB fresca crea los 5 planes; si ya existen, los deja intactos porque el panel `/admin/plans` es la fuente de verdad (`--force` restaura los valores de fábrica a propósito). Log en DB fresca:
  ```
  ===> Seeding billing_plans (idempotent upsert)...
  Seeding billing_plans… (create-only: existing plans are left untouched)
    Created emprendedor (USD $21.00, 7d trial, … features)
    Created starter (USD $49.00, 7d trial, … features)
    Created pro (USD $129.00, 15d trial, … features)
    Created enterprise (USD $349.00, 15d trial, … features)
    Created custom (USD $0.00, 0d trial, … features)
  Done.
  ```
  En una DB ya sembrada verás `Skipped <slug> (already exists — panel is source of truth…)` en cada línea. Eso es normal, no un error.

  > El encabezado `===> Seeding billing_plans (idempotent upsert)...` es un `echo` cosmético heredado en `deploy.yml`: el comportamiento real del script **no** es upsert sino **create-only** (línea `Seeding billing_plans… (create-only: …)` que imprime el propio script). No te fíes del rótulo del `echo`, fíjate en la línea del script.

- El sync (`scripts/sync-mp-plans.js`) corre **solo el ciclo mensual** en el deploy (`--country=CO --fx="${PROD_MP_FX_CO:-4200}"`). Importante: el `fx=4200` es **solo un fallback**. Como el seed ya carga `priceLocalOverrides[CO].amountCents`, los montos que se registran salen de esos precios locales fijos, **no** de multiplicar USD×fx. El fx solo se usa si un plan/país todavía no tiene precio local. Procesa los 4 planes de pago (`custom` se salta). Log esperado:
  ```
  ===> Syncing billing plans to MercadoPago (Colombia)...
  Sync plans to MercadoPago — country=CO currency=COP prices=fx=4200
    [emprendedor] creating MP month plan: COP 125.700/mes…
      OK mpPlanId=2c93808...
    [starter] creating MP month plan: COP 276.900/mes…
      OK mpPlanId=...
    [pro] creating MP month plan: COP 757.700/mes…
      OK mpPlanId=...
    [enterprise] creating MP month plan: COP 1.789.800/mes…
      OK mpPlanId=...
  Done.
  ```
  (El encabezado dice `prices=fx=4200` porque se pasó ese flag, pero los montos de arriba salen de los overrides locales, no del fx.)

Si ves algún "FAILED" o el log no muestra esas líneas, saltar a **Troubleshooting** al final.

---

## Paso 6.b — Crear el ciclo ANUAL (no lo hace el deploy)

El deploy solo sincroniza el ciclo **mensual**. Si no corrés este paso, MP queda con **4 planes mensuales y 0 anuales**, y cualquier intento de suscribir a alguien al plan anual falla porque no existe el `preapproval_plan` correspondiente.

El anual es un `preapproval_plan` **separado** (frecuencia 12 meses). El monto sale **exclusivamente** de `priceLocalOverrides[CO].annual.amountCents` (el total del año, ya con el ~15% de descuento seedeado) — el anual **no** tiene fuente USD/FX, así que si no está el precio anual local, el sync lo saltea con `no annual price in DB`.

Dos formas de crearlos (elegí una):

**Opción A — Por SSH (los 4 planes de una):**
```bash
docker exec parallext-api node scripts/sync-mp-plans.js --country=CO --cycle=annual
```
(`--cycle=annual` y `--cycle=year` son equivalentes. No hace falta `--fx`: el anual usa el precio local seedeado.)

**Opción B — Desde el panel (`/admin/plans`), plan por plan:**
```
POST /billing-admin/plans/emprendedor/sync-mp   { "country": "CO", "cycle": "year" }
POST /billing-admin/plans/starter/sync-mp        { "country": "CO", "cycle": "year" }
POST /billing-admin/plans/pro/sync-mp            { "country": "CO", "cycle": "year" }
POST /billing-admin/plans/enterprise/sync-mp     { "country": "CO", "cycle": "year" }
```

Ambos caminos son **idempotentes por ciclo**: si el anual ya existe, se saltea (pasá `force:true` / `--force` solo si cambiaste el precio y querés recrearlo — MP no borra planes, así que el viejo queda huérfano). El id anual se guarda en `priceLocalOverrides[CO].annual.mpPlanId` (el mensual vive en `mpPlanId` top-level + `priceLocalOverrides[CO].mpPlanId`). `custom` responde 400 `custom_not_syncable` — es sales-led.

---

## Paso 7 — Verificar que los planes se crearon

### 7.1 En nuestra base de datos

SSH a la VPS y correr:
```bash
docker exec parallext-postgres psql -U parallext -d parallext_engine -c \
  "SELECT slug, price_usd_cents, trial_days, mp_plan_id, price_local_overrides FROM billing_plans ORDER BY sort_order;"
```

**Esperado**: 5 filas. El `amountCents` de cada override está en **centavos** (MP cobra `amountCents/100`), y el precio anual vive en el sub-objeto `annual`.

| slug | price_usd_cents | trial_days | mp_plan_id | price_local_overrides (CO) |
|---|---|---|---|---|
| emprendedor | 2100 | 7 | 2c93...www | `{"currency":"COP","amountCents":12570000,"mpPlanId":"2c93...","annual":{"amountCents":128214000,"mpPlanId":"2c93..."}}` |
| starter | 4900 | 7 | 2c93...xxx | `{"currency":"COP","amountCents":27690000,"mpPlanId":"2c93...","annual":{"amountCents":282438000,"mpPlanId":"2c93..."}}` |
| pro | 12900 | 15 | 2c93...yyy | `{"currency":"COP","amountCents":75770000,"mpPlanId":"...","annual":{"amountCents":772854000,"mpPlanId":"..."}}` |
| enterprise | 34900 | 15 | 2c93...zzz | `{"currency":"COP","amountCents":178980000,"mpPlanId":"...","annual":{"amountCents":1825596000,"mpPlanId":"..."}}` |
| custom | 0 | 0 | `(null)` | `{}` |

Notas:
- Si **solo** corriste el deploy (Paso 6) y todavía no el Paso 6.b, el sub-objeto `annual` tendrá `amountCents` (viene del seed) pero **sin** `mpPlanId` — eso es esperado hasta que sincronices el ciclo anual.
- Si `mp_plan_id` (mensual) está en null para los 4 planes de pago → el sync mensual no corrió o falló. Ir a Troubleshooting.

### 7.2 En el dashboard de MP

1. Andá a **https://www.mercadopago.com.co/developers** → tu aplicación → **"Suscripciones"** (menú lateral).
2. Después del deploy (mensual) deberías ver **4 planes**:
   - "Emprendedor — Parallly CO"
   - "Starter — Parallly CO"
   - "Pro — Parallly CO"
   - "Enterprise — Parallly CO"
3. Si además corriste el Paso 6.b, vas a ver **4 más** con el sufijo "(Anual)" (ej. "Pro — Parallly CO (Anual)"), con período de 12 meses.
4. Clic en cualquiera para ver los detalles: precio en COP, período (1 mes o 12 meses). El trial **no** se define en el plan sino al crear la suscripción del tenant.

Si no ves los planes → el sync no los creó. Revisar el log del deploy.

---

## Paso 8 — Probar el webhook con el Simulator

Este es el test que valida que las firmas HMAC funcionan end-to-end.

1. En tu aplicación MP → **Webhooks** → botón **"Simular"** (o "Simulador de notificaciones").
2. Te va a pedir:
   - **Topic**: elegí `payment`.
   - **ID de recurso**: poné cualquier número, ej. `1234567890`. No tiene que ser real.
   - (Opcional) **Evento**: elegí `payment.created`.
3. Clic en **"Enviar notificación"**.
4. Inmediatamente, desde la VPS:
   ```bash
   docker logs parallext-api --tail 80 | grep -iE 'webhook|billing'
   ```

### Resultados posibles

**✅ Éxito parcial (esperado)**:
```
[Webhook] mercadopago parseWebhookEvent failed: ...404 payment not found...
```
Esto **significa que la firma HMAC pasó**: el receiver solo llega al paso de `parseWebhookEvent` (que busca el pago en MP) si la firma verificó primero. El error "404 payment not found" es normal porque el ID `1234567890` no existe en MP. Lo que queríamos validar — que tu `MP_WEBHOOK_SECRET` coincide con lo que firma MP — está confirmado. (No hay una línea "webhook recibido" de éxito: el controlador solo loguea en los caminos de error/duplicado, y en este caso el único log emitido es el `parseWebhookEvent failed`.)

**❌ Fallo de firma (reparable)**:
```
[Webhook] mercadopago signature rejected — request-id=abc-123
```
La firma no coincide. Probablemente:
- El `MP_WEBHOOK_SECRET` en GitHub Secrets no es el mismo que el Signing Key del dashboard de MP.
- **Solución**: volver al Paso 4.6, regenerar el Signing Key, copiar el nuevo, actualizar el GitHub Secret `MP_WEBHOOK_SECRET`, redeployar.

**❌ No llega nada al log**:
El webhook no llegó al servidor. Probablemente:
- La URL está mal escrita en el dashboard de MP (revisar Paso 4.2).
- El endpoint está caído. Probar:
  ```bash
  # HEAD/GET → 404: el endpoint es POST-only (@Post(':provider')), no hay ruta GET.
  curl -I https://api.parallly-chat.cloud/api/v1/billing/webhook/mercadopago      # 404 Not Found

  # POST sin firma válida → 401 invalid_signature. Eso PRUEBA que el endpoint está
  # vivo y verificando la firma (que es justo lo que queremos confirmar).
  curl -sS -X POST -d '{}' https://api.parallly-chat.cloud/api/v1/billing/webhook/mercadopago
  ```
  Un `404` en el GET no significa que esté caído — significa que la ruta solo acepta POST. Si el POST devuelve `502/504` o timeout, ahí sí el servicio está caído.

> **Nota de seguridad — provider `mock`.** El receiver acepta `mercadopago` y `stripe` en producción; el provider `mock` (cuya verificación de firma siempre pasa) queda **rechazado en prod** (`501 unknown_provider`). Así, un POST anónimo a `/billing/webhook/mock` no puede forjar un `PAYMENT_SUCCEEDED` y activar una suscripción gratis. En dev sí está habilitado para tests.

---

## Panel de MercadoPago (super admin)

Todo lo que hasta acá se hizo por SSH tiene su equivalente en el panel **`/admin/plans`** (y vistas asociadas), sobre el controlador `billing-admin` (`@Roles('super_admin')`). Útil para operar sin entrar a la VPS. Endpoints principales:

| Acción | Endpoint | Notas |
|---|---|---|
| **Badge sandbox/producción** | `GET /billing-admin/provider-status` | Devuelve `environment` (`sandbox`/`production`/`unconfigured`, inferido por prefijo `TEST-` vs `APP_USR-` del `MP_ACCESS_TOKEN`), `configured` y `webhookConfigured`. Confirmá el entorno **antes y después** de un cutover de credenciales. |
| **Editar precio/plan** | `PUT /billing-admin/plans/:slug` | Fuente de verdad de precios/features/overrides (el seed es create-only y **no** pisa esto). Valida `features` contra el registry y audita el cambio. **Ojo:** editar el precio acá solo cambia lo que se **muestra**; MP cobra el monto congelado en el `preapproval_plan`, así que el precio nuevo no es real hasta correr `sync-mp` con `force`. |
| **Sincronizar a MP** | `POST /billing-admin/plans/:slug/sync-mp` | Body: `{ country?, cycle?: 'month'\|'year', force?, fx? }`. Registra/recrea el `preapproval_plan` de ese plan+país+ciclo. Idempotente por ciclo (skip si ya existe salvo `force:true`). `custom` → 400 `custom_not_syncable`. |
| **Reconciliar (global)** | `POST /billing-admin/reconcile` | Body `{ scope?: 'full'\|'past_due' }`. Fuerza un poll al proveedor en vez de esperar el cron horario/diario — ideal justo después de un cutover para confirmar que DB y MP coinciden. |
| **Reconciliar (un tenant)** | `POST /billing-admin/tenants/:tenantId/reconcile` | Sincroniza la suscripción de un tenant contra el proveedor. |
| **Refund inline** | `POST /billing-admin/payments/:paymentId/refund` | Body `{ amountCents?, reason? }`. Reembolso total o parcial; queda auditado. |
| **Vistas cross-tenant** | `GET /billing-admin/subscriptions \| /payments \| /events` | Las consultas psql-por-SSH del runbook, ahora paginadas en el panel (filtros por status/provider/plan/tenant). |

Todas las escrituras (edición de plan, sync, reconcile) dejan registro en `audit_log` con el **actor real** (resuelto por `auditActor()`, correcto incluso bajo impersonación). Ver [`docs/superadmin-governance.md`](./superadmin-governance.md).

---

## Paso 9 (opcional) — Test con tarjetas y usuarios de prueba

La UI self-serve **ya está construida**: la selección de plan en el onboarding y la página **`/admin/settings/billing`** (tarjeta registrada, facturas, upgrade/downgrade). Así que este test se puede hacer **end-to-end hoy** — ya no es un "cuando llegue el Sprint 3". El Paso 8 confirma la firma; este paso confirma el flujo completo signup → trial → cobro.

Pasos:
1. Crear 2 cuentas de prueba en MP (un "test seller" y un "test buyer") desde el portal developers.
2. Desde el dashboard de Parallly, hacer signup y elegir un plan. **Nota:** `pro` y `enterprise` tienen `requiresCardForTrial=true`, así que el checkout **pide tarjeta para iniciar el trial**; `emprendedor` y `starter` no (trial sin tarjeta). El `custom` es sales-led (no se cobra por MP).
3. Registrar una tarjeta de prueba. MP acepta varios números, pero el comportamiento depende del **nombre del titular**:
   - `APRO` → cobro aprobado
   - `FUND` → fondos insuficientes
   - `SECU` → CVV inválido
   - `EXPI` → tarjeta vencida
   - `OTHE` → rechazo genérico

Número de prueba que siempre funciona: Visa `4509 9535 6623 3704`, CVV `123`, vencimiento `11/30`. Lo que decide el resultado es el nombre del titular que pongas.

---

## ¿Qué sigue después de este manual?

Verificado el Paso 8 (firma HMAC pasa), la plataforma ya tiene la UI self-serve construida (onboarding con selección de plan, `/admin/settings/billing`, emails de trial/cobro, enforcement de quotas por plan). Lo que queda es operativa y cutover:

### Créditos SMS — comparten el mismo webhook
La compra de paquetes de créditos SMS (modelo reseller monetizado, ver [`docs/sms-monetization-packages-2026-07.md`](./sms-monetization-packages-2026-07.md)) usa el **mismo** endpoint `/billing/webhook/mercadopago`. La diferencia es el tipo: las suscripciones usan `preapproval`/`preapproval_plan`; los créditos SMS son un **pago único** (Checkout Pro / `Preference`) que llega como topic `payment` y se resuelve en `BillingService.creditSmsPackageOrder`. Por eso el mismo secret y la misma verificación de firma cubren ambos flujos — no hay que configurar un webhook aparte.

### Crear/verificar el ciclo anual
Si todavía no lo hiciste, correr el **Paso 6.b** para que exista el `preapproval_plan` anual de cada plan. Sin eso, nadie puede suscribirse al ciclo anual.

### Si querés agregar otro país
Ver [`docs/billing-runbook.md` → Sección 3](./billing-runbook.md#3-agregar-un-país-nuevo). En el deploy, duplicar la línea del sync con el ISO + su FX (los secrets `MP_FX_*` ya están cableados); el anual del nuevo país necesita su propio `annual.amountCents` seedeado.

### Si querés pasar a producción
Ver [`docs/billing-runbook.md` → Sección 7](./billing-runbook.md#7-credenciales-sandbox-vs-producción). Después del cutover, confirmar el badge con `GET /billing-admin/provider-status` (debe decir `production`) y correr un `POST /billing-admin/reconcile`.

---

## Troubleshooting

### El log del deploy no muestra las secciones "Seeding billing_plans" ni "Syncing billing plans..."
El deploy corrió con una versión vieja del workflow. Verificá en `.github/workflows/deploy.yml` que el job `deploy` incluya los pasos `Seeding billing_plans` y `Syncing billing plans to MercadoPago (Colombia)`. Si tu `main` es anterior a esos pasos, hacé merge/rebase y pusheá de nuevo.

### "FAILED: MP returned no plan id" en el sync
El sync llamó a MP pero recibió error. Mirá el body de respuesta en el log. Causas comunes:
- **currency_id no válido**: la cuenta MP es de un país distinto al que estás sincronizando. Ej. si tu cuenta es de Argentina y corrés `--country=CO`, MP rechaza porque no podés crear planes COP con credenciales argentinas.
- **Access Token expirado**: regenerar desde el dashboard y actualizar el Secret.

### "MP_ACCESS_TOKEN is not set" en el sync
El GitHub Secret no llegó al container. Revisar:
1. El Secret se llama exactamente `MP_ACCESS_TOKEN` (case-sensitive).
2. En `deploy.yml`, `MP_ACCESS_TOKEN` se escribe al `.env` (línea `echo "MP_ACCESS_TOKEN=${PROD_MP_ACCESS_TOKEN}"`) y `PROD_MP_ACCESS_TOKEN` está en la lista `envs:` del step SSH. Si agregaste el secret pero sigue faltando, es que el workflow no lo pasa al container.

### Los planes están duplicados en MP
Normalmente no pasa porque el script skip-ea plans ya sincronizados (idempotente por ciclo). Si pasó:
1. Entrá al dashboard de MP → Suscripciones → borrar los duplicados manualmente (MP no permite borrar por API, solo desde el panel).
2. Limpiar el estado en la DB (incluye `emprendedor`; borra tanto el id mensual como el anual). El `annual.amountCents` seedeado se preserva:
   ```bash
   docker exec parallext-postgres psql -U parallext -d parallext_engine -c \
     "UPDATE billing_plans SET mp_plan_id = NULL, price_local_overrides = '{}'::jsonb WHERE slug IN ('emprendedor','starter','pro','enterprise');"
   ```
   > Ojo: vaciar `price_local_overrides` a `{}` también borra el `annual.amountCents`. Si querés conservar los precios locales y solo soltar los ids de MP, re-corré el seed con `--force` después (restaura los overrides de fábrica) o editá el JSON quirúrgicamente en vez del `= '{}'`.
3. Re-correr el deploy o el sync manual (mensual + `--cycle=annual`) — esta vez crea los plans limpios.

### No sé qué deploy corrió ni cuándo
En la VPS:
```bash
docker inspect parallext-api --format 'Image: {{.Image}} | Started: {{.State.StartedAt}}'
```
Eso te da la imagen + hora de arranque del container actual.

Para ver la historia de deploys: https://github.com/Nipko/sales-structure/actions
