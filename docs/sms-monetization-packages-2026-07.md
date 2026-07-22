# SMS — Monetización por paquetes (reseller) — Jul 2026

> Estado: **IMPLEMENTADO (F0–F3)**. Los tenants **compran paquetes de SMS** para enviar **notificaciones
> one-way a sus clientes** ("avisar de cualquier cosa"). La plataforma provee el envío (nuestro Twilio) y
> **cobra por consumo**. Modelo **reseller** (sender de plataforma), precios editables en /admin. El
> **canal SMS conversacional (bidireccional) se descartó** — no se usa, no es necesario en un mercado
> WhatsApp-first; el backend queda dormido.

## Mapa de lo construido

- **Modelo (global Prisma)**: `SmsCreditBalance`, `SmsCreditLedger`, `SmsPackageOrder` + migración
  `20260722000000_add_sms_credits`.
- **Módulo `sms-credits/`**: `SmsCreditsService` (getBalance, addCredits/consume atómicos + ledger,
  adjust, getConsumption, listBalances, config de tiers en `platform_settings` clave `sms.packages`);
  `TenantNotificationSmsService` (envía por Twilio de plataforma + reserva/consume por segmento con
  reconciliación y refund en fallo); `SmsCreditsController` (packages, balance, ledger, admin config +
  ajuste de saldo).
- **Envío medido (F2)**: intercept en `channels/outbound-queue.processor.ts` (SMS texto → plataforma +
  créditos; sin saldo = drop sin reintento) y reescritura de `broadcast/broadcast-queue.processor.ts`
  `sendSMS`. Cubre broadcast + recordatorios/nurturing/recall que resuelvan a SMS.
- **Compra (F1)**: `billing/adapters/mercadopago(-config).ts` exponen `Preference` +
  `createPaymentPreference`; `billing/sms-checkout.service.ts` + `sms-checkout.controller.ts`
  (`POST sms-credits/:tenantId/checkout`); acreditación idempotente en
  `billing.service.ts::creditSmsPackageOrder` (rama one-time de `handleBillingEvent`).
- **UI (F3)**: sección "Créditos SMS" en `settings/billing` (saldo + alertas + grid de compra + retorno
  MP `?sms=return`); página super admin `/admin/sms-packages` (editor de tiers + saldos con ajuste);
  `api.ts` (+9 métodos); nav `smsPackages`; i18n x4.
- **Config**: `SMS_SENDER_ID` en `.env.example` + `deploy.yml` (3 puntos). Reusa `SMS_ALERT_*` (Twilio
  de plataforma).

## Tres planos (contexto)

1. **Plataforma (nosotros)** — validación de cuenta, seguridad, 2FA, alertas ops. Nuestro Twilio,
   nosotros pagamos. **Ya existe** (`SmsAlertService` + `PlatformSmsService`, Fases 1-3). Solo requiere
   cargar los secrets `SMS_ALERT_*`.
2. **Paquetes del tenant (monetizado)** — el tenant compra créditos y **avisa a sus clientes** (one-way:
   recordatorios, promos, avisos). Nuestro Twilio (sender de plataforma), **medido y cobrado**. **← ESTO
   se construye.**
3. **Canal conversacional (BYO)** — cliente ↔ IA por SMS. **DESCARTADO** (backend vivo pero dormido; no
   se invierte en UI ni provisioning).

## Arquitectura de #2 (reseller)

- **Envío:** el Twilio de la plataforma (mismas credenciales `SMS_ALERT_*` / `PlatformSmsService`)
  envía las notificaciones del tenant **desde un sender de plataforma** (`SMS_SENDER_ID` — número largo
  o sender alfanumérico; one-way, ideal para avisos). Config nueva de env/settings.
- **Créditos:** 1 crédito = 1 **segmento** de SMS (Twilio cobra por segmento: 160 chars GSM / 70 unicode;
  se mide con `num_segments` de la respuesta de Twilio). Balance por tenant.
- **Qué CONSUME crédito:** los envíos one-way del tenant a SUS clientes → broadcast SMS, recordatorios de
  cita, nurturing/drip SMS, recall. **NO** consumen: el plano plataforma (#1: 2FA/seguridad/alertas) ni
  nada del canal conversacional (#3, descartado).
- **Enforcement:** antes de enviar, verificar saldo; si no hay, no enviar + avisar (y opcional: email de
  saldo agotado). Descontar por segmentos al confirmar el envío.

## Modelo de datos (global, Prisma)

- `SmsCreditBalance` — { tenantId (unique), balanceCredits, updatedAt }.
- `SmsCreditLedger` — { id, tenantId, delta (+compra / −consumo / ±ajuste), reason, ref (paymentId /
  campaignId / etc.), balanceAfter, createdAt }. Auditable, fuente de verdad del saldo.
- Paquetes (tiers) editables → `platform_settings` clave `sms.packages` (JSON), como fiscal/plans.

## Fases

- **F0 — Modelo + servicio + config (sin cobrar aún):** modelos Prisma + migración; `SmsCreditService`
  (getBalance, addCredits, consume con enforcement, ledger); tiers en platform_settings + sender de
  plataforma; endpoints super admin para editar tiers y ver/ajustar saldos.
- **F1 — Compra:** checkout de paquete (MercadoPago pago único / preference; reusa la infra de billing)
  → webhook de pago acredita créditos (idempotente, vía ledger). UI de compra en el dashboard del tenant.
- **F2 — Envío medido:** `TenantNotificationSmsService` (envía por Twilio de plataforma + descuenta
  créditos por segmento + enforcement). Cablear los paths de notificación del tenant (broadcast SMS,
  recordatorios, nurturing/drip, recall) para que usen este servicio y consuman crédito. Reemplaza el
  envío Twilio a mano del `broadcast-queue.processor` (deuda del plan original).
- **F3 — UI + gestión:** tenant ve saldo/consumo/compra + alertas de saldo bajo; super admin define
  tiers/precios y puede ajustar saldos. i18n x4.

## Precios propuestos (PLACEHOLDER — editables en /admin, validar contra costo real Twilio CO)

| Paquete | SMS (créditos) | Precio COP (propuesto) | ~COP/SMS |
|---|---|---|---|
| Inicial | 500 | 90.000 | 180 |
| Pro | 2.000 | 320.000 | 160 |
| Masivo | 10.000 | 1.400.000 | 140 |

> El costo Twilio a Colombia (~US$0.04–0.06/SMS ≈ 160–240 COP) debe confirmarse para asegurar margen;
> por eso los precios son editables en el panel. Créditos sin vencimiento (decisión inicial; revisable).

## Decisiones tomadas
- Reseller (sender de plataforma); canal conversacional descartado; precios propuestos + editables.

## Pendiente del usuario (cuando toque)
- Cargar `SMS_ALERT_*` (plano plataforma) + `SMS_SENDER_ID` (sender de los paquetes) en Secrets/deploy.
- Registrar el sender (número largo / alfanumérico) en la cuenta Twilio de plataforma.
- Ajustar los tiers/precios en /admin tras validar el costo real de Twilio CO.
</content>
