# Centro de calidad del agente

## Propósito

El Centro de calidad responde, con evidencia, tres preguntas distintas:

1. **¿El agente tiene una configuración suficiente para operar?**
2. **¿Supera pruebas repetibles con la configuración vigente?**
3. **¿Está funcionando bien en conversaciones reales?**

Estas respuestas no se mezclan en un porcentaje decorativo. Un campo diligenciado no demuestra calidad y una conversación abandonada no demuestra resolución. Los fallos críticos de seguridad, conocimiento, herramientas o escalamiento bloquean el estado aunque otras dimensiones estén bien.

El checklist de onboarding sigue siendo una guía de adopción inicial. No es una certificación del agente.

## Superficie y acceso

- **Interfaz:** **Insights → Centro de calidad**, ruta `/admin/agent/quality`.
- **Lectura:** `tenant_admin` y `tenant_supervisor`. Un `super_admin` solo entra al contexto del tenant mediante impersonación autorizada.
- **Edición:** el centro es una vista de diagnóstico. Editar el agente, sus conexiones o su configuración continúa reservado al administrador en `/admin/agent`.
- **API:** `GET /api/v1/quality/:tenantId/agents` entrega el selector mínimo de agentes y `GET /api/v1/quality/:tenantId/agents/:agentId/overview` entrega la evidencia del agente elegido.
- **Contrato:** `packages/shared/src/agent-quality-contract.ts` define estados, pilares, dimensiones, métricas y recomendaciones que comparten API y dashboard.

Los endpoints y la interfaz no editan prompts, políticas ni conocimiento. Las recomendaciones dirigen a una persona hacia la superficie adecuada y conservan la revisión humana antes de cualquier cambio.

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

### Bucle de mejora desde interacciones

Las interacciones reales cierran el ciclo sin convertir al agente en un sistema que se modifica solo:

1. Una conversación atribuida termina o produce una señal verificable.
2. QA, recuperación de conocimiento, herramientas y handoff registran evidencia.
3. El agregador agrupa recurrencias por causa, intención y dimensión.
4. La interfaz muestra el impacto y las conversaciones fuente.
5. Un administrador corrige configuración, contenido o integración.
6. El fallo se añade, con revisión, como escenario de regresión.
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

## Evolución prevista

1. Atribución por agente y versión para conversaciones nuevas.
2. Resumen integrado de preparación, evals, simulaciones y producción.
3. Taxonomía estable de problemas y recomendaciones por impacto.
4. Conversión asistida de fallos reales en casos de regresión revisables.
5. Historial de snapshots con hash de configuración, suite y fuentes.
6. Comparación antes/después e intervalos de confianza con suficiente volumen.

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
