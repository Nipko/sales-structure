# E2 — Revisión integral y validación de dependencias

La revisión de una prueba deja de identificarse sólo por `configHash`. Agent Test, Eval, Simulation y la comparación de aprendizaje utilizan una revisión compuesta con datos privados congelados y firmas de sus dependencias. La estrategia se declara como `guarded_live_dependencies`: las fuentes que se leen en vivo se comprueban antes y después de herramientas, modelos, turnos y jueces; un cambio invalida el resultado.

## Contenido y procedencia

| Dependencia | Tratamiento |
| --- | --- |
| Configuración, versión, horarios e identidad del agente | Copia JSON privada; firma vinculada al agente, tenant y momento de captura |
| Identidad del negocio, ajustes de cuenta, horarios, plantilla, reglas, catálogos, disponibilidad, políticas, FAQ y procedimientos | Firma SHA-256 de todas las tablas del schema del tenant por defecto; las tablas nuevas entran automáticamente |
| KB y aprendizaje | Incluye documentos, versiones, embeddings, recursos, chunks, aprobaciones, fuentes, ejemplos, revisiones y releases; incluye decisiones de conflictos que afecten recuperación |
| Esquema de datos | Firma de columnas, defaults, constraints, triggers y funciones del schema; detecta cambios incluso en tablas vacías |
| Plan, usuarios operativos, canales, widget y configuración de pagos | Firmas de fuentes públicas acotadas por UUID del tenant; planes y ajustes de plataforma tienen firma propia |
| Herramientas, contratos, plantilla y rúbricas | Firma del artefacto cargado de API y shared; cubre definiciones, políticas y literales de rúbrica |
| Modelos | Firma del registro, orden de fallback, tiers y proveedores configurados; plan y presupuesto se conservan en los inputs privados de la prueba |
| MCP | Discovery estricto y sin caché durante captura. Definiciones aprobadas congeladas; falla explícita si un servidor no se puede consultar. Ejecutar efectos remotos sigue sin estar certificado |
| Procedimientos | Definiciones privadas congeladas; el motor las obtiene mediante `ProcedureDefinitionStore`, aunque el namespace de fixtures no tenga esa tabla |
| Estado de integraciones | Sólo los campos consumidos por el compositor se congelan. Se omiten errores, credenciales y payloads de configuración del proveedor |
| Escenarios y reintentos | Firma del guion, criterio y acciones esperadas. Un resultado previo con la misma key y otro contenido se vuelve a ejecutar |

La captura de base de datos usa una única transacción PostgreSQL `REPEATABLE READ`. Las filas se convierten a firmas dentro de PostgreSQL: ni documentos, vectores, precios ni credenciales se incluyen en el manifiesto público. Las tablas de negocio sin columnas volátiles también incorporan `xmin` para detectar modificaciones confirmadas aunque se restablezca el valor anterior. Las tablas con contadores de uso excluyen solamente esos contadores; las versiones y el contenido siguen incluidos.

Las excepciones se enumeran en `EVALUATION_OUTPUT_TABLES`: salidas de evaluación, telemetría y colas que no alimentan al agente. Las nuevas tablas de decisiones de conocimiento están incluidas; `knowledge_conflict_scans` y `kb_health_issues` continúan como telemetría. `learning_releases` excluye únicamente `evaluation`, `evaluation_status` y su timestamp para no invalidar su propia comparación. El contenido del release sí invalida la revisión.

## Cambios observables

- Una edición de un fragmento KB, FAQ, política o catálogo detiene una sesión anterior aunque no cambie el texto del agente.
- Un cambio durante una llamada invalida la respuesta antes de devolverla o de alimentar otro modelo. La llamada ya consumida conserva su contabilización.
- Los snapshots antiguos que sólo contienen configuración se rechazan con `evaluation_revision_manifest_required`. No se reinterpretan como revisiones completas.
- Simulation persiste `evaluation_snapshot`; el autorun captura la revisión completa al crear la solicitud durable.
- Una lectura fallida nunca se presenta como tabla ausente. Relaciones externas o vistas sin una versión verificable bloquean la captura.
- Los caches de plan y perfil regional no sustituyen las fuentes autoritativas al evaluar. Los jueces y el simulador usan el contexto de ejecución de prueba.
- Las firmas se conservan después de serializar en JSONB; propiedades `undefined` y fechas siguen la semántica JSON del almacenamiento.

## Evidencia ejecutada

- Batch final de integración: 17 suites y 174 pruebas pasan, incluyendo los tests PostgreSQL del sandbox canónico y los del manifiesto.
- Incluye el endurecimiento SHA-256/`xmin`, la prueba de ida y vuelta JSONB y cinco casos PostgreSQL reales del manifiesto sobre una base desechable local.
- PostgreSQL verifica actualización concurrente de documento+embedding dentro de otra transacción, deriva de fuentes individuales, catálogo nuevo, DDL de tabla vacía, actualización con restauración de valores y aislamiento del bookkeeping de evaluación.
- Comando de referencia desde `apps/api`: `node ../../node_modules/jest/bin/jest.js --config jest.config.js --runInBand --testPathPattern='evaluation-revision|agent-test.service.spec' --globals='{"ts-jest":{"isolatedModules":true,"diagnostics":false}}' --silent`. Para los casos PostgreSQL se requiere `PARALLLY_ISOLATION_TEST_URL`, restringida en el test a host local y base `parallly_eval_isolation*`.
- Compilación shared comprobada. La última comprobación global de API no reportó errores de E2; reportó un error concurrente de la interfaz de canal en el frente A3. Se vuelve a comprobar al integrar el commit.

No sumar tandas solapadas. Ninguna de estas pruebas ejecuta un proveedor externo o certifica un perfil comercial.

## Límites y siguiente paso de arquitectura

El manifiesto enumera tres límites: pesos del proveedor sin versión fijada, ejecución externa sin certificar y reloj operativo sin congelar. Los fixtures de negocio continúan siendo sintéticos y aislados, derivados de configuración/horarios; no son una réplica de producción.

La estrategia es conservadora: calcula firmas de fuentes y puede invalidar un run por cambios que no afectaron su caso concreto. No se ha realizado un benchmark sobre un tenant de gran volumen. Antes de habilitar evaluación intensiva a esa escala, incorporar revisiones durables por dominio que todos sus escritores actualicen atómicamente, o un read model de evaluación que reproduzca una revisión inmutable. No reemplazar la guarda por un hash parcial para reducir costo.

Las guardas verifican las fuentes declaradas y los inputs congelados; no garantizan equivalencia bit a bit entre respuestas de un proveedor ni convierten un escenario sintético en evidencia de éxito real. La evaluación y promoción deben seguir mostrando resultados no ejecutados, dependencias desconocidas y familias sin adaptador.

## Corrección E1/H1 incluida

La matriz exige la llamada y el efecto positivo del writer del propio intent. La creación preparatoria de una reserva ya no cuenta como éxito de cancelación. Los metadatos canónicos enlazan cancelar/reprogramar con su verificador sin ampliar el allowlist de ejecución.

Resultado declarado: 76 perfiles canónicos, 254 tareas, 139 transaccionales; 87 tareas con caso positivo propio, 52 sin él y 20 sin verificador. Hay 1392 afirmaciones positivas derivadas en cuatro idiomas y cero perfiles certificados. Los huecos de otras familias siguen visibles.
