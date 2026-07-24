# Facturación Electrónica DIAN (Colombia) para Parallly — Decisión + Implementación (as-built)

**Autor:** Arquitectura + Asesoría fiscal · **Fecha:** 14-jun-2026 · **Actualizado:** 23-jul-2026 · **Versión:** 2.0
**Estado:** ✅ **IMPLEMENTADO (Factus) — pendiente configuración de go-live.** El camino A (proveedor tecnológico) se construyó completo en el módulo `apps/api/src/modules/fiscal/` (20 archivos) + 2 páginas dashboard + gate en billing. La capa está desplegada pero **dormida** (`isProviderReady` = false) hasta cargar credenciales Factus + rango de numeración y activar el gate — ver **§12 Runbook de go-live**. El documento se conserva como decisión de arquitectura + referencia de operación.
**Alcance:** Cómo emitir factura electrónica de venta (FEV) válida ante la DIAN cuando Parallly cobre suscripciones a clientes en Colombia, comparando (A) integrar un proveedor tecnológico vía API y (B) integración directa con la DIAN con software propio. **Decisión tomada y ejecutada: camino A vía Factus, ya codificado.**

> ⚠️ **Aviso fiscal:** Este documento es un insumo técnico-arquitectónico. Las decisiones tributarias señaladas (régimen de IVA / exclusión cloud computing, responsabilidades RUT) requieren validación de un contador o asesor tributario colombiano antes de activar la emisión en producción. Donde hay incertidumbre, está marcado explícitamente.

> ✅ **Mapa propuesta → implementación (as-built, jul 2026).** Cada pieza propuesta en este documento ya vive en el código. Rutas relativas a la raíz del repo salvo el módulo fiscal (`apps/api/src/modules/fiscal/`).
>
> | Propuesta (este doc) | Dónde se cumple |
> |----|----|
> | Capa `IFiscalInvoiceProvider` (§7.2) | `fiscal/interfaces/fiscal-provider.interface.ts` |
> | Factory por modo+país `FiscalProviderFactory` (§7.2/§8.4) | `fiscal/fiscal-provider.factory.ts` |
> | Modelo `FiscalInvoice` (§7.3) | `apps/api/prisma/schema.prisma:405-434` (tabla `fiscal_invoices`, schema `public`) |
> | Listener `@OnEvent(payment.succeeded / payment.refunded)` + encolado | `fiscal/fiscal-invoice.service.ts` |
> | Worker async (BullMQ, `attempts:5`, concurrency 3) | `fiscal/processors/fiscal-invoice.processor.ts` |
> | Adapter Factus (v2: emisión, NC, 409, descarga PDF/XML) | `fiscal/adapters/factus.adapter.ts` |
> | Adapter `UsRemoteAdapter` (modo total, recibo comercial) | `fiscal/adapters/us-remote.adapter.ts` |
> | Config global `fiscalMode`/`coIvaTreatment`/rango/emisor (§8.4) | `fiscal/fiscal-config.service.ts` (`platform_settings` `fiscal.*` + Redis 5 min) |
> | Toggle modo fiscal + guardas + `AuditLog` (§8.4) | `fiscal/fiscal-admin.controller.ts` (`PUT /fiscal-admin/config`) |
> | Operaciones Fiscales super_admin (listado cross-tenant, retry, re-emitir, factura de prueba, preview) | `fiscal/fiscal-admin.controller.ts` + `apps/dashboard/src/app/admin/fiscal/page.tsx` |
> | Datos fiscales del adquirente + validación NIT (módulo 11) / DANE | `fiscal/fiscal.controller.ts` + `fiscal/nit.util.ts` + `fiscal/fiscal-data.util.ts` |
> | UI datos fiscales + facturas del tenant | `apps/dashboard/src/app/admin/settings/fiscal/page.tsx` |
> | Gate "colecta antes del pago" (dormido por defecto) | `billing.service.ts` `assertFiscalDataReady` + `FiscalGateModal.tsx` / `FiscalBanner.tsx` |
> | PDF con marca propia + envío por correo (`send_email:false`) | `fiscal/fiscal-pdf.service.ts` + `fiscal/fiscal-email.service.ts` |
> | Retención legal en disco (XML+PDF firmados, 5 años) | `fiscal/fiscal-storage.service.ts` (`FISCAL_STORAGE_PATH`, default `/data/invoices`) |
> | Fallback "consumidor final" (adquirente no identificado 222222222222) | `fiscal/fiscal.constants.ts` `CONSUMIDOR_FINAL_ACQUIRER` |
> | Env/secrets Factus + storage | `.env.example:132-144`, `.github/workflows/deploy.yml` |

---

## 1. Resumen ejecutivo y recomendación

### Recomendación en una frase
**Integrar un proveedor tecnológico (PT) habilitado vía API REST. Ganador: Factus (Halltec). Segundo: Alegra (e-provider).** No construir integración directa con la DIAN. La inversión es reutilizable cuando llegue Stripe/LLC porque la capa fiscal se desacopla del proveedor de pago.

### Por qué (los tres argumentos decisivos)

1. **Esfuerzo y riesgo desproporcionados en la ruta directa.** Integración directa = **12–26 semanas-ingeniero** de construcción + **14–22 semanas-ingeniero/año** de mantenimiento permanente (la Res. 000165/2023 fue modificada al menos 3 veces en ~16 meses). Vía PT = **~4–6 semanas** de ingeniería para la solución productiva completa (el adapter en sí es ~1 semana) + 1–3 semanas de trámite DIAN en paralelo, y **~2–4 semanas/año** de mantenimiento. El core de Parallly es IA conversacional, no cumplimiento fiscal.

2. **El PT firma con SU certificado.** Bajo la Res. 000165/2023, cuando usas un PT autorizado, es el PT quien gestiona el certificado de firma digital y la firma XAdES en nombre del emisor. Parallly **no compra ni renueva** certificado ONAC (~$190.000 COP/año, estimado 2025 + gestión de renovación sin downtime), y se elimina la pieza técnica más frágil (firma XAdES-EPES byte a byte, causa #1 de rechazos).

3. **Encaje natural con la arquitectura existente.** Parallly ya tiene `OutboundQueueService` (BullMQ, 3 reintentos), patrón `@OnEvent('billing.payment.succeeded')`, cifrado AES-256-GCM, idempotencia por `providerPaymentId`. Factus ofrece emisión **síncrona** (una llamada devuelve CUFE+QR+PDF), **idempotencia nativa por `reference_code`** (clave para reintentos de webhook) y un objeto `billing_period` ideal para suscripciones. El esfuerzo de integración es bajo precisamente porque la plomería ya existe.

### Estado de ejecución (as-built jul 2026)

La **ingeniería está completa** (tareas 4 y 5); lo pendiente para producción es **trámite + configuración**, no código. El detalle de go-live está en **§12**.

| # | Acción | Quién | Estado |
|---|--------|-------|--------|
| 1 | **IVA decidido → excluido** (cloud computing). Concepto escrito del contador para auditoría | Contador CO | ⏳ Pendiente concepto (no bloquea; `coIvaTreatment='excluido'` codificado, conmutable a `gravado_19`) |
| 2 | Trámites DIAN: RUT (responsabilidad 52 + IVA), resolución de numeración (MUISCA), set de pruebas, vincular rango a Factus | Fundador + contador | ⏳ Pendiente (bloqueante de go-live) |
| 3 | Cotizar paquetes Factus + Alegra por WhatsApp/comercial (precios no públicos) | Fundador | ⏳ Pendiente |
| 4 | Construir capa `IFiscalInvoiceProvider` + modelo `FiscalInvoice` + adapter Factus + cola async | Ingeniería | ✅ **Hecho** — `apps/api/src/modules/fiscal/` |
| 5 | Capturar datos fiscales del adquirente en onboarding/settings + validadores NIT/DANE | Ingeniería | ✅ **Hecho** — `fiscal.controller.ts` + UI + gate |
| 6 | Cargar credenciales Factus + `numbering_range_id`, activar gate y flip a producción | Fundador + ing | ⏳ Pendiente — **§12 Runbook de go-live** |

### Qué hacer cuando llegue Stripe/LLC
La emisión DIAN **NO se vuelve obsoleta** si Parallly mantiene una entidad colombiana que factura a clientes colombianos (escenario más probable durante un buen tiempo). El cambio Stripe/LLC afecta el **emisor** (qué entidad factura, qué impuestos) y el **proveedor de pago**, no la obligación de FEV en Colombia. La capa `IFiscalInvoiceProvider` se diseña **agnóstica al proveedor de pago** (escucha el evento normalizado `PAYMENT_SUCCEEDED`, que ya abstrae MercadoPago/Stripe), de modo que el trabajo es reutilizable. Ver §8.

---

## 2. Contexto: qué tiene Parallly hoy y qué exige la DIAN

### 2.1 Estado del sistema (as-built jul 2026)

El sistema fiscal **ya existe** y cuelga del pipeline de billing, que sigue siendo **provider-agnostic**. La emisión NO vive dentro del adapter de pago: se dispara desde el evento normalizado `billing.payment.succeeded`, de modo que MercadoPago hoy y Stripe mañana se comportan igual.

| Componente | Estado | Archivo |
|------------|--------|---------|
| Emisión FEV DIAN | ✅ **Implementada** — módulo `fiscal/` (Factus): async, idempotente, con nota crédito | `apps/api/src/modules/fiscal/` (20 archivos) |
| Modelo de factura fiscal | ✅ Tabla `fiscal_invoices` (schema `public`) — ciclo pending→issued→failed→cancelled, NC, snapshot legal | `apps/api/prisma/schema.prisma:405-434` |
| Captura de pago + re-emisión de evento | `BillingPayment.create()` en tx + `eventEmitter.emit(billing.payment.*)` | `billing/billing.service.ts:~1018-1055` |
| Enganche fiscal | `FiscalInvoiceService.@OnEvent(payment.succeeded/refunded)` → crea `FiscalInvoice` + encola | `fiscal/fiscal-invoice.service.ts` |
| Abstracción de pago | `IPaymentProvider` + `PaymentProviderFactory` (MercadoPago / Stripe) | `billing/payment-provider.factory.ts` |
| Recibo PDF comercial (no fiscal) | `pdfkit`, on-demand — sigue en uso para `US_REMOTE` (modo total, sin FEV) | `billing/invoice-generator.service.ts` |
| Representación gráfica fiscal (marca propia) | ✅ PDF propio con QR DIAN, valor en letras, resolución/rango, datos de pago reales | `fiscal/fiscal-pdf.service.ts` |
| Campos espejo en el pago | `invoiceNumber` / `invoicePdfUrl` los puebla el processor tras emitir | `apps/api/prisma/schema.prisma:385-386` |
| Cola asíncrona | BullMQ `fiscal-invoice`, `attempts:5`, backoff exponencial 30 s, concurrency 3 | `fiscal/processors/fiscal-invoice.processor.ts` |

**Conclusión:** Ya no falta nada de la base — servicio fiscal, abstracción `IFiscalInvoiceProvider`, modelo `FiscalInvoice`, captura de datos del adquirente, cola + reintentos + escalamiento a Sentry: **todo construido**. Lo que resta es **configurar** (credenciales Factus + `numbering_range_id`) y **activar** (gate + flip a producción). Ver §12. La capa se mantiene **dormida** mientras `isProviderReady` sea false (sin credenciales o sin rango), así que desplegarla no genera facturas condenadas ni ruido en Sentry sobre pagos reales.

### 2.2 Lo que exige la DIAN (resumen normativo)

- **Norma vigente:** Resolución DIAN **000165 de 2023** (1-nov-2023), que adopta el **Anexo Técnico FEV v1.9** (obligatorio desde 1-may-2024). Modificada por 000119/2024, 000189/2024, 000202/2025 — **sigue vigente**.
- **Obligación subjetiva:** Una sociedad colombiana **debe** expedir FEV con validación previa por **todas** sus ventas (B2B y B2C), **la pida o no el cliente**. No hay excepción para personas jurídicas.
- **Qué es una FEV válida:** XML **UBL 2.1**, **CUFE** (hash SHA-384), **firma XAdES-EPES** con certificado ONAC, **validación previa** vía WS SOAP DIAN, **representación gráfica PDF con QR** (≥2 cm), y **entrega al adquirente** (.zip con AttachedDocument XML + PDF). La factura se entiende *expedida* solo cuando la DIAN la valida **Y** se entrega al cliente.
- **Trámites previos (siempre, sin importar la ruta):** RUT con responsabilidad **52**; **resolución de numeración** en MUISCA (prefijo, rango, clave técnica, vigencia ~2 años); aprobar el **set de pruebas** de habilitación.
- **Notas crédito/débito** electrónicas (CUDE) para reembolsos/ajustes — **no** requieren resolución de numeración previa.
- **Decisión tributaria crítica y separada:** el num. 21 art. 476 ET excluye de IVA la computación en la nube; el **Concepto DIAN 190 (001959) de 2024** confirma que un SaaS puede estar **excluido** de IVA si cumple el marco MinTIC (5 características + modelo de servicio + de despliegue), **solo para el proveedor directo**. Esto cambia si la factura lleva IVA 19% o 0% — **pero no exime de facturar**.

---

## 3. Camino A — Proveedor / API maduro

### 3.1 Cómo funciona y qué resuelve por ti

Un PT habilitado expone una API. Tú envías los datos del documento (emisor, adquirente, líneas, impuestos, periodo); el PT:

1. Construye el **XML UBL 2.1** conforme al Anexo 1.9.
2. Calcula el **CUFE/CUDE** (SHA-384).
3. **Firma** con SU certificado de firma digital (no compras el tuyo).
4. **Transmite** a la DIAN (WS SOAP, validación previa) y maneja contingencia/reintentos.
5. Devuelve **CUFE, QR, PDF, URL pública** y opcionalmente **envía el email** al adquirente.
6. Absorbe las **actualizaciones del Anexo Técnico** y la disponibilidad de los WS DIAN.

**Reparto de responsabilidades (modelo PT):**

| Lo hace el PT | Lo haces tú (una sola vez) |
|---------------|----------------------------|
| Generar XML, firmar, transmitir, CUFE, QR, PDF, contingencia, actualizaciones del anexo | Registrarte como facturador en MUISCA |
| Notas crédito/débito | Solicitar **tu** resolución de numeración |
| RADIAN/eventos | Aprobar el **set de pruebas** (≈8 facturas + 1 ND + 1 NC*) |
| Disponibilidad WS DIAN | **Vincular** el rango de numeración al PT en el portal DIAN |

\* El número exacto del set lo fija el `TestSetId` que asigna la DIAN; confirmar al generarlo (fuentes citan 2+1+1, 8+1+1 ó 60+20+20).

### 3.2 Tabla comparativa de proveedores

> Precios COP/USD: la mayoría de PTs colombianos **no publican tarifas**; el modelo dominante es **paquete prepago de documentos** (se consume 1 por emisión real; pruebas no consumen). Las cifras de “precio” abajo son orden de magnitud de mercado salvo donde se indique; el precio firme se obtiene cotizando.

| Proveedor | Categoría | Gestiona habilitación | Calidad API | Sandbox | Precio (orden de magnitud) | Fit SaaS | Notas crédito | Esfuerzo (días dev) | Recomendación |
|-----------|-----------|----------------------|-------------|---------|---------------------------|----------|---------------|---------------------|---------------|
| **Factus (Halltec)** | PT habilitado, API-first p/ devs y SaaS | Parcial (PT firma; tú haces numeración+set+vinculación) | **Alta** — REST/JSON, docs ES con Node/PHP/cURL, Postman+Bruno, idempotencia nativa, emisión síncrona | **Sí**, compartido gratis ilimitado + privado (pruebas no consumen cuota) | Paquetes prepago, **no público** (cotizar WhatsApp). Certificado incluido | **Alto** — `billing_period`, idempotencia por `reference_code`, `send_email` | **3–5** (+2–3 pruebas) | **🥇 Ganador** |
| **Alegra (e-provider)** | PT habilitado + plataforma contable; API e-provider documentada | Parcial (PT firma) | Alta — docs e-provider públicas, proceso de habilitación documentado | Sí | Plan/suscripción + paquetes; público parcial | Alto — ecosistema maduro, multiemisor más viable | Sí completo | 4–6 | **🥈 Segundo** |
| **Dataico** | PT habilitado, fuerte en API/integradores | Parcial | Alta — orientado a integración, multiemisor | Probable | No público (cotizar) | Alto — buena opción multiemisor futuro | Sí | 4–6 | Alternativa fuerte (evaluar multiemisor) |
| **Siigo** | Suite contable/ERP con FE | Parcial | Media — API existe pero orientada a su ERP | Sí (set de pruebas documentado) | Suscripción ERP (más caro p/ solo-FE) | Medio — pesa el ERP que no necesitas | Sí | 6–9 | No (over-kill p/ solo emitir) |
| **The Factory HKA** | PT habilitado regional (varios países LatAm) | Parcial | Media-alta — SOAP/REST, docs wiki (FelcoWiki) | Sí | Por documento/paquete (cotizar) | Medio-alto — útil si se expande a otros países LatAm | Sí | 5–8 | Considerar si hay expansión LatAm |
| **Facturatech** | PT habilitado tradicional | Parcial | Media — API SOAP/REST, menos dev-friendly | Sí | Paquetes (cotizar) | Medio | 6–9 | No prioritario |
| **Plemsi** | PT habilitado, API REST moderna | Parcial | Media-alta — REST, dev-friendly | Probable | Paquetes (cotizar) | Medio-alto | 4–6 | Tercer suplente |

### 3.3 Por qué Factus gana (y Alegra de segundo)

**Factus** es el mejor *fit* técnico para el caso exacto de Parallly (emitir sus **propias** facturas al cobrar suscripciones):
- API **REST/JSON moderna**, no SOAP; docs con ejemplos Node.js — encaja con NestJS.
- **Emisión síncrona** (`POST /v2/bills/validate` → CUFE+QR+PDF+`public_url` en una llamada).
- **Idempotencia nativa** por `reference_code` → reenviar el mismo id de pago no duplica factura (perfecto para reintentos de webhook).
- `billing_period` nativo y `send_email` automático.
- Sandbox gratuito ilimitado; las pruebas no consumen cuota.
- Se posiciona explícitamente para “plataformas SaaS”.

**Riesgos a vigilar en Factus** (no bloqueantes para el caso actual):
- **Precios no públicos** → bloquea TCO hasta cotizar.
- **OAuth password grant** (no client_credentials) → almacenar usuario/password de servicio cifrados + refresh de token cada hora.
- **Webhooks de estado no confirmados** en docs v2 → mitigado por emisión síncrona; confirmar con soporte si se necesita reconciliación async.
- **Single-issuer por cuenta** → suficiente hoy (Parallly = único emisor con su NIT). Limitación si algún día se factura *en nombre de* los tenants (ahí Alegra/Dataico multiemisor serían mejores).
- **Representación gráfica (PDF):** Factus genera el PDF con QR; confirmar al cotizar el grado de **personalización de marca** (logo de Parallly, colores) — para un SaaS la factura es un punto de contacto. Si el PT no permite branding, se puede generar un PDF propio a partir del XML+CUFE devuelto (reutilizando `pdfkit`, ya presente en `invoice-generator.service.ts`).
- **Manejo de `409` — con cuidado:** distinguir dos casos. (a) Factura **creada pero aún NO validada por la DIAN** (pendiente de envío) → se puede **eliminar por referencia y recrear**. (b) Factura **ya validada por la DIAN** → **NO se puede borrar** (una FEV emitida es inmutable y queda en los registros DIAN); cualquier ajuste se hace con **nota crédito**. El worker debe consultar `getStatus()` antes de decidir y **nunca borrar a ciegas**.

**Alegra (segundo)** porque su API e-provider está documentada públicamente, tiene proceso de habilitación claro y un ecosistema más maduro para un futuro multiemisor — a cambio de una integración algo menos directa para el caso simple.

### 3.4 Costo estimado (orden de magnitud — confirmar al cotizar)

> ⚠️ Los PT colombianos **no publican tarifas**. Las cifras de abajo son **rangos de mercado 2025–2026**, no cotizaciones; sirven solo para no dejar el TCO en blanco al decidir. El precio firme se obtiene cotizando Factus **y** Alegra.

El modelo dominante es **paquete prepago de documentos** (se consume 1 por emisión real; las pruebas en sandbox no consumen). El costo unitario **baja con el volumen**, y el certificado de firma va **incluido** en el plan del PT.

| Volumen (FEV + NC / mes) | Costo unitario aprox. | Costo mensual aprox.* | Costo anual aprox. |
|--------------------------|-----------------------|-----------------------|--------------------|
| ~100 | $150–$300 COP/doc | $30k–$80k COP | $0.4M–$1.0M COP |
| ~500 | $80–$150 COP/doc | $60k–$120k COP | $0.7M–$1.4M COP |
| ~2.000 | $40–$90 COP/doc | $120k–$220k COP | $1.4M–$2.6M COP |

\* En volúmenes bajos suele dominar un **mínimo mensual** o un paquete base. A escala de SaaS temprano (decenas–cientos de clientes), el gasto en FEV es **marginal frente al costo de LLM/infra** — no es un factor de decisión.

**TCO comparado, primer año (orden de magnitud):**
- **Camino A:** ~18–31 días-ing (una vez) + ~$0.5M–$2.6M COP/año de documentos + ~2–4 sem-ing/año de mantenimiento. Certificado incluido.
- **Camino B:** ~12–26 **semanas**-ing (una vez) + ~$190k COP/año de certificado + **14–22 sem-ing/año** de mantenimiento + asesoría fiscal continua. A un costo cargado de ingeniería conservador, la diferencia es de **decenas de millones de COP/año** a favor del camino A.

---

## 4. Camino B — Integración directa con la DIAN (software propio)

### 4.1 Pasos de habilitación

1. RUT con responsabilidad de facturación electrónica (la 52 la asigna la DIAN al habilitar).
2. Adquirir **certificado de firma digital** de CA acreditada por **ONAC** (Certicámara, GSE, Andes SCD, Thomas Signe). ~$150k–$200k COP/año.
3. Registrar en el portal “Habilitación” modo **“Software propio”** → genera Software ID, PIN/clave técnica, `TestSetId`, URL ambiente habilitación.
4. Desarrollar el emisor (ver anexo técnico §4.2).
5. Enviar el **set de pruebas** (`SendTestSetAsync`) hasta que **todos** los documentos sean aceptados sin error (reintentos ilimitados; rechazos no consumen el set).
6. Al aprobar → estado “Habilitado”, RUT actualizado (resp. 52). Cambiar config a producción.
7. Solicitar **resolución de numeración** de producción en MUISCA (prefijo ≤4, rango, clave técnica, vigencia ~2 años).
8. Emitir primera factura real.

### 4.2 Anexo técnico (lo que hay que construir)

| Pieza | Detalle | Dificultad |
|-------|---------|-----------|
| **XML UBL 2.1** | Perfil DIAN: Invoice, CreditNote, DebitNote, ApplicationResponse, AttachedDocument; `sts:DianExtensions` (InvoiceControl, SoftwareProvider, QRCode) | Media |
| **CUFE / CUDE** | Concatenación ordenada de campos con `;` + **SHA-384**. CUFE usa `ClTec` (clave técnica del rango); CUDE usa `SoftwarePIN`. Formato decimal exacto o invalida silenciosamente | Alta (errores silenciosos) |
| **Firma XAdES-EPES** | XMLDSig enveloped, ETSI TS 101 903: SignaturePolicyIdentifier (digest política DIAN), SigningTime, cadena de certificación completa, sello de tiempo | **Muy alta — punto #1 de atascos** |
| **WS SOAP DIAN** | `WcfDianCustomerServices.svc` con **WS-Security (X.509) + WS-Addressing** (WCF). Métodos: `SendBillSync`, `SendBillAsync`+`GetStatus`, `SendTestSetAsync`. Habilitación: `vpfe-hab.dian.gov.co`; producción: `vpfe.dian.gov.co`. **Interop SOAP desde Node/NestJS es propensa a errores** (hay que armar el sobre firmado a mano) | Alta |
| **QR + PDF** | QR ≥2 cm → `catalogo-vpfe.dian.gov.co/document/searchqr?documentkey={CUFE}`; PDF no puede contradecir el XML | Media |
| **AttachedDocument + entrega** | XML que envuelve factura firmada + ApplicationResponse DIAN; enviar .zip (XML+PDF) por email al adquirente. Sin entrega, no se considera expedida | Media |
| **Contingencia tipo 03/04** | Numeración de talonario pre-autorizada + retransmitir a DIAN en **48h** tras restablecer servicio | Media-alta |
| **Endurecimiento** | Idempotencia por documento, reintentos/circuit breaker, monitoreo de vencimiento de certificado y rango, almacenamiento legal de XML+CUFE+ApplicationResponse | Alta |

### 4.3 Esfuerzo y mantenimiento

- **Construcción inicial:** **12–26 semanas-ingeniero** (consenso de la investigación; el rango bajo asume equipo competente y el alto sin experiencia previa en FE colombiana). La firma XAdES-EPES sola: 3–6 semanas.
- **Mantenimiento recurrente:** **14–22 semanas-ingeniero/año** — adaptación al anexo (6–10 sem/año por ~1–2 resoluciones/año), contingencia+monitoreo WS (2–4), soporte rechazos (3–5), renovación certificado (0.5–1), NC/ND+RADIAN (1–2). **Más** asesoría fiscal continua.
- **Carga humana:** requiere perfil con conocimiento fiscal-tributario colombiano, no solo ingeniería.

**Cuándo tendría sentido el camino B:** solo si Parallly quisiera convertirse en **Proveedor Tecnológico** para emitir en nombre de terceros (vender FE como producto). Eso exige constitución en Colombia, patrimonio ≥20.000 UVT y **ISO 27001** — fuera de alcance hoy.

---

## 5. Comparación lado a lado

| Dimensión | Camino A — PT vía API | Camino B — Integración directa |
|-----------|----------------------|-------------------------------|
| **Esfuerzo inicial (ingeniería)** | **~4–6 sem** solución completa (adapter core ~1 sem) + 2–3 días pruebas | **12–26 semanas** |
| **Time-to-market** | **2–4 semanas** (limitado por trámite DIAN, no por código) | **3–6+ meses** (incluye set de pruebas + firma) |
| **Costo setup** | Bajo (integración) + cotización paquete | Alto (12–26 sem-ing) + certificado ONAC |
| **Costo recurrente** | Paquete prepago por documento + **~2–4 sem-ing/año** | **14–22 sem-ing/año** + certificado + asesoría fiscal |
| **Certificado de firma** | Lo aporta el PT | Lo compras y renuevas tú (~$190k COP/año, sin downtime) |
| **Riesgo de cumplimiento** | **Bajo** — el PT absorbe anexo/firma/WS | **Alto** — recae en Parallly (sanción 1% facturado, máx. 950 UVT; cierre por reincidencia) |
| **Mantenimiento normativo** | Absorbido por PT | Permanente (≥3 resoluciones en ~16 meses) |
| **Disponibilidad WS DIAN** | Gestionada por PT | Tu problema (caídas reales ene/dic-2025) |
| **Control / personalización** | Medio (limitado a la API del PT) | Total |
| **Multiemisor (futuro)** | Requiere PT multiemisor o cuenta por tenant | Imposible sin habilitarse como PT |

**Veredicto:** A domina en todo salvo “control”, que no es un requisito de negocio para Parallly. La diferencia de esfuerzo es de **un orden de magnitud** (~4–6 semanas la solución completa, o ~1 semana el adapter core, vs 12–26 semanas).

---

## 6. Bloqueantes y dependencias

| Bloqueante | Tipo | Dueño | Notas |
|-----------|------|-------|-------|
| **IVA** (decidido: excluido cloud computing) | Fiscal | Contador CO | **Decidido → excluido**, implementado como `coIvaTreatment` configurable (default `excluido`). Pendiente solo el concepto escrito del contador para auditoría. No bloquea construir |
| **Resolución de numeración** (MUISCA) | Trámite | Fundador | Obligatorio en ambas rutas. Vigencia ~2 años → monitorear consumo/caducidad |
| **Set de pruebas + vinculación al PT** | Trámite | Fundador + ing | 1–3 semanas calendario |
| ✅ **Datos fiscales del adquirente** | Código | Ingeniería | **Resuelto** — `Tenant.settings.fiscalData` (JSONB): `documentType`, `documentId`, `dv`, `legalOrganizationId`, `businessName`/`names`, `tributeId`, `address`, `municipalityId`/`daneCode`, `email`, `phone`. Endpoints `GET/PUT /fiscal/:tenantId/data` + UI |
| ✅ **Datos de la empresa emisora** | Config | Fundador | **Resuelto (movido de env a DB)** — `coIssuer` en `platform_settings` (`fiscal.issuer_co`): NIT, razón social, dirección, régimen, resolución, rango. Editable desde super admin. Cargar en go-live (§12) |
| **Pagos históricos pre-FEV (backfill)** | Fiscal / decisión | Contador + Fundador | ¿Qué pasa con suscripciones ya cobradas vía MercadoPago **antes** de activar FEV? ¿Facturación retroactiva dentro del plazo permitido, o arrancar limpio desde la fecha de activación? **Decisión del contador** — nombrarla, no ignorarla (puede haber obligación retroactiva) |
| ✅ **Retención legal de XML (5 años)** | Código / infra | Ingeniería | **Resuelto** — `FiscalStorageService` descarga y archiva XML+PDF firmados en `{FISCAL_STORAGE_PATH}/{tenantId}/{invoiceId}.{pdf\|xml}` (default `/data/invoices`), independiente del hosting de Factus |
| **Certificado de firma** | Externo | (solo camino B) | En camino A lo aporta el PT |
| ✅ **Validación NIT (módulo 11) + código DANE** | Código | Ingeniería | **Resuelto** — `nit.util.ts` (`computeNitDv`, valida/computa DV) en `PUT /fiscal/:tenantId/data`; DANE (5 díg.) → `municipality_id` de Factus resuelto en el adapter |

---

## 7. Encaje con pagos: capa fiscal desacoplada

### 7.1 Por qué desacoplar de MercadoPago/Stripe

La emisión fiscal **no debe vivir dentro del adapter de pago**. Razones:
- El evento normalizado `billing.payment.succeeded` ya abstrae el proveedor (MercadoPago hoy, Stripe mañana). La capa fiscal escucha ese evento y **no le importa** quién cobró.
- La emisión fiscal puede fallar de forma independiente al cobro (WS DIAN caído, cuota agotada): el pago **es exitoso** aunque la factura aún no se emita → debe ser **asíncrona y reintentable**, nunca bloquear el pago.

### 7.2 Diseño de la capa `IFiscalInvoiceProvider`

```
PAYMENT_SUCCEEDED (evento normalizado, agnóstico de pago)
        │
        ▼
FiscalInvoiceService.@OnEvent('billing.payment.succeeded')          [fiscal/fiscal-invoice.service.ts]
        │  resuelve provider; si !isProviderReady (sin credenciales / sin rango) → SALE (capa dormida)
        │  crea FiscalInvoice(status='pending') + acquirerSnapshot + encola job (BullMQ, attempts:5)
        ▼
FiscalInvoiceProcessor (worker, concurrency 3)                      [fiscal/processors/fiscal-invoice.processor.ts]
        │
        ▼
FiscalProviderFactory.resolve(cfg.mode, tenant.billingCountry)  →  IFiscalInvoiceProvider | null
        │   modo CO_LOCAL (híbrido) → FactusAdapter si billingCountry='CO'; si no → null (no se emite)
        │   modo US_REMOTE (total)  → UsRemoteAdapter (recibo comercial, SIN FEV DIAN; IVA-exterior aparte)
        │   (cfg.mode = setting global en platform_settings, editable desde super admin — ver §8.4)
        │   sin datos fiscales del adquirente → fallback CONSUMIDOR_FINAL_ACQUIRER (222222222222)
        │   moneda ≠ COP → convierte a COP con la TRM de ExchangeRate (registra trmApplied)
        ▼
provider.issue(data: FiscalInvoiceData)  →  { status, cufe, invoiceNumber, providerRef, qrUrl, pdfUrl, taxCents }
        │  idempotente por reference_code = FiscalInvoice.id  ·  status='pending' sin CUFE = NO emitida (reintenta + sondea)
        ▼
descarga XML+PDF firmados → archiva en disco (retención 5 años) → URLs propias /fiscal/{tenant}/invoices/{id}/{pdf,xml}
        ▼
UPDATE FiscalInvoice(status='issued') + espejo BillingPayment.invoiceNumber / invoicePdfUrl
        │
        ▼
FiscalEmailService.sendIssuedInvoice()  →  NUESTRA factura de marca (.zip PDF+XML); Factus NO envía (send_email:false)
```

**Interfaz (as-built — `fiscal/interfaces/fiscal-provider.interface.ts`):**
```typescript
interface IFiscalInvoiceProvider {
  readonly name: string;                                              // id del adapter: 'factus' | 'us_remote'
  issue(data: FiscalInvoiceData): Promise<FiscalIssueResult>;         // idempotente en data.referenceCode
  issueCreditNote(data: CreditNoteData): Promise<FiscalIssueResult>;  // CreditNoteData lleva originalProviderRef + originalInvoiceNumber
  getStatus(providerRef: string): Promise<FiscalStatusResult>;
}
```
Notas de contrato reales: la NC recibe **un solo** `CreditNoteData` (no `(originalRef, data)`); el `referenceCode` que se pasa es `FiscalInvoice.id`; y `FiscalIssueResult.status` distingue `'issued'` (CUFE presente, validada DIAN), `'pending'` (aceptada por Factus, sin CUFE aún — se sondea) y `'failed'` (rechazo no reintentable). El factory es **`FiscalProviderFactory`** y puede devolver `null` ("nada que emitir aquí"), no un `NoopAdapter`.

### 7.3 Modelo `FiscalInvoice` (implementado — `schema.prisma:405-434`, schema `public`)

Tabla dedicada (`fiscal_invoices`) en vez de meter todo en `BillingPayment`, para soportar el ciclo de vida fiscal (pending→issued→failed→cancelled), notas crédito y auditoría legal. Esquema real desplegado:

```prisma
model FiscalInvoice {
  id               String    @id @default(uuid())
  tenantId         String    @map("tenant_id")
  paymentId        String?   @unique @map("payment_id")   // BillingPayment.id; null para NC standalone
  type             String    @default("invoice")          // invoice | credit_note | debit_note
  status           String    @default("pending")          // pending | issued | failed | cancelled
  provider         String                                  // factus | us_remote | ...
  providerRef      String?   @map("provider_ref")          // bill_id interno de Factus (para NC)
  cufe             String?                                  // CUFE/CUDE asignado por la DIAN
  invoiceNumber    String?   @map("invoice_number")        // prefijo+consecutivo (ej. SETP990000001)
  xmlUrl           String?   @map("xml_url")
  pdfUrl           String?   @map("pdf_url")
  qrUrl            String?   @map("qr_url")
  amountCents      Int       @map("amount_cents")
  currency         String                                  // COP (moneda fiscal; la original va en metadata)
  taxCents         Int       @default(0) @map("tax_cents") // IVA
  relatedInvoiceId String?   @map("related_invoice_id")    // NC → FiscalInvoice.id original
  failureReason    String?   @map("failure_reason")
  attempts         Int       @default(0)
  metadata         Json      @default("{}")                // trmApplied, paymentProvider, numberingRange, consumidorFinalFallback, raw
  acquirerSnapshot Json?     @map("acquirer_snapshot")     // copia INMUTABLE de los datos fiscales del adquirente al emitir — trazabilidad legal aunque el tenant cambie su NIT después
  issuedAt         DateTime? @map("issued_at")
  createdAt        DateTime  @default(now()) @map("created_at")

  @@index([tenantId, createdAt])
  @@index([status])
  @@index([paymentId])
  @@map("fiscal_invoices")
  @@schema("public")
}
```
`BillingPayment.invoiceNumber` / `invoicePdfUrl` se siguen poblando (espejo/compat con el endpoint de descarga de recibos existente). El `acquirerSnapshot` lo persiste el processor con el adquirente **realmente** usado en la emisión (datos reales o el fallback consumidor final), no solo el capturado al crear la fila.

**Retención legal (5 años):** la DIAN exige conservar los documentos electrónicos (XML firmado + ApplicationResponse) **5 años**. No basta guardar la URL del PT: si Factus borra los archivos al expirar/cambiar de plan, Parallly queda sin respaldo legal. Plan: tras emitir, **descargar el XML+PDF y archivarlos en storage propio** (R2/volumen `/data/invoices/{tenantId}/`) y guardar la ruta en `xmlUrl`/`pdfUrl`; un job de verificación confirma que el archivo existe.

### 7.4 Decisiones de implementación clave

- **Idempotencia:** `reference_code` del PT = `FiscalInvoice.id`. Reintentos de webhook + reintentos de BullMQ no duplican. Factus lo soporta nativamente.
- **Manejo dual MercadoPago/Stripe:** ninguna lógica fiscal toca el adapter de pago; ambos terminan en el mismo `PAYMENT_SUCCEEDED`. El `currency` y `amountCents` vienen normalizados.
- **Notas crédito en reembolsos:** `@OnEvent('billing.payment.refunded')` → `issueCreditNote(facturaOriginal.providerRef)`. Factus: `POST /v2/credit-notes/validate` con `bill_id`. No requiere numeración previa.
- **Facturación recurrente y numeración:** cada renovación = un `PAYMENT_SUCCEEDED` = una FEV. El consecutivo lo gestiona el PT contra el rango vinculado; **monitorear saldo del paquete** (`GET /v2/subscriptions`) y consumo del rango.
- **Moneda COP / TRM:** la FEV colombiana se emite en **COP**. Si el cobro fue en USD (Stripe futuro), hay que convertir a COP a la **TRM del día**. La TRM legal es la **certificada por la Superintendencia Financiera / Banco de la República**, no una tasa de mercado arbitraria — usar una tasa equivocada invalida el valor fiscal. Confirmar que el modelo `ExchangeRate` se alimenta de esa fuente (o agregar un job que sincronice la TRM oficial) y registrar la TRM aplicada en `FiscalInvoice.metadata`. **Incertidumbre:** confirmar con contador el tratamiento exacto al facturar en COP cuando el cobro es en divisa.
- **B2B → NIT obligatorio (no opcional):** en un SaaS la mayoría de clientes son empresas. Si el adquirente es **empresa responsable de IVA** y no se captura su NIT/razón social, **no podrá descontar el IVA** → quejas y reprocesos. Por eso `fiscalData` (con NIT válido) es **requerido** para clientes empresa CO antes de activar la suscripción. **Nunca** caer a "consumidor final" como atajo para una empresa.
- **Consumidor final (B2C):** solo **personas naturales sin NIT** se facturan con la identificación genérica de "consumidor final" del Anexo 1.9. Aplica únicamente a B2C; confirmar con el contador umbrales/obligaciones.
- **No bloquear el pago:** la emisión es siempre async. Cron de barrido sobre `FiscalInvoice.status='failed'` o `pending` con `attempts<max` (reutilizar patrón de `reconciliation.processor.ts`).
- **Escalamiento de fallos permanentes:** si tras los 5 intentos + cron la `FiscalInvoice` sigue `failed`, es **incumplimiento fiscal silencioso**. Disparar **alerta a Sentry + email al admin** y exponer un **panel de facturas fallidas** en el dashboard (no solo reintentar en silencio). Definir SLA interno de resolución (p.ej. 24–48h).

---

## 8. Impacto del salto a LLC/EEUU + Stripe

### 8.1 Qué cambia fiscalmente

| Escenario | Quién factura a clientes CO | ¿Aplica FEV DIAN? | Notas |
|-----------|----------------------------|-------------------|-------|
| **Hoy:** SAS colombiana | SAS CO (NIT) | **Sí, obligatorio** | Lo que cubre este documento |
| **LLC US factura a clientes CO desde el exterior** | LLC US | **Depende** | Un no residente sin establecimiento permanente en CO normalmente **no** emite FEV DIAN. Pero CO tiene régimen de **IVA sobre servicios digitales del exterior** (prestadores extranjeros pueden tener que registrarse en RUT y recaudar IVA, o aplicar retención). **Requiere asesoría.** |
| **Modelo híbrido:** LLC US dueña, SAS CO opera/factura localmente | SAS CO | **Sí** | El más probable para mantener clientes CO y acceso a MercadoPago local. FEV sigue plenamente vigente |

### 8.2 ¿Se vuelve obsoleta la inversión en e-invoicing CO?

**No, si se elige bien la ruta.** Análisis:

- Si Parallly mantiene una **entidad colombiana** facturando a clientes CO (híbrido, lo más realista a corto/medio plazo), la FEV es **igual de obligatoria** con o sin LLC. La inversión es plenamente vigente.
- Si Parallly **migra 100%** a facturar desde la LLC US a clientes CO (sin entidad local), la **emisión DIAN podría dejar de aplicar** para esos clientes — pero entonces entra el régimen de **IVA servicios digitales del exterior**, que es otro problema de cumplimiento (probablemente vía Quaderno/Stripe Tax, no DIAN).
- **El trabajo de ingeniería NO se desperdicia** porque la pieza reutilizable es la **capa `IFiscalInvoiceProvider` + cola async + modelo `FiscalInvoice`**, no el adapter concreto. Cambiar de “Factus/DIAN” a “Quaderno/IVA-exterior” es **cambiar un adapter**, no reescribir la capa. El adapter Factus específico (3–5 días) es lo único potencialmente desechable, y solo en el escenario de migración total.

### 8.3 Cómo minimizar trabajo desechable — secuencia recomendada

1. **Construir la capa genérica primero** (`IFiscalInvoiceProvider`, `FiscalInvoice`, cola, factory por país). Esto es reutilizable en **cualquier** escenario futuro.
2. **Adapter Factus (CO)** como primera implementación concreta — necesario ya y de bajo costo.
3. **No** invertir en integración directa DIAN (sería el máximo trabajo desechable si el modelo fiscal cambia).
4. Cuando llegue LLC/Stripe: **decidir el modelo fiscal con el contador primero**, luego añadir el adapter que corresponda (Quaderno/Stripe Tax para IVA exterior, o mantener Factus si sigue habiendo entidad CO).

### 8.4 Toggle de "modo fiscal" en superadmin (híbrido ↔ total) — DECIDIDO

**Decisión del fundador (jun 2026):** arrancar en **modo híbrido** (SAS CO factura FEV DIAN) y poder **conmutar a modo total** (LLC US factura, sin FEV DIAN) **desde un botón en el superadmin**, sin redeploy.

**Diseño.** Un setting global de plataforma `fiscalMode` (no por tenant — es la entidad facturadora de Parallly la que cambia), persistido en `platform_settings` (tabla/módulo `settings/` ya existente) y cacheado en Redis:

```
fiscalMode: 'CO_LOCAL' | 'US_REMOTE'      // default 'CO_LOCAL'
coIvaTreatment: 'excluido' | 'gravado_19' // default 'excluido' (cloud computing)
```

| Modo | Entidad emisora | Clientes CO | IVA | Adapter resuelto |
|------|-----------------|-------------|-----|------------------|
| **`CO_LOCAL`** (híbrido, default) | SAS Colombia (NIT) | **FEV DIAN** vía Factus | Según `coIvaTreatment` (excluido por defecto) | `FactusAdapter` |
| **`US_REMOTE`** (total) | LLC US | **Sin FEV DIAN** — recibo comercial US | IVA servicios digitales del exterior gestionado aparte (Stripe Tax/Quaderno) | `UsRemoteAdapter` |

**Cómo funciona el switch:**
- `FiscalProviderFactory.resolve(cfg.mode, billingCountry)` lee `fiscalMode` **antes** que el país del tenant (§7.2). Flip del setting → la siguiente emisión ya usa el otro adapter. **Cero redeploy.**
- El **bloque emisor** (datos de la empresa que factura) también se resuelve por modo: config `issuer.CO_LOCAL` (NIT, razón social, resolución de numeración) vs `issuer.US_REMOTE` (legal name, EIN/dirección US). Switchear cambia el emisor automáticamente.
- **Forward-only:** el modo aplica solo a facturas **nuevas**. Las históricas conservan su `acquirerSnapshot` + emisor del momento (trazabilidad intacta).

**Guardas de seguridad del botón (importante):**
- Antes de permitir pasar a `US_REMOTE`, validar que la config de la LLC esté completa (legal name, dirección, y el mecanismo de IVA-exterior/Stripe Tax activo). Si no, **bloquear con aviso** — no dejar a Parallly sin emitir ningún documento.
- Mostrar un **modal de confirmación** explicando: "Al activar modo total, **se deja de emitir factura electrónica DIAN** para clientes colombianos. Confirmar con el contador antes de proceder." (Cumplimiento: apagar la FEV sin coordinar es un riesgo fiscal.)
- Registrar el cambio en `AuditLog` (quién, cuándo, modo anterior→nuevo).
- Idealmente, soportar una **fecha de corte** (`fiscalModeEffectiveFrom`) para alinear el cambio con un cierre contable, en vez de un flip instantáneo.

**Costo de construir el toggle:** bajo (~1–2 días) porque el factory + el modelo ya están diseñados para múltiples adapters; el toggle solo es el setting + la UI superadmin + las guardas. El `UsRemoteAdapter` puede empezar como un generador de recibo comercial (reutiliza `invoice-generator.service.ts`) y crecer hacia Stripe Tax/Quaderno cuando la LLC esté operando.

---

## 9. Plan de implementación por fases

> Estimaciones en días-ingeniero. El camino crítico de calendario es el **trámite DIAN** (1–3 semanas), que corre en paralelo a las fases 1–3.
>
> **Estado jul 2026:** las fases 1–5 están ✅ **codificadas** (módulo `apps/api/src/modules/fiscal/` + UI + gate en billing). Pendiente: el **trámite DIAN** (Fase 0) y la **estabilización con emisión real** (Fase 6) — ver el **§12 Runbook de go-live**.

### Fase 0 — Decisiones y trámites (calendario, no ingeniería)
- IVA ya decidido (excluido) → obtener concepto escrito del contador para auditoría; RUT; resolución de numeración; cotizar Factus+Alegra; iniciar set de pruebas y vinculación al PT.
- **Esfuerzo:** 0 ing · **Calendario:** 1–3 semanas (bloqueante para producción, no para construir).

### Fase 1 — Datos fiscales del adquirente y emisor (≈5–7 días) ✅
- **Prisma:** extender `Tenant.settings.fiscalData` (JSONB): `documentType`, `documentId`, `businessName`, `businessAddress`, `city`, `department`, `daneCode`, `taxResponsibility`, `email`.
- **API:** `GET/PUT /billing/:tenantId/fiscal-data` (DTO + validadores: NIT módulo 11, código DANE 5 dígitos). Guard: si `billingCountry='CO'` y el cliente es **empresa**, `fiscalData` con **NIT válido es obligatorio** antes de activar la suscripción; persona natural → mínimo nombre + documento (o consumidor final).
- **Snapshot del adquirente:** al emitir, copiar los `fiscalData` vigentes a `FiscalInvoice.acquirerSnapshot` (inmutable) para que las facturas históricas conserven el dato exacto facturado aunque el tenant cambie su NIT después.
- **Config emisor:** datos de la empresa emisora (NIT, razón social, prefijo, resolución) en config global + env.
- **UI dashboard:** sección “Datos Fiscales” en `apps/dashboard/src/app/admin/settings/billing/page.tsx` (collapsible, required si CO) + paso 1.5 en `onboarding/page.tsx` si país=CO.
- **i18n:** claves nuevas en `es.json`, `en.json`, `pt.json`, `fr.json` (`tipoDocumento`, `nit`, `responsabilidadTributaria`, `codigoDANE`, etc.) — **los 4 archivos**.

### Fase 2 — Capa fiscal genérica + modo fiscal (≈6–8 días) ✅
- **Módulo nuevo** `apps/api/src/modules/fiscal/`:
  - `fiscal.module.ts`, `fiscal-invoice.service.ts` (`@OnEvent('billing.payment.succeeded')`), `interfaces/fiscal-provider.interface.ts`, `fiscal-provider.factory.ts` (routing por **`fiscalMode` global → luego `tenant.billingCountry`**; ver §8.4).
  - `processors/fiscal-invoice.processor.ts` (BullMQ, `attempts:5`).
- **Prisma:** modelo `FiscalInvoice` (§7.3) + migración (usar `DIRECT_DATABASE_URL`).
- **Modo fiscal (§8.4):** settings globales `fiscalMode` (`CO_LOCAL`/`US_REMOTE`, default `CO_LOCAL`) y `coIvaTreatment` (`excluido`/`gravado_19`, default `excluido`) en `platform_settings`, cacheados en Redis. **Toggle en superadmin** con guardas (validar config LLC antes de pasar a `US_REMOTE`), **modal de confirmación**, `AuditLog`, y opcional `fiscalModeEffectiveFrom`. `coIvaTreatment` alimenta el mapeo de impuestos del adapter (excluido = sin IVA en la línea).
- **Config emisor por modo:** `issuer.CO_LOCAL` (NIT, razón social, resolución) vs `issuer.US_REMOTE` (legal name, dirección US).
- **Endpoint:** `GET /billing/:tenantId/fiscal-invoices` (listado dashboard).
- **Patrón:** seguir `billing-email.service.ts:62-71` para el listener y `reconciliation.processor.ts` para el cron de reintento.

### Fase 3 — Adapter Factus (≈4–6 días) ✅
- `adapters/factus.adapter.ts` implementa `IFiscalInvoiceProvider`:
  - Cliente OAuth (password grant, cache+refresh token 1h, **cifrar credenciales** AES-256-GCM con `ENCRYPTION_KEY` existente).
  - `issue()` → `POST /v2/bills/validate` con `reference_code=FiscalInvoice.id`, `billing_period`, líneas, IVA.
  - `issueCreditNote()` → `POST /v2/credit-notes/validate` (refund).
  - Mapeo de catálogos DIAN (DIVIPOLA, formas de pago, impuestos, unidades).
  - Manejo `409` (eliminar por referencia + recrear), `429` (rate limit 80/min), errores DIAN en `data.errors`.
- **Sandbox:** pruebas contra `api-sandbox.factus.com.co` (no consumen cuota).

### Fase 4 — Reembolsos, B2C y endurecimiento (≈3–4 días) ✅
- `@OnEvent('billing.payment.refunded')` → nota crédito.
- Manejo consumidor final (CO sin NIT).
- Conversión COP/TRM vía `ExchangeRate` si moneda ≠ COP.
- Cron de barrido `FiscalInvoice` pendientes/fallidas.
- Monitoreo de saldo de paquete (`GET /v2/subscriptions`) + alerta.

### Fase 5 — Env vars, secrets, verificación (≈1–2 días) ✅
- **Env vars (solo secrets Factus + ruta de archivo):** `FACTUS_BASE_URL`, `FACTUS_CLIENT_ID`, `FACTUS_CLIENT_SECRET`, `FACTUS_USERNAME` (email), `FACTUS_PASSWORD`, `FISCAL_STORAGE_PATH` (default `/data/invoices`). Ver `.env.example:132-144`.
- **NO van en env (corrección vs. el plan original):** el **emisor** (NIT, razón social, dirección, régimen, resolución de numeración), el **`numbering_range_id`** (venta y nota crédito), el **modo fiscal**, el **tratamiento de IVA** y los **catálogos por defecto** viven en `platform_settings` bajo el namespace `fiscal.*` (cacheados en Redis), editables desde el super admin **sin redeploy**. Se **descartaron** las variables `FISCAL_EMITTER_NIT` / `FISCAL_NUMBERING_PREFIX` / `FISCAL_RESOLUTION_NUMBER` que este plan proponía en env.
- **CRÍTICO:** las claves Factus están en **GitHub Secrets Y `.github/workflows/deploy.yml`** (líneas ~373-376, 435, 556-564) — si no, se pierden en el próximo deploy (el `.env` se regenera). `FISCAL_STORAGE_PATH=/data/invoices` ya se escribe en el `.env` del deploy.
- **Verificación:**
  ```
  cd apps/api && npx tsc --noEmit
  cd apps/api && npm run test:bootstrap     # DI errors (módulo fiscal)
  cd apps/dashboard && npx tsc --noEmit
  cd apps/api && npx prisma generate         # tras FiscalInvoice
  ```

### Fase 6 — Estabilización en producción (≈3–5 días)
Como Parallly **prueba en producción** (regla del proyecto), reservar un buffer explícito para lo que casi nunca sale al primer intento: iteración del **set de pruebas** contra el sandbox real (los rechazos no consumen el set, pero consumen tiempo), ajuste de **catálogos DIVIPOLA/impuestos/unidades** (ver Apéndice A), y verificación post-deploy con un cliente real.

- **Criterio de aceptación (definición de "hecho"):** emitir **1 FEV real en producción** a un cliente CO, **validada por la DIAN**, con **CUFE consultable** en `catalogo-vpfe.dian.gov.co/document/searchqr?documentkey={CUFE}`, XML+PDF entregados por email y archivados (retención 5 años), **más 1 nota crédito** real sobre un reembolso de prueba. Hasta cumplir esto, no se considera entregado.

| Fase | Días-ing | Bloqueante de |
|------|----------|---------------|
| 0 Trámites | 0 (calendario 1–3 sem) | Producción |
| 1 Datos fiscales | 5–7 | Emisión válida |
| 2 Capa genérica + modo fiscal | 6–8 | — |
| 3 Adapter Factus | 4–6 | Emisión |
| 4 Refunds/B2C/COP | 3–4 | — |
| 5 Env/verificación | 1–2 | Deploy |
| 6 Estabilización prod | 3–5 | Cierre / aceptación |
| **Total ingeniería** | **~22–32 días (≈4.5–6.5 semanas)** | |

---

## 10. Riesgos y mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
|--------|-------|---------|-----------|
| Aplicar IVA mal (excluido cuando era 19% o viceversa) | Media | Alto (sanciones, reliquidación) | Concepto escrito del contador respaldando la exclusión; `coIvaTreatment` configurable desde superadmin (excluido↔19%) sin redeploy |
| Precio Factus inaceptable tras cotizar | Media | Medio | Cotizar Factus **y** Alegra en paralelo; el factory soporta cambiar de adapter |
| WS DIAN caído / cuota agotada → factura no emitida | Media | Medio | Emisión async + reintentos BullMQ + cron de barrido + alerta de saldo. El pago nunca se bloquea |
| Webhooks de estado Factus inexistentes | Baja | Bajo | Emisión síncrona ya devuelve CUFE; confirmar con soporte |
| Rango de numeración agotado / resolución caducada | Baja | Alto (para la emisión) | Monitorear consumo; alerta a 80%; renovar 60–90 días antes |
| Cambio normativo del Anexo Técnico | Media | Bajo (con PT) | El PT lo absorbe; solo validar que el adapter siga funcionando |
| Migración a LLC invalida el adapter CO | Media | Bajo | Capa genérica reutilizable; solo el adapter es desechable (3–5 días) |
| Flip a `US_REMOTE` sin LLC lista → Parallly deja de emitir cualquier documento | Baja | Alto | Guarda en el botón: validar config LLC + mecanismo IVA-exterior antes de permitir el switch; modal de confirmación; AuditLog; `fiscalModeEffectiveFrom` (§8.4) |
| Lock-in con Factus (single-issuer) | Baja | Medio | `IFiscalInvoiceProvider` permite migrar a Alegra/Dataico sin tocar el resto |

---

## 11. Decisiones abiertas para el fundador

1. **IVA: DECIDIDO → excluido (cloud computing, num. 21 art. 476 ET + Concepto 190/2024).** Se implementa como `coIvaTreatment='excluido'` por defecto, **configurable** desde superadmin por si el contador ajusta a `gravado_19`. Pendiente solo el **concepto escrito del contador** que respalde la exclusión (documentar para auditoría), no bloquea construir.
2. **Proveedor:** ¿Confirmar **Factus** tras cotizar, o evaluar Alegra/Dataico si el precio o la necesidad multiemisor lo justifican?
3. **Cobertura geográfica:** ¿Emitir FEV solo para clientes CO ahora, y dejar otros países (AR/MX/CL) para después con sus propios adapters? (Recomendado: sí, empezar solo CO.)
4. **Política B2B vs B2C:** Recomendado — **empresas: NIT obligatorio** (sin él no descuentan IVA); **personas naturales sin NIT: consumidor final**. Confirmar con el contador que no haya umbrales que obliguen a identificar también a ciertas personas naturales.
5. **Modelo fiscal: DECIDIDO → híbrido con toggle.** Arranca en `CO_LOCAL` (SAS CO factura FEV DIAN) y se puede conmutar a `US_REMOTE` (LLC US, sin FEV DIAN) **desde el superadmin sin redeploy** (§8.4). El adapter Factus queda como permanente mientras exista entidad CO; el `UsRemoteAdapter` se desarrolla cuando la LLC opere.
6. **RADIAN:** ¿Parallly planea factorizar/ceder facturas? (Si no, RADIAN no es obligatorio; Factus lo soporta si cambia.)
7. **Pagos históricos (backfill):** ¿Se facturan retroactivamente los cobros ya realizados vía MercadoPago **antes** de activar FEV, o se arranca limpio desde la fecha de activación? — Decisión del contador (puede existir obligación retroactiva).

---

## 12. Runbook de go-live (activación en producción)

La capa está desplegada y **dormida**. Estos son los pasos para pasar a emisión real, en orden — nada aquí es código nuevo, es **configuración + trámite**.

**Precondición (trámite DIAN, calendario 1–3 sem):** RUT con responsabilidad 52; **resolución de numeración** aprobada en MUISCA (prefijo, rango, clave técnica); **set de pruebas** aprobado; rango **vinculado a la cuenta Factus**; paquete Factus contratado.

1. **Cargar credenciales Factus** en GitHub Secrets (`FACTUS_CLIENT_ID/SECRET/USERNAME/PASSWORD`; `FACTUS_BASE_URL` = sandbox mientras se prueba). Deploy → el `.env` se regenera con ellas.
2. **Verificar conexión** en super admin → Operaciones Fiscales → Factus (`GET /fiscal-admin/factus/health` debe dar OK).
3. **Fijar `numbering_range_id`** (venta; opcional el de nota crédito): `GET /fiscal-admin/factus/numbering-ranges` → guardar `fiscal.factus_numbering_range_id` (y `…_credit_…`). **Esto despierta la capa**: `isProviderReady` pasa a true solo con credenciales **y** rango.
4. **Configurar el emisor CO** (`coIssuer`: razón social, NIT, dirección, régimen, resolución/rango, vigencia) y el **ítem** (`itemDescription`, UNSPSC real en `defaultStandardCode`, `defaultUnitMeasureCode`). Ajustar `coIvaTreatment` si el contador cambia la exclusión.
5. **Emitir una factura de prueba** contra sandbox (`POST /fiscal-admin/test-invoice`) → debe devolver CUFE + QR consultable en el catálogo de **habilitación** DIAN. Revisar el **preview** del PDF de marca (`GET /fiscal-admin/preview-invoice`).
6. **Backfill de datos fiscales** de los tenants CO existentes (pedirles NIT/cédula desde la UI de datos fiscales) **antes** de activar el gate, para no bloquear cobros en curso.
7. **Activar el gate** `fiscal.gate_enabled=true` (super admin): a partir de ahí billing exige datos fiscales completos antes de cobrar a tenants CO (con opción "consumidor final" para personas naturales).
8. **Flip a producción:** `FACTUS_BASE_URL` al endpoint productivo, `fiscal.factus_environment='production'` y el `numbering_range_id` al de **producción**. La primera emisión real es el criterio de aceptación (§9 Fase 6): 1 FEV validada + 1 nota crédito.

**Rollback:** apagar el gate (`gate_enabled=false`) devuelve billing a soft-mode sin bloquear cobros; vaciar `factus_numbering_range_id` **re-duerme** la capa sin tocar código. El toggle `US_REMOTE` (§8.4) es la vía para dejar de emitir FEV cuando la LLC opere (con sus guardas).

---

## 13. As-built — detalles de implementación no anticipados por el plan original

Piezas que se construyeron y que el borrador de jun 2026 no había especificado:

- **Doble contrato de Factus (códigos + IDs) simultáneo.** El adapter envía a `/v2/bills/validate` el contrato **por códigos** vigente (`identification_document_code`, `tribute_code`, `municipality_code`, `unit_measure_code`, `standard_code`, `taxes[]`, `payment_details[]`) **y además** los campos legacy **por IDs internos** (`identification_document_id`, `tribute_id`, `unit_measure_id`…). La validación actual ignora claves desconocidas, así que enviar ambos maximiza compatibilidad. Hay mapeos explícitos id→código DIAN (`dianDocTypeCode`: 3→13 cédula, 6→31 NIT…; `dianTributeCode`: 18→'01' IVA, 21→'ZZ' no aplica). Ver `fiscal-config.service.ts` (`default*Id` vs `default*Code`) y `adapters/factus.adapter.ts`.
- **IVA excluido vs. gravado bien modelado.** `excluido` (art. 476, NO sujeto) emite `taxes:[{is_excluded:true}]` sin tasa; `gravado_19` trata el cobro como IVA-inclusivo y factura el neto (monto/1.19) para que Factus recalcule un IVA que cuadre el total.
- **CUFE-first / QR determinístico.** Un documento sin CUFE **no** se marca `issued` (queda `pending` y se sondea con reintentos BullMQ). El QR se reconstruye desde el CUFE (URL del catálogo DIAN, host de habilitación vs. producción) cuando Factus no devuelve el campo `qr`.
- **Recuperación de 409 con cuidado.** Ante "factura pendiente por enviar a la DIAN", primero **reconcilia por referencia** (si ya tiene CUFE, la recupera); solo si no está validada la **elimina por referencia y recrea**. Nunca borra a ciegas una factura ya validada (inmutable). El botón super-admin "Re-emitir (forzar)" solo actúa sobre facturas **sin** CUFE.
- **PDF con marca propia + correo propio (`send_email:false`).** Factus no envía nada; Parallly genera su representación gráfica (paleta de marca, QR, valor en letras, resolución/rango autoritativos del `numbering-range`) y la manda en un `.zip` con **PDF + XML firmado**. Endpoints propios `/fiscal/{tenant}/invoices/{id}/{pdf,xml}` como URL canónica.
- **Retención legal en disco.** `FiscalStorageService` descarga y archiva XML+PDF en `{FISCAL_STORAGE_PATH}/{tenantId}/{invoiceId}.{pdf|xml}` (default `/data/invoices`, mismo patrón/volumen que media) para los 5 años DIAN, independiente del hosting del PT.
- **Fallback "consumidor final".** Colombia exige documento por **toda** venta: si el tenant fue cobrado sin completar su perfil fiscal, se emite al adquirente no identificado `222222222222` (lo que hace un POS) en vez de fallar, y se persiste ese snapshot. Hay además un opt-in explícito de "consumidor final" en la UI de datos fiscales (`fiscal.constants.ts` + `fiscal.controller.ts`).
- **Gate "colecta antes del pago", dormido por defecto.** `assertFiscalDataReady` en `billing.service.ts` bloquea inicio/cambio de plan sin datos fiscales completos **solo** con `fiscal.gate_enabled=true` y país que lo requiera. UI: `FiscalGateModal` + `FiscalBanner`. Con el gate apagado (default) ni bloquea checkout ni molesta.
- **Operaciones Fiscales (super_admin).** Página `admin/fiscal/page.tsx` + `FiscalAdminController`: listado cross-tenant, filtros por estado/tenant, **retry** y **re-emitir**, **factura de prueba** (sandbox) con QR renderizado, **preview** del PDF, salud Factus y edición de toda la config (incluido el toggle de modo con guardas + `AuditLog`). La página `admin/settings/fiscal/page.tsx` es la vista del tenant (datos fiscales + sus facturas + descarga PDF/XML + retry).
- **Escalamiento de fallo permanente.** Tras agotar `attempts:5`, el processor marca `failed`, registra en Sentry (`module: fiscal`, `tenantId`) y la factura queda visible en el panel para acción manual.

---

## Apéndice A — Valores de catálogo DIAN para Parallly (configurables en `platform_settings`)

Para un SaaS el producto es siempre "servicio de suscripción", así que los catálogos son acotables (esto evita la fricción típica del mapeo DIAN). Valores **por defecto codificados**, ajustables **sin redeploy** desde la config fiscal (`fiscal.*` en `platform_settings`, vía Operaciones Fiscales); confirmar con el PT/contador al hacer go-live:

| Campo (Anexo 1.9) | Valor sugerido para Parallly |
|-------------------|------------------------------|
| Tipo de documento | `01` Factura electrónica de venta |
| Tipo de operación | `10` Estándar |
| Código producto/servicio | UNSPSC `81112200` (servicios de software/aplicaciones) — **confirmar** |
| Unidad de medida | `94` (unidad) o equivalente "servicio" del catálogo del PT |
| Forma de pago | `1` Contado (la suscripción ya está cobrada al emitir) |
| Medio de pago | `48` tarjeta crédito / `47` transferencia (según PSP) |
| Tributo | **Excluido de IVA (decidido, cloud computing)** → línea sin IVA; `coIvaTreatment` configurable a `01` IVA 19% si el contador lo ajusta |
| Municipio / Departamento | Código **DIVIPOLA (DANE)** del adquirente (5 dígitos) |
| Moneda | `COP` |
| Adquirente sin identificar | "Consumidor final" del Anexo 1.9 — **solo B2C persona natural** |

---

## Fuentes clave

**Normativa DIAN**
- Resolución DIAN 000165 de 2023 — normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0165_2023.htm
- Anexo Técnico FEV v1.9 (PDF) — dian.gov.co/impuestos/factura-electronica/Documents/Anexo-Tecnico-Factura-Electronica-de-Venta-vr-1-9.pdf
- Guía consumo de Web Services DIAN — dian.gov.co/.../Guia-Herramienta-para-el-Consumo-de-Web-Services.pdf
- Proceso de registro y habilitación — micrositios.dian.gov.co/sistema-de-facturacion-electronica/proceso-de-registro-y-habilitacion-como-facturador-electronico/
- Concepto DIAN 190 (001959) de 2024 (IVA cloud computing) — cijuf.org.co/normatividad/concepto/2024/concepto-190001959.html

**Proveedor (Factus)**
- Docs API v2 — developers.factus.com.co (autenticación, /v2/bills/validate, /v2/credit-notes/validate, rangos, suscripciones, glosario)
- Sitio comercial / FAQ habilitación — factus.com.co

**Referencias técnicas (camino B)**
- WSDL habilitación — vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc?wsdl
- Implementaciones open-source de referencia — github.com/soenac/api-dian, github.com/Stenfrank/soap-dian, github.com/DarwinMMC/FIRMA-XAdES-EPES-DIAN
- Certificados ONAC — certicamara.com, gse.com.co, thomas-signe.com

**Código Parallly (implementación fiscal)**
- `apps/api/src/modules/fiscal/` — módulo completo (20 archivos): interfaz, factory, adapters Factus/US, servicio+processor, config, storage, PDF/email, controllers
- `apps/api/src/modules/billing/billing.service.ts:~1018-1055` — `BillingPayment.create()` + `eventEmitter.emit(billing.payment.*)`; `assertFiscalDataReady` (gate)
- `apps/api/src/modules/billing/types/billing-event.enum.ts:24-26` — eventos `payment.*` (succeeded/failed/refunded)
- `apps/api/prisma/schema.prisma:405-434` — `FiscalInvoice`; `:385-386` — `BillingPayment.invoiceNumber`/`invoicePdfUrl`
- `apps/api/src/modules/billing/payment-provider.factory.ts` — patrón factory replicado en `fiscal/fiscal-provider.factory.ts`
- `apps/dashboard/src/app/admin/fiscal/page.tsx` (Operaciones Fiscales, super_admin) · `apps/dashboard/src/app/admin/settings/fiscal/page.tsx` (datos fiscales del tenant) · `components/FiscalGateModal.tsx`, `components/FiscalBanner.tsx`
- `.env.example:132-144` · `.github/workflows/deploy.yml` — secrets Factus + `FISCAL_STORAGE_PATH`

---

**Notas de confianza:** Los números de esfuerzo de la ruta directa y la frecuencia de cambios normativos tienen confianza alta. Los precios de los PTs son orden de magnitud (no públicos — cotizar). La decisión de IVA y el tratamiento COP/TRM cuando el cobro es en divisa tienen incertidumbre y **requieren contador colombiano**. El conteo exacto del set de pruebas lo fija el `TestSetId` de la DIAN — confirmar al generarlo.