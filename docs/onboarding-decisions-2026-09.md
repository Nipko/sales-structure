# Onboarding: qué queda de las ideas anteriores, qué ideas nuevas traemos y la hoja de decisiones

> Complementa `docs/onboarding-experience-design-2026-09.md` (el diseño) y `docs/onboarding-diagnosis-2026-09.md` (la evidencia). Este documento existe para que el dueño decida de una vez: cada decisión está en modo de opciones, con la recomendación y la consecuencia de cada camino.

---

## 1. Las ideas del agente anterior: qué queda, qué cambia, qué se descarta

El documento `docs/onboarding-ux-benchmark-and-video-audit.md` tenía la intuición correcta (armar piezas, cero prompts, probar antes de Meta, estación de reanudación, superpoderes en un clic). Lo que se hizo con cada idea:

| Idea del agente anterior | Qué pasó con ella | Por qué |
|---|---|---|
| **Modelo LEGO**: piezas prefabricadas, decisiones A/B, cero redacción | **Queda**, convertida en la "anatomía de un paso" (pregunta + por qué + ejemplo completo + Usar así/Cambiar + sugerencias + victoria) | Es el corazón del diseño; se le agregó lo que le faltaba: el por qué en una línea, la consecuencia del "Después" y la victoria honesta |
| **Pieza 1: identidad y voz** con 3 arquetipos y 3 opciones de fallback | **Queda** como paso 3 "Conoce a {Nombre}"; los arquetipos son las tarjetas de tono que ya existen (en el video se resolvieron en 20 s); las 3 opciones de "cuando no sabe" van en la receta | Los referentes confirman que elegir entre opciones funciona y escribir no |
| **Pieza 2: catálogo precargado con precios** | **Cambia**: los servicios se precargan, pero un precio de ejemplo **nunca se confirma con "Usar así"** ni lo dice el agente | La revisión encontró que hoy los precios sembrados son precios reales para el motor de reservas: el agente los citaría a un cliente |
| **Pieza 3: las 5 dudas clave** con corchetes | **Queda y se amplía**: respuestas con espacios `[ ]`, listas canónicas por familia de negocio (no una sola lista para todos) y la regla "un espacio sin llenar no cuenta" | La lista fija (ubicación, pagos, horarios, reserva, cancelación) no sirve igual a una inmobiliaria que a un restaurante |
| **Pieza 4: horario por defecto + WhatsApp del asesor** | **Queda**: horario típico del rubro y "¿a quién le avisa?" con la persona del alta por defecto | La revisión detectó que el diseño lo había perdido; se restauró |
| **Pieza 5: simulador sandbox con chips de prueba** | **Queda y sube**: el chat de prueba con 3 chips está en el paso 3, no en el 5, y además el agente tiene desde ese momento **su propio enlace real** para compartir | Un simulador es una prueba; un enlace es un canal. Y llega antes del muro de Meta |
| **Cierre: conectar WhatsApp o dejarlo para después** | **Cambia**: no es "WhatsApp o después", es "¿por dónde te escriben?" con los **cinco canales** y "después" por canal | El dueño lo pidió explícitamente; y la usuaria del video era Instagram-first |
| **Estación de reanudación** (60 %, faltan 5 min, continuar) | **Queda** como "Continuar donde quedaste (paso 4 · 5 min)" en Inicio, con lo diferido y su tiempo | Confirmado por la evidencia (progreso dotado, Shopify) |
| **Día 2: superpoderes en un clic** | **Queda** como "recetas de mejora" por rubro con el mensaje ya escrito | Coincide con el patrón de plantillas de los referentes |
| **Cero banners técnicos en día 0** | **Queda y se endurece**: cero superficies (ni prueba gratuita, ni instalar app, ni mascota, ni KPIs) mientras la etapa no sea "en vivo" | El video muestra 5-9 superficies por pantalla |
| **20 minutos como meta** | **Cambia a 10 minutos propios** y el "aha" en el paso 3 | Los referentes ponen la primera respuesta en el minuto 3-5 |
| **Endpoint `quick-setup` y reemplazar el asistente** | **Se descarta como plan técnico** | Ignoraba que el asistente de 3 pasos, la tarjeta y los recorridos ya existen, y que el bloqueo real es la capa de borradores del 7-sep |
| **Cifras de referentes** (72 % Tidio, 60 % Wati, 85 % Calendly, 89 % Duolingo) | **Se descartan** | Sin fuente; la de Duolingo está contradicha; Wati no permite probar sin Meta |
| **Lección Gorgias**: auditar las conversaciones reales para prellenar las 5 dudas | **Queda y se vuelve una idea propia** (ver §2, "Lo que ya te preguntaron") | Es la única de sus lecciones que nadie más en LatAm puede copiar fácil, porque nosotros importamos el historial |
| **Lección Kommo**: el embudo se alimenta solo y el dueño percibe retorno | **Queda para el después**: la tarjeta de salud muestra "reservas" y "pasadas a persona", no solo mensajes | No es del día 0 |

---

## 2. Ideas nuevas para que la experiencia sea única

Todas reutilizan algo que ya existe en la plataforma; ninguna exige construir un motor nuevo. Marcadas con la ola en la que caben.

1. **"Lo que ya te preguntaron" (ola 2).** Cuando el número entra por coexistencia, la plataforma ya importa hasta seis meses de chats. Antes de mostrar las 5 preguntas del rubro, las sacamos de **sus propias conversaciones**: las preguntas que más le hicieron y cómo respondió, con sus palabras y sus precios. Quien no tiene coexistencia puede pegar tres chats. Nadie en LatAm prellena el agente con la voz real del negocio. Reutiliza: migración de historial, detección de huecos de conocimiento, extracción estructurada con validador.
2. **Foto de la lista de precios o del menú (ola 2).** Una foto de la carta, del tablero de precios o del PDF de servicios y los ítems aparecen como "detectados", con precio, para confirmar tocando. Lo mismo con la foto del horario de clases (la usuaria del video tenía dos pestañas de "Horario Clases Grupales" abiertas). Reutiliza: procesamiento de imágenes con visión que ya existe para los mensajes.
3. **Cuéntalo con una nota de voz (ola 2).** En el paso 1, en vez de escribir la frase del negocio, un botón de micrófono: 60 segundos hablando y la receta se arma desde la transcripción. Es la forma natural de comunicarse en LatAm. Reutiliza: transcripción de audio que ya existe para los mensajes entrantes.
4. **Ensayo con un cliente de mentira (ola 2).** En el paso 3, además de los chips, un botón "Mira cómo atendería a Laura": la plataforma simula a una clienta típica del rubro (quiere clases de salsa los sábados, pregunta precio y dónde) y muestra la conversación completa de cinco turnos como una historia. La persona ve el resultado antes de tocar nada y corrige lo que no le gusta. Reutiliza: el módulo de simulación y las personas sintéticas que ya existen para las pruebas.
5. **"Así no lo diría yo" (ola 2).** Debajo de cada respuesta del chat de prueba, un botón que abre "escribe cómo lo dirías tú"; lo que escribe se convierte en la pregunta y respuesta de la receta. Es el bucle "enséñale" de Chatbase y Tidio, pero en el día 0, no después. Reutiliza: creación de FAQ desde una conversación.
6. **El enlace de {Nombre} como tarjeta de presentación (ola 3).** El enlace público del agente con un botón "Mostrárselo a mi socio" que abre WhatsApp con el mensaje escrito ("Mira cómo responde Valentina: {enlace}") y un botón "Ponerlo en mi bio de Instagram". Es el canal que existe antes que cualquier otro y el que permite vender la idea adentro del negocio. Reutiliza: el widget web.
7. **Cambiar hablando (ola 4).** En "Mejorar a {Nombre}", un campo "Dime qué cambiar" ("que no ofrezca descuentos", "que atienda los domingos", "que pregunte la edad antes de la clase de prueba") y Assist propone el cambio en la tarjeta correcta para confirmar con un toque. Reutiliza: el sistema de propuestas de configuración construido el 7-sep, que hoy vive escondido detrás de "Definir misión".
8. **Salud por WhatsApp al dueño (ola 4).** Una vez por semana, un mensaje de una línea al WhatsApp del dueño: "Valentina atendió a 31 personas, reservó 6 clases y no supo responder 3 preguntas: tócame para enseñarle". El panel de salud viene a la persona, no al revés. Reutiliza: alertas por WhatsApp de la plataforma.
9. **Precio con un toque desde el chat de prueba (ola 2).** Cuando el agente responde "el valor exacto te lo confirmo", debajo aparece "Respondió así porque no pusiste el precio de la mensualidad: [$ ____] Guardar". El precio se confirma sin salir del chat.
10. **Progreso dotado honesto (ola 2).** El recorrido arranca en "2 de 6" porque el alta y la receta ya cuentan, y cada paso dice qué ya puede hacer el agente en vez de mostrar un porcentaje.

---

## 3. Hoja de decisiones (en modo de opciones)

Responde con la letra por decisión (por ejemplo, "D1 A, D2 A, D3 B…") o con "todas las recomendadas". Las recomendadas están marcadas con ★.

### A. El día 0 y el agente vivo

**D1 — ¿Dónde escribe el día 0?**
- **A ★** Directo en el agente que atiende, mientras la etapa sea anterior a "en vivo" y no haya conversaciones reales (regla del servidor con revisión de origen "onboarding"). *Consecuencia:* lo que la persona escribe se ve al instante; cero vocabulario de borradores en el día 0.
- **B** Siempre en borrador, pero con un botón único "Publicar ahora" al final de cada paso. *Consecuencia:* un clic más por paso y el concepto "publicar" vuelve al día 0.
- **C** Como hoy (borrador + candidato + revisión + publicación). *Consecuencia:* se repite el video con mejor copy.

**D15 — ¿Y después del día 0, cuando ya hay clientes reales?**
- **A ★** Cambiar sigue siendo inmediato; la revisión con pruebas es un modo "Avanzado" que se activa a voluntad. *Consecuencia:* la tubería del 7-sep se conserva para quien la quiera; hay que quitar la regla "reactivar exige publicar".
- **B** Inmediato para textos (saludo, precios, preguntas) y "Publicar ahora" de un botón para cambios de comportamiento (reglas, herramientas). *Consecuencia:* dos caminos que hay que explicar.
- **C** Revisión obligatoria cuando hay conversaciones reales. *Consecuencia:* "cambiar es tocar" deja de ser cierto al tercer día.

**D2 — ¿La misión y las pruebas cuentan para "listo para atender"?**
- **A ★** No: pasan a "mejorar después". "Listo" solo mira lo verificable (encendida, canal, sabe qué decir cuando no sabe, alguien recibe). *Consecuencia:* un agente de plantilla ya no nace "pendiente".
- **B** Cuentan, pero la receta las deja llenas y marcadas como listas. *Consecuencia:* hay que escribir misión y escenarios de prueba para las 38 recetas.
- **C** Como hoy. *Consecuencia:* todo agente nuevo se reporta "no está listo".

**D3 — ¿Qué se muestra en rojo?**
- **A ★** Solo regresiones: algo que funcionaba dejó de funcionar (canal caído, credencial vencida, agente apagada). El setup incompleto es guía, no alarma. *Consecuencia:* hay que guardar el último estado bueno por canal.
- **B** Rojo también para setup incompleto, pero solo dentro del panel de salud, nunca como banner. *Consecuencia:* más simple de construir; la persona ve rojo en su primera visita al panel.
- **C** Como hoy (banner rojo en todas las páginas desde el minuto uno).

**D8 — ¿Qué muestra la tarjeta de Inicio durante el día 0?**
- **A ★** Solo lo que quedó en "Después", con su tiempo, y "Continuar donde quedaste". *Consecuencia:* Inicio no compite con el recorrido.
- **B** Los 3-4 esenciales siempre, con el siguiente expandido. *Consecuencia:* una lista fija que algunos ya completaron.
- **C** Los 8-10 ítems actuales.

**D7 — ¿Cuánto puede interrumpir la plataforma en el día 0?**
- **A ★** Nada: ni banner de prueba, ni "Instalar Parallly", ni mascota, ni KPIs, ni ayuda lateral, hasta que la etapa sea "en vivo". *Consecuencia:* hay que gatear cuatro componentes globales por etapa.
- **B** Solo se quitan las superficies de calidad (banner rojo, paneles de versión y misión); el resto se queda. *Consecuencia:* siguen 4-5 superficies por pantalla.

**D16 — ¿Quién recibe los chats que el agente pasa, por defecto?**
- **A ★** La persona del alta, por correo, y por WhatsApp si lo da; "invitar a alguien más" queda para después. *Consecuencia:* la promesa "te paso con una persona" siempre tiene destinatario.
- **B** Nadie hasta que invite a alguien. *Consecuencia:* el agente promete algo vacío el primer día.
- **C** Obligar a invitar en el día 0. *Consecuencia:* un paso más y una dependencia externa (que el otro acepte).

### B. Recetas, ejemplos y contenido

**D10 — ¿Qué pasa con los precios de ejemplo?**
- **A ★** Cada precio tiene estado (ejemplo / confirmado / a cotizar); "Usar así" nunca confirma un precio; el agente no dice precios de ejemplo y ofrece confirmarlos. *Consecuencia:* una columna nueva y cambio en dos herramientas; la promesa "no inventa" se cumple.
- **B** El agente dice el precio de ejemplo con la frase "valor de referencia, te lo confirmo". *Consecuencia:* más fluido, pero un cliente puede tomarlo como precio real.
- **C** No hay precios de ejemplo: todo nace en blanco. *Consecuencia:* la tarjeta pierde el "ya está casi hecho".

**D5 y D18 — ¿Dónde viven las academias (baile, música, arte, deporte) y qué pasa con "Otro"?**
- **A ★** Subtipos de `education` con agenda encendida y clase de prueba; "Otro" pregunta en vez de sembrar y genera la receta. *Consecuencia:* reutiliza la reserva de clases que ya existe.
- **B** Nueva industria "Academias y clases". *Consecuencia:* persona, embudo y KPIs nuevos; más trabajo.
- **C** Dejarlas en "Otro" con receta generada. *Consecuencia:* pierden la agenda determinista que falló en el video.

**D9 — ¿Cómo se arma la receta de un negocio que no encaja en las 18 industrias?**
- **A ★** El modelo la genera en segundo plano a partir de una frase (o una nota de voz), con esquema sin precio/dirección/teléfono y un validador que rechaza datos inventados. *Consecuencia:* costo de dos generaciones por tenant, pagado por la plataforma.
- **B** Receta genérica fija y la persona llena las tarjetas a mano. *Consecuencia:* "Otro" vuelve a ser la hoja en blanco.
- **C** Obligar a elegir una de las 18. *Consecuencia:* recetas equivocadas para rubros que no calzan.

**D13 — ¿Quién escribe las recetas (≈1.000 textos en español, ≈4.000 con idiomas)?**
- **A ★** El equipo escribe las 6 industrias de más demanda en español; se validan con un dueño real por industria en una sesión de 15 minutos de "Usar así" (criterio: cambia como máximo 2 tarjetas de 7); luego se traducen y siguen las 12 restantes. *Consecuencia:* unas 25 jornadas para español, 60 en total.
- **B** El modelo genera los borradores de las 38 recetas y una persona los revisa. *Consecuencia:* más rápido; riesgo de recetas planas y de datos inventados que el lint debe atrapar.
- **C** Redactor externo por rubro. *Consecuencia:* costo y coordinación; mejor voz del rubro.

**D17 — ¿Para qué países hay montos de ejemplo reales?**
- **A ★** Colombia, México, Argentina, Perú, Chile y Brasil; los demás muestran `[precio]`. 
- **B** Solo Colombia. *Consecuencia:* un mexicano ve pesos colombianos.
- **C** Ninguno: todo `[precio]`. *Consecuencia:* se pierde parte del "ya está casi hecho".

**D21 — ¿Prellenamos con el historial real de conversaciones?** (idea nueva 1)
- **A ★** Sí: chats importados por coexistencia y, si no hay, tres chats pegados; las preguntas y respuestas salen de la voz del negocio. *Consecuencia:* extracción con validador; el diferencial más difícil de copiar.
- **B** Solo chats pegados. 
- **C** No.

**D22 — ¿Foto de la lista de precios, del menú o del horario?** (idea nueva 2)
- **A ★** Sí, con la visión que ya existe; todo entra como "detectado" y se confirma tocando.
- **B** Después (ola 3).
- **C** No.

**D23 — ¿Nota de voz para contar el negocio?** (idea nueva 3)
- **A ★** Sí, en el paso 1, con la transcripción que ya existe.
- **B** Después.

### C. Canales

**D12 — ¿Los cinco canales en pie de igualdad?**
- **A ★** Sí: el paso 4 los muestra a todos, ordenados por la receta del rubro, con "después" por canal.
- **B** WhatsApp siempre primero y obligatorio; los demás después. *Consecuencia:* la usuaria Instagram-first del video habría chocado igual con Meta.

**D11 y D19 — ¿El enlace público de {Nombre} desde el paso 3?**
- **A ★** Sí: público, con tope diario por enlace, marcado como demo, y la plataforma paga los primeros N mensajes por tenant antes de elegir plan. *Consecuencia:* ruta pública nueva y aprovisionamiento del widget en el día 0.
- **B** Solo después de elegir plan. *Consecuencia:* el "aha" compartible llega después de pagar.
- **C** Solo dentro del panel (no compartible). *Consecuencia:* se pierde "mostrárselo al socio".

**D4 — ¿Reabrimos el número de prueba de Meta?**
- **A ★** Sí: una prueba de una hora con nuestro registro; si Meta ofrece los números 555, la opción "no lo tengo a mano" lo usa. *Consecuencia:* el que no tiene número prueba por WhatsApp de verdad en el día 0.
- **B** No: el enlace propio cubre ese caso.

**D20 — ¿Instagram sin página de Facebook?**
- **A ★** Verificar en un tenant real que el flujo vigente (Instagram Login) no exige página de Facebook y retirar ese requisito de todos los textos.
- **B** Mantener el requisito por si acaso. *Consecuencia:* gente creando páginas que no necesita.

**D24 — ¿Ensayo automático con un cliente simulado en el paso 3?** (idea nueva 4)
- **A ★** Sí: "Mira cómo atendería a Laura", cinco turnos, con la simulación que ya existe.
- **B** Solo los chips de prueba.

### D. Vocabulario, ayuda y el después

**D6 — ¿Qué palabras usamos?**
- **A ★** Encendido/apagado, "cambiar", "listo"; publicar/borrador/candidato/versión solo dentro de "Avanzado"; el spec que hoy exige "publicar" en la ayuda se invierte. 
- **B** Mantener publicar/borrador con mejor explicación. *Consecuencia:* la persona sigue leyendo un modelo de versiones el primer día.

**D14 — ¿El editor se reorganiza por tarjetas?**
- **A ★** Sí: qué vende, dónde y cuándo, cómo habla, cuándo llama a una persona y a quién, qué sabe, por dónde atiende, reglas, avanzado; misma anatomía que el día 0.
- **B** Pestañas actuales con limpieza de jerga y sin paneles arriba. *Consecuencia:* más barato; "cambiar" se siente como otro producto.

**D25 — ¿"Cambiar hablando" con Assist?** (idea nueva 7)
- **A ★** Sí, en la ola 4, reutilizando el sistema de propuestas del 7-sep.
- **B** No.

**D26 — ¿Salud semanal por WhatsApp al dueño?** (idea nueva 8)
- **A ★** Sí, en la ola 4, una línea con acción.
- **B** No.

---

## 4. Qué pasa con cada respuesta

- Con **todas las recomendadas**, el orden de construcción es el de la §9 del diseño: ola 0 (plomería y quitar capas), ola 1 (estado del precio, esquema de recetas con lint, pasos 1-3 con las 6 industrias), ola 2 (paso 4 multicanal, enlace propio, paso 5, historial, foto, voz, ensayo), ola 3-4 (editor por tarjetas, salud, cambiar hablando, salud por WhatsApp, 12 industrias restantes).
- **D1 en C** o **D10 en B** invalidan la promesa del diseño; si eliges alguna, conviene decirlo antes de empezar la ola 1.
- **D13** es la decisión que más tiempo mueve: sin contenido, las tarjetas del paso 2 no tienen con qué prellenarse.

## 5. Estado de implementación (17-sep-2026, rama `feat/onboarding-guided-experience`)

El dueño eligió **todas las opciones recomendadas (★)**. Esta pasada dejó en código lo que se podía cerrar sin decisiones nuevas ni trabajo de contenido masivo; el resto queda listado como olas siguientes. Nada se ha desplegado: el usuario prueba en producción y el push a `main` es el deploy.

**Cerrado en esta pasada**

- **D1 / D15 — guardar aplica al momento.** `agentReviewMode` en `tenants.settings` (`immediate` por defecto, `reviewed` opcional). `AgentDraftService` hace `directCommit`: `UPDATE agent_personas` con CAS de versión, la revisión queda como historial, el puntero de borrador se borra; caché de persona invalidada, auditoría `agent.configuration.committed`, eventos `agent.version.updated`/`agent.config.updated`. El apply de Assist pasa por la misma vía. El editor y el asistente ocultan versiones/candidatos/misión y los 4 enlaces expertos cuando `workspace.directCommit`; el botón dice **Guardar** y el aviso verde **Guardado. Tu agente ya responde así.** La tarjeta **Cómo se aplican los cambios del agente** en Agentes IA cambia de modo (`GET/POST /persona/:tenantId/agent-review-mode`).
- **D2 — solo los esenciales deciden "listo".** `AGENT_SETUP_ESSENTIAL_TASKS = channel, agent, business, team`; el roll-up ignora tareas no esenciales `pending` y pruebas sin correr; las tareas van ordenadas con los esenciales primero.
- **D3 — el rojo se reserva.** Guardrails de seguridad en un `<details>` neutro; toast con tono tipado (el "Faltan datos" ya no sale verde).
- **D7 — nada interrumpe el día 0.** Etapa `live` nueva en el contrato (`isOnboardingBeforeLive`), marcada en la primera respuesta reactiva despachada por la cola saliente (nunca por el chat de prueba). Antes de `live` no se muestran el aviso crítico global, el cuadro de instalar la app, la cuenta regresiva de prueba (salvo restricción real), el globo de la mascota, ni el panel de KPIs/HelpPanel de Inicio mientras la tarjeta manda; el banner ámbar duplicado de Inicio queda apagado.
- **D8 — tarjeta de 4 esenciales** en una columna con pastilla **Siguiente** y "{n}/{total} listos".
- **D16 — el agente nace sin asignaciones** (`channels = []`) y la conexión del primer canal lo asigna (`bindDefaultAgentToChannel`, solo con un único agente activo) en WhatsApp, Instagram, Messenger, Telegram, SMS y el resto de rutas de conexión; el asistente refresca el workspace al conectar para no guardar sobre una base vieja.
- **D5 / D18 — academias con receta y "Otro" con nombre.** Subtipos `education/academia_baile|academia_musica|clases_particulares|autoescuela` en manifest + perfiles (79 subtipos, 80 perfiles; los specs de conteo pinneados se remidieron); capa de receta por subtipo (`SUBTYPE_RECIPE_OVERLAYS`: agente con nombre y rol, servicios con clase de prueba, 5 FAQs que no inventan datos, terminología, motivos de pase); `otro`, `event_planning` y `construccion` ya nacen con agente con nombre humano; el placeholder "Asistente" cuenta como hueco al sembrar.
- **D6 — jerga.** Copia del asistente, la ayuda del editor, la ayuda de canales y la tarjeta sin "borrador/publicar/candidato" en 4 idiomas; el spec de paridad i18n ahora **prohíbe** esa jerga en el día 0 en vez de exigirla. Búsqueda de navegación con palabras del dueño (`keywords` en `navigation-contract.ts`: "identidad" lleva al agente).
- **D20 — Instagram sin página de Facebook** en la ayuda (el código usa Instagram Business Login, `instagram.com/oauth/authorize`).
- **Plomería del trabajo perdido:** filas vacías de reglas/temas/motivos se descartan al guardar (`agent-config-normalize.ts`); `readFieldErrors` acepta `fields` como strings; `agent_invalid` mapea `persona.name|role|greeting|fallbackMessage|behavior.rules|handoffTriggers` al campo del editor; `beforeunload` + guardia de enlaces internos + confirmación al volver con cambios sin guardar; la fila de un canal asignado sin conexión ofrece **Conectar**.
- **Assist (KB):** artículos 01, 02, 06, 07 y 26 en es/en/pt/fr describen guardado inmediato, modo revisado opcional, 4 esenciales y etapa en vivo; el contrato `assistant-kb-contract.spec.ts` pinnea las frases nuevas.
- **D10 — precios de ejemplo (Ola 1, 17-sep).** Columna `services.price_status` (`example` sembrado, `confirmed` del dueño, `quote` a cotizar; DEFAULT `confirmed` para lo que ya existía). Las siembras (`seedServices`, migración de vertical) marcan `example` como literal SQL. Ningún camino hacia el cliente o el modelo dice un número no confirmado: `list_services`/`list_pet_services`/`list_photo_packages` devuelven `price: null` + `priceNote`; el motor de reservas dice "precio por confirmar"/"se cotiza" en la lista, el resumen y el Flow; `<available_services>` lleva `price_status` y la regla 22a del contrato; `appointmentPriceSql` devuelve NULL; el guardrail de claims deja de ver el monto como hecho. El dueño confirma editando el precio o con **Confirmar precio**, o marca **Se cotiza**; una política de pago exige precio confirmado. Salud: `services_example_price` no crítico. KB (11, 26, 01) en 4 idiomas.

- **D11 / D19 — el enlace de {Nombre} (Ola 2, 17-sep).** Página pública `/w/{widgetId}` en el panel (nunca el slug) sobre el widget de chat web existente, en modo "página" del loader (abierto, sin burbuja, dentro de un contenedor). Nace en el día 0 (`ensureDemoWidget` en el alta, en ambas ramas, y perezosamente en `setup-status` para las cuentas anteriores): una fila en `public.widget_configs` con `is_demo = true`, sin fila en `channel_accounts` y sin vínculo al agente (el predeterminado ya atiende `web_widget`). Por eso **no cuenta como canal conectado**: Calidad y Canales filtran `is_demo`, la etapa sigue en el asistente y `live` solo lo marca la cola saliente, por la que el widget no pasa. Carril demo en las tres compuertas del plan (`isTenantWidgetRuntimeAvailable`, `WidgetMessageStore.assertAvailable`, `processWidgetMessage`): no exige `features.widget`, solo que la franquicia esté encendida. **D19:** la plataforma paga `messagesPerTenant` respuestas de por vida (contador `demo_msg:{tenantId}` con reserva idempotente, nunca `ai_msg:*`) y cada página tiene `dailyCapPerPage` por día calendario (`widget:rl:demo:day:{aaaammdd}:{widgetId}`); ambos en `platform_settings` clave `onboarding.demoAllowance` (defaults 200 y 60; sin UI todavía). Al tope, el propio chat lo dice en el idioma del widget y no desconecta; un visitante del enlace nunca pasa al inbox humano. El origen del panel siempre está permitido (`platformWidgetHostnames`). Asistente: paso 3 con Abrir / Copiar enlace / Ponerlo en mi bio / Mostrárselo a mi socio (WhatsApp) / las dos líneas para la web; el botón "Chat web" del paso 2 abre el enlace en vez de crear widgets. Tarjeta en Canales. KB (01, 04) en 4 idiomas. El costo LLM de la demo sí se atribuye al tenant en `llm:cost:*` (documentado). **Correcciones de la revisión adversarial (16 hallazgos, 5 lentes × 2 refutadores):** el origen del panel se admite **solo para el enlace** (`platformHosted`), no para todo widget, y `localhost` queda fuera de producción — si no, un widget de sitio restringido a un dominio se volvía una página que cualquiera abre o mete en un iframe desde el panel; el carril demo se decide **por turno** (`options.demo && plan.widget !== true`), así que cuando el negocio activa un plan con chat web el mismo enlace pasa a la cuota del plan y la frase "cuando el negocio active su plan, el chat sigue" se vuelve cierta; las compuertas internas (entrega de una respuesta ya guardada, lectura de la sesión, arranque del almacén de respuestas) preguntan por el **tenant** y no por un id de widget que no cargan — con la versión anterior el carril quedaba muerto en el plan por defecto; el enlace no se lista, ni se edita, ni se borra como un widget cualquiera (borrarlo rotaba la URL que ya estaba en la bio); un índice único parcial garantiza un enlace por cuenta y el 23505 se lee como "otro lo creó"; el nombre del agente se refresca en cada lectura de `setup-status`; las dos líneas para la web ya no entregan el widget demo sino la pantalla de Chat web; el enlace muerto muestra "no existe" en vez de "revisa tu conexión"; `/w/` rechaza un widget que no sea el enlace.

**Pendiente (olas siguientes, en orden sugerido)**

3. **D12** triage de WhatsApp con 5 respuestas + Cancelar + "probar sin WhatsApp"; códigos de error de servidor para IG/Messenger.
4. **D9 / D13 / D17** pipeline de recetas JSON con lint por industria y receta generada por el modelo para "Otro"; montos de ejemplo por país.
5. **D4** verificar en el ESU si Meta sigue ofreciendo los números 555 de prueba.
6. **D21 / D22 / D23 / D24** historial, foto, nota de voz, cliente simulado.
7. **D14 / D25 / D26** editor por tarjetas, "cambiar hablando", salud semanal por WhatsApp.
8. Tabla `onboarding_events` (§11 del diseño) para medir tiempo-a-primera-respuesta.
