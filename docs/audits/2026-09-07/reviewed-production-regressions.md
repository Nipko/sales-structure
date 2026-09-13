# H2 — Incidentes revisados y cobertura de misiones

Fecha: 2026-09-07. Implementación local; no implica publicación ni certificación comercial.

## Flujo implementado

La página `/admin/agent/[agentId]/regressions`, enlazada desde el editor, presenta fuentes vigentes del agente: valoraciones bajas/señaladas de QA y fallos/reconciliaciones del ledger. Una valoración conversacional sigue siendo opinión del evaluador; no se convierte en resultado operacional verificado.

El servidor prepara una propuesta redactada con la referencia al incidente, revisión de conversación, mensajes de origen, versión de configuración y hash de fuente. El episodio toma hasta 16 mensajes públicos anteriores al incidente y declara omisiones/truncamiento. Notas internas, payloads del proveedor y credenciales no forman parte de la propuesta. La redacción automática no se presenta como anonimización completa.

La revisión humana define perfil canónico, misión, idioma, canal, trayectoria, mensajes sintéticos y criterios. Las comprobaciones de herramientas/efectos usan los registros canónicos y verificadores existentes; no aceptan SQL arbitrario. Las misiones que comprometen al negocio requieren comprobar una herramienta de esa misma misión y un efecto observable, también para negativas seguras. Privacidad, exactitud y reproducción deben aceptarse explícitamente con una nota.

Las revisiones se controlan por CAS y quedan en historial. Los casos aprobados son escenarios virtuales reservados `quality_regression:<id>:<revision>`; el CRUD genérico de escenarios no puede crearlos, modificarlos ni eliminarlos. Nunca se copian a entrenamiento ni activan un agente. Su hash canónico cubre contenido, alcance, origen, agente y revisión.

El procesador automático conserva los casos aplicables cuya fuente requiere revisión para que el guard pueda detenerlos. Un request invalidado se trata como terminal antes de entrar al gate, antes de consumir presupuesto y al finalizar. Las regresiones de otros agentes o canales no se incorporan al checkpoint de este agente.

## Integridad y borrado

La aprobación revalida la fuente y serializa su publicación con las modificaciones de la conversación/ledger. El guard de ejecución verifica de nuevo contenido, agente, canal, revisión aprobada, hash y vigencia de la fuente. La interacción con el modelo y el juez mantiene el fence compartido de privacidad durante cada uso acotado del texto; no retiene una transacción por todas las repeticiones del gate.

`eval_runs` guarda `regression_case_ids`, `release_evidence` y `release_readiness`. Los checkpoints automáticos también conservan linaje. La persistencia final y los checkpoints vuelven a verificar la fuente bajo el mismo fence. Un resultado tardío tras borrado sólo puede registrar una fila mínima `invalidated`, sin escenario, respuestas, snapshot ni evidencia de publicación. El `runId` compartido evita duplicar esta fila entre la ruta de éxito invalidado y el manejo posterior del error. Un checkpoint invalidado no entra en reintentos automáticos perpetuos.

Retirar/revisar un caso invalida selectivamente evaluaciones y checkpoints que contienen ese caso. El borrado del contacto y de su familia unificada elimina casos, revisiones, decisiones y artefactos derivados dentro del fence exclusivo. Los casos activos permanecen dentro del manifiesto de dependencias: aprobar un caso nuevo invalida evaluaciones anteriores, aunque éstas no lo hubieran seleccionado.

## Observación de misiones

`agent_mission_turns`, `agent_mission_instances` y `agent_mission_steps` registran referencias y estados tipados, sin mensajes, argumentos ni valores de slots. El runtime espera su escritura en los puntos de contexto, interpretación, booking, procedure, herramientas y cierre/error. Un error de telemetría no rompe la respuesta; aparece como ausencia de cobertura.

Cada observación queda ligada al agente/versión resueltos, hash de la configuración utilizada, perfil/contrato, idioma, canal y mensaje entrante. Las instancias de booking conservan continuidad entre pasos; procedures conservan identidad/versiones de la misión procesada, incluso si al terminar se restaura otra misión pausada. No se atribuye toda una conversación a una sola misión.

La identidad del procedimiento se toma sólo de su resultado explícito. Si el motor no la devuelve, permanece desconocida; no se reutiliza el estado anterior, que podría corresponder a otra misión. La integración del árbitro C1 aporta esa identidad y se valida en su tanda independiente.

El denominador contiene todos los turnos entrantes públicos del período, incluidos aquellos sin respuesta u observación. Un turno con varias misiones participa en varios grupos; el total general cuenta el turno una sola vez. Una edición del mensaje original vuelve desconocida su observación previa. La trayectoria usa `observed_trajectory_v1`: paso sencillo, varios pasos o recuperación observada; no pretende medir dificultad intrínseca.

Límites explícitos: los estados de herramientas son reportes del runtime, no pruebas independientes del ledger ni del resultado del dominio. El fin de un flujo no prueba que se cumplió el objetivo del cliente. Los resultados operacionales quedan `unknown`, sin tasa ficticia de éxito. La proyección de una misión desde su herramienta conserva esa procedencia; no se afirma que equivalga a intención expresada por el cliente. Procedures sin correspondencia explícita con el contrato permanecen con misión desconocida. No se infiere abandono sólo por silencio. Estas observaciones permiten identificar y revisar fallos; aún hace falta integrar verificadores de resultado operacional por dominio para producir tasas de misión verificadas.

## Validación

Resultados finales del lote: regresiones/misión 2 suites, 23 pruebas (14 con PostgreSQL y Prisma reales); integración con QA, Compliance y Eval 7 suites, 77 pruebas; dashboard completo 43 suites, 443 pruebas. Las comprobaciones globales de tipos posteriores señalan únicamente ediciones concurrentes ajenas a este lote (árbitro de misión/ejecutor y contrato compartido); los archivos H2 no reportan errores. El último éxito tardío tras erasure y la fila mínima idempotente se volvieron a probar después del lote integrado.

Integración final con selección de borrador, política de publicación y procesador automático: 8 suites / 99 pruebas pasan, incluidas 14 de regresiones/misiones y 11 de revisiones de configuración con PostgreSQL real. TypeScript de API y dashboard también pasa usando las fuentes exactas preparadas en el índice para este commit, separadas de los cambios concurrentes de catálogo y C1. Los conteos anteriores se solapan.

- API: pruebas de propuestas/redacción en cuatro idiomas, verificadores tipados, aislamiento de agente/canal, revisión CAS y adulteración del escenario.
- PostgreSQL + PrismaClient reales: fuentes QA y ledger, precisión de microsegundos, dedupe, aprobación concurrente, drift de mensajes, uso de fuente concurrente con erasure, retiro selectivo, late results/checkpoints y bootstrap del bloque canónico de esquema.
- Misiones: denominadores con turnos no observados en cuatro idiomas, continuidad entre pasos, múltiples misiones por turno, resultados desconocidos y borrado de observaciones.
- Dashboard: render de revisión/escapado, controles humanos deshabilitados hasta revisión, estados retirados, cobertura desconocida, traducciones ES/EN/PT/FR y contrato de navegación. La evidencia de UI es de render estático; no se ejecutó una sesión manual autenticada de navegador para este lote.
