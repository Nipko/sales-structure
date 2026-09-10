# Revisión de certificación, publicación y cierre — Codex

Fecha: **10-sep-2026**. Código revisado: **`7c9eb04b9978c668e77abe89eaad2e6f0f9ae615`**. Revisión local sin cuentas, credenciales, llamadas de proveedor ni base de datos. No se modificó producto ni se repitió la suite completa. Esta revisión añade únicamente este informe y el reproductor que lo acompaña.

**Conclusión:** la nueva prueba de publicación aporta evidencia útil de persistencia, selección de configuración y rollback. Los artefactos derivados están actualizados por contenido. Sin embargo, **sí quedan defectos locales antes del canario de certificación**: el adaptador consume una forma distinta a la que devuelve el gate real, pierde costo y resultados, y el plan económico no cuenta todas las llamadas. Por tanto, ya no se sostiene que sólo falten gates externos.

## P1 — El runner de certificación pierde el resultado del gate real

Referencias:

- `apps/api/src/modules/simulation/eval.service.ts:584`: `runGateV2` devuelve `scenarios: out`.
- `apps/api/src/modules/simulation/certification-runner.ts:89`: el consumidor busca `gate.results`.
- `apps/api/src/modules/simulation/certification-runner.ts:97`: lee `gate.costUsdCents`, campo que el gate no entrega.
- `apps/api/src/modules/simulation/certification-ledger.ts:510`: un resultado sin error pero sin `passed` se guarda como `failed`.
- `apps/api/src/modules/simulation/certification-ledger.ts:517`: al guardar libera lease y reserva.

**Reproducido:** una respuesta sintética con la forma del productor real, un escenario `passed: true` y modelo `gpt-4o-mini`, pasada por el runner real de `src`, produce:

```json
{"passed":false,"servedModel":"","costUsdCents":0,"verification":null,"transcript":[],"errorCode":null}
```

La función real de liquidación, con query capturada en memoria, intenta registrar `state: failed`, modelo vacío y costo cero. **Falla cerrado para la certificación, pero no para el gasto:** el proveedor ya puede haber trabajado, la reserva se libera sin contabilizar ese gasto y el siguiente caso vuelve a tener presupuesto disponible. Después de agotar casos, si no intervinieron deadline u otra condición, `leaseCertificationCase` devuelve `awaiting_retry_decision` porque no hay casos probados (`certification-ledger.ts:462–467`); no debería certificar un perfil ni marcar `complete`.

Cerrar exige contrato tipado compartido productor/consumidor, prueba del adaptador contra la salida efectiva del gate y contabilidad explícita. **Ausencia de costo no debe convertirse en cero confirmado.** El arreglo no debe limitarse a cambiar `results` por `scenarios`: seguirían abiertos costo, modelo y límites descritos abajo.

## P1 — El mismo desacople contamina el benchmark y puede producir `comparable: true`

`apps/api/src/modules/simulation/benchmark.service.ts:295–300` también lee `gate.results` y el costo inexistente. Con el mismo gate exitoso, su método real `parallelyRunner` produce:

```json
{"confirmed":false,"costUsdCents":0,"transcript":[],"error":null}
```

La ausencia de lectura se transforma en fracaso medido, no en resultado desconocido. El resumen sólo bloquea `confirmed: null`, entre otras condiciones (`agent-benchmark.ts:183`); no bloquea este `false` fabricado. **Reproducido con corpus y sujetos sintéticos:** un caso para Parallly y uno para una alternativa, ambos bajo el mismo hash y etiquetas distintas, arrojan `comparable: true`, sin blockers, Parallly con un fracaso y costo cero. No es una comparación real: demuestra que este defecto puede convertirse en evidencia comparativa aparentemente válida.

Además, el adaptador construye el escenario con `expectedActions: []` (`benchmark.service.ts:293`), aunque la tarea posee `confirms`. Incluso corregida la lectura, no debe identificarse `passed` del juez con la comprobación de efecto que promete el comentario. Hay que transportar/aplicar los verificadores de la tarea y preservar “no comprobado” como estado distinto de éxito o fracaso.

## P1 — US$0,76 y 408 llamadas no constituyen un techo validado del recorrido ejecutable

El planificador puro reproduce **204 casos, 408 llamadas y 76 centavos**. Eso confirma su aritmética, no la correspondencia con todas las invocaciones del runtime:

- `certification-plan.ts:162–168` calcula `turns × k` con un límite declarado de tokens.
- `eval.service.ts:694–697` realiza adicionalmente una evaluación con `judgeTranscript` por escenario/intento terminado.
- `quality/quality.service.ts:293–306` pide ese juicio a `gpt-4o-mini`, con hasta 500 tokens de salida; no devuelve su uso ni costo al gate.
- `certification-runner.ts:82–87` no pasa `beforeModelUnits`, `assertExecutionAuthority`, un límite de tokens ni el modelo de `lease.model` al gate.
- `certification.service.ts:240–246` tampoco inyecta esa información en el runner.

Si los 204 casos completaran sus 408 turnos previstos y cada uno llegara al juez, habría **al menos 612 invocaciones** al sumar esos 204 juicios, antes de posibles invocaciones adicionales por herramientas o reintentos. Si hay fallos previos o filtrado, no todos llegarán a esa fase. **No se presenta una cuantía corregida**: faltan el uso real, límites efectivamente aplicados y modelos utilizados. Tampoco está demostrado que el agente sujeto use el modelo que se eligió para cotizar el plan.

Hay otra diferencia contable comprobable: el plan redondea por celda, mientras `certification-ledger.ts:343–345` redondea por caso. En este canario la suma de reservas de casos es **208 centavos**, frente a los 76 del plan. No significa que se gasten US$2,08 ni que ése sea el presupuesto correcto: reservas no simultáneas se liberan al liquidar. Sí invalida describir ambas cantidades como idénticas y exige una política coherente de precisión/estimación, especialmente para fracciones de centavo.

El canario puede validar la conexión y parte de la medición. **Medir un perfil no confirma el costo de toda la matriz**, contrario a `certification-canary.md:70–71`. Hasta reparar la integración, no autorizarlo basándose en el supuesto techo de US$0,76.

## Riesgo adicional de reserva en reintentos: revisión estática, pendiente de prueba PostgreSQL

`certification-ledger.ts:536–557` crea el intento nuevo sin copiar `reserve_usd_cents`; la columna tiene `DEFAULT 0` en la definición canónica (`:147`). El primer intento se dimensiona, el reintento no. El selector de leases compara esa reserva con el remanente (`:434`).

Esta lectura señala una vía para arrendar reintentos sin reservar su costo, aun después de arreglar los adaptadores. No se ejecutó contra PostgreSQL en esta revisión. Claude debe reproducirla con el DDL actual, exigir que cada intento nuevo conserve/recalcule una reserva válida y probarla con dos trabajadores y presupuesto marginal. No es un gate que requiera un proveedor real.

## Qué acredita realmente `31395c64`

`apps/api/src/modules/persona/agent-publication-walk.postgres.spec.ts` declara 13 pruebas. Usa tablas PostgreSQL y servicios/controladores reales; ejecuta `RolesGuard` y `TenantGuard` manualmente antes de las llamadas. Recorre borrador, revisión, publicación con CAS y recibo, selección por conexión, configuración dentro del prompt siguiente, y rollback con una versión nueva. Examina permisos, aislamiento, replays y datos/evidencia obsoletos.

Sus límites están declarados en la cabecera: modelo y evaluación son sintéticos, varios colaboradores del turno son dobles y no se monta una petición HTTP autenticada. El supuesto modelo devuelve `Listo.` y las aserciones de `:536–559` comprueban el prompt. **Acredita qué configuración llega al modelo, no que un modelo real la obedezca ni que un cliente reciba la respuesta.**

`apps/e2e/tests/dashboard/agent-publication.spec.ts` añade nueve pruebas por viewport sobre confirmación, valores enviados, conflicto y rollback. Intercepta HTTP con respuestas declaradas (`:114–139`); no conecta el navegador a la API real. Son capas complementarias valiosas; no una única corrida navegador→HTTP real→modelo→canal. No se repitieron aquí las pruebas PostgreSQL/Playwright ni las mutaciones que Claude reportó.

El rollback de configuración vuelve al `before_body` con versión nueva, CAS, propiedad de ruteo y prerrequisitos actuales (`agent-publication-store.ts:98–116`). Puede ser rechazado si la base divergió o faltan prerrequisitos; no revierte mensajes enviados, escrituras comerciales ni migraciones. La certificación global **0/76** y la revisión de un candidato son autoridades distintas: no debe suponerse que ese contador por sí solo impide publicar una configuración.

## Verificaciones ejecutadas en esta revisión

Desde la raíz del repositorio:

```powershell
node docs/audits/2026-09-09/verify-artifacts.cjs
node apps/api/scripts/plan-certification-canary.cjs
node docs/audits/2026-09-10/reproduce-certification-runner-contract.cjs
```

Resultados:

- Los tres verificadores de artefactos pasaron; comparan contenido y permiten que la etiqueta del generador sea un commit anterior.
- El canario reprodujo el hash `62bc39a4ab1939fd6a12981b8bbb8af8ed9c2e128e1d9146c5490c32580186f8`, 204 casos/408 llamadas/76 centavos. **Sólo planificación**.
- El reproductor ejecutó funciones de `src`, con gate y query sintéticos y red bloqueada; confirmó los resultados de arriba. No modifica artefactos existentes ni ejecuta `runGateV2`, proveedores o SQL. Devuelve código cero si pudo completar la reproducción; ese cero **no declara que el defecto esté arreglado**.
- Dos suites ligeras de contratos: **18/18 pruebas**, staging workflow y ubicación/fallo cerrado del preflight de términos.

Comando de los contratos desde `apps/api` (omite deliberadamente setup de DB y typecheck, conserva las aserciones):

```powershell
node -e 'const c=require("./jest.config.js"); c.rootDir=process.cwd(); delete c.globalSetup; delete c.testSequencer; c.setupFiles=[]; c.globals={"ts-jest":{isolatedModules:true,diagnostics:false}}; require("jest").runCLI({config:JSON.stringify(c),runInBand:true,cache:false,runTestsByPath:true,_:["src/common/utils/staging-workflow.spec.ts","src/modules/tenant-payments/agreed-terms-preflight-workflow.spec.ts"]},[process.cwd()]).then(r=>process.exit(r.results.success?0:1));'
```

El primer intento con el typecheck de ts-jest agotó el heap predeterminado de 4 GB antes de producir aserciones. La repetición anterior fue sólo ejecución de contratos; no sustituye un typecheck del repo. No se abrieron ni recrearon bases.

## Coherencia del cierre y pendientes

El reporte derivado sigue indicando **7 aceptadas, 18 bloqueadas, 0 abiertas, `finished: false`, 0/76 perfiles y 0 canales certificados**. Esa tabla es consistente con sus propios contadores, pero parte de su procedencia es declarada y sus chequeos de cableado no verifican este contrato de datos. Que el generador pase no invalida los defectos reproducidos aquí.

El informe manual separa correctamente staging preparado, canario sin ejecutar y producción sin activar. El código productivo de HEAD es el mismo que `d2c2d07b` según el diff; después hay documentación y un generador de escenarios de investigación. Las 610 suites/6.655 pruebas y corridas remotas son evidencia reportada por Claude, no recertificada en esta revisión.

Las afirmaciones de `release-closure-report.md:329–330` —ningún defecto local pendiente y sólo gates externos— deben actualizarse tras aceptar estos hallazgos. Mantener abiertas las cuentas de canal, participantes, alternativas, credenciales/presupuesto de modelo, host/secretos de staging y autorizaciones necesarias. **Antes** del canario: corregir contratos, costos/modelos y reservas; ensayar el recorrido live con proveedores sintéticos; recalcular plan y reporte; después ejecutar un piloto autorizado. Los nuevos frentes Meta, landing y gasto WhatsApp siguen siendo planes añadidos, no se cierran con la tabla histórica A1–H3.
