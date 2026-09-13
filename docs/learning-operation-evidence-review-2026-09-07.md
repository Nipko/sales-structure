# Evaluación de aprendizaje: evidencia por operación

Fecha: 7 de septiembre de 2026. Validación local con datos sintéticos. Este cambio evita inferencias falsas al comparar un candidato con su versión de referencia; no certifica la competencia general de un agente.

## Problema y comportamiento corregido

La evaluación consultaba antes el esquema del tenant de origen, aunque las herramientas escribían en un namespace aislado. La corrección de ese alcance, el identificador del mensaje entrante y sus dos pruebas PostgreSQL quedaron en `3b3927f3`.

Además, el criterio anterior exigía que cambiara la huella agregada de una tabla para reconocer una operación. Un reintento idempotente válido podía marcarse como fallo. A la inversa, cualquier cambio en otra fila del mismo cliente podía dar apariencia de evidencia para una acción que no se había realizado.

`learning-operation-evidence.ts` reemplaza ese criterio dentro del replay de `LearningEvaluationService`. Los conteos y las huellas de tablas siguen disponibles como diagnóstico, pero no prueban una operación. El resultado de cada herramienta se contrasta con:

1. El namespace sintético del tenant, su lease vigente y el contacto y conversación exactos de la evaluación.
2. Una única entrada `succeeded` del registro canónico, de la misma herramienta, con respuesta idéntica normalizada y huella de solicitud válida.
3. El objeto concreto de esa respuesta, perteneciente al contacto de prueba, en la tabla definida por el registro de comandos revisados.
4. Los estados, moneda y versión expresados en la respuesta cuando existen. En pedidos también se contrasta el importe en centavos. Una cancelación exige el estado canónico de cancelación de su familia.

La normalización de respuesta elimina únicamente el indicador superior `idempotentReplay`. No elimina importes, estados, referencias ni otros campos. La referencia mostrada por la herramienta debe coincidir con el objeto derivado de su resultado y argumentos canónicos. Las trazas guardan hashes, referencias sintéticas y estados operativos; no copian la fila completa.

## Interpretación de la evidencia

| Resultado | Significado |
| --- | --- |
| `verified`, `committed` | Se observó durante el turno una respuesta canónica exitosa y el objeto exacto que la respalda. No implica que se haya creado una fila nueva; una cancelación modifica una existente. |
| `verified`, `replayed` | La misma respuesta y huella de solicitud ya estaban registradas antes del turno; el objeto actual sigue respaldando sus datos contrastados. No se exige otra escritura. |
| `unverified` | Falta evidencia, existe una contradicción entre las referencias/estados contrastados, o no hay un verificador revisado para esa herramienta. Es desconocido; no se contabiliza como una operación demostrada ni prueba por sí solo que la operación falló. Bloquea la aceptación de evidencia operacional del candidato mediante un motivo explícito. |
| `not_applicable` | Lectura, rechazo o error explícito de herramienta. La auditoría de afirmaciones sigue comprobando que el agente no declare una acción completada sin respaldo. |

El juez recibe estas reglas y los resultados por operación. Una buena redacción, una afirmación del chat histórico o un acuerdo del cliente no sustituyen el registro operacional. La publicación continúa usando el proceso explícito de revisión y evaluación; no se agrega aprobación automática.

## Evidencia de pruebas

- 22 casos aprobados en cuatro suites de aprendizaje: ocho del verificador, nueve del pipeline A/B y cinco con PostgreSQL y PrismaClient reales.
- Los cinco casos PostgreSQL cubren esquema de origen intacto, aislamiento y lease, una operación exacta y su replay sin cambios, fila ajena/cambio no relacionado, registro fallido e importe contradictorio. Usan únicamente esquemas propios y los eliminan al terminar.
- Tres casos adicionales de la suite canónica comprueban la compatibilidad con la salida real del executor: mensaje persistido → consentimiento → matrícula, y ciclos de alta/cancelación y replay de educación y gimnasio. Cada acción se contrasta con el registro real y el objeto antes del siguiente cambio de estado. Estas tres pruebas usan PostgreSQL mediante el adaptador `pg` de la suite; las cinco anteriores también verifican la serialización de PrismaClient.
- `tsc --noEmit` de API aprobado en este corte.

Para reproducir las pruebas de aprendizaje, definir `LEARNING_EVIDENCE_TEST_DATABASE_URL` con una base desechable en loopback cuyo nombre termine en `_eval_isolation` y ejecutar con Jest `learning-operation-evidence.spec.ts`, `learning-operation-evidence.postgres.spec.ts`, `learning-evidence.postgres.spec.ts` y `learning-evaluation.spec.ts`. Sin la variable, los casos PostgreSQL se omiten explícitamente. La ejecución local utilizó el puerto 55439, sin proveedores externos ni datos reales. Las aserciones del executor están en `isolated-canonical-commands.spec.ts`, con `PARALLLY_ISOLATION_TEST_URL` apuntando a otra base sintética local en 55437.

## Límites que se conservan explícitos

El verificador sólo acepta familias canónicas revisadas: citas, matrículas, reservas de clases, taller y pedidos de catálogo. Otros escritores continúan sin verificación operacional en esta evaluación. No se habilitan herramientas adicionales en sandbox.

La huella de solicitud registrada se preserva y se contrasta durante el replay; no se compara directamente con los argumentos del modelo porque el executor incorpora alcance y términos confiables y normaliza valores. La vinculación usa la respuesta exacta, herramienta, contacto, conversación, registro y objeto.

Si varias acciones del mismo turno modifican sucesivamente el mismo objeto y su estado final ya no respalda una respuesta anterior, esa respuesta queda sin verificar. No se reconstruye un historial intermedio inexistente. Entradas ambiguas tampoco se eligen arbitrariamente.

Esta verificación no demuestra entrega de mensajes, liquidación de pagos, cumplimiento fiscal ni corrección semántica completa de una respuesta. Los comandos canónicos y sus pruebas de dominio siguen siendo responsables de transacciones, capacidad, consentimiento e idempotencia. El juez evalúa el contenido con esos límites; no transforma conteos ni hashes en una certificación comercial.
