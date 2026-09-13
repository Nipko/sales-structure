# E3 — candidatos, evaluación durable y revisión humana

Este corte implementa la preparación y revisión de una versión candidata. No publica configuraciones, no habilita un piloto y no certifica resultados de mercado. La promoción y la retirada operativa son transiciones posteriores del mismo plan.

## Contrato

`POST /agent-releases/:tenantId/agents/:agentId` recibe únicamente una revisión de borrador almacenada por el servidor y una clave de solicitud. El actor procede de la autenticación. No acepta snapshots, puntuaciones, umbrales ni resultados enviados por el navegador.

El backend inicializa las tablas y escenarios antes de capturar. Después de la captura vuelve a leer el inventario de casos y comprueba la misma revisión. Conserva una sola configuración, conjunto de dependencias e inventario para todos los canales asignados. PostgreSQL registra el candidato y una solicitud por canal en una transacción; BullMQ lleva exclusivamente identificadores y es recuperable.

Cada worker adquiere una autorización de ejecución con vencimiento. La renueva antes de usar herramientas, reservar presupuesto de modelo y guardar avances. Un proceso atrasado no puede terminar el trabajo de quien lo reemplazó. Los checkpoints sobreviven a reinicios y al agotamiento del presupuesto diario. El contador compartido mide llamadas de modelo, no dólares.

La evaluación utiliza tres intentos por caso, política de aprobar todos y umbral ocho. No sustituye la evaluación de herramientas por la opinión del juez: permanecen las verificaciones canónicas y los escenarios positivos de la misión, junto a los casos universales y las regresiones aplicables. Cada canal usa la misma captura; no se mezcla una ejecución de Telegram con otra de Web Chat.

Las respuestas efectivamente generadas se conservan para revisión, con límite explícito de longitud. Una muestra truncada no satisface la revisión. La elegibilidad técnica exige cobertura en los cuatro idiomas que el runtime puede usar. La interfaz de revisión debe mostrar muestras por idioma y canal, además de resultados y faltantes.

Una decisión humana identifica el hash de evidencia, versión del candidato, muestras revisadas y declaraciones de objetivo, instrucciones, hechos, herramientas, estilo y límites. El servidor vuelve a verificar fuentes y dependencias. CAS impide decisiones rivales y la clave de solicitud permite recuperar la misma decisión sin duplicarla. La aprobación registrada todavía no altera `agent_personas`.

## Privacidad y aislamiento

Los datos privados de captura no forman parte de mensajes de cola. Los lectores no entregan muestras cuya revisión ya no se puede verificar. El retiro de una regresión o el borrado de su fuente elimina escenarios, transcripts y evidencia derivados del candidato; queda un registro mínimo de invalidación. Un worker anterior pierde su autorización para restaurarlos. Los errores públicos usan códigos acotados, no cuerpos de proveedores o SQL.

Las tablas de candidatos, trabajos y revisiones son salidas de evaluación y no invalidan su propia captura. Las fuentes y revisiones de configuración siguen siendo dependencias. La nueva cola forma parte de la verificación de trabajos al purgar un tenant.

## Evidencia del corte inicial

- 18 pruebas con PostgreSQL y Prisma reales: atomicidad multicanal, concurrencia e idempotencia de solicitudes/revisiones, recuperación del lease y checkpoints, presupuesto diferido, referencias de otro alcance, omisión de canal, mismatch de escenario/política, muestras faltantes, revisión obsoleta e invalidación de derivados.
- 12 pruebas de orquestación: caída de cola después de persistir, inventario leído después de capturar, recuperación con IDs, reanudación de checkpoints, cuota/entitlement, pérdida de autoridad, fuente cambiada y errores sanitizados.
- La revisión de código y los casos adicionales se registran antes del commit final de esta unidad. Los resultados sintéticos del test de transacciones prueban las reglas de almacenamiento y aprobación; no son resultados de un modelo real.

## Límites que continúan dentro del plan

La estrategia actual vigila dependencias vivas completas. Cambios operativos concurrentes pueden invalidar una evaluación larga. Antes de presentar este flujo como disponible continuamente en un tenant activo, debe resolverse mediante una réplica congelada o dependencias efectivamente utilizadas, demostrando que ningún lector se escapa a la captura. No se omiten tablas para hacer pasar una evaluación.

Continúan la interfaz de candidatos, promoción atómica, piloto con selección estable por conversación, rollback y creación inicial sin publicación implícita. El navegador real, proveedores externos y usuarios nuevos siguen pendientes de validación. Una revisión humana de muestras no equivale a inspección exhaustiva ni acredita que el negocio completó una operación en producción.
