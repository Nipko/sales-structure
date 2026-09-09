# Validación adversarial de los hallazgos previos al despliegue

La directiva pide validar cada hallazgo **con una prueba que reproduzca la
condición**, no cerrarlo con una explicación. Esto es lo que se ejecutó antes de
tocar una línea de producción, y lo que respondió el código tal como estaba en
`05d611a3`.

## P0 — el ejecutor no tiene camino operable: **confirmado**

Barrido de importadores sobre `apps/`, `packages/` y `docs/`:

| Símbolo | Importadores fuera del propio archivo |
|---|---|
| `planCertificationLedger`, `driveCertificationRun`, `certificationEvidenceFromLedger` | su spec, dos generadores de documentación y el inventario de salidas |
| `generateBenchmarkCorpus`, `runBenchmarkSubject` | su spec, un generador y el inventario |

`SimulationModule` declara `SimulationService, SimulationProcessor, EvalService,
EvalAutorunListener, EvalAutorunStateService, EvalGateProcessor, WatchtowerService,
AgentReleaseService, AgentReleaseProcessor` y ninguno de los dos. No hay servicio,
processor, controller ni CLI. El hallazgo aplica entero.

## P0 — la autoridad del run no representa 76 perfiles: **confirmado**

Prueba: `certification-ledger.concurrency.postgres.spec.ts`, «names the subject of
each profile». Planea un run con dos perfiles y una autoridad distinta para cada
uno, registra sus casos y lee la evidencia.

```
Expected: Set {"config-first", "config-second"}
Received: Set {"config-1"}
```

Y antes de eso, el compilador ya lo había dicho: `staleSubjects` no existe en el
tipo de retorno de `certificationEvidenceFromLedger`. No había forma de expresar
un sujeto por perfil, ni de invalidar uno sin invalidar los demás.

## P0 — presupuesto concurrente: **confirmado, y peor que «un caso»**

Prueba: «does not hand out more work than the budget can pay for». Presupuesto de
4 centavos, casos de 2. Un ejecutor correcto entrega dos.

```
Expected length: 2
Received length: 4
```

Cuatro leases entregados = 8 centavos comprometidos contra un techo de 4. El
exceso no está acotado por un caso, como afirmaba el manifiesto, sino por cuántos
workers pidan trabajo antes de que el primero registre su resultado. El
`FOR UPDATE` sobre la fila del run sí serializa; lo que estaba mal era la cuenta:
comparaba contra `SUM(cost_usd_cents)` de resultados **ya escritos**.

Con dos transacciones abiertas a la vez y un techo de 2 centavos:

```
Expected length: 1
Received array:  [true, true]
```

## P0 — finalización prematura: **confirmado**

Prueba: «does not call a run finished while another worker still holds cases».
Con todos los casos arrendados y ninguno vencido:

```
Expected: "in_flight"
Received: "complete"
```

El run quedaba `finished` con todos sus resultados en vuelo.

## P0 — resultado rechazado contado como trabajo: **confirmado**

Prueba: «does not count a result the ledger refused as work this worker did». El
runner rota el token del lease mientras corre; `recordCertificationCase` rechaza
la escritura y el driver la suma igual.

```
Expected: 0
Received: 1
```

## P1 — artefactos generados fuera de HEAD: **confirmado**

| Artefacto | Revisión que declara | HEAD |
|---|---|---|
| `closure-report.json` | `1deec8d9` | `05d611a3` |
| `closure-state.json` | `1deec8d9` | `05d611a3` |
| `certification-manifest.json` | `e1ac3943` | `05d611a3` |

Nada fallaba por eso.

## P1 — órdenes y citas históricas: **confirmado en parte**

`ordersWithoutAgreedTermsSql` y `appointmentsWithoutAgreedTermsSql` existen y
cuentan los huérfanos, pero **no tienen ningún llamador fuera de sus pruebas**:
no hay dry-run por tenant, ni cola operativa, ni métrica, ni alerta. El conteo
está disponible y nadie lo pide.
