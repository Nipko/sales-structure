# Billing — ciclos mensual/anual y billing-ops

_Última actualización: 2026-08-15_

Referencia operativa del ciclo de suscripción y de las acciones cross-tenant. El
riel de suscripciones es **Wompi + motor recurrente interno de Parallly**.
Mercado Pago no participa en altas, trials, renovaciones ni cambios de plan; su
único uso vivo son enlaces tenant → cliente con credenciales propias del tenant.

## 1. Precio y ciclo: fuente de verdad

Cada fila activa de `billing_plans` guarda el precio local por país en
`priceLocalOverrides`. Para Colombia:

```jsonc
{
  "CO": {
    "currency": "COP",
    "amountCents": 100000,
    "annual": {
      "currency": "COP",
      "amountCents": 1020000
    }
  }
}
```

- `amountCents` es el cobro mensual total, en centavos COP.
- `annual.amountCents` es el cobro anual total; no se deriva automáticamente de
  mensual × 12.
- Los campos históricos `mpPlanId` pueden permanecer en JSON legado, pero no
  autorizan cobros ni se sincronizan. Wompi no tiene catálogo remoto de planes.
- El seed es create-only; el runtime y el editor auditado de `/admin/plans` son
  la fuente vigente.

## 2. Cómo cobra el motor

La suscripción congela ciclo, importe, moneda, día ancla y zona horaria. El
scheduler crea un intento durable y el worker vuelve a validar suscripción,
plan, fuente, tenant y límite de capacidad inmediatamente antes de llamar a
Wompi. Una respuesta `PENDING` no concede acceso; webhook/polling sólo liquidan
una transacción canónica `APPROVED` con referencia, monto y moneda coincidentes.

- Mensual: el próximo periodo avanza un mes conservando el día ancla cuando
  existe (por ejemplo, 31 ene → 28/29 feb → 31 mar).
- Anual: avanza doce meses y cobra el total anual configurado.
- La hora de cobro y el límite diario usan `WOMPI_MERCHANT_TIMEZONE`
  (`America/Bogota` en producción).

## 3. Cambios de plan/ciclo

- **Upgrade o cambio con mayor cargo:** se calcula prorrateo, se crea un intento
  `upgrade_proration` y el plan objetivo sólo entra en vigor cuando Wompi lo
  aprueba. Un intento inicial/renovación vivo bloquea el cambio.
- **Downgrade:** se agenda para el final del periodo; el motor vuelve a validar
  el cambio antes del siguiente cobro.
- **Cambio de ciclo:** usa el mismo contrato. No cancela ni crea una suscripción
  remota porque Wompi no tiene `preapproval`; cambia el snapshot local únicamente
  después del movimiento autorizado que corresponda.
- **Cortesía / tenant interno:** deshabilita el motor y no deja próximo cobro.

## 4. Billing-ops (super_admin)

| Acción | Endpoint |
|--------|----------|
| Estado y readiness de proveedores | `GET /billing-admin/provider-status` |
| Switch/ruteo de proveedores | `GET/PUT /billing-admin/providers` |
| Asignar riel de un tenant | `PUT /billing-admin/tenants/:tenantId/payment-provider` |
| Reconciliación global/tenant | `POST /billing-admin/reconcile`, `POST /billing-admin/tenants/:tenantId/reconcile` |
| Reembolso auditado | `POST /billing-admin/payments/:paymentId/refund` |
| Conceder plan de cortesía | `POST /billing-admin/tenants/:tenantId/comp-plan` |
| Cambiar plan de tenant | `PUT /billing-admin/tenants/:tenantId/plan` |
| Catálogo y vistas cross-tenant | rutas `plans`, `subscriptions`, `payments`, `events` bajo `/billing-admin` |

No existe endpoint `sync-mp`: fue retirado junto con el adapter de suscripciones
Mercado Pago. Tampoco hay checkout de paquetes SMS activo.

## 5. Checklist operativo

Antes de aceptar un cobro real: cuatro secretos Wompi del mismo ambiente,
límites positivos, webhook HTTPS validado, precios COP mensuales/anuales,
Factus producción + rango DIAN y método Wompi activado en el merchant. Consulte
[`billing-runbook.md`](billing-runbook.md) y el dictamen
[`wompi-integration-validation-2026-08.md`](wompi-integration-validation-2026-08.md).
