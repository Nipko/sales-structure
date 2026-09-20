# Suscripciones internacionales con Stripe

Implementación local, septiembre de 2026. La activación real requiere configurar la cuenta, probar en sandbox y desplegar; tener una cuenta Stripe no acredita por sí solo esas condiciones.

## Estado comprobado antes del cambio

Se consultó el catálogo público de producción para CO, US y MX. La corrección comercial del 14 de septiembre **sí está aplicada**:

| Plan | Colombia mensual | Internacional mensual | Colombia anual |
|---|---:|---:|---:|
| Emprendedor | COP 129.900 | USD 29 | COP 1.402.920 |
| Starter | COP 299.900 | USD 69 | COP 3.238.920 |
| Pro | COP 799.900 | USD 179 | COP 8.638.920 |
| Enterprise | COP 2.199.900 | USD 499 | A cotizar |

Colombia devolvió `monthlyAvailable: true`; US y MX devolvieron `providerConfigured: false` y `monthlyAvailable: false`. Custom conserva cotización. Enterprise anual COP supera el límite Int32 del contrato monetario existente y no se habilita con este cambio. Estos importes describen la observación; las filas actuales de `billing_plans` siguen siendo la autoridad.

La base existente de Stripe tenía SDK, adapter y webhook, pero no un checkout alojado completo. El catálogo aún exigía identificadores de Mercado Pago, la lista de países confundía la sede del comercio Stripe con el país de sus clientes y los secretos Stripe no sobrevivían a la regeneración del `.env` del deploy.

## Recorrido del cliente

1. La landing consulta `GET /api/v1/billing/public/market`. El país de Cloudflare es una sugerencia; la elección explícita del usuario prevalece. Una ubicación desconocida exige selección y no se convierte silenciosamente en Colombia. El endpoint no se almacena en caché compartida.
2. La selección viaja al registro/onboarding. El servidor valida el país de facturación admitido. El país de operación de la empresa y el idioma no sustituyen esta confirmación.
3. Las nuevas suscripciones de CO resuelven exclusivamente a Wompi; las de otros países admitidos resuelven exclusivamente a Stripe. Los interruptores de activación permanecen vigentes: un proveedor desactivado no provoca un cobro por el otro.
4. Wompi conserva tokenización, aceptaciones, fuentes de pago, motor interno, renovaciones y conciliación existentes. Stripe usa Checkout alojado y su calendario nativo; sus suscripciones nunca se arman en el motor Wompi.
5. El retorno del navegador desde Stripe no concede acceso por sí solo. Webhooks firmados y comprobación canónica enlazan cliente, suscripción, plan, importe, moneda y periodo con la operación autorizada. El portal Stripe administra el método, el historial y la cancelación; los cambios de plan pasan por Parallly.
6. Una suscripción existente conserva su proveedor. Cambiar el país no traslada una tarjeta o mandato ni migra automáticamente una suscripción.

## Precios y monedas

Para Stripe, el mensual es exactamente `billing_plans.priceUsdCents`, en USD, para todos los países internacionales admitidos. Una conversión FX o un override histórico MXN/BRL/etc. no autoriza un importe de Checkout.

En Superadmin → Planes se editan al mismo tiempo dos tarifas independientes por plan: Colombia mensual/anual en COP e internacional mensual/anual en USD. El mensual colombiano se guarda en `priceLocalOverrides.CO.amountCents`; el mensual internacional en `priceUsdCents`. Las páginas de precios de la landing consultan el catálogo según el país detectado por Cloudflare o confirmado por la persona y muestran el código COP o USD junto al importe. Si no hay país confiable, solicitan elegirlo antes de mostrar cifras.

El anual internacional requiere un importe explícito, editable en Planes → Internacional: Stripe en USD. Se guarda en `priceLocalOverrides.USD.annual.amountCents` con moneda USD. Un anual USD explícito del país también puede definir su contrato. No se calcula un descuento nuevo ni se habilita un anual a partir del precio COP. Las sesiones pendientes conservan el importe autorizado; los cambios futuros del catálogo no reescriben pagos históricos ni precios remotos de suscripciones ya activas.

## Separación fiscal y de credenciales

- Wompi/Stripe de este flujo cobran **Parallly → tenant**. Los enlaces **tenant → cliente** siguen en `tenant-payments` con credenciales propias; no participan en la suscripción.
- Meta mantiene su facturación de WhatsApp independiente.
- Los pagos Stripe guardan país al pagar y ambiente. La emisión fiscal usa ese país histórico; editar luego el perfil no transforma el pago en una operación colombiana.
- En `CO_LOCAL`, Colombia conserva Factus/DIAN. Una suscripción internacional no se envía a Factus por el mero hecho de que Parallly también tenga un comercio Wompi colombiano.
- Falta confirmar el titular legal y país de la cuenta Stripe para configurar su emisor fiscal. Hasta entonces la emisión internacional queda registrada como `blocked_config` con `international_fiscal_issuer_not_configured`. Esto no afirma que no exista obligación de facturar; deja la decisión pendiente y auditable.
- **No activar el modo global `US_REMOTE` para resolver Stripe**: ese modo también cambia el emisor de Colombia. Stripe como procesador tampoco implica que sea Merchant of Record.

## Configuración y activación

1. Confirmar entidad titular, país de la cuenta Stripe, moneda de liquidación y datos del emisor. Resolver la política de documento internacional sin cambiar el emisor colombiano.
2. En un entorno de prueba aislado, configurar `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_WEBHOOK_SECRET=whsec_…` y `DASHBOARD_URL` del entorno. Mantener sus webhooks y datos separados de producción.
3. Registrar el endpoint `/api/v1/billing/webhook/stripe` de la API correspondiente. Escuchar `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed` y `charge.refunded`. Las dos señales de éxito de una misma factura se deduplican por factura. Usar payloads snapshot y la versión compatible con el SDK instalado; el adapter admite campos de factura y periodos anteriores y posteriores a Basil.
4. Activar Stripe en Planes → Proveedores (`billing.providers_enabled.stripe=true`). El interruptor permanece apagado por defecto; la disponibilidad también exige las credenciales y el secreto de webhook.
5. Probar alta con/sin trial, cancelación del checkout, autenticación del pago, eventos duplicados/desordenados, renovación fallida y recuperada, cambio de plan, portal y cancelación al fin del periodo. Verificar que un retorno `?stripe=success` sin webhook no activa acceso y que Wompi continúa operando para Colombia.
6. Para producción, añadir los secretos de GitHub `STRIPE_SECRET_KEY` (`sk_live_…`) y `STRIPE_WEBHOOK_SECRET` del endpoint `https://api.parallly-chat.cloud/api/v1/billing/webhook/stripe`. El workflow los transmite a API/worker y rechaza pares parciales o claves test en el deploy productivo.
7. `BILLING_TRUST_COUNTRY_HEADER=true` solo es válido cuando el origen está restringido a Cloudflare. El despliegue mediante Tunnel lo configura; en desarrollo u origen expuesto el valor por defecto es `false`. No usar este encabezado para autorización de cobros.
8. Desplegar, comprobar catálogo CO/internacional y readiness de proveedores, y completar una prueba controlada del comercio real antes de abrir ventas.

No se guardan secretos en este documento, el navegador ni el repositorio. No se ejecutaron cargos, cambios de configuración ni despliegues de producción durante esta implementación.

## Límites explícitos de esta entrega

- Una suscripción Stripe remota ya cancelada definitivamente no abre otra automáticamente. Requiere gestión de soporte para evitar duplicar contratos; la recuperación de una suscripción vigente tras pagar un impago sí admite el comprobante Stripe del periodo correspondiente.
- Una prueba local con menos de 48 horas restantes no se convierte anticipadamente mediante Checkout, que exige ese mínimo para `trial_end`; debe completarse al vencer. Se informa al usuario y no se acorta la prueba ni se cobra antes de lo prometido.
- No se extiende una prueba Stripe remota modificando solo la fecha local, ni se ofrece pausa de cobro como si pausara también la suscripción. Esas operaciones quedan bloqueadas explícitamente.
- Las suscripciones históricas de otro proveedor no se migran por cambiar de país. Una prueba histórica con un proveedor incompatible requiere revisión de soporte antes de autorizar un nuevo mandato.
- Las pruebas locales verifican contratos, firma real del SDK, idempotencia y límites de aislamiento con dobles de los servicios remotos. No sustituyen una prueba completa contra la cuenta Stripe sandbox ni certifican la configuración fiscal del emisor.

## Referencias

Validación local completada: TypeScript sin errores en API, dashboard y landing; arranque de AppModule sin errores de inyección; pruebas focalizadas de catálogo/país/precios, alta Stripe, checkout, firma real del SDK, webhooks desordenados, motor Wompi, conciliación, fiscal y recuperación de acceso. Las pruebas React incluyen el flujo Stripe y el bloqueo de un proveedor histórico incompatible. Se verificaron los cuatro idiomas, los contratos de contenido de la landing, lint de los archivos revisados y sintaxis YAML del deploy. No se afirma que se haya ejecutado toda la suite del monorepo ni una prueba E2E con servicios reales.

- [Stripe: subscriptions with hosted Checkout](https://docs.stripe.com/payments/checkout/build-subscriptions)
- [Stripe: webhook signature and raw body](https://docs.stripe.com/webhooks)
- [Corrección comercial del 14 de septiembre](audits/2026-09-14/plan-economics-implementation.md)
- [Operación Wompi](billing-runbook.md)
