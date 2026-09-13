# E2 — Contexto capturado en el núcleo de evaluación

Fecha: 2026-09-07. Base del checkout: `b6db0507`, con cambios locales posteriores conservados. Esta tanda conecta lectores de contexto a Agent Test y a la entrada común que usan Eval, Simulation y LearningEvaluation. No cambia la autorización de publicación ni certifica perfiles o proveedores.

## Comportamiento implementado

`AgentTestService.captureSnapshot` captura `contextInputs` después de la firma inicial de dependencias y antes de sellar y comprobar nuevamente el manifiesto. El hash `frozen.turn_context` vincula esos datos a la revisión privada. El núcleo valida alcance, versión, campos obligatorios e integridad, y usa una copia por turno.

| Entrada | Captura y consumo |
|---|---|
| Horarios del tenant | Proyección de `settings.businessHours`, con ausencia explícita; conserva la precedencia sobre horarios del agente. No vuelve a consultar tenant ni Redis durante el turno de evaluación. |
| Región | `RegionalProfileService.captureForEvaluation` usa la composición regional canónica sin caché; tenant ausente o consulta fallida detienen la captura. Un país no declarado conserva su procedencia de fallback. |
| Identidad comercial | `BusinessInfoService.captureForEvaluation` consulta empresas sin DDL ni Redis. Sólo un error de columna ausente permite la proyección legacy. Una tabla inexistente o fallo de lectura no se convierte en identidad vacía. Se conservan únicamente los campos usados por el prompt. |
| Plantilla y objetivos | `VerticalTurnContextService` compone es/en/pt/fr a partir de la configuración, objetivos, audiencias y contratos existentes. `VerticalsService` omite también las lecturas Redis en modo readonly. El núcleo consume la variante capturada del idioma del turno y omite sus lectores legacy. |
| Política de exposición | Captura separada de industria/subtipo tal como los lee `ActiveOperationsContextService`. La plantilla puede normalizar un alias; esa normalización no modifica la política de exposición histórica. Los dominios desconocidos siguen siendo sensibles. La configuración explícita del agente mantiene precedencia. |

El resolver de capacidades recibe país y jurisdicción desde el núcleo. Cuando ambos están presentes, no vuelve a resolver región; conserva la resolución canónica si falta un dato. Plan, permisos, readiness, dominio propietario y otros lectores de capacidades mantienen sus comprobaciones actuales.

Los snapshots anteriores que no incluyen el contexto completo se rechazan con `agent_snapshot_context_inputs_required`; requieren una captura y evaluación nuevas. No se rellenan silenciosamente con datos actuales. Las capturas no se aceptan desde el DTO público ni conceden autoridad operativa.

## Evidencia ejecutada

Resultado final de la batería conjunta: **20 suites / 314 pruebas pasan**. TypeScript API pasa. `git diff --check` pasa. Los conteos anteriores de 250 y 80 se solapan y quedan sustituidos por esta ejecución conjunta después del ajuste de política de exposición.

Las pruebas nuevas incluyen 19 casos del núcleo y siete con PostgreSQL/Prisma reales. Estos últimos usan sólo la base desechable local `parallly_eval_isolation`; crean tenant/esquema propios, comprueban su alcance y los eliminan al terminar. Los lectores de identidad, región, plantilla y la guarda del manifiesto son reales; el modelo, algunas dependencias de capacidades y otros bordes del fixture siguen simulados.

- El núcleo usa la captura en los cuatro idiomas aunque sus antiguos lectores fallen si se los invoca. El comparativo comprueba horarios, identidad, región y objetivos.
- Campos ausentes, idioma faltante, contexto alterado y región de otro tenant se rechazan antes del modelo. El debug devuelto no puede modificar el contexto del turno siguiente.
- Identidad vacía sigue vacía; agregar la primera empresa invalida la revisión con la guarda global real.
- Una edición de tenant/empresa después de capturar, o una edición durante la captura, impide usar la revisión anterior.
- El lector legacy funciona con una columna comercial ausente sin reparar el esquema. Tabla inexistente y caché vertical obsoleta no se usan como evidencia válida.
- País/jurisdicción proporcionados evitan el lector regional redundante; la ausencia de jurisdicción mantiene el fallback canónico.
- El fallback de exposición, incluido un dominio legacy, coincide con el lector vivo. No amplía la visibilidad de citas al normalizar la plantilla del prompt.
- La regresión incluye Agent Test, snapshot, paridad del núcleo, cero escrituras, manifiesto PostgreSQL, piloto de captura de servicios, comandos canónicos aislados, candidatos de release, fidelidad de Simulation, aprendizaje y bootstrap de Nest.

Comando de la batería, con `PARALLLY_ISOLATION_TEST_URL` y `AGENT_RELEASE_TEST_DATABASE_URL` configuradas exclusivamente para la instancia sintética local:

```powershell
node node_modules/jest/bin/jest.js --config apps/api/jest.config.js --runInBand --testPathPattern='evaluation-turn-context|agent-test.service.spec|agent-test-live-parity|agent-test-zero-write|agent-evaluation-snapshot|vertical-turn-context|regional-profile.service|verticals.service.spec|evaluation-reader-inventory|evaluation-revision.postgres|evaluation-service-catalog-capture.postgres|agent-release.postgres|isolated-canonical-commands|app.bootstrap.spec|simulation-fidelity|learning-evaluation.spec|effective-capability.spec|active-operations-context.service.spec|turn-capability-composer.spec' --globals '{"ts-jest":{"isolatedModules":true,"diagnostics":false}}' --silent
node node_modules/typescript/bin/tsc --project apps/api/tsconfig.json --noEmit --incremental false
git -c core.safecrlf=false diff --check
```

## Límites y continuación

1. **Se conserva todo el manifiesto global.** No se excluyen mensajes, contactos, conversaciones, catálogo ni conocimiento. El tráfico del tenant todavía puede invalidar una evaluación larga.
2. Los lectores canónicos se ejecutan entre las comprobaciones inicial y final del manifiesto. Esta tanda no los reúne en una única transacción MVCC ni demuestra atomicidad de toda la captura. Las pruebas comprueban detección de cambios mediante las firmas existentes.
3. El capturador de `list_services` sigue siendo candidato independiente, sin integración con el núcleo. Faltan réplica comercial, RAG/FAQ/policies y el resto de los lectores transitivos; el inventario TypeScript versión 2 identifica las fronteras actuales.
4. Hora, pesos externos, credenciales/modelos de embeddings, algunos datos de capacidad y estado de proveedores no están congelados integralmente. La revocación, privacidad, cuotas, permisos y ownership deben seguir verificándose en vivo.
5. La captura reutiliza los contratos lingüísticos actuales: no traduce las instrucciones expertas pendientes ni convierte sus marcadores de revisión en cobertura certificada. Tampoco demuestra comprensión semántica o cumplimiento de misión por un LLM real.
6. Publicación HTTP, piloto, rollback integral, revisión visual/accesibilidad, usuarios nuevos y proveedores externos continúan pendientes según el plan general.

La siguiente integración debe cubrir datos comerciales y conocimiento, mantener las guardas vivas y probar cada lector antes de reducir las firmas globales. La publicación debe conservar la diferencia entre una evaluación histórica y condiciones actuales de ejecución.

No se hicieron migraciones sobre tenants existentes, push ni despliegue. Esta tanda permanece local: el revisor automático rechazó previamente el commit por límite de uso y no se volvió a intentar ni se eludió el bloqueo. Los 11 archivos preparados anteriormente en el índice se conservaron.
