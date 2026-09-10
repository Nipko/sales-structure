# Evidencia y publicación del agente — E3 en ejecución

El gate devuelve resultados de evaluación y elegibilidad técnica para revisión. `evalActivable` deja de deducirse de una media: aprobar una batería no ejecuta ni autoriza una publicación. Este cambio todavía no implementa el ciclo completo candidato/piloto/publicado/rollback.

## Evidencia implementada

El snapshot privado congela perfil canónico, misión configurada, tipos de canal asignados y los cuatro idiomas que el runtime puede atender. Un perfil desconocido no hereda la certificación del fallback. La misión configurada no se presenta como una revisión humana.

La captura puede seleccionar una revisión editable canónica por UUID, sin reemplazar el agente operativo. Verifica que sea el borrador actual y conserve su base operativa; congela su identidad y hash junto con la configuración y el alcance de canales. Retirar o alterar esos metadatos invalida el snapshot. El almacén está documentado en `agent-configuration-revisions.md`; los consumidores del editor/Assist siguen en integración.

La política comprueba cada caso canónico de seguridad y cada tarea de la misión, en cada idioma y canal requerido. Compara las definiciones de los escenarios con las variantes regionales del pack, exige el hash del escenario ejecutado y los checks de cada intento. No admite puntuaciones agregadas antiguas sin detalle, intentos interrumpidos, señales del juez pendientes de revisión, política de mayoría, verificadores ausentes ni efectos de preparación en lugar del resultado propio de la tarea.

Una misión deliberadamente más acotada puede omitir casos intactos gestionados de otras tareas. Los casos personalizados, alterados y universales de seguridad permanecen: cambiar el nombre o el origen de una regresión no permite ocultarla.

Los checkpoints incluyen revisión integral, configuración, canal, número de repeticiones, política y umbral. Un resultado de Telegram no se reutiliza como prueba de Web Chat; cambiar el criterio obliga a ejecutar otra vez. Un mismo `runId` identifica respuesta, persistencia y evento de finalización o fallo.

Los casos derivados de chats conservan su linaje en los resultados. Cada uso del texto por el agente o el juez revalida la aprobación y la fuente dentro del fence de privacidad. Se valida el escenario aprobado original, antes de sustituir placeholders de fixtures. La persistencia vuelve a verificar la fuente para impedir que un resultado tardío restaure derivados retirados.

`eligibleForReview` significa únicamente que la evidencia técnica presentada está completa para ese alcance. `activationAllowed` y `certified` permanecen en falso. No demuestra comprensión perfecta, exactitud semántica global, recepción por proveedores ni superioridad frente al mercado. El umbral textual conserva el mínimo técnico existente de 7/10; no representa una tasa prometida de éxito operacional.

## Arquitectura pendiente para cerrar E3

La configuración actual se escribe inmediatamente en `agent_personas`, desde Persona, Assist y ciertas operaciones de verticales. La resolución de canales lee esa fila y las aprobaciones de herramientas comparan su versión. Por tanto, añadir sólo un puntero de publicación al resolver de canales sería incorrecto: un borrador nuevo invalidaría operaciones del agente publicado aunque éste siguiera usando la configuración anterior.

El siguiente bloque debe separar revisión editable y revisión operativa:

1. Guardar la configuración candidata en un recurso propio; el agente operativo conserva su versión y su configuración mientras se edita. Unificar las escrituras del editor y Assist en ese contrato. Las restricciones de cuenta, privacidad, permisos y disponibilidad siguen siendo comprobaciones actuales del backend.
2. Evaluar el candidato bajo un snapshot común para todos sus canales. La fecha de captura forma parte de la revisión; no se deben combinar snapshots independientes sólo porque el texto del prompt coincide. Registrar requests y resultados de cada canal, incluidos fallos, con cola, presupuesto y recuperación.
3. Vincular la revisión humana al diff y a esa evidencia exacta. Un nuevo caso obligatorio, un cambio de fuente o un cambio de configuración invalida la aprobación anterior. No sustituir la revisión por el booleano de un juez.
4. Resolver el piloto mediante una asignación estable por cliente/conversación, conservando la regla de un agente por conexión. Registrar la revisión operativa realmente usada en trazas, propuestas y resultados. El porcentaje no puede cambiar la versión dentro de una operación que espera consentimiento.
5. Promover y revertir mediante transiciones atómicas con versión esperada, actor e idempotencia. Revisar también selección de ejemplos de aprendizaje, metadatos MCP y horarios de cuenta: una configuración congelada no congela por sí sola esas dependencias.

Antes de habilitar estas transiciones deben probarse borrador concurrente, cambio de canal, propuesta pendiente, versión retirada, error de cola, pérdida de respuesta y rollback. Las pruebas actuales de la política son deterministas con evidencia sintética; los pilotos de tenant/backend/proveedores y revisión humana siguen pendientes.
