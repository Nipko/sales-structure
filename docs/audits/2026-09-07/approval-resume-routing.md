# Reanudación de aprobaciones con origen y propietario verificados

Implementación: `9e5016f8`. La conversación conserva el primer agente para atribución histórica, pero una propuesta nueva puede pertenecer al agente que atiende actualmente su conexión. La reanudación ahora usa el selector canónico de producción: conexión exacta, tipo de canal y agente predeterminado, rechazando empates. Compara esa selección con el scope privado original del ledger y con la revisión de borrador, cuando existe. No reconstruye autoridad desde argumentos del modelo ni actualiza una propuesta antigua con una versión nueva.

Se rechazan propuestas sin procedencia válida. El modo legacy requiere scope explícito y sólo existe mientras no haya agentes durables, incluso inactivos. Una operación ya finalizada devuelve su recibo antes de resolver otra vez el agente; no vuelve a ejecutarse por un cambio de routing.

## Propiedad del esquema

El preflight valida UUIDs, nombre de esquema y registro global del tenant. Después abre una transacción corta: privacidad compartida, fila global tenant/esquema con `FOR SHARE`, conversación y selector puro en la misma conexión. No hace bootstrap, DDL, llamadas a proveedores ni ejecuta herramientas dentro de esa transacción. Si el registro cambió entre el lookup previo y el lock, no consulta tablas locales ni llama al finalizador con ese esquema.

El finalizador vuelve a comprobar y bloquear tenant/esquema hasta su COMMIT, antes de leer tombstones, ticket o ledger. Puede limpiar un lease de su propietario inactivo; no escribe mediante un registro ausente o remapeado. Una cuenta remapeada conserva el lease pendiente para recuperación por su propietario legítimo. La validación previa del workflow no sustituye esta comprobación transaccional final.

## Evidencia y límites

TypeScript API pasó sobre el índice exacto. La selección completa terminó con **16 suites / 195 pruebas**, incluidas **91 PostgreSQL/Prisma en cinco suites**, ejecutadas en bases sintéticas de loopback. La primera llamada pasó 188 casos y omitió siete por faltar `AGENT_RELEASE_TEST_DATABASE_URL`; esos siete se ejecutaron después y pasaron sobre la misma copia exacta. No quedan casos omitidos de la selección. Un intento intermedio de esa suite agotó el heap del chequeo TypeScript de Jest; se ejecutó con la configuración aislada de la batería y TypeScript se validó por separado.

Los 15 casos PostgreSQL nuevos cubren selección por conexión/canal/default, propuestas del segundo agente, versiones antiguas, ambigüedad, legacy, recibos previos, remapeo antes del contexto y ambos órdenes concurrentes de finalización. Los tests del executor en esa suite usan un puerto sintético; la batería conserva las pruebas separadas de comandos y entrega aprobada.

Este cambio corrige selección y propiedad al reanudar/finalizar. El preflight termina antes de ejecutar: cada efecto todavía necesita su propia admisión transaccional. No extiende automáticamente el guard de conexión a los dieciséis comandos protegidos por versión, ni completa salida normal, proveedores, handoff, Flow o publicación/piloto/rollback integral. La entrega aprobada local de Web Chat tiene su [guard de conexión hasta COMMIT](approved-webchat-agent-authority.md).
