# Notificaciones por SMS — Plan de implementación (Jul 2026)

> Estado: **Fases 1-3 completadas** (1-2 backend+dashboard; 3 backend verificado, falta el botón "enviar SMS" en el login del dashboard). Fase 4 siguiente. Documento vivo; actualizar el checklist por fase al avanzar.

## 1. Objetivo

Añadir **notificaciones transaccionales por SMS** como una capacidad más de la plataforma, para:

1. **Verificación de identidad** (OTP) — 2FA del dashboard y verificación de cliente final.
2. **Handoff IA→humano** — avisar al agente/supervisor cuando la IA escala.
3. **Notificaciones importantes a suscriptores** — recordatorios, confirmaciones, nurturing.
4. **Alertas al super admin** — problemas críticos de la plataforma.

Gateado por plan ("para determinados tipos de cuenta") donde aplica al tenant.

## 2. Decisión arquitectónica central: **WhatsApp‑first + SMS fallback**

Ya tenemos Meta/WhatsApp integrado a fondo y LatAm tiene ~90% de penetración de WhatsApp. El SMS crudo es **caro** (MX ~$0.18, AR ~$0.10, CO/BR ~$0.06 por mensaje) frente a una plantilla de WhatsApp (~$0.005). Por tanto:

- **Notificaciones y OTP al cliente/suscriptor → WhatsApp primero, SMS solo como respaldo** (sin WhatsApp o entrega fallida).
- **Alertas críticas al super admin → SMS directo** (bajo volumen; además da un canal independiente si la propia infra de WhatsApp está caída).

### Dos planos de SMS (no mezclar)

| Plano | Casos | Credenciales Twilio | Pago | Gating |
|---|---|---|---|---|
| **Plataforma (Parallly)** | Alertas super admin, 2FA usuarios dashboard | **Env global** (`SMS_ALERT_*`), como el bot de Telegram de alertas | Nosotros | No aplica |
| **Tenant** | OTP cliente final, aviso handoff a agentes, notificaciones a suscriptores | **Por‑tenant** (`channel_accounts` + `whatsapp_credentials` cifrado) — ya existe | Tenant | Feature `smsNotifications` + cuota |

### Distinción clave: transaccional ≠ conversacional

- **SMS conversacional (canal)** — el cliente escribe por SMS y la IA responde. **Ya está 100% implementado** (`SmsAdapter` Twilio, pipeline outbound, connect/disconnect, webhook). Gateado en `features.channels` (pro/enterprise/custom).
- **SMS transaccional (notificaciones)** — el sistema envía SMS salientes disparados por eventos. **Es lo nuevo de este plan.** Feature independiente `smsNotifications`.

## 3. Operador

**Arranque: Twilio + Twilio Verify.** Self‑serve (lanzamos en días), mejor SDK/DX Node, gestiona el registro regulatorio por país (LOA México, alfanumérico Brasil) y **Twilio Verify trae Fraud Guard** (protección anti *SMS‑pumping*, el mayor costo oculto de un endpoint OTP). Ya está parcialmente integrado (el adapter usa Twilio REST vía `fetch`, sin SDK).

- **Fallback económico a escala:** Plivo o Telnyx (~50% más baratos, API casi calcada) → segundo adaptador.
- **Regional a escala:** Infobip (rutas directas + oficinas LatAm, gestiona papeleo local).
- **Arquitectura objetivo (Fase 4+):** puerto `ISmsProvider` espejando `IChannelAdapter`, con failover por salud estilo `LLMRouter` (circuit breaker). Provider‑agnostic: arrancamos en Twilio y sumamos otros sin tocar la lógica de negocio.

> **Regla dura:** nunca exponer un endpoint de OTP por SMS crudo (sobre todo a MX/AR) sin rate‑limit por número/IP/tenant + protección anti‑pumping. Reutilizar Redis (`incrementRateLimit`) y/o delegar en Twilio Verify.

## 4. Qué se reutiliza (no se construye de cero)

| Pieza | Ubicación |
|---|---|
| Envío SMS Twilio (REST) | `apps/api/src/modules/channels/sms/sms.adapter.ts` |
| Cola outbound (3 retries, rate‑limit por plan) | `apps/api/src/modules/channels/outbound-queue.service.ts` |
| Resolución de credenciales por tenant | `apps/api/src/modules/channels/channel-token.service.ts` (`getChannelToken(tenantId,'sms')`) |
| Patrón OTP (6 díg., TTL Redis, anti‑fuerza‑bruta) | `customer-portal.service.ts`, `auth.service.ts:1068` (`send2FAEmail`/`verify2FA`) |
| Alertas super admin (punto único `alert()`) | `apps/api/src/modules/health/platform-monitor.service.ts:854` |
| Molde de servicio de alerta env‑driven | `apps/api/src/modules/health/telegram-alert.service.ts` |
| Toggle de canales de alerta | `alert-config.service.ts` + `apps/dashboard/src/app/admin/ops/alerts/page.tsx` |
| Notificaciones por evento (`@OnEvent`) | `push/push-listener.service.ts`, `slack/slack-listener.service.ts` (moldes) |
| Opt‑in por tenant (molde) | `slack/slack.service.ts` (`tenant.settings.slack`) |
| Gating por plan | `throttle/plan-features.registry.ts` + `prisma/seed-billing-plans.js` + `TenantThrottleService` |
| Cuota medida con budget‑cap en ¢ | `media-processing/media-throttle.service.ts` (molde) |
| Normalización E.164 | `apps/api/src/common/utils/phone.util.ts` |
| Teléfono de usuarios | `User.phone` (`schema.prisma:86`) — poco poblado hoy |

## 5. Fases

### Fase 1 — Alertas SMS al super admin (plano plataforma) — ✅ **COMPLETADA (Jul 14, 2026)**

MVP autocontenido que valida Twilio end‑to‑end. Solo severidad **crítica**, con toggle y cooldown de 1h por `key` (ya existente) que evita spam.

- [x] `health/sms-alert.service.ts` — nuevo. Env‑driven (`SMS_ALERT_ACCOUNT_SID/AUTH_TOKEN/FROM/TO`), no‑op si falta config. `send(text)` best‑effort a cada número de `SMS_ALERT_TO` (coma‑separado) vía Twilio REST.
- [x] `health.module.ts` — registrado `SmsAlertService` en providers.
- [x] `platform-monitor.service.ts` — inyectado `smsAlert`; en `alert()` tras el bloque Telegram: `if (cfg.channels.sms && severity === 'critical') await this.smsAlert.send(this.toSmsText(...))`. Helper `toSmsText(severity, subject)` compacto (tag + subject + host, ≤480 chars).
- [x] `alert-config.service.ts` — `channels: { email; telegram; sms }`; DEFAULT `sms: false` (opt‑in). Merge genérico.
- [x] `apps/dashboard/src/app/admin/ops/alerts/page.tsx` — interface local + `setChannel` acepta `'sms'` + array `["email","telegram","sms"]` + label "SMS" + nota "solo críticas".
- [x] i18n (`alertConfig`) en `es/en/pt/fr`: `smsCriticalOnly` + `channelsHint` menciona SMS.
- [x] `.env.example` + `.github/workflows/deploy.yml` (3 sitios: mapeo secret→PROD_, lista SSH, generación `.env`).
- [x] Verificado: API `tsc` ✅ · `test:bootstrap` ✅ (DI del AppModule completo). Dashboard `tsc`: solo 3 errores preexistentes de `onborda` (dep no instalada localmente), ninguno del cambio.

**Pendiente del usuario para activar:** (1) cuenta Twilio de plataforma + 1 número emisor; (2) crear los 4 GitHub Secrets `SMS_ALERT_ACCOUNT_SID/AUTH_TOKEN/FROM/TO`; (3) deploy; (4) activar el toggle "SMS" en Centro de Operaciones → Alertas.

### Fase 2 — Handoff IA→humano (plano tenant) — ✅ **COMPLETADA (Jul 15, 2026)**

Módulo nuevo `sms-notifications/`. El aviso de handoff **complementa** los canales que ya disparan en el mismo evento (WebSocket, Push, Slack, email); el SMS es el refuerzo para el agente fuera del dashboard. Requiere cero cambios en `HandoffService` (solo escucha el evento existente).

**Decisión de diseño — SMS directo al agente (no WhatsApp‑first):** el "WA‑first" del plan aplica a destinatarios que son **contactos** del negocio (clientes/suscriptores, Fases 3‑4). Un **agente** es un empleado: notificarlo por el WhatsApp del negocio exigiría una plantilla de utilidad aprobada + tener su número como contacto, lo que es frágil y caro. Para agentes, el canal correcto es **SMS directo** a `users.phone`. Por eso Fase 2 envía SMS directo; el WA‑first se implementa en Fases 3‑4 (clientes/OTP).

- [x] `sms-notifications/sms-sender.service.ts` — `sendToNumber(tenantId, to, body)`: resuelve `getChannelToken(tenantId,'sms')` (token + número emisor del tenant) y reutiliza `SmsAdapter.sendTextMessage`. Best‑effort (nunca lanza). **Reutilizable en Fases 3‑4.**
- [x] `sms-notification-listener.service.ts` — `@OnEvent('handoff.escalated')`: gate de plan → opt‑in del tenant → resuelve teléfono (agente asignado, o admins/supervisores) → SMS en el idioma del tenant.
- [x] `sms-notifications.service.ts` — opt‑in en `tenant.settings.smsNotifications = { enabled, events:{ handoff } }` (molde `SlackService`, default OFF).
- [x] `sms-notification-i18n.ts` — texto corto agente‑facing es/en/pt/fr.
- [x] `sms-notifications.controller.ts` — `GET/PUT /sms-notifications/:tenantId/config` (tenant_admin). Registrado en `app.module.ts`.
- [x] **Gate de plan** `smsNotifications` en `plan-features.registry.ts` + `seed-billing-plans.js` (5 planes: false emprendedor/starter, true pro/enterprise/custom). *Adelantado desde Fase 4* (Fase 2 es el primer consumidor).
- [x] Dashboard: `settings/integrations/sms-notifications/page.tsx` (opt‑in) + item en `_settings-config.ts` + `api.ts` (`get/updateSmsNotificationsConfig`) + i18n en 4 idiomas.
- [x] Verificado: API `tsc` ✅ · `test:bootstrap` ✅ · dashboard `tsc` limpio (salvo `onborda` preexistente) · 4 JSON válidos.

**Pendiente del usuario para activar:** (1) tras deploy correr `node prisma/seed-billing-plans.js` para poblar el flag `smsNotifications` en los planes; (2) el tenant (plan Pro+) conecta su **canal SMS** (Twilio) en Canales; (3) activa el opt‑in en Ajustes → Integraciones → Avisos por SMS; (4) los agentes deben tener `phone` cargado en su perfil.

### Fase 3 — OTP / verificación de identidad — ✅ **BACKEND COMPLETADO (Jul 15, 2026)**

**Restricción de Meta descubierta:** enviar un OTP por WhatsApp de forma proactiva exige una **plantilla de autenticación aprobada** por tenant (no se puede texto libre iniciando conversación). El SMS no tiene esa restricción. Por eso el OTP a cliente va por **SMS** (con el gancho de WA documentado en el código); no es una omisión sino una restricción de la plataforma.

**Customer Portal — despacho del OTP (arregla un bug real):**
- [x] `customer-portal.service.ts` — `requestAccess` generaba el código pero **nunca lo enviaba** (el controller respondía "code sent" sin enviar nada). Ahora `dispatchCode()` envía por **SMS** (phone → `SmsSenderService`, Twilio del tenant) o **email** (`EmailService`). Best‑effort y tragado (respuesta genérica anti‑enumeración). `channel` pasa de `'whatsapp'|'email'` a `'sms'|'email'`.
- [x] i18n `auth.codeMessage`/`auth.codeSubject` en `customer-portal-i18n.ts` (4 idiomas). Módulo importa `EmailModule` + `SmsNotificationsModule`.

**2FA del dashboard por SMS (plano plataforma):**
- [x] `auth/platform-sms.service.ts` — `PlatformSmsService.sendTo(to, body)` vía Twilio de plataforma (reusa `SMS_ALERT_*`). El dashboard no tiene WhatsApp propio → SMS es el único canal de texto para 2FA de usuarios del panel. Registrado en `auth.module.ts`.
- [x] `auth.service.ts` — `send2FASms(userId)` (código 6 díg., Redis `2fa:sms:{userId}` TTL 5 min, al `user.phone`) + rama `method==='sms'` en `verify2FA` (calcado del fallback email; anti‑fuerza‑bruta ya existente). Tipo `method` ampliado a incluir `'sms'`.
- [x] `auth.controller.ts` — `POST /auth/2fa/send-sms` (público, usa `twoFAToken`) + DTO de `verify2FA` ampliado. Es un **fallback de entrega en login** (como el email): el user con 2FA que tenga `phone` puede pedir el código por SMS. No requiere setup nuevo.
- [x] Verificado: API `tsc` ✅ · `test:bootstrap` ✅.
- [ ] **Pendiente (frontend):** botón "Enviar código por SMS" en la pantalla de login 2FA del dashboard (análogo al de email) → llama `POST /auth/2fa/send-sms`. + i18n.

**Requisito para activar:** el 2FA SMS usa el Twilio de plataforma (envs `SMS_ALERT_*` de Fase 1). El OTP del Customer Portal usa el Twilio del tenant (canal SMS conectado).

### Fase 4 — Notificaciones a suscriptores + gating/cuotas

- Ampliar la selección de canal en los servicios de notificación (`appointment-notifications.service.ts:233` excluye `'sms'` hoy; ídem `recall`, `nurturing`, `drip-sequence`) a **WA‑first + SMS fallback** vía `OutboundQueueService`.
- **Feature gate**: `smsNotifications` (boolean) en `plan-features.registry.ts` + `seed-billing-plans.js` (5 planes: false en emprendedor/starter, true desde pro).
- **Cuota/consumo** (SMS cuesta por mensaje): `SmsThrottleService` calcado de `MediaThrottleService` — cuota mensual + budget‑cap diario/mensual en centavos, keys Redis `sms:*`. Considerar reutilizar el placeholder `whatsappCreditUsdCents` (sembrado, no cableado).
- UI: opt‑in + contadores de uso (molde de la página de billing con barras 80%/95%).
- **Multi‑proveedor**: introducir `ISmsProvider` + router con failover (Plivo/Infobip como secundarios).

## 6. Variables de entorno nuevas

**Fase 1 (plataforma):**
```
SMS_ALERT_ACCOUNT_SID=   # Twilio Account SID de plataforma
SMS_ALERT_AUTH_TOKEN=    # Twilio Auth Token de plataforma
SMS_ALERT_FROM=          # Número Twilio emisor (E.164, ej. +1XXXXXXXXXX)
SMS_ALERT_TO=            # Destinatario(s) super_admin, E.164, coma-separado
```
> **CRÍTICO** (ver CLAUDE.md): toda env nueva va a **GitHub Secrets Y** `deploy.yml`, o se pierde en el próximo deploy. Las de tenant (Fases 2‑4) NO son env: viven cifradas por tenant en `channel_accounts`/`whatsapp_credentials`.

## 7. Riesgos / deuda preexistente a cerrar de paso

Detectados en el canal SMS actual (arreglar antes de subir volumen):

1. **Firma del webhook entrante no se valida** — `channels.controller.ts:365` busca `TWILIO_AUTH_TOKEN`/`metadata.twilioAuthToken` que el connect nunca guarda → se acepta silenciosamente. El authToken sí está cifrado en `sms_token`.
2. **Disconnect no limpia el webhook en Twilio** — `channel-management.controller.ts:1057` lee `metadata.phoneNumberSid` que el connect nunca guarda.
3. **Lógica Twilio duplicada** — `broadcast-queue.processor.ts:113` reimplementa el envío en vez de reusar `SmsAdapter`. Consolidar en un `SmsSenderService`.
4. **SMS‑pumping** — cualquier endpoint OTP por SMS necesita anti‑fraude (Twilio Verify Fraud Guard o rate‑limit propio).

## 8. Costos de referencia (Twilio, 2026)

| Destino | SMS | OTP por SMS (Verify+SMS) | OTP por WhatsApp |
|---|---|---|---|
| México | ~$0.18 | ~$0.23 | ~$0.005 |
| Argentina | ~$0.10 | ~$0.15 | ~$0.005 |
| Colombia | ~$0.06 | ~$0.11 | ~$0.005 |
| Brasil | ~$0.06 | ~$0.11 | ~$0.005 |

El diferencial justifica WhatsApp‑first en todo lo dirigido a clientes/suscriptores; el SMS queda para respaldo y para alertas de plataforma de bajo volumen.
