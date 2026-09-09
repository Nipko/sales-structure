# Tres corridas completas consecutivas, con órdenes distintos

La directiva pide, para el ítem 1: «Ejecuta la suite varias veces, con orden/seed
distintos y `--maxWorkers=2`; no aceptes "pasa sola" como cierre».

Lo que se hizo. Tres corridas **completas** de `apps/api`, una detrás de otra, sin
tocar el código entre ellas, cada una con una semilla de orden distinta que
baraja el orden de los ARCHIVOS (`apps/api/jest.sequencer.js`). El orden dentro
de cada archivo queda intacto a propósito: varias suites de esta base son
deliberadamente secuenciales, y `--randomize` rompía cinco por eso. Lo que
importaba medir era **qué suites corren al lado de cuáles**, que es de lo que
depende la interferencia entre suites.

Guion: `scratchpad/three-runs.sh`. Cada corrida:

```
JEST_SEQUENCE_SEED="<seed>" NODE_OPTIONS=--max-old-space-size=6144 \
  npx jest --maxWorkers=2 --testTimeout=180000
```

| # | Seed | Suites | Pruebas | Fallidas | Omitidas | Tiempo |
|---|------|-------:|--------:|---------:|---------:|-------:|
| 1 | `order-20260909` | 580 / 580 | 6338 / 6338 | 0 | 0 | 237,8 s |
| 2 | `order-4711` | 580 / 580 | 6338 / 6338 | 0 | 0 | 245,0 s |
| 3 | `order-90210` | 580 / 580 | 6338 / 6338 | 0 | 0 | 244,6 s |

Los tres órdenes fueron efectivamente distintos —las primeras cinco suites de
cada corrida no coinciden—:

| # | Primeras cinco suites |
|---|---|
| 1 | `billing.service` · `public-api.controller.appointments` · `agent-release.postgres` · `learning-inbox-source.postgres` · `normal-turn-e2e.postgres` |
| 2 | `staff-operations-model.service` · `tool-approval.controller` · `learning-inbox-source.postgres` · `agent-release.postgres` · `normal-turn-e2e.postgres` |
| 3 | `learning-dedup-review-history.postgres` · `agent-release-scenario-integrity` · `agent-test-knowledge-replica.postgres` · `durable-dispatch.chaos` · `evaluation-knowledge-lifecycle.postgres` |

`Tests: 6338 passed, 6338 total` en las tres: ninguna omitida. Una prueba omitida
no es una prueba aprobada, y por eso el conteo se registra entero y no sólo el
verde.

## Qué eliminó la sensibilidad al orden

No fue serializar. Fue quitar el estado compartido:

- `apps/api/jest.global-setup.ts` crea **una base por worker**
  (`parallly_wN_eval_isolation`), la borra y la recrea en cada corrida, y le
  provisiona extensiones y las tablas globales sintéticas. Antes, `public.tenants`
  y `public.users` eran estado compartido entre workers: una suite que las creaba
  con forma propia o las soltaba al terminar rompía a su vecina.
- `apps/api/jest.setup-worker-database.ts` reescribe las URLs por
  `JEST_WORKER_ID`, de modo que cada worker habla con su propia base.
- El propio `globalSetup` **se niega a correr** si otro jest tiene esas bases
  abiertas (`pg_stat_activity`), porque el DROP de un segundo proceso destruye la
  corrida en vuelo. Eso ya pasó una vez durante este trabajo.
- `apps/api/jest.sequencer.js` permite fijar el orden de archivos por semilla,
  que es lo que hace reproducible una corrida sospechosa.

Registro crudo: `scratchpad/order-20260909.log`, `order-4711.log`, `order-90210.log`.
