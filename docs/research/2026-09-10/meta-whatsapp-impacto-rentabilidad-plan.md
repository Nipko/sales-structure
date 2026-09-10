# WhatsApp y Meta: impacto, rentabilidad y plan de adaptación de Parallly

**Fecha de corte: 10 de septiembre de 2026.** Investigación pública y auditoría de código; sin acceso a producción, cambios de precios, contratación, envíos reales ni gasto. Las propuestas siguientes requieren implementación y validación. No son un certificado de margen ni de cumplimiento contractual.

## Decisión principal

Parallly debe adaptarse antes de octubre. Recomiendo mantener **pago directo del negocio a Meta en todos los planes**, cobrar por separado plataforma y ejecución de IA, y convertir facturación, identidad y presupuesto en parte del onboarding y del runtime. La revisión de planes debe hacerse con costo completo, capacidad certificada y precios contractuales, no sólo con tokens.

El riesgo inmediato no es únicamente una subida de tarifas. Encontramos dependencia del teléfono cuando Meta puede ocultarlo, conexión declarada lista sin verificar pago, selección de otro número cuando falta el solicitado y ausencia de un techo financiero duro para IA. También hay afirmaciones comerciales que deben corregirse: el crédito WhatsApp del seed no constituye un saldo operativo y Meta Business Agent sí documenta herramientas de negocio.

La preferencia sobre quién cobra Meta se consultó durante esta investigación y no se recibió respuesta al preparar el informe. Pago directo es la recomendación de trabajo; se compara abajo la alternativa de reventa. **No se ha cambiado ninguna configuración comercial.**

## 1. Qué cambia y cuándo nos afecta

| Fecha / estado | Cambio verificado | Consecuencia para Parallly |
|---|---|---|
| Hasta 30-sep-2026 | Continúa el régimen actual de servicio y utility dentro de ventana gratuitos | No usar la gratuidad actual para proyectar octubre. |
| **1-oct-2026** | Servicio cobra después de 1.000 entregas gratuitas por número/mes; utility dentro de 24h vuelve a cobrarse | Contar entregas reales, incluir humanos/automatizaciones y actualizar estimador, onboarding y términos comerciales. |
| **Antes de 30-sep-2026** | Meta pide medio de pago para evitar interrupción del servicio desde octubre | Revisar cada cuenta conectada; “Connected” no puede equivaler a “Listo”. |
| 2026, despliegue gradual | Usernames y BSUID permiten conversación sin teléfono visible | Migrar identidad de extremo a extremo; no esperar a una fecha universal para probarla. |
| **8-oct-2026** | Fin de Embedded Signup v2 | Ya hay v4 en código; comprobar todos los puntos de entrada, eventos y tours. |
| H2-2026 → H1-2027 → H1-2028 | Evolución de WABA a Messaging Account y WAAC, en fases | Separar remitente/pagador desde ahora y conservar compatibilidad. Las APIs futuras no son un requisito universal de octubre. |
| Octubre 2026, beta abierta | Marketing con máximo de precio por entrega | Producto optativo y controlado; el original inglés no fija día 1. Cloud API mantiene tarifa fija. |
| Desde 2025, ya vigente | Límites por portfolio y restricciones de marketing/país | Revisar campos obsoletos y disponibilidad; comprar más cuota Parallly no amplía automáticamente el límite Meta. |
| Disponible con elegibilidad | Meta Business Agent, Direct Send y prepago regional | Competencia y opciones nuevas, no funciones que debamos activar indiscriminadamente. |

Fuentes: [precios](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing), [servicio/utility](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages), [Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview), [BSUID](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids), [modelo de cuentas](https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/) y [marketing](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/pricing/). Las fechas, versiones, evidencias de consulta y matices se detallan en los anexos.

La ventana de 24 horas sigue siendo un **permiso de mensajería**, no una promesa de costo cero desde octubre. El beneficio de entrada gratuita de 72 horas tiene condiciones; no convierte los anuncios en adquisición gratuita. El descuento de volumen de utility/auth no se aplica a servicio ni permite agregar portfolios de clientes independientes. [Evidencia oficial](meta-official-pricing-evidence.md)

## 2. Cuánto puede costar Meta

Tarifas de servicio de octubre por entrega y ejemplo de **10.000 mensajes de servicio entregados**, un número, un mercado y sin beneficio de entrada gratuita: 9.000 cobrables. Son cargos Meta antes de impuestos y fees del partner; IA y Parallly se pagan aparte.

| Destinatario | Servicio USD | Servicio COP oficial | Ejemplo 10.000 entregas, factura USD |
|---|---:|---:|---:|
| Colombia | 0,0008 | 2,9455 | USD 7,20 |
| México | 0,0085 | 31,2954 | USD 76,50 |
| Brasil | 0,0068 | 25,0363 | USD 61,20 |
| Chile | 0,0200 | 73,6363 | USD 180,00 |
| Argentina | 0,0260 | 95,7271 | USD 234,00 |
| Perú | 0,0300 | 110,4545 | USD 270,00 |
| Resto de Latinoamérica | 0,0113 | 41,6045 | USD 101,70 |

Fuente: tarjetas oficiales enlazadas desde [Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing), conservadas junto al [JSON normalizado](meta-ratecards-2026.json) y [manifiesto de descargas](meta-ratecards-sources.json). COP es una tarifa publicada, no el resultado de convertir USD a una TRM asumida.

Esto tiene tres consecuencias comerciales:

- Una cuenta facturada en Colombia puede atender usuarios de Perú y soportar la tarifa del destino. El país del tenant no determina por sí mismo su costo.
- Una bolsa global “todo WhatsApp incluido” trasladaría a Parallly una exposición muy distinta según audiencia. En el ejemplo, Perú cuesta 37,5 veces Colombia.
- Mil respuestas IA no son mil mensajes de servicio: puede haber fragmentos, imágenes, humanos y recordatorios. Tampoco se deben descontar 1.000 por cada país. La cuota pertenece al número y requiere distribución real de entregas.

Además de servicio, octubre cambia marketing de México y utility/auth de Perú, entre otros mercados. El anexo contiene el diff mundial: ocho mercados existentes cambian tarifas y nueve obtienen fila propia. El modelo editable incorpora 47 mercados en USD y COP. No incluye automáticamente descuentos de volumen, impuestos, pujas ni audiencias mixtas: deben modelarse con el contrato y consumo correspondiente.

## 3. Los cinco planes: qué tenemos y qué debe cambiar

La autoridad es `billing_plans` en runtime con overrides y contratos. La tabla siguiente es el **seed actual leído**, no una captura de producción. El seed no actualiza por defecto planes existentes. El checkout implementado por defecto es Wompi Colombia/COP; el precio USD de catálogo no demuestra que exista cobro internacional certificado. [Auditoría y fuentes de código](plan-economics-code-audit.md)

| Plan | COP mensual | COP anual total | Anual / mes | Respuestas IA | WA permitidas | Revisión necesaria |
|---|---:|---:|---:|---:|---:|---|
| Emprendedor | 125.700 | 1.282.140 | 106.845 | 1.000 | 1 | Proteger margen de onboarding/soporte; explicar Meta aparte y evitar “todo gratis”. |
| Starter | 276.900 | 2.824.380 | 235.365 | 5.000 | 1 | Validar cuota, costo completo y multimedia; presupuesto real y ampliaciones voluntarias. |
| Pro | 757.700 | 7.728.540 | 644.045 | 25.000 | 2 | Revisar cuota/modelo/precio conjuntamente; vender ejecución operativa, no volumen premium indefinido. |
| Enterprise | 1.789.800 | 18.255.960 | 1.521.330 | 100.000 | 3 | Base + capacidad, concurrencia y soporte pactados; eliminar ilimitados variables sin contrato. |
| Custom | Cotización | Contrato | Contrato | Contrato | Contrato | Mínimo, costos, SLA, retención, cuentas y presupuestos explícitos. Cero en seed no es gratis. |

El descuento anual es **15 %**, no 20 %. Hay referencias USD 21/49/129/349; no hay un anual USD independiente que permita inventar un precio contractual equivalente.

### El margen aún no está demostrado

El código actual tiene puntos que impiden afirmar que todos los planes son rentables:

1. El presupuesto LLM reduce tiers después del umbral y permite seguir gastando. No reserva el costo de las llamadas concurrentes ni del loop completo de herramientas.
2. Audio, visión, embeddings, Assist, aprendizaje y evaluación no quedan cubiertos simplemente sumando el contador del chat.
3. El financiero resta principalmente LLM y toma precios de referencia para MRR; omite componentes de costo y particularidades del contrato anual/COP.
4. Los “créditos WhatsApp” de los planes no tienen wallet/debito operativo encontrado. Antes de retirar una promesa, hay que inventariar contratos y resolver derechos existentes.
5. La comisión Wompi efectiva, tratamiento fiscal, soporte e infraestructura por tenant no se verificaron. No reutilizar la comisión Mercado Pago de documentos anteriores.

La propuesta de política es apuntar a **70 % de contribución después de todos los costos directos y asignados definidos**, con seguimiento por cohorte y revisión del descuento anual. Es un objetivo propuesto, no un dato actual ni un estándar garantizado. CAC, desarrollo y gastos corporativos se analizan además para rentabilidad del negocio completo.

### Escenario ilustrativo que obliga a revisar cuotas

El [modelo editable de rentabilidad](modelo-rentabilidad-planes-whatsapp.xlsx) arranca con: COP mensual, FX hipotético de 4.000 COP/USD para costos IA, USD 0,002 por turno completo, uso del 100 % del cupo, costos restantes mensuales supuestos USD 4/8/20/50 y cobro hipotético del 4 % + COP 800. Sin IVA descontado en el escenario base. **Ninguna de estas hipótesis es una tarifa Wompi, costo medido o conclusión fiscal.** Meta lo paga directamente el tenant.

| Plan | Contribución calculada | Cupo máximo compatible con 70 % bajo estas hipótesis | Precio mensual mínimo al cupo actual bajo estas hipótesis |
|---|---:|---:|---:|
| Emprendedor | 76,27 % | 1.985 | COP 95.385 |
| Starter | 69,71 % | 4.899 | COP 280.000 |
| Pro | 58,94 % | 14.525 | COP 1.080.000 |
| Enterprise | 40,08 % | 33.068 | COP 3.849.231 |
| Custom | No calculable sin contrato | Requiere inputs | Requiere inputs |

Son cálculos de sensibilidad, **no una recomendación de subir mañana Enterprise a ese precio**. Muestran que sostener las cuotas exige menor costo unitario comprobado, otro precio o capacidad contratada distinta. El “cupo máximo” no es capacidad certificada ni permiso para aumentar cuotas. El costo por turno puede crecer con historial, idioma, audio, tools, reintentos y modelos alternativos.

En el mismo escenario, con 1,3 mensajes de servicio por turno, 600 humanos y 200 utility al mes, un número y destinatarios Colombia, Meta sumaría respectivamente COP **3.240,05 / 18.556,65 / 95.139,65 / 382.325,90**, facturados en COP. Es parte del costo total del cliente; si Parallly lo absorbiera, bajaría nuestra contribución. La calculadora permite cambiar pagador, mercado, moneda de Meta, ciclo, uso y costo unitario. Custom permanece sin resultado cuando faltan datos, sin convertir ausencia en cero.

### Propuesta de oferta revisada

- Mantener las cinco familias y su progresión funcional; definir una bolsa de ejecución entendible, modelo/calidad admitidos y límites de media/knowledge/automatización transparentes. El usuario debe saber qué se consume antes de ampliar, sin estudiar tokens.
- Pago Meta directo en todas. Quitar créditos Meta de **nuevas promesas** hasta que exista un producto financiado, respetando y migrando contratos anteriores explícitamente.
- Ofrecer ampliaciones voluntarias de ejecución cuando exista medición/reserva. No cargos automáticos de excedentes sin aceptación ni degradación silenciosa que inutilice herramientas.
- Versionar catálogo y contratos con vigencia; separar venta nueva de migración. Revisar cuatro idiomas, landing, checkout, facturas y capacidad runtime juntos.
- Mantener Custom bajo cotización, y revisar Enterprise con uso representativo antes de prometer 100.000 respuestas al nivel de calidad más alto.
- Evaluar alternativas de canal para el cliente cuando aporten valor, pero sin llamar Email un canal conversacional self-service ni SMS un chat. No cambiar de canal sin permiso ni para eludir políticas.

**No fijar precios finales hasta obtener:** export runtime sin secretos, consumo p50/p95/p99 por tarea, factura IA, fee Wompi, impuestos aplicables, costo soporte/infra, cohortes anuales y prueba de carga con el modelo que realmente se ofrecerá. Si hay que vender antes, cotizar capacidad conservadora explícita y ofrecer piloto; no garantizar margen a partir del seed.

## 4. Cómo integrar el medio de pago de cada cuenta

Hay tres circuitos independientes:

| Pago | Configuración | Acción que debe facilitar Assist |
|---|---|---|
| Negocio → Parallly | Billing / Wompi | Contratar y gestionar plan de plataforma. |
| Negocio → Meta | Messaging Account, compatible con WABA actual | Identificar cuenta correcta, abrir gestión Meta, verificar método y mostrar incidencias. |
| Consumidor → negocio | Tenant payments / Wompi o Mercado Pago propios | Configurar cobro de compras/reservas; nunca usar esas credenciales para financiar a Parallly. |

Meta no permite adjuntar la tarjeta mediante la API de migración: el titular debe completar verificación en Business Manager. El nuevo prepago es **India/INR/UPI**, sin API pública de recarga/saldo y sin disponibilidad Colombia; no crea una wallet de reventa para nosotros. [Cambio de moneda](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/change-billing-currency), [prepago](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/prepaid-billing/)

Recorrido propuesto:

1. Explicar plataforma + consumo Meta y mostrar estimación por audiencia antes de conectar.
2. Completar Embedded Signup y listar cuenta/número seleccionados, con su dueño y moneda.
3. Consultar financiación. Ausencia de `primary_funding_id` en respuesta válida del recurso correcto significa método ausente; 403/timeout significa desconocido. Método adjunto no prueba saldo, ausencia de deuda o entrega posible.
4. Guiar a la pantalla de pago de Meta con nombre/ID de cuenta visibles. No pedir PAN/CVV en Assist ni declarar éxito por abrir el enlace.
5. Al volver, releer estado y explicar exactamente qué falta. La confirmación manual debe etiquetarse como tal.
6. Ejecutar un piloto consentido y presupuestado; aceptación HTTP no equivale a entrega. Ante error de pago, guardar trabajo y mostrar resolución fuera del mismo canal impago.
7. Antes de reanudar, verificar vigencia de tarea, ventana, consentimiento, dueño del turno, pagador y presupuesto; no vaciar automáticamente una cola envejecida.

Este recorrido necesita backend, estado persistente y pruebas; un tour por sí solo no lo resuelve. La [auditoría de arquitectura](whatsapp-account-billing-architecture.md) detalla APIs, estados, tokens BISU y compatibilidad.

### ¿Y si queremos una sola factura?

| Modelo | Ventaja | Condiciones y costo adicional | Recomendación |
|---|---|---|---|
| Cliente paga Meta directamente | Menor exposición financiera y titularidad clara | Algo más de onboarding; consumo total visible y soporte de incidencias | Base para todas las familias. |
| Solution Partner factura Meta; Parallly integra | Experiencia potencialmente unificada | Contrato, fees, divisas, responsabilidades, portabilidad y conciliación | Comparar propuesta real antes de vender. |
| Parallly financia/revende con saldo | Mayor control comercial | Elegibilidad/partner, crédito, reservas concurrentes, impuestos, fraude, FX, impago y caja | Fase posterior; no requisito para octubre. |

Un recargo del 10 % sobre costo produce sólo 9,09 % de margen antes de comisiones y demás gastos; no 10 %. El precio de reventa debe cubrir el costo total y el margen deseado. La existencia de Wompi o de un ledger SMS no concede acceso a crédito Meta. [Modelo de partners](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview)

## 5. Arquitectura: cambios para operar y medir bien

**Identidad y autoridad.** Modelar destinatario opaco BSUID y teléfono opcional. Distinguir conexión, portfolio propietario, Messaging Account pagadora, credencial autorizada y futuro WAAC. El mismo efecto durable debe conservar esa selección; jamás escoger otro teléfono porque falte el pedido. Parámetros de API nuevos se envían según soporte real, con compatibilidad legacy probada y rechazo de ambigüedad.

**Contabilidad de uso.** Aprovechar el outbox, recibos y ledger construidos por Claude. Añadir costo como dimensión durable sin crear otro dueño del envío: estimación, reserva, aceptado, entrega y ajuste de factura son hechos distintos. Persistir categoría, país, moneda, producto, vigencia y fuente; deduplicar por recibo dentro de su scope. Hoy se guarda raw status, pero la proyección normalizada no conserva toda la información de precios. Mantener precisión decimal; redondear por la regla del proveedor al conciliar.

**Presupuesto y calidad.** Una misma autoridad debe cubrir chat, Assist, copiloto, media, RAG, aprendizaje, evaluaciones, jobs y campañas. Reservar antes de operaciones concurrentes, liquidar el uso real y retener incertidumbre hasta reconciliar. Los límites deben cumplir el contrato: alerta, presupuesto duro y cupo no son lo mismo. Si no queda modelo certificado para la tarea, explicar la limitación o escalar; no ejecutar una compra con calidad insuficiente para salvar margen.

**Vigencia.** Una tarea en cola que atraviesa octubre debe revalidar tarifa y autorización. La cotización interna congelada no congela el precio de Meta; la entrega/factura determina el cargo según su contrato. Cambios de precio que excedan un presupuesto aprobado requieren detener o pedir nueva aceptación.

**Marketing.** Consentimiento y baja, categoría correcta, elegibilidad regional, presupuesto total, enfriamiento de 131049, expiración y métricas de resultado. Un máximo de precio por mensaje no limita toda la campaña. No recategorizar publicidad como utility ni explotar 24h para evadir restricciones.

**Configuración fácil.** Assist debe responder: qué falta, por qué afecta la tarea, cuánto puede costar, qué puede arreglar y qué debe realizar el dueño. Cada acción termina con relectura de la autoridad real. Mostrar “agente listo para estas tareas”, “pago pendiente”, “capacidad no probada” o “cuenta restringida”, en vez de un único porcentaje verde.

Los hallazgos por archivo y las fuentes específicas están en [economía](plan-economics-code-audit.md), [cuentas](whatsapp-account-billing-architecture.md) e [identidad/producto/políticas](meta-product-identity-policy-evidence.md).

## 6. Enfoque competitivo y aprendizaje de conversaciones

**Ampliación competitiva del 10-sep:** la [investigación para landing](landing-positioning-and-content-plan.md) distingue el agente directo en WhatsApp Business, otras superficies Meta y su API empresarial. La oferta directa tiene capacidades propias de Calendar, Drive y aprendizaje; el anuncio de acceso gratuito no es la tarifa de API. No usar la comparación de tokens que sigue como precio obligatorio del agente nativo.

Meta Business Agent ya documenta conocimiento, tono, conectores, reservas, pagos, handoff y evaluación. No podemos posicionarnos afirmando que sólo responde FAQs. Su tarifa por tokens tampoco basta para probar quién resuelve más barato. [Overview oficial](https://developers.facebook.com/documentation/meta-business-agent/overview), [tarificación](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages)

La ventaja defendible de Parallly debe demostrarse en **resolución de tareas de negocio con continuidad entre canales**: condiciones acordadas, inventario/calendario correctos, transacción trazable, conocimiento pertinente, seguimiento y recuperación. Medir costo total por tarea resuelta, exactitud, conversión atribuible, incidentes, esfuerzo de configuración y satisfacción. Mantener el benchmark y la certificación pendientes como tales; no anunciarnos como “el mejor” antes de medirlo.

Para aprender de chats, seleccionar por resultados y exactitud con revisión, mantener procedencia, comparar versiones y permitir retirada. No convertir ejemplos privados en una plantilla global. Los términos WhatsApp restringen el uso de datos —incluidos derivados— para mejorar modelos generales y describen una excepción limitada de uso exclusivo del negocio. Revisar finalidad y contrato del proveedor, no suponer que anonimizar o tener consentimiento local levanta toda restricción. Esto complementa el sistema de aprendizaje ya construido; no se detectó en esta investigación una fuga entre tenants. [Business Solution Terms](https://www.whatsapp.com/legal/business-solution-terms/)

Por vertical, evaluar actividad real y país: que Parallly tenga una plantilla para salud o finanzas no demuestra elegibilidad en cada producto Meta. La política de mensajes y las exclusiones del agente nativo son diferentes. En Venezuela hay discrepancia entre dos páginas oficiales; debe confirmarse antes de prometer disponibilidad. [Anexo de políticas y discrepancias](meta-product-identity-policy-evidence.md)

## 7. Orden de implementación y puerta de despliegue

Este trabajo **se agrega** al cierre de release que Claude está ejecutando. No reemplaza el preflight de términos huérfanos, publicación/rollback E2E, pruebas con PostgreSQL ni staging. Hay trabajo concurrente en esos archivos; esta investigación no los modificó.

| Bloque | Entregable ejecutable | Condición para cerrar |
|---|---|---|
| **M0 — inventario** | Reporte por cuenta/plan/contrato, emisor, versión Graph, pagador, elegibilidad y capacidad efectiva | Errores/unknown visibles; sin secretos, PII ni supuesto de seed=runtime. |
| **M1 — continuidad** | BSUID completo; número exacto; contexto pagador y credencial; estado de financiación; errores de pago y recuperación | Contratos y E2E de todos los emisores, aislamiento y replay. Obligatorio antes de activar los caminos afectados. |
| **M2 — octubre** | Tarifas versionadas, contador de entrega/cuota, estimador, presupuesto de campañas, nuevo paso de pago y comunicación contractual | Fronteras temporales y de cuota, varios números/países, utility en ventana, permisos de 24h y evidencia de costos. |
| **M3 — margen real** | Ledger de uso IA/media/tools, reserva y conciliación, financiero corregido y simulador con datos efectivos | Carreras y caídas probadas; costo total/plan y anual verificados. Antes de prometer margen o vender nuevas cuotas. |
| **M4 — oferta** | Catálogo versionado, propuesta por familia, transición de contratos y ampliaciones voluntarias | Aprobación comercial con números medidos; checkout/factura/capacidad/textos consistentes en cuatro idiomas. |
| **M5 — calidad y piloto** | Pruebas reales de cuenta/pago/entrega; tareas críticas por vertical; onboarding nuevo; canario y rollback | Evidencia del proveedor y presupuesto aprobado; recepción/entrega/costo conciliados. |
| **M6 — expansión** | MM API con pujas, Direct Send, eventual partner/reventa o agente Meta | Caso económico y elegibilidad propios; integración completa bajo flag y piloto. No bloquea continuidad básica de octubre. |

La fecha límite de cobro no exige completar todas las betas. Sí exige resolver compatibilidad y pago de clientes activos, y conocer el impacto inmediato de cualquier cambio de cobro. Priorizar M0–M2 mientras continúa el cierre técnico; trabajar M3 en paralelo porque el pago directo de Meta no resuelve el gasto interno de IA.

**No recomiendo desplegar el conjunto y activarlo ampliamente sólo porque las suites existentes están verdes.** Esas suites no prueban los cambios descubiertos aquí. Un despliegue aditivo por etapas puede ser razonable después de revisión, staging y piloto, dejando apagadas las funciones nuevas que no estén certificadas. Las reglas externas y las correcciones que cambian comportamiento al cargar runtime no quedan neutralizadas por apagar el outbox.

Hay una [directiva de ejecución para Claude](../../handoffs/2026-09-10/claude-meta-whatsapp-adaptation.md) con inventario, pruebas y criterios de cierre. Esta investigación prepara ese trabajo; no lo ejecuta ni autoriza producción.

## 8. Datos y decisiones que faltan

| Pendiente | Qué permite decidir | Preparación local posible |
|---|---|---|
| Export runtime de planes/contratos/overrides y cuentas sin secretos | Impacto real, clientes que requieren migración y derechos de crédito existentes | Comando de sólo lectura, esquema y diff contra catálogo. |
| Estatus Meta Tech Provider/partner, scopes, cuentas y pagadores efectivos | Si cada tenant puede pagar directo y qué activos debe seleccionar | Validador de grants/configuración; no revocar por nombre de fila. |
| Facturas IA/Meta/Wompi/infra, impuestos y soporte | Precios y cupos con margen comprobable | Instrumentación y modelo listos para importar datos. |
| Tenant/número/destinatario de prueba y presupuesto | Certificar onboarding, medio de pago y entrega real | Ensayos sintéticos completos y plan de canario. |
| Cuenta elegible para verificar octubre | Semántica de cuota gratuita, FEP, medición y conciliación | Fixtures de incertidumbre; no inventar campos o beneficios. |
| Confirmación regional/contractual cuando hay ambigüedad | Oferta en mercados y aprendizaje compatibles | Matriz de decisión y preguntas concretas para Meta. |
| Staging separado y aprobación final | Despliegue y activación controlados | Continuar directiva de release, scripts y rollback. |

No es necesario esperar estos datos para corregir el número equivocado, implementar identidad opaca, preparar pagos guiados, instrumentar costos o ejecutar pruebas sintéticas. Sí son necesarios para declarar cuentas operativas, margen real y certificación externa.

## 9. Entregables y trazabilidad

- [Modelo editable de margen](modelo-rentabilidad-planes-whatsapp.xlsx) y [generador](build-margin-workbook.mjs).
- [Auditoría de planes y costos](plan-economics-code-audit.md) y [inputs extraídos del seed](plan-economics-inputs.json).
- [Precios, límites y reglas oficiales](meta-official-pricing-evidence.md).
- [Cuentas y medios de pago](whatsapp-account-billing-architecture.md).
- [Identidad, producto, políticas y novedades](meta-product-identity-policy-evidence.md).
- [Tarjetas oficiales normalizadas](meta-ratecards-2026.json), [URLs originales](meta-ratecards-sources.json) y archivos CSV/XLSX conservados con huella.
- [Adenda de ejecución de Claude](../../handoffs/2026-09-10/claude-meta-whatsapp-adaptation.md).

Se revisaron las fuentes oficiales disponibles hasta la fecha de corte y las rutas relevantes del repositorio. No se sustituyeron los documentos locales anteriores porque contienen cambios ajenos en curso; este paquete enumera sus correcciones. No se ha ejecutado una migración, modificado planes, configurado tarjetas, activado Meta Business Agent ni enviado mensajes. Las incertidumbres documentadas son parte del resultado, no evidencia fabricada de cierre.
