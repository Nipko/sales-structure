# Costo local de las firmas de evaluación

Medición del 7 de septiembre de 2026 a las 15:14 UTC, con PostgreSQL, pgvector y PrismaClient reales en un contenedor desechable. Se ejecutó el método de producción `EvaluationRevisionService.capture` y su comprobación `assertCurrent`; la firma del router fue una constante de prueba y no hubo llamadas a modelos.

| Mensajes de 1.024 caracteres | Documentos de 4.096 caracteres | Vectores de 1.536 dimensiones | Primera captura (ms) | Capturas posteriores (ms) | Comprobar vigencia (ms) |
|---:|---:|---:|---:|---:|---:|
| 100 | 100 | 100 | 136 | 45–46 | 42–46 |
| 1.000 | 500 | 1.000 | 104 | 99–101 | 99–102 |
| 5.000 | 500 | 1.000 | 129 | 117–123 | 119–121 |

Hubo 44 tablas del tenant: cuatro con datos y cuarenta vacías para observar también el costo de descubrir y consultar tablas. Cada tamaño tuvo una captura inicial y tres repeticiones. La primera medición incluye calentamiento de código/cachés; las siguientes no son arranques fríos del servidor. Los resultados completos están en `evaluation-revision-benchmark.json`.

La comprobación vuelve a firmar el contenido completo. Incluso este corpus pequeño requiere decenas o más de cien milisegundos por guarda; varias guardas en un turno pueden sumar un costo apreciable antes del tiempo del modelo. No se ha medido aquí una conversación completa ni la latencia de producción.

## Implicación para E2

La estrategia vigente conserva la integridad a costa de releer datos. Para reducir ese costo hay que validar una captura realmente congelada de las dependencias de lectura, o generaciones monotónicas de cambios con cobertura comprobada de todos los writers, SQL directo, nuevas tablas y fuentes globales. No basta con cachear el hash de `config_json` ni con aumentar su TTL: eso volvería a admitir evaluaciones obsoletas.

Continúan pendientes un corpus representativo de un tenant grande, pruebas de carga simultánea, memoria/CPU del VPS, proveedor real y comparación de alternativas. Los textos sintéticos repetidos son compresibles; la distribución de tamaños y valores no representa documentos de clientes. El host se comparte con otras tareas, por lo que estos tiempos no son una promesa de capacidad ni un SLO.

## Reproducir

`apps/api/scripts/benchmark-evaluation-revision.ts` exige `EVALUATION_REVISION_BENCHMARK_URL` apuntando a loopback, puerto 55439 y una base desechable cuyo nombre termine en `_eval_isolation`. No admite un tenant existente: genera un esquema y un UUID propios, limita el volumen a 5.000 mensajes/1.000 vectores y elimina exclusivamente esos objetos con `RESTRICT`.

Ejecutar con `TS_NODE_PROJECT=apps/api/tsconfig.json` y `node -r ts-node/register/transpile-only -r tsconfig-paths/register apps/api/scripts/benchmark-evaluation-revision.ts`. La URL local de prueba no se imprime ni se almacena en el informe. El script no llama a `PrismaService.onModuleInit` ni aplica migraciones a tenants existentes.
