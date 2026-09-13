# Auditoría de contenido y promesas de la landing de Parallly

Fecha de corte: 10 de septiembre de 2026. HEAD observado: `78ac4a36`, con trabajo concurrente en el árbol. Alcance: código de `apps/landing`, referencia vigente del producto, catálogo público y paquete de investigación Meta de esta carpeta. No se modificó producto, no se consultaron cuentas privadas y no se enviaron formularios, mensajes ni pagos.

**La landing necesita una corrección comercial antes de ampliar su promoción.** Utiliza precios runtime y tiene controles útiles contra testimonios y porcentajes inventados, pero sigue convirtiendo valores internos de planes en promesas públicas, presenta algunos escenarios simulados como reales y no permite entender el costo separado de WhatsApp. No hace falta fijar nuevos precios para corregir esas contradicciones.

## 1. Qué se comprobó y qué no

- Lectura de las 17 plantillas `page.tsx`, sus layouts, componentes, datos, cuatro traducciones y variante es-AR. La ruta dinámica genera 18 páginas: **34 rutas públicas expandidas**.
- El agente coordinador inspeccionó mediante navegador el DOM público de `https://parallly-chat.cloud` el 10 de septiembre. Esa observación se distingue abajo de la lectura local; no demuestra que todos los archivos locales estén desplegados.
- Se ejecutaron los tres validadores existentes: contrato de marketing, cuatro fixtures de regresión y evidencia competitiva. Todos pasaron. Los cuatro JSON base tienen **1.177 valores hoja cada uno, sin claves faltantes ni sobrantes** respecto de español. Esto comprueba estructura; no certifica precisión comercial, calidad de traducción ni accesibilidad.
- No se realizó un recorrido visual completo de 34 rutas × 4 idiomas × tamaños, ni una auditoría WCAG instrumental. Los puntos de accesibilidad son hallazgos de fuente o verificaciones pendientes, no una certificación de conformidad.

Fuentes: [generación de verticales](../../../apps/landing/src/app/(marketing)/soluciones/[slug]/page.tsx#L6), [catálogo vertical](../../../apps/landing/src/data/verticals.ts#L36), [scripts](../../../apps/landing/package.json), [referencia del producto](../../product-capabilities-reference.md#L1).

## 2. Inventario completo de rutas y contenido

| Ruta | Contenido realmente conectado | Tratamiento recomendado |
|---|---|---|
| `/` | Hero; confianza/integraciones; flujo de resultado; seis herramientas con demos; selector de industrias/canales; Android; control IA; precios; FAQ; CTA final. Navbar y footer compartidos. | Beneficio concreto, prueba condicionada, explicación breve de las tres facturaciones y acceso al detalle WhatsApp. |
| `/precios` | Selector de país y ciclo; cinco planes runtime; matriz por categorías; cuestionario de tres preguntas; contacto comercial; FAQ; confianza y CTA. | Corregir proyección comercial, unidades, límites, impuestos y costo separado Meta. |
| `/soluciones` | Hero; cuatro grupos; catálogo de 18 verticales; modo de producto; CTA. | Explicar preparación con palabras del negocio, sin jerga del manifiesto interno. |
| `/soluciones/{slug}` × 18 | Hero y agente ilustrativo; limitación de capacidades especializadas mediante política; problemas; tres pasos; capacidades CRM/IA/handoff; relacionadas y CTA. | Mantener límites honestos; preservar vertical elegida al registrarse. El bloque llamado `ROI Stats` en el código actualmente muestra capacidades, no porcentajes. |
| `/producto` | Hub de agente, canales, reservas, CRM y Android; beneficios; CTA. | Añadir ruta clara para cobros de clientes y para supervisión/configuración asistida según alcance implementado. |
| `/producto/agente-ia` | Hero; cinco capacidades; demo de configuración; tres casos; CTA. | Sustituir superioridad no medida y etiquetar casos como ilustrativos. Explicar herramientas, conocimiento y supervisión. |
| `/producto/canales` | Hero; cinco canales; demo de inbox; tres escenarios entre canales; CTA. | Añadir condiciones de conexión, identidad, consentimiento, plantillas y cargos; evitar prometer movimientos automáticos entre canales. |
| `/producto/reservas` | Hero; reglas, calendarios, conflictos y recordatorios; demo; casos ilustrativos; CTA. | Conservar límites ya explícitos; explicar que recordatorios WhatsApp pueden tener costo y requieren configuración. |
| `/producto/crm` | Hero; pipeline, scoring, perfiles, automatización, campañas; demo; tres casos; CTA. | Corregir universalidad de automatización y promesas de campañas que no tienen certificación del recorrido publicado. |
| `/producto/app-android` | Hero; maqueta; capacidades; flujo operativo; alcance; acceso privado por correo. | Mantener acceso privado y ausencia de descarga pública; no convertirlo en disponibilidad en Play Store. |
| `/support` | Contacto por correo; información necesaria para soporte; enlaces de ayuda/legal. | Añadir preguntas de WhatsApp y facturación, sin pedir claves ni datos de tarjeta. No se encontró un SLA cuantitativo publicado aquí. |
| `/terms` | Términos completos en es/en/pt/fr, planes, prueba, facturación, uso, responsabilidad y Meta. | Actualizar responsabilidades de cargos y documentos Meta aplicables; revisión jurídica independiente. |
| `/privacy` | Privacidad en cuatro idiomas; proveedores IA, pagos, diagnóstico, móvil, Google y Meta. | Alinear procesamiento de conversaciones/aprendizaje con el comportamiento permitido e implementado. |
| `/data-policy` | Política de tratamiento en cuatro idiomas, finalidades, derechos, encargados, retención y seguridad. | Mantener concordancia con privacidad y proveedores efectivamente habilitados. |
| `/data-deletion` | Formulario con traducciones locales para solicitud y posterior verificación. | Preservar distinción titular de cuenta/cliente del negocio y vía de revocación Meta. No se envió el formulario. |
| `/data-deletion/status` | Consulta por código, estados, fechas y fuente; `noIndex: true`. | Preservar privacidad y `noindex`; verificar manualmente estados sin datos reales. |
| `/signup` | Puente JavaScript a registro del dashboard, allowlist de atribución y spinner. | Conservar atribución segura, añadir contexto permitido, texto accesible, enlace alternativo y `noindex`. |

Los 18 slugs son `salud`, `restaurantes`, `inmobiliaria`, `belleza`, `gimnasios`, `turismo`, `educacion`, `seguros`, `veterinaria`, `fotografia`, `automotriz`, `hogar`, `finanzas`, `servicios-profesionales`, `tecnologia`, `retail`, `pet-services`, `otro`.

La home **no monta** `ComparisonTable`, `TestimonialsSection`, `ProblemSection`, `HowItWorks`, `FeaturesGrid`, `StatsCounter` ni `VibeSellingBand`. `MultiChannelShowcase` no se monta como sección completa, pero sus `MiniChannelDemo` y escenarios sí se reutilizan en `VerticalsShowcase`. No confundir código o traducciones huérfanas con contenido publicado. Las demos de herramientas son `PipelineDemo`, `InboxDemo`, `CalendarDemo`, `AnalyticsDemo`, `KnowledgeBaseDemo` y `AgentConfigDemo`; el selector vertical añade `VerticalChatDemo` y widgets de reservas, CRM e identidad.

Fuentes: [home](../../../apps/landing/src/app/(marketing)/page.tsx), [precios](../../../apps/landing/src/app/(marketing)/precios/page.tsx#L172), [hub producto](../../../apps/landing/src/app/(marketing)/producto/page.tsx#L13), [detalle vertical](../../../apps/landing/src/app/(marketing)/soluciones/[slug]/IndustryPageClient.tsx#L19), [herramientas](../../../apps/landing/src/components/sections/ToolsShowcase.tsx#L14), [selector y widgets](../../../apps/landing/src/components/sections/VerticalsShowcase.tsx#L7), [navegación](../../../apps/landing/src/data/navigation.ts), [rutas](../../../apps/landing/src/lib/routes.ts).

## 3. Hallazgos priorizados y texto propuesto

### L1 — P0: el catálogo público vende capacidades legadas como canales actuales

**Confirmado en producción por el coordinador:** Starter muestra WhatsApp, Instagram, Messenger, Email y Telegram; Pro/Enterprise muestran también SMS. **Causa local:** `planHighlights` toma `features.channels` sin proyectar disponibilidad del producto; `formatChannelNames` convierte `email` y `sms` en nombres comerciales. La matriz usa la misma fuente. El seed también contiene canales legados, pero sus valores no son una captura del catálogo efectivo.

La referencia vigente dice Email interno sin alta autoservicio y **SMS retirado para nuevas altas, configuración, compras y campañas**. Web Chat se habilita por otra feature, lo que también puede omitirlo del resumen de canales.

**Cambio:** producir una proyección comercial desde catálogo runtime + política operativa actual; distinguir conexiones permitidas, agentes y Web Chat. No arreglarlo sólo ocultando palabras en un componente mientras otra superficie sigue vendiéndolas. Preservar derechos legados en su administración correspondiente.

**Texto:** «Conecta los canales disponibles en tu plan: [lista operativa]. Cada conexión utiliza un agente asignado». No incluir Email/SMS en captación nueva.

Evidencia: [resumen de canales](../../../apps/landing/src/components/sections/PricingSection.tsx#L31), [formatter](../../../apps/landing/src/lib/api.ts#L63), [matriz](../../../apps/landing/src/data/pricing.ts#L43), [alcance vigente](../../product-capabilities-reference.md#L39), [seed](../../../apps/api/prisma/seed-billing-plans.js#L189).

### L2 — P0: no se distinguen suscripción, consumo Meta y cobros del negocio

La home y precios no explican las tres relaciones. «Servicios de terceros… por separado» no permite estimar el costo de WhatsApp. La prueba «sin tarjeta» corresponde a Parallly y puede interpretarse como no necesitar método de pago Meta. El coordinador observó 7 días sin tarjeta en Emprendedor/Starter y 15 días con tarjeta en Pro/Enterprise; esa observación no valida por sí sola la elegibilidad de cada cuenta.

El paquete oficial verifica cobro de servicio desde **1-oct-2026**, 1.000 entregas de servicio gratuitas por número/mes y necesidad de método de pago antes del 30-sep. No son 1.000 conversaciones ni 1.000 respuestas IA, no se multiplican por país y no autorizan a operar sin método de pago. Utility en ventana también vuelve a cobrarse. El requisito Meta es independiente de la prueba SaaS.

**Texto comercial propuesto:** «El plan paga el software de Parallly y sus límites de uso. WhatsApp puede generar cargos de Meta por mensajes entregados, según categoría, país del destinatario y moneda de la cuenta. Estos cargos son distintos de tu suscripción». Añadir el pagador concreto solamente cuando se verifique en la arquitectura implementada de cada alta, no dar por hecho que todos los WABA pagan directamente.

**Texto de prueba:** «Prueba de Parallly: [días y requisitos vigentes]. Para usar WhatsApp también debes cumplir los requisitos de conexión y facturación de Meta». **Texto de cobros del negocio:** «Si tu plan lo incluye, conecta tu propia cuenta de Wompi o Mercado Pago para cobrar las compras de tus clientes. Esos pagos pertenecen a tu negocio y no pagan tu suscripción ni el consumo de WhatsApp».

La matriz no muestra `customerPayments`, aunque el catálogo público sí exporta esa feature. Agregarla con proveedor conectado, capacidades del agente y alcance de conciliación, sin confundirla con tarjetas para pagar Parallly. No se encontró una promesa publicada de crédito WhatsApp en la landing: **no añadirla** desde el campo seed sin un saldo/debito/contrato verificable.

Evidencia: [FAQ precios](../../../apps/landing/messages/es.json#L726), [prueba](../../../apps/landing/src/components/sections/PricingSection.tsx#L141), [exportación customerPayments](../../../apps/api/src/modules/billing/billing-plan-catalog.service.ts#L27), [pagos del negocio](../../product-capabilities-reference.md#L48), [investigación oficial](./meta-official-pricing-evidence.md#L19), [arquitectura de pagos](./whatsapp-account-billing-architecture.md).

### L3 — P0: Custom expone valores técnicos como oferta ilimitada

**Público observado:** «999 agentes IA · Ilimitado mensajes/mes». `salesLed` cambia precio y CTA, pero no condiciona el resumen ni los highlights. No existe una cotización de ese cliente que respalde esos límites. Además, el formatter de almacenamiento y retención no trata `-1`: puede mostrar «-1 MB» o «-1 día» en la matriz.

**Cambio y texto:** «Capacidad, soporte y precio según propuesta». Mostrar límites concretos después de la cotización aprobada. Tratar ausencia, cero, sentinel ilimitado y contrato negociado como estados distintos. No cambiar las cuotas vigentes de clientes a partir de esta auditoría.

Evidencia: [resumen incondicional](../../../apps/landing/src/components/sections/PricingSection.tsx#L119), [highlights](../../../apps/landing/src/components/sections/PricingSection.tsx#L41), [formatters](../../../apps/landing/src/data/pricing.ts#L128).

### L4 — P1: prueba, moneda y cuestionario no significan disponibilidad real

Los badges de prueba se renderizan con `trialDays > 0`, sin exigir `trialAvailable`; pueden mostrar gratuidad aun cuando el CTA sólo permita solicitar acceso. Las banderas para bloquear el CTA sí existen y deben conservarse. El FAQ presenta USD como importe antes de contratar, aunque una moneda cotizada no prueba un rail habilitado fuera de Colombia.

El quiz suma tres respuestas y selecciona la posición proporcional del plan: no resuelve límites de mensajes, conexiones, automatización ni disponibilidad. «Plan ideal» no está justificado por ese algoritmo. Un negocio con más de 5.000 mensajes y respuestas mínimas en las otras dos preguntas puede recibir Starter por puntuación, aunque su cuota sea insuficiente.

**Cambio:** validar requisitos contra capacidades runtime y disponibilidad del país/ciclo; separar recomendación y contratación. **Texto:** «Una orientación inicial; confirma conexiones, volumen y herramientas antes de elegir». Si no hay opción válida, contacto para cotizar. Etiquetar precio de referencia cuando no se pueda comprar y mostrar condición de impuestos junto al precio, de acuerdo con el cálculo fiscal real; los términos dicen actualmente que no incluye impuestos.

Evidencia: [badges](../../../apps/landing/src/app/(marketing)/precios/page.tsx#L256), [quiz](../../../apps/landing/src/app/(marketing)/precios/page.tsx#L73), [FAQ moneda](../../../apps/landing/messages/es.json#L728), [catálogo y flags](../../../apps/api/src/modules/billing/billing-plan-catalog.service.ts#L225), [impuestos](../../../apps/landing/src/app/terms/content/es.tsx#L208), [auditoría económica](./plan-economics-code-audit.md#L35).

### L5 — P1: superioridad, casos reales y automatización universal sin evidencia

En es/en/pt/fr aparecen «Tu mejor vendedor», «Casos de uso reales» en agente/canales/CRM y campañas con plantillas «pre-aprobadas». No hay expediente de clientes reales asociado a esos casos. Las demostraciones ilustran capacidad; no son un benchmark ni certificación vertical. La referencia limita las campañas nuevas a WhatsApp y declara launch/schedule desde editor sin certificación E2E completa.

También se afirma confirmación WhatsApp tras una reserva en Instagram y unificación automática de perfiles: se omiten datos de contacto verificables, identidad, consentimiento, conexión y autorización de envío. «Cada conversación crea un lead» y «sin perder ninguno» hacen universales procesos que dependen de reglas y configuración. `aiQuality` convierte un tier de modelo en «basic/good/advanced/premium» sin medir calidad por tarea.

**Texto:** «Un agente de IA para atender y dar seguimiento con la información de tu negocio»; «Ejemplos ilustrativos de flujos configurables»; «Organiza contactos y oportunidades, con reglas de seguimiento que puedes configurar». Para campañas, comunicar preparación/segmentación y el envío sólo dentro de su alcance validado. «Plantillas que requieren aprobación de Meta» evita sugerir que toda plantilla del usuario ya está aprobada. Identidad: «Reúne el historial cuando hay una coincidencia verificada y revisa las sugerencias de unión». Tier: describir capacidad/modelos disponibles, sin equipararlo a un resultado certificado.

Evidencia: [mejor vendedor](../../../apps/landing/messages/es.json#L1012), [casos entre canales](../../../apps/landing/messages/es.json#L1060), [CRM y campañas](../../../apps/landing/messages/es.json#L1098), [restricción de campañas](../../product-capabilities-reference.md#L80), [calidad por tier](../../../apps/landing/src/data/pricing.ts#L97).

### L6 — P1: jerga visible y selección perdida entre landing y onboarding

Se publican «producto ancla», «preset horizontal», «fallback genérico», «sin valores de respaldo» y «sin importes de respaldo si el catálogo no responde». El coordinador confirmó esas expresiones en la web pública. Son decisiones de implementación, no ventajas comprensibles del producto. El puente preserva plan/país/ciclo y atribución segura, pero no transporta idioma ni vertical explícita; los CTA de industria usan el mismo `SIGNUP_URL` genérico. La cookie de idioma creada en el dominio de la landing no se comparte automáticamente con el subdominio del dashboard.

**Texto:** «Planes y límites para tu negocio»; «No pudimos consultar los precios. Vuelve a intentarlo o contáctanos». Para verticales: «Punto de partida configurable» / «Flujos especializados disponibles tras revisión», según política real. **Cambio:** conservar idioma y vertical mediante parámetros validados de extremo a extremo, permitiendo al usuario revisarlos; no pasar prompts ni configuración arbitraria en URL. La atribución `source_path` puede ayudar a medir, pero no equivale a una elección operativa aplicada.

Evidencia: [texto precios](../../../apps/landing/messages/es.json#L842), [modos verticales](../../../apps/landing/messages/es.json#L570), [CTA vertical](../../../apps/landing/src/app/(marketing)/soluciones/[slug]/IndustryPageClient.tsx#L94), [allowlist signup](../../../apps/landing/src/app/signup/page.tsx#L26), [cookie local](../../../apps/landing/src/components/LangProvider.tsx#L120), [constantes](../../../apps/landing/src/lib/constants.ts#L17).

### L7 — P1: legal y privacidad necesitan alineación, no una exención genérica

Los términos enumeran políticas Meta, pero no explican la relación entre suscripción y cargos nuevos ni contienen un mecanismo de consulta/versionado de tarifas. Revisar el nombre/enlace/alcance vigente de cada contrato; no inferir la condición comercial de Parallly por el nombre «Solution Provider». La privacidad general contempla consentimiento para entrenamiento, mientras la sección Meta dice que las conversaciones se envían únicamente para responder el turno actual y nunca como entrenamiento. El aprendizaje mediante ejemplos, evaluación, resúmenes y procedencia requiere una explicación precisa coherente con el comportamiento permitido: consentimiento genérico no anula restricciones del proveedor.

La política de tratamiento enumera OpenAI/Anthropic/Google; la privacidad admite «otros proveedores». Revisar la lista efectiva de encargados/modelos habilitados y sus condiciones sin afirmar que todos los adaptadores están activos. Conservar rutas de borrado, titularidad tenant y separación de secretos. Este punto requiere revisión jurídica y de operaciones; la auditoría de código no prueba cumplimiento normativo ni obligaciones fiscales.

Evidencia: [términos Meta](../../../apps/landing/src/app/terms/content/es.tsx#L536), [entrenamiento general](../../../apps/landing/src/app/privacy/content/es.tsx#L168), [tratamiento Meta](../../../apps/landing/src/app/privacy/content/es.tsx#L983), [encargados](../../../apps/landing/src/app/data-policy/content/es.tsx#L489), [investigación de identidad/política](./meta-product-identity-policy-evidence.md).

## 4. Traducción, SEO, accesibilidad y presentación

| Área | Evidencia y estado | Cierre necesario |
|---|---|---|
| Cuatro idiomas | Paridad estructural completa; selección cliente y cambio de `html.lang`. Las mismas promesas problemáticas están traducidas en cuatro idiomas. es-AR es overlay, no quinta experiencia independiente. | Revisar las cuatro versiones y overlay tras modificar contenido; pruebas de placeholders y coherencia semántica, sin limitarse a contar claves. |
| SEO multilingüe | Render inicial y metadata en español; `buildMetadata` sólo tiene canonical, sin `alternates.languages`; no hay rutas locales. Cambiar idioma cliente no actualiza por sí solo título/OG/canonical. | Definir estrategia de URLs indexables por idioma, traducción de metadata y enlaces alternos. Evitar cuatro hreflang apuntando a una misma página que depende de cookie. |
| Sitemap | 30 URLs; incluye las 18 verticales y seis páginas producto. No incluye support ni data-deletion. Status está correctamente `noindex`; signup carece de metadata específica. | Generar sitemap desde rutas públicas indexables; decidir inclusión de soporte/borrado; mantener status y puente fuera del índice. Comprobar OG y canonical en páginas desplegadas. |
| Datos estructurados | Organización y software sin reviews/ratings inventados; FAQ se deriva de preguntas. Breadcrumbs/nombres SEO permanecen españoles. | Mantener identidad verificable; no usar app móvil como evidencia de publicación en tiendas; no añadir ratings, métricas o Offers no ligados a catálogo disponible. |
| Navegación | Skip link funcional a `contenido-principal`; menú móvil desplazable; Escape; select idioma con nombre; tabla precios tiene caption y `scope`. | Verificar teclado, foco tras cerrar menú/cambiar idioma, zoom 200–400 %, anclas y horizontal scroll en móvil. No afirmar ausencia global de accesibilidad: ya hay controles. |
| FAQ/puente | FAQ tiene `aria-expanded`, pero sin vínculo estable botón-panel. Signup sólo muestra spinner sin etiqueta ni enlace alternativo. | Nombre/estado accesible del redireccionamiento y alternativa utilizable; asociación botón-panel, foco y lectura de errores. |
| Movimiento/demos | CSS respeta `prefers-reduced-motion` para animaciones CSS; abundan animaciones JS de Motion y demos temporizadas. | Validar preferencia en Motion/timers, permitir pausa o versión estática cuando corresponda; comprobar contenido visible sin depender de animación/hidratación. |
| Responsive | Grillas adaptativas y tablas con scroll previstas en fuente. | Capturas y recorrido de 34 rutas en es/en/pt/fr a 360/768/1440 px; revisar textos largos y estados del catálogo. No se midieron aquí contraste, CLS o rendimiento real. |
| Localización residual | Saludo de WhatsApp en español; asunto comercial usa `monthly/annual`; skins mezclan «en línea» y «Active». | Localizar mensajes de contacto/etiquetas visibles. Conservar marca y parámetros técnicos sólo fuera del texto comercial. |

Fuentes: [idiomas](../../../apps/landing/src/components/LangProvider.tsx#L92), [metadata base](../../../apps/landing/src/app/layout.tsx#L13), [SEO](../../../apps/landing/src/lib/seo.ts#L21), [sitemap](../../../apps/landing/public/sitemap.xml), [robots](../../../apps/landing/public/robots.txt), [navbar](../../../apps/landing/src/components/layout/Navbar.tsx#L95), [tabla](../../../apps/landing/src/app/(marketing)/precios/page.tsx#L302), [FAQ](../../../apps/landing/src/components/ui/FAQItem.tsx#L23), [signup](../../../apps/landing/src/app/signup/page.tsx#L48), [movimiento](../../../apps/landing/src/app/globals.css#L88), [contacto](../../../apps/landing/src/lib/constants.ts#L9), [skins](../../../apps/landing/src/data/channels.ts).

## 5. Comparación Meta y orden de entrega recomendado

No presentar «más barato», «mejor agente» ni un porcentaje de ahorro frente a Meta Business Agent sin una evaluación comparable. Una comparación útil separa **WhatsApp Business App**, **WhatsApp Business Platform/Cloud API**, **Meta Business Agent** y **Parallly**; son productos y capas diferentes. Comparar alcance habilitado por cuenta, canales, CRM, herramientas, calendarios, controles humanos, conocimiento, configuración, medición de resultados y costo total. Marcar «pendiente de verificar» donde no haya evidencia, no convertir una ausencia de datos en una cruz contra el competidor.

El componente comparativo genérico existente no se publica hoy y no tiene evidencia específica por competidor: no reactivarlo como comparación con Meta. Los testimonios también están apagados y el registro de evidencia está vacío; mantenerlo así hasta contar con fuente, consentimiento y alcance verificable. Las demos son útiles si se identifican como ilustrativas; los porcentajes dibujados en una demo no son resultados de clientes.

1. **Corrección previa a publicación:** L1–L3 y lenguaje condicionado de prueba; retirar superioridad/casos reales/campañas no acreditadas; tres facturaciones claras. Mantener precios runtime actuales hasta decisión comercial autorizada.
2. **Conversión coherente:** L4–L6, customerPayments, recomendación por requisitos, contexto hacia onboarding y contenido WhatsApp con fecha efectiva y fuentes. Las pantallas de costo/pagador sugeridas sólo se pueden anunciar como disponibles cuando estén implementadas.
3. **Legal y calidad de toda la web:** L7, cuatro idiomas, SEO, accesibilidad, validación visual, enlaces y estados. Actualizar FAQ, producto, industria, soporte y términos de forma coordinada; no limitar la tarea al hero.
4. **Pruebas que faltan en el contrato de marketing:** fixture de catálogo con Email/SMS/Custom/ausentes; prueba no disponible con días positivos; Web Chat por feature; quote anual/country no soportado; unidades IA vs Meta; links conservando idioma/vertical; ausencia de claims de superioridad sin evidencia. Medir copy en DOM renderizado, no sólo regex de archivos.
5. **Criterio de cierre:** oferta pública = capacidad contratable real; cada importe declara concepto/moneda/ciclo/impuestos aplicables; cada escenario distingue ejemplo y evidencia; ningún CTA promete un paso que el onboarding no soporta; ninguna simulación del [modelo financiero](./modelo-rentabilidad-planes-whatsapp.xlsx) se publica como margen o ahorro real.

Fuentes: [comparador no montado](../../../apps/landing/src/components/sections/ComparisonTable.tsx#L7), [testimonios apagados](../../../apps/landing/src/data/testimonial-evidence.ts#L18), [contrato de claims](../../../apps/landing/scripts/validate-marketing-claims.cjs#L491), [fuentes oficiales Meta](./meta-official-pricing-evidence.md), [informe integrado](./meta-whatsapp-impacto-rentabilidad-plan.md).

No se proponen nuevos precios definitivos ni activación productiva en este documento. Se propone corregir la oferta y completar sus verificaciones con evidencia operativa antes de prometerla.
