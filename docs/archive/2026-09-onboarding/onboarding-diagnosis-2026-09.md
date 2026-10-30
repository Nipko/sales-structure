# Diagnóstico del onboarding — septiembre 2026 (después del video)

> **Estado:** diagnóstico y propuesta. Nada se construyó ni se ejecutó en producción.
> **Base:** `main` en `0113f68d` (16-sep-2026), el video `parallly_onboarding.mp4` (48:37, grabado el 14-sep contra producción) y los dos documentos que dejó el agente anterior en esta rama.
> **Método:** 7 lectores de código con evidencia archivo:línea, 3 analistas del video fotograma a fotograma (243 fotogramas), 3 investigadores externos con fuentes abiertas, y 26 refutadores independientes sobre los hallazgos críticos y altos. El material crudo está en `docs/onboarding-diagnosis-2026-09-workdir/`.
> **Leyenda:** **[V]** verificado en código por un lector y confirmado por un refutador · **[V-c]** confirmado con una corrección de detalle · **[R]** refutado · **[video]** visto en los fotogramas · **[inferido]** deducido, no observado.

---

## 0. El veredicto en una página

**Qué pasó.** Una dueña de negocio con conocimientos técnicos y con una persona de soporte de Parallly en la llamada trabajó 41 minutos de pantalla compartida. Terminó sin WhatsApp conectado, sin que el agente respondiera un solo mensaje, y **con los 15 minutos de configuración que hizo en el editor descartados en silencio** (a las 31:48 el agente vuelve a llamarse "Asistente", WhatsApp vuelve a estar asignado y Herramientas vuelve a 4) **[video]**.

**Por qué.** No es falta de funciones: el chat de prueba, las rutas de WhatsApp, los recorridos guiados, los checks de calidad y el bootstrap por industria existen y varios están bien hechos. Falla por cinco causas que se suman:

1. **Nace genérica.** Una academia de baile cae en la industria "Otro": agente llamado "Asistente", sin servicios, sin dirección, con preguntas frecuentes que esquivan la respuesta, con la agenda apagada aunque pidió agendar, y con **los cinco canales asignados sin ninguno conectado** (cinco avisos amarillos antes del primer campo) **[V]**.
2. **Las capas de después invadieron el día 0.** El plan de simplificación del 4-sep (`4f2390e4`) dejó un asistente de 3 pasos. Entre el 6 y el 14 de septiembre, ocho commits montaron encima del asistente y del editor los paneles de "versión operativa y borrador", "misión y preparación", "candidatos", "publicaciones" y "acción crítica". Hoy la persona lee "versión operativa 5 · Atendiendo", "el agente todavía no está listo para atender" y "hay una acción crítica" en la misma pantalla, antes de escribir el nombre de su agente **[V]**. Y **nada de lo que edita llega al agente vivo**: el asistente y el editor escriben en un borrador que solo se vuelve real tras una tubería de 5 paradas (evaluación por canal×idioma, revisión, publicación) que ningún dueño de negocio va a recorrer el primer día **[V]**.
3. **No hay una sola guía.** En cada pantalla conviven entre 5 y 9 superficies que guían o interrumpen: banner de prueba gratuita, banner rojo de "acción crítica", panel de versión, panel de misión, ayuda de 6 pasos, banner ámbar de configuración incompleta, tarjeta de 9 "esenciales", KPIs en cero, mascota, y el aviso "Instalar Parallly" que tapó botones durante 35 minutos **[video][V]**.
4. **El muro de Meta sin diagnóstico.** Su número ya estaba en la API con otro proveedor. La pantalla recomienda "coexistencia" por defecto, esconde la única ruta aplicable en tercer lugar, no hace ninguna pregunta de triage, pone ~450 palabras antes del botón, y cuando falla dice "la ventana se cerró antes de terminar" sin decir qué hacer. Nada le ofrece la alternativa que ya existe: probar al agente sin WhatsApp **[V][video]**.
5. **Plomería que destruye la confianza.** El "Guardar borrador" falló dos veces con un aviso que dice "faltan datos obligatorios, revisa los campos en rojo" **pintado de verde con un check**, sin ningún campo en rojo, y sin aviso al salir de la página. La causa exacta está identificada (§3.5) **[V]**.

**Las tres cosas que el dueño quiere separar hoy están mezcladas en cada pantalla.** El onboarding (día 0), la configuración (día 1+) y el panel de salud viven juntos en el editor, en el asistente y en Inicio, con vocabularios distintos para el mismo hecho.

**Qué haría primero.** Hay una **Ola 0 de plomería y de "quitar"** (dos semanas, tamaño XS/S, sin decisiones de producto) que arregla la pérdida de trabajo, saca las capas del día 0 y baja la tarjeta a 3-4 esenciales. Después, con ocho decisiones del dueño (§8), un **día 0 de cuatro pantallas** que termina con la persona escribiéndole a su propio agente por WhatsApp, un **editor que vuelve a ser un editor**, y un **panel de salud de cuatro preguntas** en lenguaje llano.

---

## 1. Método, evidencia y correcciones a lo anterior

### 1.1 Qué se hizo

| Paso | Qué | Resultado |
|---|---|---|
| Lectura de código | 7 lentes fusionadas (alta y defaults; asistente y capas; editor; Inicio y guías; canales/WhatsApp; verdades de "listo"; sistema de ayuda), dieta de tokens, notas en disco | 64 hallazgos con archivo:línea (`workdir/lens1-7.md`, `all_findings.md`) |
| Video | 243 fotogramas (uno cada 12 s), recortados a la pantalla compartida, en 41 hojas de contacto; 3 analistas por tramo | Línea de tiempo con conteo de superficies por pantalla, contraste con el transcript, 36 hallazgos que el transcript no vio, inventario de textos (`workdir/video_v1-3.md`) |
| Referentes externos | 3 investigadores con WebFetch sobre documentación primaria (Intercom, Chatbase, Crisp, Gorgias, Zendesk, Freshdesk, Landbot; Meta, Wati, Kommo, respond.io, Gallabox, Jelou, Treble, Interakt; NN/g, Baymard, Shopify, Chameleon, Userpilot, Google Ads, Lighthouse) | Patrones con URL y grado de confianza, métricas con tamaño de muestra y salvedad (`workdir/r_*.md`) |
| Refutación | 26 escépticos, uno por hallazgo crítico o alto, con la consigna de refutar y de buscar si el comportamiento fue una decisión deliberada (`git log -S`, docs, comentarios) | 24 confirmados (18 con corrección de detalle), 1 refutado, 1 confirmado sin reservas (`workdir/verdicts.md`) |

### 1.2 Correcciones al transcript del agente anterior

El transcript (`docs/onboarding-video-transcript-analysis.md`) es útil como voz de la usuaria, pero hay que leerlo con estas correcciones **[video]**:

- **Los tiempos van adelantados entre 1,5 y 2 minutos** en toda la segunda mitad (p. ej. el chip de WhatsApp desaparece entre 23:00 y 23:12, no a las 21:36; el aviso de guardado fallido aparece a las 20:24 y 32:24, no a las 27:46).
- **El campo "Mensaje cuando no puede responder" NO estaba en blanco**: venía prellenado con "Déjame conectarte con un miembro del equipo para atenderte personalmente." y ella lo borró para escribir el suyo. El problema es de affordance (no se ofrecen opciones para elegir), no de campo vacío.
- **Las asignaciones de canal no estaban "en otra pestaña bajo un hero colapsado"**: están en la misma página, debajo del panel de ayuda que dice "Arriba".
- **El aviso "Faltan datos obligatorios" no es rojo: es verde con un check.**
- **La ventana de Meta nunca aparece en la grabación.** Hubo dos intentos (39:24 y 40:24), cada uno terminó en menos de 12 segundos con "No recibimos la autorización — La ventana se cerró antes de terminar". El transcript narra una ventana emergente y un solo error a las 40:26.
- **La pantalla compartida termina a las 41:00**; la llamada siguió en audio hasta 48:36.
- **Lo más grave del video no está en el transcript:** la pérdida silenciosa de todo lo editado (§3.5).

### 1.3 Los números del benchmark anterior

Del documento `docs/onboarding-ux-benchmark-and-video-audit.md` §2, ninguna cifra tiene fuente primaria: "72 % abandonaba" (Tidio) es una estadística genérica de un roundup, no de Tidio; "60 % abandona si pides Meta en el minuto 2" (Wati) no aparece en ninguna fuente; "85 % nunca toca los buffers" (Calendly) no se encontró; y "Duolingo 25 % → 89 %" está **contradicho**: el caso documentado habla de 8,9 % de conversión y de +20 % por progreso dotado, no de 89 % **[R]**. Además, la afirmación de que Wati permite probar el bot antes de Meta es falsa: su probador exige un número ya conectado **[R]**. El marco LEGO del documento sigue siendo una buena intuición; sus datos no se pueden citar.

---

## 2. Lo que vio Nataly, minuto a minuto

Superficies = banners, paneles, tarjetas, popups, mascota y barra fija que compiten con el contenido en ese momento **[video]**.

| Minuto | Pantalla | Superficies | Qué pasó | El defecto detrás |
|---|---|---|---|---|
| 00:00 | Editor del agente → búsqueda global | 6 | Escribe "identri", no encuentra nada; "Identidad" la manda al CRM de deduplicación de contactos | La ayuda del editor dice "pestaña Identidad" y esa pestaña no existe; la búsqueda solo indexa títulos de menú **[V]** |
| 00:24 | `/admin/setup-wizard` | 6 | Lee "Versión operativa y borrador… Todavía no hay un borrador", "Misión y preparación · Pendiente · El agente todavía no está listo para atender", 4 botones, y recién después "Paso 1 de 3" | Paneles de d50d1670 y 751d23e7 montados encima del asistente **[V]** |
| 00:48 | Editor | 9 | Banner rojo "acción crítica", panel violeta "Versión operativa 5 · Atendiendo", panel de misión "no está listo", 6 botones (Evaluar candidato, Publicar, Aprender, Fallos…), ayuda de 6 pasos, "4 bloqueos críticos" | Tres verdades contradictorias en una pantalla **[V-c]** |
| 02:36 | Editor | 6 | Cinco filas "whatsapp: asignado, pero sin una conexión activa · Quitar del borrador", cinco chips seleccionados | El agente nace con los 5 canales asignados **[V]** |
| 03:36-06:12 | Persona | 5 | Nombra "Geraldine", escribe el saludo, tarda 85 s en una frase de fallback, elige tono y extensión en 20 s | Las tarjetas (tono, extensión) funcionan; los campos de texto libre no |
| 08:36-12:00 | Instrucciones | 6 | Lienzo vacío con placeholder de "asesor de ventas"; debajo, en rojo, 13 líneas sobre abuso de menores, terrorismo, drogas y armas | Ninguna plantilla siembra instrucciones; la lista de "protecciones" es permanente y visible **[V]** |
| 12:00-14:12 | Instrucciones | 6 | Dos minutos sin hacer nada; cero guardados a los 14 minutos | No hay autoguardado ni siguiente paso visible |
| 14:36-19:00 | Reglas | 5 | Revisa 7 reglas genéricas ("prospecto", "vendedor", "reunión") con voseo rioplatense en una cuenta es-CO; deja una fila de regla nueva en blanco | Plantilla `tpl_otro_ventas`; **esa fila vacía es lo que después impide guardar** (§3.5) |
| 19:36-20:12 | Editor (arriba) | 8 | Lee "Arriba, prepara las asignaciones… guarda, prueba, prepara la revisión, apruébala y publícala"; busca "arriba" | Un tip con 5 verbos y 3 pantallas; el bloque está debajo del panel **[V-c]** |
| 20:24 | Editor | 6 | Clic en Guardar borrador → aviso **verde con check**: "Faltan datos obligatorios…" sin campo rojo | §3.5 **[V]** |
| 23:00-23:12 | Herramientas | 5 | Desaparece WhatsApp del agente (chip o "Quitar del borrador") | El único remedio ofrecido para "sin conexión activa" es quitar el canal **[V]** |
| 24:00-27:12 | Herramientas | 5 | "Catálogo de productos… stock en tiempo real", "Historial de órdenes", "Cobros a clientes — tu plan no incluye…" | Vocabulario e-commerce y upsell en el día 0 de una academia |
| 27:24 | Horario | 5 | "Aún no se han configurado horarios… Editar horarios ↗ (Ajustes)" | Pestaña vacía que redirige; su dato central son los horarios de clase |
| 30:24 | Inicio | 6 | Banner ámbar + "Puesta en marcha 2/9 esenciales" en cuadrícula 3×3 + 4 KPIs en cero + "El router ahorra ~42 % usando Tier 3-4" | La tarjeta pasó de 6 esenciales (plan) a 8-10 (assessment) **[V-c]** |
| 31:48 | Lista de agentes | 6 | "● Asistente · 0 días/semana · 22 reglas · Personaliza tu agente" | **Todo lo editado se perdió** **[video]** |
| 32:24 | Editor | 8 | Segundo Guardar → mismo aviso verde | — |
| 34:36-35:24 | WhatsApp | 4 | 48 s marcando 3 casillas de "Tené esto a mano" (voseo) | Gate ceremonial que no verifica nada **[V]** |
| 35:36-39:00 | WhatsApp | 3 | 3,5 min entre tres tarjetas; ~25 viñetas + amenaza de 24 h antes del botón; "es una cuenta API" | Sin pregunta de triage; ruta aplicable (migración) tercera y "BSP" **[V]** |
| 39:12-40:48 | WhatsApp | 4 | Elige "Número nuevo" (probablemente equivocado), dos intentos, dos "La ventana se cerró antes de terminar" | Sin diagnóstico ni alternativa **[V-c]** |

---

## 3. Las causas raíz, con evidencia

### 3.1 Nace genérica: la industria "Otro" y los defaults del primer agente

- **Fuera de las 18 industrias, todo es "Otro"** (`vertical-definitions.ts:1299` → `createGenericVertical`): agente "Asistente", `services: []`, `bookingEnabled: false`, y cinco FAQs que responden "escríbenos y te confirmamos" **[V-c]**. La corrección del refutador importa: ese esquive es deliberado (`95f758f3`) para no inventar precios; el defecto no es la redacción sino **sembrar placeholders para un negocio que no dio datos**, en vez de preguntarle.
- **Nueve industrias no tienen nombre humano de agente** (`event_planning`, `construccion`, `otro`, `turismo`, `education`, `finanzas`, `servicios_profesionales`, `retail`, `technology`); tres de ellas resuelven a `tpl_otro_ventas`, cuya persona es "Asistente" **[V-c]**. (El hallazgo original "orFallback pisa el nombre vertical" fue **refutado**: para las industrias con nombre, la plantilla ya lo trae **[R]**.)
- **El día 0 no puede responder las cuatro preguntas de cualquier prospecto** (cuánto cuesta, dónde quedan, qué horario, cómo reservo): `/onboarding` no pide dirección, servicios ni horario (`onboarding/page.tsx:765-782`), el prompt sí los leería si existieran (`prompt-assembler.service.ts:265-269`), y para tenerlos hay que visitar cuatro pantallas distintas **[V]**.
- **Pidió agendar y la agenda quedó apagada en silencio:** para "Otro" `bookingEnabled:false` salta la siembra de disponibilidad y `restoreAppointmentsTool` deja `tools.appointments.enabled:false` sin marcador; el check `tool_appointments` reporta `not_applicable` para herramientas apagadas, así que ningún panel se lo dice **[V-c]**.
- **El primer agente nace con los cinco canales asignados** (`persona.service.ts:3136-3145`, también `:858` y `persona.controller.ts:433-441`, decisión de `20f703d1`) mientras ninguno está conectado → cinco filas "asignado, pero sin una conexión activa" con "Quitar del borrador" **[V]**. La única acción ofrecida es quitar; no hay "Conectar".
- **"Instrucciones principales" queda vacío** porque ninguna plantilla ni el parche vertical escriben `behavior.mainInstructions` (`verticals.service.ts:1921-1968`); las reglas sí se siembran, pero en otro acordeón que la persona no asocia **[V-c]**.
- Lo que sí llega al agente: `about`, teléfono, web, objetivos y audiencias (`vertical-turn-context.service.ts:174-177`). El hallazgo "audiencias nunca llegan al prompt" fue debilitado por el refutador y no se sostiene.

### 3.2 La regresión del 6 al 14 de septiembre: borradores, candidatos y misión encima del día 0

Cronología verificada con `git log`:

| Commit | Fecha | Qué agregó al día 0 |
|---|---|---|
| `4f2390e4` | 4-sep | El plan de simplificación: asistente de 3 pasos, `onboardingStage`, tarjeta de puesta en marcha, recorridos "Mostrarme dónde", HelpPanel en el asistente (esto último fue deliberado) |
| `75fe01c3` | 6-sep | "verify guided tasks and expose reviewed external tools" |
| `d50d1670` | 7-sep | **Borradores y candidatos de publicación**: `AgentDraftStatus`, `agent-draft.service`, `agent-release.*`; el asistente y el editor pasan a escribir en un borrador |
| `751d23e7` | 7-sep | **`AgentAssessmentPanel` montado en cada superficie de configuración** ("Every configuration surface uses this same server assessment"); tareas `mission` y `tests` en la tarjeta |
| `b5b71b60` | 8-sep | Borra la definición de 6 esenciales del cliente; la tarjeta pasa a proyectar el assessment completo |
| `4c6516a5`, `64e6e936`, `5deee1bd` | 8-sep | Un vocabulario compartido de estado (`unknown/pending/prepared/tested/operating/degraded`) y el roll-up "la parte menos avanzada es la que habla" |
| `cb9088cb` | 13-sep | "lead saved drafts into reviewed publication": el copy del asistente pasa a hablar de "publicarás la versión revisada al final"; "Listo" dispara el tour de publicación de 5 paradas |
| `6f02b278` | 13-sep | Reescribe el tip 6 del editor y agrega a `i18n-parity.spec.ts` la exigencia de que la ayuda hable de publicación |
| `a7337a10` | 14-sep | "align agent readiness guidance" |

Consecuencias, cada una confirmada:

- **Los dos paneles están encima del stepper en los tres pasos del asistente** (`setup-wizard/page.tsx:501-507`) y también en el editor (`[agentId]/page.tsx:623-624`) **[V]**.
- **El asistente escribe en un borrador y no puede terminar con el agente renombrado en vivo**: `saveAgentDraft` (`:328-339`), "Listo" dispara `publish_agent_revision` (5 paradas: guardar → probar → preparar candidato → revisar → publicar, `guided-tours.ts:173-179`); la revisión exige muestras por canal×idioma (`agent-release-contract.ts:55-66`). El endpoint `POST setup-wizard` todavía puede escribir directo sobre el agente vivo, pero la página solo toma esa rama cuando el tenant no tiene agente, que nunca es el caso del día 0 **[V-c]**. Es una decisión deliberada (`d50d1670`, `cb9088cb`; comentario "Reactivation belongs to publication").
- **El copy dice que el agente responde "después de asignar y publicar una versión aprobada", y no es cierto**: el runtime sirve cualquier `agent_personas` con `is_active=true` ligada al canal o por defecto (`serving-persona.ts:14-18`), y el agente del bootstrap nace activo y en los cinco canales. Por eso la pantalla muestra a la vez "Versión operativa 5 · Atendiendo" y "no está listo" **[V-c]**.
- **La misión "pendiente" es por diseño**: `configured` exige `objective` + `intentKeys` (`agent-assessment.service.ts:212`); la plantilla nunca lo escribe; el roll-up elige la parte menos avanzada (`agent-operational-state.ts:142-150`), así que **todo agente derivado de plantilla es "todavía no está listo para atender"** hasta que el dueño escriba su misión, y "Siguiente paso: Acordar la misión" es el primer botón violeta que ve. Los tres textareas obligatorios son solo del formulario del cliente **[V-c]**. El dueño de ese código lo eligió como trade-off de honestidad (`64e6e936`: "warning on the mission means running on the template's mission"). Para un novato es un veredicto negativo sobre un agente que sí funciona.
- **Toda la evaluación se calcula sobre la versión operativa; el borrador que la persona edita nunca se evalúa** (`agent-assessment.service.ts:175-178`, `agent-quality.service.ts:243-252`; texto "Esta evaluación describe la versión operativa. Prueba el borrador…"). El progreso es invisible mientras trabaja **[V-c]** (documentado como legítimo en `docs/audits/2026-09-07/agent-configuration-revisions.md`).
- **El interruptor "Activo" solo apaga**: encenderlo muestra "La reactivación requiere revisar y publicar una versión" sin enlace (`[agentId]/page.tsx:420-424, 763`; el API lo refuerza) **[V]**.
- Sobre las "seis verdades" de listo: desde el 8-sep existe una proyección compartida (`assessment.state`), así que el hallazgo original queda parcialmente desactualizado **[V-c]**. Lo que sigue contradiciéndose en pantalla es el flag de activación ("Atendiendo", "Está respondiendo a tus clientes") junto al estado "pendiente", más los banners de calidad que usan otro vocabulario (`worstStatus`, `attentionCount`).

### 3.3 Sin una sola guía

- **Inicio con canal sin conectar**: el plan silencia lo que nombró (hero, tarjeta de salud, banner rojo, burbuja de la mascota) pero dejó **el banner de prueba, el banner ámbar, la franja de ayuda, la tarjeta de 8-10 ítems, 4 KPIs en cero, la mascota y el aviso de instalar la PWA**: 5 a 7 superficies **[V-c]** (`admin/page.tsx:441-451, 536-551, 707-709`; `layout.tsx:207-210, 241-244`).
- **La tarjeta "Puesta en marcha" pasó de 6 esenciales a 8-10** al proyectar el assessment (misión primero y sin recorrido; catálogo sin recorrido); no distingue lo que hace que el agente conteste de lo opcional; sin "siguiente", sin tiempo estimado; y nunca se construyó la escritura de `completed` al llegar al 100 % **[V-c]**.
- **El banner rojo "Hay una acción crítica" aparece en todas las páginas menos el asistente, el centro de calidad e Inicio**: cualquier check crítico en `fail` de un tenant recién creado (sin canal asignado o sin conexión) genera una señal `critical` (`agent-quality.service.ts:1178-1187`); el plan lo registró como defecto #1 y solo lo apagó en `/admin` **[V-c]**.
- **El aviso "Instalar Parallly"** se dispara con `beforeinstallprompt` sin gate de etapa ni de visita, z-index 9999, sobre todo `/admin/*`; tiene snooze solo después de cerrarlo **[V-c]**.
- **La mascota** se calla solo en `/admin`; en el asistente y el editor saluda a los 0,9 s ("Soy tu asistente de IA…") al lado de "Guiarme con Parallly Assist" **[V]**.
- **Dos motores de tour** conviven (onborda + 17 recorridos guiados); el de onborda todavía puede armarse desde `PRODUCT_TOUR_PENDING_KEY` en la rama de fallback del "Listo" **[V]**.

### 3.4 El muro de Meta

- **Sin triage.** Coexistencia viene preseleccionada como "Recomendado" (`whatsapp-connect-routes.ts:42-75`, `page.tsx:69`), la ruta para un número que ya está en la API con otro proveedor es la tercera y se describe como "(BSP) · Sin downtime"; el pre-check son tres casillas de conciencia sin ramas (`WhatsAppPrerequisites.tsx:13-16`) **[V-c]**. La usuaria pasó 3,5 minutos entre las tres tarjetas y eligió la que casi seguro no le servía.
- **~450 palabras antes del botón** en la ruta recomendada (requisitos, qué se sincroniza y qué no, limitaciones, pasos, "tienes 24 horas o repites todo", "~20 mensajes/segundo", "versión 2.24.17", "AES-256") **[V][video]**.
- **"Esperando autorización…" sin salida una vez abierta la ventana**: por diseño (`4f2390e4`) los temporizadores no actúan tras perder el foco, y no hay botón "Cancelar". Meta sí avisa ERROR/CANCEL de inmediato por `postMessage`; lo que queda mudo es cualquier estado no terminal dentro de la ventana **[V-c]**. El error final "La ventana se cerró antes de terminar" no diagnostica (ventana bloqueada, ruta equivocada, cuenta de Facebook sin permisos).
- **La alternativa sin Meta existe y no se ofrece**: el chat de prueba está en el paso 1 del asistente (`setup-wizard/page.tsx:608-616`), un clic "Anterior" antes del muro; ni el muro, ni "Conectar después", ni Inicio, ni la página de WhatsApp desconectada lo mencionan **[V-c]**. "Número de prueba" se retiró el 4-sep por decisión del dueño hasta verificar con Meta; **la documentación de Meta sí documenta hasta dos números 555 gratuitos dentro del Embedded Signup** (ver §5.2), así que la decisión merece reabrirse con una prueba real del `config_id`.
- La ayuda de WhatsApp contradice las rutas ("elimínalo de la app", "Migración… dejarás de recibir mensajes en la app", "página de Facebook") **[V]**.

### 3.5 La plomería que perdió el trabajo (y otras trampas de confianza)

**La cadena completa, verificada línea por línea:**

1. "+ Agregar" en Reglas inserta una cadena vacía (`BehaviorSection.tsx:53-54`); ella dejó esa fila en blanco (video 15:36).
2. El validador del cliente acepta la lista si **alguna** regla está llena (`[agentId]/page.tsx:396-408`, `anyFilled`).
3. El validador del servidor rechaza la lista si **alguna** regla está vacía (`persona.service.ts` `optionalTextList('behavior.rules', …)`: `!item.trim()` → `agent_invalid`, `fields: ['behavior.rules']`).
4. El API envía `fields` como **cadenas**; el envoltorio del dashboard solo conserva **objetos con `path`** (`lib/api.ts:2844-2855`, `readFieldErrors`), así que el cliente recibe `fields: undefined`. El comentario del editor ya lo sospechaba ("Its `fields` list is not forwarded by the HTTP wrapper today").
5. Con la validación local limpia y sin campos remotos, `errors = {}` → `revealFirstError` no hace nada → **no hay ningún campo en rojo** (`[agentId]/page.tsx:496-508`).
6. El aviso "Faltan datos obligatorios para guardar. Revisa los campos marcados en rojo" se pinta **verde con un check**, porque el color se decide por la subcadena "Error" (`:1041-1043`); lo mismo les pasa a todos los avisos de bloqueo de la página (`promptRequired`, `activationReview`, `editorChanged`, …) **[V]**.
7. **No existe ningún guardia de cambios sin guardar** (`grep beforeunload` en el dashboard: 0 resultados). Navegó a Canales y todo se perdió.

Otras trampas confirmadas:

- **Los chips de canal son botones desnudos**: un toque cambia el borrador local sin confirmación, sin indicador de "cambios sin guardar" y sin diferencia visual clara; el refutador precisa que no se persiste hasta Guardar, pero justamente eso hace que la persona no sepa qué pasó **[V-c]**.
- **La búsqueda global** solo compara etiquetas de menú e ids de ruta (`NavigationCommandPalette.tsx:169-172`); "Identidad" solo puede llegar al CRM; el editor del agente (ruta dinámica) no es buscable **[V]**.
- **Las tarjetas de herramientas son solo interruptores** sin camino para cargar datos ("¿es solo prender y apagar?"); solo Citas tiene el patrón correcto "configura N antes de activar" **[V]**.
- **La lista roja de "Protecciones de seguridad (siempre activas)"** (menores, trata, suicidio, terrorismo, drogas, armas…) es permanente y ocupa el mayor espacio visual de la pestaña donde más se escribe **[video]**.

### 3.6 El sistema de ayuda: tres capas sin fuente común

- Tres capas (tips del HelpPanel, recorridos guiados, KB de Assist) sin una fuente compartida: los tips nombran "pestaña Identidad", "Principal", "Canales sin agente", "Costo IA Hoy", "Configuración → IA" (ruta de super_admin), y ninguno de esos valores existe en la UI **[V]**.
- **El único test sobre el copy de ayuda exige la jerga de publicación** (`i18n-parity.spec.ts:124-140`, `6f02b278`): la regex corre sobre la concatenación de cuatro claves; simplificar solo el asistente no rompe CI, pero no hay ningún test que compare tips con etiquetas reales **[V-c]**.
- Los dos paneles del día 0 (Inicio y asistente) son los únicos **sin** "Mostrarme cómo", mientras 16 pantallas posteriores lo tienen; el mejor recorrido del sistema (`home_first_steps`: "Conectar WhatsApp toma unos 5 minutos") no es alcanzable desde la ayuda de Inicio **[V]**.
- La KB de Assist documenta créditos SMS como producto vivo (decisión del dueño: SMS apagado) y "Probar agente" (última edición 11-ago) no conoce los borradores **[V]**.
- `helpAssistant.*` arrastra 1.587 palabras muertas de ingeniería ("Similitud Coseno en 0.75", "RAG++", "SPF include:mailgun") en cuatro idiomas **[V]**.
- 103 páginas piden un GIF (`mediaKey`) y la carpeta solo tiene un README; está guardado para no romper, pero no hay ningún medio visual en todo el producto **[V]**.
- Voseo y tuteo mezclados en la misma pantalla (pre-check de WhatsApp en voseo; el resto en tuteo); reglas semilla con "tomá" y "avisá" en una cuenta colombiana **[video]**.

---

## 4. Lo que sí funciona (no tocar)

- El alta: 4 campos o Google, `/onboarding` con 4 campos visibles y el resto plegado, chip de zona horaria, una tarjeta de plan, selector de idioma y ayuda, validación espejo del DTO con salto al campo, borrador local, puente sin prometer "listo" (`lens1`).
- El bootstrap ordenado y resumible: schema → agente → identidad del negocio → vertical → suscripción; idempotente; idioma del locale real.
- Autoguardado al salir del campo en el asistente; "Conectar después" con memoria (`channel_deferred` + `channelConnectSkippedAt`) y banner de retomar; reentrada desde Configuración; página con Esc, no modal.
- Las tarjetas de tono (5) y extensión (3): elegir una opción con una frase de descripción es lo que en el video se resolvió en 20 segundos.
- La validación del editor sí nombra el campo y sí cambia de pestaña y resalta (cuando recibe la información); el API espeja las mismas 5 reglas con error tipado.
- La conexión de WhatsApp: catálogo de rutas compartido, resumen por ruta, 21 tarjetas de error traducidas con acción, vigilante de ventana bloqueada, advertencias de Meta traducidas, tarjeta "Probá tu agente" con wa.me, aviso móvil.
- La tarjeta de puesta en marcha es fail-closed (no declara completo lo que no pudo leer); una sola fuente de checks para tarjeta y assessment; `channel_connection`/`channel_coverage` desduplicados; señales con severidad por resultado; el pilar de producción ya calcula resolución verificada, tasa de handoff y huecos de conocimiento.
- Los recorridos guiados: copy corto y humano, y un spec que falla si un ancla desaparece.
- El chequeo de estado operativo tiene una leyenda en español llano ("Lo leímos y falta hacerlo. Sabemos qué es y dónde se configura").

---

## 5. Lo que hacen los referentes (verificado con fuente)

### 5.1 Productos de agentes de IA (Intercom Fin, Chatbase, Crisp, Gorgias, Zendesk, Freshdesk, Landbot)

- **Fuentes primero, cero prompt en el día 0**: nombre, avatar, una frase sobre el negocio y una URL o archivos; instrucciones y reglas después y opcionales (Crisp, Chatbase, Freshdesk, Zendesk).
- **Probar antes de conectar cualquier canal**, con un bucle "no supo → enséñale la respuesta" que guarda una Q&A (Chatbase "revise answer", Tidio "Add answer", Intercom test con marcado bueno/malo).
- **Conectar el canal es el último paso y es un interruptor** con un solo "Set Fin live"; pausar es un toggle; **Chatbase no tiene borrador/publicar en absoluto** (habilitado/deshabilitado).
- **La preparación se muestra como huecos accionables, no como porcentaje**: preguntas sin resolver agrupadas + recomendaciones ordenadas por impacto con "agregar contenido" (Intercom Analyze, hasta 20 por semana).
- **Plantillas o "Build it for me"** como estado vacío (Landbot: una frase → borrador → "Test this bot").
- **Prerrequisitos duros al principio, pequeños y explícitos** (Intercom: ≥10 artículos públicos antes de desplegar).
- Los agentes enterprise (Decagon, Sierra) se implantan en 6-13 semanas con humanos: no son referencia de autoservicio.

### 5.2 WhatsApp en LatAm y los docs de Meta (Wati, Kommo, respond.io, Gallabox, Jelou, Treble, Interakt, Cliengo, Zenvia, Yalo)

- **El popup de Embedded Signup es una secuencia fija de 8 pantallas**; el partner solo controla el antes (pre-vuelo) y el después (interpretar el resultado). Meta no documenta fallos de navegador; los partners los cubren.
- **Meta ofrece hasta dos números 555 gratuitos dentro del ESU**, autoverificados, sin OTP (documentado en el overview de Embedded Signup; Wati lo expone como tercera opción "usaré el número gratuito de Meta"). Es el candidato más fuerte para "probar primero / conectar mi número después".
- **Coexistencia** es la ruta por defecto para negocios con la app, con trampas documentadas: cuentas nuevas de Business App pueden no ser elegibles (decisión de Meta), la elección de historial es de una sola vez, hay que abrir la app cada 14 días, los mensajes enviados desde la app no despiertan la automatización.
- **Checklist en forma de pregunta antes del popup** (Treble: "¿Tu línea está lista para recibir un código…?"; Jelou: "la SIM debe estar en un teléfono activo"; Leadsales: "Meta Verified es un plus, no un requisito").
- **Tabla error → acción** (Wati: "número registrado en otra cuenta → coexistencia o borrar"; "Something has gone wrong → Chrome de escritorio + permitir popups"; respond.io: 5 errores con siguiente paso).
- **"Envíate un mensaje" como momento de activación** (respond.io con wa.me; Kommo muestra "Connected" y nada más: el momento nunca se prueba).
- La norma del mercado LatAm es concierge (Zenvia, Yalo, Treble pago) o "arréglate solo" (Cliengo "en menos de 30 minutos"): un autoservicio que se comporte como concierge es el diferencial.

### 5.3 Ciencia del onboarding y de la salud de configuración

- **Divulgación progresiva** (NN/g): pocas opciones primero, nunca más de dos niveles. **Wizards** (NN/g): pasos etiquetados, defaults de respuestas previas, salir y retomar con estado. **Defaults** (NN/g, Joachims 2005): la mayoría nunca los cambia; optimizar el default.
- **Tutoriales que interrumpen no mejoran el desempeño** (NN/g): las revelaciones contextuales sí; **los tours no deben auto-dispararse**; tours lanzados por la persona completan 67 % vs 31 % (Chameleon 2025, 550M interacciones); completitud cae con cada paso: ~65 % con 1, ~50 % con 4, <40 % con 5+.
- **Progreso dotado** (Nunes & Drèze 2006, 300 tarjetas): 19 % → 34 % de completitud por empezar con dos sellos. Empezar el checklist en 0 % desperdicia el efecto.
- **Shopify setup guide**: 3 pasos esenciales, un solo paso expandido a la vez, toast al completar, la guía **reemplaza las métricas** hasta lanzar y luego desaparece; las tarjetas con tareas operativas **no se pueden descartar**; los insights se limitan a 3 por día con caducidad de 24 h.
- **Una guía a la vez** (Chameleon rate limits): un presupuesto por persona y sesión; los avisos críticos y los tours lanzados por la persona quedan exentos.
- **Modales**: solo texto completa 44 %, con video 21 %; 38 % cierra en 4 s. Nada de video explicativo en el camino crítico.
- **Superficies de salud**: Lighthouse usa **3 bandas** y separa "oportunidades" que no mueven el puntaje; **Google Ads** es el anti-patrón (descartar una recomendación sube el puntaje igual que aplicarla); Meta agrupa por urgencia y solo "restringido" detiene la entrega; Intercom muestra recomendaciones con impacto y lotes semanales; Zendesk mezcla preparación y desempeño (el hueco a evitar).
- **Benchmarks con salvedad**: activación mediana 37,5 % (Userpilot 2025, n=62), completitud de checklists 19,2 % (n=188), TTV mediano 1 día 12 h; todo con sesgo de muestra del proveedor.

Referencias con URL en `workdir/r_ai.md`, `r_latam.md`, `r_science.md`.

---

## 6. Diseño objetivo: tres cosas separadas

> **La experiencia completa está diseñada en `docs/onboarding-experience-design-2026-09.md`** (anatomía de cada paso, receta del negocio como motor de sugerencias, día 0 en seis pasos con los cinco canales, el después como tarjetas, matriz multicanal y decisiones D9-D14). Esta sección conserva el esqueleto y las reglas medibles que aquel documento desarrolla.

### 6.1 Principios (medibles)

| # | Principio | Cómo se comprueba |
|---|---|---|
| P1 | **Una sola versión en el día 0.** Lo que la persona escribe llega al agente vivo hasta que exista una conversación real; borradores y publicación son modo avanzado | El asistente no llama a `saveAgentDraft`; `agent_personas` refleja el nombre a los 2 s |
| P2 | **Una sola guía por pantalla, incluidas las interrupciones.** Mientras `onboardingStage < live` no se renderizan banner de prueba, PWA, banner rojo, mascota, KPIs ni ayuda plegada | Conteo de superficies en el asistente = 1 (el paso) |
| P3 | **Sin jerga en el día 0-7.** Encendido/apagado, no publicar/borrador/candidato/versión operativa | `grep` de esas palabras en `setupWizard.*`, `qualityHealth.setup.*`, `help.dashboard/setupWizard` = 0 |
| P4 | **Preguntar, no sembrar.** Si no hay dato del dueño, el agente dice que no sabe y la pantalla pide el dato; no se siembran FAQs placeholder | "Otro" nace sin FAQs esquivas y con un paso que pregunta |
| P5 | **Pequeñas victorias verificables.** Cada paso termina con algo que se ve: el agente contesta en el chat, WhatsApp muestra "conectado", el propio mensaje es respondido | Eventos `onboarding.step_completed` con timestamp |
| P6 | **Nada se pierde.** Autoguardado en el asistente; guardia de cambios sin guardar en el editor; errores en rojo junto al campo | `beforeunload` presente; toast tipado; `fields` reenviado como `{path}` |
| P7 | **Una sola verdad de "listo".** La tarjeta, el editor, Inicio y el asistente derivan del mismo objeto y del mismo vocabulario | Un `resolveOnboardingGuide` + `assessment.tasks` filtrado a esenciales; cero heurísticas paralelas |
| P8 | **El semáforo solo sube con estado verificado**, nunca por descartar | Ninguna acción de snooze/dismiss cambia la banda |
| P9 | **Ayuda justo suficiente y siempre vigente**: ≤3 tips y ≤60 palabras por pantalla; cada botón citado existe como valor i18n; tours ≤4 pasos | Spec de existencia de etiquetas; spec de presupuesto |
| P10 | **Primero el celular.** Todo el día 0 cabe a 390 px sin overlays | Playwright a 390 px |

### 6.2 El día 0: "Conoce a tu agente" en cuatro pantallas (≤ 10 minutos propios, aha en la segunda)

Reutiliza lo que existe (alta de 4 pasos, bootstrap vertical, chat de prueba, rutas de WhatsApp, tarjeta, tours). Es cableado y borrado, no construcción nueva, salvo la pantalla 1.

**Pantalla 1 — "¿Qué vendes?" (3 min).** Cuatro respuestas concretas, prellenadas por la industria y editables, que se escriben en los campos que el prompt ya lee:
- *Qué ofreces y desde cuánto* → 3-5 servicios con precio (tabla `services`; para academias: "Clase de prueba", "Mensualidad", "Clase personalizada").
- *Dónde estás* → `companies.address` (hoy nunca se pide).
- *Cuándo atiendes* → horario del negocio (con default sabio por industria) y, si agenda, disponibilidad (evita el "no hay disponibilidad").
- *Cómo se reserva o compra* → sí/no agenda; si sí, crea el servicio y el bloque de disponibilidad (cierra el hueco de "pidió agendar y quedó apagado").
Para "Otro": las mismas cuatro preguntas sin siembra; nada de FAQs esquivas.

**Pantalla 2 — "Conoce a {Nombre}" (2 min, AHA).** Nombre humano por industria (agregar los 9 que faltan), saludo, y a la derecha el chat de prueba con **tres chips**: "¿Cuánto cuestan las clases?", "¿Dónde quedan?", "Quiero reservar una clase de prueba". El agente responde con lo de la pantalla 1. Todo escribe **directo al agente vivo** (P1). Sin paneles arriba, sin misión, sin versiones. Fallback y reglas no se muestran aquí: vienen de la plantilla y se editan después.

**Pantalla 3 — "Conecta WhatsApp" (5 min propios).**
- Una pregunta de triage: *"¿Dónde vive hoy tu número?"* → (a) en la app WhatsApp Business de un celular → coexistencia; (b) es un número nuevo o sin WhatsApp → número nuevo; (c) ya lo usa otro proveedor de API → migración con un plan de una línea ("pídele a tu proveedor apagar la verificación en dos pasos; mientras tanto sigue probando aquí"); (d) no tengo número a mano → número de prueba de Meta (si D4 lo habilita) o "Conectar después".
- Requisitos en tres líneas por ruta, sin sincronización/limitaciones/velocidades (eso va a "Ver detalles").
- Botón único; mientras la ventana de Meta está abierta, un texto vivo ("Si ves un error ahí, ciérrala y te decimos qué hacer") y un enlace **Cancelar**; el error final mapea "número ya registrado" → ofrece coexistencia/migración en un clic.
- "Conectar después" deja huella y dice explícitamente: "puedes seguir probando a {Nombre} aquí" + enlace de demo compartible (widget web) para mostrárselo a un socio.

**Pantalla 4 — "Escríbele" (1 min).** wa.me al número conectado + estado en vivo "esperando tu mensaje…" que cambia a celebración cuando el agente responde de verdad. **Ese primer mensaje real respondido es el fin del onboarding** y la métrica de activación. Cierre: "Esto es lo que {Nombre} ya sabe; esto es lo que puedes mejorar cuando quieras" → Inicio con la tarjeta de 3 esenciales o, si ya está todo, directamente la tarjeta de salud.

**Reglas del contenedor:** ninguna otra superficie mientras `onboardingStage < live` (P2); Esc guarda y recuerda; retomar desde Inicio con "Continuar donde quedaste (paso 3 · 5 min)"; sin voseo; a 390 px.

**Inicio durante el día 0:** solo la tarjeta, con **3-4 esenciales** (conectar WhatsApp · confirmar qué vende y dónde · una persona que reciba los chats · [si agenda] confirmar horario), el siguiente expandido con su tiempo y una sola acción; el resto va al panel de salud. Sin KPIs en cero, sin "router ahorra 42 %".

### 6.3 Día 1+: el editor vuelve a ser un editor

- **Sin paneles arriba.** `AgentDraftStatus` y `AgentAssessmentPanel` salen del editor y del asistente; en su lugar, una línea de estado ("Encendida · atiende WhatsApp · última respuesta hace 3 min") y, si falta algo esencial, **una** lista de hasta 5 ítems con enlace al campo (el `AgentReadinessBanner` ya sabe hacerlo).
- **Header con dos acciones** (Guardar, Probar) y un menú "Más" para lo experto (candidatos, publicaciones, aprender, fallos, plantilla). "Cambiar plantilla" pide confirmación.
- **Borradores, candidatos y publicación como modo avanzado**, activado por el dueño o automáticamente cuando el agente ya tiene conversaciones reales (donde una publicación revisada sí protege a clientes). Vocabulario: encendido/apagado.
- **Campos de texto con opciones para elegir**: 2-3 chips debajo de fallback, saludo, reglas y motivos de escalado (reutilizar el componente de tarjetas de tono); las reglas semilla en tuteo neutro y con el vocabulario del rubro (clase, alumno, sede; no prospecto, stock, pedido).
- **Chips de canal → interruptores con etiqueta** ("Atiende WhatsApp · Sí/No"), aviso de cambios sin guardar en la barra fija, confirmación al quitar el único canal; la fila de un canal sin conexión ofrece **Conectar**, no "Quitar".
- **Herramientas**: cada tarjeta muestra "N cargados · Cargar" (el patrón de Citas); upsell, e-commerce, órdenes, intensidad y descuento bajo Avanzado salvo que la industria lo recomiende; "Cobros — tu plan no incluye" fuera del día 0.
- **"Protecciones de seguridad"** a un plegable "Lo que nunca hará" al final, sin rojo.
- **Horario** dentro del editor edita el horario del negocio (o lo muestra y ofrece "usar el horario del negocio" en Citas), no una pestaña vacía.
- **Búsqueda global** con palabras clave por ruta (agente: identidad, nombre, saludo, personalidad) y el CRM renombrado "Identidad de contactos".

### 6.4 El panel de salud: "Salud de {Nombre}" en cuatro preguntas

Una sola pantalla (`/admin/agent/quality` reencuadrada) y la misma verdad en la tarjeta de Inicio. Los datos ya existen: checks con `href` y evidencia, snapshots y señales, evaluaciones, pilar de producción, disponibilidad humana, `VerticalReadinessService`. Falta reencuadrarlos por pregunta y en lenguaje llano.

1. **¿Puede atender hoy?** Semáforo de tres bandas, derivado **solo** de estado verificado: rojo = no responde (sin canal conectado/asignado, apagada, sin ruta humana), naranja = responde pero pierde ventas (no sabe precios/dirección/horario, agenda pedida y apagada, sin persona activa), verde = lista. Nunca sube por descartar; "crítico" en rojo se reserva para regresiones de algo que funcionaba (las señales ya guardan `agent_config_version`).
2. **¿Qué sabe responder?** Las preguntas típicas del rubro con ✔/✖ ("¿cuánto cuesta?", "¿dónde quedan?", "¿qué horario?", "¿puedo reservar?") y un botón "Enséñale la respuesta" que crea la FAQ/servicio; fuentes cargadas; qué puede hacer (agendar, cobrar, mostrar catálogo) según `ReadinessReport.unmet` por intención.
3. **¿Cómo le fue con clientes reales?** Respondidas, pasadas a una persona, reservas; preguntas sin respuesta agrupadas (el pilar de producción ya las calcula) → cada una con acción; "evidencia insuficiente" en vez de cero.
4. **¿Qué hago ahora?** Máximo 3 recomendaciones con impacto ("afecta a 12 conversaciones"), no descartables si son rojas, posponer solo naranjas; lotes semanales para las de conocimiento.

Mapa de checks → ítem llano (base para implementar): `agent_active` → "Está encendida"; `channel_assignment + channel_connection + channel_coverage` → "WhatsApp recibe mensajes" (→ Canales); `fallback_message` → "Sabe qué decir cuando no sabe" (→ editor `?focus=fallback`); `handoff_triggers + human_handoff_route` → "Cuándo pasa a una persona y quién la recibe" (→ editor + Usuarios); `business_identity/contact/hours` → "Sabe qué es tu negocio, dónde está y cuándo atiende"; `knowledge_coverage/rag/faqs/policies` → "Lo que puede responder"; `tool_appointments` (+services/slots) → "Puede agendar"; `tool_catalog/ecommerce/offers` → "Puede vender/mostrar catálogo"; `media_privacy_policy` → "Puede recibir fotos y audios"; `llm_limits/brand_voice/greeting/forbidden_topics/language` → "Ajustes finos" (nunca en el día 0). Pilares, dimensiones, pesos, snapshots y trials quedan bajo "Detalle técnico".

**Métricas para el dueño de Parallly** (hoy inexistentes): eventos por paso del asistente, clic por ítem de la tarjeta, inicio/fin de tour, primera respuesta en el chat de prueba, canal conectado, primer mensaje real; embudo por `onboardingStage` agregado; tiempo a cada hito. Sin esto no se puede saber si el rediseño funciona.

### 6.5 Ayuda "justo lo necesario y siempre vigente"

- **Una fuente**: los tips citan etiquetas por su clave i18n (o se generan desde ella); un spec falla si un tip nombra un botón, pestaña o ruta que no existe; el spec actual que exige "publicar" se invierte para las superficies del día 0 y se conserva solo su aserción negativa.
- **Presupuesto**: ≤3 tips y ≤60 palabras por panel; tours ≤4 pasos; cero ayuda en el día 0 fuera del propio paso; Inicio y asistente reciben `tourId` (`home_first_steps`, `resume_setup_wizard`).
- **Limpieza**: borrar `helpAssistant.*` muerto en 4 idiomas, `mediaKey` sin asset, el tour onborda; corregir los tips con deriva (Identidad, Principal, Costo IA Hoy, Configuración → IA, Email/SMS como canales, "elimínalo de la app").
- **KB de Assist**: marcar SMS como retirado (o gatear por flag en el loader), reescribir 07 y 26 con el vocabulario vigente, regla de contrato "todo artículo que cite una función con flag declara su estado".
- **Trato**: tuteo en toda copia nueva; barrer el voseo de las reglas semilla y del pre-check de WhatsApp.

---

## 7. Plan por olas

### Ola 0 — plomería y "quitar" (esta semana y la próxima; XS/S; sin decisiones de producto)

1. Toast tipado `{message, type}` en el editor (rojo + triángulo para bloqueos) — `[agentId]/page.tsx:1041-1043`.
2. `readFieldErrors` acepta cadenas y objetos; el editor mapea `behavior.rules` → pestaña Instrucciones y marca la fila vacía — `lib/api.ts:2844-2855`, `[agentId]/page.tsx:496-508`.
3. Al guardar, descartar filas vacías de reglas/temas/motivos (`trim` + filtro) en cliente y en `updateAgent`.
4. Guardia `beforeunload` + aviso in-app de cambios sin guardar en el editor.
5. Desmontar `AgentDraftStatus` y `AgentAssessmentPanel` del asistente; en el editor, ocultarlos mientras `onboardingStage < live`.
6. Gates por etapa: banner rojo de calidad en todas las páginas, PWA, banner de prueba, KPIs e ayuda plegada de Inicio, burbuja de la mascota en asistente y editor.
7. Tarjeta a 3-4 esenciales, siguiente expandido, tiempo estimado, banner ámbar fusionado con el ítem de canal; el resto al panel de salud.
8. No sembrar los 5 canales; asignar al conectar; fila "sin conexión activa" → botón "Conectar".
9. Nombres humanos para las 9 industrias sin nombre; subtipo "academia/clases" (education) con servicios y disponibilidad sembrados.
10. Copy: los tres textos del asistente que hablan de publicar; tip 6 y "pestaña Identidad"; "router ahorra 42 %"; slugs `web_widget` → etiquetas; "Protecciones" a plegable; voseo del pre-check.
11. `keywords` en el contrato de navegación; CRM "Identidad de contactos".
12. WhatsApp: texto vivo + Cancelar mientras la ventana está abierta; error "número ya registrado" → ruta sugerida; bloque "Probar sin WhatsApp" en el muro, en "Conectar después" y en la página desconectada.

**Listo cuando:** en un tenant nuevo el asistente muestra 1 superficie por paso, el editor no pierde trabajo con una regla vacía, la tarjeta tiene ≤4 ítems, y `grep` de borrador/publicar/candidato en `setupWizard.*` da 0.

### Ola 1 — el día 0 de cuatro pantallas (2-3 semanas; M; decisiones D1-D5)

Pantalla 1 nueva; pantalla 2 con chips de prueba y escritura directa al agente vivo; triage de WhatsApp; pantalla 4 "Escríbele" con estado en vivo; eventos de instrumentación y embudo por etapa; Playwright a 390 px.

**Listo cuando:** aha (respuesta en el chat) < 3 min desde el alta; WhatsApp conectado < 8 min propios cuando hay requisitos; primer mensaje real respondido registrado como activación; cero pérdidas de trabajo en el guion manual.

### Ola 2 — editor y panel de salud (3-4 semanas; M/L; decisiones D6-D8)

Editor sin capas y con "Más"; modo avanzado para borradores/publicación; tarjetas de herramientas con "N cargados"; panel de salud de cuatro preguntas con el mapa de checks; sistema de ayuda con contrato y presupuesto; limpieza de KB y de `helpAssistant`.

**Listo cuando:** una persona sin conocimientos técnicos completa el guion de 14 pasos del plan de septiembre (§15) en celular y escritorio sin llamar a soporte, y el panel de salud responde las cuatro preguntas sin una sola palabra de la lista de jerga.

---

## 8. Decisiones que necesito del dueño

| # | Decisión | Choca con | Mi recomendación |
|---|---|---|---|
| D1 | En el día 0 (hasta la primera conversación real) el asistente y el editor escriben **directo al agente vivo**, sin borrador ni publicación | `d50d1670`, `cb9088cb` ("Reactivation belongs to publication") | Sí. La revisión protege a clientes que todavía no existen; hoy solo impide que el nombre llegue al agente |
| D2 | La **misión** y las **pruebas** no cuentan para "listo para atender" en el día 0 (pasan a "mejorar después") | `64e6e936`, `5deee1bd` (roll-up honesto) | Sí. Separar "puede atender" (checks críticos verificados) de "puede ser mejor" (warnings) |
| D3 | **"Crítico" en rojo solo para regresiones** de algo que funcionaba; el setup incompleto es guía, no alarma | plan sep §2 (banner solo apagado en `/admin`) | Sí |
| D4 | Reabrir el **número de prueba**: Meta documenta números 555 gratuitos dentro del ESU; probar con nuestro `config_id` en un tenant real | decisión del 4-sep | Sí, una prueba de una hora decide |
| D5 | **Vertical para academias/clases** y política para "Otro": preguntar en la pantalla 1 en vez de sembrar FAQs | `95f758f3` (esquivar en vez de inventar) | Sí; no contradice el espíritu de no inventar |
| D6 | **Vocabulario**: encendido/apagado en toda la UI del día 0-7; publicar/borrador/candidato solo en modo avanzado | `6f02b278` (spec que exige "publicar") | Sí; invertir el spec |
| D7 | **Presupuesto de interrupciones**: una sola guía por pantalla, incluidos banner de prueba, PWA y mascota mientras `onboardingStage < live` | scope del plan de sep (no clasificó esas superficies) | Sí |
| D8 | **Tarjeta de puesta en marcha** con 3-4 esenciales; misión, pruebas, catálogo y horario al panel de salud | `751d23e7`, `b5b71b60` | Sí |

---

## 9. Lo que no se verificó y los límites

- Nada se ejecutó en producción. La industria real del tenant "Go Entertainment SAS" se infiere de la pantalla (04:12 "Industria: Otro") y de que las listas que leyó son exactamente las de `tpl_otro_ventas`; conviene confirmarla en la base.
- La causa exacta de los dos fallos de Meta necesita el registro `whatsapp_onboarding` del tenant y los logs del 14-sep; desde el código solo sabemos que el SDK devolvió sin código de autorización dos veces en menos de 12 segundos.
- Los conteos de palabras son estimaciones desde `es.json`; el conteo de superficies viene de fotogramas cada 12 segundos (un toast puede haberse perdido entre fotogramas).
- Los tiempos del transcript están adelantados; la evidencia de audio depende del transcript del agente anterior (no se re-transcribió).
- Los referentes se leyeron de documentación pública; las cifras de proveedores (Userpilot, Chameleon) tienen sesgo de muestra y así se citan.
- No hay datos propios de embudo: hasta implementar la instrumentación (§6.4) el efecto de cualquier cambio se medirá con guiones manuales.

---

## Apéndice A — Hallazgos verificados (críticos y altos)

| Id | Veredicto | Ámbito | Hallazgo | Evidencia principal | Ola |
|---|---|---|---|---|---|
| EF-1 | V-c | día 0 | "Otro" nace genérico: Asistente, sin servicios, sin agenda, FAQs que esquivan (siembra deliberada para no inventar) | `vertical-definitions.ts:1299,530-555`; `persona.service.ts:2860-2882` | 0/1 |
| EF-3 | V-c | día 0 | No se piden precio, dirección, horario ni reserva; el prompt los leería | `onboarding/page.tsx:765-782`; `prompt-assembler.service.ts:265-269` | 1 |
| EF-2 | **R** | día 0 | (refutado) el nombre vertical no se pisa; lo que falta son nombres en 9 industrias | `onboarding-persona-resolver.ts:236-258` | 0 |
| EF-5 | V-c | cruzado | Pidió agendar y quedó apagado sin aviso; el check lo reporta `not_applicable` | `persona.service.ts:3122-3131`; `verticals.service.ts:2724-2747`; `agent-quality.service.ts:980` | 1 |
| V1-02 | V | día 0 | Los 5 canales asignados por defecto sin conexión | `persona.service.ts:3136-3145` | 0 |
| AE-07 | V-c | día 0 | "Instrucciones principales" vacío (las reglas sí se siembran) | `verticals.service.ts:1921-1968` | 0 |
| W2-01 | V-c | cruzado | Dos paneles de versión/misión encima del stepper en los 3 pasos | `setup-wizard/page.tsx:501-507` | 0 |
| W2-03 | V-c | día 0 | El asistente escribe en un borrador que nadie publica; "Listo" dispara un tour de 5 paradas | `setup-wizard/page.tsx:328-339,440-463`; `guided-tours.ts:173-179` | 1 (D1) |
| W2-04 | V-c | día 0 | El copy dice "responde después de publicar"; el runtime responde con el agente activo | `serving-persona.ts:14-18`; `es.json:6699,6718` | 0 |
| W2-02 | V-c | salud | Misión "pendiente" por diseño → "no está listo" en todo agente de plantilla | `agent-assessment.service.ts:212,241-245` | 0 (D2) |
| R6-03 | V-c | cruzado | Roll-up "la parte menos avanzada habla" por diseño | `agent-operational-state.ts:77-78,142-150` | 0 (D2) |
| R6-02 | V-c | día 0 | La evaluación es de la versión operativa; el borrador nunca se evalúa | `agent-assessment.service.ts:175-178` | 0 |
| R6-01 | V-c | cruzado | Vocabulario compartido existe desde el 8-sep; la contradicción vigente es "Atendiendo" vs "pendiente" | `AgentDraftStatus.tsx:32`; `[agentId]/page.tsx:776` | 0 |
| R6-04 | V-c | día 0 | Banner rojo "acción crítica" en todas las páginas salvo 3 | `agent-quality.service.ts:1178-1187`; `QualityAttentionBanner.tsx:79-83` | 0 (D3) |
| AE-01 | V | cruzado | Todos los avisos de bloqueo se pintan verdes con check | `[agentId]/page.tsx:1041-1043` | 0 |
| — | V | cruzado | Cadena de pérdida de trabajo: regla vacía → `agent_invalid` → `fields` filtrado → sin campo rojo → sin guardia | `BehaviorSection.tsx:53-54`; `persona.service.ts` `optionalTextList`; `lib/api.ts:2844-2855`; `[agentId]/page.tsx:496-508` | 0 |
| AE-02 | V-c | cruzado | Chips de canal como botones desnudos sin confirmación ni indicador | `[agentId]/page.tsx:315-319,869` | 0 |
| AE-05 | V | cruzado | El interruptor solo apaga; encender exige publicar sin enlace | `[agentId]/page.tsx:420-424,763` | 0 |
| AE-03/04 | V | cruzado | 5 bloques de guía + 6 acciones expertas antes del primer campo | `[agentId]/page.tsx:623-708` | 0/2 |
| H4-01 | V-c | cruzado | Tarjeta de 8-10 ítems; misión primero; misión y catálogo sin tour; `completed` nunca se escribe | `agent-assessment.service.ts:241-308`; `InitialSetupCard.tsx:137` | 0 (D8) |
| H4-02 | V-c | día 0 | 5-7 superficies en Inicio sin canal | `admin/page.tsx:441-451,536-551,707-709`; `layout.tsx:207-244` | 0 (D7) |
| H4-03 | V-c | día 0 | PWA sin gate de etapa | `InstallPrompt.tsx:43-52,91-100` | 0 |
| H4-05/06 | V | día 0 | Sin siguiente visible, sin tiempo, "esenciales" ×9 | `InitialSetupCard.tsx:140-160`; `es.json qualityHealth.setup` | 0 |
| H4-09 | V-c | salud | Sin embudo por paso ni tiempo a primera respuesta; `onboardingStage` nunca agregado | `tenants.service.ts:2022-2064`; `financials.service.ts:228-282` | 1 |
| L5-01 | V-c | día 0 | Sin triage; coexistencia por defecto; migración tercera | `whatsapp-connect-routes.ts:42-75`; `page.tsx:69` | 1 |
| L5-02 | V-c | día 0 | Sin salida ni Cancelar con la ventana abierta (por diseño); error sin diagnóstico | `WhatsAppEmbeddedSignup.tsx:558-570,594-597` | 0 |
| L5-03 | V-c | cruzado | El chat de prueba existe un paso antes del muro y nadie lo señala | `setup-wizard/page.tsx:608-616,684-701` | 0 |
| L5-04/05 | V | día 0 | Pre-check ceremonial; ~450 palabras; ayuda que contradice las rutas | `WhatsAppPrerequisites.tsx`; `es.json help.channelsWhatsapp` | 0 |
| H7-01 | V-c | día 0 | Tip 6 ambiguo ("Arriba") con 5 verbos; "pestaña Identidad" inexistente | `es.json:9271`; `[agentId]/page.tsx:700-783` | 0 |
| H7-03 | V-c | cruzado | El spec de i18n exige "publicar" en la ayuda (regex sobre 4 claves) | `i18n-parity.spec.ts:124-140` | 0 (D6) |
| H7-04/05/06/07 | V | varios | Tips con rutas de super_admin y nombres inexistentes; 1.587 palabras muertas; KB con SMS y sin borradores | `es.json help.*`, `helpAssistant.*`; `kb/assistant/es/13,07,26` | 2 |
| V1-04 | video | día 0 | Lista roja de 13 protecciones permanente bajo el lienzo vacío | `es.json:4451-4452` | 0 |
| V2-F1 | video | cruzado | Pérdida silenciosa de 15 min de trabajo | fotogramas 31:48-32:24 + cadena de arriba | 0 |

Los 64 hallazgos originales, con severidad, ámbito y tamaño de arreglo, están en `workdir/all_findings.md`; los medios y bajos no pasaron por refutación y se marcan `[sv]` allí.

## Apéndice B — Qué queda de los dos documentos anteriores

- `docs/onboarding-video-transcript-analysis.md`: válido como voz de la usuaria y como índice de momentos; corregir los tiempos (+1,5-2 min), el fallback prellenado, la ubicación de las asignaciones, el color del aviso y la narración de la ventana de Meta; le falta el hallazgo más grave (pérdida de trabajo).
- `docs/onboarding-ux-benchmark-and-video-audit.md`: la premisa (LEGO, cero prompts, sandbox antes de Meta, estación de reanudación) coincide con lo que dicen los referentes verificados; sus cifras no tienen fuente y una está contradicha; su plan técnico (§7) ignora que el asistente de 3 pasos, la tarjeta y los tours ya existen y que el problema actual son las capas del 6-14 de septiembre, no la ausencia de un flujo.

## Apéndice C — Fuentes externas

Ver `docs/onboarding-diagnosis-2026-09-workdir/r_ai.md`, `r_latam.md` y `r_science.md` (cada patrón con la URL que se abrió y su grado de confianza). Las más relevantes: Meta Embedded Signup y coexistencia (developers.facebook.com), Wati ESU troubleshooting y número gratuito, Kommo coexistencia, respond.io quick start, Intercom deploy Fin y content recommendations, Chatbase quick start, Crisp Hugo getting started, Landbot "Build it for me", NN/g (progressive disclosure, wizards, defaults, onboarding tutorials, empty states, progress indicators), Baymard inline validation, Shopify setup guide y Home, Chameleon benchmark 2025 y rate limits, Userpilot benchmark 2025, Google Ads optimization score y su crítica, Lighthouse scoring, Coglode (Nunes & Drèze 2006).
