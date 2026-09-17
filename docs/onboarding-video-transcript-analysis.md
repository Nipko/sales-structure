> **Nota de verificación (16-sep-2026).** Los fotogramas del video se contrastaron con este transcript en `docs/onboarding-diagnosis-2026-09.md` §1.2 y `docs/onboarding-diagnosis-2026-09-workdir/video_v1-3.md`. Leerlo con estas correcciones: los tiempos de la segunda mitad van adelantados 1,5-2 min; el campo "Mensaje cuando no puede responder" venía prellenado (ella lo borró); las asignaciones de canal están en la misma página, debajo del panel de ayuda, no en otra pestaña; el aviso "Faltan datos obligatorios" es verde con un check, no rojo; la ventana de Meta no aparece en la grabación y hubo dos intentos fallidos (39:24 y 40:24); la pantalla compartida termina a las 41:00. Lo más grave del video no está aquí: a las 31:48 todo lo editado en el agente se había perdido en silencio (el agente vuelve a llamarse "Asistente").

# Transcripción Cronológica y Análisis de Fricción UX — Sesión de Onboarding Parallly

**Archivo de origen:** `parallly_onboarding.mp4` (Duración: 48 minutos 37 segundos)  
**Participantes:**
- **Nataly Álvarez:** Usuaria / Cliente real (representante de *Bogotá Dance Club* / Academia de Baile).
- **Germán David Ortiz:** Socio / Colaborador de Nataly.
- **Felipe Matallana P.:** Soporte / Asesor de Parallly (guía en vivo).
- **ParallExt Automation IA:** Soporte técnico adicional.

**Objetivo de la usuaria:** Configurar y poner en marcha su primer agente de IA comercial ("Geraldine") para atender consultas de clases de baile y conectar su canal de WhatsApp.

---

## Índice de Momentos y Línea de Tiempo

1. [00:00 - 01:10] La búsqueda de "Identidad" y la desorientación en el menú CRM
2. [01:11 - 03:30] Regreso al Asistente y saturación visual de advertencias
3. [03:31 - 06:30] La parálisis del mensaje de fallback ("¿A mi humano?")
4. [06:31 - 08:30] Selección de Tono y Extensión de respuestas
5. [08:31 - 13:30] El lienzo en blanco en "Instrucciones" (Redacción de prompt asistida)
6. [13:31 - 17:30] Reglas estrictas, temas prohibidos y handoffs
7. [17:31 - 21:00] Búsqueda infructuosa de las "Asignaciones de canal"
8. [21:01 - 24:30] Desasignación accidental de WhatsApp y pánico
9. [24:31 - 27:40] El dilema de las herramientas ("¿Es solo prender y apagar?")
10. [27:41 - 29:30] Bloqueo al guardar borrador (errores rojos)
11. [29:31 - 32:50] La pantalla de Inicio y la "Puesta en marcha" abrumadora
12. [32:51 - 40:48] El muro de Meta/Facebook y el abandono forzado

---

## Desglose Detallado Minuto a Minuto

### Momento 1: La búsqueda de "Identidad" y la desorientación en el menú CRM
* **Timestamp:** `00:00 - 01:10`
* **Pantalla visible:** `/admin/agent/[agentId]` ➔ Barra de búsqueda global ➔ `/admin/identity`
* **Transcripción clave:**
  > **Nataly (00:03):** *"Bueno, aquí voy a buscar Identidad porque no lo veo por ahí como la empresa..."*  
  > *(Nataly escribe "ident" en la barra de búsqueda y hace clic en el resultado "Identidad").*  
  > **Nataly (00:11):** *"Pero entonces tengo que abrir como otro para ir haciendo las dos cosas a la vez... ¡Ay, chanfle!"*  
  > *(Aparece la pantalla de `/admin/identity` con contadores en 0: "0 pendientes, 0 aprobados, 0 rechazados" y "Sin sugerencias pendientes").*
* **Diagnóstico de UX / Fricción:**
  - **Ambigüedad de nomenclatura:** Para la usuaria, "Identidad" significa "los datos de mi empresa y mi agente". Para el sistema, es la herramienta de deduplicación de contactos cross-channel de CRM.
  - **Pérdida de contexto:** La búsqueda global la sacó del flujo de configuración del agente y la mandó a una pantalla desértica y técnica. Tuvo que abrir otra pestaña o devolverse a ciegas.

---

### Momento 2: Regreso al Asistente y saturación visual de advertencias
* **Timestamp:** `01:11 - 03:30`
* **Pantalla visible:** `/admin/agent/[agentId]`
* **Transcripción clave:**
  > **Nataly (00:35):** *"Aquí qué costaba... no me acuerdo... no... ya me perdí..."*  
  > **Felipe (01:46):** *"Ahí en la pantalla anterior donde estabas, donde están las instrucciones... esa era como la ayuda, pero es como el paso a paso, pero abajo está lo que te está diciendo para hacer..."*  
  > **Nataly (02:18):** *"¿Ese es como el paso a paso que me lleva? ¿Y este también, este que veo aquí arriba? ¿Es lo mismo?"*  
  > **Felipe (02:26):** *"Sí, pero digamos que ese es como para cuando ya falta algo, sino que aquí apenas va a iniciar a darle la identidad al agente..."*
* **Diagnóstico de UX / Fricción:**
  - **Tres componentes compitiendo por atención:**
    1. `<AgentReadinessBanner>` (Rojo/Ámbar arriba): *"Hay una acción crítica que requiere atención..."*
    2. `<AgentAssessmentPanel>` (Violeta en el medio): *"Configuración incompleta: Faltan 4 dependencias..."*
    3. `<HelpPanel>` (Gris abajo): Cuadro gigante con 6 pasos de texto largo.
  - La usuaria no sabe qué es una ayuda, qué es un error crítico y qué es el formulario real. La frase *"ya me perdí"* resume el colapso de jerarquía visual.

---

### Momento 3: La parálisis del mensaje de fallback ("¿A mi humano?")
* **Timestamp:** `03:31 - 06:30`
* **Pantalla visible:** Formulario de Identidad del Agente (Campos: Nombre, Saludo, Fallback).
* **Transcripción clave:**
  > **Nataly (03:13):** *"Entonces, nombre del agente: ¿lo dejamos así, 'Asistente', o le ponemos un nombre real?"*  
  > **Nataly (03:28):** *"Nosotros tenemos el nombre: es Geraldine."*  
  > *(Nataly escribe "Geraldine" y luego edita el saludo: "Hola, soy Geraldine de TuBoleto.com y Bogotá Dance Club").*  
  > **Nataly (04:24):** *"Mensaje cuando no puede responder... ¿Mensaje cuando no puede responder el bot? ¿Cuándo no pueda contestar?"*  
  > **Felipe (04:34):** *"Cuando algo lo supere, cuando no sepa qué hacer y sea algo especializado..."*  
  > **Nataly (04:42):** *"Okay... entonces yo diría algo muy orgánico como: 'En este punto te voy a transferir a mi humano'... bueno, no sé..."*  
  > **Germán (04:51):** *"Ese paso no me lo sé..."*  
  > **Felipe (04:57):** *"Piénsalo... si estaban pensando que hablaban con Geraldine y le vas a decir 'un humano', dicen: '¡Uy, cómo así! Hasta ese momento pensaba que hablaba con Geraldine'. Algo más orgánico: 'Dame un momento, déjame validar'..."*  
  > **Germán (05:20):** *"Otra manera puede ser: 'En este punto te voy a transferir a otra persona de mi equipo más especializada'..."*  
  > **Nataly (05:40):** *"Exacto... te voy a transferir con alguien del área para que pueda asesorarte mejor..."*
* **Diagnóstico de UX / Fricción:**
  - **La trampa del campo en blanco:** La usuaria tuvo que adivinar la lógica de handoff y cómo redactar una respuesta de contingencia.
  - **Falta de opciones pre-redactadas:** En lugar de darle 3 opciones profesionales listas para elegir (*"Te comunico con un asesor especialista"*, *"Déjame validar con el equipo"*), el sistema la expuso a cometer errores de redacción (*"a mi humano"*).

---

### Momento 4: Selección de Tono y Extensión de respuestas
* **Timestamp:** `06:31 - 08:30`
* **Pantalla visible:** Selector de estilo de comunicación y longitud.
* **Transcripción clave:**
  > **Nataly (06:35):** *"Estilo de comunicación: ¿Empático o amigable? ¿Cuál te suena mejor?"*  
  > **Germán (06:45):** *"Empático."*  
  > **Nataly (06:49):** *"Extensión de respuestas: Define qué tan detalladas son las respuestas: estándar, detallado o conciso... A mí me gustaría conciso, pero no sé qué piensas tú..."*  
  > **Germán (07:05):** *"Sí, mantengámoslo conciso para que genere menos sospechas. La mayoría asociamos a que una respuesta muy extensa y entregada rápidamente es de un bot, no de un humano."*
* **Diagnóstico de UX / Fricción:**
  - Este fue uno de los pocos pasos donde la interfaz funcionó bien (tarjetas de selección visual rápida). Demuestra empíricamente que **cuando hay opciones visuales predeterminadas, los usuarios deciden rápido y sin estrés**.

---

### Momento 5: El lienzo en blanco en "Instrucciones" (Redacción de prompt)
* **Timestamp:** `08:31 - 13:30`
* **Pantalla visible:** Pestaña *Instrucciones* ➔ Campo abierto *Instrucciones principales*.
* **Transcripción clave:**
  > **Nataly (08:37):** *"Describe en lenguaje natural cómo quieres que se comporte tu agente... ¿Ahí sería el prompt?"*  
  > **Felipe (08:46):** *"Aquí es más lenguaje natural, no es un prompt y eso... como mira el ejemplo ahí: qué quiere que dirija, qué quiere que haga... puedes dejarlo en un solo texto o por líneas..."*  
  > **Germán (09:19):** *"Las indicaciones pueden ser tan sencillas como: 'Identifica el producto o necesidad del cliente, ofrece una solución compatible o escálalo a un agente especializado'..."*  
  > **Felipe (09:37):** *"Sí, sí, tal cual. Como para que entienda qué función cumple y qué es lo que va a poder resolver..."*  
  > *(Nataly pasa más de 3 minutos escribiendo lentamente en el textarea: "Eres nuestro asistente comercial, y recibes a los leads entrantes para ayudarlos a encontrar el servicio que se ajuste a sus necesidades, llevándolo a través de preguntas concretas, identificando sus objetivos, la ubicación de muestra sede, horarios, precios y llevarlo a agendar su primera clase. Allí lo transfieres al humano").*  
  > **Felipe (11:37):** *"En este punto, por ejemplo, ¿es solo para llevarlos hasta agendar? O sea, sí o sí al final van a que alguien se comunique con ellos..."*  
  > **Nataly (12:00):** *"Claramente el objetivo final es ese, que pueda hasta llegar a la venta, pero hay que validar al principio... o no sé si lo dejamos hasta la venta para probarlo todo..."*
* **Diagnóstico de UX / Fricción:**
  - **Fricción extrema:** Un dueño de negocio no debe redactar la lógica de ventas en un cuadro de texto vacío.
  - **Incertidumbre sobre el alcance:** La usuaria y su equipo dudan de qué poner, cómo estructurarlo y si el agente puede o no cerrar ventas directamente. Todo esto debió haber estado pre-estructurado según el arquetipo de academia de baile.

---

### Momento 6: Reglas estrictas, temas prohibidos y handoffs
* **Timestamp:** `13:31 - 17:30`
* **Pantalla visible:** Reglas y restricciones ➔ Temas prohibidos ➔ Cuándo pasar a un humano.
* **Transcripción clave:**
  > **Nataly (14:46):** *"Protecciones de seguridad siempre activas: estas restricciones cumplen con políticas de OpenAI... súper. Reglas y restricciones estrictas..."*  
  > **Felipe (15:37):** *"Aquí toda esta configuración es cómo ustedes lo están manejando: qué quieren que sí o sí pase antes de... por ejemplo, pedirle los nombres, correo, teléfono... por ejemplo, en mi caso de asesoría financiera yo les pregunto cuánto venden al mes y cuánta gente tienen contratada... esas preguntas para mí son clave..."*  
  > **Nataly (16:43):** *"Temas prohibidos: precios no confirmados, promesas de entrega sin verificar, información confidencial..."*  
  > **Nataly (17:42):** *"Cuándo pasar a un humano: reclamo, queja formal, solicitud compleja, cliente insatisfecho, hablar con una persona... ¿Él identifica que es un reclamo o simplemente como que pone la palabra?"*  
  > **Felipe (18:02):** *"Él entiende lo que está tratando de hacer, no la palabra exacta... Si dice 'páseme a su jefe', él entiende eso y lo va a lanzar a un humano..."*
* **Diagnóstico de UX / Fricción:**
  - **Sobrecarga de conceptos abstractos:** La separación entre "Instrucciones", "Reglas estrictas", "Temas prohibidos" y "Traspaso a humanos" fragmenta una sola necesidad: *¿Qué hace mi bot y cuándo me avisa?*
  - El usuario debe revisar listas interminables de 15 elementos preconfigurados en acordeones densos.

---

### Momento 7: Búsqueda infructuosa de las "Asignaciones de canal"
* **Timestamp:** `17:31 - 21:00`
* **Pantalla visible:** Pestaña *Instrucciones* ➔ Scroll vertical errático buscando dónde ejecutar lo que dice el panel de ayuda.
* **Transcripción clave:**
  > **Nataly (19:44):** *(Leyendo el texto de ayuda)* *"Arriba, prepara las asignaciones del canal y el estado que quieres publicar, guarda el borrador, pruébalo, prepara la revisión... ¿Arriba? No sé si será aquí... no sabría dónde está esa parte guiándome de estos pasitos..."*  
  > *(Nataly scrollea hacia arriba, luego hacia abajo, mira la cabecera, mira las pestañas, sin encontrar a qué se refiere con 'arriba').*  
  > **Felipe (21:18):** *"Sigue donde estabas configurando el agente... baja un poco... ahí en la primera pestaña de Persona..."*
* **Diagnóstico de UX / Fricción:**
  - **Instrucciones desfasadas de la UI:** El panel de ayuda le decía "Arriba, prepara las asignaciones", pero las asignaciones estaban en otra pestaña oculta bajo un hero colapsado.
  - La usuaria quedó desorientada buscando controles que no correspondían con su pantalla actual.

---

### Momento 8: Desasignación accidental de WhatsApp y pánico
* **Timestamp:** `21:01 - 24:30`
* **Pantalla visible:** Sección de Asignación de Canales (Chips de canales: WhatsApp, Instagram, Messenger, Telegram, Chat web).
* **Transcripción clave:**
  > **Felipe (21:28):** *"Ve ahí donde dice asignación de canales, ahí están los 4 o 5 canales... si no quieres que atienda en alguno, le das para que lo quite..."*  
  > *(Nataly hace clic sobre el chip de WhatsApp).*  
  > **Nataly (21:36):** *"¡Ay! ¿Ahí la quité? ¿O qué hice al oprimirla? ¡Ay no! Pensé que era acá abajo donde decía 'Quitar del borrador'..."*  
  > **Felipe (21:43):** *"No pasa nada, no pasa nada... ahí solo lo quitó... recuerda que en cualquier momento puedes volver a cambiar la configuración..."*  
  > **Nataly (22:24):** *"Ahí le doy guardar para que no se me vaya a borrar..."*
* **Diagnóstico de UX / Fricción:**
  - **Falta de affordance y seguridad:** Los botones de canales actúan como toggles destructivos sin confirmación ni indicación visual clara de su estado activo/inactivo.
  - Provocó un micro-infarto en la usuaria pensando que había roto la conexión.

---

### Momento 9: El dilema de las herramientas ("¿Es solo prender y apagar?")
* **Timestamp:** `24:31 - 27:40`
* **Pantalla visible:** Pestaña *Herramientas* (Toggles: Catálogo de productos, Políticas, Preguntas frecuentes, etc.).
* **Transcripción clave:**
  > **Nataly (25:00):** *"Habilidades del agente: ventas, soporte, ambos... en este caso sería ventas..."*  
  > **Nataly (25:31):** *"Catálogo de productos: consultar productos, precios y stock en tiempo real... es decir, esto es lo que el agente va a tener a la mano para hablar con las personas... ¿Y si yo le doy aquí, cómo lo configuro? ¿Es solamente como prender o apagar para luego en otro lado meter la información?"*  
  > **Felipe (26:08):** *"Sí, así es... no significa que ya vaya a configurar todo esto, sino que luego cada uno de estos tiene que configurarse..."*  
  > **Nataly (26:57):** *"Muy genérico, ¿verdad? Esto es como generalidades..."*
* **Diagnóstico de UX / Fricción:**
  - **El gran desencanto del usuario:** La usuaria creía que al prender "Catálogo de productos" se le abriría un formulario para cargar sus clases de baile y precios. Al enterarse de que solo es un interruptor conceptual y que luego le toca ir a otra pantalla distinta, se desinfla la expectativa.

---

### Momento 10: Bloqueo al guardar borrador (errores rojos)
* **Timestamp:** `27:41 - 29:30`
* **Pantalla visible:** Botón "Guardar borrador" ➔ Notificación de error en rojo.
* **Transcripción clave:**
  > **Nataly (27:46):** *"Listo, guardar... okay... Faltan datos obligatorios para guardar. Revisa los campos marcados en rojo..."*  
  > *(Nataly se queda desconcertada buscando qué campo quedó en rojo después de 25 minutos de trabajo).*
* **Diagnóstico de UX / Fricción:**
  - **Feedback punitivo:** Después de media hora llenando información, el sistema no autoguarda y arroja un mensaje de bloqueo sin llevarla automáticamente al campo que falta.

---

### Momento 11: La pantalla de Inicio y la "Puesta en marcha" abrumadora
* **Timestamp:** `29:31 - 32:50`
* **Pantalla visible:** `/admin` (Página de Inicio del Dashboard).
* **Transcripción clave:**
  > **Felipe (30:00):** *"Colócalo en Inicio... siempre te va a dar como en dónde estás..."*  
  > *(Se carga el Dashboard con la tarjeta 'Puesta en marcha' llena de tareas incompletas y un banner rojo arriba).*  
  > **Felipe (30:21):** *"Ahí te está diciendo todo lo que hace falta, las recomendaciones... te dice que conectes el canal... la idea es dejarlos todos en verde para que quede de la mejor forma..."*  
  > **Nataly (30:52):** *(Con tono de agobio)* *"O sea, tendría que trabajar en todos estos..."*
* **Diagnóstico de UX / Fricción:**
  - **Sensación de tarea interminable:** La usuaria pensó que ya había terminado al configurar a Geraldine. Al llegar al Home, ve 8 tareas pendientes con botones *"Continuar"* y *"Mostrarme dónde"*. Siente que no ha avanzado nada.

---

### Momento 12: El muro de Meta/Facebook y el abandono forzado
* **Timestamp:** `32:51 - 40:48`
* **Pantalla visible:** `/admin/channels` ➔ `/admin/channels/whatsapp` (Modal de conexión con Meta).
* **Transcripción clave:**
  > **Nataly (33:45):** *"Canales... voy aquí a configurar WhatsApp... Elige tu método de conexión: WhatsApp Business App, Número nuevo, Migrar desde otro proveedor... pero pide las tres: verificación por SMS, acceso a Facebook y el QR... Ay, ¿sabes cuál es la cosa? Que este WhatsApp no está abierto aquí en esta computadora..."*  
  > **Germán (36:40):** *"No está abierto en ningún lado porque es una cuenta API..."*  
  > *(Intentan conectar con Facebook, sale la ventana emergente de Meta).*  
  > **Nataly (39:18):** *"Esperando autorización..."*  
  > **Felipe (40:26):** *"Bueno, parece que hay un error ahí... entonces probablemente no lo va a poder conectar... lo voy a revisar..."*  
  > **Germán (40:48):** *"Por agendita ahorita nos toca movernos... creo que fue apenas el avance hasta ahí..."*  
  > **Nataly (41:18):** *"Muchas gracias... bye..."*  
  > *(Fin de la sesión).*
* **Diagnóstico de UX / Fricción:**
  - **48 minutos perdidos:** La sesión terminó sin que el agente respondiera un solo mensaje y sin que WhatsApp quedara conectado.
  - **Dependencia externa crítica al final:** Llegar al paso de Meta sin haber validado el bot en un simulador hace que cualquier fallo de credenciales o de SIM card destruya por completo la satisfacción del usuario.

---

## Matriz Resumen de Fricciones Identificadas en el Video

| Momento | Causa Raíz en el Código / UI | Frase Textual del Usuario | Solución en el Modelo LEGO |
| :--- | :--- | :--- | :--- |
| **00:03** | Ambigüedad entre Identidad del Agente e Identidad CRM. | *"Voy a buscar Identidad... pero tengo que abrir otro para hacer las dos cosas a la vez... chanfle."* | El wizard es un flujo cerrado sin buscador global visible; la identidad del agente está precargada. |
| **00:35** | 3 banners compitiendo simultáneamente (Readiness, Assessment, Help). | *"No... ya me perdí..."* | **Cero banners técnicos en Día 0.** Ni estados de borrador, ni assessments de salud en rojo. |
| **04:24** | Campo de fallback vacío sin plantillas. | *"¿Mensaje cuando no puede responder el bot? Te voy a transferir a mi humano..."* | Respuestas sugeridas listas para elegir con 1 clic según el arquetipo del negocio. |
| **08:37** | Textarea de instrucciones/prompt vacío. | *"¿Ahí sería el prompt? ... (Germán dictando durante 3 minutos)"* | **Zero prompting.** El prompt base se inyecta desde la vertical. Cero redacción desde cero. |
| **21:36** | Chips de canales actúan como toggles sin affordance ni confirmación. | *"¡Ay! ¿Ahí la quité? ¿O qué hice al oprimirla? ¡Ay no!"* | Selectores claros con estado explícito y confirmación no destructiva. |
| **25:31** | Herramientas son solo toggles que no permiten cargar datos. | *"¿Es solamente prender o apagar para luego en otro lado meter la información? Muy genérico..."* | La pieza LEGO incluye el toggle Y los 3 servicios con sus precios en la misma tarjeta. |
| **27:46** | Guardado manual que bloquea con mensajes de error genéricos. | *"Faltan datos obligatorios para guardar..."* | **Autoguardado silencioso reactivo.** El botón principal siempre avanza de paso. |
| **30:52** | El Dashboard muestra 8 tareas pendientes tras salir del editor. | *"O sea, tendría que trabajar en todos estos..."* | Dashboard muestra **solo la Estación de Continuación** con 1 botón directo para reanudar. |
| **39:18** | Conexión de Meta obligatoria para probar el bot. | *"Esperando autorización... error... por agenda nos toca movernos..."* | **Sandbox First:** Prueban el bot en chat en vivo en el minuto 5; Meta queda como paso final diferible. |
