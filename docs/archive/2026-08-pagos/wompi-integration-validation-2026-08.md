# Validación integral Wompi — agosto de 2026

## Dictamen

La integración queda coherente en código para el circuito de suscripciones
Wompi con motor interno, pero **Nequi y Botón Bancolombia no deben habilitarse
en producción todavía**. Falta activación comercial del medio en el merchant y
smoke tests reales por método. Tarjeta tampoco debe declararse “lista de
producción” hasta completar el checklist de credenciales, webhook, límites y
Factus de este informe.

Mercado Pago queda fuera de altas, trials, renovaciones y cambios de plan. Solo
se conserva por tenant para generar enlaces de cobro tenant → cliente, con
Access Token y Webhooks secret cifrados propios del negocio.

## Resultado por recorrido

| Recorrido | Estado | Evidencia/resultado |
|---|---|---|
| Selección plan/ciclo en onboarding | Corregido | No bloquea planes con método obligatorio ni sustituye plan; provisiona `pending_auth` y conserva plan/ciclo exactos |
| Entitlement antes del pago | Correcto por contrato | `pending_auth` no concede acceso pagado; plan sin trial solo activa con cargo `APPROVED` |
| Fronteras fuera de HTTP | Corregido | La política canónica se revalida en API-key, WebSocket, widget, formularios/reservas públicas y workers de mensajería/LLM/CRM antes de trabajo o costo |
| Trial con medio obligatorio | Corregido | Fuente `AVAILABLE` inicia `trialing`; `nextCharge` publica fecha/importe del primer cobro |
| Tarjeta | Implementado | Tokenización browser → Wompi; API nunca recibe PAN/CVV; fuente exige dos consentimientos |
| Nequi | Implementado, no habilitar aún | Token por teléfono, aprobación push, polling y fuente solo tras `APPROVED` |
| Botón Bancolombia recurrente | Implementado, no habilitar aún | `TOKEN` + `redirect_url`, `authorization_url`, retorno seguro, polling, `payment_description` server-side |
| Métodos apagados | Corregido | Lista runtime vacía bloquea checkout; ya no inventa tarjeta |
| Consentimiento Wompi | Corregido | Dos checkboxes; nonce `consentId` de un solo uso y literales `true`; falla cerrado |
| Primer cobro asincrónico | Correcto por contrato | `PENDING` no activa; webhook/polling terminal promueve únicamente `APPROVED` |
| Renovación mensual/anual | Implementado | Motor usa periodo, ciclo, zona horaria/día ancla, importe congelado e intentos idempotentes |
| Upgrade | Implementado | Prorrateo en intento separado; plan objetivo pendiente hasta aprobación |
| Downgrade | Implementado | Menor precio/mismo ciclo se programa al fin del periodo; puede cancelarse |
| Pausa/reanudar/reintentar | Corregido por contrato | Operaciones locales del motor Wompi; no dependen de una suscripción remota inexistente |
| Cancelación | Implementado | Inmediata o fin de periodo según acción; no crea renovaciones posteriores |
| Anulación/reembolso | Acotado por Wompi | Solo anulación total de transacción elegible y confirmada `VOIDED`; no se promete reembolso parcial/API después de liquidación |
| Estados/textos | Corregido | `pending_auth`, trial, cobro programado/procesando, anual real, errores y métodos en es/en/pt/fr |
| Comprobante vs factura DIAN | Corregido en UI/docs | El PDF genérico se denomina comprobante; FEV/CUFE/XML viven en Datos fiscales |
| Tenant interno | Implementado | Motor no cobra; fiscal registra `tenant_internal_use`; UI no ofrece factura/comprobante de venta |
| Alta manual Super Admin | Corregido | Clasificación explícita: propio/interno queda activo y no facturable; comercial permanece inactivo hasta completar onboarding y crear suscripción canónica |
| Sandbox fiscal | Implementado | Pago test registra `test_mode_payment`; no emite FEV DIAN real |
| Mercado Pago plataforma → tenant | Retirado | Sin credenciales globales ni ruta de suscripción nueva |
| Mercado Pago tenant → cliente | Implementado en código | UI pide Access Token + Webhooks secret; backend verifica HMAC oficial, consulta el pago con la credencial del tenant, valida referencia canónica/ownership/importe/moneda y aplica estados terminales con CAS durable, monotónico e idempotente |

## Contraste con documentación oficial Wompi

### Consentimiento

Wompi exige dos tokens (`acceptance_token` y `accept_personal_auth`) y aceptación
explícita de ambos contratos antes de crear una fuente. El contrato frontend/API
ahora refleja esa obligación y evita reutilizar el consentimiento.

Fuente: [Tokens de aceptación](https://docs.wompi.co/docs/colombia/tokens-de-aceptacion/).

### Nequi

La fuente recurrente empieza con `POST /v1/tokens/nequi`, queda `PENDING`, el
usuario aprueba desde Nequi y el comercio consulta hasta `APPROVED`. El código
ya sigue esa secuencia. Lo pendiente no es otro campo de API, sino el alta real
del medio en la cuenta Wompi y su validación E2E.

Para Gateway, Wompi documenta registro con ejecutivo, formulario de Nequi y
confirmación posterior del equipo Wompi:
[activación de Nequi Gateway](https://soporte.wompi.co/hc/es-419/articles/1500007698501--C%C3%B3mo-activar-Nequi-como-medio-de-pago-en-Wompi-bajo-el-modelo-Gateway).
Si el contrato es Agregador, confirmar el estado directamente en el dashboard
del merchant; no extrapolar los requisitos Gateway.

### Botón Bancolombia

Wompi documenta la modalidad recurrente: crear token
`bancolombia_transfer` con `redirect_url` y `type_auth=TOKEN`, abrir
`authorization_url`, volver, consultar hasta `APPROVED` y crear una fuente
`BANCOLOMBIA_TRANSFER` con `payment_description`. Ese es el recorrido
implementado.

Fuentes: [Fuentes de pago y tokenización](https://docs.wompi.co/docs/colombia/fuentes-de-pago/)
y [Métodos de pago](https://docs.wompi.co/docs/colombia/metodos-de-pago/).

La cuenta de recaudo/liquidación del comercio no es el medio del pagador. Que el
merchant registre Bancolombia o Nequi para recibir fondos no habilita por sí
solo Botón Bancolombia recurrente en checkout.

### Webhook

Wompi envía `transaction.updated`, `nequi_token.updated` y
`bancolombia_transfer_token.updated`. El checksum usa los campos listados por el
evento, timestamp y **Events secret**, que es distinto de la llave privada. El
endpoint debe fallar cerrado y ser idempotente.

Fuente: [Eventos](https://docs.wompi.co/docs/colombia/eventos/).

### Anulación no equivale a reembolso general

La API documentada por Wompi expone `POST /v1/transactions/:id/void` para
anular una transacción elegible; no ofrece en este contrato un reembolso
parcial genérico. Por eso el panel no debe enviar un importe parcial a Wompi ni
marcar el pago/factura como revertido hasta observar el estado canónico
`VOIDED`. Una devolución posterior a liquidación o de un método no anulable se
gestiona con soporte/operación del proveedor y la nota crédito DIAN se emite
solo después de tener confirmación durable de la reversión.

Fuente: [Transacciones y anulación](https://docs.wompi.co/docs/colombia/transacciones/).

## Mercado Pago acotado a tenant → cliente

El circuito vivo queda aislado en `tenant-payments`: cada tenant aporta sus
propias credenciales cifradas, el enlace identifica de forma canónica la
operación que el tenant está cobrando y el webhook nunca confía en importe,
moneda, referencia ni estado recibidos sin consultar el pago con esa misma
cuenta. La transición terminal usa comparación y actualización durable para no
retroceder un estado ni aplicar dos veces el efecto comercial.

La firma se valida con `x-signature`, `x-request-id`, `data.id` y el Webhooks
secret propio del tenant, conforme a la
[documentación oficial de Webhooks de Mercado Pago](https://www.mercadopago.com.co/developers/es/docs/checkout-api-payments/additional-content/your-integrations/notifications/webhooks).
No queda ningún uso de esas credenciales para altas, trials, upgrades,
renovaciones o cancelaciones de Parallly. El único faltante es el smoke real de
un enlace y su webhook con credenciales productivas de un tenant.

## Faltantes antes de producción

| Prioridad | Acción | Responsable | Criterio de salida |
|---|---|---|---|
| Bloqueante | Cargar las cuatro llaves prod del mismo merchant/ambiente en API y worker | DevOps/Billing Ops | `provider-status` configurado en producción |
| Bloqueante | Configurar URL HTTPS de eventos prod y verificar checksum | DevOps/Wompi | Evento válido 2xx; firma inválida 4xx; replay sin doble efecto |
| Bloqueante | Definir `WOMPI_MAX_TRANSACTION_COP_CENTS` y `WOMPI_DAILY_CAP_COP_CENTS` según contrato | Finanzas/Billing Ops | Plan anual más caro cabe; scheduler no opera con límites desconocidos |
| Bloqueante | Validar precios COP mensual/anual de todas las filas activas | Producto/Finanzas | Catálogo no ofrece ciclo sin precio válido |
| Bloqueante | Alinear Factus producción, rango DIAN, IVA y gate | Finanzas/Contabilidad | Cobro real → FEV/CUFE/XML; sandbox/interna → skipped |
| Bloqueante Nequi | Confirmar modelo merchant y activación del medio | Dueño cuenta Wompi | Nequi aparece activo y Wompi confirma habilitación |
| Bloqueante Bancolombia | Confirmar habilitación de tokenización recurrente | Dueño cuenta Wompi | Merchant acepta fuente `BANCOLOMBIA_TRANSFER` real |
| Bloqueante por método | Smoke mínimo real de autorización, cobro y renovación/reintento | QA/Billing Ops | Fuente `AVAILABLE`; transacción `PENDING→APPROVED`; webhook idempotente |
| Alta | Ensayar rechazo/abandono/timeout y cambio de fuente | QA | Nunca activa ni cobra doble; UI recupera o permite reinicio |
| Alta | Ensayar trial→cobro, plan sin trial, upgrade, downgrade, anual, cancelación, pausa y dunning | QA | Estados/entitlements/fechas/importes correctos |
| Alta | Smoke real Mercado Pago tenant→cliente | QA/Tenant piloto | Link con credencial productiva; HMAC válida aceptada, inválida rechazada y webhook repetido sin doble efecto |

## Evidencia local ejecutada

- Build de producción del dashboard: correcto, 135 rutas; TypeScript correcto;
  i18n válido y en paridad en es/en/pt/fr (8.838 claves).
- API TypeScript y build: correctos; schema Prisma válido; workflow de deploy
  parsea correctamente; `git diff --check` sin errores.
- Suites focales ejecutadas en esta revisión: 74 pruebas del adaptador/fuentes/
  webhook Wompi, 148 del motor/lifecycle/offboarding, 42 de fiscal y pagos
  Mercado Pago por tenant, además de las suites de entitlement HTTP/WS/público,
  colas diferidas y alta administrativa.
- Dashboard: 6/6 pruebas de recuperación de checkout y métodos Wompi. Servicio
  WhatsApp: 8/8 pruebas del límite de entitlement en Embedded Signup.

Esta evidencia valida el contrato y las carreras simulables en código. No
sustituye un movimiento real: en el entorno de revisión no estaban disponibles
las cuatro llaves Wompi, credenciales Factus, PostgreSQL ni Redis.

## Matriz mínima de smoke

Para cada método que vaya a activarse:

1. consentimiento ausente/false/expirado/reutilizado → rechazo;
2. autorización abandonada → `pending_auth`, sin entitlement ni factura;
3. autorización rechazada → estado final negativo, sin fuente `AVAILABLE`;
4. aprobación → una fuente, un intento, una transacción;
5. webhook repetido/antes del response HTTP → un solo pago/efecto fiscal;
6. trial → cobro exactamente en `nextChargeAt` por el importe mostrado;
7. plan sin trial → acceso solo después de `APPROVED`;
8. fallo de renovación → ladder de dunning; nueva fuente permite reintento;
9. interna/sandbox → cero factura de venta;
10. producción Colombia → factura DIAN o `blocked_config` visible y recuperable.

## Conclusión de habilitación

- **Código/UX:** circuito construido y corregido para tarjeta, Nequi y Botón
  Bancolombia bajo el contrato descrito.
- **Producción:** mantener Nequi y Bancolombia apagados hasta resolver sus gates
  comerciales y completar smoke real; tarjeta también requiere el checklist
  común de credenciales, webhook, límites y fiscal.
- **Mercado Pago:** nunca habilitarlo como proveedor de suscripción. Sus
  credenciales existen únicamente dentro del tenant para cobros a sus clientes.
