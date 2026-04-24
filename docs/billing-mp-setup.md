# MercadoPago — Configuración y pruebas iniciales (sandbox)

Guía paso a paso para dejar MercadoPago funcionando en Parallly **con credenciales de prueba** (sandbox). Sin plata real, sin clientes reales. Para el cutover a producción, ver [`docs/billing-runbook.md` → Sección 7](./billing-runbook.md#7-credenciales-sandbox-vs-producción).

---

## ¿Qué vas a lograr con esta guía?

Al terminar, vas a tener:
1. Una cuenta de desarrollador en MP con una aplicación creada.
2. Credenciales de sandbox (Access Token + Webhook Secret + Public Key) cargadas en GitHub Secrets.
3. El webhook apuntando al endpoint de Parallly con los 4 topics correctos.
4. Los 4 planes de Parallly sincronizados en MP sandbox de Colombia.
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
- Vas a ver aparecer tres secciones nuevas en el log:
  ```
  ===> Seeding billing_plans (idempotent upsert)...
    Created starter (USD $49.00, 7d trial)
    Created pro (USD $129.00, 15d trial)
    Created enterprise (USD $349.00, 15d trial)
    Created custom (USD $0.00, 0d trial)

  ===> Syncing billing plans to MercadoPago per configured country...
    Sync country=CO fx=4200
      [starter] creating MP plan: COP 205800.00, trial=7d…
        OK mpPlanId=2c93808...
      [pro] creating MP plan: COP 541800.00, trial=15d…
        OK mpPlanId=...
      [enterprise] creating MP plan: COP 1465800.00, trial=15d…
        OK mpPlanId=...
  ```

Si ves algún "FAILED" o el log no muestra esas líneas, saltar a **Troubleshooting** al final.

---

## Paso 7 — Verificar que los planes se crearon

### 7.1 En nuestra base de datos

SSH a la VPS y correr:
```bash
docker exec parallext-postgres psql -U parallext -d parallext_engine -c \
  "SELECT slug, price_usd_cents, trial_days, mp_plan_id, price_local_overrides FROM billing_plans ORDER BY sort_order;"
```

**Esperado**: 4 filas.

| slug | price_usd_cents | trial_days | mp_plan_id | price_local_overrides |
|---|---|---|---|---|
| starter | 4900 | 7 | 2c93...xxx | `{"CO": {"currency":"COP","amountCents":20580000,"mpPlanId":"2c93..."}}`  |
| pro | 12900 | 15 | 2c93...yyy | `{"CO": {...}}` |
| enterprise | 34900 | 15 | 2c93...zzz | `{"CO": {...}}` |
| custom | 0 | 0 | `(null)` | `{}` |

Si `mp_plan_id` está en null para los 3 pagos → el sync no corrió o falló. Ir a Troubleshooting.

### 7.2 En el dashboard de MP

1. Andá a **https://www.mercadopago.com.co/developers** → tu aplicación → **"Suscripciones"** (menú lateral).
2. Deberías ver una lista con 3 planes:
   - "Starter — Parallly CO"
   - "Pro — Parallly CO"
   - "Enterprise — Parallly CO"
3. Clic en cualquiera para ver los detalles: precio en COP, período de 1 mes, trial gratis (si corresponde).

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
[Webhook] Received mercadopago webhook
[Webhook] mercadopago parseWebhookEvent failed: ...404 payment not found...
```
Esto **significa que la firma HMAC pasó** (llegaste al paso de parse). El error de "404 payment not found" es normal porque el ID `1234567890` no existe en MP. Lo que queríamos validar — que tu `MP_WEBHOOK_SECRET` coincide con lo que firma MP — está confirmado.

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
  curl -I https://api.parallly-chat.cloud/api/v1/billing/webhook/mercadopago
  ```
  Debería devolver `405 Method Not Allowed` (porque GET no está soportado; POST sí).

---

## Paso 9 (opcional) — Test con tarjetas y usuarios de prueba

Esto lo hacemos cuando tengas la UI del dashboard lista (Sprint 3). **Podés saltearlo por ahora** — el Paso 8 ya confirma que la infraestructura funciona.

Cuando lleguemos a esto, los pasos serán:
1. Crear 2 cuentas de prueba en MP (un "test seller" y un "test buyer") desde el portal developers.
2. Desde el dashboard de Parallly (cuando esté en Sprint 3), hacer signup con una de esas cuentas.
3. Registrar una tarjeta de prueba. MP acepta varios números, pero el comportamiento depende del **nombre del titular**:
   - `APRO` → cobro aprobado
   - `FUND` → fondos insuficientes
   - `SECU` → CVV inválido
   - `EXPI` → tarjeta vencida
   - `OTHE` → rechazo genérico

Número de prueba que siempre funciona: Visa `4509 9535 6623 3704`, CVV `123`, vencimiento `11/30`. Lo que decide el resultado es el nombre del titular que pongas.

---

## ¿Qué sigue después de este manual?

Una vez verificado el Paso 8 (firma HMAC pasa):

### Si Sprint 3 todavía no arrancó
Avísame y arrancamos a codear la UI:
- Paso del onboarding para elegir plan
- Página `/admin/settings/billing` con tarjeta registrada, facturas, upgrade/downgrade
- Disparo real de los emails de trial/cobro
- Enforcement del resto de quotas (services, automations, broadcasts, AI messages)

### Si ya estás en Sprint 3
Los flujos de signup → trial → cobro los vas a poder probar end-to-end con test cards (Paso 9).

### Si querés agregar otro país
Ver [`docs/billing-runbook.md` → Sección 3](./billing-runbook.md#3-agregar-un-país-nuevo).

### Si querés pasar a producción
Ver [`docs/billing-runbook.md` → Sección 7](./billing-runbook.md#7-credenciales-sandbox-vs-producción).

---

## Troubleshooting

### El log del deploy no muestra las secciones "Seeding billing_plans" ni "Syncing billing plans..."
El deploy corrió con una versión vieja del workflow. Asegurate de que el último commit en `main` sea `9993efa` o posterior (ese fue el que agregó la automatización). Pushear de nuevo si es necesario.

### "FAILED: MP returned no plan id" en el sync
El sync llamó a MP pero recibió error. Mirá el body de respuesta en el log. Causas comunes:
- **currency_id no válido**: la cuenta MP es de un país distinto al que estás sincronizando. Ej. si tu cuenta es de Argentina y corrés `--country=CO`, MP rechaza porque no podés crear planes COP con credenciales argentinas.
- **Access Token expirado**: regenerar desde el dashboard y actualizar el Secret.

### "MP_ACCESS_TOKEN is not set" en el sync
El GitHub Secret no llegó al container. Revisar:
1. El Secret se llama exactamente `MP_ACCESS_TOKEN` (case-sensitive).
2. El workflow en `main` es el que agregó MP a la lista de envs (commit `d8a03f2` o posterior).

### Los planes están duplicados en MP
Normalmente no pasa porque el script skip-ea plans ya sincronizados. Si pasó:
1. Entrá al dashboard de MP → Suscripciones → borrar los duplicados manualmente.
2. Limpiar el estado en la DB:
   ```bash
   docker exec parallext-postgres psql -U parallext -d parallext_engine -c \
     "UPDATE billing_plans SET mp_plan_id = NULL, price_local_overrides = '{}'::jsonb WHERE slug IN ('starter','pro','enterprise');"
   ```
3. Re-correr el deploy o el sync manual — esta vez crea los plans limpios.

### No sé qué deploy corrió ni cuándo
En la VPS:
```bash
docker inspect parallext-api --format 'Image: {{.Image}} | Started: {{.State.StartedAt}}'
```
Eso te da la imagen + hora de arranque del container actual.

Para ver la historia de deploys: https://github.com/Nipko/sales-structure/actions
