# Reemplazo de workers de evaluación de aprendizaje

7 de septiembre de 2026. Cambios locales posteriores a `b6db0507`, sin commit ni despliegue. Continúa `learning-evaluation-retention.md`.

## Cambio

El identificador de intento no distinguía dos procesos que ejecutaban el mismo trabajo. Un proceso anterior podía guardar un checkpoint, finalizar una comparación o marcar como fallida la ejecución de su reemplazo. Además, el worker leía los checkpoints antes de adquirir el entorno de prueba, con riesgo de retomar una versión anterior.

Cada invocación del procesador genera ahora un UUID propio. Después de adquirir y comprobar el lease del sandbox, `claimEvaluationWorker` compara el propietario observado antes de adquirirlo, guarda el nuevo token en PostgreSQL y recupera los checkpoints actuales bajo el mismo lock de la revisión. Si otro worker ya reclamó el trabajo, la reclamación tardía se rechaza; una repetición incierta de la misma invocación es idempotente. La identidad del intento se conserva para reintentos; la del worker cambia.

| Operación | Control |
|---|---|
| Reanudar | Usa los checkpoints devueltos por la reclamación transaccional, no la lectura previa a adquirir el sandbox |
| Registrar y copiar | El token debe coincidir con el propietario actual; un namespace registrado por otro worker no puede adoptarse silenciosamente |
| Modelo y juez | La autoridad valida el token antes y después del intento externo; descarta una respuesta si otro worker tomó el trabajo mientras esperaba |
| Guardar/finalizar | Lee, verifica token y escribe dentro de la misma transacción; omitir el token tampoco permite modificar una revisión ya reclamada |
| Fallo del procesador | Usa el token local de esa invocación, incluso ante una excepción tardía o reutilización del objeto de trabajo |
| Recuperación de cola | Compara el token observado al leer el trabajo; no marca como fallido un worker reclamado después de esa lectura |
| Limpieza | El proceso anterior conserva la posibilidad de borrar sus nombres exactos de namespace; no necesita seguir siendo propietario del trabajo |

El procesador registra el fallo definitivo dentro de la invocación que lo produjo. Ya no depende de un evento `failed` tardío que solo llevaba el identificador compartido del intento. Los errores reintentables mantienen la revisión en ejecución. Si no llegó a reclamar el trabajo, su token no puede cancelar al propietario anterior; la recuperación periódica concilia el estado pendiente.

El token es contexto interno del servidor y no se incorpora al payload de Redis. Las escrituras condicionadas admiten un registro todavía sin worker únicamente si el llamador tampoco presenta token; una vez reclamado, el token es obligatorio. No se creó una ruta HTTP para reclamar ownership ni se habilitaron nuevas herramientas o publicación del agente.

## Evidencia

**Cinco suites / 83 casos pasan**, incluidos **44 PostgreSQL/Prisma de fuentes y ownership** y bootstrap de `AppModule`. Después de añadir el rechazo explícito de reutilización del namespace anterior, las cuatro suites afectadas pasaron sus 82 casos. El refuerzo de CAS al reclamar e idempotencia pasó las dos suites afectadas / 59 casos. TypeScript de API y `git diff --check` pasan. Estas cifras incluyen pruebas de tandas anteriores; no se suman a ellas.

Los casos PostgreSQL comprueban el checkpoint más reciente al reemplazar, denegación de token anterior/omitido, registro/copia rechazados, finalización exclusiva del propietario vigente, fallo tardío sin cambio de estado, takeover durante una llamada externa y recuperación de cola que observa una generación anterior. Los casos del procesador comprueban dos invocaciones con el mismo objeto de trabajo y el token conservado en la excepción tardía. Se verificó en el código instalado de BullMQ que `attemptsMade` se incrementa al mover el trabajo a fallo; la condición del último intento usa su valor más uno dentro de `process`.

## Límites y continuación

La exclusión del entorno continúa usando el lease existente de Redis; el token de PostgreSQL decide quién puede registrar evidencia después de una nueva reclamación. Estas pruebas no simulan todas las particiones entre Redis, PostgreSQL, BullMQ y un proveedor externo, ni prueban recuperación bajo carga. La continuidad durante esas particiones sigue requiriendo pruebas de proceso y cola reales.

La continuación `learning-external-source-authority.md` agrega embeddings de aprendizaje, búsquedas/memoria históricas y reintentos de SDK. Continúan otras salidas externas, la retención completa de trazas/caches, los lectores congelados con tráfico concurrente y la calibración de calidad por perfil/canal/idioma. Esta tanda protege la autoría de la evidencia; no demuestra por sí misma que el agente sea competente en cada tarea.
