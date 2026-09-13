# Muestreo durable de QA

Watchtower sustituye el conteo de muestra sin evaluación por selección persistida y encolado en `quality-scoring`. No almacena transcripciones en sus tablas ni en la cola: conserva referencias a la conversación. El evaluador de producción comprueba privacidad y vigencia antes de leer y publicar derivados.

## Selección y denominadores

A las 02:00 UTC se captura una muestra del día UTC anterior. Son elegibles las conversaciones en canales conversacionales certificados con al menos un texto entrante no redactado cuya última actividad registrada y último mensaje quedaron dentro de esa ventana. No se filtra por resolución; solicitudes sin respuesta y handoffs permanecen elegibles. Una conversación activa después de la ventana no entra en esta tanda. Mensajes sólo multimedia y conversaciones sin texto entrante no están cubiertos por este muestreo.

La fracción es 5 %, redondeada hacia arriba, con límite de 50 conversaciones por tenant/día. La interfaz muestra elegibles y seleccionadas: tres elegibles pueden producir una seleccionada; 1.021 elegibles producen 50, no una supuesta cobertura del 5 % exacto. La selección usa orden de hash estable por conversación/día. El denominador y los IDs se capturan en una consulta común y se persisten bajo lock de la ventana; dos schedulers no crean dos muestras. El barrido pagina todos los tenants activos, sin limitarse siempre a los primeros veinte.

Una muestra ausente tiene cobertura desconocida. Cero elegibles sólo se informa después de una consulta completada y registrada. No se convierten fallos de SQL, migración o cola en cero.

## Cola y privacidad

Los ítems poseen lease, contador de intentos y próximo intento. Un fallo o confirmación incierta de `queue.add` conserva el ítem para recuperación con el mismo ID de trabajo. Los IDs de trabajos se retienen 91 días, por encima de los 90 días de retención del outbox. El mensaje enviado a la cola sólo incluye tenant y conversación. Tras cinco intentos sin confirmación, el estado exige revisión; no significa que el modelo haya fallado ni que el negocio haya incumplido el objetivo.

La recuperación corre cada cinco minutos y, después de las 02:00 UTC, también intenta capturar la ventana pendiente de ese día. Una interrupción superior a un día deja una ventana histórica sin capturar: no se reconstruye retroactivamente una muestra como si se hubiera observado entonces. El borrado publica tombstones y retira referencias de ítems bajo el mismo fence de privacidad. Un worker tardío debe respetar ese tombstone. La confirmación de la cola no acredita que el juez ya haya terminado.

`GET /quality-sampling/:tenantId?day=YYYY-MM-DD` está protegido por autenticación, rol y tenant. El dashboard muestra conteos, método, errores y reintento en español, inglés, portugués y francés, incluso cuando no hay todavía notas QA.

## Evidencia y alcance restante

13 pruebas en dos suites de API pasan, incluidas diez con PostgreSQL real y DDL de contactos/conversaciones/mensajes del producto. Cubren ventana UTC, vacío verificado, solicitudes sin respuesta, privacidad, muestra concurrente, límite de 50, pérdida de confirmación, exclusión mutua de workers y lease agotado. Una prueba usa el cliente Prisma real y los wrappers de consulta/transacción del producto para comprobar parámetros, locks y serialización. BullMQ también se ejecutó contra Valkey 8.1 local desechable, con `noeviction`: un worker terminó antes de perderse la confirmación del productor y el reintento recuperó el mismo job completado, sin ejecutar un segundo trabajo. Seis pruebas de dashboard pasan, con render en los cuatro idiomas y rechazo de denominadores inconsistentes. Dashboard TypeScript comprobado durante la integración.

El servidor de cola real verifica la identidad retenida y recuperación de BullMQ; el worker del test no invoca un modelo. No se probaron cortes físicos, persistencia del disco de producción ni proveedores de modelos. Las métricas por misión/canal/idioma/dificultad y la conversión de fallos revisados a regresiones siguen dentro de H2/H3. La nota de un juez sobre el diálogo y el éxito operacional necesitan evidencias distintas. No se deriva una tasa de éxito del simple encolado.
