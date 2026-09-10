# Evidencia oficial Meta: precios y límites de WhatsApp para octubre de 2026

Fecha de corte y consulta: **10 de septiembre de 2026**. Alcance: documentación pública de Meta/WhatsApp, tarjetas oficiales de tarifas y consecuencias de diseño para Parallly. Se leyó `docs/whatsapp-meta-pricing-2026-10.md` como hipótesis. No se consultaron cuentas de producción ni se hicieron envíos o gastos.

## Resultado principal

**Sí están anunciados oficialmente el cobro de servicio desde el 1 de octubre de 2026 y los 1.000 mensajes de servicio gratuitos mensuales por número.** El documento anterior acertó en esa premisa. La página principal todavía describe la gratuidad vigente durante septiembre y, más abajo, anuncia las reglas de octubre; leer sólo su introducción produce una conclusión incorrecta. La documentación de precios futura y las tarjetas de octubre se pudieron consultar directamente.

La preparación es obligatoria. La rentabilidad depende de distinguir quién paga Meta, el país del destinatario, cuántos mensajes reales se entregan y el costo completo de operar el agente. Esta investigación no demuestra por sí sola que los precios actuales de Parallly tengan margen suficiente.

## Cómo se verificó y qué se conserva

- El buscador web no devolvió resultados para algunas consultas exactas y el lector web recibió HTTP 429 en Meta Developers. Eso es una limitación de acceso de esa herramienta, no evidencia de ausencia del anuncio.
- El navegador abrió la documentación pública sin autenticación. Se leyeron las secciones visibles y se extrajeron únicamente los enlaces de tarjetas publicados en el DOM.
- Las descargas etiquetadas como CSV de octubre contienen realmente archivos XLSX. Se comprobó su firma ZIP y se leyeron las celdas de la hoja. Julio sí contiene CSV.
- Se guardaron los archivos originales, URL exacta y SHA-256 en `meta-ratecards-sources.json` y `meta-ratecards-2026.json`, dentro de este directorio. Los enlaces CDN firmados pueden caducar; el enlace estable para volver a descubrirlos es la página oficial de precios.
- El JSON contiene las tarifas como cadenas decimales; `n/a` significa no aplicable, no cero. Hay 38 mercados en julio y 47 en octubre. Los niveles de volumen conservan filas y letras de columnas para evitar inventar asociaciones entre celdas combinadas.

## Reglas temporales confirmadas

### Fuente P1: página de precios

[Pricing on the WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing), encabezado visible Updated: 5 ago 2026. Ese encabezado no prueba la fecha de cada edición: la página ya incluye tarjetas anunciadas para septiembre. Secciones verificadas: `updates-to-rate-cards`, `service-rates-effective-october-1-2026`, `utility-rates-effective-october-1-2026`, `volume-tiers`.

- Desde noviembre de 2024: servicio gratuito; desde julio de 2025: plantillas cobradas por entrega y utility gratuita dentro de la ventana.
- **Desde 1-oct-2026:** servicio cobrable con 1.000 entregas gratuitas por número y mes, sin acumulación; utility dentro de ventana vuelve a cobrarse.
- La tarifa depende del país del destinatario y moneda de la cuenta; la vigencia cambia a medianoche en la zona horaria WABA.
- Utility/authentication tienen tramos mensuales por portfolio propietario, mercado y categoría. Los descuentos son marginales, no retroactivos sobre todos los mensajes.
- FEP concede 72 horas gratuitas tras entrada admitida y respuesta antes de 24 horas; el vencimiento del permiso de texto libre sigue siendo independiente.
- El calendario distingue aviso mínimo: tarifas un mes, extensiones del modelo tres meses, cambio de modelo seis meses.

### Fuente P2: detalle de servicio y Meta Business Agent

[Upcoming pricing updates for Meta Business Agent, service and utility messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages), Updated: 25 ago 2026.

- Meta exige tener método de pago antes del 30-sep-2026 para evitar que se detengan entregas de servicio el 1-oct.
- Servicio incluye respuestas de humanos y de IA de terceros; Meta Business Agent constituye otra categoría.
- Servicio no tiene descuentos de volumen. Su tarifa coincide con utility/authentication de lista del mercado.
- Se cobra por entrega; un mensaje sólo genera el cargo de su categoría. Las entradas del cliente no se cobran.
- Meta Business Agent cobra USD 2 por millón de tokens desde 1-ago-2026; entrega incluida. Sus ejemplos aproximan USD 0,04–0,05 por respuesta; no representan una medición de Parallly.
- El FEP conserva gratuidad de entrega; los tokens de Meta Business Agent siguen cobrables.
- El webhook de servicio facturable declara `PMP`, `regular`, `service`, `billable=true`. Analytics utiliza `SERVICE`.
- No se documenta aquí una excepción de tarjeta para consumir primero la cuota gratuita.

**Consecuencia propia:** no comunicar “puedes empezar sin tarjeta hasta consumir 1.000”. “No verificado”, “ausente” y “rechazado” deben ser estados diferentes. Una lectura de API fallida no demuestra que falte el método de pago.

## Tarifas verificadas para Latinoamérica

Fuentes: tarjetas oficiales USD y COP descubiertas en P1, archivos locales y huellas en el manifiesto. Valores por mensaje entregado, antes de impuestos, cargos de un partner o costos de IA de Parallly. Las tarifas COP son valores publicados, **no una conversión nuestra a la TRM de hoy**.

| Destino | Marketing USD julio → octubre | Utility/auth USD julio → octubre | Servicio USD octubre | Servicio COP octubre |
|---|---:|---:|---:|---:|
| Colombia | 0,0125 → 0,0125 | 0,0008 → 0,0008 | 0,0008 | 2,9455 |
| México | 0,0305 → 0,0397 | 0,0085 → 0,0085 | 0,0085 | 31,2954 |
| Brasil | 0,0625 → 0,0625 | 0,0068 → 0,0068 | 0,0068 | 25,0363 |
| Chile | 0,0889 → 0,0889 | 0,0200 → 0,0200 | 0,0200 | 73,6363 |
| Argentina | 0,0618 → 0,0618 | 0,0260 → 0,0260 | 0,0260 | 95,7271 |
| Perú | 0,0703 → 0,0703 | 0,0200 → 0,0300 | 0,0300 | 110,4545 |
| Resto de Latinoamérica | 0,0740 → 0,0740 | 0,0113 → 0,0113 | 0,0113 | 41,6045 |

Cálculos propios: marketing de México sube aproximadamente 30,16% en la tarjeta USD; utility/auth de Perú sube 50%. Para Colombia, marketing en COP sigue en 46,0227 por entrega.

### Cobertura global del cambio de tarjetas USD

Comparación calculada entre los archivos, excluyendo la adición general de la categoría servicio:

| Mercado existente | Categoría | Julio | Octubre |
|---|---|---:|---:|
| México | marketing | 0,0305 | 0,0397 |
| Pakistán | utility/auth | 0,0100 | 0,0150 |
| Perú | utility/auth | 0,0200 | 0,0300 |
| Arabia Saudita | marketing | 0,0501 | 0,0576 |
| Sudáfrica | utility/auth | 0,0076 | 0,0095 |
| Emiratos Árabes Unidos | marketing | 0,0499 | 0,0576 |
| Resto de Asia-Pacífico | marketing | 0,0732 | 0,0842 |
| Resto de Medio Oriente | marketing | 0,0341 | 0,0392 |

Además, Bangladesh, Irak, Kazajistán, Kuwait, Marruecos, Nepal, Omán, Sri Lanka y Ucrania pasan a filas independientes. El JSON incluye sus tarifas de todas las categorías. Para comparar su variación histórica hay que aplicar el mapa regional anterior; “no existía fila” no significa “era gratis”. Cambia también dónde acumulan volumen.

### Tramos de volumen: dimensión y precisión

La tarjeta USD de octubre indica primer umbral utility de 100.000 para Colombia/Argentina/Chile/Perú/resto LatAm, 250.000 Brasil y 1.000.000 México; authentication empieza en 120.000, 500.000 y 250.000, respectivamente. Los siguientes tramos están en el XLSX conservado.

**Advertencia de cálculo:** algunas filas de Colombia muestran descuento porcentual del 5% y tarifa publicada redondeada todavía en USD 0,0008. No derivar una tarifa “más precisa” multiplicando porcentaje si contradice la tarjeta; conservar la tarifa, la moneda y el criterio de conciliación con Meta. No sumar portfolios de distintos clientes para obtener un descuento supuesto de plataforma.

## Marketing: nuevo mecanismo y límites

### Fuente P3: máximo por entrega

[Set a max price for marketing messages (BETA)](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/pricing/), Updated: 31 ago 2026. Se consultó también el original inglés desde su enlace.

El máximo es opcional durante 2026: beta limitada desde 15-may; beta abierta en **octubre de 2026**, sin día especificado en el original inglés; disponibilidad general prevista en Q2 2027. Entonces será requerido para MM API en geografías elegibles; Cloud API conserva tarifas fijas. La traducción con IA añade “1 de octubre”; no usar ese día como contrato confirmado.

El campo de plantillas `optimization_spec` reemplaza `bid_spec`; el anterior dejó de admitirse tras 31-jul. `bid_amount` representa 1.000 entregas en unidades menores de la moneda. Una plantilla con máximo requiere `/marketing_messages`; usar `/messages` produce 131061.

Los estados delivered/read pueden incluir `pricing.cost.amount/currency` para `marketing_lite`. Son estimaciones; la factura prevalece. Hay multiplicadores por país y por mensaje. El estimador de alcance tampoco garantiza resultados.

**Consecuencia propia:** una campaña necesita techo agregado, reserva concurrente, tarifa/puja congelada, aprobación de cambios de presupuesto, comparación costo/resultado y reconciliación. Un máximo por mensaje no limita el gasto total. No activar pujas automáticas ilimitadas ni vender ahorro garantizado.

### Fuente P4: restricciones por persona

[Per-user marketing template message limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits/), Updated: 17 jun 2026.

Los límites se adaptan a la interacción del destinatario y no son una cuota fija visible por tenant. La página confirma que no se entregan plantillas de marketing a números estadounidenses (+1 con área estadounidense); no equivale a bloquear todos los +1. Ante 131049, indica esperar al menos 24 horas; insistir puede impedir nuevos intentos hacia esa persona durante 24 horas. Existen exclusiones regionales documentadas. Dentro de una ventana iniciada por respuesta del usuario, los mensajes marketing no consumen ese límite.

**Consecuencia propia:** segmentar por país correcto, mostrar entregabilidad como estimación y clasificar 131049 con enfriamiento durable, no con reintentos de segundos.

## Límites de capacidad y calidad

### Fuente P5: límites vigentes

[Messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits), Updated: 21 may 2026.

Mide destinatarios únicos fuera de ventana en 24 horas móviles, agregado por portfolio. Escala 250 → 2.000 → 10.000 → 100.000 → ilimitado. Verificación o un recorrido de uso/calidad habilitan revisión; no es un incremento incondicional. A partir de 2.000, calidad y utilización de al menos la mitad del límite en siete días permiten aumentar un nivel en seis horas. `messaging_limit_tier` está obsoleto: consultar `whatsapp_business_manager_messaging_limit`.

### Fuente P6: transición histórica

[Upcoming changes to messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/upcoming-messaging-limits-changes), Updated: 17 jun 2026. La propia página dice que el cambio ya ocurrió.

La fecha es **7-oct-2025**, no 1-oct. Los números comparten el límite del portfolio; no se suman los límites anteriores. La reducción automática de límite por calidad desapareció, pero la calidad sigue afectando escalamiento y entrega. Webhooks utilizan `max_daily_conversations_per_business`; los campos anteriores debían eliminarse en febrero de 2026.

**Consecuencia propia:** modelar el límite por portfolio y distinguirlo de cuotas contratadas, throughput y presupuesto. No ofrecer “envío garantizado” por comprar un plan mayor.

## IA: evitar dos confusiones comerciales

### Fuente P7: régimen especial de AI Providers

[AI Providers pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers/), Updated: 21 may 2026.

Describe el régimen de asistentes generales definidos en los términos. Desde 15-ene-2026 se permiten sólo donde una obligación legal exige soportarlos. Brasil está cubierto desde 11-mar; el cobro especial europeo descrito cesó desde 13-may. Sus identificadores son `AI_BOT` en analytics y `general_purpose_ai` en webhooks. Esta página de mayo no actualiza las reglas generales de servicio anunciadas posteriormente para octubre.

**Consecuencia propia:** ser SaaS con IA no basta para decidir la clasificación legal. Mantener el agente de cada negocio limitado a sus funciones y revisar términos/uso efectivo. No convertir la página especial en “Parallly no tendrá cobros” ni afirmar que una plantilla comercial da inmunidad. Tampoco se ha demostrado que Parallly sea más barato que Meta Business Agent: hay que comparar resolución útil y costo total, no sólo tokens.

## Implicaciones económicas y controles propuestos

Estas son recomendaciones de análisis, no mandatos publicados por Meta:

1. Separar suscripción Parallly, consumos internos de IA y cargos Meta. Si cada tenant paga Meta directamente, el costo no desaparece: deja de ser COGS nuestro pero afecta su retorno, abandono y soporte.
2. Para un número, un solo mercado y sin FEP: costo de servicio estimado = `max(entregasServicioMes - 1000, 0) × tarifa`. Para mezcla de países, no descontar 1.000 de cada país. La asignación debe seguir entregas y reglas reales; hasta confirmarlas, usar rangos conservadores.
3. Registrar entrega única por message ID, número, WABA/portfolio, categoría, producto, país, moneda, versión de tarifa, fecha de entrega y fuente del importe. Repeticiones de webhook no generan nuevo costo.
4. Mantener estimado, reportado por analytics y facturado como magnitudes distintas. La factura ajusta el cierre; no sobrescribir trazabilidad histórica con tarifas nuevas.
5. Resolver con menos mensajes sin degradar calidad: unir confirmaciones redundantes, evitar saludos/reacciones que abran turnos de IA innecesarios y reducir duplicados. No economizar suprimiendo confirmación necesaria de una compra.
6. FEP puede mejorar economía, pero anuncios cuestan. Comparar costo incremental de captación con la entrega evitada y la conversión; “72 horas gratis” no significa adquisición gratis.
7. Poner límites de presupuesto por campaña, tenant y canal antes de la cola, con reserva atómica de gasto. “Meta factura al cliente” no autoriza a un agente a gastar sin límite.
8. Incluir casos de frontera en las pruebas: 999/1000/1001 entregas, dos números, varios países, cambio de mes/zona, reintentos, FEP/CSW distintos, tarifa nueva, utility en ventana, webhook sin precio, restricción de pago, 131049 y marketing con máximo.

## Lo que no queda certificado por esta lectura

- Valor exacto del webhook para consumir los nuevos 1.000 gratis; no se debe inventar.
- Si mensajes FEP consumen esa cuota y cómo resuelve Meta simultaneidad de entregas de distintos proveedores.
- Salud del pago de cada cuenta, permisos disponibles y capacidad de detectar el estado sin entrar a Billing Hub.
- Costo final con impuestos, FX bancario, mora, proveedor intermediario o diferencias de conciliación.
- Elegibilidad de cuentas concretas para MM API, max price, Meta Business Agent o prepago.
- Aplicación jurídica exacta de AI Providers al producto y sus futuros cambios.
- Tarifas futuras no publicadas y rentabilidad real de cada plan sin medir tráfico, IA, soporte e infraestructura.

El documento previo debe corregirse al menos en el día del cambio de límites, el tratamiento de la tarifa COP como dato oficial, la beta de marketing, las inferencias de cuota sin pago y cualquier afirmación absoluta de superioridad de costo. La sección “prepago sin producto” también quedó desactualizada: [Prepaid billing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/prepaid-billing/), actualizado el 8-sep-2026 y verificado en el original inglés por el agente coordinador, documenta prepago para India, INR y UPI, con requisitos y exclusiones. No ofrece API pública para consultar saldo o cargar fondos y no habilita esta modalidad para Colombia. Véase la adenda F10 de [la arquitectura de cuentas y pagos](./whatsapp-account-billing-architecture.md) para el alcance completo; no usar este producto regional como fundamento de una cartera Meta común para todos los tenants.
