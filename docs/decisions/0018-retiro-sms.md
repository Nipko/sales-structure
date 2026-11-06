# 0018 — Retiro completo de SMS: código, rutas, pantallas e interruptor; las tablas esperan una fase 2

- Estado: aprobada
- Fecha: 2026-11-05 · Decide: dueño del producto (frente K3) · Autor: Claude (K3c)
- Ámbito: `apps/api/src/modules/{sms-credits,sms-notifications,billing,channels,health,broadcast,handoff,customer-portal,auth}`, `apps/dashboard` (pantallas, menú, `api.ts`, mensajes), `packages/shared` (acceso a páginas), la KB de Assist y la documentación. **No** toca tablas, columnas ni filas.

## Contexto

SMS se apagó en agosto de 2026 por costo (el interruptor de plataforma `sms.platform_enabled` quedó apagado por defecto y créditos, checkout y notificaciones respondían `sms_product_retired`), pero el código quedó como legado: el módulo de créditos y su ledger, el de avisos por SMS, el checkout de paquetes, el adaptador Twilio con su webhook entrante, el envío de alertas de operación por SMS, tres pantallas y sus textos en cuatro idiomas. ADR 0017 lo dejó «para decisión del dueño». Es un entorno de prueba sin clientes reales: nunca se vendieron créditos.

## Decisión

Se retira todo lo que era el producto SMS:

1. **API.** Se eliminan `sms-notifications/` (configuración, oyente del handoff, emisor por la cuenta Twilio del tenant), `sms-credits/` (créditos, ledger, paquetes, interruptor `sms.platform_enabled`), `billing/sms-checkout.*` y su barrido de órdenes cada 15 minutos, el adaptador `channels/sms/` con el webhook `POST /channels/webhook/sms/:phoneNumber` y las rutas `/channels/sms/{connect,status,disconnect,test}`, y `health/sms-alert.service.ts` (las alertas de operación siguen por email y Telegram; el canal `sms` sale de la configuración de alertas). La facturación ya no intercepta pagos de paquetes SMS.
2. **Lo que llegue igual** se cierra sin enviar: un trabajo de la cola saliente con canal `sms` termina como `skipped:sms_retired`, un destinatario SMS de una campaña heredada como `sms_retired`, y un código del portal del cliente pedido por teléfono se suprime como `portal_sms_retired`. El handoff ya no anuncia el destino `sms`.
3. **Dashboard.** Se eliminan `/admin/channels/sms`, `/admin/sms-packages` y `/admin/settings/integrations/sms-notifications`, su entrada de menú y de navegación, los métodos de `api.ts`, la regla de acceso de `packages/shared`, la opción SMS de recall, nurturing y alertas de operación, y las claves de mensajes en es/en/pt/fr. Los correos de bienvenida dejan de prometer SMS.
4. **Documentación y Assist** dicen que SMS está retirado, sin interruptor ni rutas.

### Lo que se queda, y por qué

- **Las tablas `sms_package_orders`, `sms_credit_ledger` y `sms_credit_balances`** siguen en la base y en `TENANT_PUBLIC_PURGE_ORDER` (`prisma.service.ts`), que las sigue borrando en el purge de un tenant. Sus modelos Prisma (`SmsPackageOrder`, `SmsCreditLedger`, `SmsCreditBalance`) se conservan sin lector: el purge usa SQL por nombre y no los necesita, pero quitarlos dejaría el esquema Prisma distinto de la base y un `prisma migrate dev` generaría un `DROP` no aprobado. Salen juntos, tablas y modelos, en la fase 2.
- **Un stub en `sms-credits/`** (`SmsCreditsModule` con `TenantNotificationSmsService`): `conversations/chat-identity.service.ts` y `conversations.module.ts` lo importan para el código de verificación de identidad, y `conversations/` queda fuera de este retiro. El stub nunca envía (`isAvailable()` es `false` y `send()` rechaza con un motivo que cierra el desafío como suprimido). Sale cuando se quite ese import.
- **El respaldo SMS del 2FA** (`POST /auth/2fa/send-sms`, columnas `two_factor_sms_*`, salida `auth.access_code_sms`): es un concepto OTP, no el producto. Su transporte (`PlatformSmsService`) ya no habla con Twilio y falla siempre antes de contactar a un proveedor, como hacía con el interruptor apagado; la persona ve «usa el email». Volver a ofrecerlo exige un transporte nuevo y otro ADR.
- **`'sms'` como valor** en `ChannelType`, en el `CHECK` de `agent_handoff_effects`, en `opt_out_records` y en filas históricas: describe datos que existen.
- **El catálogo de planes** (`smsNotifications`, `maxChannelAccounts.sms`, `'sms'` en `channels` del registro y del seed): los planes guardados en `billing_plans` los llevan y el registro rechaza claves desconocidas al editar. Limpiarlo es un cambio de datos del catálogo que va con la fase 2.
- **`deploy.yml`** sigue escribiendo `SMS_ALERT_*` y `SMS_SENDER_ID` en `.env`; ningún código los lee. Se quitan cuando se toque ese workflow.

### Fase 2 (pendiente, con aprobación y respaldo, una por una)

`DROP TABLE` de `sms_package_orders`, `sms_credit_ledger` y `sms_credit_balances` (migración en dos despliegues según expand-contract: primero sacarlas de `TENANT_PUBLIC_PURGE_ORDER` y de `schema.prisma`, después el `DROP`), más la limpieza del catálogo de planes y de las variables de `deploy.yml`.

## Consecuencias

- Las rutas retiradas responden 404; los marcadores viejos de las tres pantallas también.
- `external-effect-inventory.ts` y el inventario generado de productores salientes dejan de listar los productores SMS (`handoff.agent_sms`, `channel.sms.conversational`).
- Un archivo borrado se recupera con `git show <commit>^:<ruta>`.

## Alternativas descartadas

- **Dejar el interruptor y el código «por si acaso»:** era exactamente la lista de seis lugares que había que recordar apagar; el código muerto seguía exigiendo mantenimiento en specs, inventarios y textos.
- **Borrar las tablas en este cambio:** un `DROP` necesita aprobación del dueño una por una y respaldo (AGENTS.md, expand-contract); va en la fase 2.
- **Retirar también el 2FA por SMS:** cambia el flujo de acceso y su interfaz; no es parte del producto SMS.
