# Merchant of Record para Parallly — Investigación y decisión (Ago 2026)

**Fecha:** 12-ago-2026 · **Estado:** Investigación completa, decisión pendiente del dueño
**Metodología:** Workflow multi-agente: 6 investigadores web paralelos (Paddle / MoRs clásicos / MoRs nuevos / rieles LatAm + plan B local / fiscal-cambiario colombiano / realidad de recurrencia LatAm) + 15 verificaciones adversariales + crítico de completitud. ~1,4M tokens, ~400 búsquedas/lecturas web, fuentes 2025-2026 con URL. Los datos decisivos quedaron marcados **confirmado / incierto / refutado** por verificadores independientes.
**Contexto que motiva esto:** MercadoPago Colombia bloqueó las suscripciones en producción (HTTP 403 `rejected_by_regulations_collector_non_compliant`, caso WCS-43605 sin fecha). Los pagos únicos funcionan. Parallly es una S.A.S. colombiana (Régimen Simple), banco Bancolombia, precios en COP (~126k–1,79M COP/mes ≈ USD 21–349), clientes PyMEs LatAm B2B, facturación DIAN vía Factus implementada con postura de IVA **excluido** (cloud computing, num. 21 art. 476 ET).

---

## TL;DR — Recomendación

**Un MoR global NO puede ser el stack principal de cobro para PyMEs LatAm, pero SÍ es la pieza correcta para la expansión internacional.** La estrategia recomendada es **híbrida y geo-separada**:

1. **Colombia (hoy, el 100% de la base): riel local.** Primero agotar dos vías baratas: (a) probar si el bloqueo de MP alcanza también a los cobros con tarjeta guardada (API Customers & Cards) — si no, la solución es casi gratis; (b) obtener el SÍ comercial **por escrito** de **Wompi** (la pasarela de Bancolombia, nuestro banco): su API de fuentes de pago tokeniza tarjetas, Nequi, Daviplata y cuentas Bancolombia para cobro recurrente sin intervención del usuario, a **2,65% + COP 700 + IVA** con abono al día hábil siguiente — más barato que MP (~3,9%) y muchísimo más barato que cualquier MoR (6–10% efectivo).
2. **Expansión fuera de Colombia: MoR.** **FastSpring** es el mejor candidato para LatAm (único con registros fiscales probados en CO/MX/CL/PE, exención B2B en checkout con tax ID en CO/CL/PE, y Pix Automático **recurrente** en Brasil); **Paddle** es mejor producto/precio y con mejor migración, pero sin métodos locales LatAm y con un riesgo específico de AUP (ver §7). Vender vía MoR **solo al exterior** además resuelve los dos problemas fiscales: los clientes colombianos no pagan +19% de IVA y se blinda la postura de exportación de servicios.
3. **No mover nada** antes de cerrar los bloqueantes de §9 (concepto tributarista, pre-aprobación del caso de uso, datos de aprobación de tarjetas, política de salida/tokens).

La razón de fondo, verificada: los MoR procesan tarjetas **cross-border** (UK/US) sin PSE/Nequi/Pix Automático/domiciliación, la aprobación de tarjetas LatAm cae materialmente en cross-border, solo **23,3%** de adultos colombianos y **15,7%** de mexicanos tienen tarjeta de crédito, y los bancos emisores bloquean compras internacionales por defecto. Para suscripciones de USD 21–349 a PyMEs, eso es conversión destruida y churn involuntario estructural.

---

## 1. Diagnóstico del bloqueo de MercadoPago (verificado)

- **No existe ninguna norma colombiana 2026 que prohíba cobros recurrentes.** Wompi, ePayco, PayU (vía tokenización) y dLocal Go los venden comercialmente hoy. PayU descontinuó su producto legacy de recurrencia por decisión de producto, no por norma (recomienda tokenización).
- El código `rejected_by_regulations_collector_non_compliant` **no aparece en la documentación pública de MP** (sus motivos de rechazo solo listan `cc_rejected_*`), consistente con un **gate de compliance interno a nivel collector**. MP Colombia opera como Compañía de Financiamiento vigilada por la SFC (Res. 0899 del 28-jun-2023) — requisitos prudenciales que las pasarelas no vigiladas no tienen. La causa exacta solo la puede confirmar MP. *(Veredicto: núcleo confirmado; el vínculo con la licencia SFC es inferencia plausible no documentada.)*
- La novedad regulatoria 2026 real es **aditiva**: Bre-B habilita débitos automáticos interoperables con llaves (CRE DSP-465, versiones mar/ago 2026; límite 1.000 UVB ≈ COP 12,1M por operación; DRUO fue el primero en producción, jul 2026). Es una **nueva** vía de recurrencia sin tarjeta que nos conviene, no una restricción.
- **Pregunta sin responder (acción gratis, prioridad 1 del crítico):** ¿el 403 bloquea solo el producto *preapproval* o también los cobros *merchant-initiated* con tarjeta guardada (API Customers & Cards, documentada para Colombia)? Matiz: MP exige recapturar CVV en el flujo customer-initiated; la recurrencia sin intervención requeriría habilitación MIT de MP. **Probar un cargo card-on-file en producción + pregunta formal a MP + queja ante la SFC** (palanca no usada hasta ahora).

## 2. La realidad del cobro recurrente a PyMEs LatAm (por qué el MoR no puede ser el stack principal)

| Hecho | Dato | Fuente / veredicto |
|---|---|---|
| Aprobación de tarjetas cross-border vs local | Vendors de adquirencia local (EBANX, Rebill): cross-border 30–50% vs local 70–90%. Fuentes neutrales (Nuvei/Adyen/Stripe vía síntesis independiente): cross-border típico 70–85% con **lift local de 5–16 p.p.** (+20–30% relativo en México). La dirección es unánime; la magnitud del vendor es el peor caso. | *Incierto en magnitud, confirmado en dirección.* Usar 5–16 p.p. como piso conservador |
| Penetración de tarjeta de crédito | Colombia: **23,3%** de adultos (SFC, Reporte de Inclusión Financiera 2024); solo ~95.000 empresas con tarjeta empresarial. México: **15,7%** bancaria (ENIF 2024, INEGI/CNBV; la departamental 22,6% no sirve para suscripción internacional) | *Confirmado contra fuente oficial* |
| Bloqueos del emisor | Bancos como Nu Colombia traen las compras internacionales **bloqueadas por defecto**; el titular debe habilitarlas manualmente. Comisión del emisor por compra internacional 0–1,5% + spread cambiario, aunque el cargo sea en COP con adquirencia extranjera | Confianza media |
| Churn involuntario | 20–40% de todo el churn; ~0,8%/mes en B2B SaaS. Recuperación con dunning por capas 47–85% | Benchmarks 2025-2026 |
| El futuro recurrente LatAm es no-tarjeta | Pix Automático (BR, live jun-2025; 64% de sus usuarios son suscriptores **nuevos**), débitos Bre-B (CO, 2026), domiciliación bancaria (MX, 40% de los pagos recurrentes 2023), DEBIN recurrente (AR, 2025). **Ningún MoR global los ofrece para suscripciones** — solo players locales/regionales (única excepción: FastSpring con Pix Automático vía EBANX) | Confirmado |

**Implicación:** con MoR, la suscripción de una PyME colombiana depende de que el dueño tenga tarjeta de crédito, habilitada para compras internacionales, que no la bloquee el emisor, y que sobreviva el retry cross-border cada mes. Cada eslabón pierde clientes que un riel local no pierde.

## 3. Candidatos MoR — comparación

Todos aceptan (o no excluyen) vendedores domiciliados en Colombia. **Ninguno hace payout en COP** (liquidan USD/EUR/GBP vía SWIFT o Payoneer/Hyperwallet; sumar conversión a COP + 0,4% GMF). **Ninguno soporta PSE.**

| | Tarifa 2026 | Efectivo en US$21 / US$349¹ | Impuestos LatAm | Métodos LatAm | Riesgo |
|---|---|---|---|---|---|
| **Paddle** | 5% + $0,50 | ~7,4% / ~5,1% (+1,5–2,5% payout/FX) | CO 19% **solo B2C**, MX 16% B2B&B2C, CL 19% B2C, PE 18% B2C. Nada en AR/BR/EC | Tarjetas + PayPal + wallets; Pix solo one-time (nov-2025) | Multa FTC $5M (jun-2025) → vetting duro; retenciones documentadas 90d–13m; **AUP prohíbe "automated decision-making or categorization of people"** (§7) |
| **FastSpring** | ~5,9% + $0,95 o 8,9% flat (no público, negociable) | ~10,4% / ~6,2% (+2,5% FX payout) | **Registrado DIAN NIT 901448273-6 (2020)**; exención B2B con tax ID en CO/CL/PE; MX 16% sin exención; BR IOF 3,5% | 37 monedas incl. COP; tarjetas locales BR; **Pix Automático recurrente**; Mercado Pago one-time | Trustpilot 3,7 (mejor del grupo); hold 45 días cuentas nuevas; payouts vía Hyperwallet "90+ países" (depósito local CO plausible pero sin confirmación oficial) |
| **PayPro Global** | ~4,9% + $1 (no público) | ~9,7% / ~5,2% | "13.000 jurisdicciones" sin lista verificable — el más opaco | OXXO, Pix, Boleto, Mercado Pago (no PSE) | Payout mínimo **$400** + reserva 3 meses + solo USD (wire $21); Trustpilot 2,3; aceptación de Colombia sin confirmación escrita |
| **2Checkout (Verifone)** | 2Subscribe 4,5%+$0,40 (sin impuestos) / 2Monetize 6%+$0,50 | 6,6% / 4,6% (2Subscribe) | Solo CO y CL (B2C, plan 6%); **sin México ni exención B2B LatAm** | Solo Brasil real; sin COP como billing currency | Trustpilot 2,2; reserva 5%/90d; Verifone en estrés financiero (rescate $235M abr-2025) |
| **Polar** | 5%+50¢ → 3,4%+30¢ (por plan $0–400/mes) **+1,5% tarjeta no-US** | ~8-9% / ~5-6% | Solo US/EU verificable | Solo tarjetas + wallets (Stripe US) | $10M seed Accel (jun-2025); acepta CO vía Stripe Connect Express *(confirmado)*; joven |
| **Dodo Payments** | 4%+40¢ +1,5% intl +0,5% subs ≈ 6% | ~8% / ~6,3% | Páginas /tax/ SEO sin compromiso de registro | **Claim "PSE/Mercado Pago" REFUTADO** — docs técnicas solo listan Pix BR one-time (sin suscripciones) | Pre-seed $1,1M; holds 120 días documentados; riesgo de contraparte alto |
| **Creem** | 3,9%+40¢ | ~5,8% / ~4,0% | "190+ países" sin lista | Solo rieles Stripe | ~10 personas, €1,8M; ~$10k retenidos denunciados; inaceptable para el cobro principal |
| **Lemon Squeezy** | — | — | — | — | **Callejón sin salida**: en mantenimiento; su ruta de migración (Stripe Managed Payments, 38 ubicaciones) **excluye a Colombia y a toda LatAm** como país del comerciante *(confirmado)* |

¹ Solo comisión del MoR; el costo total suma payout + conversión a COP + GMF (§6).

**Notas verificadas clave:** (a) La tarifa real de FastSpring/PayPro solo se fija con cotización formal — las cifras públicas son de terceros y el rango cambia 3–4 puntos el costo efectivo en tickets bajos. (b) El payout de FastSpring corre sobre Hyperwallet, cuya red sí llega a Colombia por rieles locales — escenario mejor al asumido, pero **sin fuente oficial del programa FastSpring**: confirmar con su equipo. (c) PayPro: mínimo de payout $400 acumulado + reserva de 3 meses + ley de Ontario — pesa mucho con MRR inicial bajo.

## 4. Fiscal y cambiario colombiano del esquema MoR

**La estructura funciona así:** Parallly le vende (licencia/distribuye) al MoR; el MoR revende al cliente final y emite SU comprobante. Parallly emite **factura electrónica DIAN de exportación al MoR por cada liquidación** (adquirente extranjero genérico `222222222222`, valor pactado en USD expresado en COP en el XML). El cliente final ya no recibe factura DIAN nuestra. La capa fiscal ya implementada soporta esto: el modo `US_REMOTE` de `IFiscalInvoiceProvider` emite recibo comercial en vez de FEV.

| Tema | Conclusión | Veredicto |
|---|---|---|
| Exportación de servicios (IVA 0% exento, art. 481 lit. c ET) | El parágrafo de software del **Decreto 2223/2013** (DUR 1625/2016) cubre exactamente el patrón "software licenciado a un beneficiario que lo difunde desde el exterior en el mercado internacional, accesible desde Colombia" (patrón app-stores), y lo **exceptúa de la certificación de uso exclusivo en el exterior** | Texto legal confirmado, **PERO** su aplicación cuando la **mayoría de los usuarios finales está EN Colombia** no tiene doctrina DIAN que la respalde, y el mismo decreto ordena denuncia por **"exportación ficticia"** si el servicio se usa total o parcialmente en Colombia. **Concepto de tributarista / consulta DIAN = bloqueante, no opcional.** El híbrido geo-separado (MoR solo exterior) desactiva este riesgo |
| IVA del comprador colombiano | La exclusión de cloud computing (num. 21 art. 476 ET) **no viaja al MoR**: el Concepto DIAN 190/2024 la reserva al proveedor directo. Paddle ya cobra 19% en Colombia (lista oficial, "B2C"); FastSpring está registrado ante la DIAN desde 2020 y exime B2B con NIT en el checkout | **Matiz decisivo (crítico, P1):** la frontera legal no es "tener NIT" sino ser **responsable de IVA / agente de retención** (num. 3 art. 437-2 ET). Las PyMEs **no responsables de IVA** — segmento núcleo nuestro — deberían pagar +19% aunque tengan NIT. **Dato interno a levantar: % de tenants (y del pipeline) responsables de IVA.** Ese número decide cuánto del mercado colombiano sufre +19% con MoR |
| Régimen Simple | Compatible con exportar vía MoR; sin retención de renta; la base gravable sería el **neto** que liquida el MoR (post-comisión). Contras: el IVA anual del RST congela ~1 año los saldos a favor del exportador (vs bimestral en ordinario) | **Refutado el riesgo de eliminación:** el PL 004 radicado el 20-jul-2026 **NO elimina el RST** (la eliminación estuvo en proyectos anteriores; el de sep-2025 se hundió en Senado el 9-dic-2025). Monitorear ponencias — el trámite recién empieza |
| Cambiario | Los servicios **no son de canalización obligatoria**: recibir el wire USD en Bancolombia implica solo declaración de cambio por datos mínimos (trámite del banco). Payoneer→COP es legal (divisas de libre tenencia; declarar renta a TRM del día + activos en el exterior). Cuenta de compensación: no se justifica al volumen actual; interesante si crecen pagos a proveedores en USD (APIs LLM, infra) | Costo real: spread de Bancolombia sobre TRM **~2–4%** (no publicado — pedir cotización a mesa de dinero) o Payoneer ~2%; + 0,4% GMF |
| Casos colombianos documentados | No se encontró ningún SaaS colombiano documentando públicamente el flujo Paddle/FastSpring + DIAN. El precedente funcional masivo es App Store/Google Play (mismo parágrafo de software) | La ausencia de precedente documentado refuerza el bloqueante del concepto tributarista |

## 5. Plan B local (Colombia) — el hueco que dejó MP se puede cerrar sin MoR

| Opción | Recurrencia hoy | Costo | Nota |
|---|---|---|---|
| **Wompi (Bancolombia)** ⭐ | **Sí** — API "fuentes de pago": tokeniza tarjetas (3DS inicial, COF Visa/MC), Nequi, Daviplata (requiere activación comercial) y cuentas Bancolombia (Botón Bancolombia). **PSE no es tokenizable** | **2,65% + COP 700 + IVA** (plan Agregador), abono al día hábil siguiente a cuenta Bancolombia. Plan Gateway negociable >2.000 tx | *Confirmado contra docs y tarifas oficiales.* Riesgo señalado por el crítico: **falta el SÍ comercial por escrito** para nuestro caso (los gates de compliance invisibles existen — MP lo demostró). Somos clientes de Bancolombia: palanca comercial real |
| ePayco | Sí (suscripciones con tarjeta, producto vivo) | 3,29% + COP 700 + IVA | Segunda opción local funcional |
| PayU Colombia | Solo vía tokenización (deprecó su producto de recurrencia) | ~2,99% + IVA + COP 700 | Decisión de producto, no norma |
| Bold | **No** (sin API de recurrencia; "trabajando en ella") | — | Descartado 2026 |
| **Rebill** (orquestador LatAm, entidad local por país) | Sí (CO/MX/AR: tarjetas, PSE, Nequi, SPEI/domiciliación, DEBIN) + motor de reintentos (hasta 71% recuperación) | CO: tarjetas **4,20% + $0,20** (+3% conversión si settlement en otra divisa) | **Descartado hoy:** fee mínimo **US$500/mes permanente** para cuentas bajo US$50k/mes de procesamiento *(verificado — los "3 meses" son ventana de gracia, no caducidad)*. Reevaluar al escalar México/Argentina |
| dLocal Go | Sí (suscripciones self-service para PyMEs domiciliadas en LatAm, incl. CO) | ~3,6–6% (no público, sin verificar) | Candidato para expansión; verificar por país |
| Treli (col.) | Capa de suscripciones sobre Wompi/PayU/ePayco/Stripe, con débito Nequi/Bancolombia y dunning | No verificado | Alternativa buy-vs-build para el scheduler |
| DRUO | Débito automático cuenta-a-cuenta; primero con llaves Bre-B (jul-2026) | No verificado | Apuesta a futuro (adopción incipiente) |
| EBANX / dLocal core | Enterprise, venta consultiva; EBANX orientado a merchants globales vendiendo HACIA LatAm | — | No encajan al volumen actual |

**Costo de ingeniería (riesgo no presupuestado, señalado por el crítico):** el preapproval de MP regalaba el scheduler, los reintentos, el dunning y el ciclo de vida. Las "fuentes de pago" de Wompi son tokenización cruda: habría que construir el motor de cobros en casa (scheduler BullMQ + retries + dunning + prorrateo + reconciliación — la arquitectura ya tiene los cimientos: colas, reconciliación por cron, `IPaymentProvider`) o comprarlo (Treli). Ese renglón falta en cualquier comparación "4,3% local vs 6–10% MoR" y es exactamente lo que los MoR sí incluyen.

## 6. Costo total efectivo por ticket (mensual, aproximado)

Incluye comisión + (para MoR) payout/FX a COP; GMF 0,4% aplica a todos al mover plata. Wompi/MP liquidan COP directo.

| Plan (COP / ≈USD) | Wompi | MercadoPago | Paddle | FastSpring¹ |
|---|---|---|---|---|
| Emprendedor 125.700 / $21 | **~3,8%** | ~4,3% | ~9–10% | ~11–13% |
| Starter 276.900 / $49 | ~3,5% | ~4,1% | ~7,5–8,5% | ~9–10% |
| Pro 757.700 / $129 | ~3,3% | ~4,0% | ~7–7,5% | ~8–9% |
| Enterprise 1.789.800 / $349 | ~3,2% | ~3,9% | ~6,5–7,5% | ~8–8,5% |

¹ Con la tarifa de terceros 5,9%+$0,95 + 2,5% FX; una cotización formal puede bajarla varios puntos.

**Lectura:** en el mix actual (tickets bajos, 100% Colombia), el MoR cuesta **2–3× el riel local**. La prima del MoR compra compliance fiscal multi-país, motor de suscripciones y expansión sin entidades locales — valioso **para el exterior**, redundante para Colombia donde ya tenemos DIAN/Factus resuelto y postura de IVA mejor (excluido vs +19% B2C).

## 7. Riesgos específicos del MoR para Parallly (del verificador y el crítico)

1. **AUP de Paddle:** prohíbe "automated decision-making or categorization of people". Parallly hace **lead scoring, calificación de contactos y auto-avance de etapas CRM** como feature central. Un revisor conservador post-multa-FTC puede rechazar la cuenta o — peor — cerrarla después de migrar la base. **Mitigación obligatoria:** describir el producto con precisión y obtener pre-aprobación escrita del caso de uso antes de mover un solo cliente (aplica análogo a FastSpring/PayPro).
2. **Lock-in de salida:** con MoR, los tokens de tarjeta y la relación de cobro son del MoR. Migrar de vuelta exige una migración PCI que el MoR acepte facilitar, o re-onboarding con re-consentimiento de cada suscriptor (= churn masivo). Combinado con las retenciones documentadas (Paddle 90d–13m; 2CO reserva 5%/90d; PayPro 3 meses), es una decisión difícil de deshacer. **Pedir por escrito la política de exportación de tokens/suscriptores antes de firmar.**
3. **Moneda de punta a punta:** Paddle soporta COP como moneda de checkout pero **no** para suscripciones de cobro manual (facturación B2B) ni payouts; falta confirmar si las suscripciones automáticas facturan y muestran COP de punta a punta o si los tenants verían USD en el extracto (disputas + cancelaciones + cambio de propuesta comercial).
4. **Retención de fondos en el arranque:** todos los MoR aplican holds más duros a cuentas nuevas de países "de riesgo". Mitigar con umbral de payout mínimo y sin acumular balance.

## 8. Recomendación completa

**Fase 0 (esta semana, costo cero):**
- Probar en producción un cargo merchant-initiated con tarjeta guardada en MP (Customers & Cards). Si funciona sin el 403, el problema queda reducido a construir scheduler propio sobre MP manteniendo 3,9%, Factus y la exclusión de IVA.
- Escalar el caso MP por dos vías en paralelo: soporte Developers (ya abierto, WCS-43605) + **queja formal ante la SFC** como usuario financiero de la Compañía de Financiamiento.
- Levantar el dato interno: **% de tenants y pipeline responsables de IVA** (define el impacto real del +19% en cualquier escenario MoR).

**Fase 1 (2–4 semanas): asegurar Colombia con riel local.**
- Reunión comercial con **Wompi/Bancolombia** (como clientes del banco): SÍ por escrito para cobro recurrente tokenizado de un SaaS de IA + tarifa + habilitaciones (Daviplata, Botón Bancolombia). Cotizar también ePayco como respaldo y Treli como capa de suscripciones buy-vs-build.
- Diseñar el adapter `wompi` sobre `IPaymentProvider` + scheduler de cobros (BullMQ) + dunning. La plomería existente (webhooks idempotentes, reconciliación, `billing_events`) cubre la mitad del trabajo.

**Fase 2 (cuando se active la expansión): MoR para el exterior.**
- Abrir cuenta en **FastSpring** (primera opción LatAm: registros fiscales CO/MX/CL/PE, exención B2B, Pix Automático) y en **Paddle** (mejor producto/precio; pre-clarear el AUP) — el vetting es gratis y despeja la incógnita de aceptación antes de necesitarlos.
- Geo-separación: checkout MoR solo para compradores fuera de Colombia; Colombia sigue directa (Wompi/MP + Factus + IVA excluido). Esto maximiza margen local, evita el +19% a clientes colombianos y blinda la postura del Decreto 2223/2013 (el uso vía MoR ya no sería mayoritariamente en Colombia).

**Decisiones que quedan del dueño:**
1. ¿Perseverar con MP (soporte + SFC + prueba MIT) o pasar directo a Wompi? (No son excluyentes; recomendado: ambas en paralelo.)
2. Build vs buy del scheduler de suscripciones (propio sobre Wompi vs Treli).
3. Cuándo abrir el vetting de FastSpring/Paddle (recomendado: ya, es gratis y toma semanas).
4. Riel por país para la expansión (MX: domiciliación; AR: DEBIN; BR: Pix Automático) — decidir al planear cada mercado; Rebill se reevalúa al superar ~US$50k/mes.

## 9. Bloqueantes antes de cualquier cutover a MoR

| # | Bloqueante | Quién |
|---|---|---|
| 1 | Concepto escrito de tributarista (o consulta DIAN) sobre exportación de servicios vía MoR con clientes en Colombia — riesgo de "exportación ficticia" (Decreto 2223/2013 art. 2 par.) | Contador CO |
| 2 | Pre-aprobación escrita del caso de uso (AUP: lead scoring/categorización) en Paddle/FastSpring | Fundador |
| 3 | Compra de prueba en checkout: perfil B2B responsable de IVA, B2B no responsable y B2C — ¿quién paga +19%? | Fundador |
| 4 | Datos de auth-rate por país (CO/MX) pedidos al MoR + confirmación del riel real de payout a Bancolombia (Hyperwallet local vs SWIFT) y su costo | Fundador |
| 5 | Política escrita de exportación de tokens/suscriptores (plan de salida) | Fundador |
| 6 | Cotización formal de tarifas con nuestro mix de tickets (FastSpring/PayPro no publican precios) | Fundador |

## 10. Veredictos de verificación (resumen)

| Claim | Veredicto |
|---|---|
| Paddle acepta S.A.S. colombiana (lista negativa de países; CO no excluida) | ✅ Confirmado |
| B2B colombiano con NIT no paga 19% en checkout Paddle | ⚠️ Incierto — la exención legal depende de ser *responsable de IVA*, no de tener NIT; Paddle no documenta la validación para CO |
| Declines cross-border LatAm 15–25% | ⚠️ Incierto — es el piso; vendors miden 30–50% de aprobación vs 70–90% local; fuentes neutrales: lift local 5–16 p.p. |
| FastSpring registrado ante DIAN con exención B2B en checkout (CO/CL/PE) | ✅ Confirmado (NIT 901448273-6, desde 30-sep-2020) |
| FastSpring puede depositar en Bancolombia | ⚠️ Incierto — Hyperwallet llega a Colombia por rieles locales, pero sin confirmación oficial del programa FastSpring |
| PayPro acepta vendedores colombianos | ⚠️ Incierto — nada lo prohíbe, nada lo confirma; + letra chica: payout mínimo $400, reserva 3 meses |
| Polar acepta Colombia (Stripe Connect Express) | ✅ Confirmado |
| Dodo ofrece PSE/Mercado Pago en Colombia | ❌ **Refutado** — solo en marketing; docs técnicas: únicamente Pix BR one-time |
| Stripe Managed Payments excluye a Colombia como merchant | ✅ Confirmado (38 ubicaciones, cero LatAm) — cierra la ruta Lemon Squeezy |
| Wompi cobra recurrente tokenizado (tarjetas/Nequi/Daviplata/Bancolombia) a 2,65%+700+IVA | ✅ Confirmado contra docs oficiales (PSE excluido; Daviplata requiere activación comercial) |
| Mínimo Rebill US$500/mes bajo US$50k | ⚠️ Confirmado y **empeorado** — es permanente, no solo 3 meses; + 3% conversión de moneda |
| Bloqueo MP = filtro interno, no norma; Bre-B es aditivo | ⚠️ Núcleo confirmado; vínculo exacto con licencia SFC es inferencia |
| Exportación de servicios cubre el patrón MoR | ⚠️ Incierto — texto legal exacto, sin doctrina para el caso "mayoría de usuarios en Colombia"; concepto tributarista bloqueante |
| PL 004/2026 elimina el Régimen Simple | ❌ **Refutado** — el proyecto radicado no toca el RST |
| Penetración tarjeta de crédito CO 23,3% / MX 15,7% | ✅ Confirmado contra SFC e INEGI/CNBV |

## 11. Fuentes principales

- Paddle: help center (países soportados, impuestos por jurisdicción 1-ago-2025, payouts, AUP), developer docs (monedas, Pix, dunning), pricing; FTC press release jun-2025; Trustpilot.
- FastSpring: developer docs (payouts portal/Hyperwallet, monedas, métodos de pago, VAT por país), pricing.
- PayPro Global: Reseller Agreement (PDF oficial), FAQ withdrawal options. 2Checkout: docs (restricted countries, payouts, tax regulations); Globe Newswire (Verifone, abr-2025).
- Polar: docs supported-countries, pricing; Accel (seed jun-2025). Dodo: docs payment-methods/payouts, pricing, Trustpilot. Creem: docs supported-countries, pricing, Trustpilot. Stripe Managed Payments: docs eligibility. Lemon Squeezy: blog 2026-update.
- Colombia local: docs.wompi.co (fuentes de pago), wompi.com (tarifas), developers.payulatam.com (recurring deprecated), epayco.com/suscripciones, developers.bold.co, rebill.com/pricing, dlocalgo.com, treli.co, DRUO/Bre-B (Banco de la República CRE DSP-465, Infobae may-2026, Vanguardia jul-2026).
- Fiscal/cambiario: normograma DIAN (Decreto 2223/2013, Oficio 5846/2024, Oficio 11157/2025), Concepto DIAN 190/2024 (accounter/BDO), DIAN control cambiario FAQ, Banco de la República (cuentas de compensación), SFC/Banca de las Oportunidades RIF 2024, INEGI/CNBV ENIF 2024, Baker McKenzie/PwC (PL 004/2026), actualicese (RST exportadores).
- Aprobación/recurrencia: EBANX insights (local acquiring), Nuvei (México), beastinsights (síntesis independiente), PRNewswire (Pix Automático), Belvo (domiciliación MX), Infobae (DEBIN/ARCA), churnkey/digitalapplied (churn involuntario y dunning).

---

*Documento generado a partir de la investigación multi-agente del 12-ago-2026. Los veredictos "incierto" no son relleno: cada uno lleva una acción concreta en §9. Actualizar cuando MP responda el caso WCS-43605 y cuando Wompi dé respuesta comercial.*
