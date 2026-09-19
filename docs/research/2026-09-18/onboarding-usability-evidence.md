# Evidencia de usabilidad para revisar el onboarding

Fecha de consulta: 18 de septiembre de 2026. Investigación documental; no es una prueba con usuarios de Parallly ni una certificación de accesibilidad. No se cambió código.

Se contrastaron `docs/onboarding-experience-design-2026-09.md` y `docs/onboarding-decisions-2026-09.md` con siete fuentes primarias abiertas. Las fuentes aportan guías, un estándar y un marco de medición; ninguna demuestra por sí sola que un dueño de negocio latinoamericano con poca experiencia digital complete este producto en diez minutos. Poca experiencia digital y discapacidad cognitiva no son equivalentes: pueden compartir barreras, pero necesitan representación propia en la investigación.

## Siete fuentes y qué permiten afirmar

1. **GOV.UK Service Manual — Structuring forms.** Propone justificar cada pregunta, ramificar para preguntar solo lo pertinente y empezar con una cosa por página. También señala que la investigación determinará cuándo fusionar páginas. Es una pauta de diseño de servicios, no una ley de que cada decisión necesite una pantalla ni evidencia de un número óptimo de pasos. [Fuente](https://www.gov.uk/service-manual/design/form-structure).

2. **GOV.UK Design System — Radios.** Recomienda no preseleccionar respuestas: una opción marcada puede ocultar una pregunta omitida o producir una respuesta incorrecta. Aconseja ofrecer «No sé» cuando sea válido. Esto se refiere a respuestas de formularios; no prohíbe una preferencia de interfaz predeterminada y reversible. [Fuente](https://design-system.service.gov.uk/components/radios/).

3. **Nielsen Norman Group — Progressive Disclosure, Jakob Nielsen, 2006.** Recomienda mostrar lo esencial y ofrecer funciones especializadas a petición. La separación debe mantener delante las funciones frecuentes; trasladar lo necesario a otro nivel tampoco simplifica. Es orientación de usabilidad, sin un tamaño de efecto aplicable a Parallly. [Fuente](https://www.nngroup.com/articles/progressive-disclosure/).

4. **W3C — Making Content Usable for People with Cognitive and Learning Disabilities, Working Group Note, 2021.** Patrones 4.6.2, 4.2.4, 4.5.2 y 4.5.9: camino crítico con lo mínimo indispensable, ubicación/progreso comprensibles, volver sin perder trabajo y preservar avances frente a interrupciones. Es orientación complementaria, no requisito de conformidad WCAG. [Fuente](https://www.w3.org/TR/coga-usable/).

5. **W3C — WCAG 2.2.** Criterios relevantes: reflow a 320 CSS px (1.4.10, AA); foco visible y no completamente oculto (2.4.7 y 2.4.11, AA); objetivos de puntero de al menos 24 × 24 CSS px con las excepciones del criterio (2.5.8, AA); evitar entrada redundante (3.3.7, A); autenticación accesible (3.3.8, AA), incluida compatibilidad con gestores y copiar/pegar. Continuar tras reautenticarse sin perder datos es 2.2.5, AAA: no debe presentarse como obligación AA. [Fuente](https://www.w3.org/TR/WCAG22/).

6. **GOV.UK Service Manual — Using moderated usability testing.** Pide participantes reales o probables, tareas relevantes con metas claras que no revelen cómo completarlas, observación y lenguaje neutral. Las sesiones sirven para descubrir problemas al hacer tareas, no para recoger solamente aprobación de pantallas. [Fuente](https://www.gov.uk/service-manual/user-research/using-moderated-usability-testing).

7. **Rodden, Hutchinson y Fu — Measuring the User Experience on a Large Scale: User-Centered Metrics for Web Applications, CHI 2010.** Presenta HEART y un proceso de objetivos a señales y métricas. Sirve para diseñar medición vinculada a necesidades; no establece un umbral universal de activación ni demuestra que un cambio de interfaz cause retención. La ficha oficial y su resumen son accesibles; la descarga histórica del PDF no respondió en esta consulta. [Fuente](https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/).

## Cambios propuestos al plan: interpretación para este producto

### Un recorrido adaptable, no seis pasos obligatorios

Conservar un propósito claro y una acción principal en cada vista. Sustituir «si hay dos decisiones, son dos pantallas» por «separar cuando mejora comprensión; agrupar decisiones estrechamente relacionadas si los usuarios las resuelven mejor juntas». El plan dice seis pasos, pero convierte el segundo en cuatro pantallas móviles; el esfuerzo real no puede representarse únicamente con el número seis. Tampoco se propone reducir clics a cualquier costo.

Organizar el recorrido alrededor de resultados: comprobar una respuesta útil, preparar lo que esa respuesta necesita, conectar el canal elegido y comprobar su funcionamiento. El orden y las preguntas cambian según datos existentes, capacidades reales, plan y situación del canal. Una persona que ya trae un agente y un canal no debe recorrer la presentación otra vez. Conservar un resumen breve de lo hecho, lo que falta y el siguiente paso.

Antes de dibujar más tarjetas, hacer un protocolo de preguntas: qué dato pedimos, para qué resultado hace falta, qué ocurre si falta y quién necesita darlo. Nombre/persona, voz, estilo, foto, horarios, catálogo, FAQ y receptor humano no tienen por qué convertirse todos en casillas de paso obligatorio. El primer caso de uso define qué hechos necesita el agente.

### Valores sugeridos no equivalen a hechos confirmados

Separar tres estados: dato aportado por el negocio, sugerencia editable y desconocido. Un nombre o tono propuesto puede aceptarse fácilmente. Un precio, horario, domicilio, gratuidad de clase o política del negocio necesita un hecho verificable o confirmación explícita; no convertir «Usar así» global en confirmación implícita de todo.

Medir si la persona detecta y corrige una sugerencia que no representa su negocio. Poder modificarla no basta si no entiende que es una sugerencia. Mostrar un ejemplo de la respuesta que recibirá un cliente y comprobar si reconoce sus límites. Mantener desconocidos como desconocidos y resolverlos con la conducta de asistencia correspondiente.

### Revelar detalles sin esconder decisiones necesarias

Modo avanzado y funciones que no hacen falta para la primera tarea pueden quedar disponibles bajo demanda. Las condiciones que cambian la decisión —canal excluido del plan, quién recibe los casos humanos, si el enlace atiende clientes o solo permite probar, efecto de conectar un número— deben estar junto a su acción.

Reemplazar la regla literal de «nada más en pantalla» por ausencia de distracciones competidoras. Mantener ayuda encontrable y una salida clara; no ocultar un impedimento relevante para conservar una estética limpia. Evitar que cada campo tenga su propio «Ver más» y termine creando una búsqueda de información obligatoria.

La excepción debe quedar escrita en el plan: «cero banners» no autoriza esconder costos, límites de la prueba, condiciones del canal ni el efecto de una acción importante. Presentarlos en el momento y lugar donde afectan la decisión, sin multiplicarlos por todo el panel.

Revisar también D3: «rojo solo para regresiones» no distingue gravedad de antigüedad. Un fallo comprobado que impide atender puede ser grave desde el primer intento, sin haber funcionado antes. La severidad debe seguir impacto y certeza: pendiente esperado en tono neutral; estado desconocido como no comprobado; fallo comprobado con su consecuencia y acción. El color acompaña texto y estructura, no carga solo el significado. No declarar un fallo a partir de una comprobación que no pudo ejecutarse.

El progreso inicial «2 de 6» solo es honesto si representa trabajo realmente terminado y sus nombres describen ese resultado. Haber generado una receta no equivale a haber confirmado los hechos del negocio. Mostrar «cuenta creada» o «sugerencia preparada» cuando eso sea lo realizado; no otorgar crédito de configuración o activación antes de que ocurra. En rutas variables, un resumen de hitos puede ser más comprensible que un denominador fijo que cambia o esconde pantallas.

### Guardar y retomar es parte del camino principal

Probar que cambiar de aplicación para leer correo, abrir WhatsApp/Meta, atender a un cliente, cerrar una pestaña, volver atrás o perder temporalmente la red no obliga a empezar de nuevo. El estado guardado debe indicar si llegó al servidor; «Después» debe conservar lo que ya se sabe y llevar de vuelta al pendiente correcto. No prometer persistencia entre dispositivos con datos que solo existen en el navegador.

El límite de sesión puede seguir existiendo; el avance del negocio no debe depender de terminar antes del aviso. Distinguir progreso persistido de texto todavía sin guardar. El retorno desde un proveedor externo merece prueba específica en el mismo celular, no solo desde escritorio con dos ventanas.

### Accesibilidad móvil verificable

Ampliar «cabe a 390 px» a comprobación con 320 CSS px, zoom, teclado visible, orientación y lector de pantalla. Verificar que el control principal no quede bajo el teclado o un elemento fijo. Que una tarjeta se pueda tocar no reemplaza una etiqueta, un control reconocible y foco correcto.

Probar el recorrido con teclado y tecnologías de asistencia, incluyendo errores, confirmaciones y vuelta desde autenticación. Los tests automáticos de componentes son apoyo; no comprueban por sí solos el recorrido real ni permiten declarar conformidad completa.

## Umbrales del plan que deben quedar como hipótesis

| Umbral actual | Problema | Sustitución propuesta |
|---|---|---|
| Cinco FAQ por rubro | Cuenta contenido, no utilidad ni veracidad; puede obligar a completar respuestas irrelevantes. | Cubrir preguntas reales prioritarias del negocio y verificar respuesta con datos confirmados. Cinco puede seguir siendo un tamaño editorial inicial, no una puerta de activación. |
| Diez minutos hasta responder por un canal | Mezcla trabajo de la persona, espera de proveedor y llegada de clientes. No hay línea base aportada. | Mantenerlo como ambición interna. Medir tiempo activo y tiempo transcurrido por separado, con mediana y percentiles; segmentar por canal, requisitos y punto de partida. No prometerlo hasta comprobarlo. |
| Menos de tres minutos hasta chat de prueba | Es posible obtener una respuesta rápida y errónea o genérica. | Registrar primera respuesta de prueba y evaluar si fue útil, correcta y entendida. Velocidad junto a calidad y éxito sin ayuda. |
| Cambia como máximo dos de siete tarjetas | Pocas modificaciones pueden indicar buena receta, desconocimiento, miedo a tocar o asentimiento automático. | Pedir que detecte un dato incorrecto, lo cambie y explique qué responderá el agente. Contar cambios solo como diagnóstico. |
| Una persona por industria | Aporta un caso; no certifica toda una industria ni sus subtipos. | Investigar diversidad de habilidades, dispositivos y canales. Declarar qué grupos/rutas se observaron y cuáles no. |
| Seis pasos y cuatro tarjetas mínimas | Fija estructura antes de saber qué tarea necesita cada negocio. | Probar alternativas por tarea; eliminar obligaciones que no contribuyen al resultado. |

Estas sustituciones son propuestas para Parallly, no cifras derivadas de las fuentes.

## Protocolo inicial de investigación propuesto

Reclutar propietarios o personas que atienden el negocio y no configuran software profesionalmente. Seleccionar por comportamiento: cómo conectaron su canal actual, cómo recuperan una contraseña, si trabajan solo con celular y si necesitan ayuda al pasar entre aplicaciones. No usar la edad como sustituto de habilidad digital.

Como plan operativo inicial, hacer dos rondas cortas de seis a ocho participantes y corregir entre rondas. El tamaño es una decisión práctica para descubrir problemas, no una muestra representativa ni una garantía de encontrar todos los problemas. Incluir variedad de negocio, Android/iPhone, conectividad, accesibilidad y situación del canal. No repartir una persona en cada una de dieciocho industrias y llamar a eso validación de todas.

Tareas propuestas, con instrucciones que no nombran botones:

1. Preparar al asistente para responder una consulta frecuente de su propio negocio; observar qué entiende sin explicación previa del producto.
2. Corregir un dato deliberadamente equivocado en una sugerencia y comprobar qué pasa en la respuesta del agente.
3. Dejar el trabajo para atender una interrupción y retomarlo desde el celular.
4. Preparar su canal habitual o identificar el requisito que falta y saber cómo seguir después.
5. Distinguir una prueba de una atención real; explicar qué queda activo, dónde y quién recibe una consulta que el agente no resuelve.
6. Recuperarse de un error representativo sin perder los avances.

Registrar éxito independiente, éxito con ayuda, abandono, dato incorrecto aceptado, confusión sobre publicación/plan, fallos de recuperación y tiempo por tarea. La intervención del moderador se registra como ayuda. Una ronda de pensamiento en voz alta puede diagnosticar problemas, pero sus tiempos no son directamente comparables con uso natural silencioso.

No pasar a implementación amplia con errores graves abiertos como activar un dato falso, creer operativo un canal bloqueado o no poder recuperar el trabajo. Esta es una regla de decisión del producto propuesta, no un porcentaje científicamente certificado. Después de corregir, repetir las tareas afectadas con nuevos participantes.

## Medición de producto que complementa la prueba moderada

Separar cuatro resultados: entendió y probó; configuró un canal operativo; se entregó una respuesta real; obtuvo utilidad sostenida. Un wizard terminado no prueba ninguno de los dos últimos. La primera respuesta real entregada es un hito técnico útil, pero debe acompañarse de señales de calidad y del resultado buscado por el negocio.

Definir antes de instrumentar: denominador de altas, elegibilidad del canal, fecha de inicio, demo/prueba frente a cliente real, reintentos, errores, esperas externas, regreso tras pausa y datos faltantes. Mostrar tasas para todas las altas y para grupos comparables; no excluir silenciosamente a quienes abandonaron o aún esperan respuesta del proveedor.

Como hipótesis de seguimiento, observar actividad útil en ventanas de siete y veintiocho días: atención entregada y, según el caso de uso, cita/pedido/gestión humana completada. Diferenciar «no tuvo consultas entrantes» de «tenía consultas y el sistema falló». Medir confianza/comprensión mediante preguntas breves, no inferirlas de que el usuario pulsó Continuar. Estos eventos pueden registrarse sin conservar el texto de las conversaciones.

Un aumento tras lanzar el rediseño no demuestra causalidad: composición de clientes, marketing, estacionalidad y cambios de plan pueden variar a la vez. Empezar con línea base, cohortes comparables y evidencia cualitativa; considerar comparación controlada cuando haya volumen suficiente.
