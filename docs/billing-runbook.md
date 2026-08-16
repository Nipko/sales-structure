# Billing — runbook operativo Wompi

> Vigencia: agosto de 2026. Este documento describe el circuito vivo de
> suscripciones plataforma → tenant. La fuente contractual de precios, trials,
> ciclos y cuotas son las filas activas de `billing_plans`, no este archivo.

## 1. Alcance y separación de dinero

| Flujo | Proveedor | Credenciales | Resultado |
|---|---|---|---|
| Parallly cobra la suscripción del tenant | **Wompi** | Cuarteto global `WOMPI_*` | Fuente reutilizable + cobro mensual/anual desde el motor interno |
| Tenant cobra a su cliente por una compra, seña o pedido | **Mercado Pago** | Access Token, Public Key y Webhooks secret propios del tenant | Enlace de pago; el dinero va directo a la cuenta del tenant |
| Factura electrónica por una venta de Parallly en Colombia | **Factus / DIAN** | `FACTUS_*` + configuración fiscal runtime | FEV, XML/PDF y, cuando corresponda, nota crédito |

Mercado Pago está retirado como proveedor de suscripciones de Parallly. No hay
`MP_*` globales, no se crean `preapproval_plan` y ninguna alta, renovación,
upgrade o downgrade nuevo puede rutearse a Mercado Pago. Su única superficie
viva es **Configuración → Integraciones → Pagos** de cada tenant, para cobrar a
sus propios clientes mediante enlaces internos.

## 2. Arquitectura efectiva

Wompi no mantiene un objeto de suscripción remoto. Parallly conserva el
calendario, la fuente predeterminada, el importe congelado y cada intento; crea
una transacción Wompi por periodo y solo cambia acceso/plan tras un estado final
confirmado.

```text
Dashboard
  → token Wompi en el navegador (nunca PAN/CVV al API)
  → POST /billing/payment-sources/:tenantId
  → fuente AVAILABLE
  → billing_subscriptions + billing_charge_attempts
  → cola billing-renewals
  → transacción Wompi PENDING
  → webhook/polling
  → APPROVED: pago + entitlement + evento fiscal
     DECLINED/ERROR: dunning, sin promoción de plan
```

Controles que evitan dobles cobros:

- referencia única por intento y restricción única por periodo/propósito;
- claim transaccional antes de encolar;
- `jobId` igual al ID del intento;
- webhook idempotente y conciliación por referencia/ID de transacción;
- un upgrade con cargo se guarda como pendiente y solo se promueve al plan
  objetivo cuando el pago queda `APPROVED`.

## 3. Secretos y despliegue

Se requiere un único cuarteto del mismo ambiente:

```dotenv
WOMPI_PUBLIC_KEY=pub_test_...          # o pub_prod_...
WOMPI_PRIVATE_KEY=prv_test_...         # o prv_prod_...
WOMPI_EVENTS_SECRET=test_events_...   # o prod_events_...
WOMPI_INTEGRITY_SECRET=test_integrity_... # o prod_integrity_...
WOMPI_WEBHOOK_URL=https://api.DOMINIO/api/v1/billing/webhook/wompi

# Límites del contrato comercial, expresados en centavos COP.
WOMPI_MAX_TRANSACTION_COP_CENTS=
WOMPI_DAILY_CAP_COP_CENTS=
WOMPI_MERCHANT_TIMEZONE=America/Bogota
```

El prefijo decide sandbox o producción. Una mezcla test/prod deja el adapter no
configurado; nunca se corrige por fallback. API y worker necesitan las llaves
privada/integridad porque ambos participan en el circuito de cobro. En
`NODE_ENV=production` el runtime rechaza llaves `*_test_*`; el workflow de
producción exige los cuatro prefijos `prod` y ambos topes positivos antes de
modificar el servidor. `WOMPI_ALLOW_SANDBOX_IN_PRODUCTION=true` existe únicamente
para un staging aislado que usa build de producción; nunca se configura en el
entorno que atiende tenants reales.

En GitHub Actions los secretos deben llamarse exactamente:

- `WOMPI_PUBLIC_KEY`
- `WOMPI_PRIVATE_KEY`
- `WOMPI_EVENTS_SECRET`
- `WOMPI_INTEGRITY_SECRET`

Configurar una URL de eventos distinta para sandbox y producción. Wompi exige
validar el checksum SHA-256 con el secreto de eventos; el endpoint es
`POST /api/v1/billing/webhook/wompi` y falla cerrado si la firma no coincide.
Ver [Eventos de Wompi](https://docs.wompi.co/docs/colombia/eventos/).

## 4. Interruptores runtime

Super admin opera **Planes → Proveedores** (`/admin/plans`):

- `billing.providers_enabled`: kill switch del proveedor;
- `billing.default_provider_by_country`: ruteo por país;
- `billing.wompi_methods_enabled`: flags independientes `card`, `nequi` y
  `bancolombiaTransfer`;
- override de proveedor por tenant: excepcional, auditado y nunca sustituye el
  proveedor congelado de una suscripción existente.

Un arreglo público de métodos vacío significa “todos apagados”. El checkout
debe bloquearse; no existe fallback implícito a tarjeta.

Wompi en esta integración cobra COP para tenants de Colombia. Un país/moneda no
soportado debe responder sin proveedor disponible, nunca caer a otro plan o PSP.

## 5. Alta y trial en dos fases

1. Onboarding valida el plan/ciclo exactos del catálogo runtime.
2. El API provisiona tenant y suscripción. Si falta una fuente obligatoria,
   devuelve `billingCheckout` con `status=pending_auth`, `planSlug`, ciclo y
   `requiresPaymentMethod=true`.
3. `pending_auth` no concede entitlement pagado ni factura.
4. El navegador guarda solo la intención tenant/plan/ciclo en `sessionStorage`
   durante 30 minutos y abre `/admin/settings/billing`.
5. El usuario acepta por separado los dos contratos Wompi y autoriza un medio.
6. Cuando la fuente queda `AVAILABLE`, el backend arma el motor:
   - plan con trial: pasa a `trialing`, con `nextChargeAt` al final del trial;
   - plan sin trial: crea el intento inicial inmediatamente y conserva
     `pending_auth` hasta `APPROVED`;
   - un rechazo no activa el plan y no se reemplaza por un plan gratuito.

La respuesta `nextCharge { at, amountCents, currency }` es la autoridad visible
para el primer cobro. No prometer “sin cobro hoy” si no existe trial vigente.

## 6. Consentimiento y fuentes de pago

`GET /billing/payment-sources/:tenantId/acceptance` entrega permalinks/versiones
y un `consentId` de un solo uso, ligado a tenant y proveedor. El dashboard debe
mostrar dos checkboxes independientes y el `POST` debe incluir exactamente:

```json
{
  "consentId": "...",
  "acceptEndUserPolicy": true,
  "acceptPersonalDataAuth": true
}
```

Ausencia, `false`, expiración o reutilización se rechazan. Los tokens Wompi
prefirmados nunca viajan al navegador. Esta obligación está documentada en
[Tokens de aceptación de Wompi](https://docs.wompi.co/docs/colombia/tokens-de-aceptacion/).

### 6.1 Tarjeta

- El navegador llama `POST /v1/tokens/cards` con la llave pública.
- Parallly recibe únicamente el token; no recibe ni registra PAN/CVV.
- El backend crea la fuente con ambos tokens de aceptación.
- Solo `AVAILABLE` permite cargos desatendidos.

### 6.2 Nequi

Flujo técnico:

1. navegador: `POST /v1/tokens/nequi` con celular colombiano de 10 dígitos;
2. el token nace `PENDING` y el usuario recibe aprobación push en Nequi;
3. Parallly guarda una fuente local `pending_auth` y consulta el token;
4. únicamente `APPROVED` permite crear la fuente Wompi;
5. únicamente una fuente `AVAILABLE` arma/cobra la suscripción.

Go-live comercial: no asumir que implementar el API habilita el medio. Para el
modelo Gateway, Wompi indica registro con ejecutivo, formulario de Nequi y
confirmación posterior de activación. Ver
[activación oficial de Nequi Gateway](https://soporte.wompi.co/hc/es-419/articles/1500007698501--C%C3%B3mo-activar-Nequi-como-medio-de-pago-en-Wompi-bajo-el-modelo-Gateway).
Mantener `nequi=false` hasta validar el modelo contratado, ver el medio activo en
el comercio y completar un cobro real mínimo con webhook final.

### 6.3 Botón Bancolombia recurrente

Flujo técnico oficial:

1. navegador: `POST /v1/tokens/bancolombia_transfer` con
   `{ redirect_url, type_auth: "TOKEN" }`;
2. abrir `authorization_url` en la misma pestaña;
3. el pagador elige/autoriza su cuenta y vuelve a `redirect_url`;
4. Parallly recupera solo el ID de fuente local desde `sessionStorage` y hace
   polling hasta `APPROVED` o estado final negativo;
5. backend crea `BANCOLOMBIA_TRANSFER` con una descripción segura de pago y los
   dos tokens de aceptación;
6. solo la fuente `AVAILABLE` puede financiar cargos posteriores.

No guardar el token Wompi en URL/localStorage. El retorno no activa el plan por
sí mismo. Ver [Fuentes de pago y tokenización](https://docs.wompi.co/docs/colombia/fuentes-de-pago/)
y [métodos de pago](https://docs.wompi.co/docs/colombia/metodos-de-pago/).

La cuenta donde el comercio recibe liquidaciones de Wompi y la cuenta que un
pagador autoriza con Botón Bancolombia son conceptos distintos.

## 7. Ciclo de suscripción

Estados internos:

| Estado | Acceso | Operación |
|---|---|---|
| `pending_auth` | Sin entitlement pagado | Falta fuente o primer cobro aprobado |
| `trialing` | Sí, hasta `trialEndsAt` | Cobro agendado si existe fuente/`nextCharge` |
| `active` | Sí | Renovaciones normales |
| `past_due` | Ventana de recuperación/lock según dunning | Corregir fuente y reintentar |
| `cancelled` | Según `cancelAtPeriodEnd` | No generar ciclos nuevos tras fecha efectiva |
| `expired` | No | Recuperación agotada; aplica retención/offboarding |

### Renovación y día de cobro

- El motor persiste zona horaria, día ancla, inicio/fin de periodo y
  `nextChargeAt`; no se usa un “día universal” codificado en la UI.
- El scheduler corre cada 10 minutos con lookahead y jitter, reclama un único
  intento y respeta el tope diario configurado.
- El tope diario pertenece al comercio Wompi compartido, no a cada tenant. Su
  contador usa `WOMPI_MERCHANT_TIMEZONE` (por defecto `America/Bogota`) para que
  distintas zonas de tenants no dividan artificialmente el mismo límite.
- Mensual/anual provienen del ciclo de la suscripción y de su precio local
  congelado. La UI muestra el ciclo real, no siempre “por mes”.
- Si falta `WOMPI_MAX_TRANSACTION_COP_CENTS` o el importe lo supera, el cargo COP
  se difiere/rechaza de forma explícita. Antes de habilitar Enterprise anual,
  confirmar el límite por transacción del contrato Wompi.

### Upgrade, downgrade y ciclo

- Upgrade/cambio de ciclo con importe: calcular prorrateo, crear intento
  `upgrade_proration`, mantener el plan anterior y promover el objetivo solo
  tras `APPROVED`.
- Upgrade durante trial: conserva la fecha prometida; actualiza plan/precio
  congelado y cobra al terminar el trial.
- Downgrade de menor precio en el mismo ciclo: programar para el final del
  periodo; el usuario conserva el plan superior hasta entonces.
- Cancelar downgrade elimina la intención pendiente sin cobrar.
- Cancelación al fin del periodo conserva acceso hasta la fecha publicada;
  cancelación inmediata revoca según la respuesta del motor.
- Pausa/reanudación son estado local del motor Wompi; no requieren un objeto de
  suscripción remoto.

## 8. Fallos, reintentos y conciliación

El dunning del motor usa intentos en días 0, 1, 3 y 7; el barrido temporal pasa
a soft lock desde día 3 y expira al día 10 si no existe un intento vivo. La
política visible de la cuenta y los estados runtime prevalecen si esto cambia.

Operación super admin:

- `/admin/billing-ops`: suscripciones, pagos, eventos, reembolso/anulación y
  conciliación;
- `POST /billing-admin/reconcile`: barrido global;
- `POST /billing-admin/tenants/:tenantId/reconcile`: un tenant;
- `POST /billing/:tenantId/subscription/sync`: reintento/conciliación segura del
  motor local; no debe intentar consultar una suscripción Wompi inexistente.

Nunca marcar manualmente un pago `succeeded` ni una suscripción `active`. Buscar
por referencia del intento, confirmar el estado final en Wompi y dejar que el
settlement idempotente actualice pago, acceso y fiscal.

## 9. Facturación electrónica e internas

`billing.payment.succeeded` crea una decisión fiscal durable uno-a-uno por pago:

- tenant Colombia + riel producción + venta real + Factus listo: FEV DIAN;
- `tenant.isInternal=true`: `skipped / tenant_internal_use`, sin factura porque
  no hay venta a documentar;
- pago Wompi sandbox: `skipped / test_mode_payment`, nunca una factura DIAN real;
- monto sin contraprestación: `skipped / no_consideration`;
- proveedor/config fiscal faltante: `blocked_config`, visible y reintentable.

El PDF de `/billing/:tenantId/payments/:paymentId/invoice` es un comprobante
comercial. Las facturas DIAN oficiales (CUFE, XML/PDF) se consultan en
**Configuración → Datos fiscales** o `/admin/fiscal`. La UI no debe llamar
“factura DIAN” al comprobante genérico.

Antes del go-live:

- `FACTUS_*` de producción y rango de numeración vigentes;
- `fiscal.mode`, IVA y `fiscal.gate_enabled` revisados con contabilidad;
- cobro sandbox confirma `skipped`, no emisión;
- cobro real mínimo confirma `issued`, CUFE, XML/PDF y correo;
- reversa aprobada confirma nota crédito cuando corresponda.

### Retiro seguro del riel Mercado Pago de plataforma

La migración `20260815161000_block_unretired_mercadopago_platform_cohorts`
detiene el deploy si cualquier fila —incluida una marcada localmente como
cancelada/expirada— conserva `provider_subscription_id` de Mercado Pago. El
estado local no demuestra la cancelación del mandato remoto, que podría seguir
debitando aunque el adapter ya no exista. Antes de reintentar:

1. Inventariar los mandatos sin imprimir datos del pagador:

   ```sql
   SELECT status, COUNT(*)
     FROM billing_subscriptions
    WHERE provider = 'mercadopago'
      AND provider_subscription_id IS NOT NULL
   GROUP BY status;
   ```

   También inventariar tenants ya purgados que conservaron únicamente la
   evidencia append-only:

   ```sql
   SELECT details->>'mandateId' AS mandate_id, created_at
     FROM audit_logs stranded
    WHERE action = 'billing.stranded_provider_mandate'
      AND details->>'provider' = 'mercadopago'
      AND NOT EXISTS (
          SELECT 1 FROM audit_logs resolved
           WHERE resolved.action = 'billing.stranded_provider_mandate_resolved'
             AND resolved.details->>'provider' = 'mercadopago'
             AND resolved.details->>'mandateId' = stranded.details->>'mandateId'
             AND resolved.created_at >= stranded.created_at
      );
   ```

2. Cancelarlos en Mercado Pago usando el acceso operativo anterior o su panel.
3. Verificar del lado del proveedor que ninguno continúa autorizado.
4. Para un mandato de tenant ya purgado, registrar la resolución sin editar ni
   borrar el audit original (reemplace los valores literales por la evidencia
   verificada):

   ```sql
   INSERT INTO audit_logs (id, action, resource, details, created_at)
   VALUES (
     gen_random_uuid(),
     'billing.stranded_provider_mandate_resolved',
     'billing_subscriptions',
     jsonb_build_object(
       'provider', 'mercadopago',
       'mandateId', '<ID_VERIFICADO>',
       'verifiedAt', NOW(),
       'evidence', '<TICKET_O_CONFIRMACION_DEL_PROVEEDOR>'
     ),
     NOW()
   );
   ```

5. Solo entonces cerrar/normalizar las filas locales y reintentar la migración.

Nunca se debe borrar el ID local para “hacer pasar” la migración antes de haber
confirmado la cancelación remota. Las filas locales no-CO sin mandato quedan
`pending_auth` y requieren asignación manual a un proveedor compatible; no
conservan entitlement silencioso sobre el proveedor retirado.

## 10. Checklist de habilitación

1. Cuarteto Wompi productivo completo y de un solo ambiente en API/worker; cero
   IDs de mandato Mercado Pago plataforma sin cancelación remota verificada.
2. URL HTTPS de eventos configurada para ese ambiente.
3. `provider-status`: Wompi `configured=true`, webhook listo y entorno esperado.
4. País CO ruteado a Wompi; Mercado Pago apagado como PSP de plataforma.
5. Precio mensual/anual y moneda COP validados en cada plan autoservicio.
6. Límites por transacción y diarios acordados con Wompi y cargados.
7. Tarjeta: fuente `AVAILABLE`, cobro `PENDING→APPROVED`, webhook idempotente.
8. Trial: `pending_auth→trialing`, `nextCharge` correcto y conversión aprobada.
9. Plan sin trial: sin entitlement hasta aprobar el primer cargo.
10. Upgrade, downgrade, cancelación, pausa, reanudación y dunning probados.
11. Nequi/Bancolombia permanecen apagados hasta activación comercial y smoke real
    individual; habilitar cada flag por separado.
12. Factus alineado; cuentas internas y sandbox producen decisión `skipped`.
13. Mercado Pago por tenant exige Access Token y Webhooks secret cifrados antes
    de crear un enlace; su webhook valida firma, ownership, monto y transición
    terminal idempotente.

## 11. Diagnóstico rápido

| Síntoma | Verificar primero |
|---|---|
| No aparece ningún medio | `billing.wompi_methods_enabled`; vacío es bloqueo intencional |
| Formulario dice pasarela no configurada | prefijos/coherencia de las cuatro `WOMPI_*` |
| Nequi no sale de pendiente | aprobación push, estado del token y activación comercial del medio |
| Bancolombia no vuelve | `redirect_url` absoluta, misma pestaña, sesión no expirada y estado del token |
| Fuente aprobada pero plan no activo | estado del intento inicial; solo `APPROVED` activa |
| Cobro aprobado sin factura | fila fiscal `blocked_config/skipped/failed`, país, `isInternal`, ambiente y Factus |
| Reintento devuelve error remoto de suscripción | debe usar motor local; no existe preapproval Wompi |
| Plan anual no cobra | precio anual COP y `WOMPI_MAX_TRANSACTION_COP_CENTS` |

No incluir llaves, tokens, PAN/CVV, payloads completos ni datos personales en
logs, tickets o capturas.
