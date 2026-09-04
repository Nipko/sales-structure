# Centro de calidad del agente

## Propósito

El Centro de calidad responde, con evidencia, tres preguntas distintas:

1. **¿El agente tiene una configuración suficiente para operar?**
2. **¿Supera pruebas repetibles con la configuración vigente?**
3. **¿Está funcionando bien en conversaciones reales?**

Estas respuestas no se mezclan en un porcentaje decorativo. Un campo diligenciado no demuestra calidad y una conversación abandonada no demuestra resolución. Los fallos críticos de seguridad, conocimiento, herramientas o escalamiento bloquean el estado aunque otras dimensiones estén bien.

La tarjeta **Puesta en marcha esencial** de Inicio sigue siendo una guía de adopción
inicial. No es una certificación del agente y reemplaza el antiguo checklist flotante
con progreso `8/9`. Sus ítems se derivan de los checks críticos de preparación más el
canal (`/channels/overview`), de modo que la tarjeta y Salud de agentes no puedan
contradecirse: es la **única** fuente de progreso de la puesta en marcha. Cada ítem
ofrece **Continuar** y **Mostrarme dónde**; la tarjeta desaparece al completarse y recién
entonces Inicio muestra `AgentHealthCard`.

## Superficie y acceso

- **Detalle:** **Insights → Salud de agentes**, ruta `/admin/agent/quality`.
- **Inicio:** la tarjeta **Salud de agentes** siempre resume el peor estado, los
  agentes evaluados y las acciones abiertas para los roles autorizados.
- **Navegación:** el badge de **Salud de agentes** cuenta exclusivamente señales
  **Críticas + Altas** que continúan abiertas; no representa un puntaje.
- **Aviso global:** solo aparece ante una señal crítica abierta o un estado global
  **En riesgo**. Permite revisar, preguntar a Parallly Assist o posponer la señal 24 h.
- **Barra de contexto en el destino:** **Revisar** no navega "a secas". Agrega
  `?qa=<signalId>&qagent=<agentId>` al `href` del check y la pantalla destino monta una
  barra de contexto con la acción pendiente, el agente, la explicación en lenguaje llano
  construida con la evidencia del check y los botones **Mostrarme dónde**, **Preguntar a
  Assist**, **Posponer 24 h** y cerrar. Es parte de la pantalla, no una notificación:
  nada se envía por correo, push ni SMS. Mientras la barra muestra la misma señal, el
  aviso global se oculta para no duplicar el rojo. Si el endpoint responde 404 (señal ya
  resuelta, o API vieja durante un rolling restart), la barra degrada a un mensaje
  cerrable y nunca rompe la página.
- **Mostrarme dónde:** abre la pantalla y resalta paso a paso dónde se hace el cambio.
  El recorrido es de solo lectura: no escribe configuración. El registro compartido
  `packages/shared/src/guided-tour-contract.ts` mapea código de calidad → recorrido y
  rol mínimo (Admin ve los de edición, Supervisor los de revisión); el dashboard resuelve
  los pasos en `apps/dashboard/src/lib/guided-tours.ts`.
- **Lectura en el dashboard:** `tenant_admin` y `tenant_supervisor`; un `super_admin`
  entra al workspace mediante impersonación autorizada. En API, `super_admin` puede usar
  un `tenantId` explícito, validado y auditado por `TenantGuard`.
- **Edición:** el centro es una vista de diagnóstico. Editar el agente, sus conexiones o su configuración continúa reservado al administrador en `/admin/agent`.
- **API:** `GET /api/v1/quality/:tenantId/agents` entrega el selector mínimo de
  agentes; `GET /api/v1/quality/:tenantId/agents/:agentId/overview`, la evidencia del
  agente elegido; y `GET /api/v1/quality/:tenantId/attention-summary`, el agregado
  acotado que consumen Inicio, navegación y el aviso global.
  `GET /api/v1/quality/:tenantId/signals/:signalId?agentId=<uuid>` (aditivo) devuelve
  **una** señal activa (`open|acknowledged|snoozed`) del agente indicado para alimentar
  la barra de contexto; responde 404 si la señal ya no está activa o no pertenece a ese
  agente. Roles: `super_admin`, `tenant_admin`, `tenant_supervisor`.
- **Contrato:** `packages/shared/src/agent-quality-contract.ts` define estados, pilares, dimensiones, métricas y recomendaciones que comparten API y dashboard.

Los endpoints y la interfaz no editan prompts, políticas ni conocimiento. Las recomendaciones dirigen a una persona hacia la superficie adecuada y conservan la revisión humana antes de cualquier cambio.

Los avisos de esta iteración son internos del dashboard. No se envían por correo ni
como notificación push y no debe prometerse que posponer o reconocer una señal la
resuelve.

## Estados globales

| Estado | Significado |
|---|---|
| No evaluado | Todavía no existe evidencia suficiente para emitir un estado. |
| Configuración incompleta | La preparación aún tiene un requisito faltante o una advertencia por resolver; los requisitos críticos se señalan además como bloqueadores. |
| En riesgo | Existe un fallo crítico en pruebas o una señal real grave. |
| Listo para piloto | La preparación y las pruebas críticas son vigentes, pero falta volumen real. |
| Operando con evidencia | La preparación, las pruebas y una muestra suficiente de producción son sanas. |
| Revisión requerida | La evidencia venció por cambios o el desempeño real se deterioró. |

“Listo” nunca significa “perfecto” ni garantiza resultados comerciales. Significa que los controles aplicables cuentan con evidencia vigente.

## Tres pilares

### Preparación

Es determinista y se calcula por agente. Evalúa:

- identidad, objetivo y alcance del negocio;
- conocimiento recuperable, FAQs, políticas y catálogo aplicable;
- tono, idioma, reglas y fallback;
- asignación real a canales y prerrequisitos de las herramientas habilitadas;
- temas prohibidos, ruta de handoff y disponibilidad humana;
- horarios y condiciones operativas.

Una capacidad deshabilitada que no forma parte del alcance se marca como **No aplica** y no reduce el resultado. Si el agente promete una capacidad, sus datos y controles pasan a ser obligatorios.

**Canales: asignación, conexión y credencial son tres cosas distintas.** La preparación
las separa en tres checks para que el aviso y el destino digan lo mismo:

| Check | Crítico | Cuándo falla |
|---|---|---|
| `channel_assignment` | sí | el agente no tiene ningún canal marcado (`assignedCount === 0`). |
| `channel_connection` | sí | `not_applicable` cuando `assignedCount === 0` (ya lo bloquea `channel_assignment`); `fail` cuando **ninguna** asignación tiene conexión operativa —el agente no puede recibir— o cuando una credencial requiere reautorizar (`error`/`revoked`/`expired`/`missing`) y por tanto no puede enviar; `warning` con credenciales `unknown`/`expiring`. |
| `channel_coverage` (dimensión `actions_outcomes`, `weight: 3`) | **no** | alguna asignación quedó sin conexión activa —tipo desconectado o vínculo por cuenta obsoleto— mientras el agente **sí** tiene otra operativa. Genera recomendación `high`, con `href` al editor del agente. |

Un canal marcado y sin conectar ya **no** produce un bloqueo crítico si otro canal del
agente opera: eso era el defecto que mostraba "acción crítica" con WhatsApp respondiendo
y mandaba a Canales, donde todo se veía verde.

La evidencia es primitiva y acotada: `connectedChannels` (tipos con al menos una conexión
operativa, `join(',')`, ≤120 chars) en `channel_connection`; `{ assigned, connected,
disconnectedChannels, staleBindings }` en `channel_coverage`. Un `binding` cuyo tipo sí
está conectado pero cuya cuenta ya no existe cuenta como `staleBinding` (el número se
reconectó y cambió de id).

La salud de credenciales tiene una sola fuente de verdad,
`apps/api/src/modules/channels/channel-credential-health.util.ts` (función pura), que
consumen tanto el servicio de calidad como `/channels/overview`. Antes había dos: calidad
leía `missing` donde el overview devolvía `unknown` y la página lo ocultaba.

### Calidad probada

Usa el conjunto dorado y las simulaciones existentes. Informa:

- escenarios y trials ejecutados;
- aprobados frente al total;
- umbral y consistencia;
- fecha, versión del agente y vigencia;
- escenarios fallidos y causa.

Los resultados se consideran vencidos cuando son anteriores a cambios relevantes del agente o sus fuentes. Una prueba manual aislada ayuda a depurar, pero no certifica.

### Producción

Usa únicamente interacciones atribuidas al agente desde que la instrumentación está activa. Muestra por separado:

- tamaño y periodo de la muestra;
- resolución verificada;
- calidad conversacional observada;
- handoffs y fallos de herramientas;
- vacíos de conocimiento;
- problemas recurrentes y conversaciones fuente.

Antes de alcanzar la muestra mínima, el estado es **Evidencia insuficiente**, no cero. Los datos históricos sin atribución inequívoca no se asignan retroactivamente.

## Dimensiones y pesos iniciales

| Dimensión | Peso |
|---|---:|
| Negocio y alcance | 15% |
| Conocimiento y grounding | 20% |
| Conversación y marca | 15% |
| Acciones y resultados | 20% |
| Seguridad, cumplimiento y handoff | 20% |
| Robustez y operación | 10% |

Los pesos ordenan la preparación, pero no compensan bloqueos críticos. `No aplica` sale del denominador. `Desconocido` se conserva como falta de evidencia y no se transforma en aprobado.

## Recomendaciones accionables

El centro prioriza un máximo pequeño de acciones. Cada recomendación incluye:

- gravedad e impacto;
- pilar y dimensión afectados;
- evidencia que la originó;
- número de escenarios o conversaciones afectados, cuando existe;
- enlace directo a la configuración, conocimiento, prueba o conversación pertinente.

Las señales reales pueden producir recomendaciones como:

- cubrir preguntas que no recuperaron conocimiento;
- corregir contenido contradictorio o de baja satisfacción;
- reforzar una intención que falla de forma recurrente;
- reparar una herramienta o integración con errores;
- añadir un handoff viable;
- ajustar tono, claridad, idioma o reglas;
- convertir un fallo real en un nuevo caso del conjunto dorado.

El sistema diagnostica y orienta. No debe editar automáticamente prompts, políticas o conocimiento sin revisión humana.

## Señales proactivas, snapshots y enfriamiento

La proactividad usa evidencia durable y no depende de que una persona tenga abierto
el Centro de calidad:

- cada cálculo relevante conserva un **snapshot** por agente y versión, con estado,
  hito, pilares y conteos acotados;
- cada recomendación genera una **señal** estable por agente, versión y código, con
  gravedad, pilar, dimensión, destino seguro, primera/última detección y recurrencia;
- una señal puede estar `open`, `acknowledged`, `snoozed`, `resolved` o
  `superseded`; solo `open` Crítica/Alta alimenta el badge;
- al desaparecer la causa, la siguiente conciliación la marca resuelta. Una versión
  nueva reemplaza las señales accionables de la versión anterior;
- cambios de configuración, resultados de QA, evaluaciones y simulaciones solicitan
  una conciliación. Los eventos repetidos de QA se agrupan durante 60 segundos y un
  barrido acotado cada seis horas recupera eventos perdidos;
- el resumen de atención usa una caché corta. **Posponer 24 h** oculta temporalmente
  esa señal del aviso y del conteo; si vence el plazo o la gravedad empeora, puede
  volver a abrirse.

Reconocer o posponer son decisiones de atención, no pruebas de reparación. Solo un
cambio real en la evidencia y una nueva validación resuelven el diagnóstico.

## Parallly Assist como coach contextual

Desde la tarjeta de Inicio o el aviso global, **Preguntar a Assist** abre el chat con
el agente y la señal seleccionados. El servidor valida tenant, rol, agente y señal;
el contexto derivado del estado vigente prevalece sobre una explicación genérica de
la KB. Assist explica una prioridad y devuelve rutas internas permitidas:

- Admin puede recibir el enlace de reparación y el enlace al Centro de calidad.
- Supervisor recibe el Centro de calidad y coordinación de seguimiento, sin acceso
  implícito al editor.
- Agent no recibe contexto de Salud de agentes.

El contexto enviado al modelo está deliberadamente limitado a códigos y agregados:
estado, versión, hito, bloqueadores codificados, vigencia de pruebas, tamaño mínimo y
actual de muestra, gravedad, pilar, dimensión y conteo de evidencia. Excluye
transcripciones, texto de clientes, IDs de conversación, texto libre del juez,
prompts, consultas de recuperación, secretos y actores que reconocieron o pospusieron
la señal. El nombre configurable del agente permanece en la interfaz, no se usa como
instrucción del modelo.

**Bloque de canales conectados (autoritativo).** Para admin y supervisor —nunca para
`tenant_agent`— el prompt incluye un snapshot del tenant obtenido con
`AgentQualityService.getTenantChannelSnapshot(tenantId)`: por tipo de canal, cuántas
cuentas activas y la peor salud de credencial (`{ type, accounts, health }`). Sin nombres,
sin ids, sin números de teléfono. La regla que lo acompaña es explícita: si la lista no
está vacía, el modelo **nunca** puede afirmar que no hay canales conectados; debe nombrar
los tipos conectados y explicar que una señal de canales significa que **una asignación**
no está conectada, que un vínculo por cuenta quedó obsoleto o que una credencial requiere
reautorizar. Ese bloque es el que corrige el síntoma original ("no tenés canales
conectados" con WhatsApp operando), porque antes el modelo solo recibía el código
`channel_connection` sin evidencia y lo interpretaba como ausencia de canales.

Junto al bloque de canales viaja la **evidencia acotada del check**:
`criticalBlockerEvidence` (la evidencia del check de cada bloqueador crítico) y
`selectedSignal.evidence` cuando la señal es `fix_<check>`, filtradas a
`number | boolean | string` que cumplan `/^[a-z0-9_,:.-]{1,80}$/i`, con un máximo de 8
claves por check. Sigue sin viajar nada de texto libre ni IDs de conversación.

**Acción `start_guided_tour`.** Además de `open_quality_center` y `open_quality_action`,
`/copilot/chat` puede devolver `{ code: 'start_guided_tour', labelKey: 'showMe', href,
tourId }` cuando existe un recorrido para el código de la señal (o cuando el modelo cierra
su respuesta con el marcador `[[tour:<id>]]` y ese id está en la lista de recorridos
disponibles para los artículos recuperados y el rol). El `href` sale siempre del registro
compartido, nunca del texto del modelo, y los marcadores inventados se eliminan de la
respuesta. Máximo una acción de tour y tres acciones en total. El `href` de
`open_quality_action` lleva `qa=` y `qagent=` para que el destino monte la barra de
contexto.

Assist puede explicar y dirigir; no confirma que un cambio fue aplicado, no edita el
agente ni el conocimiento y no inicia comunicaciones externas. Un recorrido guiado
tampoco escribe nada: abre la pantalla y señala el lugar.

### Bucle de mejora desde interacciones

Las interacciones reales cierran el ciclo sin convertir al agente en un sistema que se modifica solo:

1. Una conversación atribuida termina o produce una señal verificable.
2. QA, recuperación de conocimiento, herramientas y handoff registran evidencia.
3. El agregador agrupa recurrencias por agente, versión, código y dimensión.
4. La interfaz muestra el impacto y las conversaciones fuente.
5. Un administrador corrige configuración, contenido o integración.
6. Cuando corresponde, el administrador convierte manualmente el fallo en un escenario
   de regresión revisado; esta entrega no lo crea por sí sola.
7. La evidencia previa vence y la nueva versión debe superar las pruebas.
8. Producción confirma si la mejora se sostiene.

Este bucle distingue tres clases de intervención:

- **Reforzar conocimiento:** faltan datos, la fuente no se recuperó, está obsoleta o es contradictoria.
- **Reforzar comportamiento:** el agente sí tenía información pero preguntó, explicó, negó o escaló mal.
- **Reparar capacidad:** una herramienta, conexión, política, aprobación o ruta humana no pudo completar el resultado.

Una recomendación solo se considera resuelta cuando cambia su evidencia y pasa la validación correspondiente; ocultarla o descartarla no debe mejorar el estado de calidad.

## Vigencia y atribución

Cada conversación nueva conserva el agente y la versión de configuración que la atendieron. El score de QA hereda esa atribución. No se infiere un agente a partir del tipo de canal porque varias cuentas del mismo canal pueden estar asignadas a agentes distintos.

La evidencia de pruebas queda obsoleta, como mínimo, después de actualizar el agente. En iteraciones posteriores debe persistir también un hash canónico de configuración, suite y fuentes para detectar cambios de conocimiento, políticas, herramientas y evaluadores.

## Interpretación segura

- La exactitud aparente de un juez que solo lee el transcript no sustituye una verificación de grounding.
- Las acciones se validan con el estado del backend, no con una frase del modelo que diga “listo”.
- Los graders automáticos deben calibrarse periódicamente con revisión humana.
- Los resultados deben poder rastrearse a escenarios, conversaciones y señales concretas.
- Nunca se almacenan secretos, tokens, prompts completos ni datos innecesarios dentro del resumen de calidad.

## Estado actual y evolución pendiente

Ya están operativos la atribución por agente/versión para conversaciones nuevas, el
overview integrado de los tres pilares, la taxonomía acotada de recomendaciones y los
snapshots/señales durables que alimentan Inicio, Insights, el aviso y Assist.

Quedan como evolución explícita —no como capacidad prometida en esta entrega—:

1. conversión asistida y revisable de fallos reales en casos de regresión;
2. hash canónico adicional de configuración, suite y fuentes para una vigencia más
   fina que la versión del agente;
3. comparación antes/después e intervalos de confianza cuando exista volumen;
4. cualquier canal de aviso externo, sujeto a preferencias, cooldown y política de
   notificación propios.

## Referencias de diseño

- OpenAI, **Agent evals** y **Trace grading**: evaluación reproducible del resultado y de la ruta completa del agente.
  - <https://developers.openai.com/api/docs/guides/agent-evals>
  - <https://developers.openai.com/api/docs/guides/trace-grading>
- Anthropic, **Demystifying evals for AI agents**: tareas, trials, graders, `pass@k`/`pass^k` y revisión de transcripts.
  - <https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents>
- Microsoft, **Agent evaluators**: separación entre finalización/adherencia, proceso de herramientas, calidad y seguridad.
  - <https://learn.microsoft.com/en-au/azure/foundry/concepts/evaluation-evaluators/agent-evaluators>
- Google Cloud, **Evaluate judge models**: calibración de evaluadores automáticos contra etiquetas humanas.
  - <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/evaluate-judge-model>
- Intercom, **AI-powered content recommendations**: recomendaciones derivadas de fallos reales y respuestas humanas, con evidencia e impacto.
  - <https://www.intercom.com/help/en/articles/11394959-use-ai-powered-content-recommendations-to-improve-fin>
