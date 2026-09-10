# Correr la suite entera de la API sin nada omitido

Una suite verde con veinte pruebas omitidas no es una suite verde: es una suite
verde y un hueco del tamaño de lo que no corrió. Las omitidas de este repositorio
no están desactivadas — están **condicionadas a infraestructura**, y cada una se
salta sola cuando la variable que nombra su base o su proxy no está puesta.

Este documento es la lista completa de esas variables. Con todas puestas, el
resultado es **594 suites, 0 falladas, 0 omitidas**.

## Instancias desechables

Todo local y descartable. **Nunca** las URLs de producción: cada suite rechaza
una base cuyo nombre no termine en `_eval_isolation` (ver
`common/__fixtures__/disposable-database.ts`), justamente para que una variable
mal puesta no pueda apuntar a una instancia compartida.

| Puerto | Qué es | Para qué |
|---:|---|---|
| 55437 | PostgreSQL 17 | la base de casi todas las suites, y la de migraciones |
| 55438 | PgBouncer (`pool_mode=transaction`, `default_pool_size=1`) | probar los primitivos del turno a través del proxy real |
| 55439 | PostgreSQL 17 + pgvector | conocimiento, memoria y evidencia de aprendizaje |
| 55440 | Valkey 8 (`noeviction`) | cola BullMQ real en las pruebas de despacho |

`parallly_migration_eval_isolation` es una base aparte en 55437, porque la suite
de migraciones aplica el directorio entero contra escrituras concurrentes y no
puede compartir catálogo con las demás.

## Las variables

```bash
ISO='postgresql://postgres:<clave-local>@127.0.0.1:55437/parallly_eval_isolation'
KB='postgresql://postgres:<clave-local>@127.0.0.1:55439/parallly_knowledge_eval_isolation'

export PARALLLY_ISOLATION_TEST_URL="$ISO"
export AGENT_RELEASE_TEST_DATABASE_URL="$ISO"
export AGENT_REVISION_TEST_DATABASE_URL="$ISO"
export CATALOG_ORDERS_TEST_DATABASE_URL="$ISO"
export REPAIR_ORDERS_TEST_DATABASE_URL="$ISO"
export OPERATIONAL_NOTICE_REVIEW_TEST_DATABASE_URL="$ISO"
export DATABASE_URL="$ISO"
export RUN_PIPELINE_OWNERSHIP_PG_TESTS=1

export KNOWLEDGE_MEMORY_TEST_DATABASE_URL="$KB"
export KNOWLEDGE_TEST_DATABASE_URL="$KB"
export KNOWLEDGE_CONFLICT_TEST_DATABASE_URL="$KB"
export LEARNING_EVIDENCE_TEST_DATABASE_URL="$KB"

export PARALLLY_MIGRATION_TEST_URL='postgresql://postgres:<clave-local>@127.0.0.1:55437/parallly_migration_eval_isolation'
export PARALLLY_PGBOUNCER_TEST_URL='postgresql://postgres:<clave-local>@127.0.0.1:55438/parallly_eval_isolation?pgbouncer=true'
export PARALLLY_PGBOUNCER_DIRECT_URL="$ISO"
export DISPATCH_QUEUE_TEST_REDIS_URL='redis://127.0.0.1:55440'
export PARALLLY_SAMPLING_REDIS_URL='redis://127.0.0.1:55440'

# El bootstrap de Nest y los adapters cifrados los exigen para instanciarse.
export JWT_SECRET=... JWT_REFRESH_SECRET=... INTERNAL_JWT_SECRET=...
export ENCRYPTION_KEY=$(printf 'a%.0s' {1..64})

export NODE_OPTIONS=--max-old-space-size=6144
```

`PARALLLY_PGBOUNCER_DIRECT_URL` no es un duplicado: la suite de PgBouncer hace el
DDL por conexión directa y todo lo demás por el pool, igual que producción parte
`DATABASE_URL` de `DIRECT_DATABASE_URL`. Si las dos mitades no nombran la misma
base, el schema se crea donde nadie lo lee.

## El comando

```bash
cd apps/api && node ../../node_modules/jest/bin/jest.js --config jest.config.js --maxWorkers=2
```

Dos cosas que no son negociables y ya costaron una corrida cada una:

- **`--maxWorkers=2`.** `--runInBand` no termina nunca (>1.5 h); con dos workers
  la suite entera corre en ~4.5 minutos. Nunca dos corridas a la vez: cada worker
  se crea su propia copia de la base (`jest.global-setup.ts`), y dos corridas
  simultáneas se pisan las copias.
- **`NODE_OPTIONS=--max-old-space-size=6144`.** Sin eso, V8 muere por heap a
  mitad de la corrida con un stack trace nativo que no dice qué suite lo causó.

Para probar que el orden no importa, `JEST_SEQUENCE_SEED=<n>` baraja el orden de
los archivos (`jest.sequencer.js`); una corrida verde con tres semillas distintas
es lo que hace de la ausencia de interferencia una afirmación y no una esperanza.

## Verificar que no quedó nada omitido

```bash
node ../../node_modules/jest/bin/jest.js --config jest.config.js --maxWorkers=2 2>&1 | grep -E 'Test Suites:|Tests:'
```

`Tests:` no debe traer `skipped`. Si trae, la variable que falta es la de la
suite que se saltó: cada una nombra la suya en su encabezado.
