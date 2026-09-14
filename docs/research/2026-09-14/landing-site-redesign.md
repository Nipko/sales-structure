# Parallly: rediseño de comunicación de todo el sitio

## Decisión de posicionamiento

Promesa central: **Tu atención con IA. Fácil de configurar. A tu manera.**

La facilidad debe demostrarse mediante una configuración comprensible y guiada. Parallly Assist explica qué configurar y dónde hacerlo según el rol de la persona. El administrador aporta información, activa las herramientas necesarias, prueba y publica. Los agentes de atención usan esa base para responder y actuar dentro de su configuración. El equipo humano mantiene la continuidad y supervisa los resultados.

El producto se presenta como una plataforma para atender, vender y organizar el seguimiento. El beneficio de negocio precede a la lista de funciones. La promesa no equivale a configuración automática, conexión universal en un clic, publicación sin revisión ni garantía de resultados.

## Auditoría y arquitectura resultante

| Superficie | Problema de comunicación | Cambio |
| --- | --- | --- |
| Inicio | La propuesta anterior destacaba beneficios generales pero apenas explicaba la puesta en marcha, Assist y las capacidades conectadas. | Configuración guiada al principio, explorador de objetivos, cinco canales interactivos, inteligencia/Assist/calidad y adaptación por proceso. |
| Navegación | Secciones de industria parecían definir todo el alcance. Conocimiento, Assist y calidad estaban ausentes. | Acceso a toda la plataforma, nuevas páginas de inteligencia y una salida explícita para negocios que no aparecen. |
| Plataforma | Catálogo de funciones con poca relación entre ellas. | Mapa por trabajos: atención/ventas, operación/equipo, inteligencia y visibilidad. |
| Agente IA | Se confundían el agente de clientes, el conocimiento y la ayuda para operar el producto. | Función, fuentes, herramientas y pruebas del agente; separación visible de Assist y calidad. |
| Canales | Se perdió protagonismo de las interacciones y no quedaba claro cómo conectar. | Selector de cinco canales, pasos específicos, conversación por etapas y traspaso humano. |
| CRM | Difícil visualizar lo que aporta después de responder un mensaje. | Contacto, historial, oportunidad, responsable, tarea y siguiente paso con ejemplo interactivo. |
| Reservas | Funciones aisladas de disponibilidad y calendario. | Recorrido del servicio al horario, equipo y seguimiento; configuraciones y límites visibles. |
| Android | La app quedaba relegada a una mención pequeña y su distribución figuraba como privada. | Sección propia en portada con capturas, selector Atención/CRM/Agenda y descarga directa de Google Play. Página de producto y copy actualizados al lanzamiento público, con alcance operativo explícito. |
| Sectores | Un negocio ausente podía interpretar que Parallly no le servía. | Búsqueda con sinónimos, filtros por necesidades, configuración transversal y consulta con contexto cuando no hay coincidencias. |
| Precios | El cuestionario elegía un plan por posición en el catálogo, sin comprobar requisitos. | Guía de necesidades y consulta contextual; precios y capacidades siguen viniendo del catálogo activo. |
| Costos/comparación | Contenido extenso sin ruta de lectura. | Índices por tarea, jerarquía de lectura y lenguaje visual compartido; se conserva la información comercial y sus fuentes. |
| Contacto | Solo ayudaba a usuarios que ya tenían una incidencia. | Entradas para evaluar el negocio, conocer Assist y solicitar soporte. El correo se prepara y el visitante decide enviarlo. |
| Documentos legales | Presentación visual ajena al resto del sitio. | Superficie de lectura clara sin reescribir el contenido contractual. |

Los sectores conservan sus estados de producto y las restricciones de publicación respaldadas por el registro. La búsqueda encuentra orientaciones, no certifica una solución especializada. Las demostraciones son ilustraciones locales identificadas como tales.

## Benchmark de comunicación

Consulta: 14 de septiembre de 2026 (UTC). Se analizaron fuentes oficiales. Son patrones observados, no resultados de una prueba de conversión propia.

| Referente | Patrón observado | Aplicación a Parallly |
| --- | --- | --- |
| [Respond.io: encaje en una empresa](https://respond.io/faqs/where-does-respondio-fit-company-tech-stack) | Explica el ciclo desde conversación hasta seguimiento y a qué equipos sirve. | Mostrar el recorrido conectado y ofrecer evaluación por proceso, además de sectores. |
| [Kommo: cómo funciona el producto](https://support.kommo.com/docs/kommo-basics) | Organiza la explicación alrededor de consultas, oportunidades, tareas, responsables y avances de un proceso comercial. | Hacer tangible el CRM mediante una oportunidad de ejemplo y su siguiente acción. |
| [Intercom Copilot](https://www.intercom.com/helpdesk/copilot) | Distingue la asistencia interna del agente que responde a clientes y conecta la ayuda con fuentes de conocimiento. | Separar Parallly Assist, agente de clientes y base de conocimiento; explicar para quién trabaja cada uno. |
| [Intercom: recomendaciones de contenido](https://www.intercom.com/help/en/articles/11394959-use-ai-powered-content-recommendations-to-improve-fin) | Presenta calidad y contenido como una secuencia de revisión y mejora. | Mostrar señal → orientación → revisión humana, sin atribuir a Parallly funciones autónomas de reparación. |
| [Trengo](https://trengo.com/) | Presenta canales, colaboración y automatización dentro de una misma propuesta de atención. | Conectar la demostración del canal con el equipo y el seguimiento. |

No se copian textos, identidad visual, testimonios, métricas, certificaciones ni funciones de los competidores. Su oferta puede cambiar; las promesas de Parallly se contrastan con el repositorio.

## Base de verificación del producto

- `docs/product-capabilities-reference.md`: alcance y fuentes de código.
- `docs/user-manual.md`: configuración, roles, CRM, agenda y conocimiento.
- `docs/platform-assistant-knowledge.md`: Parallly Assist y ayuda dentro del producto.
- `docs/mobile-user-manual.md`: alcance y acceso móvil.
- `apps/landing/src/data/product-capabilities.ts`, `marketing-claims.ts`, `demo-catalog.ts`: estados públicos, conteos y demostraciones.
- Catálogo activo de planes: autoridad para precios, cupos y disponibilidad; no se sustituyó por cifras ficticias en la vista previa.

## Lenguaje visual e interacción

Azul oscuro para la marca y las cabeceras, superficies claras para leer, azul para acciones y bordes discretos. Muestras de producto hechas en HTML para que el contenido sea accesible, adaptable y traducible. Los controles de demostración avanzan a petición del visitante. No hay testimonios inventados ni contadores de resultados comerciales.

Todos los mensajes nuevos se incorporan en español, inglés, portugués y francés. Se conservan las rutas localizadas, los metadatos y los enlaces alternativos. Las páginas nuevas de conocimiento, Assist y calidad se incorporan al sitemap.

## Validación

Actualización de Android: publicación confirmada por el propietario y ficha pública verificada con respuesta HTTP 200, nombre «Parallly», package `cloud.parallly.mobile`, editor «Automation AI» y sitio asociado `parallly-chat.cloud`. [Ficha de Google Play](https://play.google.com/store/apps/details?id=cloud.parallly.mobile). La descarga no implica una suscripción gratuita. Se reutilizan las capturas aprobadas de `apps/mobile/store-assets/play/`, cuyo contenido ficticio y autorización constan en `docs/play-console-pasos-finales.md`. La sección muestra que las capturas están en español y utiliza un enlace de texto propio a Google Play.

Verificación de esta actualización: build estático, tipos, lint y contratos aprobados; 2.359 claves en los cuatro idiomas. Selector y destino de descarga comprobados; vistas de 1.440, 390 y 320 px sin desbordes. La página Android conserva su demo interactiva y ya ofrece la descarga. Los 3.656 enlaces locales siguen sin errores.

- Build de producción completado: compilación, tipos, lint y exportación de 198 páginas. Exportación localizada verificada en 156 documentos HTML.
- Paridad de 2.330 claves en español, inglés, portugués y francés; contratos de marketing, congelación de claims y evidencia competitiva aprobados. Sitemap: 37 rutas por idioma.
- `node apps/landing/scripts/verify-export-navigation.cjs`: 3.656 enlaces locales, sin destinos o anclas faltantes ni IDs duplicados.
- Revisión visual y de desbordes en escritorio, tableta y móvil, incluyendo ancho de 320 px. Menú de escritorio comprobado a 1.024 × 400 px: todo el contenido sigue accesible mediante desplazamiento. Menú móvil, cambio real de idioma, foco y cierre con Escape comprobados.
- Interacciones verificadas: cinco canales y pasos de conexión, traspaso humano de ejemplo, cambio de etapa y responsable en CRM, tarea completada, reserva ilustrativa, fuentes de conocimiento, escenarios de calidad, Assist según rol, búsqueda de negocios y orientación de planes. Los enlaces de consulta preparan el contenido sin enviar mensajes.
- Revisión de 20 rutas en español y 15 combinaciones adicionales en inglés, portugués y francés: un título principal por página, idioma correcto y sin claves sin traducir. La revisión adicional de sectores cubrió 72 páginas localizadas.

### Límite de la vista previa local

El catálogo público de planes responde con HTTP 200 y cinco planes, y permite el origen de producción `https://parallly-chat.cloud`. El origen `http://localhost:3003` no forma parte de la lista CORS del backend (`apps/api/src/main.ts`), por lo que el navegador local no puede leer ese catálogo. La vista previa presenta un aviso, una opción de reintento y orientación/contacto; no muestra precios ficticios. No se modificaron la API ni su configuración de seguridad. Las tarjetas de planes con datos en vivo y su contratación no se verificaron desde este origen local.
