# Validación de puesta en marcha, Calidad y Assist

Fecha: 2026-09-14. Código revisado: `76d79a9a1b5c2fc2afc21402b2a0936c770dd3d8`.

Actualización: los hallazgos siguientes documentan el diagnóstico **anterior a la corrección**. Se implementaron las correcciones de la sección final y el reproductor ahora verifica el comportamiento corregido.

La revisión confirma inconsistencias reproducibles entre el editor y los avisos. Cuatro canales admitidos, conectados y con credenciales saludables aprueban la tarea de canales. Tener varios asignados al mismo agente no provoca por sí solo este error.

## Alcance y límite de la evidencia

Se revisaron las dos capturas, los lectores del dashboard, la evaluación compartida y el contexto que recibe Assist. Se ejecutaron servicios y funciones reales con datos sintéticos; no se consultó la configuración productiva de Laura Sofia. Las herramientas de navegador fallaron al inicializarse con `failed to write kernel assets ... os error 3`.

Por tanto, la existencia de los defectos siguientes está comprobada, pero no está comprobado qué valor concreto tiene guardado esa cuenta. `email`, `sms` y `web_chat` son ejemplos sintéticos de valores rechazados; no son un inventario observado del cliente.

## Hallazgos

### 1. Una asignación que Calidad rechaza desaparece del editor

`AgentQualityService.buildPreparation()` cuenta los valores guardados en `channels` y `channel_bindings`. Los que no pertenecen a `whatsapp`, `instagram`, `messenger`, `telegram` o `web_widget` producen `operational_channel_scope=fail` y el bloqueo «Solo canales conversacionales certificados».

`normalizeAgentChannelAssignments()` elimina esos valores al cargar el editor. La interfaz muestra solamente las asignaciones admitidas, incluso cuando la asignación rechazada sigue guardada en la versión operativa. El aviso tampoco identifica el tipo rechazado: su evidencia solo contiene un contador `unsupportedAssignments`.

Reproducción: cuatro canales operativos + `email` guardado producen `channel_connection=pass`, `operational_channel_scope=fail` y la tarea general de canales pendiente. El editor muestra solo los cuatro canales correctos. El mismo resultado se obtiene con `sms` y con el alias `web_chat` en la lista persistida. Con conocimiento RAG vacío y privacidad ausente, se reproducen exactamente los tres códigos de bloqueo de la primera captura.

Fuentes: `apps/api/src/modules/quality/agent-quality.service.ts:782`, `:918`; `apps/dashboard/src/lib/agent-channel-assignment.ts:23`; `apps/dashboard/src/app/admin/agent/[agentId]/page.tsx:235`.

Corrección necesaria: conservar y mostrar las asignaciones rechazadas como incidencias explícitas; permitir revisarlas y retirarlas mediante el flujo de configuración; identificar su tipo en la evidencia. Los alias deben normalizarse mediante un contrato compartido, sin convertir Email/SMS en canales conversacionales admitidos.

### 2. Una cuenta antigua puede aparecer seleccionada como si fuera la actual

Con `channel_bindings=['whatsapp:old']` y una única conexión actual `whatsapp:new`, Calidad identifica correctamente que la asignación guardada no apunta a la cuenta conectada. El normalizador del editor transforma cualquier binding de un tipo con cero o una cuenta en una selección general `channels=['whatsapp']`, sin comprobar que el identificador coincida.

Resultado reproducido: Calidad informa cero conexiones operativas asignadas, mientras el editor presenta WhatsApp seleccionado. La transformación ocurre al cargar y no acredita que el estado operativo haya sido actualizado.

Fuentes: `apps/dashboard/src/lib/agent-channel-assignment.ts:53`; `apps/api/src/modules/quality/agent-quality.service.ts:801`.

Corrección necesaria: preservar el binding exacto y mostrar su estado; una reasignación a una cuenta nueva debe ser una acción explícita dentro del flujo de borrador/publicación.

### 3. La tarea genérica de canales no explica por qué sigue pendiente

`AGENT_SETUP_TASK_CHECKS.channel` agrupa asignación, conexión, cobertura y tipos admitidos. La evaluación entrega los checks y el destino de reparación correctos, pero `essentialSetupItemsFromAssessment()` reduce el resultado a `done`, ruta y recorrido. `InitialSetupCard` usa siempre «Conectar y asignar un canal».

Así, un problema de asignación antigua se presenta como si faltara conectar algo. Assist recibe los checks y puede disponer de más información que esta tarjeta; para `operational_channel_scope` sigue faltando el tipo concreto rechazado.

Fuentes: `packages/shared/src/agent-assessment-contract.ts:182`; `apps/api/src/modules/copilot/agent-assessment.service.ts:253`; `apps/dashboard/src/lib/initial-setup.ts:38`; `apps/dashboard/src/components/InitialSetupCard.tsx:150`.

Corrección necesaria: mostrar el motivo evaluado, con etiquetas distintas para conectar, asignar, revisar credenciales, reparar cobertura y retirar asignaciones no admitidas. Mantener esos motivos y destinos en Inicio, Calidad y Assist.

### 4. Calidad ignora el mensaje personalizado fuera de horario

El motor de conversaciones y el ensamblado de la persona leen `config.hours.afterHoursMessageOverride`. La comprobación `after_hours_behavior` solo considera `afterHoursMessage` y los interruptores de atención fuera de horario.

Reproducción: horario válido, IA fuera de horario desactivada y un `afterHoursMessageOverride` configurado producen `business_hours=pass`, pero `after_hours_behavior=warning` con `configured=false`. El motor sí utiliza ese mensaje.

Fuentes: `apps/api/src/modules/quality/agent-quality.service.ts:1047`; `apps/api/src/modules/conversations/conversations.service.ts:897`; `apps/api/src/modules/persona/persona.service.ts:354`.

Corrección necesaria: evaluar la misma configuración efectiva que utiliza el motor, incluido el override y el valor predeterminado de atención fuera de horario.

### 5. El banner presenta una verificación no disponible como configuración ausente

Las consultas fallidas de dependencias se representan correctamente como `unknown`. Sin embargo, los checks críticos `unknown` también entran en `criticalBlockers`, y `AgentReadinessBanner` los presenta bajo «Falta configurar» sin distinguirlos de `fail`.

Reproducción: una lectura fallida de conocimiento genera `rag_knowledge=unknown` y ese código entra en los bloqueos del banner. La tarjeta de puesta en marcha sí conserva una indicación de verificación no disponible.

Fuentes: `apps/api/src/modules/quality/agent-quality.service.ts:1060`; `apps/dashboard/src/components/AgentReadinessBanner.tsx:128`; `apps/dashboard/src/lib/initial-setup.ts:50`.

Corrección necesaria: conservar el estado de cada check y mostrar «No se pudo verificar» con una acción de reintento cuando corresponda.

## Validación de los demás pasos de la captura

| Paso / aviso | Qué comprueba el código | Resultado de la revisión |
| --- | --- | --- |
| Acordar la misión | Misión guardada y compatible con las intenciones del dominio | Un nombre y rol de agente no completan esta tarea. Su estado real requiere leer la misión operativa. |
| Revisar a tu agente | Activo, identidad/prompt, fallback, reglas y derivación | Independiente de conexión o conocimiento. Puede estar completo aunque esas otras tareas fallen. |
| Contar qué hace tu negocio | Empresa con nombre, descripción y al menos un dato de contacto | Criterio separado de la persona del agente. No comprobado contra los registros productivos. |
| Base de conocimiento lista | Si RAG/Knowledge está habilitado, debe haber fragmentos no vacíos vinculados a documentos `ready` | Reproducido: cinco FAQs y cuatro productos no sustituyen esos fragmentos. Tener catálogo no garantiza que este aviso sea falso. |
| Privacidad para imágenes y audios | Plan con procesamiento multimedia y política de privacidad activa, vigente y no vacía | Reproducido: otras políticas no satisfacen este check; una política de privacidad válida sí. No comprobado para este tenant. |
| Confirmar tu horario | Horario/24×7 y comportamiento fuera de horario | Hay un falso pendiente reproducido con el override descrito arriba. |
| Cargar tu catálogo | Checks de herramientas que usan la ruta de catálogo del sector | `not_applicable` se dibuja como completado: el check verde no prueba por sí solo que se hayan cargado registros. |
| Invitar a una persona que reciba chats | Al menos un usuario activo con rol admin, supervisor o agente | El propio administrador cuenta; el verde no prueba que se haya invitado una segunda persona. |
| Probar los resultados | Evidencia vigente por intención y estado de las pruebas | Tener el agente activo o haberlo probado informalmente no acredita esa evidencia. |

## Borrador, versión operativa y actualización

El editor carga `state.draft?.body ?? state.operational.body`; Calidad y la evaluación de Assist consultan la versión operativa de `agent_personas`. Esta separación es legítima, pero el banner del editor no aclara su alcance junto a las selecciones del borrador. «Guardar borrador» no acredita que la configuración operativa haya cambiado.

Inicio y Assist utilizan `AgentAssessmentService`, que reutiliza `AgentQualityService`. Hay una base compartida, pero el editor normaliza sus asignaciones por separado y las superficies resumen los estados de forma diferente. El resumen global de alertas utiliza snapshots/caché; no debe confundirse con el cálculo directo de `getOverview`. No se ha establecido que la caché sea la causa de estas capturas.

## Comprobaciones ejecutadas

- API: 3 suites, 103 pruebas aprobadas (`agent-quality.service`, `agent-assessment.service`, `copilot.service.context`).
- Dashboard: 2 suites, 5 pruebas aprobadas (`agent-channel-assignment`, `initial-setup`).
- Reproductor adicional: 10 escenarios de diagnóstico ejecutados satisfactoriamente. Reutiliza las fábricas sintéticas de las pruebas y ejecuta las funciones/servicios reales, incluyendo la agrupación de checks de la evaluación compartida.

Comando: `node docs/audits/2026-09-14/assistant-readiness-probe.cjs`.

Para atribuir definitivamente el caso de Laura Sofia se necesitan las lecturas autenticadas de su configuración operativa/borrador, el overview de Calidad y la evaluación compartida; basta con los estados y contadores relevantes, sin credenciales ni conversaciones.

## Corrección implementada

- El editor conserva las asignaciones no admitidas y las cuentas antiguas; muestra su valor, motivo y acción «Quitar del borrador». Solo pliega un binding a una selección por tipo cuando coincide con la única cuenta actual. No convierte silenciosamente alias guardados en una nueva autorización de envío.
- Calidad incluye los tipos no admitidos y los bindings obsoletos en su evidencia. Los enlaces y recorridos para una cuenta reconectada llevan a reasignar en el editor.
- La evaluación declara `pendingCheckCode`; Inicio y el panel de evaluación muestran la acción correspondiente a ese check. Las consultas no disponibles ofrecen reintentar. «No aplica» se presenta explícitamente, sin marcar una carga de datos como comprobada. El paso del equipo expresa disponibilidad humana, incluyendo al administrador.
- Calidad reconoce `afterHoursMessageOverride` y el comportamiento predeterminado del motor fuera de horario.
- El banner distingue bloqueos verificados de verificaciones no disponibles y explica que evalúa la versión operativa. Assist recibe los estados de los checks y la explicación de la diferencia entre borrador y operación.
- Textos actualizados en español, inglés, portugués y francés.

## Alerta BullMQ adicional

`waitUntil()` mueve primero el trabajo a su fecha de reintento y luego lanza `DelayedError('bullmq:movedToDelayed')`. El Worker de BullMQ consume esa excepción como control de flujo. La instrumentación Nest/BullMQ de Sentry instalada captura cualquier excepción del procesador antes de que llegue al Worker, lo que origina una falsa alerta de fallo.

El `beforeSend` filtra únicamente un evento cuya única excepción tiene exactamente ese tipo y mensaje. No importa BullMQ durante el arranque de la instrumentación. Los errores al mover el trabajo, las caídas del medidor de gasto, otros errores y las cadenas con causas adicionales siguen reportándose y conservan la redacción de secretos de webhooks. No se modifica el procesador ni su calendario, límites o reintentos.

El motivo concreto de la espera está guardado como `spend_<code>` en el dispatch y en el log. La traza entregada no permite saber cuál de esas condiciones se produjo en producción; filtrar la señal de control no elimina una condición real de financiación, credenciales o configuración.

## Validación final de la corrección

- API: 7 suites y 138 pruebas aprobadas (calidad, evaluación compartida, contexto de Assist, Sentry y despacho/reintentos).
- Dashboard: 6 suites y 71 pruebas aprobadas (asignaciones, puesta en marcha, recorridos y accesibilidad de los avisos). Se verifica presencia de los textos nuevos en los cuatro idiomas.
- Arranque NestJS: `test:bootstrap` aprobado, sin errores de inyección de dependencias.
- TypeScript sin emisión: API, dashboard y landing aprobados, sin usar caché incremental.
- Builds de producción: shared, API y dashboard aprobados; Next.js generó sus 147 páginas sin errores.
- Reproductor de diagnóstico: 10 escenarios corregidos aprobados, con fixtures sintéticos y sin llamadas a infraestructura ni modificaciones de tenants.
- `git diff --check`: sin errores.
- ESLint completo de API y dashboard (`--quiet`, sin corrección automática): aprobado.
- PgBouncer local no comprobado: `docker` no está instalado en esta máquina. No se afirma validación de conexiones ni datos del tenant productivo.

La corrección de `runtime_schema_lock_required_at_transaction_start` ya está en la base `76d79a9a`: `AgentQualitySignalService.ensureTables()` solicita `{ schemaLock: true }` al iniciar la transacción. Este lote conserva ese arreglo.
