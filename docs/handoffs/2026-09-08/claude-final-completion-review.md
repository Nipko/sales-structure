# Revisión adversarial y directiva de continuación para Claude

Fecha: 8 de septiembre de 2026. Rango revisado: `ec430c54..30a79102` (35 commits locales). Esta revisión complementa y corrige el cierre informado por Claude. No autoriza push, despliegue, activación productiva ni llamadas a proveedores reales.

## Veredicto

La tanda cierra trabajo importante: la suite completa de la API está verde, los huecos declarativos de positivos/negativos/verificadores quedaron calculados en cero, existen migración y runbook, los cuatro adaptadores externos tienen transporte estricto y se expusieron endpoints de rollout, reconciliación y publicación. No cierra el programa integral ni permite un piloto todavía.

La revisión encuentra cuatro defectos de seguridad operacional en el bloque presentado como cerrado y un hueco de producto en su operación. Deben corregirse antes de Flow, pilotos o certificación. Después siguen abiertos los requisitos 3, 4, 5, 6, 7, 8 y 12 de la directiva original; la condición 2 sólo cerró su inventario, no la ejecución ni la certificación.

Estado de aceptación:

| Condición | Estado revisado |
| --- | --- |
| 1. A1–H3 aceptados | Abierta. La propia tabla conserva pendientes en todas las áreas. |
| 2. 76 perfiles / 268 tareas | Inventario cerrado; **0 perfiles certificados** y escenarios por modelo/idioma/canal sin ejecutar. |
| 3. Núcleo común | Parcial. Agent Test comparte runtime, pero quedan familias bloqueadas y no existe ledger durable del resultado completo del turno. |
| 4. Recorridos críticos completos | Abierta. Falta recuperar el turno, completar familias y demostrar entrega/resultado incierto/handoff por tarea. |
| 5. Assist y assessment operables | Parcial. Acciones base existen; faltan superficies y recorridos de operación, publicación y reconciliación. |
| 6. Onboarding/tours | Abierta. Sin validación visual, accesibilidad ni usuarios nuevos. |
| 7. Aprendizaje | Abierta y con dos fallos de procedencia/reanudación detallados abajo. |
| 8. Canales | Abierta. Sin pilotos y con el webhook desplegado de WhatsApp todavía fuera del join nuevo. |
| 9. Baseline rojo | Aceptada para la API: 541/541 suites y 5.765 pruebas informadas, sin omitidas. |
| 10. Verificación integral | Abierta. Faltan builds, E2E visual, accesibilidad, carga, degradación, Socket.IO normal completo y matriz de apps. |
| 11. Migración/rollback | Implementada localmente; falta aplicarla y observarla en un entorno de despliegue autorizado. |
| 12. Benchmark | Abierta. No existe harness ni ejecución comparativa. |

## Bloque inmediato obligatorio: corregir lo que la tanda llamó cerrado

### P0 — El replay conserva sólo texto y pierde el resto del resultado del turno

`ConversationsService` guarda en Redis únicamente `response` bajo `turn:reply:*` (`conversations.service.ts:730-750`, `:975-1000`). Al reanudar inicializa `turnEffects` vacío. Por tanto, un crash después de generar y cachear, pero antes de preparar/despachar, reusa las palabras y pierde:

- enlaces de pago producidos por receipts canónicos;
- media y captions;
- huellas de aprendizaje;
- el conjunto exacto de writers/resultados que produjo la respuesta.

En el camino legacy esto ya es una regresión: desde `6ddd1a70` esos efectos se retiraron de `generateResponse` y se mandan después del cache. Si el proceso cae en esa ventana, el replay produce una respuesta sólo de texto y los demás efectos no se recuperan.

El lookup del lote durable tampoco evita repetir negocio: `dispatchReplyThroughOutbox` se llama en `:1043`, después de `generateResponse` en `:976-992`. Un replay sin el cache Redis puede ejecutar de nuevo tools/writers y sólo después descubrir en `:5346` que ya existía un lote.

**Arreglo exigido:** crear un ledger PostgreSQL por inbound para el resultado completo del turno. Debe registrar, con identidad y estados explícitos, resultado textual/chunks, efectos, huellas/fuentes, agente/version/hash, writers y receipts de negocio, handoff y estado de entrega. Consultarlo antes de volver a generar o ejecutar. Redis puede ser cache, nunca autoridad. Recuperar exactamente el sobre original y no regenerar writers. Añadir crashes en cada frontera: después de writer, después de LLM, después de guardar resultado, después de preparar lote, entre ítems y antes del marcador de turno terminado; probar con rollout encendido, apagado y cambio durante replay.

### P0 — La procedencia aprendida falla abierta

Cuando existen ejemplos aprendidos y `createAgentReplyProvenanceCollector` rechaza un scope o ejemplo, el `catch` de `conversations.service.ts:4128-4138` deja `learningFootprints=[]` y continúa. La admisión valida entonces una lista vacía y autoriza palabras derivadas sin fuente/release; el borrado por release tampoco alcanza esas filas.

**Arreglo exigido:** si `learningFootprint.size > 0`, un fallo de construcción/serialización nunca puede degradar a huella vacía. Fallar cerrado antes de cualquier entrega o regenerar una respuesta comprobablemente sin aprendizaje, sin repetir writers. Probar collector malformado, release retirado durante la frontera, cero provider calls y cero fallback legacy con texto aprendido sin autoridad.

### P0 — Las fases del handoff repiten efectos si falla el recibo

`handoff.service.ts:345-350` atrapa y descarta cualquier fallo de `markHandoffEffect`. Los efectos externos ocurren antes del marcador: evento en `:411-414` y correo en `:429-440`/`:483-493`. Si el evento o correo se acepta y la escritura del marcador falla, el receipt queda incompleto y el replay vuelve a emitir/enviar.

El campo agregado `announced` cubre varios listeners (`AgentConsoleGateway`, CRM externo, webhooks, push, Slack y SMS). Con `emitAsync`, un listener puede completar y otro fallar; el replay llama de nuevo a todos. Con `emit`, el marcador puede quedar confirmado antes de saber si los listeners terminaron. Un booleano agregado no prueba cada destino.

**Arreglo exigido:** outbox por efecto/destino con identidad estable, estados `prepared/admitted/accepted/rejected/unknown`, receipts y recuperación propia; o listeners idempotentes por `handoffReceiptId` con almacenamiento durable por consumidor. Nunca ignorar el fallo al guardar el resultado. Correo necesita transporte con resultado estricto y reconciliación si su outcome es desconocido. Probar fallo de COMMIT después de aceptación, fallo parcial de listeners, replay concurrente y crash en cada frontera, demostrando una sola transición, nota, asignación y efecto remoto.

### P0 — El camino desplegado de estados de WhatsApp no usa el receipt del outbox

`6163de30` conectó `applyDispatchProviderStatus` únicamente en la API (`apps/api/.../whatsapp-webhook.service.ts`). El despliegue también publica `wa.parallly-chat.cloud` hacia la app `whatsapp:3002` (`infra/scripts/setup-vps.sh:138-139`), y la documentación operativa configura allí el webhook. Ese worker conserva en `apps/whatsapp/src/modules/jobs/webhook.processor.ts:166-181` el update por `messages.external_id = status.id`.

Los mensajes del outbox usan `external_id` interno y guardan el ID del proveedor en `agent_dispatch_outbox.receipt`; por ese camino los webhooks `delivered/read/failed` no encuentran el mensaje. Además el ranking del worker permite que `failed` sobrescriba `delivered/read`, contrario al contrato nuevo.

**Arreglo exigido:** una única implementación compartida o endpoint interno autenticado para aplicar estados por `(tenant, canal, cuenta, provider receipt)`, usada tanto por la API como por la app WhatsApp. No duplicar SQL divergente. Incluir status duplicado/fuera de orden, rechazo posterior a aceptación y prohibición de degradar `delivered/read`. Probar el recorrido real Meta → app WhatsApp → BullMQ → actualización outbox/historial. Revisar de la misma forma receipts/status de Messenger e Instagram; hoy sus adaptadores descartan eventos de entrega/lectura.

### P1 — Reconciliación y rollout existen como API, no como operación completa

La resolución muta el row tenant primero (`agent-dispatch-outbox.ts:819-862`). `actorId` se descarta y la evidencia queda truncada dentro de `error_code`; el controller intenta después un `auditLog.create`, fuera de esa transacción, y descarta su fallo (`dispatch-rollout.controller.ts:89-100`). Puede haber una decisión irreversible sin actor ni evidencia durable.

Tampoco hay consumidor de `dispatch-rollout` ni `agent-publications` en dashboard/móvil, ni alerta/contador que lea `breachingSla`; sólo endpoints, logs, curl y SQL. El comentario “for an alert to act on” no es una alerta.

**Arreglo exigido:** ledger de decisiones de reconciliación en la misma transacción que el cambio, con actor, rol, evidencia íntegra, receipt, estado anterior/nuevo y timestamp; auditoría global mediante outbox si se necesita duplicarla. Crear pantalla super_admin para rollout/kill switch/backlog/detalle/resolución y pantalla tenant_admin para candidato/publicación/historial/rollback, con permisos, confirmaciones, CAS, estados, i18n es/en/pt/fr y pruebas. Añadir métrica y alerta real de backlog/SLA. `retry` debe publicarse de forma recuperable y conservar la decisión que lo autorizó.

## Continuación del programa después de los P0/P1

### 1. E3 y ejecución completa

- Conectar el productor de WhatsApp Flow al mismo ledger/outbox. Hoy `sendFlow` sale directamente desde `conversations.service.ts:2873-2885`.
- Incluir respuestas humanas, aprobaciones y cada productor externo en un inventario explícito; cada uno debe tener autoridad, idempotencia, receipt, resultado incierto, erasure y recuperación.
- Completar publicación gradual real por tenant/canal/modelo, invalidación de sesiones/caches, rollback y observabilidad; integrar la UI descrita arriba.
- Ejecutar E2E local del turno normal con PostgreSQL + PgBouncer + Valkey/BullMQ + Socket.IO y webhooks, no sólo adaptadores aislados.
- Corregir `docs/agent-platform-implementation-progress.md`: las líneas de E3/G1 y el bloque final aún repiten pendientes que commits posteriores cerraron y conservan contadores históricos 32/10 junto a los nuevos 0/0.

### 2. Competencia real de las 76 plantillas

La matriz actual prueba que el catálogo declara positivos, negativos y verificadores; no prueba que el agente resuelva las tareas. Para cada una de las 268 tareas:

- ejecutar conversaciones completas contra los modelos soportados, en es/en/pt/fr y por canal compatible;
- comprobar recopilación/corrección de slots, cambio/pausa/reanudación de misión, recuperación de objeto propio, propuesta, consentimiento, aprobación, writer, resultado, respuesta fiel y entrega;
- cubrir ausencias, rechazo, duplicado, concurrencia, timeout, resultado incierto, handoff y crash/replay;
- almacenar evidencia inmutable y calcular certificación por perfil/modelo/idioma/canal, sin herencia por similitud;
- mantener bloqueado todo writer sin sandbox/verificador y convertir cada familia restante a comando canónico o handoff explícito.

El objetivo de cierre es **76 perfiles con estado calculado**, no necesariamente 76 habilitados: un perfil puede quedar `no_certificado` si la evidencia demuestra que aún no es seguro, pero ninguna capacidad puede venderse como operativa sin certificado.

### 3. Conocimiento y aprendizaje desde chats

- Llevar procedencia y borrado a historial, outbox, caches, trazas, datasets, respuestas diferidas, replays, jueces y memoria.
- Completar ingesta/segmentación/deduplicación, clasificación factual/estilo/proceso, revisión humana, train/holdout y recuperación de workers con presupuesto/deadline.
- Impedir que estilo aprendido aporte hechos, permisos o resultados; todo hecho debe seguir viniendo de tool/RAG/política vigente.
- Hacer publicación gradual y rollback de releases visibles y auditables en producto.
- Medir naturalidad y cumplimiento contra baseline sin degradar exactitud, seguridad, tools, costo, latencia ni conversión.

### 4. Assist, onboarding, Salud, editor y tours

- Completar las acciones de configuración que faltan: canales, conocimiento, políticas, agenda, catálogo, pagos, roles, publicación y pruebas, según plantilla y plan runtime.
- Unificar assessment y estados `desconocido/pendiente/preparado/probado/operativo/deteriorado` en todas las superficies.
- Mostrar por herramienta objetivo, requisito, relevancia a la misión, dato faltante, ejemplo del negocio, prueba segura y resultado real.
- Validar móvil/escritorio, OAuth retorno/error/timeout, persistencia de agente/contexto, teclado, foco, lector de pantalla, contraste y es/en/pt/fr.
- Ejecutar sesiones moderadas con personas nuevas y registrar tiempo a primer agente operativo, abandono, errores y correcciones.

### 5. Canales, resiliencia y operación

- Certificar WhatsApp, Instagram, Messenger, Telegram y Web Chat con inbound, outbound, media soportada, receipts/status, tokens, reconexión, rate limits, handoff, multi-account, privacidad y un agente por conexión.
- Mantener Email interno y SMS legacy dentro de su alcance documentado.
- Correr carga y chaos: ráfagas concurrentes, locks, PgBouncer, Valkey caído/reiniciado, proveedor lento, timeout, webhook duplicado/fuera de orden, worker muerto, erasure concurrente, cambio de agente/conexión y migración bajo volumen representativo.
- Definir SLOs y alertas accionables para pérdida, duplicado, backlog, reconciliación, latencia, costo y fallos por misión/canal.

### 6. Benchmark reproducible

Construir primero el harness local: corpus congelado, tareas equivalentes, mismos datos/tools/permisos, rúbrica ciega, revisión humana, costo, latencia, tiempo de configuración, éxito confirmado y confiabilidad. Luego ejecutar contra alternativas concretas cuando existan cuentas autorizadas. Hasta tener resultados, no afirmar “mejor del mercado”.

## Validación de esta revisión

- Revisión estática del rango completo y de los puntos de integración nombrados.
- `git diff --check ec430c54..HEAD`: limpio.
- `tsc --noEmit` limpio para API, dashboard, WhatsApp y móvil en el HEAD revisado.
- La repetición focal de Jest en este shell agotó el heap por configuración local; no contradice la corrida completa documentada por Claude y no se cuenta como fallo de producto. La siguiente tanda debe usar el entorno reproducible y los límites de memoria que produjeron 541/541.

## Gates externos reales

Sólo deben quedar al final:

1. credenciales/cuentas/destinatarios de prueba para pilotos de proveedores;
2. personas nuevas reclutadas para la prueba moderada;
3. cuentas autorizadas de alternativas para ejecutar el benchmark;
4. aprobación explícita de push, deploy, migración y activación de piloto/productivo.

El código, UI, fixtures, harnesses, scripts, alertas, protocolos, datasets sintéticos, rúbricas y runbooks necesarios para esas cuatro acciones son trabajo local y deben terminarse antes de invocar el gate externo.

## Prompt corto para continuar en Claude

> Continúa el programa completo desde `30a79102`. Lee y ejecuta `docs/handoffs/2026-09-08/claude-final-completion-review.md` junto con la directiva original. Empieza por los cuatro P0 y el P1: ledger completo del turno, procedencia fail-closed, handoff con efectos idempotentes por destino, estados de WhatsApp en la app desplegada y reconciliación/UI/auditoría atómicas. Después sigue sin pausa por E3, certificación de 76 perfiles/268 tareas, aprendizaje, Assist/onboarding, canales, carga y benchmark. Haz commits locales incrementales y pruebas por bloque. No hagas push, deploy, activación productiva ni llamadas reales a proveedores. No cierres otra tanda mientras quede trabajo implementable en el repositorio; limita los pendientes finales a los cuatro gates externos enumerados.
