> Actualización de ejecución (14-sep-2026): el usuario autorizó un catálogo único también para tenants existentes. La recomendación anterior de conservar precios/cuotas antiguos queda sustituida por esa decisión. La implementación y las limitaciones verificadas se detallan en `plan-economics-implementation.md`. Este documento conserva la investigación y sus supuestos; no es evidencia de despliegue ni de margen observado.

# Planes, rentabilidad, financiación de WhatsApp y crecimiento a AWS

Fecha de consulta: 14 de septiembre de 2026. Auditoría de código en `4da69783`, integrado en main mediante `a496dea7` (PR #31). **Propuesta, no cambio comercial aprobado ni implementado.** No se modificaron planes, suscripciones, tarjetas, infraestructura ni datos de clientes.

## 1. Resultado

Parallly puede ser rentable con WhatsApp cobrable, pero **no hay evidencia suficiente para afirmar que todos los planes actuales garantizan un buen margen**. La factura de Meta corresponde al negocio cuando su WABA paga directamente; nuestros riesgos principales son costo de IA por tarea, volumen incluido, soporte e infraestructura al escalar.

Los precios COP actuales son bastante distintos de las referencias USD. Emprendedor/Starter necesitan ajustes menores o ninguno durante la transición. Pro y Enterprise necesitan revisar el volumen incluido y separar uso estándar de uso avanzado. No recomiendo prometer 100.000 respuestas de calidad premium por el precio actual de Enterprise sin una economía verificable.

Además hay tres pendientes que afectan la decisión:

1. El panel de rentabilidad por tenant resta solamente LLM; no calcula la contribución completa.
2. El presupuesto de LLM cambia el enrutamiento a modelos económicos, pero no es un techo monetario duro.
3. La comprobación de financiación de WhatsApp no consulta Meta y no está integrada como un recorrido preventivo completo.

## 2. Qué se verificó y qué no

Se consultaron en vivo los catálogos públicos de producción para Colombia y México, las páginas oficiales de Meta, la tarjeta USD de octubre descargada desde los enlaces de Meta, Wompi, Hostinger y AWS. También se revisaron administración de planes, cuotas, renovación, enrutamiento IA, snapshots financieros y UI/endpoint de gasto WhatsApp.

No se accedió a facturas privadas de proveedores, contratos individuales ni consumos de tenants. El catálogo público filtra `llmCostBudgetUsdCents`; que no lo devuelva **no demuestra que falte en la base de datos**. Los presupuestos de seed no se deben presentar como valores operativos comprobados. No se hicieron llamadas a modelos ni envíos a Meta.

El modelo reproducible está en `plan-margin-model.py`; sus resultados están en `plan-margin-scenarios.json`. Separa supuestos de resultados y permite recalcular divisa, intensidad de IA, impuestos y distribución de infraestructura.

## 3. Planes que se publican hoy

Fuente: `https://api.parallly-chat.cloud/api/v1/billing/public/plans?country=CO`, leído durante esta auditoría. Los importes públicos vienen en centavos; esta tabla los expresa en pesos o dólares completos.

| Plan | Referencia USD/mes | Precio publicado COP/mes | Cuota IA mensual | Agentes | Asientos publicados |
|---|---:|---:|---:|---:|---:|
| Emprendedor | 25 | 125.700 | 1.000 | 1 | 1 |
| Starter | 49 | 276.900 | 5.000 | 1 | 3 |
| Pro | 129 | 757.700 | 25.000 | 3 | 5 |
| Enterprise | 349 | 1.789.800 | 100.000 | 10 | ilimitados |
| Custom | a cotizar | a cotizar | a negociar | a negociar | a negociar |

El `0` de precio y `999` de agentes en Custom son convenciones internas, no una oferta gratuita de 999 agentes. Emprendedor tiene USD 25 en producción, mientras el seed conserva USD 21. Es una divergencia comprobada: no usar el seed para cotizar.

En Colombia los cuatro primeros planes se publican como autoservicio. La respuesta actual no ofrece precio anual (`displayPriceAnnualCents: null`), aunque el seed sí contiene importes anuales. En México devuelve venta asistida y `country_not_supported` para compra mensual. La tarjeta internacional aceptada por Wompi no equivale a tener habilitada adquisición local en todos los países.

Un precio regional puede ser deliberadamente distinto del precio convertido por TRM. Lo que falta es declarar si se trata de precio regional fijo o conversión; hoy no corresponde explicar los cuatro precios COP como una única conversión uniforme.

## 4. Qué cambia realmente en WhatsApp

La [página oficial de precios](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) confirma desde el 1 de octubre de 2026:

- Cobro por mensaje de servicio entregado, incluidos mensajes escritos por humanos y por IA de terceros.
- 1.000 entregas de servicio gratuitas por número de negocio y mes, sin acumulación. No son 1.000 conversaciones ni una franquicia común de toda la WABA.
- Utility dentro de la ventana de atención vuelve a ser cobrable. La franquicia de servicio no se aplica a utility ni marketing.
- La ventana de 24 horas sigue determinando cuándo se puede responder sin plantilla; deja de implicar gratuidad general.
- La ventana gratuita de entrada elegible de 72 horas conserva sus reglas. No todo cliente que escribe primero tiene esa exención.
- Tarifa por mercado del destinatario y moneda de facturación de la WABA, no por país del tenant en Parallly.
- Meta Business Agent tiene una categoría y cobro distintos; no se debe aplicar su tarifa de tokens a nuestro agente.

**Actualización importante frente a nuestros documentos del 10–12 de septiembre:** la sección detallada de servicio ahora indica que, sin método de pago, Meta entrega los primeros 1.000 mensajes de servicio del mes y no entrega desde el 1.001. La [página de mensajes sin plantilla](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages) conserva un aviso general de interrupción desde octubre sin esa precisión. Debemos comunicar la regla específica y mantener la recomendación de configurar financiación antes del 30 de septiembre para garantizar continuidad. No afirmar que una cuenta sin tarjeta necesariamente falla desde el primer mensaje.

La documentación principal también explica la señal de franquicia: `category: service`, `pricing_model: PMP`, `type: free_customer_service`, `billable: false`; desde la entrega cobrable, `type: regular`, `billable: true`. Deben actualizarse pruebas y documentación que aún digan que la señal no está documentada. El webhook de clasificación no equivale por sí solo a una factura monetaria definitiva.

### Ejemplo de costo directo del negocio

Tarjeta USD de octubre descargada de Meta durante esta auditoría, SHA-256 `94913fa225da00935cd50a69a317373302d90afd47b57eeabb5e7cd64e78d867`.

Un número, 10.000 entregas exclusivamente de servicio, todas dirigidas al mismo mercado, sin exenciones FEP y sin impuestos:

| Destinatarios | USD/entrega de servicio | Meta por 10.000 entregas, descontando 1.000 |
|---|---:|---:|
| Colombia | 0,0008 | 7,20 |
| Brasil | 0,0068 | 61,20 |
| México | 0,0085 | 76,50 |
| Chile | 0,0200 | 180,00 |
| Argentina | 0,0260 | 234,00 |
| Perú | 0,0300 | 270,00 |

No duplicar la franquicia por país en una WABA con destinatarios mixtos: se consume por número. Tampoco confundir cuota IA con entregas Meta: una respuesta puede producir varios mensajes, y un humano o un recordatorio también puede consumir entregas.

**Parallly factura plataforma/IA; Meta factura mensajería al negocio.** La afirmación depende de verificar el pagador de cada conexión antigua. Una WABA bajo línea de crédito de un socio anterior requiere resolver esa relación; no se puede suponer que todas las conexiones históricas ya son `business_direct` por el modelo comercial deseado.

## 5. Auditoría de administración de planes

### Lo que ya está construido

- Catálogo de base de datos compartido por landing y panel, con disponibilidad de checkout explícita.
- Administración reservada a super_admin, validación de claves de features y combinación de cambios parciales.
- Edición de precios regionales y anuales; invalidación de cachés y datos de sincronización afectados.
- Registro de cambios antes/después para auditoría.
- Cuota mensual IA con reserva atómica e identidad del efecto en Redis, evitando la carrera de leer y luego incrementar.
- Renovación con importe y moneda congelados en la suscripción. `renewal-scheduler.service.ts` usa `chargeAmountCents`/`chargeCurrency` y no inventa un precio si faltan.
- Estados diferenciados de gasto WhatsApp, reservas, resultados inciertos y modo `observe`/`enforce`.

### Hallazgos que deben agregarse al plan

| Prioridad | Hallazgo y evidencia | Cambio necesario |
|---|---|---|
| P1 | `financials.service.ts:153` llama margen a ingreso menos LLM; `:128` agrega infraestructura solo a nivel global. | Contribución por tenant con IA, multimedia, embeddings, PSP, soporte, infraestructura, documentos fiscales y ajustes. Mostrar cobertura de costos. |
| P1 | `financial-snapshot.service.ts:152` guarda llamadas al modelo como `aiMessages`. | Separar llamadas LLM, respuestas IA, tareas terminadas y entregas por canal. Una tarea puede hacer varias llamadas. |
| P1 | `conversations.service.ts:4161` reduce tiers después del presupuesto, pero continúa gastando. | Presupuesto previo por ejecución/iteración, reserva concurrente y política explícita al agotarse. No presentar el umbral como costo máximo. |
| P1 | El cambio de features de un plan es global e invalida cachés, mientras la renovación conserva precio congelado. | Versionar precio y derechos por suscripción; simulación de impacto antes de publicar. No reducir cuotas de clientes antiguos mediante una edición global. |
| P1 | `updatePlan` escribe plan, invalida caché y después escribe auditoría, sin transacción común ni control de versión. | Cambio y auditoría atómicos; invalidación recuperable; `expectedVersion` para evitar sobreescrituras de dos administradores. |
| P1 | Validación semántica insuficiente en `plan-features.registry.ts`. Reproducción local: `llmTier: not_a_tier`, `maxContacts: -2`, `maxChannelAccounts.whatsapp: -2`, `rateLimits.outbound: -100` devuelven cero errores. | Dominios de valores, enteros/no negativos o `-1` solo donde significa ilimitado; coherencia canales/agentes/recursos. |
| P1 | Documentos anteriores aseguran rentabilidad incluso en peor caso usando un presupuesto blando como techo, precios antiguos y PSP retirado. | Marcar esos resultados como históricos no válidos para fijar precios. Sustituir por escenarios y medición real. |
| P1 | Enterprise publica 100.000 mensajes y asientos ilimitados; Custom admite parámetros ilimitados. | Costear uso pesado, soporte, almacenamiento y concurrencia; límites contractuales o bolsa adicional. |
| P2 | El editor local elimina todos los caracteres no numéricos al interpretar importes regionales. Un importe con centavos puede cambiar de magnitud. | Validar formato/decimales por moneda y bloquear entradas ambiguas antes de guardar. |
| P2 | Múltiples precios COP/USD y annual no disponible en producción. | Previsualización exacta de landing, checkout, próxima renovación e impuestos por país/ciclo. |

No se ha probado una migración real de derechos ni el cobro real de todos los países. La revisión está sustentada en lectura de código, reproducción local del validador y catálogo público, no en una certificación E2E completa de billing.

## 6. Wompi y método correcto de calcular margen

La tarifa pública del [Plan Avanzado Agregador de Wompi](https://wompi.com/es/co/planes-tarifas/plan-avanzado-agregador) es **2,65 % + COP 700 + IVA por transacción exitosa**. Se usa para el modelo, no una promoción temporal ni la tarifa de Mercado Pago. No confirma condiciones particulares de nuestro contrato.

Con IVA de la comisión modelado al 19 % y tratado conservadoramente como gasto:

`costo PSP = (importe cobrado × 0,0265 + 700) × 1,19`

`contribución = ingreso sin impuestos trasladados − IA total − infraestructura asignada − soporte directo − PSP − otros costos directos`

Esto no es utilidad neta: faltan desarrollo, ventas, CAC, administración, impuestos de renta y eventuales pérdidas por devoluciones. Un margen alto frente al modelo no compensa por sí solo el costo de adquirir y atender un cliente.

No se asume que nuestros precios estén sujetos o no a IVA sobre la venta. El JSON incluye una sensibilidad si el precio publicado contiene 19 % de IVA de venta. Debe confirmarse el tratamiento aplicable antes de publicar el precio final; no se debe contabilizar como ingreso un impuesto recaudado para otro.

## 7. Modelo económico y propuesta de precios

### Supuestos explícitos

- Conversión para costos USD: COP 4.200; sensibilidad a COP 4.800. No es una TRM actual verificada.
- Uso de toda la cuota IA; costo medio ilustrativo por respuesta de USD 0,001 / 0,0012 / 0,0015 / 0,002 según plan. No son costos medidos ni una promesa sobre qué modelo ejecuta.
- Multimedia/otros consumos IA: USD 0,5 / 1,5 / 5 / 15 al mes.
- Soporte directo asignado: USD 2 / 4 / 10 / 25 al mes. Debe sustituirse por horas reales; onboarding asistido se cobra aparte.
- Infraestructura asignada: USD 5 por tenant pagador, compatible por ejemplo con USD 500 entre 100 pagadores o USD 1.000 entre 200. No prueba que la infraestructura soporte ese volumen.
- Facturación electrónica: COP 250 por documento como supuesto, no tarifa contratada verificada.

### Resultado con la oferta actual

| Plan | Contribución del escenario de referencia | Escenario caro: USD 0,008 por respuesta |
|---|---:|---:|
| Emprendedor | 67,6 % | 44,2 % |
| Starter | 71,4 % | 19,9 % |
| Pro | 64,8 % | −25,2 % |
| Enterprise | 39,3 % | −101,5 % |

El escenario caro es una sensibilidad, no una afirmación de pérdida observada. Su propósito es demostrar que una cuota de mensajes no limita el costo unitario de la tarea. El comportamiento real depende de modelos, longitud de contexto, herramientas, reintentos y efecto del freno blando.

### Recomendación para nuevas contrataciones

| Plan | COP/mes sugeridos | Referencia internacional USD* | Respuestas estándar incluidas propuestas | Agentes | Contribución ilustrativa |
|---|---:|---:|---:|---:|---:|
| Emprendedor | 129.900 | 29 | 1.000 | 1 | 68,5 % |
| Starter | 299.900 | 69 | 5.000 | 1 | 73,4 % |
| Pro | 799.900 | 179 | 15.000 | 3 | 74,4 % |
| Enterprise | 2.199.900 | 499 | 40.000 | 10 | 72,9 % |
| Custom | por cotización | desde 999, sujeto a alcance | capacidad/bolsa pactadas | pactados | mínimo objetivo 65–70 % |

*Precios regionales propuestos, no conversión automática; el modelo de margen de esta tabla usa únicamente cobros COP. USD requiere modelar su PSP y adquirir capacidad de cobro donde hoy solo hay venta asistida.*

**Estos precios dependen de la oferta nueva y de medir/controlar el uso; no se obtienen esos márgenes manteniendo silenciosamente las cuotas actuales de Pro/Enterprise.** Si queremos conservar 25.000 y 100.000 respuestas con los costos medios del escenario de referencia, el precio mínimo modelado para 70 % de contribución sería aproximadamente COP 904.000 y COP 3.837.000 respectivamente. No recomiendo trasladar ese salto de golpe a clientes existentes.

La alternativa que prefiero es vender plataforma y capacidad estándar con paquetes adicionales de IA avanzada. Mantener un único contador comprensible al usuario, con equivalencias visibles y simulador: una respuesta estándar consume una unidad; operaciones avanzadas consumen lo previamente declarado según modelo/costo. Esas equivalencias requieren medición y una implementación nueva; hoy `maxAiMessages` cuenta respuestas y no créditos ponderados. No cambiar su significado sin versionarlo.

Presupuesto interno inicial para investigar: USD 3 / 8 / 25 / 80 de IA por plan, independiente de Meta, con reserva antes de ejecutar y contingencia. Son propuestas de control, **no nuevos topes activados ni garantía de que alcancen para cada cuota**. Si la calidad necesaria no cabe, ofrecer bolsa adicional o una oferta más pequeña; no rebajar silenciosamente la capacidad del agente en una venta o cobro sensible.

Para excedentes: avisos 70/90/100 %, compra explícita o auto-recarga con techo aceptado, nunca recarga ilimitada. El precio por paquete debe derivarse de su costo P95 y margen, incluyendo PSP; no prometer hoy que 1.000 operaciones avanzadas cuestan lo mismo que 1.000 respuestas simples. Mantener separados en la factura/explicación consumo Parallly y consumo Meta.

Con FX a 4.800, la contribución de la propuesta baja a 64,6 / 70,1 / 71,2 / 69,5 %. Si el precio mostrado incluye 19 % de IVA de venta, queda aproximadamente en 62,5 / 68,3 / 69,5 / 67,8 %. **Objetivo recomendado: 70–75 % de contribución normal y al menos 60–65 % en escenarios razonables de tensión**, no afirmar 80 % garantizado.

Descuento anual: empezar con máximo 10 % únicamente después de habilitar y validar el ciclo anual. Los cupos se renuevan mensualmente. Anual prepagado se reconoce por período para margen; recaudar el año entero no es ingreso mensual recurrente del mes del cobro.

### Competidores como referencia, no equivalencia

[respond.io](https://respond.io/pricing) publica importes equivalentes anuales de USD 79/159/279; el pago anual y los límites por contactos/créditos importan al comparar. No son cotizaciones mensuales equivalentes a nuestras cuotas. [Jelou](https://jelou.ai/es/pricing) publica Builder USD 25 con 1.000 ejecuciones y USD 5 de créditos, y Growth USD 299 con 10.000 ejecuciones y USD 100 de créditos. Separa ejecución y consumo de IA.

La lección útil es hacer explícito el consumo, no copiar su importe. Nuestra propuesta debe vender trabajo terminado, integración con CRM/agenda/pagos/conocimiento, control y asistencia de configuración. No prometer ser mejor que el agente nativo de Meta sin comparar tareas equivalentes y costos totales.

## 8. Hostinger hoy y AWS al crecer

### Hostinger KVM 2

La [página pública de Hostinger Colombia](https://www.hostinger.com/co/vps-servidor-web) indica 2 vCPU, 8 GB RAM, 100 GB NVMe y 8 TB de transferencia. Muestra COP 28.900/mes promocionales y renovación a COP 50.900/mes **para el plazo de dos años mostrado**. No permite concluir cuánto costó el contrato anual del usuario. Como reserva de planificación, usar COP 80.000/mes para VPS y ajustar con la factura; añadir copias externas/observabilidad/dominio por separado.

No tomar una promoción como base del margen permanente. El límite no es un número mágico de tenants: medir simultaneidad, espera de cola, conexiones PostgreSQL, memoria, crecimiento de disco y duración de tareas. El Compose actual ya separa API, worker, WhatsApp y dashboard, pero todos comparten el host y algunos procesos tienen límites de memoria menores que el total disponible.

### Tres opciones de infraestructura

| Etapa | Arquitectura | Presupuesto mensual orientativo, sin IA ni Meta |
|---|---|---:|
| Actual | KVM 2 + backup externo + observabilidad austera | COP 150.000–300.000 como provisión conjunta, no factura real |
| Puente AWS opcional | Lightsail 8/16 GB + snapshots/almacenamiento; base y colas autogestionadas | USD 60–150; conserva punto único de fallo |
| AWS administrado inicial | ECS, RDS PostgreSQL, Redis/Valkey por nodos, S3, red y logs | USD 300–600; dimensionamiento y HA parciales por definir |
| AWS con redundancia | Réplicas API/worker/canal, RDS Multi-AZ, colas replicadas, S3, balanceo y observabilidad | USD 700–1.300 como presupuesto, no cotización cerrada |

Anclas públicas verificadas: [Lightsail](https://aws.amazon.com/lightsail/pricing/) cuesta USD 44/mes con 8 GB y USD 84 con 16 GB; snapshots USD 0,05/GB-mes. No confundirlo con una plataforma administrada y redundante. En [Fargate us-east-1](https://aws.amazon.com/fargate/pricing/), Linux/x86 cuesta USD 0,000011244/vCPU-segundo y USD 0,000001235/GB-segundo: 6 vCPU y 12 GB agregados durante 730 h dan **USD 216,24 solo de cómputo**.

Para ese escenario redundante, reservar adicionalmente RDS Multi-AZ USD 150–300, colas USD 60–120, balanceo USD 20–40, salida de red/NAT/IPv4 USD 70–130, y almacenamiento/backups/logs/tráfico USD 50–150. Son asignaciones de presupuesto a validar en Calculator, no tarifas individuales de instancias cotizadas. Añadir contingencia. [RDS](https://aws.amazon.com/rds/postgresql/pricing/) factura instancia/almacenamiento y posibles créditos de CPU; [VPC](https://aws.amazon.com/vpc/pricing/) tiene cargos propios por NAT, procesamiento y direcciones públicas.

Con infraestructura de USD 600/mes, el reparto es USD 30 por tenant a 20 pagadores, USD 12 a 50, USD 6 a 100 y USD 3 a 200. Con USD 1.000 son USD 50/20/10/5 respectivamente. Ese costo vuelve inviable tratar Emprendedor como soporte intensivo o migrar demasiado temprano sin ingresos. No confundir estos ejemplos de reparto con capacidad certificada.

### Preparación técnica necesaria

1. Medios y documentos fuera del disco local, con S3 o equivalente, URLs y permisos por tenant.
2. RDS con extensión `pgvector` compatible, rol de migración probado, parámetros de locks/conexiones y ensayos de todos los schemas. [AWS soporta pgvector](https://aws.amazon.com/about-aws/whats-new/2023/05/amazon-rds-postgresql-pgvector-ml-model-integration/); eso no certifica automáticamente nuestras migraciones.
3. Mantener PgBouncer/protocolo transaccional y conexión directa para migraciones; revisar DDL en runtime antes de multiplicar réplicas.
4. Redis/Valkey por nodos con `noeviction`, reconexión y recuperación desde ledger durable. [BullMQ desaconseja ElastiCache Serverless en su guía actual](https://docs.bullmq.io/guide/redis-tm-hosting/aws-elasticache) por la política de expulsión incompatible; no elegirlo solo porque dice serverless.
5. Socket.IO entre réplicas, exclusión/leases de jobs, crons sin duplicar efectos y drenaje de workers durante deploy.
6. Secretos mediante gestor de secretos/roles, restauración ensayada, RPO/RTO acordados, costos por entorno y alertas presupuestarias. Entorno de prueba también cuesta.
7. Elegir región por latencia y costo reales. Escalar por métricas; umbrales iniciales de investigación: memoria sostenida >75 %, CPU >65–70 %, cola fuera del SLO o saturación de DB durante picos. No son garantías ni límites ya medidos.

Recomiendo preparar esa portabilidad ahora, y migrar cuando el margen recurrente financie la arquitectura y las métricas/SLA lo justifiquen. No hace falta movernos a AWS para resolver la tarjeta de Meta.

## 9. Cómo agregan la tarjeta los tenants existentes

La guía oficial [Onboarding customers as a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider/) indica dirigir al cliente al administrador de WhatsApp para añadir el método de pago.

### Recorrido que ya puede realizar el dueño

1. Entrar con su usuario administrador de Meta al [Administrador de WhatsApp](https://business.facebook.com/wa/manage/home/).
2. Seleccionar el portfolio y la **cuenta de WhatsApp Business propietaria del número**. No la cuenta publicitaria ni una cuenta de Meta Business Agent.
3. En Información general, usar **Agregar método de pago**. También puede entrar al [Centro de facturación → Métodos de pago](https://business.facebook.com/latest/billing_hub/payment_methods/) y seleccionar/asociar la WABA correspondiente.
4. Completar país/moneda/datos de facturación y tarjeta en la interfaz de Meta; confirmar que queda asociada a la WABA, no solamente guardada como tarjeta del portfolio.
5. Volver a Parallly y verificar el estado. Si había rechazo 131042, resolver deuda/restricción y reanudar de manera controlada. Registrar tarjeta no prueba que los cobros serán aprobados.

No es necesario reconectar el número, eliminar la cuenta, repetir onboarding o perder historial solo para añadir financiación. Si no aparece la opción, revisar permisos financieros/administración y quién financia actualmente la WABA; si pertenece a un BSP con crédito compartido, gestionar esa relación antes de cambiar el pagador. La disponibilidad de medios depende de la cuenta/país; no trasladar las limitaciones Visa/Mastercard del agente nativo a todas las WABA por inferencia.

**No migramos la tarjeta de Wompi a Meta.** Son dos autorizaciones y comercios diferentes. Parallly puede abrir y guiar el recorrido de Meta, pero no debe recoger PAN/CVV ni reutilizar tokens Wompi. La integración recomendada hoy es apertura en dominio oficial, no formulario propio ni iframe inventado. No se encontró una API pública de Tech Provider para copiar una tarjeta de suscripción a una WABA.

### Lo que falta en nuestro producto

- `WhatsappSpendPanel.tsx` ya explica quién cobra y muestra aviso, pero no ofrece un enlace accionable al centro de facturación.
- `GET /whatsapp/spend/funding-readiness` dice explícitamente `reachesMeta: false`. Solo devuelve evidencia de un rechazo o `not_checked`; no certifica tarjeta presente/ausente.
- El clasificador `readFundingFromGraph` existe, pero no tiene consumidor productivo que haga esa lectura. Además debe validar respuesta/identidad/campo presente: solicitar un campo y recibir una respuesta incompleta no prueba ausencia de tarjeta.
- El endpoint actual toma tenant de `req.user` y necesita un alcance de super_admin explícito para operar como inventario global seguro. No hay aquí una campaña completa de migración por WABA.

Construir una tarea persistente de financiación por **tenant/WABA**, con números afectados, responsable, link oficial y estados separados: no verificado, declarado por administrador, evidencia de financiación, rechazado y validación pendiente. Si la API y permisos permiten leer `primary_funding_id`, guardar solo evidencia de presencia y fecha, no tarjeta. Ese ID puede representar crédito u otro medio, no necesariamente una tarjeta. Si la API no permite verificarlo, decirlo y usar atestación identificada como tal más evidencia operativa; no inventar verificación.

Añadir retorno con botón “Comprobar estado”, pero no convertir el clic del usuario en señal de solvencia. Un ensayo con envío necesita destinatario con consentimiento y presupuesto; no es necesario para simplemente abrir el enlace o registrar que se completó el paso. La pausa 131042 debe impedir tormentas de reintentos y permitir seguir atendiendo entradas.

Actualizar Assist, onboarding, tours y es/en/pt/fr con dos tarjetas visibles: **“Tu plan Parallly — Wompi”** y **“Tus mensajes WhatsApp — Meta”**. Agregar presupuesto/proyección por número y país de destinatarios; mostrar lo estimado y lo confirmado por separado. `observe` mide, no impide gastar: activar protecciones no es solo mostrar un badge.

## 10. Orden de ejecución recomendado

| Bloque | Entregable | Criterio de cierre |
|---|---|---|
| A — Continuidad antes de octubre | Inventario de WABA históricas, CTA Meta, estados/evidencia y aviso corregido de 1.000/1.001 | Cada WABA tiene responsable y estado honesto; recorrido con permisos reales probado sin reconectar |
| B — Medición económica | Costos por ejecución/tenant, PSP, soporte, infraestructura y métricas con unidad correcta | Comparación con facturas/ledger y explicación de discrepancias; no marcar todo como margen neto |
| C — Administración segura | Versiones de plan/derechos, preview de impacto, auditoría atómica y validación semántica | Cambiar oferta nueva no cambia precio ni cuota de suscripciones históricas sin transición explícita |
| D — Oferta comercial | Aprobar precios, cuotas estándar/avanzadas, impuestos, soporte y excedentes | Cotización/landing/checkout/factura/renovación coinciden en cada país y ciclo |
| E — Protección | Reserva del costo IA y límites Meta por número/contacto/tarea | Casos concurrentes, reintentos e incertidumbre no duplican gasto; presupuestos observados no se presentan como activos |
| F — Crecimiento | S3, restauración, múltiples réplicas, presupuesto AWS y carga | Dimensionamiento medido, reconciliación tras failover, RPO/RTO y costo por pagador aceptables |

Mientras se implementa: mantener contratos existentes y precios actuales durante la adaptación a Meta; probar la propuesta con nuevas altas. La afirmación anterior de que Meta no afecta nuestro margen debe matizarse: no agrega COGS directo si paga el tenant, pero sí puede aumentar soporte, churn y fricción de venta.

No se aprobó ni ejecutó una subida de precios, reducción de cupos, comunicación saliente a clientes, cambio de tarjeta o compra de infraestructura. Esta auditoría agrega trabajo concreto al programa y ofrece una base reproducible para decidir.
