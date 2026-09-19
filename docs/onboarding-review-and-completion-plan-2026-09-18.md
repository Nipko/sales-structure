# Revisión del onboarding y plan de cierre — 18 de septiembre de 2026

Estado histórico: diagnóstico y propuesta previos a la implementación. El trabajo posterior y sus límites de lanzamiento están registrados en el [cierre de implementación del 18 de septiembre](onboarding-implementation-closeout-2026-09-18.md). No se ha desplegado.

Actualización de producto posterior, en la misma fecha: la [propuesta de experiencia v2 con investigación](onboarding-experience-plan-v2-2026-09.md) revisa el objetivo, recorrido, métricas y orden de validación. Este documento sigue siendo el diagnóstico del repositorio; su secuencia técnica debe leerse junto con v2, que antepone probar la experiencia con dueños a ampliar el editor por tarjetas. No implica aprobación o implementación de las enmiendas.

## Conclusión

Hay una base técnica importante que conviene conservar. Se corrigieron obstáculos reales de guardado, precios, conexión, asignación y ruido visual. Sin embargo, la experiencia aprobada todavía no está completa: el recorrido sigue siendo el alta de cuatro pasos más un asistente de tres pasos, las recetas apenas se utilizan en la pantalla de conexión y faltan las tarjetas guiadas, la comprobación visible de la primera respuesta y el panel de salud del diseño.

No corresponde expresar el avance como un porcentaje global: existen componentes y pruebas terminados, pero varias partes centrales aún no forman un recorrido completo.

## 1. Intención recuperada y fuentes

Se revisaron la conversación local original con Claude, sus notas de continuidad, los documentos, el historial Git, el código actual y el trabajo sin commit. La instrucción original fue construir una experiencia para personas sin conocimientos técnicos, con una decisión por pantalla, explicación del porqué, ejemplos completos que puedan aceptar o cambiar y pequeñas victorias verificables. Debe cubrir WhatsApp, Instagram, Messenger, Telegram y chat web. El dueño aprobó las 26 recomendaciones y pidió commits incrementales, cuidar el ecosistema y actualizar Parallly Assist.

Los tres resultados distintos siguen siendo:

1. Puesta en marcha sencilla hasta ver responder al agente.
2. Edición posterior igualmente sencilla.
3. Salud del agente: qué funciona, qué falta y qué conviene mejorar.

Fuentes principales:

- `docs/onboarding-experience-design-2026-09.md`: experiencia objetivo, seis pasos, editor y salud.
- `docs/onboarding-decisions-2026-09.md`: D1–D26 y bitácora de olas.
- `docs/onboarding-diagnosis-2026-09.md`: evidencia de la grabación y causas raíz.
- Conversación local de Claude del 16–18 de septiembre: aprobación, auditoría posterior y punto de interrupción.

El plan técnico de mayo y las auditorías de junio/julio son antecedentes. No deben dirigir la continuación por encima del diseño y decisiones de septiembre. También hay descripciones históricas dentro de los documentos actuales que ya no describen el código vigente.

## 2. Dónde quedó el trabajo

- Rama: `feat/onboarding-guided-experience`.
- HEAD: `e95b7899`, del 18 de septiembre.
- Siete commits por encima de `main` local: base inicial y olas 1–6.
- En el inicio de esta revisión: 152 rutas modificadas y 44 entradas sin seguimiento, incluidas carpetas. Corresponden principalmente a la ola 7 y al inicio de la 8.
- Claude se interrumpió al revisar el artículo 03 de Telegram de la base de conocimiento. La pantalla había cambiado sus etiquetas, pero el artículo seguía nombrando botones anteriores.
- La ola 7 tiene implementación y pruebas, pero no su commit ni evidencia de la ejecución final completa de las compuertas después de todos sus ajustes.
- La ola 8 comenzó con contrato, tabla y utilidades de eventos; no está conectada al producto.
- El historial local y las notas indican trabajo sin desplegar. Esta auditoría no inspeccionó el estado actual de producción ni consultó el remoto para certificarlo.

## 3. Estado por resultado

| Resultado | Evidencia actual | Qué falta para considerarlo terminado |
|---|---|---|
| Guardar cambia al agente que atiende | Modo inmediato por defecto, revisión opcional, control de versiones y protección de asignaciones | Integrarlo con guardado por tarjeta, recuperación y UX del nuevo recorrido |
| Precios de ejemplo seguros | Estados ejemplo/confirmado/a cotizar, protección de respuestas y reparación de semillas antiguas | Completar captura guiada y auditar moneda en todos los caminos afectados |
| Día 0 con menos interrupciones | Ocultamiento de superficies, cuatro esenciales, simplificación de Inicio/editor | Mantener una guía hasta la primera respuesta, incluso cuando los esenciales ya estén completos |
| Cinco canales | Triage de WhatsApp, errores accionables, orden por receta/plan, gate de correo, enlace público | Pruebas reales de proveedores, coherencia del enlace como canal y reanudación por canal |
| Recetas por negocio | Contrato, lint, seis familias de contenido de industria, capas de subtipo y generador de Otro | Aplicarlas al agente y a las tarjetas; completar cobertura editorial y validar con dueños |
| Activación real | `firstReplyAt` y separación respecto a terminar el asistente | Corregir el enlace público con plan y mostrar al dueño la respuesta real |
| Cambiar con Assist | Entrada “Dime qué cambiar” y propuestas adaptadas al modo de guardado | Integración final por tarjeta, contexto y comprobación del cambio servido |
| Editor y salud del diseño | Existen datos, editor, evaluación y componentes reutilizables | Reorganización por preguntas del dueño y salud en cuatro preguntas |
| Medición del recorrido | Tabla/migración, tipos, saneamiento y writer de eventos | Emisores, endpoint, consultas, embudo, pruebas e incorporación a CI |
| Historial, foto, voz y ensayo automático | Motores previos reutilizables | Experiencias del onboarding y confirmación de datos extraídos |

La cobertura documentada de recetas es 38 de 104 ámbitos evaluados por el lint, a partir de seis industrias; no significa 38 recetas independientes validadas por usuarios. El denominador incluye subtipos y entradas del registro, y no debe confundirse con las 18 verticales canónicas. La cobertura editorial debe medirse aparte de los errores técnicos.

## 4. Hallazgos que cambian el plan

### A. Falta conectar la receta con lo que ve el dueño y lo que responde el agente

El asistente sigue declarando `agent`, `connect`, `done` (`apps/dashboard/src/app/admin/setup-wizard/page.tsx:96`). Pide la receta, pero extrae recomendaciones de canales (`:285`). El chat ofrece ejemplos genéricos y no recibe `testQuestions` de la receta (`_components/AgentTestChat.tsx:8`, `:106`). El editor conserva las pestañas Persona/Instrucciones/Herramientas/Horario (`apps/dashboard/src/app/admin/agent/[agentId]/page.tsx:1341`).

Sí existe autoguardado de nombre/saludo al perder foco y antes de avanzar; el chat se bloquea mientras hay cambios pendientes. Esta protección debe reutilizarse, no considerarse ausente.

En backend, el bootstrap lee `definition.agent` (`apps/api/src/modules/verticals/verticals.service.ts:1943`); no copia `recipe.mainInstructions` al comportamiento servido. El generador de Otro se dispara desde `GET /verticals/:tenantId/recipe` (`verticals.controller.ts:78`), no desde el alta. La ola 7 ya llama esa ruta: sería incorrecto repetir hoy que el generador nunca puede arrancar; lo pendiente es dispararlo en el momento correcto, recuperar su resultado y aplicarlo sin pisar cambios del dueño.

**Cambio propuesto:** construir juntos contrato de receta aplicada, guardado y tarjetas. Dibujar primero unas tarjetas desconectadas repetiría el problema de mostrar una configuración que el agente no utiliza.

### B. El enlace puede ser real para las cuotas y seguir siendo demo para activación

`widget.gateway.ts:304` distingue por plan el turno de prueba y habilita atención humana para el turno real (`:368`). `conversations.service.ts:5846` también distingue la cuota. Sin embargo, `:5954` y `:5966` pasan el indicador físico `options.demo` a la activación y `:6001` excluye todos esos enlaces, incluso si el plan permite chat web.

Además, el enlace no crea `channel_accounts` (`widget-demo-link.ts:142`) y `setup-status` cuenta esa tabla para conexiones (`persona.controller.ts:715`). Un negocio puede atender por su enlace y seguir recibiendo señales de que no conectó un canal.

**Cambio propuesto:** acordar una única definición de prueba frente a canal operativo y utilizarla en cuotas, derivación humana, estado de conexión, salud y primera respuesta. El chat de prueba interno y la demo sin derecho a chat web deben seguir separados de la activación comercial.

### C. El cierre sigue pidiendo otra persona aunque el dueño deba ser el receptor

D16 define al dueño como receptor inicial. La entrada que figura como D16 cerrado en la bitácora describe asignación del agente a canales, que es otro problema. Existe fallback de correo en el handoff, pero no equivale a mostrar y confirmar el destinatario.

`persona.controller.ts:735` considera equipo solo si hay más de un usuario activo. `done-step-essentials.ts:79` utiliza ese dato y `messages/es.json:7175` propone “Invitar a una persona”. Así un negocio unipersonal recibe una tarea que el diseño quería evitar.

**Cambio propuesto:** medir y mostrar “hay una persona que recibe los casos”, con el dueño por defecto y posibilidad de cambiarla. Invitar más usuarios debe ser una mejora opcional.

### D. Falta el momento visible de “ya respondió”

Registrar `firstReplyAt` no construye el paso “Que alguien le escriba”. Hace falta mostrar el canal, esperar una respuesta verificable, recuperar ese estado al recargar y explicar qué falta si todavía no llega.

Para canales distintos de WhatsApp, `done-step-channel.ts:68` convierte conectado en `answering`; la pantalla afirma que ya responde sin haber observado una respuesta. Es una brecha de evidencia en la interfaz, no un fallo de entrega reproducido en producción.

`home-day-zero.ts`, función `homeCardOwnsScreen`, devuelve el control al dashboard cuando los esenciales están completos aunque todavía falte esa primera respuesta. D8 también pasó en la bitácora a una lista de cuatro esenciales, mientras la recomendación aprobada hablaba de lo diferido y de un único siguiente paso.

**Cambio propuesto:** cuando los esenciales estén listos, la guía cambia a comprobar la primera respuesta. Después muestra salud y pendientes diferidos. El límite de tres días del modo silencioso debe documentarse como una regla de presentación, nunca como activación lograda.

### E. La medición existe como estructura, no como función

`packages/shared/src/onboarding-events.ts`, `apps/api/src/common/utils/onboarding-event.util.ts` y la migración `20260918100000_add_onboarding_events` están presentes. No hay llamadas desde los hechos del producto, controlador de recepción ni lector del embudo nuevo.

**Cambio propuesto:** instrumentar al construir cada paso. Definir desde el inicio primera respuesta de prueba, primer canal, primer mensaje real respondido, abandono y Usar así/Cambiar. Separar tiempo total de tiempo activo de configuración y de la espera externa del proveedor.

### F. Las compuertas no cubren automáticamente todo lo nuevo

`deploy.yml` enumera suites concretas de API, WhatsApp y dashboard, y no incorpora numerosas suites nuevas de onboarding. `candidate.yml` sí ofrece ejecución completa, pero su ejecución depende del flujo de candidato por SHA; no reemplaza un gate automático que no se invoca.

**Cambio propuesto:** guardar en el repositorio el conjunto reproducible de comprobaciones de esta entrega y asegurar su ejecución sobre el commit exacto que se vaya a desplegar. Un resultado histórico o un archivo de pruebas que existe no prueba el estado final.

### G. Ayuda, catálogo comercial y alcance deben cerrar con el producto

La KB 03 sigue describiendo “Ya tengo el token” y otros textos anteriores de Telegram (`apps/api/kb/assistant/es/03-canales-redes.md:60`). Los demás idiomas deben revisarse con el mismo criterio. Assist debe conocer solo funciones utilizables y etiquetas vigentes.

La bitácora también registra una tensión entre la recomendación Instagram para ciertos negocios y los canales del plan de prueba. Hay que verificar el catálogo runtime antes de decidir. Mostrar el candado es honesto, pero no resuelve por sí solo la fricción comercial.

El mini-triage de cuenta profesional de Instagram y permisos de Messenger descrito en el diseño tampoco está integrado al asistente: `SecondaryChannels.tsx:162` y `:217` abren los flujos de autorización. Después de conectar uno, el wizard deriva los demás a Canales; la opción de diferir sigue siendo global, no una decisión persistida por cada canal. Conectar uno primero puede ser un camino corto válido, pero hay que conservar las decisiones de los otros y describir esa experiencia con precisión.

La auditoría previa de Claude propuso retirar D4 (número de prueba de Meta) y reducir D26 (salud por WhatsApp) a notificación/correo. Eso debe quedar expresado en la matriz final como cambio de alcance, no como implementación de la propuesta original. No es necesario bloquear el recorrido central mientras se verifica D4.

## 5. Orden de ejecución propuesto

| Bloque | Entrega concreta | Criterio de salida |
|---|---|---|
| 0. Cerrar el trabajo abierto | Separar ola 7 de andamiaje de ola 8, resolver inconsistencias del enlace/receptor/ayuda, revisar regresiones y guardar commits acotados | Árbol explicable; validación reproducible; ningún bloque parcial presentado como terminado |
| 1. Contrato del recorrido y medición | Un único recorrido de cuenta → negocio → ejemplos → prueba → canal → respuesta real, reutilizando el alta existente; eventos y reanudación | Sin preguntas repetidas; prueba, conexión y activación son hitos distintos; métricas registradas |
| 2. Receta aplicada y tarjetas del día 0 | Qué ofrece/precios, dónde/cuándo, cómo compra/reserva, cinco preguntas; identidad, tono, fallback y receptor; Otro y extracción web con confirmación | “Usar así” cambia realmente al agente; precio no confirmado no sale al cliente; placeholders no cuentan como conocimiento |
| 3. Prueba y activación completas | Chips del rubro, prueba con configuración guardada, conectar o diferir por canal, “Que alguien le escriba” y cierre contextual | Primera respuesta real visible; recarga y otro dispositivo conservan avances; errores ofrecen una acción |
| 4. Edición posterior y salud | Reutilizar las tarjetas en el editor; Avanzado plegado; salud por canal en cuatro preguntas; Assist contextual | Configurar y corregir utilizan el mismo lenguaje; rojo por regresión verificada; máximo tres recomendaciones |
| 5. Cobertura y localización | Recetas/subtipos pendientes, disparadores en los cuatro idiomas, monedas, ayuda y propuestas de mejora | Cobertura declarada y validada; ningún importe de ejemplo ni moneda supuesta se presenta como dato confirmado |
| 6. Ayudas adicionales aprobadas | Ensayo con cliente simulado, foto, voz, historial, “Enséñale”, mejoras de Assist y resumen de salud con alcance explícito | Datos detectados requieren confirmación; ayuda opcional; no añade pasos obligatorios ni bloquea el camino corto |
| 7. Aceptación y entrega | Recorridos completos, revisión con dueños, validación real de canales, migraciones/rollback y entrega por commits | Evidencia del objetivo en celular y escritorio sobre la versión candidata |

Los números anteriores organizan resultados; no obligan a un único commit grande por bloque. La instrumentación, pruebas y actualización de Assist forman parte de cada entrega. El contenido y la revisión de monedas pueden avanzar en paralelo cuando no dependan de cambios de contrato.

No se propone reescribir el motor conversacional, sustituir el sistema de borradores/revisión ni reconstruir las integraciones ya existentes. La mayor parte del esfuerzo pendiente consiste en unirlas con contratos coherentes y completar la experiencia visible.

## 6. Aceptación del objetivo

1. Probar tres historias completas: academia que usa Instagram y tiene WhatsApp con otro proveedor; clínica con un único celular y WhatsApp personal; restaurante sin web. Añadir Otro y un país no cubierto por montos de ejemplo.
2. Primera respuesta de prueba en menos de tres minutos; configuración propia hacia un canal en menos de diez minutos. Registrar aparte las esperas de Meta, verificación y terceros. Son objetivos por medir, no resultados ya conseguidos.
3. A 390 px y escritorio: una guía principal, ejemplos utilizables, ningún texto técnico obligatorio y una acción comprensible ante cada error.
4. Salir, recargar, volver y cambiar de dispositivo conserva lo confirmado y lo diferido. Probar también una cuenta existente con borradores previos y múltiples agentes/conexiones.
5. El cliente recibe exactamente la configuración confirmada, el precio y moneda correctos, y el traspaso llega al receptor indicado.
6. Probar derechos runtime del plan, correo pendiente, cupos agotados, canal caído y lectura de estado fallida. Desconocido debe seguir siendo desconocido, no convertirse en éxito ni en una tarea inventada.
7. Una respuesta real cierra activación una sola vez. Una demo, mensaje humano o fin del asistente no la suplanta.
8. Validar recetas con dueños reales; la meta editorial del diseño es como máximo dos tarjetas corregidas de siete. Pruebas automáticas no sustituyen esta validación.

## 7. Verificación realizada en esta revisión

- TypeScript API y dashboard: pasan con `tsc --noEmit --incremental false`.
- API: 12 suites focalizadas, 182 pruebas aprobadas.
- Dashboard: 19 suites focalizadas, 327 pruebas aprobadas.
- Total: 31 suites, 509 pruebas aprobadas.
- Prisma: validación del schema aprobada con URLs locales ficticias, sin conectar ni migrar. El cliente Prisma local todavía no contiene el nuevo modelo de eventos; regenerarlo es preparación pendiente, no un fallo de compilación observado.
- El primer intento API agotó el heap por defecto; el reintento con 8 GB, como CI, pasó.

No se ejecutaron en esta revisión lint completo, build, bootstrap con infraestructura, migraciones, pruebas PostgreSQL ni Playwright. No se controló el navegador ni se repitió la grabación original; la evaluación visual se apoya en el diseño, análisis existente de la grabación y componentes examinados. Tampoco se probaron proveedores o producción.

Por tanto, el estado es: piezas focalizadas verificadas, experiencia completa pendiente y sin certificación de despliegue del árbol actual.

## 8. Trazabilidad de las decisiones

| Decisiones | Estado para planificar |
|---|---|
| D1 / D15: guardado inmediato y revisión opcional | Base implementada; mantener y extender a tarjetas |
| D2: esenciales de preparación | Implementado el recorte; corregir semántica de receptor y canal real |
| D3: rojo solo para regresiones | Limpieza parcial; falta cerrar salud y último estado bueno por canal |
| D4: número de prueba de Meta | Verificación externa y alcance pendiente; no bloquear el camino con enlace |
| D5 / D18: academias y Otro | Subtipos incorporados; completar experiencia de Otro |
| D6: vocabulario | Avance amplio; quedan textos/ayuda y superficies fuera del recorrido corto |
| D7 / D8: una guía e Inicio contextual | Parcial; falta transición a comprobación de primera respuesta y diferidos |
| D9: receta generada | Servicio existe; falta integración completa con alta, UI y agente |
| D10: precios de ejemplo | Base implementada; cerrar captura y regresiones del recorrido |
| D11 / D19: enlace y presupuesto de prueba | Implementados; reconciliar uso operativo, canal y activación |
| D12: multicanal | Parcial; cerrar mini-flujos, diferidos, aceptación real y coherencia comercial |
| D13 / D17: contenido y países | Parcial; cobertura editorial, localización y moneda restante |
| D14: tarjetas | Pendiente central, tanto en día 0 como en edición posterior |
| D16: quién recibe | Fallback existente; falta receptor explícito y corregir requisito de otro usuario |
| D20: Instagram sin página de Facebook | Texto/flujo revisado; falta evidencia de prueba real del caso |
| D21 / D22 / D23 / D24 | Falta conectar historial, foto, voz y ensayo al onboarding |
| D25: cambiar con Assist | Avance real en ola 7; falta integración final con tarjetas y aceptación |
| D26: resumen de salud | Pendiente; explicitar canal y alcance del recorte propuesto por la auditoría anterior |

El panel de salud completo, las mejoras por rubro y la telemetría son entregables del diseño aunque no cada uno tenga una decisión numerada propia.
