# Directiva para Claude: cerrar íntegramente el plan de agente de Parallly

Fecha: 8 de septiembre de 2026. Punto de partida revisado: `ec430c5473da7f8a9de68667e3bf9a4d6ab469df` sobre `main`.

## Mandato del usuario

Continúa de forma autónoma hasta terminar **todo el programa autorizado** de configuración, operación, herramientas, conocimiento, aprendizaje, evaluación, onboarding y experiencia del agente. No cierres otra tanda por haber terminado únicamente una infraestructura o una parte de E3. No entregues un nuevo plan como sustituto de la implementación. Implementa, integra, migra, prueba, corrige y documenta hasta que cada requisito A1–H3 tenga evidencia suficiente para quedar aceptado.

Mantén commits locales incrementales y revisables. Después de cada commit continúa con el siguiente bloque; no esperes confirmación para decisiones técnicas reversibles ya cubiertas por este mandato. No hagas `push`, despliegue, activación productiva del nuevo despacho ni envíos a clientes reales. Los pilotos externos solo pueden usar cuentas, destinatarios y credenciales de prueba autorizados. Si una validación depende realmente de una credencial o acción externa ausente, termina antes todo el código, UI, migraciones, pruebas locales y runbook posibles, y deja ese único gate externo identificado con precisión. No llames “completo” a algo que todavía pueda cerrarse dentro del repositorio.

Esta directiva amplía y sustituye el prompt corto de continuación del traspaso anterior. Los documentos anteriores conservan su valor como evidencia y fuente de requisitos.

## Fuentes de verdad y orden de lectura

1. `AGENTS.md` y `CLAUDE.md`, aplicando primero las instrucciones vigentes del usuario y conservando los cambios locales ajenos.
2. `docs/agent-platform-implementation-progress.md`, incluida la tabla completa A1–H3. Es el registro vigente del programa.
3. `docs/assist-agent-experience-audit-2026-09-05.md`.
4. `docs/agent-runtime-learning-plan-2026-09-05.md`.
5. `docs/audits/2026-09-07/normal-agent-dispatch-authority-plan.md`.
6. `docs/audits/2026-09-08/normal-widget-admission-and-handoff-receipt.md` y `docs/audits/2026-09-08/normal-dispatch-outbox.md`.
7. `docs/handoffs/2026-09-08/claude-execution-handoff.md` y las bitácoras enlazadas desde allí.

Antes de editar, ejecuta `git status --short`, `git log -20 --oneline` y revisa los diffs locales. En el punto de partida había cambios ajenos en `CLAUDE.md`, `docs/plan-profitability-2026-07.md`, `automation.module.ts`, `conversations.module.ts`, `whatsapp.module.ts`, `.validate-index.cjs` y `docs/whatsapp-meta-pricing-2026-10.md`. No los restaures, sobrescribas ni incluyas accidentalmente. No uses `git add .`.

## Definición de terminado

El programa solo termina cuando se cumplen simultáneamente estas condiciones:

1. Cada fila A1–H3 del registro tiene implementación integrada, criterios de aceptación ejecutados y evidencia enlazada. “Parcial”, “infraestructura lista”, “pendiente de productor”, “sin verificador”, “sin positivo”, “sin UI” o “sin recuperación” no son estados finales.
2. Las 76 plantillas y sus 268 tareas tienen capacidad, datos requeridos, dependencias, comandos, verificador, escenarios positivos y negativos y estado de certificación calculado con evidencia. Deben quedar en cero las 32 tareas sin positivo propio y las 10 sin verificador registradas al inicio. Una plantilla no hereda certificación por similitud.
3. El agente operativo comparte el mismo núcleo y las mismas reglas de negocio con Agent Test, Eval, Simulation y aprendizaje. Los modos sin efectos externos usan adaptadores controlados, pero prueban el mismo comando, autoridad, estado y resultado.
4. Cada tarea crítica cubre el recorrido completo: intención, información faltante, recuperación del objeto propio, propuesta, consentimiento, aprobación cuando corresponde, writer canónico, resultado de negocio, respuesta fiel, entrega, reintento, resultado incierto, handoff y recuperación después de crash.
5. Assist puede diagnosticar y ejecutar configuraciones autorizadas de cuenta y agente con cambios tipados, diff, permisos, idempotencia, CAS, auditoría, relectura y prueba posterior. Inicio, onboarding, editor, Salud, tours y Assist muestran el mismo assessment y distinguen desconocido, pendiente, preparado, probado, operativo y deteriorado.
6. El onboarding se valida con usuarios nuevos y en móvil/escritorio: explica el efecto de cada dato, mantiene contexto y agente seleccionado, avanza por condiciones verificadas, recupera OAuth y errores, funciona con teclado/lector y conserva paridad i18n en es/en/pt/fr.
7. El aprendizaje desde chats conserva consentimiento, tenant/contacto/agente, procedencia, deduplicación, privacidad, revisión humana, train/holdout, versión, retiro y propagación de borrado. El estilo aprendido nunca se usa como fuente factual ni debilita herramientas, permisos, políticas, seguridad o verdad del negocio.
8. Los canales certificados de autoservicio —WhatsApp, Instagram, Messenger, Telegram y Web Chat— tienen recorridos operativos completos para los tipos de efecto que soportan. Email sigue siendo interno hasta que exista realmente configuración tenant, transporte bidireccional, UI, pruebas y soporte operativo; SMS conserva su alcance de notificación unidireccional. No certifiques alcance inexistente.
9. No quedan suites rojas aceptadas como “baseline”. Las 16 suites rojas registradas en `ec430c54` deben clasificarse y corregirse, o demostrarse eliminadas/reemplazadas por una prueba canónica equivalente. La suite completa debe quedar verde en un entorno reproducible.
10. TypeScript, builds, bootstrap, pruebas unitarias, PostgreSQL/Prisma, pgvector, Valkey/BullMQ, Socket.IO, aislamiento multi-tenant, i18n, accesibilidad, recorridos visuales, carga y degradación controlada están ejecutados según el área modificada. Los tests omitidos por falta de servicio no cuentan como aprobados.
11. Las tablas nuevas tienen migración idempotente para tenants existentes, dry-run, observabilidad y rollback operativo. El bootstrap perezoso no sustituye la migración de producción.
12. La afirmación “mejor del mercado” solo puede respaldarse con benchmark reproducible contra alternativas concretas, mismo corpus, permisos, tareas y revisión humana, midiendo resultado confirmado, confiabilidad, costo, latencia y tiempo de configuración. Mientras falte ese benchmark, usa una formulación verificable y no declares superioridad.

## Bloque inmediato obligatorio: corregir la última tanda antes de activar E3

La base incorporada entre `64dc8d75` y `ec430c54` es útil, pero la revisión posterior encontró riesgos que bloquean cualquier piloto del nuevo despacho. Ciérralos primero con commits separados y pruebas de integración.

### 1. Propiedad del lote ante COMMIT incierto y cambios del switch

`ConversationsService.dispatchReplyThroughOutbox` evalúa el rollout antes de buscar un lote existente y convierte cualquier error de `prepare` en autorización para usar la ruta legacy. Una pérdida del ACK del COMMIT puede dejar el lote confirmado y provocar después un segundo envío legacy. Un replay con el switch apagado tiene el mismo riesgo.

Implementa una consulta canónica por tenant + `inbound_message_id`. Un lote existente siempre conserva la propiedad de la respuesta, incluso si cambió el switch. El switch decide solamente si se crea un lote nuevo. Tras una excepción ambigua de `prepare`, consulta el lote bajo su identidad antes de considerar cualquier fallback; si no puede demostrarse rollback, falla cerrado o recupera. Añade pruebas de ACK perdido, replay con gate apagado, error de lectura y cero invocaciones legacy después de una posible confirmación.

Al recuperar un lote existente, valida al menos conversación, contacto, canal, cuenta, recipient, batch único e índices contiguos. La regla de “original result wins” puede conservar el payload original, pero nunca aceptar silenciosamente un binding diferente.

### 2. Unificar el reloj de reintentos de PostgreSQL y BullMQ

Hoy la fila puede quedar `failed` con `available_at` futuro, el retry de BullMQ llega antes, `dispatch_not_available_yet` retorna éxito y el job queda `completed`. Recovery encuentra el job retenido y no lo vuelve a publicar. Los fallos de credenciales/preflight pueden sufrir la misma pérdida.

Usa una sola autoridad de programación. Mueve el job a la fecha durable mediante `moveToDelayed` y `DelayedError`, o adopta una identidad de job por intento que permita republicar con seguridad. Recovery debe poder reactivar un job completado obsoleto. Prueba el ciclo real con BullMQ + Valkey: fallo retryable, backoff, job completado/failed, recovery, agotamiento y un solo POST por permiso.

### 3. Garantizar secuencia real de los efectos del lote

El `item_index * 1200` actual no garantiza orden con varios workers, latencia o reintentos. La admisión de `N` debe comprobar durablemente el estado de `N-1`, o el worker debe encadenar el siguiente ítem únicamente después de confirmar el anterior. Define política explícita por tipo: texto posterior, imagen/caption, payment link y Flow/fallback. Una caption no puede adelantarse a la imagen ni enviarse si el fallo de la imagen vuelve falso su contexto. Prueba concurrencia, lentitud del primer proveedor, rechazo, reintento y crash entre ítems.

### 4. Asociar receipts del proveedor con el historial y representar estados verdaderos

El mensaje usa `out:dispatch:<inbound>:<index>` como `external_id`, mientras el `wamid`/`message_id` queda en el outbox. El webhook de WhatsApp busca el receipt en `messages.external_id`, por lo que no encuentra las filas nuevas. Además, una aceptación HTTP se escribe hoy como `delivered` aunque la entrega real llega después por webhook.

Conserva la identidad interna de deduplicación y añade una relación consultable con el ID del proveedor, mediante columna dedicada o join outbox→message. Modela `pending`, `sent/accepted`, `delivered`, `read` y `failed` sin conflarlos. Conecta webhooks de estados de WhatsApp y los equivalentes soportados, con eventos fuera de orden, duplicados y rechazo posterior a aceptación. Ajusta analytics e Inbox para usar los significados correctos.

### 5. Recuperar los efectos internos posteriores al handoff

Receipt, estado y nota del handoff confirman juntos, pero autoasignación, Redis, evento/Socket.IO y correo suceden después. Un crash en esa ventana deja el receipt existente y `executeHandoffOnce` retorna sin terminar las notificaciones.

Crea efectos durables e idempotentes del handoff, o fases recuperables con estado por efecto. Deben poder completarse asignación, aviso al inbox y notificación sin repetir transición, nota ni correo ya aceptado. Prueba crash después de cada frontera, replay concurrente y resultado incierto del correo.

### 6. Hacer seguro y operable el rollout

`DispatchRolloutService` acepta cualquier string como canal aunque no tenga `StrictDispatchTransport`. Intersecta la configuración con un registro canónico de transportes migrados antes de crear el lote. Una configuración errónea debe fallar cerrada sin apropiarse de una respuesta que no puede enviar.

Conserva `platform_settings` con allowlist de tenant/canal como kill switch operativo. No lo reemplaces por una feature comercial de plan. Si el plan limita la capacidad, evalúa por separado entitlement comercial y rollout seguro. Añade escritura administrativa protegida, auditoría, validación, invalidación de caché, lectura de estado efectivo, métricas y rollback inmediato.

### 7. Construir reconciliación operativa real

`reconciliation_required` no puede terminar en un log. Añade listado/alerta, detalle sin exponer PII indebida, búsqueda por receipt/binding, acción humana auditada y transiciones permitidas. Ninguna resolución puede repetir un POST sin evidencia de no ejecución. Incluye SLA, métricas de backlog y runbook.

Los fallos permanentes o preflight agotados también deben actualizar atómicamente el estado visible del mensaje. Conserva `pending` únicamente cuando el resultado sea realmente incierto.

### 8. Clasificación de errores por proveedor

No adoptes la regla global “todo 5xx respondido es rechazo retryable”. Una respuesta 5xx sin receipt tampoco demuestra que el proveedor no actuó. Por defecto, un estado/código no reconocido es `unknown`. Implementa clasificadores por proveedor, código, subcódigo y señal transitoria documentada; solo reintenta cuando exista evidencia suficiente de que no ocurrió el efecto. Registra la decisión por canal y cúbrela con fixtures de respuestas reales anonimizadas o contratos oficiales.

### 9. Corregir evidencia y documentación

Messenger ya implementa `StrictDispatchTransport`, aunque `normal-dispatch-outbox.md` todavía afirma lo contrario. `buildDispatchItems` ya divide tipos, mientras el productor normal actual solo alimenta texto. Corrige estas afirmaciones y distingue claramente primitiva implementada, productor conectado, transporte soportado, integración probada y piloto certificado.

## Continuación obligatoria del programa completo

Después de estabilizar E3, continúa sin pausa por los frentes siguientes. Usa la tabla A1–H3 como checklist ejecutable y actualízala solo con evidencia.

### E3 y operación completa

- Transportes estrictos para Instagram y Telegram, además de WhatsApp y Messenger; Web Chat conserva su admisión local autenticada.
- Productores normales de texto, medios, captions, enlaces canónicos de pago y Flow. Ninguna URL de pago escrita por el modelo obtiene autoridad.
- Ledger durable para recuperar un turno cuyos writers ya se ejecutaron, sin regenerar comandos ni duplicar efectos.
- Integración real end-to-end por Socket.IO, colas y webhooks; handoff y respuestas humanas conservan autoridades distintas.
- Publicación HTTP de candidatos, promoción gradual, invalidación, rollback y observabilidad completa.
- Migración y backfill de todas las tablas/índices nuevas para tenants existentes.

### C, E y H: competencia verificable por plantilla y tarea

- Cierra todos los positivos, negativos y verificadores faltantes; incluye datos ausentes, rechazo, duplicado, concurrencia, recuperación e incertidumbre.
- Completa términos históricos y consentimiento para cada familia que ejecuta obligaciones, pagos, reservas, matrículas, pedidos o manejo de datos sensibles.
- Congela lectores comerciales, reloj, servicios, precios, inventario, agenda, políticas, FAQs y RAG usados por Eval/Simulation para que una repetición sea explicable.
- Ejecuta conversaciones completas con modelo para cada perfil y tarea crítica, no solo writers aislados. Certifica por perfil, idioma y canal con evidencia de resultado de dominio.
- Regenera la matriz después de cada bloque y evita que cobertura ausente aparezca como aprobada o como falla del agente.

### D y G: conocimiento y aprendizaje útil desde chats

- Lleva el colector de procedencia a turnos de mensajería y a cada salida derivada. El borrado por release/fuente/contacto debe alcanzar outbox, historial, cachés, trazas, datasets y respuestas diferidas.
- Completa ingesta, segmentación, deduplicación semántica, clasificación factual/estilo/proceso, revisión humana, calibración y despacho diferido con costo/deadline durable.
- Mantén holdout cerrado y evita contaminación entre evaluación y aprendizaje. La publicación gradual y rollback deben retirar derivados de forma comprobable.
- Mide si el aprendizaje mejora naturalidad y cumplimiento sin degradar exactitud, herramientas, seguridad, permisos ni conversión.

### F: Assist, configuración, onboarding y tours

- Assist debe explicar y también completar tareas autorizadas de configuración de tenant y agente. Para cada acción: intención, campos requeridos, diff, autorización aplicable, escritura tipada, relectura, prueba y resultado.
- Unifica assessment entre Inicio, onboarding, tarjeta del agente, editor, Salud y Assist. Una consulta fallida aparece como desconocida/reintentable y nunca como configuración ausente.
- Por herramienta muestra qué consigue, cuándo aplica a la misión, qué necesita, qué falta, ejemplo del negocio, prueba segura y resultado. No promuevas activar herramientas irrelevantes.
- Convierte tours en tareas verificadas, con retorno desde OAuth, continuidad entre dispositivos, móvil, accesibilidad y cuatro idiomas.
- Ejecuta revisión visual real de todos los recorridos y pruebas moderadas con personas nuevas. Registra fricción, tiempo para dejar operativo el agente, errores y correcciones.

### E2, H2 y H3: evaluación, carga, pilotos y benchmark

- Presupuesto durable, recuperación, coalescencia y estado visible de autorun/evaluaciones; prueba que jobs fallidos retenidos no bloquean versiones nuevas.
- Pruebas de carga y fallos: mensajes simultáneos, locks, PgBouncer, Redis/Valkey no disponible, proveedor lento, webhook duplicado/fuera de orden, borrado concurrente y cambios de agente/conexión.
- Métricas con denominadores por misión, perfil, idioma, canal y dificultad: éxito de negocio, contención apropiada, handoff correcto, exactitud, costo, latencia y satisfacción. No derives éxito de `ai_resolved` ni de ausencia de excepción.
- Pilotos seguros con tenants y proveedores de prueba cuando existan credenciales autorizadas. No uses clientes reales ni enciendas el rollout global.
- Benchmark reproducible frente a alternativas relevantes. Conserva corpus, herramientas, permisos y juez humano equivalentes.

## Disciplina de commits y validación

1. Un commit por comportamiento coherente y ya validado. Divide contratos/migración, productor, worker, UI y evidencia cuando facilite revisión, sin dejar una frontera peligrosa activa a mitad de serie.
2. Antes de cada commit revisa `git diff`, agrega rutas explícitas, ejecuta `git diff --cached --check` y confirma que el índice contiene únicamente el bloque propio.
3. Prueba sobre los mismos bytes del índice o sobre una exportación verificable. Registra comando, suites, casos, omitidos, servicios usados y limitaciones. No sumes baterías solapadas.
4. Mantén actualizado `docs/agent-platform-implementation-progress.md` y la bitácora incremental con hashes y evidencia. Corrige documentación obsoleta en el mismo bloque que cambia su verdad.
5. Conserva SQL parametrizado y casts `::uuid`, aislamiento schema-per-tenant, fences de privacidad, una conexión operacional por agente, planes runtime y traducciones es/en/pt/fr.
6. Ejecuta al menos TypeScript/build del paquete afectado, bootstrap de NestJS, suites focalizadas, integración real de infraestructura y suite completa antes del cierre. Corrige flakes y baseline rojo; no los normalices.
7. Continúa automáticamente después de cada commit. Un informe de progreso no sustituye el siguiente bloque.

## Formato del informe final de Claude

Entrega únicamente cuando no quede trabajo implementable del programa. Incluye:

- rango completo de commits y una línea de comportamiento por commit;
- tabla A1–H3 con `aceptado` y vínculo a evidencia, o un gate externo concreto que no pueda ejecutarse sin acceso del dueño;
- matriz final de perfiles/tareas, conteos de positivos/verificadores/certificados y resultados por idioma/canal;
- resultados de TypeScript, builds, bootstrap, suite completa, PostgreSQL/pgvector/Valkey/BullMQ/Socket.IO, carga, visual, accesibilidad y pilotos;
- migraciones, dry-run, rollback y runbooks de operación/reconciliación;
- decisiones de producto tomadas con su evidencia, incluida la política por proveedor para resultados inciertos;
- lista exacta de acciones externas restantes, limitada a credenciales, cuentas de prueba, despliegue o activación productiva que no estaban autorizados;
- `git status --short`, demostrando que no quedaron cambios propios sin commit y distinguiendo los cambios ajenos preservados.

No uses porcentajes para declarar cierre. “Completo” significa que los criterios anteriores están satisfechos y que una revisión adversarial no encuentra rutas anunciadas sin autoridad, recuperación, verificador, UI operable o evidencia.

## Prompt corto para iniciar

> Lee y ejecuta íntegramente `docs/handoffs/2026-09-08/claude-complete-plan-directive.md`. Este es un mandato para terminar todo el programa A1–H3, no para preparar otro plan ni cerrar una tanda parcial. Empieza corrigiendo los bloqueos de la última implementación, continúa con commits locales incrementales y no te detengas entre bloques. Conserva los cambios ajenos. No hagas push, despliegue, activación productiva ni envíos a clientes reales. Solo deja pendientes las acciones que dependan estrictamente de credenciales o acceso externo del dueño después de haber terminado todo lo implementable y su runbook.
