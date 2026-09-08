# Reanudación de commits incrementales

7 de septiembre de 2026. A petición del usuario, se retomó el registro de los cambios locales acumulados después de `b6db0507`. La revisión automática volvió a autorizar las operaciones normales de Git. No se utilizó un mecanismo alternativo para eludirla.

## Bloques registrados

| Commit | Cambio | Validación de este bloque |
|---|---|---|
| `41243a73` | La revisión de candidatas queda vinculada al cuerpo completo de configuración, canales y activación; interfaz en cuatro idiomas | API y dashboard TypeScript sobre el índice; 4 suites / 58 casos API y 14 casos dashboard sobre copia del contenido registrado |
| `38cf627a` | Autoridad de fuente por intento del proveedor, incluidos reintentos y fallback; opciones de transporte fuera del input del modelo | API TypeScript sobre el índice; 3 suites / 41 casos con SDK y transporte simulado |
| `3ef34ac3` | Procedencia de configuración obtenida de la misma selección de agente; primitiva transaccional de comprobación | API TypeScript sobre el índice; 7 casos PostgreSQL, repetidos sobre los blobs exactos del índice al validar el bloque de conocimiento |
| `e3ac0917` | Las consultas de producto y envío de imagen distinguen una lectura fallida de un producto ausente | API TypeScript sobre el índice; 5 suites / 54 casos |
| `f586d383` | La búsqueda, reranking, embeddings y memoria conservan la revocación de fuente y evitan reutilizar la caché compartida bajo esa autoridad | API TypeScript sobre el índice; 6 suites / 76 casos, incluidos los 7 de routing mencionados arriba |
| `4ecbb4b8` | Doce herramientas comprueban la versión operativa en la transacción del efecto; el runtime transmite su procedencia y las propuestas pendientes rechazan una configuración distinta | API TypeScript sobre el índice; 12 suites / 156 casos, incluidos PostgreSQL, aprobaciones, recibos anteriores y bootstrap de API |
| `a70995f7` | Captura y sella contexto del negocio, región, configuración de horarios, contexto vertical, FAQs y políticas; los lectores usan esos inputs privados en evaluación | API TypeScript sobre el índice; 21 suites / 289 casos verificados por bloques, con 65 casos PostgreSQL/Prisma y bootstrap |

Las cifras se solapan entre bloques y no se suman como cobertura nueva. Los controles de proveedor usan respuestas sintéticas; las pruebas PostgreSQL se ejecutan en las bases desechables locales de evaluación.

## Cómo se verificó la separación

Se seleccionaron archivos y cambios concretos en el índice, conservando los cambios restantes del directorio de trabajo. TypeScript se comprobó contra los archivos del índice, excluyendo los archivos fuente todavía sin registrar. Las suites se ejecutaron en una copia bajo `scratch/`, con las dependencias instaladas del workspace.

La reutilización inicial de esa copia dejó un archivo de memoria desactualizado y provocó un fallo. Se corrigió la preparación exportando los blobs exactos mediante `git show :ruta` y comprobando su contenido. La tanda de conocimiento y los casos PostgreSQL de routing pasaron después de esa corrección. La revisión API y dashboard de candidatas también se repitió sobre esa copia actualizada.

La integración de contexto se probó además con el commit anterior de autoridad. La tanda detectó dos fixtures incompletos: la construcción manual de snapshots de candidatas y una prueba que debía proporcionar autoridad válida para alcanzar el bloqueo de escritura. Se incluyeron sus ajustes existentes y las dos suites afectadas pasaron al repetir sus 32 casos; las otras 19 ya habían pasado. Los 289 casos corresponden a esa selección integrada, no a una corrida global del repositorio.

## Trabajo que continúa

Este registro no declara concluido el plan de plataforma. La integración temporal de evaluaciones, el ciclo de aprendizaje, Replay, los ciclos de vehículos y mascotas y la réplica RAG tienen cambios locales que se separan en bloques posteriores. La extensión reciente de slots y referencias de uso de la réplica RAG permanece fuera de los bloques validados hasta tener sus propias pruebas. Congelar la configuración de horarios todavía no congela el reloj ni completa la integración temporal del sandbox.

El conjunto de herramientas protegido del commit de runtime contiene doce comandos de citas, gimnasio, educación, taller y catálogo. Los cambios locales amplían ese conjunto junto con los comandos canónicos de vehículos y mascotas: esa ampliación debe registrarse con sus implementaciones y pruebas, no sólo con los nombres del conjunto. La publicación HTTP del agente sigue pendiente.

No hubo push, despliegue ni migraciones de tenants operativos. Los cambios ajenos a este plan permanecen en el directorio de trabajo.
