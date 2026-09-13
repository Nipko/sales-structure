# WhatsApp: Meta cobra el mensaje de servicio desde el 1-oct-2026

**Empezar acá antes de tocar canales, planes o pricing.**

> ## Nota sobre este archivo
>
> El original se perdió sin haber sido comiteado: un agente de esta sesión corrió
> `git stash` / `git clean` sobre un árbol sucio para “dejarlo limpio” y se llevó
> dos archivos que nunca habían entrado a git. No hay commit, stash, reflog,
> objeto colgante ni copia que lo devuelva.
>
> Esto **no es el original**. Es una reconstrucción hecha el 12-sep-2026 desde
> artefactos que sí existen en el repositorio, y cada afirmación de acá nombra el
> archivo del que sale. Lo que el original tenía y no se puede reconstruir sin
> inventarlo —su plan F0–F3 y las decisiones del dueño que registraba— **no está
> reconstruido**: §7 dice qué falta y dónde vive hoy lo que se le parece.
>
> Diecisiete documentos citan esta ruta como autoridad. Por eso se reconstruye en
> vez de borrar las citas: lo que está mal es que el archivo falte, no que lo
> citen.

Fuentes de esta reconstrucción:

| Qué | Dónde |
|---|---|
| Reglas y tarifas oficiales, con URL, SHA-256 y archivos preservados | `docs/research/2026-09-10/meta-official-pricing-evidence.md` |
| La tabla que el código aplica de verdad | `apps/api/src/modules/billing/whatsapp-rates/whatsapp-rate-table.generated.ts` |
| Quién paga, márgenes, planes y la decisión aplicada | `docs/audits/2026-09-12/m4-pricing-proposal.md` |
| Estado derivado del programa de octubre (M0–M6/R0–R6) | `docs/audits/2026-09-09/closure-report.md` |

---

## 1. El hecho que ordena todo lo demás

**Parallly no le paga a Meta.** Somos Tech Provider: Meta le cobra a la WABA
**del propio negocio** cada mensaje de servicio entregado. No pasa por nuestra
factura, así que no podemos absorberlo, subsidiarlo ni revenderlo con margen.

Consecuencia directa: la línea “WhatsApp/Meta” del COGS en
`docs/plan-profitability-2026-07.md` **no existe como costo nuestro**. Cualquier
escenario que la use está mal planteado, y por eso ese documento lleva la
advertencia en el índice.

En el código, la autoridad de “qué canal cuesta dinero” es una sola lista:
`META_BILLED_CHANNELS` en
`apps/api/src/modules/channels/external-effect-inventory.ts`, hoy `['whatsapp']`.
**Instagram y Messenger siguen gratis**, y por eso alcanzarlos no basta para que
un efecto sea cobrable (`metaBillsDelivery`).

## 2. Las reglas, con su fecha

De la evidencia preservada (§“Reglas temporales confirmadas”, fuentes P1 y P2):

- **Desde el 1-oct-2026** el mensaje de **servicio** se cobra por entrega, con
  **1.000 entregas gratuitas por número y por mes calendario, sin acumulación**.
  El código lo declara igual y en un solo lugar
  (`WHATSAPP_FREE_SERVICE_ALLOWANCE`: `deliveries: 1000`,
  `scope: 'per_phone_number_per_calendar_month'`, `rollsOver: false`,
  `category: 'service'`, `effectiveFrom: '2026-10-01'`).
- **La utility dentro de la ventana de 24 h vuelve a cobrarse** en la misma
  actualización. Una plantilla utility **no** consume la franquicia de servicio:
  dejar que lo haga hace pagar dos veces.
- **La tarifa la fija el país del DESTINATARIO**, no el del negocio, y la moneda
  la de la cuenta. La vigencia cambia a **medianoche en la zona horaria de la
  WABA**, no en la nuestra.
- **Sin método de pago en la WABA antes del 30-sep-2026, el 1-oct se detienen
  las entregas de servicio.** Esto es un aviso operativo con fecha, no una
  decisión de precio.
- El servicio **no tiene descuentos por volumen**. Utility y authentication sí,
  por tramos mensuales del portfolio propietario; son marginales y no
  retroactivos.
- Servicio incluye **respuestas de humanos y de IA de terceros** — nosotros.
  **Meta Business Agent es otra categoría** y otro cobro (tokens), no ésta.
- Las entradas del cliente no se cobran. Un mensaje genera el cargo de **su**
  categoría y sólo uno.

**Dos tarjetas, no una.** La de julio no tiene tarifa de servicio en ningún
mercado: antes de octubre el servicio era gratis. La regla es versionada y el
código la aplica así, con cuatro tarjetas cargadas
(`meta-ratecards-2026@ddb62cc8458b94a3`; USD y COP, `2026-07-01` y `2026-10-01`).
Cualquier comunicación tiene que distinguir antes y después de la fecha efectiva
en vez de presentar una sola cifra.

## 3. Tarifas LatAm de octubre, por entrega

De la evidencia preservada, tarjetas oficiales USD y COP. Antes de impuestos, de
cargos de un partner y del costo de IA nuestro. **Las cifras COP son valores
publicados por Meta, no una conversión nuestra.**

| Destino | Servicio USD | Servicio COP | Marketing USD | Utility/auth USD |
|---|---:|---:|---:|---:|
| Colombia | 0,0008 | 2,9455 | 0,0125 | 0,0008 |
| Brasil | 0,0068 | 25,0363 | 0,0625 | 0,0068 |
| México | 0,0085 | 31,2954 | 0,0397 | 0,0085 |
| Chile | 0,0200 | 73,6363 | 0,0889 | 0,0200 |
| Argentina | 0,0260 | 95,7271 | 0,0618 | 0,0260 |
| Perú | 0,0300 | 110,4545 | 0,0703 | 0,0300 |
| Resto de LatAm | 0,0113 | 41,6045 | 0,0740 | 0,0113 |

Lo que cambió de julio a octubre en estos mercados, además de que el servicio
pasó a existir: **marketing de México** 0,0305 → 0,0397 y **utility/auth de
Perú** 0,0200 → 0,0300. El resto de las filas LatAm no se movió.

**Un negocio colombiano que atiende a un cliente peruano paga la tarifa peruana:
37 veces la colombiana por un mensaje de servicio.** Ese es el dato que cambia la
conversación, y es geográfico, no de plan.

**Advertencia de cálculo**, textual de la evidencia: algunas filas de Colombia
muestran un descuento del 5 % y la tarifa publicada sigue redondeada en USD
0,0008. No derivar una tarifa “más precisa” multiplicando el porcentaje si
contradice la tarjeta.

## 4. Qué hace el código hoy

- **Se reserva antes de entregar.** La admisión fija tenant, conexión, cuenta
  pagadora, destinatario tarifario, categoría, productor y efectos; la reserva
  ocurre antes del POST y se liquida contra el recibo
  (`whatsapp-send-admission.service.ts`, `whatsapp-spend.service.ts`).
- **Cero productores cobrables fuera del gate económico.** Lo verifica un censo
  del árbol, no una lista mantenida a mano, y una mutación que borra el gate del
  sink real pone en rojo a todos los productores detrás de él
  (`apps/api/scripts/outbound-producer-inventory.cjs`,
  `outbound-gate-census.spec.ts`). Es la fila M3 del cierre.
- **La categoría aprobada y la ventana de servicio se leen de la base del
  tenant** antes de admitir, no se adivinan.
- **Cada número y cada contacto nacen con límites observables.** El valor
  inicial es 2.000 entregas por número y mes calendario y 60 por contacto y
  mes, con avisos al 80 % y pausa suave al 95 %. `INSERT ... ON CONFLICT DO
  NOTHING` conserva cualquier límite explícito que ya tuviera el tenant.
- **`observe` sigue siendo el modo inicial.** Mide, muestra presión y conserva
  toda la contabilidad sin rechazar. Un `tenant_admin` puede activar o devolver
  `enforce` desde **Canais/Canales → WhatsApp**; el cambio queda auditado y se
  propaga a todos los workers mediante Valkey. Un supervisor puede ver el
  estado, pero no cambiarlo (`GET /whatsapp/spend/policy`,
  `POST /whatsapp/spend/policy/enforcement`).
- **`whatsappCreditUsdCents` es decorativo.** Existe en
  `plan-features.registry.ts` y en el seed de planes, y **ningún consumidor lo
  lee para decidir nada**. No presentarlo como un saldo ni como una protección.

## 5. Lo que está activo y lo que aún requiere activación

- El carril durable de despacho es obligatorio para toda salida externa. La
  clave heredada `dispatch.normalOutbox` sólo delimita qué tenants y canales se
  revisan en el canario; apagarla no devuelve mensajes al carril anterior.
- El modo `enforce` está implementado y es operable por tenant, pero sigue
  apagado por defecto. El código no afirma que exista hoy un tenant productivo
  con esa activación: eso sólo se comprueba durante el cutover.
- La coexistencia con Meta Business Agent está detrás de un interruptor apagado.
- **0 de 5 canales y 0 de 76 perfiles certificados** (`closure-report.md`,
  `tool-profile-audit.json`). Un test sintético verde no certifica nada.

## 6. Qué decir y qué no

- **No** decir “podés empezar sin tarjeta hasta consumir los 1.000”: la evidencia
  no documenta esa excepción, y el 1-oct sin método de pago las entregas se
  detienen.
- **No** confundir “no verificado”, “ausente” y “rechazado”: una lectura de API
  que falló no demuestra que falte el método de pago.
- **No** presentar el máximo estimado como si fuera una factura.
- **No** mostrar una sola cifra sin decir si es antes o después del 1-oct.
- **Sí** decir que la tarjeta de Meta se agrega en la superficie de Meta, y que
  Parallly no la recibe, no la guarda y no puede comprobarla. La landing lo dice
  así, junto a cada CTA y precio.

## 7. Qué tenía el original y qué autoridad lo reemplaza

El original registraba un **plan F0–F3** y un conjunto de **decisiones del
dueño**. No se reconstruyen porque no hay artefacto del que derivarlos, y
escribirlos de memoria sería inventar autoridad. Lo que existe hoy en su lugar:

- **La decisión comercial M4 ya está aplicada** en
  `docs/audits/2026-09-12/m4-pricing-proposal.md` §8: precios, techo por número,
  techo por contacto, los dos textos de comunicación y la fecha del aviso del
  método de pago. Su autoridad ejecutable es
  `WHATSAPP_OCTOBER_COMMERCIAL_POLICY`; el ledger siembra esos límites y el
  informe de cierre lee el mismo objeto.
- **El estado de ejecución** vive en `docs/audits/2026-09-09/closure-report.md`,
  generado desde el código: cada fila declara su condición y su estado sale de
  ella.
- **Los gates externos restantes** están nombrados ahí mismo, uno por uno.

Si el original decía algo que este archivo no dice, el original tenía razón y
esto no lo sabe. Tratar esta reconstrucción como lo que es.
