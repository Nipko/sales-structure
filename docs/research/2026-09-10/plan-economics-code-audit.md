# Auditoría de planes y economía unitaria de Parallly

Fecha: 10 de septiembre de 2026. Alcance: lectura del código y documentos locales, sin consultar producción, credenciales ni proveedores. Esta auditoría complementa la investigación de reglas y tarifas oficiales de Meta: no valida las tarifas externas citadas por documentos anteriores.

## Conclusión

El repositorio **no demuestra todavía un margen mínimo por plan**. El presupuesto LLM degrada modelos después de consumirlo; no limita el gasto total. El consumo multimedia se estima y se comprueba antes de registrar su costo. El panel financiero calcula una contribución parcial y la presenta como beneficio. El crédito WhatsApp sembrado en los planes no tiene un consumidor de saldo encontrado. Por tanto, deben retirarse como evidencia las afirmaciones anteriores de que ningún tenant puede llevar un plan a pérdida y de que todos los planes son rentables en su peor caso.

La opción que mejor separa riesgos para la primera entrega es mantener cobro de software de Parallly y pago de Meta del negocio como cuentas distintas. Eso evita que Parallly financie el consumo Meta **sólo cuando se compruebe quién es el pagador de cada WABA y no exista una línea de crédito compartida**. El código no prueba el contrato comercial de Tech Provider ni la titularidad real de todas las cuentas.

## 1. Fuentes canónicas y matriz completa de planes

La autoridad runtime es `billing_plans`, combinada con overrides aprobados del tenant. El seed es de creación: no actualiza filas existentes salvo `--force`. Cambiar el seed no cambia automáticamente los planes vendidos. Véanse [seed:549](../../../apps/api/prisma/seed-billing-plans.js#L549), [lectura runtime:167](../../../apps/api/src/modules/throttle/tenant-throttle.service.ts#L167), [aplicación de overrides](../../../apps/api/src/modules/throttle/plan-feature-overrides.ts) y [catálogo:131](../../../apps/api/src/modules/billing/billing-plan-catalog.service.ts#L131).

**Valores de fábrica en código; no son una captura de los precios efectivos de producción.** Los importes COP están expresados abajo en pesos, después de dividir `amountCents` por 100. El anual es el cargo total de doce meses, con descuento sembrado del 15 %. No existe un precio anual USD independiente en el seed.

| Plan | Referencia USD/mes | COP/mes | COP/año | COP/mes normalizado del anual | Respuestas IA/mes | Agentes | Usuarios | WA conectadas permitidas |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Emprendedor | 21 | 125.700 | 1.282.140 | 106.845 | 1.000 | 1 | 1 | 1 |
| Starter | 49 | 276.900 | 2.824.380 | 235.365 | 5.000 | 1 | 3 | 1 |
| Pro | 129 | 757.700 | 7.728.540 | 644.045 | 25.000 | 3 | 5 | 2 |
| Enterprise | 349 | 1.789.800 | 18.255.960 | 1.521.330 | 100.000 | 10 | Sin límite seed | 3 |
| Custom | Negociado; seed 0 | Sin precio seed | Sin precio seed | Depende del contrato | Sin límite seed | 999 seed | Sin límite seed | Sin límite seed |

Fuentes por familia: [Emprendedor:41](../../../apps/api/prisma/seed-billing-plans.js#L41), [Starter:148](../../../apps/api/prisma/seed-billing-plans.js#L148), [Pro:249](../../../apps/api/prisma/seed-billing-plans.js#L249), [Enterprise:349](../../../apps/api/prisma/seed-billing-plans.js#L349), [Custom:449](../../../apps/api/prisma/seed-billing-plans.js#L449). El Custom de cero dólares es `salesLed`, no una suscripción ilimitada gratuita: [catálogo:207](../../../apps/api/src/modules/billing/billing-plan-catalog.service.ts#L207).

| Plan | Tier seed | Umbral blando LLM USD/mes | Crédito WhatsApp USD sin débito encontrado | Multimedia USD/día | Audio/mes | Imágenes/mes | Embeddings/mes | Páginas crawl |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Emprendedor | tier_4 | 8 | 5 | 0,10 | 30 | 50 | 100 | 0 |
| Starter | tier_3 | 25 | 10 | 0,25 | 150 | 250 | 1.000 | 50 |
| Pro | tier_2 | 60 | 25 | 1 | 500 | 1.000 | 10.000 | 500 |
| Enterprise | tier_1 | 100 | 0 | 5 | 2.000 | 5.000 | 50.000 | Sin límite seed |
| Custom | tier_1 | Sin umbral seed | 0 | 50 | Sin límite seed | Sin límite seed | Sin límite seed | Sin límite seed |

Además afectan costo y soporte: retención 90/180/365/730 días/ilimitada; almacenamiento 50/100/1.024/10.240 MB/ilimitado; automatización 0/5 reglas/ilimitadas; campañas 0/3/ilimitadas. Los límites por hora de salida son 100/200/2.000/20.000/ilimitado. Son límites distintos: campaña, llamada al modelo, respuesta IA, entrega al canal y conversación no pueden contarse como una sola unidad.

El seed de canales incluye `email` desde Starter y `sms` desde Pro. Eso no transforma Email en canal conversacional self-service ni SMS en chat: la referencia actual del producto declara Email adaptador interno y **SMS retirado para nuevas altas, configuración, compras y campañas**, conservando obligaciones legacy. Hay que revisar proyección comercial y textos para evitar venderlos como ofertas conversacionales actuales. Web Chat se habilita por `widget`, no por ese arreglo. La auditoría posterior de [landing](landing-claims-and-content-audit.md) verificó que esos canales legados todavía aparecen en las tarjetas públicas.

El catálogo puede cotizar en países/monedas que no se pueden cobrar. `PaymentRoutingService` deja Wompi habilitado por defecto, Stripe apagado y Mercado Pago retirado para suscripciones; los defaults sólo cobran CO. Stripe tiene implementación, pero su existencia no demuestra habilitación ni checkout internacional certificado. [Routing:67](../../../apps/api/src/modules/billing/payment-routing.service.ts#L67), [capacidad Wompi:132](../../../apps/api/src/modules/billing/adapters/provider-capabilities.ts#L132), [catálogo y disponibilidad:91](../../../apps/api/src/modules/billing/billing-plan-catalog.service.ts#L91).

## 2. Hallazgos que cambian las conclusiones de rentabilidad

1. **El umbral LLM es blando.** Al llegar al valor, `ConversationsService` restringe tiers para futuros turnos y continúa respondiendo. Un turno puede hacer cinco iteraciones y una respuesta final sin herramientas. El umbral se lee antes del loop, no se reserva por llamada concurrente. El costo después del umbral existe. Un valor cero tampoco activa ese bloque (`> 0`). [presupuesto:3865](../../../apps/api/src/modules/conversations/conversations.service.ts#L3865), [loop:3830](../../../apps/api/src/modules/conversations/conversations.service.ts#L3830), [respuesta adicional:4156](../../../apps/api/src/modules/conversations/conversations.service.ts#L4156).

2. **Cuota IA y cuota de Meta no son equivalentes.** La mensajería comprueba `used < limit` y aumenta el contador después con errores silenciados; varias conversaciones del tenant pueden entrar antes de consumir. Widget ya tiene una reserva distinta. Debe unificarse la reserva idempotente de consumo. Cada turno puede producir texto y media separados; humanos, recordatorios, campañas, Flows y automatizaciones también generan entregas sin corresponder uno a uno al contador IA. No publicar “1.000 IA = ningún costo Meta”. [comprobación:1030](../../../apps/api/src/modules/conversations/conversations.service.ts#L1030), [consumo:1177](../../../apps/api/src/modules/conversations/conversations.service.ts#L1177), [reserva widget:5515](../../../apps/api/src/modules/conversations/conversations.service.ts#L5515), [contador:374](../../../apps/api/src/modules/throttle/tenant-throttle.service.ts#L374).

3. **Telemetría LLM no es factura.** El router calcula tokens con precios estáticos del registro y escribe asíncronamente a Redis. Redondea cada llamada a 0,0001 USD; usa TTL y operaciones `allSettled`. No se encontró ahí reserva durable, conciliación de facturas, versiones de tarifa ni tratamiento detallado de descuentos de caché. Las operaciones fallidas sin usage no prueban costo cero. [registro:42](../../../apps/api/src/modules/ai/router/llm-router.service.ts#L42), [tracking asíncrono:534](../../../apps/api/src/modules/ai/router/llm-router.service.ts#L534), [cálculo/Redis:655](../../../apps/api/src/modules/ai/router/llm-router.service.ts#L655).

4. **Multimedia no es un techo financiero duro.** `checkQuota` lee gasto anterior y `recordUsage` registra después: hay sobrepaso por concurrencia y por el costo de la siguiente operación. Visión usa precios aproximados por imagen y redondea hacia arriba a un centavo, aunque su propia tabla contiene valores inferiores a un centavo. Eso puede sobreestimar unas cargas, inframodelar otras y anticipar el agotamiento de cuota. Audio usa duración y tarifa estática. Estas llamadas son directas a proveedores, por lo que sumar sólo estadísticas del router no las cubre. [media:85](../../../apps/api/src/modules/media-processing/media-throttle.service.ts#L85), [registro:98](../../../apps/api/src/modules/media-processing/media-throttle.service.ts#L98), [visión:13](../../../apps/api/src/modules/media-processing/image-vision.service.ts#L13), [visión:81](../../../apps/api/src/modules/media-processing/image-vision.service.ts#L81), [audio:60](../../../apps/api/src/modules/media-processing/audio-transcription.service.ts#L60).

5. **El panel financiero sobreafirma margen.** MRR suma `plan.priceUsdCents`; no representa necesariamente el precio congelado COP, anual/12 ni descuentos de cada contrato. `getTenantProfitability` resta sólo costo LLM del cobro. El snapshot usa llamadas LLM como `aiMessages` y fija `conversations: 0`. Recaudación anual recibida en un mes no es ingreso mensual reconocido. Se debe distinguir dinero cobrado, ingreso devengado, margen directo y resultado después de soporte/infraestructura. [MRR:23](../../../apps/api/src/modules/financials/financials.service.ts#L23), [rentabilidad:178](../../../apps/api/src/modules/financials/financials.service.ts#L178), [snapshot:127](../../../apps/api/src/modules/financials/financial-snapshot.service.ts#L127), [precio contractual:460](../../../apps/api/prisma/schema.prisma#L460).

6. **WhatsApp credit no es crédito operativo.** La búsqueda por `whatsappCreditUsdCents` en apps/packages encontró seed, registro de features y traducciones administrativas; no encontró wallet, reserva, liquidación o crédito de Meta. Retirarlo de promesas nuevas, inventariar si se vendió antes y resolver esos compromisos. No convertirlo silenciosamente en un umbral de alerta: son derechos distintos. [seed:101](../../../apps/api/prisma/seed-billing-plans.js#L101), [registro:84](../../../apps/api/src/modules/throttle/plan-features.registry.ts#L84).

7. **Los documentos de julio/octubre contienen decisiones que necesitan corregirse.** Julio conserva Starter 215.800 y Pro 679.500 COP, comisión Mercado Pago y crédito Meta como COGS; el seed actual difiere y el rail cambió. Su addendum corrige parte del pagador, pero siguen las afirmaciones de no pérdida garantizada. Octubre recomienda no mover precios y una equivalencia de cuota IA con cuota gratuita Meta que el código no soporta. Las recomendaciones y tarifas externas deben volver a verificarse en investigación primaria. Los dos archivos se leyeron y se preservaron intactos.

## 3. Modelo de margen reutilizable, sin inventar costos reales

Para cada tenant, plan, ciclo y moneda, definir:

```text
G = precio bruto contractual, descuentos y prorrateos aplicados, normalizado al mes
R = ingreso de software devengado sin impuestos recaudados por cuenta de terceros
F = comisión porcentual efectiva de cobro + cargo fijo/ciclo + costos no recuperables
L = SUM(tokens uncached, cached, output, reasoning, audio, imagen × tarifa versionada)
O = embeddings + extracción/OCR + búsqueda/crawl + storage/egress + herramientas pagadas
M = gasto Meta asumido por Parallly (0 sólo si el cliente es el pagador confirmado)
S = minutos soporte × costo cargado/minuto + onboarding amortizado
I = infraestructura/observabilidad/backups asignados con criterio documentado
D = devoluciones netas + contracargos + incobrables + fraude esperado
Q = amortización de evaluación/certificación recurrente
C = F + L + O + M + S + I + D + Q
margen_contribución = (R - C) / R
```

Si hay IVA incluido en el precio, `R = G / (1+t)` antes de otros ajustes; si está excluido/aplicación distinta, usar tratamiento correspondiente. El código ofrece `excluido` y `gravado_19` con default excluido, pero eso **no determina el tratamiento fiscal legal ni el valor runtime**. [fiscal config:88](../../../apps/api/src/modules/fiscal/fiscal-config.service.ts#L88). Las retenciones recuperables afectan caja y conciliación, no deben deducirse automáticamente como gasto permanente. La comisión Wompi real, impuestos no recuperables y tarifa Factus son datos pendientes del contrato/factura, no heredables del doc Mercado Pago.

Para un margen objetivo `g`, el presupuesto variable disponible es `(1-g)×R - F - S - I - D - Q`. Sólo después se reparte entre LLM, multimedia, conocimiento, herramientas y Meta asumido. Invertir la fórmula permite cotizar: si `C0` son costos no proporcionales al precio y `f` es la comisión proporcional al ingreso neto, `R_min = C0 / (1-g-f)`, cuando el denominador es positivo. Recalcular si la comisión se aplica al importe bruto con impuestos.

Propuesta inicial de política, pendiente de decisión: objetivo de contribución del 70 % con todo C incluido, piso de alerta 60 % por cohorte y revisión individual al caer bajo 50 %. No son márgenes actuales ni estándares de mercado comprobados.

### Espacio de costo de cada plan al objetivo propuesto

El siguiente cálculo es sólo `30 % × precio`, antes de conocer impuestos y comisiones. Es el máximo conjunto para todos los costos si el precio fuera ingreso neto. El anual tiene menos espacio cada mes aunque se cobre por adelantado.

| Plan | Costos máximos COP/mes con venta mensual | Costos máximos COP/mes con venta anual | Costos máximos USD/mes sobre referencia USD |
|---|---:|---:|---:|
| Emprendedor | 37.710 | 32.053,50 | 6,30 |
| Starter | 83.070 | 70.609,50 | 14,70 |
| Pro | 227.310 | 193.213,50 | 38,70 |
| Enterprise | 536.940 | 456.399 | 104,70 |
| Custom | 30 % del ingreso neto contractual | Según contrato | Según contrato |

Ejemplo de sensibilidad **no cotización FX actual**: a 4.200 COP/USD, sólo alcanzar el umbral LLM consume 33.600/105.000/252.000/420.000 COP. Starter y Pro ya superan toda la bolsa de costo al objetivo del 70 % antes de multimedia, soporte y cobro; Emprendedor consume más que toda su bolsa anual; Enterprise deja 36.399 COP/mes en el anual para el resto. Esto no dice que todos lleguen al umbral; demuestra por qué el umbral no puede presentarse como garantía de ese margen.

Evaluar escenarios con FX 3.600/4.200/4.800 como sensibilidad, uso 10/50/100 %, 1/3/6 llamadas por turno, p50/p95/p99 de tokens y soporte, devoluciones y precio anual. Ninguno debe confundirse con previsión de consumo sin telemetría. Para Meta, variar país del destinatario, categoría, fecha tarifaria, número/WABA, mensajes emitidos por tarea y beneficios que la fuente primaria confirme. El país de facturación del tenant no sustituye al país del destinatario.

## 4. Recomendación por familia

| Familia | Cambio propuesto | Condición para precio final |
|---|---|---|
| Emprendedor | Mantener propuesta simple; una conexión y configuración guiada; exponer claramente software y Meta; contabilizar respuestas IA y mensajes canal por separado; evitar promesa de costo total cero. Evaluar acceso económico a widget/Telegram si el producto busca una alternativa de atención con menor costo canal. | Medir costo de onboarding y soporte; ajustar presupuesto y cuota a margen anual, no sólo mensual. |
| Starter | Corregir análisis de precio antiguo; controlar herramientas y multimedia; una bolsa de ejecución verificable y top-ups opcionales con aceptación. | Decidir cuota/precio después de medir p95; no subir sólo por FX implícito desactualizado ni garantizar 5.000 respuestas al modelo premium por costo fijo. |
| Pro | Mantener valor en operaciones, CRM, cobros del negocio y varias conexiones; medir ejecuciones completas por tipo de tarea y conexión; presupuestar el aumento de llamadas de herramientas. | Recalcular 25.000 respuestas, presupuesto USD60 y descuento anual como un conjunto. |
| Enterprise | Precio base + bolsas de ejecución/canales/soporte pactadas; hacer explícito qué calidad de modelo está certificada y los límites de SLA; revisar ilimitados con costo variable. | Capacidad, soporte y p95/p99 reales; evitar degradar a un modelo no certificado para operaciones críticas. |
| Custom | Cotización obligatoria con mínimo contractual, presupuesto por tenant/subcuenta, concurrencia, volumen, soporte, evaluación y retención explícitos. | No activar ilimitados sin contrato y reserva; ningún precio de cero tomado del seed puede originar facturación gratis accidental. |

Primero corregir medición y vender con límites coherentes; decidir luego cuánto mover precios. Si no hay datos antes de lanzamiento, la alternativa prudente es ofrecer cuotas conservadoras y top-ups voluntarios claramente cotizados, sin sobrecostos automáticos ni deterioro silencioso de calidad.

## 5. Tres circuitos de pago que no se deben fusionar

1. **Negocio → Parallly:** suscripción SaaS. Wompi y motor recurrente; tarjeta habilitada por default, Nequi y Bancolombia implementados pero bajo flags independientes. [routing:99](../../../apps/api/src/modules/billing/payment-routing.service.ts#L99).
2. **Negocio → Meta:** gastos de WhatsApp. Guía por WABA y pagador real. Añadir una tarjeta a Parallly/Wompi no configura el pago en Meta y no autoriza reutilizarla. Todos los planes con WhatsApp necesitan este onboarding, incluso Emprendedor y Starter.
3. **Cliente final → negocio:** herramientas para cobrar compras/reservas mediante credenciales Wompi/Mercado Pago del tenant. Se habilitan con `customerPayments` y su autorización de herramientas; no financian ni suscripción ni gasto de Meta. [credenciales:297](../../../apps/api/src/modules/tenant-payments/tenant-payments.service.ts#L297), [entitlement:2492](../../../apps/api/src/modules/tenant-payments/tenant-payments.service.ts#L2492).

Si en otra fase Parallly asume Meta con partner/línea de crédito, crear un cuarto producto de wallet/reventa: autorización comercial, moneda, límites, reserva concurrente, conciliación por entrega, impuestos, devolución, impago y colchón de caja. Un markup arbitrario del 10 % no asegura margen después de cobro, FX, soporte e incobrables. El ledger SMS es una referencia de diseño, no prueba que se pueda reutilizar sin revisar sus unidades y estados.

## 6. Trabajo que debe añadirse al plan de ejecución

- **P0 antes de vender planes revisados:** export de sólo lectura de filas runtime de planes, precios congelados/ciclo/descuentos, overrides, pagador WABA y routing habilitado; sin secretos ni datos personales. Calcular diff seed/runtime/landing/checkout/facturas. La presente auditoría no hizo ese acceso.
- **P0 promesa comercial:** retirar crédito WhatsApp inexistente de nuevas ofertas y explicar claramente las tres facturas. Mantener compromisos previos hasta migración comercial explícita. No igualar cuota IA y Meta.
- **P0 costo y presupuesto:** ledger de uso monetario versionado, reserva antes de inferencia/efecto, liquidación de uso real y outcome desconocido, idempotencia, reconciliación, ajustes de tarifa; separar presupuesto de alerta, límite contractual y límite técnico. Cubrir copilot/Assist, chat, media, RAG, aprendizaje, evaluaciones y tareas en background.
- **P0 calidad ante límite:** mismo contrato para todos los canales; si el modelo permitido pierde capacidad certificada, ofrecer alternativa explicada o humano. Nunca degradar a una herramienta insegura para salvar margen.
- **P1 financiera:** reemplazar profit parcial por contribución desglosada; ingreso mensual devengado anual, precio contractual, impuestos, fees, FX, soporte y costos directos. Alertas por tenant y por cohorte/plan/vertical/canal.
- **P1 catálogo:** versiones con vigencia, aprobación de cambio, cobro congelado, migración de suscripciones existentes, cuotas y precio indivisibles, verificación cuatro idiomas, API de disponibilidad y ausencia de checkout engañoso fuera de CO.
- **P1 pruebas económicas:** carreras de reserva, reintentos sin doble cobro, caída de Redis, retraso de webhook/cambio mensual, máximo 31 días, anual/12, cupón/contracargo, medio ausente, Meta desconocido, varios números y monedas, tool loop y modelo fallback.

### Datos faltantes para afirmar margen real

Filas runtime y contratos vigentes; factura mensual de cada proveedor IA, Meta y storage; descuentos/caché y errores facturables; comisión Wompi efectiva por método, impuestos y retenciones; tratamiento fiscal comprobado; renovación anual/cupones/impago; soporte por tenant y costo laboral; infra compartida y saturación; distribución de tokens, llamadas, tareas resueltas y ratio mensajes por tarea; coste de adquisición y tasa de churn. CAC y gasto de desarrollo deben reportarse aparte de contribución y usarse en payback/resultado operativo, no ocultarse.

El archivo hermano `plan-economics-inputs.json` contiene el seed completo extraído estáticamente y los cálculos transparentes de las bolsas de costo. Ninguna conexión DB ni código de siembra fue ejecutado.
