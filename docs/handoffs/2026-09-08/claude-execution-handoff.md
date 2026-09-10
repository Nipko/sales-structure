# Continuación de la ejecución por Claude — 8 de septiembre de 2026

## Punto de partida

El usuario pidió cerrar esta última tanda y preparar la continuación por un agente de Claude, con el mismo plan y commits incrementales. La tanda queda cerrada; **el plan integral sigue pendiente**. No reiniciar el análisis ni reducir el alcance a Web Chat.

Workspace: `C:\Users\USER\Desktop\Sales_Structure`. Rama al cierre: `main`. Último commit de implementación: **`735a05113ac4e06f01be8ff6b2e61d224e3dbff9`**, precedido por `1f704ddc`. El commit documental que contiene este archivo es el punto de traspaso; consultar `git log -5 --oneline` para obtener su hash. No se hizo push, despliegue, llamadas a proveedores reales ni migración de tenants operativos.

La estimación comunicada sigue siendo **60–65% del plan completo**, sin recalcularla por este cierre. Es una estimación de implementación, integración y validación, no un porcentaje obtenido de commits o tests. Matriz vigente: **76 perfiles, 268 tareas, 146 transaccionales, 32 sin positivo propio, 10 sin verificador y cero perfiles certificados**. Hay 15 writers auditados en evaluación aislada y 16 herramientas con autoridad operativa; son inventarios distintos.

Leer en este orden:

1. `AGENTS.md`, `CLAUDE.md` y las instrucciones de la aplicación correspondiente, conservando los cambios locales existentes.
2. [Registro de implementación y tabla A1–H3](../../agent-platform-implementation-progress.md): fuente vigente del estado del programa.
3. [Plan de experiencia/configuración](../../assist-agent-experience-audit-2026-09-05.md) y [plan de runtime/aprendizaje](../../agent-runtime-learning-plan-2026-09-05.md). Su diagnóstico inicial es histórico; las correcciones posteriores se registran en la introducción y bitácora.
4. [Plan de autoridad de salida normal](../../audits/2026-09-07/normal-agent-dispatch-authority-plan.md): siguiente frente concreto, criterios de aceptación y secuencia posterior.
5. [Bitácora de commits incrementales](../../audits/2026-09-07/incremental-commits-resumed.md) y los artefactos de esta carpeta.

## Qué quedó terminado en esta tanda

| Commit | Implementación incorporada | Validación sobre el índice exacto |
| --- | --- | --- |
| `1f704ddc` | Tablas de procedencia de respuestas normales Widget; borrado de contenido derivado por destinatario, fuente de entrenamiento/holdout o versión; integración con Compliance y retiro de aprendizaje; conserva una constancia mínima del inbound para impedir regeneración tras borrar | TypeScript API pasa. 14 suites / 220 pruebas, incluidas 97 PostgreSQL/Prisma en cuatro suites; cero omitidas |
| `735a0511` | Colector privado de procedencia durante la respuesta; unión de grupos históricos por agente; validación de fuentes en la conexión existente; lector de procedencia del historial Widget que distingue historial sin evidencia de una respuesta borrada | TypeScript API pasa. 13 suites / 228 pruebas, incluidas 86 PostgreSQL/Prisma en tres suites; cero omitidas |

Las baterías se solapan; no sumarlas como cobertura nueva. [Resumen verificable](validation-summary.json) conserva las suites, conteos y archivos de cada bloque. Los resultados/logs originales permanecen en `scratch/widget-reply-retention-commit/` y `scratch/widget-reply-provenance-commit/`, ignorados por Git.

Límites exactos:

- `widget-agent-reply-retention.ts` ya tiene consumidores de borrado. El productor de recibos de respuestas normales todavía no está conectado al runtime activo. El DDL está en `tenant-schema.sql`; no se aplicó a tenants existentes.
- El borrado limpia texto, medios, caption, metadata y procedencia; conserva identidad del recibo/inbound y estado `redacted`. No eliminar esa constancia ni tratarla como una respuesta ausente. Un rollback de aprendizaje por sí solo no borra mensajes ya guardados; el retiro de fuentes/borrado tiene su propio recorrido.
- `agent-reply-provenance.ts` acumula proyecciones exactas, sin copiar texto de ejemplos; incluye grupos de agentes anteriores del mismo tenant. Rechaza conflictos de versiones, pertenencia o estructura. Una mezcla fallida no modifica parcialmente el colector.
- `createAgentReplySourceAuthority` comprueba tenant/esquema, incluso con grupos legados vacíos, y revalida antes/después del intento de proveedor sobre el fence compartido. No introduce locks de filas del negocio durante ese intento ni una segunda transacción anidada de fuentes.
- `readWidgetAgentHistoryFootprints` usa la conexión suministrada. El consumidor debe establecer la pertenencia del tenant y el fence de privacidad. La ausencia de un recibo significa historial sin seguimiento, no prueba de ausencia de aprendizaje. La constancia `redacted` se busca por ID antes de filtrar sus vínculos ya borrados.

## Trabajo en curso preservado, sin activar

La integración core/Gateway/store se retiró del código activo y se guardó íntegra en [normal-widget-integration.draft.patch](normal-widget-integration.draft.patch), con [manifiesto](normal-widget-integration.manifest.json). No se descartó su implementación. **Es un borrador con bloqueos conocidos; no está certificado ni listo para desplegar.**

- Base de captura: `1f704ddc8dcc0e1c2996b6cbd20ad107063e74f9`. Requiere también los helpers ya incorporados en `735a0511`.
- SHA-256 del parche: `39d4cf1e5cf2bcb6c1a6884706c19b7153982a794dd44bdb573845cdb7d2f55a`.
- Se comprobó `git apply --check` después de retirar el borrador del árbol activo. Además se aplicó a una copia aislada de su base en `scratch/` y se compararon los hashes de los seis archivos, normalizando CRLF/LF, con el manifiesto: todos coinciden. Esa comprobación acredita conservación del código, no funcionamiento de la integración.

| Archivo dentro del parche | Trabajo preservado |
| --- | --- |
| `apps/api/src/modules/conversations/conversations.service.ts` | Cambia el flujo Widget de strings a referencias de recibos; exige inbound persistido; conserva scope y fuentes durante generación/reescrituras/historial; espera el COMMIT antes de soltar el mutex |
| `apps/api/src/modules/conversations/conversations.widget-containment.spec.ts` | Adapta fixtures al contrato de recibos; falta aceptación completa de core y handoff |
| `apps/api/src/modules/widget/widget-agent-reply.store.ts` | Store nuevo: vínculo tenant/conexión/contacto, recibo terminal, admisión de versión y aprendizaje, mensaje/recibo/índice de fuentes atómicos, publicación posterior al COMMIT |
| `apps/api/src/modules/widget/widget-agent-reply.postgres.spec.ts` | Veinte casos del store con PostgreSQL pasaron durante desarrollo; no constituyen la aceptación integrada ni se incluyen en los conteos de los commits |
| `apps/api/src/modules/widget/widget-delivery.module.ts` | Registro del store |
| `apps/api/src/modules/widget/widget.gateway.ts` | Consume referencias y sincroniza por el transporte persistido/autenticado; deja de guardar texto independiente |

El borrador evita crear nuevas copias de texto normal en Redis; bloquea una caché legada sin recibo con `widget_legacy_reply_requires_review`, para no atribuir palabras antiguas a una versión nueva. El store devuelve recibos existentes antes de resolver una nueva admisión; `redacted` es terminal. La revisión de pertenencia durante bootstrap precede al DDL. El retry local se limita a rollback conocido `55P03`; un ACK incierto de COMMIT no autoriza repetir.

## Primera entrega que Claude debe completar

**Resolver la confirmación de handoff antes de integrar el parche.** El flujo puede ejecutar `HandoffService.executeHandoff`, dejar la conversación en `waiting_human`/`with_human` e intentar guardar después su aviso. El store rechaza correctamente una nueva respuesta del modelo cuando la conversación pertenece a una persona: ocurre el handoff, pero el cliente recibe un error Widget.

La solución debe ser un **recibo canónico durable de handoff ligado al inbound y a la transición exactos**, con un aviso determinista autorizado por ese recibo. No permitir respuestas arbitrarias del modelo en conversaciones humanas, no introducir una excepción a través de metadata pública y no repetir la transferencia para recuperar el aviso. Revisar tanto el handoff directo de `processWidgetMessage` como el handoff posterior a herramientas dentro de `generateResponse`. El identificador Redis `hoff_${Date.now()}` y el metadata actual de la conversación no son por sí solos ese recibo.

Criterios pendientes antes del commit de integración:

1. Handoff directo y posterior a herramientas con servicios reales: aviso recuperable una vez, sin otro writer ni respuesta AI en conversación humana; compatibilidad con avisos/aprobaciones ya existentes.
2. Historial borrado: el parche ya filtra `content_type='redacted'`, texto nulo y vacío antes de construir contexto, pero falta probarlo. Un turno nuevo después del retiro debe funcionar sin aprendizaje retirado. Si el borrado ocurre entre leer texto y leer procedencia, el texto anterior debe bloquearse. No silenciar la constancia borrada ni permitir texto legado sin seguimiento.
3. Publicación/cambio de agente o conexión y retiro de fuentes **durante** la admisión, además de los rechazos previos ya ensayados. Preservar orden de locks, privacidad y las proyecciones train/holdout de todos los grupos históricos.
4. Aceptación integrada de core, Gateway y transporte persistido: actualizar fixtures que todavía esperan `streamWidgetMessage`, probar rollback conjunto, COMMIT con ACK perdido, recuperación, reconexión y ACK autenticado. `stored` es distinto de recepción del navegador.
5. Revisar el crash después de ejecutar un writer y antes del recibo final. El parche no demuestra recuperación durable de toda la generación; no regenerar ciegamente un turno ni repetir comandos aceptados. Completar el diseño con ledger/recibos antes de declarar esa recuperación cerrada.
6. TypeScript API, bootstrap, suites afectadas y PostgreSQL/Prisma sobre el índice exacto. Añadir Socket.IO cuando se verifique la entrega y mantener regresiones de humanos, draft y avisos canónicos.

Para reanudar en este workspace, después de leer y comprobar el estado:

```powershell
git status --short
git log -5 --oneline
Get-FileHash -LiteralPath docs/handoffs/2026-09-08/normal-widget-integration.draft.patch -Algorithm SHA256
git apply --check docs/handoffs/2026-09-08/normal-widget-integration.draft.patch
git apply docs/handoffs/2026-09-08/normal-widget-integration.draft.patch
```

Aplicarlo una sola vez, para continuar el desarrollo. Si la comprobación falla por cambios posteriores, comparar el manifiesto/base con el árbol actual y reconciliar los cambios; no forzar una restauración global. Mantener el parche archivado como evidencia histórica después de integrar una versión corregida.

## Continuación del plan completo

Después de la entrega anterior, seguir la tabla A1–H3 y la secuencia del plan de despacho:

1. **E3 — salida normal:** outbox durable y recuperación; transporte estricto/texto; medios, enlaces y Flow. Recibos separados para imagen/caption, sin fallback por timeout incierto ni retry oculto. Después: handoff general, otras fronteras de efectos y publicación HTTP/promoción/piloto/rollback integral.
2. **E2 — evaluación reproducible:** lectores comerciales congelados, integración del capturador piloto de servicios, reloj coherente, presupuesto/rendimiento y evaluación bajo tráfico. RAG administrado ya está integrado en `5f036d10`; no rehacerlo ni contarlo como ausente.
3. **C/E/H — competencia por tarea:** cerrar positivos y verificadores faltantes, términos de otras familias, históricos, recuperaciones y escenarios completos. Regenerar la matriz al cambiar packs/verificadores y acreditar resultados por perfil, idioma, canal y revisión.
4. **G/D — aprendizaje útil:** retiro de otras salidas/trazas/caches, proceso/cola y despacho diferido, costo/deadline integral, curación humana y mejora semántica medida. Aprender tono no puede degradar veracidad, permisos, herramientas ni reglas del negocio.
5. **F/H — experiencia y evidencia real:** revisión visual/accesibilidad de Assist/editor/Inbox, tours/onboarding con personas nuevas, pilotos de backend/proveedores y benchmark. Los fixtures HTTP y pruebas aisladas no sustituyen esas verificaciones.

El scope y las fuentes siempre proceden del resultado original. Un recibo ya aceptado se recupera sin nueva admisión. La aceptación remota incierta requiere conciliación; no prometer exactly-once remoto ni volver a enviar ciegamente. Productores humanos, automatizaciones y avisos operativos conservan sus autoridades propias. El guard de conexión de entregas aprobadas no se propagó automáticamente a las dieciséis herramientas.

## Forma de trabajo que se debe conservar

- Continuar autónomamente dentro del plan autorizado; documentar para el cierre decisiones de producto que no puedan resolverse con las reglas existentes. No detener cada bloque por decisiones reversibles.
- Commits incrementales por comportamiento coherente y validado. Si se usan subagentes, asignar archivos/frentes independientes y mantener un único responsable de Git. Revisar la integración antes de hacer commit.
- Añadir rutas explícitas o hunks revisados. No usar `git add .` ni incluir cambios ajenos. Verificar `git diff --cached --check`, contenido del índice, TypeScript y pruebas pertinentes sobre esos mismos bytes. Los archivos no staged no forman parte de la evidencia del commit.
- Registrar hash, conducta comprobada, pruebas, resultados y límites en la bitácora y actualizar A1–H3 cuando corresponda. No sumar baterías solapadas ni convertir un test de infraestructura en certificación comercial.
- Mantener SQL parametrizado/UUID, aislamiento por tenant, i18n en es/en/pt/fr al tocar interfaz y reglas vigentes de canal/plan/plantilla. El runtime de planes y los contratos del código son la fuente de verdad.
- Este cierre no incluye push ni despliegue. `main` dispara despliegue según la configuración del proyecto; no confundir un commit local con autorización de publicación.

Cambios ajenos que permanecen al cerrar y que no deben añadirse a estos commits: `CLAUDE.md`, `docs/plan-profitability-2026-07.md` y el archivo sin seguimiento `docs/whatsapp-meta-pricing-2026-10.md`. También permanecen marcas previas sin diff sustantivo en `automation.module.ts`, `conversations.module.ts` y `whatsapp.module.ts`. Revisar su diff, no restaurarlas globalmente. `.validate-index.cjs` es un helper local sin seguimiento y `scratch/` está ignorado; no incluirlos. Un archivo histórico `.git/index.lock.stale-workshop-20260907` no es un permiso para borrar locks activos.

## Entorno de validación disponible

Se utilizaron exclusivamente instancias locales desechables: PostgreSQL 17.11 en **55437**, PostgreSQL 17.11 con pgvector 0.8.6 en **55439**, Valkey 8.1 con `noeviction` en **55440**. Verificar procesos/puertos y disponibilidad antes de reusarlas o iniciar otra instancia; no asumir que siguen vivas al reabrir la sesión. No utilizar las URLs del entorno productivo.

Variables usadas por los tests (credenciales sintéticas locales):

```powershell
$env:PARALLLY_ISOLATION_TEST_URL = 'postgresql://postgres:codex_eval_local_only@127.0.0.1:55437/parallly_eval_isolation'
$env:AGENT_RELEASE_TEST_DATABASE_URL = $env:PARALLLY_ISOLATION_TEST_URL
$env:KNOWLEDGE_MEMORY_TEST_DATABASE_URL = 'postgresql://postgres:codex_knowledge_local_only@127.0.0.1:55439/parallly_knowledge_eval_isolation'
$env:KNOWLEDGE_TEST_DATABASE_URL = $env:KNOWLEDGE_MEMORY_TEST_DATABASE_URL
$env:LEARNING_EVIDENCE_TEST_DATABASE_URL = $env:KNOWLEDGE_MEMORY_TEST_DATABASE_URL
```

Herramientas locales de la tanda, inspeccionables en este mismo workspace:

```powershell
node .validate-index.cjs apps/api/tsconfig.json
node scratch/export-commit-index.cjs
$env:LEARNING_VALIDATION_DIR = 'claude-widget-integration-commit'
$env:WIDGET_RETENTION_VALIDATION = '1'
node scratch/validate-learning-footprint-index.cjs
```

El exportador prepara `scratch/commit-validation` a partir de blobs del índice y verifica sus bytes; el runner añade specs staged a una batería base. **Ampliar explícitamente la selección para Gateway, handoff, recibos y las carreras nuevas**: ejecutar el comando sin specs staged no reproduce por sí solo las baterías anteriores. Los helpers son locales, no parte del repositorio distribuido. En otro checkout, reconstruir la exportación exacta y usar las listas del resumen JSON con `node node_modules/jest/bin/jest.js --config apps/api/jest.config.js --runInBand --runTestsByPath ...`; establecer las variables anteriores y comprobar que no haya tests omitidos por falta de base. El runner local usa `ts-jest` en modo aislado y TypeScript se comprueba por separado.

## Prompt de continuación

> Lee `docs/handoffs/2026-09-08/claude-execution-handoff.md` y continúa la ejecución integral del plan de Parallly desde ese punto, con commits incrementales por bloques validados. Conserva los cambios ajenos. Empieza por corregir el recibo durable de handoff y completar la integración normal de Web Chat preservada en el parche; después sigue A1–H3. Mantén pruebas y límites explícitos, reserva para el cierre las decisiones de producto aún necesarias y no hagas push ni despliegue como parte de esta continuación local.
