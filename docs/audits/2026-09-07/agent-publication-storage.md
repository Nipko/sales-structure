# Publicación: almacenamiento transaccional y prerrequisitos

Fecha: 7 de septiembre de 2026. Implementación local; no se ha publicado un agente ni cambiado un tenant existente.

## Contrato implementado

`AgentPublicationStore` es una primitiva interna. Recibe un candidato aprobado, su hash de evidencia, la versión del candidato, la versión y hash operativos esperados, actor y clave de solicitud. El cuerpo a publicar se lee de la revisión persistida; no acepta una configuración aportada en la petición de publicación.

La transacción comprueba revisión humana y evidencia, borrador vigente, base operativa exacta y propiedad de las asignaciones. Conserva el cuerpo anterior y el posterior, cambia configuración/conexiones/versión, escribe un recibo durable y retira únicamente el puntero del borrador publicado. Las revisiones históricas permanecen. Un conflicto no desasigna otro agente. Las solicitudes repetidas devuelven el recibo original incluso después de una desactivación; nunca vuelven a aplicar el cambio.

El rollback sólo restaura el cuerpo anterior del último evento de publicación, contrastando su hash y el estado operativo actual. Usa una versión nueva y creciente. No acepta un cuerpo arbitrario, no reescribe un borrador posterior y no restaura una versión antigua como si siguiera autorizando consentimientos pendientes. Revalida prerrequisitos actuales antes de restaurar.

Los eventos no copian chats ni resultados de herramientas: guardan configuración administrativa, hashes y referencias a la revisión. No se exponen como JSON de configuración en una API pública. El historial de configuración y su política de retención deben integrarse con la futura interfaz administrativa.

## Prerrequisitos actuales

`assertPublicationPrerequisites` utiliza la misma conexión y transacción del cambio. Lee tenant, suscripción durable, reloj de PostgreSQL, plan de ejecución seleccionado y overrides registrados. Reutiliza la política de acceso a la suscripción y la misma combinación de overrides del runtime; no usa Redis ni inventa un plan cuando falta la fila.

Comprueba cupo de agentes activos, familias permitidas para el tipo de negocio, funciones habilitadas por el plan, prompt libre y misiones del perfil. Cuando el agendador está habilitado vuelve a verificar servicios y disponibilidad, incluso si también estaba habilitado en la versión anterior. Conserva locks de las filas comprobadas hasta terminar la transacción. No consulta proveedores ni descifra credenciales.

El validador de configuración canónico es un argumento interno obligatorio. El almacén exige además callbacks internos de vigencia del candidato y prerrequisitos; nunca pueden venir del cuerpo HTTP.

## Pruebas y límites

- 28 casos PostgreSQL/Prisma en la suite de candidatos: 18 previos de solicitud, evaluación y revisión, más 10 de publicación/rollback. Los puntajes son sintéticos para probar el contrato de almacenamiento, no calidad de un modelo.
- 12 casos de prerrequisitos y compatibilidad del throttle en dos suites unitarias.
- Cuatro casos adicionales PostgreSQL/Prisma comprueban serialización real, autoridad de suscripción, cupos/overrides y locks de plan/disponibilidad. Crean una base dedicada con nombre `publication_<uuid>_eval_isolation` en el servidor desechable local; la eliminan al terminar. No alteran tablas públicas de otros tests.
- El probe de concurrencia y su informe documentan por separado por qué un lock externo que dura toda una herramienta no basta: `agent-publication-lock-audit.md` y `agent-publication-lock-probe.cjs`.

**No hay endpoint ni botón de publicación conectado a esta primitiva todavía.** Faltan integrar la autoridad de versión en las transacciones de todos los efectos relevantes, la vista de activación y asignaciones exactas, la revalidación de fuentes, publicación/eventos durables y piloto por tenant. Los helpers y los puntajes sintéticos no habilitan esa frontera por sí solos.

Tampoco se ha estrechado el manifiesto global. El tráfico concurrente aún puede invalidar evaluaciones; el trabajo de captura y linaje debe completar sus puertos antes de cambiar ese contrato. Una configuración probada en una captura histórica no certifica disponibilidad, conocimientos ni condiciones futuras.
