# Onboarding Parallly — propuesta de experiencia v2

Fecha: 18 de septiembre de 2026. Estado: dirección y ajustes v2 aceptados por el usuario; pendiente de contraste con usuarios y concreción técnica por etapa. La aceptación no declara capacidades implementadas ni autoriza iniciar código antes del cambio de modelo que el usuario está evaluando. Hasta este punto solo se modifica documentación.

Esta propuesta actualiza la dirección de producto del [diseño v1.1](onboarding-experience-design-2026-09.md). El [diagnóstico técnico del 18 de septiembre](onboarding-review-and-completion-plan-2026-09-18.md) conserva la evidencia de lo construido y pendiente. La [hoja de decisiones](onboarding-decisions-2026-09.md) conserva las decisiones originales y su historia; las enmiendas propuestas están en §9 de este documento.

## 1. Dictamen: conservar la intención, cambiar el criterio de éxito

El plan anterior está bien orientado: personas sin conocimientos técnicos, ejemplos pertinentes, edición directa, cinco canales, prueba antes de Meta y continuidad entre configurar, mejorar y comprobar salud. La base técnica construida es aprovechable.

Su debilidad es que todavía organiza el éxito alrededor de terminar pantallas y aceptar recetas. Una persona podría completar seis pasos, aceptar cinco FAQ y ver una respuesta convincente, pero dejar un horario falso, no saber cuándo comenzó la atención o creer que el agente reserva cuando solo recoge una solicitud.

**Objetivo propuesto:** que una persona que atiende un negocio pueda comprobar una respuesta útil con sus datos, corregirla sin ayuda, ponerla a funcionar conscientemente en su canal y reconocer el primer resultado útil; después debe poder mantenerla con el mismo lenguaje y controles.

No se puede demostrar documentalmente cuál será el mejor onboarding para Parallly. Sí podemos mejorar la hipótesis, eliminar contradicciones y definir pruebas que distingan una experiencia agradable de una que realmente funciona.

Mantener tres experiencias relacionadas:

1. **Empezar:** comprender, probar y comenzar a atender.
2. **Cambiar y mejorar:** editar donde aparece la necesidad y comprobar el efecto.
3. **Entender cómo va:** capacidad, funcionamiento, resultados y siguiente mejora.

## 2. Investigación: qué sabemos y qué no

Se contrastaron documentación actual de productos comparables, casos publicados por sus proveedores, investigación de interacción humano–IA y guías de usabilidad/accesibilidad. Consulta: 18 de septiembre de 2026. No se contrataron productos ni se conectaron cuentas externas.

| Evidencia primaria | Hallazgo relevante | Aplicación propuesta y límite |
|---|---|---|
| [Tidio: configurar y probar Lyro](https://help.tidio.com/hc/en-us/articles/9003475527196-Lyro-the-conversational-AI-agent) | Permite probar y añadir una respuesta directamente desde la prueba antes de activar. | Elevar probar → corregir → repetir al centro del recorrido. La documentación prueba que existe el patrón, no su impacto causal en conversión. |
| [Intercom: desplegar Fin en chat](https://www.intercom.com/help/en/articles/8286630-deploy-fin-ai-agent-over-chat) | Separa preparación, pruebas y despliegue; contempla preguntas reales y una audiencia inicial limitada. | Comprobar respuestas y traspaso antes de ampliar atención. No trasladar al pequeño negocio toda su complejidad empresarial. |
| [respond.io: probar agentes](https://respond.io/help/ai-agents/how-to-test-ai-agents) | Distingue acciones simuladas de conversaciones y acciones reales. | Una prueba convincente no verifica entrega, cita o recepción humana. La interfaz debe explicarlo. |
| [Wati: Playground web](https://support.wati.io/en/articles/15434001-test-your-web-ai-agent-in-the-playground) | Permite probar sin número de WhatsApp. | Corregir la comparación histórica que decía que Wati obligaba a pasar por Meta para probar. Nuestra ventaja debe ser pertinencia y facilidad de corrección. |
| [Microsoft Research: interacción humano–IA](https://www.microsoft.com/en-us/research/blog/guidelines-for-human-ai-interaction-design/) y [Google PAIR: confianza](https://pair.withgoogle.com/chapter/explainability-trust) | Explicar capacidad y límites, facilitar corrección y control, ajustar la confianza a lo que el sistema realmente puede hacer. | Mostrar qué sabe, qué puede ejecutar y qué falta. No fabricar confianza mediante una demostración perfecta pero genérica. |
| [GOV.UK: estructura de formularios](https://www.gov.uk/service-manual/design/form-structure), [NN/g: revelación progresiva](https://www.nngroup.com/articles/progressive-disclosure/) | Organizar información alrededor de la tarea y mostrar complejidad cuando hace falta. | Una tarea clara por momento; no convertir cada campo en una pantalla ni esconder condiciones necesarias para decidir. |

### Casos de éxito que sí aportan, sin atribuirles más de lo que demuestran

- **Databox con Fin:** el caso reporta que la resolución pasó de 30% en diciembre de 2023 a 55% en marzo de 2025, acompañada de trabajo continuo en contenido, instrucciones y operación. Enseñanza: el valor continúa después de conectar. Es un resultado comunicado por el proveedor, sin experimento que aísle el onboarding. [Caso Databox](https://fin.ai/customers/databox).
- **Choices con Landbot:** publica una conversión del 9% de leads a citas y más de 230 propietarios gestionados en dos meses. El 9% es una tasa, no una mejora del 9%. Enseñanza: para una inmobiliaria el resultado relevante es una cita, no simplemente un mensaje. No hay control o línea base que permita atribuirlo al onboarding. [Caso Choices](https://landbot.io/case-studies/choices).
- **Investigación de NN/g:** un estudio de 2005 con 50 participantes comparó dos versiones de un sitio; entre participantes con menor habilidad lectora, el éxito de tareas pasó de 46% a 82% después del rediseño. Respalda probar lenguaje y estructura sencillos; no permite proyectar esa mejora a Parallly. Era otro país, idioma, dominio y época, y habilidad lectora no equivale a habilidad digital. [Estudio](https://www.nngroup.com/articles/writing-for-lower-literacy-users/).

La investigación específica de [canales](research/2026-09-18/onboarding-channel-evidence.md) y de [usabilidad y accesibilidad](research/2026-09-18/onboarding-usability-evidence.md) conserva fuentes, restricciones y escenarios. Las recomendaciones siguientes son síntesis para Parallly, no mandatos de esos proveedores.

## 3. El recorrido propuesto

Cuatro momentos comprensibles, con desvíos cortos según necesidad. Son un mapa mental, no cuatro pantallas obligatorias ni cuatro asistentes independientes:

**Tu negocio → Mira cómo atiende → Empieza por tu canal → Tus primeras conversaciones.**

### A. Tu negocio: pedir lo mínimo para una primera respuesta pertinente

Reutilizar lo que ya se obtuvo en el alta. Nombre, rubro y una situación concreta bastan para recomendar por dónde empezar. No preguntar al dueño por herramientas, embudos, prompts o arquitectura.

Revisar el recorrido desde registro, no solo el asistente posterior: el alta actual de empresa/audiencia/objetivos/plan más otro wizard no debe seguir siendo un peaje previo a la nueva experiencia. Unificar captura y progreso, mantener lo que autenticación y operación realmente necesitan y diferir lo demás. País y zona horaria se solicitan cuando afectan moneda, agenda o canal; no se adivinan como hechos. El prototipo debe incluir esta entrada para que la mejora no exista únicamente después de los formularios anteriores.

Ejemplo de recomendación para una academia: “Podemos empezar por responder sobre tu clase de prueba y ayudar a reservarla”. Ofrecer empezar o cambiar. Esta prioridad ordena el recorrido; no desactiva silenciosamente otras capacidades. Cambiarla después conserva los datos.

Conocer temprano el canal que ya usa el negocio para anticipar elegibilidad y límites del trial; la conexión externa viene después de demostrar valor. La preferencia expresada por el dueño pesa más que una recomendación por industria.

Las recetas proponen preguntas, tono, estructura y ejemplos. Para afirmar hechos hay tres procedencias visibles:

- **Nos dijiste:** dato aportado por la persona.
- **Encontramos:** dato extraído de web, foto, voz o conversación, pendiente de revisar cuando vaya a utilizarse.
- **Te sugerimos:** ejemplo que todavía no describe el negocio.

Solicitar únicamente los hechos que necesita la tarea actual. No sustituir un formulario largo por una revisión obligatoria de todo el negocio. Dirección, horarios, precios, servicios existentes, duración, disponibilidad, políticas y condiciones comerciales no se vuelven verdaderos por aceptar una plantilla. El tono sí puede tener un valor inicial útil.

Se puede escribir una frase, pegar información o usar una fuente disponible. Web, foto y voz son alternativas al mismo recorrido, no pasos acumulativos. Lo extraído se revisa mediante un resumen breve; no se aplica automáticamente como hecho confirmado. La experiencia básica debe funcionar sin sitio web ni documento.

### B. Mira cómo atiende: adelantar el primer resultado y la corrección

La primera respuesta llega con una pregunta real del negocio y los datos mínimos necesarios, antes de completar personalidad, cinco FAQ, cuatro tarjetas o conexión. Si solo conocemos ubicación, la prueba demuestra ubicación; no debe sugerir que ya puede reservar.

Junto a cada respuesta: **“Está bien” / “Cambiar esta respuesta”**. Al corregir, llevar al dato responsable: horario a horario, precio al servicio, política a política, respuesta frecuente a FAQ. Evitar guardar contradicciones en un prompt o duplicar el mismo precio en varios lugares. Después ofrecer repetir la misma pregunta y observar el cambio.

Mostrar explicaciones humanas: “Usó el horario que confirmaste”; no enseñar XML, puntuaciones técnicas o paneles de depuración al dueño.

Tres pruebas sugeridas, sin convertirlas en un examen obligatorio:

1. Una pregunta frecuente formulada como la haría un cliente, incluyendo variantes o errores.
2. Una pregunta cuya respuesta no conoce: comprobar que no inventa y sabe pedir ayuda.
3. Una tarea propia del resultado elegido: solicitar cita, consultar producto o dejar una solicitud para una persona.

La tercera prueba debe verificar el resultado de la acción en el entorno de ensayo, no solo una frase como “tu cita está reservada”. El simulador avanzado puede ampliar escenarios después. Antes de presentar cualquier superficie como “solo una prueba”, hay que comprobar que sus herramientas no generan citas, pedidos, pagos o avisos reales: que no persista la conversación no demuestra ausencia de efectos externos.

La revisión estática encontró una base reutilizable: Agent Test limita herramientas a lectores auditados y bloquea traspaso real; las simulaciones admiten determinados escritores en un esquema aislado, incluyendo citas y pedidos, pero no pagos. Por tanto, la prueba temprana de respuesta no se vende como comprobación de una reserva: la acción bloqueada figura como no ejecutada. Solo ofrecer resultado simulado para familias cubiertas y decir qué queda sin comprobar, como sincronización externa. Las pruebas consumen proveedor LLM y las simulaciones conservan resultados; “sin acciones sobre clientes” no significa “sin costo” ni “nada se guarda”. Fuentes locales: `agent-test-tool-policy.ts`, `agent-turn-adapters.ts`, `isolated-eval-namespace.ts` y `simulation.service.ts`.

### C. Empieza por tu canal: una decisión consciente, requisitos específicos

Mostrar los cinco canales certificados: WhatsApp, Instagram, Messenger, Telegram y chat web. Igualdad de elección no significa cinco conexiones requeridas ni idénticos permisos y tiempos. Email y SMS no entran como alternativas conversacionales equivalentes.

Para el canal prioritario mostrar lo que necesita esa ruta, las restricciones del plan y qué falta. El plan y los costos relevantes deben conocerse antes de invertir trabajo o habilitar gasto. Proponer comercialmente que el trial permita evaluar el canal preferido cuando sea viable; no modificar derechos existentes por una suposición de UX. La demostración interna no debería exigir decidir un plan antes de haber visto valor, si el contrato comercial permite ese orden.

WhatsApp requiere distinguir número nuevo, Business App, WhatsApp personal y otro proveedor. No prometer migración o coexistencia universal en diez minutos. Instagram Login admite cuenta profesional sin Página de Facebook según la [documentación oficial de Meta](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login); esto no certifica los permisos reales de la aplicación Parallly.

Separar permanentemente dos conceptos:

- **Cambios guardados:** la configuración quedó persistida.
- **Solo probando / Atiende clientes:** qué actividad está habilitada y dónde.

Mantener el guardado inmediato aprobado. La primera decisión consciente debe ocurrir exactamente antes de habilitar atención real. Si conectar ya enciende las respuestas, explicar antes: “Al conectar esta cuenta, Ana empezará a responder; los casos que no resuelva te llegarán aquí”. Un botón posterior “Empezar” sería engañoso. Si se implementa conectar sin atender, entonces sí puede existir una acción final separada. Después de activar, los cambios habituales siguen aplicándose al guardar.

El enlace público necesita el mismo contrato. Compartir una prueba, activar atención y tener derecho comercial a chat web son hechos diferentes. Un cambio de plan no debería transformar silenciosamente una prueba compartida en atención operativa. Propuesta: intención de uso explícita, elegibilidad por plan y estado operativo coherentes para cuotas, traspaso humano, salud y métricas. Es una modificación del comportamiento actual que debe diseñarse también para enlaces existentes sin interrumpirlos.

Hallazgo adicional del código: `widget-demo-link.ts:76` determina el uso de prueba por `features.widget`; el enlace público pasa por `processWidgetMessage` y persiste conversación. La marca demo controla cuota y traspaso, no garantiza aislamiento de herramientas. Por eso **el enlace público actual no debe describirse como el ensayo privado sin consecuencias**. Al implementar hay que escoger y mostrar un contrato inequívoco: vista de prueba realmente aislada, o canal que puede ejecutar acciones reales. Que sea compartible o tenga una franquicia no resuelve esa distinción. El agente predeterminado también puede cubrir un canal sin asignación explícita: omitir la asignación no sustituye un control efectivo de activación.

Mostrar al dueño como receptor humano inicial, con destino y disponibilidad comprensibles. No exigir un segundo usuario. Si todavía no está verificado el aviso, decirlo; tener un correo guardado no demuestra que alguien recibió el caso. En la comprobación operativa solicitada verificar Inbox/aviso y que la IA cede la conversación cuando corresponde.

### D. Tus primeras conversaciones: cierre técnico y comienzo del valor

Primero, ayudar a realizar una prueba real por el canal elegido y mostrar el hecho observado. Autorización OAuth, conexión y respuesta entregada son estados diferentes. Si solo se sabe que el proveedor aceptó el envío, no afirmar que el cliente lo leyó o recibió: cada canal necesita evidencia disponible y vocabulario equivalente.

La prueba del dueño verifica funcionamiento; no cuenta como un nuevo cliente o una venta. Luego acompañar las primeras conversaciones reales con una siguiente acción relevante: completar una respuesta que faltó, confirmar disponibilidad, responder un caso derivado o corregir una condición.

Si no llegan consultas, mostrar que aún no hay actividad y orientar cómo utilizar el canal o enlace. No confundir falta de tráfico con una avería ni generar conversaciones o mensajes sin iniciativa del dueño.

## 4. Qué significa estar preparado según la tarea

Conservar las condiciones básicas —agente habilitado, conexión utilizable, comportamiento cuando no sabe y receptor humano— y añadir solo los requisitos de la capacidad que se ofrece. No imponer una misión, batería de pruebas o cinco FAQ como obligación administrativa.

| Resultado ofrecido | Evidencia mínima adicional | Alternativa honesta si falta algo |
|---|---|---|
| Responder consultas | Información pertinente confirmada; respuesta verificable y salida ante lo desconocido | Recoger la consulta o pasarla a una persona |
| Recibir solicitudes comerciales | Datos que realmente necesita el negocio y destino responsable; solicitud guardada | Explicar qué información queda pendiente |
| Reservar | Servicio real, duración, zona horaria y disponibilidad/capacidad correctas según el motor; reserva registrada | “Recibe solicitudes de reserva”, sin anunciar confirmación automática |
| Tomar pedidos | Productos/variantes y condiciones vigentes; registro de pedido según capacidades reales | Cotización o solicitud pendiente, sin prometer compra completada |
| Cobrar | Proveedor del tenant, permisos y capacidad del plan habilitados; estado de pago comprobado | Solicitud o enlace pendiente, sin afirmar pago exitoso |

No añadir cobros al camino principal por defecto. Cada capacidad depende del código y los derechos vigentes; los ejemplos no amplían lo que el producto soporta. El texto debe poder decir “Ya responde ubicación; para reservar falta disponibilidad”. Evitar un único porcentaje “100% listo” que oculte estas diferencias.

## 5. Después del día 0: mismas reglas, información proporcional

**Editar:** mismas tarjetas y vocabulario, acceso directo desde una respuesta problemática, cambios guardados visibles, protección frente a ediciones concurrentes y posibilidad comprensible de recuperar un valor anterior. Assist es otra entrada para el mismo cambio; no un segundo almacén de configuración.

**Salud:** responder cuatro preguntas, con detalle por canal o capacidad al abrirlo:

1. ¿Está atendiendo y dónde? Estado comprobado y cuándo se verificó.
2. ¿Qué sabe y qué puede hacer? Hechos confirmados y limitaciones concretas.
3. ¿Qué está consiguiendo? Consultas, tareas y casos humanos, con resultado conocido o pendiente.
4. ¿Qué me conviene hacer ahora? Una mejora priorizada por evidencia e impacto.

El silencio del cliente no prueba resolución; una derivación enviada no prueba que una persona la atendió. Los estados inciertos deben seguir siendo inciertos.

**Interrupciones:** “Después” conserva avance y motivo por tarea/canal; retomar lleva al punto correcto, incluso tras correo, Meta, cierre de pestaña o cambio de dispositivo autenticado. Distinguir texto local de avance confirmado en servidor. No incluir tokens en enlaces de reanudación.

**Ruido y ayuda:** retirar promociones y paneles irrelevantes, manteniendo ayuda contextual voluntaria y avisos que cambian una decisión: costo, límite, error de guardado o efecto de activar. Ante un bloqueo persistente ofrecer una alternativa concreta y acceso a ayuda; no inventar disponibilidad o SLA de soporte.

**Alertas:** gravedad por impacto comprobado, no exclusivamente por si antes funcionaba. Un fallo grave nuevo también merece atención. Configuración pendiente es guía; “no comprobado” no equivale a fallo. No utilizar únicamente color para distinguir estados.

**Salud semanal D26:** conservarla en el alcance, con suscripción elegida por el dueño y contenido útil; canal WhatsApp sujeto a viabilidad, consentimiento, costos y capacidades reales. Email/push pueden ser alternativas explícitas, no una sustitución silenciosa de la decisión aprobada. No enviar un resumen vacío ni confundir un aviso programado con acompañamiento contextual.

## 6. Medición: demostrar utilidad, no premiar clics

Usar el enfoque objetivo → señales → métricas de [HEART, Google/CHI 2010](https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/). Las siguientes definiciones son propuestas propias para Parallly:

| Hito | Qué demuestra | Qué no demuestra |
|---|---|---|
| Primera respuesta útil en ensayo | Respuesta correcta y pertinente, evaluada con información conocida y comprensión del dueño | Canal real funcionando o todas las capacidades listas |
| Primera atención operativa comprobada | Entrada y respuesta por un canal con evidencia disponible; la prueba del dueño se identifica | Cliente adquirido, lectura o resultado comercial |
| Primer resultado útil de cliente real | Cita registrada, solicitud aprovechable, pedido u otra tarea verificable; resolución informativa con evidencia de calidad | Venta, pago o retención si todavía no ocurrieron |
| Utilidad sostenida | Negocio vuelve a obtener resultados en ventanas de 7 y 28 días | Efecto causal del rediseño sin comparación adecuada |

Métrica principal propuesta: **proporción de nuevos negocios que logran su primer resultado útil verificable dentro de siete días**, segmentada por tarea. Es una ventana inicial a contrastar, no un estándar demostrado. Acompañarla con quienes aún no recibieron tráfico y con resultados a 28 días; no excluir silenciosamente a esos negocios del total.

Antes de instrumentar, definir la evidencia por tarea: una reserva requiere registro válido, una solicitud requiere los datos necesarios y destino responsable, y una respuesta informativa requiere evaluación de exactitud/pertinencia o confirmación específica de resolución. Entrega, silencio o el botón “Está bien” en un ensayo no bastan. Cuando no exista evidencia de calidad, registrar “resultado no comprobado” y reportar también qué proporción pudo evaluarse. La marca de prueba debe venir del contexto conocido o identificación explícita; no inferir que todo visitante del enlace es cliente real. Una reserva registrada tampoco equivale a una cita asistida o venta cobrada.

Medir además:

- Éxito de configuración y corrección sin ayuda; éxito con ayuda por separado.
- Conversión entre hitos y abandono por causa, incluido proveedor, plan, dato faltante o problema técnico.
- Tiempo transcurrido total, tiempo activo y espera externa por separado; mediana y percentiles, contando pendientes y abandonos.
- Errores de hechos aceptados, reservas/pedidos incorrectos, derivaciones sin atención y comprensión equivocada de cuándo está en vivo.
- Esfuerzo de soporte y costo de prueba por negocio, sin trasladar al dueño contadores técnicos innecesarios.
- Cohortes por canal, dispositivo, situación inicial, tarea, idioma, plan y versión del recorrido. La habilidad digital se investiga con personas; no se infiere de edad o navegador.

Instrumentar hechos del servidor para entrega/acciones y eventos de interfaz para interacción; idempotencia y misma semántica de prueba/operación. No duplicar textos privados de conversaciones en eventos analíticos. Elegir denominadores antes del lanzamiento, mostrar todas las altas y cohortes comparables. No atribuir causalidad a una subida posterior si marketing, clientes o planes también cambiaron.

Las metas anteriores de tres minutos hasta prueba y diez minutos propios siguen como **hipótesis internas de velocidad**, junto con calidad y comprensión. Retirar la promesa universal de cliente atendido en diez minutos. Cinco FAQ y “cambió como máximo dos tarjetas” dejan de ser criterios de éxito.

## 7. Validación con usuarios antes de ampliar la implementación

Primero un prototipo navegable con contenido realista, estados de error y retorno; no diseñar solamente el camino exitoso. Evaluarlo con personas que atienden negocios y no configuran software profesionalmente. [GOV.UK: pruebas moderadas](https://www.gov.uk/service-manual/user-research/using-moderated-usability-testing) respalda observar tareas sin indicar los botones.

Propuesta operativa: dos rondas de seis a ocho participantes, corrigiendo entre ambas. Es un tamaño exploratorio para descubrir problemas, no una muestra estadística ni validación de las 18 industrias. Incluir personas que solo usan celular, sin sitio web, con un canal ya en uso, diferentes necesidades de accesibilidad y un negocio que no encaje en las recetas. Priorizar diversidad de comportamiento sobre repartir una persona por industria.

Tareas observadas:

1. Conseguir una respuesta para una consulta habitual de su propio negocio.
2. Observar si detecta un dato sugerido equivocado dentro de una tarea neutral, sin avisar de su existencia; después medir por separado la edición explícitamente solicitada y comprobar la nueva respuesta.
3. Interrumpir, cambiar de aplicación y retomar sin perder trabajo.
4. Preparar el canal habitual o reconocer el requisito que falta y cómo continuar.
5. Explicar con sus palabras si atiende clientes, qué puede prometer y quién recibe lo pendiente.
6. Recuperarse de un error, cambiar el resultado prioritario y encontrar luego la misma configuración.

No ampliar el despliegue mientras persistan errores graves de comprensión: publicar datos falsos, creer que atiende cuando no puede, o activar sin comprenderlo. Registrar la intervención del moderador como ayuda; los tiempos de una sesión pensando en voz alta no equivalen al uso natural.

Probar móvil, teclado, foco, zoom, lector de pantalla y regreso desde autenticación. Incluir ancho de 320 CSS px, teclado abierto y cambios de orientación, no solo una captura a 390 px. Referencias: [WCAG 2.2](https://www.w3.org/TR/WCAG22/) y [W3C, accesibilidad cognitiva](https://www.w3.org/TR/coga-usable/). No declarar conformidad por pasar una herramienta automática.

Después: piloto controlado con recorridos reales de los cinco canales, permisos válidos, retornos fallidos y handoff. La coexistencia de WhatsApp en un único celular y los números de prueba de Meta siguen pendientes de verificación directa; esta investigación no los certifica.

## 8. Orden recomendado de trabajo

| Etapa | Entregable concreto | Condición para avanzar |
|---|---|---|
| 0. Precisar experiencia | Prototipo del recorrido, hechos frente a ejemplos, prueba/atención y contrato de resultados; investigación con dueños | Entienden qué configura y qué está activo; se corrigen fallos graves observados |
| 1. Consolidar lo existente | Cierre verificable de ola 7; contrato coherente del enlace, receptor humano, estado real y eventos de ola 8 | El sistema no afirma resultados que aún no conoce; pruebas relevantes integradas a CI |
| 2. Primer recorrido completo | Un caso de negocio real: dato → receta aplicada → respuesta → corrección → canal → traspaso → resultado → salud mínima | Se observa de extremo a extremo y puede pausarse/retomarse |
| 3. Cubrir diversidad | Mismo contrato en cinco canales y distintas tareas; Otro, permisos, planes, idiomas y contenido por rubro | Matriz de recorridos reales y fallidos; calidad editorial comprobada, sin pretender certificar subtipos no probados |
| 4. Mejorar y ampliar entrada | Historial, foto, voz, simulación automática, Assist y resumen semanal | Reducen esfuerzo observado o mejoran resultado; no introducen hechos o acciones sin control |
| 5. Optimizar con uso real | Cohortes, calidad y resultados a 7/28 días; experimentos cuando el volumen lo permita | Mejora sin deteriorar comprensión, exactitud, recuperación o soporte |

Las etapas son orden de validación, no meses ni estimaciones cerradas. Contenido y verificación de proveedores pueden avanzar en paralelo. Foto o voz pueden adelantarse como alternativa de entrada si las pruebas muestran una reducción sustancial de esfuerzo; no es necesario construir ambas para validar el recorrido principal.

El primer recorrido completo es una forma de reducir riesgo de integración, no una renuncia al soporte de los otros canales. No declarar terminado el rediseño general hasta cubrirlos. No escribir todas las tarjetas y luego descubrir que sus datos nunca llegan a la persona que responde.

Conservar del plan técnico anterior: guardado inmediato, protección de versiones y caché, precios de ejemplo, una conexión por agente, gates por plan/rol, i18n en cuatro idiomas y actualización de Assist/documentación. La propuesta no autoriza migraciones, despliegues ni cambios a tenants existentes; esas acciones se concretarán en la implementación solicitada posteriormente.

## 9. Enmiendas propuestas a las 26 decisiones

El usuario aceptó estas enmiendas después de revisar v2. Esta tabla conserva la trazabilidad de las decisiones originales y no marca como realizadas funciones pendientes.

| Decisiones | Se conserva | Enmienda o precisión v2 |
|---|---|---|
| D1, D15 | Guardar aplica; revisión avanzada opcional | Diferenciar persistencia de primera habilitación de atención; decisión en el punto de efecto real |
| D2 | No exigir misión ni batería de pruebas para activar | Preparación por capacidad prometida; no equiparar cuatro checks a reservas/pedidos operativos |
| D3 | Pendiente de setup no es alarma | Gravedad por impacto; también un fallo nuevo puede ser crítico |
| D4 | Investigación acotada de número de prueba Meta | Sigue pendiente; no bloquea el ensayo interno/enlace ni se declara descartada |
| D5, D18 | Subtipos y salida para Otro | La receta organiza; no presume hechos o disponibilidad del negocio |
| D6 | Lenguaje del dueño | Añadir distinción comprensible entre guardado, prueba, atención y resultado |
| D7 | Quitar distracciones del día 0 | Mantener ayuda a demanda, límites/costos y avisos materiales en contexto |
| D8 | Continuar y recordar lo diferido | Guía según próximo resultado, incluso al completar esenciales sin respuesta comprobada |
| D9 | Generación asistida de Otro, validada | Primera versión útil sin esperar; incorporar después sin pisar cambios ni inventar hechos |
| D10, D17 | Ejemplos de precios separados y localizados | Extender procedencia/confirmación a otros hechos; no sembrar capacidades operativas como verdad |
| D11, D19 | Enlace temprano y franquicia de prueba | Contrato único de uso y derechos; pasar de prueba a atención debe ser comprensible y consciente |
| D12, D20 | Cinco canales e Instagram Login correcto | Preferencia real antes que orden por rubro; elegibilidad/trial temprano y retorno por dispositivo |
| D13 | Contenido cuidado por industria e idioma | Sustituir ≤2 tarjetas cambiadas por exactitud, comprensión y tarea lograda; cinco FAQ no es requisito |
| D14 | Mismas tarjetas al empezar y al editar | Recorrido adaptativo; corrección desde la respuesta hacia el dato canónico |
| D16 | Dueño receptor, equipo adicional opcional | Mostrar destinatario y verificar traspaso; corregir el cierre documental que lo confundía con asignación de canal |
| D21 | Aprovechar conversaciones reales cuando sea posible | Entrada opcional, revisión de hechos y permisos; coexistencia no garantiza importación universal a posteriori |
| D22, D23 | Foto y voz | Alternativas de captura con resumen revisable; prioridad ajustable por evidencia de esfuerzo |
| D24 | Ensayo con cliente simulado | No sustituye pregunta propia, comprobación de acciones ni prueba real de canal |
| D25 | Cambiar hablando con Assist | Mismo dato canónico y comprobación del efecto; no configuración paralela |
| D26 | Salud semanal por WhatsApp | Entrega útil elegida por el dueño, viabilidad comprobada y alternativas explícitas; continúa pendiente |

También se enmiendan reglas del diseño v1.1: seis pasos deja de ser arquitectura obligatoria; “una decisión por pantalla” pasa a una tarea clara por momento; “2/6” solo refleja trabajo efectivamente terminado; “0 banners” no oculta efectos materiales; diez minutos deja de ser promesa universal.

## 10. Definición de terminado

El onboarding está terminado cuando un dueño representativo puede, sin asistencia del equipo, conseguir una respuesta útil con sus datos, corregirla, entender qué queda activo, conectar o retomar su canal sin perder trabajo y comprobar el resultado que se le prometió. Puede encontrar después el mismo dato y comprender la salud del agente.

La certificación técnica requiere además que datos, persona servida, herramientas, cuotas, traspaso, estados y eventos coincidan; que los recorridos de los cinco canales y cuatro idiomas estén cubiertos según su disponibilidad real; y que tenants/enlaces existentes conserven un comportamiento correcto. El cierre técnico anterior sigue aplicando: pruebas relevantes, tipos, lint, compilación, migraciones en entorno de validación y comprobaciones de integración/proveedores según el cambio.

Ni 26 decisiones marcadas, ni una demo feliz, ni un número de tests aprobados reemplazan esa evidencia de uso.
