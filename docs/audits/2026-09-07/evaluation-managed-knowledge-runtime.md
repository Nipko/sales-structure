# Conocimiento administrado en evaluaciones

La captura de Agent Test incorpora una referencia privada y sellada a una copia de conocimiento en PostgreSQL. El contexto RAG automático y `search_knowledge_base` seleccionan esa misma copia. Los argumentos del modelo y el DTO público no pueden sustituirla. Una referencia ausente, vencida, retirada o alterada impide continuar; no habilita una consulta al corpus operativo como alternativa.

La copia conserva siete proyecciones revisadas, incluidas las fuentes de conflictos. El gestor reutiliza hasta cuatro espacios por tenant con propiedad exacta y referencias independientes. Cada espacio admite hasta 512 MiB de datos lógicos proyectados, sin truncar. Esto no constituye un límite de 2 GiB de disco físico ni una cuota comercial. Los índices y el almacenamiento tienen costes adicionales.

## Autoridad durante el uso

Los embeddings, el reranking, la respuesta y los jueces auxiliares conservan la comprobación de fuente por intento. La referencia histórica no sustituye el manifiesto global ni las comprobaciones actuales de privacidad y dependencia. Los controles de RAG, aprendizaje y Replay se componen; Regression utiliza la misma transacción privada de lectura cuando está anidado, evitando una segunda adquisición compartida detrás de un borrado exclusivo en espera.

Si se revoca la fuente durante una respuesta, se descarta el contenido y se conserva el consumo conocido. Los errores del proveedor sólo pueden seguir su recuperación normal si la fuente continúa válida después del intento.

La candidata comprueba su permiso de ejecución con la misma transacción de fuente cuando ya existe una. Esa comprobación sólo lee: no renueva el permiso ni adquiere locks de filas. Consulta `clock_timestamp()` para detectar un vencimiento ocurrido después de abrir la transacción y comprueba que el worker y la candidata siguen vigentes. La renovación y los checkpoints permanecen fuera de ese tramo. Las pruebas reproducen un borrado exclusivo en espera y comprueban que el modelo no se invoca con un permiso vencido o reemplazado.

## Propiedad y retención

Eval libera únicamente las capturas que creó. Las candidatas comparten una captura entre canales: completar un canal no autoriza liberarla mientras otro siga pendiente. Simulation conserva la referencia desde el primer intento de persistencia: una lectura posterior vacía no demuestra que una transacción incierta nunca vaya a quedar visible. Learning conserva las referencias necesarias para trabajos durables y reintentos; sólo un resultado terminal confirmado autoriza liberarlas. Si no se puede establecer el resultado de persistencia o cola, el vencimiento durable permite recuperar el recurso sin destruir el trabajo de otro proceso.

Las evaluaciones automáticas liberan su referencia exacta después de confirmar finalización o invalidación, fuera de la transacción de fuente. Si existe una transacción exterior de fuente o falla la limpieza, la liberación se difiere al propietario exterior o al vencimiento durable. Una fuente vencida se invalida; los fallos recuperables y el presupuesto diferido conservan la referencia. Una confirmación perdida no permite reemplazar un resultado completado por un fallo tardío. Las referencias sustituidas al guardar una solicitud nueva y las persistencias inciertas pueden permanecer hasta su vencimiento.

El servicio programa una limpieza paginada cada cinco minutos. Las referencias tienen plazo fijo y no se prolongan al continuar una sesión. La revisión histórica de un resultado usa su sello; ejecutar de nuevo requiere una referencia vigente. Compliance retira las copias del tenant dentro de la misma transacción exclusiva que borra las fuentes del contacto. Un rollback preserva tanto las fuentes como sus copias.

El retiro automático de Replay que pierde su fuente puede dejar la referencia hasta el vencimiento y la limpieza programada. No se promete liberación inmediata en esa ruta. Los marcadores de tokens se conservan para impedir que un reintento tardío vuelva a crear un uso retirado.

## Validación y límites

La integración quedó registrada en `5f036d10`: TypeScript API y **42 suites / 610 pruebas pasan sobre los archivos exactos del índice**, incluidas **273 pruebas PostgreSQL/Prisma en 17 suites**, sin casos omitidos. La evidencia por bloque se conserva en [Reanudación de commits incrementales](incremental-commits-resumed.md); las cifras se solapan con las tandas anteriores y no se suman como cobertura nueva. Las pruebas usan PostgreSQL/pgvector y Prisma locales desechables; las respuestas y embeddings de proveedores son sintéticos. Incluyen consulta automática/herramienta, alcance, corrupción, vencimiento, revocación durante generación, confirmaciones inciertas y borrado concurrente.

Esto no completa E2 ni certifica agentes: faltan los demás lectores comerciales congelados, reloj coherente, medición de rendimiento y presupuesto agregado bajo carga. El manifiesto global sigue siendo conservador. La eliminación de copias no demuestra borrado semántico de todos los documentos originales, trazas o proveedores. También permanecen los pendientes de efectos operativos, publicación con piloto/rollback, curación semántica, ciclos completos por vertical y validación con usuarios y proveedores reales.
