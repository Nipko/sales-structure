# Auditoría de Assist y diagnóstico de calidad — notas verificadas

Fecha: 6 de septiembre de 2026 UTC. Alcance: código local de Assist y Centro de calidad; pruebas unitarias y reproducción aislada. No se consultó ni modificó producción y no se hicieron cambios de producto.

## Conclusión

La nueva implementación mejora la ayuda contextual, protege el contexto tenant/rol, conecta avisos con destinos y permite recorridos guiados. Todavía no implementa un asistente que configure activamente la cuenta ni que revise semánticamente el agente completo. El contrato actual se limita expresamente a explicar y navegar. Existe además una pieza prometida en el plan que no llegó al código: el contexto vivo de onboarding y pendientes dentro de Assist.

La separación es importante: «implementación verificada» del plan de ayuda no demuestra «agente que cumple el objetivo del negocio» ni configura al usuario por conversación.

## Evidencia de validación

Se ejecutó desde `apps/api`:

```text
node ../../node_modules/jest/bin/jest.js --runInBand src/modules/copilot src/modules/quality src/modules/channels/channel-credential-health.util.spec.ts
12 suites passed; 272 tests passed; 22.127 s.
```

El primer intento por `npm test` falló porque el shim de npm apunta a un `npm-cli.js` inexistente en AppData/Roaming. Se resolvió para la auditoría invocando Jest con Node; no es un fallo del producto.

Una reproducción adicional con `ts-node`, servicios reales y Prisma simulado reprodujo el defecto A1 de abajo. No requirió archivos de prueba nuevos, DB, Redis ni LLM real. La prueba inyectó un error al leer `channel_accounts` y observó:

```json
{
  "sourceAvailable": false,
  "snapshot": { "total": 0, "channels": [] },
  "prompt": "CANALES CONECTADOS (autoritativo) ... Si la lista está vacía, indícalo y guía a Administración → Canales."
}
```

## Hallazgos priorizados

### A1 — P1, defecto reproducido: un fallo de lectura vuelve a afirmar que no hay canales

- `apps/api/src/modules/quality/agent-quality.service.ts:234-246` distingue la lectura fallida (`available:false`) de una tabla vacía.
- `:344-356` conserva el dato como `channelLookupAvailable` en el contexto interno.
- `:369-377` lo elimina al convertir a `TenantChannelSnapshot`: devuelve `total:0,channels:[]` aunque el estado real sea desconocido.
- `apps/api/src/modules/copilot/copilot.service.ts:579-581` etiqueta ese resultado como autoritativo y ordena al modelo declarar que la lista está vacía.

Impacto: bajo un fallo transitorio del query, el asistente puede dar exactamente la afirmación falsa que motivó el arreglo anterior. La calidad del agente ya distingue `unknown`; la interfaz hacia Assist pierde esa distinción.

Cambio: propagar `availability: known|partial|unavailable` por origen de datos; nunca emitir «ninguno» a partir de una consulta fallida. Un snapshot parcial debe decir qué se verificó y qué no. Cubrir también la lectura de widgets, cuyo `.catch(() => [])` hoy no conserva disponibilidad. Prueba de aceptación: query fallido, tenant con canal operativo, Assist explica que no pudo verificarlo y no recomienda reconectar por ausencia supuesta.

### A2 — P1, compromiso del plan incompleto: Assist no recibe el onboarding real

- El plan `docs/assist-quality-guided-tours-plan-2026-09.md:638` promete que Assist conoce `onboardingStage` y los ítems pendientes y ofrece el tour del pendiente.
- El contexto que efectivamente arma `apps/api/src/modules/copilot/copilot.service.ts:1122-1137` contiene plan, vertical, canales y calidad; no hay lector de setup-status, onboardingStage ni pendientes en todo el módulo copilot.
- `apps/dashboard/src/components/HelpAssistant.tsx:155-160` consume la señal de onboarding solo para decidir si oculta la animación inicial.
- `:302-308` envía únicamente message/page/locale/history/target; no hay resolución backend del estado pendiente.

Impacto: «¿qué me falta para empezar?» desde la burbuja no obtiene los mismos pendientes que la tarjeta. Obtiene recomendaciones genéricas de KB y canales; el asistente puede perder detalles como confirmación/personalización del agente y el paso aplazado. El guion manual del plan no puede considerarse validado por contratos estáticos de KB.

Cambio: extraer un servicio backend `SetupAssessment` compartido por setup-status, tarjeta y Assist, con estado de cada requisito, evidencia, disponibilidad, dependencia, siguiente paso y tour. El cliente puede indicar intención; nunca enviar hechos autoritativos de configuración. Acceptance: mismo tenant, misma revisión, mismos pendientes y misma prioridad en tarjeta/Assist.

### A3 — P1 de producto: todavía no configura de forma activa

- `apps/api/src/modules/copilot/copilot.service.ts:30-35` define solo `open_quality_center`, `open_quality_action` y `start_guided_tour`.
- `:1175-1183` llama al LLM sin herramientas de configuración.
- `:1159-1160` declara revisión humana y que el recorrido no cambia la configuración.
- `docs/platform-assistant-knowledge.md:78-84` documenta expresamente que no ejecuta cambios.

No es un agujero de seguridad: es el alcance vigente. No hay objetos de propuesta, diff, estado durable de tarea, aplicación, postvalidación ni rollback en Assist. No se debe prometer que el asistente «ya configura» por tener botones de navegación.

Cambio de paradigma: convertirlo en un configurador guiado con acciones tipadas y revisión visible. Primer ámbito: identidad del negocio, objetivo/audiencia del agente, tono/saludo, reglas, FAQ borrador, horarios y habilitación de herramientas con prerrequisitos resueltos. Autorización de conexiones OAuth y aceptación contractual siguen en sus flujos humanos. Cada propuesta debe informar qué cambia, para qué sirve, impacto, evidencia y validación posterior. La automatización no exige publicar sin revisión.

### A4 — P1 de producto: contexto del agente solo desde entrada especializada y reducido a códigos

- `apps/api/src/modules/copilot/copilot.service.ts:628-633`: sin target explícito retorna contexto de calidad vacío.
- `apps/dashboard/src/components/HelpAssistant.tsx:164-180`: abrir el asistente genérico elimina el target anterior.
- `:250-266`: solo un evento específico de calidad establece target. El page path del editor no se resuelve en un agente backend.
- `apps/api/src/modules/copilot/copilot.service.ts:666-695`: incluso con target, envía versión, estado y bloqueadores, no el objetivo, plantilla, instrucciones reales o capacidades del agente configurado.

Impacto: pedir desde el editor «revisa este agente completo» no implica que el modelo haya leído ese agente. La evaluación que recibe es un resumen de comprobaciones estructurales, no una revisión del encargo. La ausencia de secretos/PII en contexto es positiva, pero no obliga a excluir todo campo de configuración funcional.

Cambio: mantener un agente seleccionado visible y resolverlo server-side dentro del tenant; si hay varios, elegir de forma explícita antes de proponer cambios. Dar al revisor un perfil de configuración funcional saneado (objetivo, audiencia, tono, reglas, herramientas efectivas, fuentes accesibles, handoff, horarios, plantilla/versión) como datos no confiables, separado de las instrucciones del sistema. Permitir lecturas adicionales acotadas según tarea. Revalidar selección, permiso y versión al aplicar.

### A5 — P1 de producto / P2 de diagnóstico: preparación no mide cumplimiento del objetivo

- `apps/api/src/modules/quality/agent-quality.service.ts:733-756` mide que nombre/rol/prompt sean texto no vacío, y reglas/triggers sean listas con texto; no su pertinencia, contradicciones, cobertura o calidad.
- `:758-769` mide conteos de fuentes y validez numérica de RAG. Una fuente cualquiera satisface `knowledge_coverage`, aunque la herramienta que permitiría leerla esté deshabilitada o el contenido no resuelva el objetivo.
- `:827-832`: citas pasa con servicios y slots positivos; catálogo/ecommerce con productos; CRM y pedidos pasan por enabled. No acredita una operación completa.
- `:834-854`: la preparación vertical se reduce a conteos de catálogos. No se cruza con el manifiesto de capacidades efectivas y disponibilidad de plan. `AgentQualityService` solo inyecta Prisma; no recibe el resolver efectivo del runtime.
- No hay check de `tools.payments`/customerPayments en ese servicio.

Impacto: un agente puede aprobar muchos controles con instrucciones contradictorias, herramientas inservibles para su objetivo o sin cobertura de los escenarios importantes. El sistema ya separa preparación, probado y producción, lo cual debe conservarse; hay que ampliar el contenido de esos pilares.

Cambio: contrato de éxito por plantilla/vertical y objetivo, con escenarios críticos, fuentes mínimas, herramientas efectivas/prerrequisitos y restricciones. Revisión estructural + semántica + pruebas de ejecución. Estado por capacidad: disponible por plan, configurada, conectada, autorizada, probada, observada. Nunca confundir un switch encendido con una capacidad verificada. No habilitar todas las herramientas indiscriminadamente: habilitar y probar las que el objetivo requiera.

### A6 — P2, defecto de vigencia: evaluaciones no caducan por varias dependencias operativas

- `apps/api/src/modules/quality/agent-quality.service.ts:177-185` calcula `sourceUpdatedAt` usando tenant, empresa, documentos, FAQs y políticas.
- Los queries `:415-436` traen conteos de servicios, slots, productos y verticales, sin revisión/fecha de modificación.
- `:885-900` deriva stale de las fechas anteriores y versión persona; las evaluaciones no tienen hash de configuración (`:892-893` lo reconoce).
- `apps/api/src/modules/quality/agent-quality-signal.service.ts:591-595` explica que cambios en dependencias no incrementan versión del agente y solo disparan recálculo.

Impacto: cambiar catálogo, servicios/disponibilidad o integraciones puede dejar las pruebas previas marcadas vigentes. Un recálculo del mismo conjunto de fechas no repara esto.

Cambio: registrar en cada evaluación una revisión o fingerprint de dependencias relevantes (configuración, catálogo/servicios, KB, horario, capacidades, adaptadores/prompts/herramientas). Caducar solo las pruebas afectadas. Acceptance: editar un servicio o dependencia contractual invalida los escenarios que lo usan aunque el número de registros permanezca igual.

## Lo que ya merece conservarse

- Tenant y rol se derivan de JWT/TenantGuard; el controller rechaza campos inesperados, valida UUIDs, ruta interna, idioma y límites de historia. `copilot.controller.ts:51-134`.
- Contexto de plan viene de catálogo activo y de features efectivas con overrides; no de números escritos a mano. `copilot.service.ts:183-248`.
- Capacidades verticales se consultan por tenant y el prompt trata una lista vacía como no autorizada. `copilot.service.ts:437-457`.
- Contexto de canales agregado y sin identificadores/contactos; exclusión de nombres de agentes, transcripciones y texto libre del juez del resumen de calidad.
- Tours emitidos solo desde registro/allowlist y rol autorizado; marcadores inventados se eliminan. `copilot.service.ts:1112-1118,1190-1204`.
- Destinos de calidad llevan parámetros de foco; señales se revalidan dentro del agente/tenant, y una señal resuelta entre clic y respuesta degrada sin romper el chat. `copilot.service.ts:633-647,707-712`.
- Centro de calidad separa preparación, pruebas y producción, reconoce falta de evidencia, atribuye producción por agente/versión y usa eventos de dependencias para recalcular señales.

## Plan concreto para Assist

1. **Veracidad y contexto único**: resolver A1/A2; selección explícita de agente; snapshot versionado de setup/calidad/plan/vertical/capacidades con unknown preservado. Un mismo requisito produce una explicación y destino coherentes en todas las superficies.
2. **Contrato del agente por objetivo**: objetivo principal medible, objetivos secundarios, qué no hace, datos/fuentes necesarias, herramientas y ruta humana. Plantillas aportan defaults y pruebas, no solo copy.
3. **Configuración asistida revisable**: catálogo de lecturas y acciones tipadas; propuesta durable con before/after, RBAC por campo, validación DTO/backend, precondiciones de plan/capacidad, versión esperada, idempotency key y expiración. Aplicar mediante servicios existentes, no SQL/JSON arbitrario del modelo.
4. **Verificar y recuperar**: releer después del cambio, recalcular dependencias, ejecutar escenarios afectados y presentar resultado real. Configuración reversible con revisión anterior. Para efectos externos, compensación explícita y manejo de estado incierto; nunca anunciar éxito antes de prueba.
5. **Aprendizaje de producto**: asociar cada señal real con escenario reproducible, mejora propuesta y medición posterior; no editar prompts por cuenta propia basándose solo en una opinión del LLM.

Métricas de aceptación: tiempo a primera respuesta útil sustentada; tiempo a primera capacidad operativa verificada; porcentaje de configuración completada sin soporte; coherencia de pendientes entre superficies; porcentaje de propuestas aceptadas/verificadas/revertidas; tasa de éxito por herramienta/objetivo; falsos «está listo» y falsos avisos de ausencia; seguridad de tenant/rol y de efectos duplicados. Son objetivos a medir, no resultados acreditados por esta auditoría.
