# Las suites rojas, clasificadas y cerradas

8 de septiembre de 2026. Cierre de la [condición 9 de la directiva](../../handoffs/2026-09-08/claude-complete-plan-directive.md): ninguna suite roja se acepta como "baseline". Las 16 suites rojas registradas en `ec430c54` se clasificaron una por una y se corrigieron. Sin push, sin despliegue, sin llamadas a proveedores reales.

## Lo primero fue contar bien

El recuento de partida decía "16 suites rojas" y una lista de trabajo previa había apuntado, además, ocho suites PostgreSQL como si también fallaran. No fallaban: estaban **omitidas** por falta de variable de entorno, que es un estado distinto y se lee distinto en el JSON de Jest (`numPendingTestSuites`, no `numFailedTestSuites`). Confundirlas habría inflado el problema y, peor, habría dejado creer que ocho suites de base de datos estaban ejercitándose cuando ninguna corría.

El rojo real eran **16 suites / 20 pruebas**. Las ocho omitidas se levantaron aparte, con instancias desechables, y se cuentan en la corrida final.

## Las 16, por qué fallaban

Ninguna resultó ser un defecto del producto. Todas eran pruebas que habían quedado atrás respecto del código que vigilan, en cuatro formas distintas — y la distinción importa, porque tres de ellas escondían además un agujero de cobertura real.

### Aserciones sobre el texto del fuente que se quedaron con la línea vieja

`payment-link-delivery`, `deferred-after-execution`, `prompt-assembler.recent-actions`, `payment-hold` (commit `871637c6`).

Cada una afirmaba una línea literal. El comportamiento seguía intacto en las cuatro; lo que cambió fue la forma de escribirlo: la cabecera del bucle de enlaces ganó guardas, `isBackingTool` ganó un argumento, el ensamblado del prompt pasó a ocurrir en tres puntos, y el listener del pago dejó de escribir SQL de ocupación para delegar en el único gate que lo arma.

Los cuatro casos pasaron a afirmar el invariante:

- que lo recorrido sea un `Set` de los enlaces, no el texto de la línea;
- que la señal siga saliendo de `isBackingTool` sobre las tools ejecutadas;
- que **ningún** punto de ensamblado preceda al llenado del turno, en lugar de exigir que haya uno solo — más fuerte que antes, porque antes sólo miraba el primero;
- que un archivo o arme el predicado de retención o delegue en el gate que lo arma, con una comprobación aparte de que el delegado sigue siendo consciente de la retención, para que la indirección no pueda esconder una regresión.

El del prompt merece una nota: exigía un solo ensamblado **a propósito**, como alambre trampa, para forzar una revisión si aparecía otro. Aparecieron dos. Se revisaron los tres y los tres releen el mismo `turnContext` después de la asignación, así que el invariante se sostiene.

### Dobles de prueba a los que les faltaba una pieza que el runtime ya usa

`capability-stop-profiles`, `tool-authority.e2e` (commit `83080581`).

`ProcedureEngineService` pasó a guardar su estado en PostgreSQL además de Redis, así que `getState` llega a `persistConversationRuntimeState` y necesita `transactionInTenantSchema`. Cinco specs hermanas ya habían adoptado el fixture canónico `runtimeStateTransactions`; estas dos conservaban un doble con sólo `executeInTenantSchema` y morían con un `TypeError` antes de llegar a su aserción.

### Turnos que no traían lo que trae un turno real

`ai-tool-executor.central-controls`, `read-semantics` (commit `c59f3d1b`); `pharmacy-prescription`, `isolated-canonical-commands` (commit `ee4ae4bb`).

Estas cuatro paraban en una puerta anterior a la que venían a probar:

| Suite | Puerta que las frenaba | Qué le faltaba al turno |
| --- | --- | --- |
| `ai-tool-executor.central-controls` (×2) | `agent_operational_authority_required` | La procedencia privada de la revisión servida, que `create_payment_link` exige por ser tool con versión guardada |
| `pharmacy-prescription` | igual, sobre `place_catalog_order` | igual |
| `read-semantics` | `evaluation_knowledge_replica_required` | La réplica sellada que congela lo que una evaluación va a leer |
| `isolated-canonical-commands` | `approval_tenant_unavailable`, después `approval_agent_unavailable` | Que la fila global del tenant y el doble de Prisma coincidieran con el namespace arrendado, y un agente que sirviera la conexión de la conversación |

En los cuatro casos la puerta es correcta y está probada en otro lado (`payment-agent-executor.spec.ts` cubre la de autoridad operativa). Lo que estaba mal era medir el rechazo por fórmula, o la denegación de identidad, contra un turno que de todas formas iba a ser rechazado antes por otra razón.

### Formas fijadas que ganaron un campo que sí carga peso

`persona-resolution` (×3), `evaluation-revision.service` (commit `d8a6c850`).

`readServingPersona` devuelve ahora la huella operativa de la revisión servida —y la del renglón legacy cuando cae ahí—, que es lo que `assertServedAgentConnectionAuthority` compara para rechazar un efecto decidido bajo una configuración que ya cambió. Las aserciones la llevan, **calculada** con `operationalConfigurationHash`/`revisionHash` sobre el renglón servido: un digest transcrito sólo se pudre.

`learning_releases.evaluation_namespaces` guarda los leases de namespace aislado que una evaluación toma y devuelve, así que pertenece al conjunto ignorado junto a `evaluation`: contarlo dejaría que cada corrida se invalidara sola al anotarse.

### Barridos que se probaban a sí mismos

`agent-test-safe-tools` (commit `cdd71c1f`), `native-backlog` y `tool-origin-taxonomy` (commit `6313a610`), `eval-pack-language` (commit `7b1a4b73`).

Estos cuatro son los que además escondían un agujero.

**El barrido de tools seguras** moría con un `TypeError: Cannot read properties of undefined (reading 'catch')` que no nombraba ni la tool ni la causa. Detrás había dos cosas: el doble del ledger devolvía `undefined` desde `fail()` y el manejador de errores del ejecutor encadena `.catch` sobre él, así que la primera tool que fallara reventaba *dentro* del manejador y reemplazaba el fallo original. Y la tool que fallaba era `list_my_catalog_orders`, porque `ordersService` nunca se pasó: ocho de las sesenta y dos tools anunciadas (catálogo, taller, alquileres) devolvían su guarda de "servicio no cableado" y el barrido no probaba nada de sus caminos de lectura. Ahora están cableadas con dobles de sólo lectura cuyos escritores son trampas, y el barrido afirma que cada lectura fue efectivamente alcanzada.

**La taxonomía de procedencia** encendía la lista vertical y la core por separado, así que una tool que exige una de cada una no aparecía en ninguna. `schedule_test_drive` es la primera: desde que la prueba de manejo se consolidó en la agenda canónica (`1e93a2df`) pide `vehicles` **y** `appointments`. Su propia prueba de cobertura lo detectó —para eso estaba escrita— pero las dos comprobaciones de arriba llevaban desde entonces saltándosela en silencio. Ahora preguntan lo que de verdad define la procedencia: si la tool desaparece al apagar las verticales.

El mismo cambio explica `native-backlog`: `automotriz/alquiler` es el perfil que **quita** `appointments` —una rentadora no agenda pruebas de manejo, las agenda el concesionario— así que le quedan legítimamente dos escrituras de negocio, no tres.

**El barrido de idioma** marcaba 38 escenarios portugueses de cuatro perfiles de mascotas. Los 38 eran falsos: las únicas fichas que coincidían eran `consulta` y `diagnóstico`, portugués corriente escrito igual que en español, dentro de prosa bien traducida ("Não inventa peso, raça, vacinas, diagnóstico ou tratamento"). Una palabra suelta no distingue un lexema compartido de prosa sin traducir en un idioma que comparte casi todo el vocabulario del español. Una frase entera del contrato sí, y esa es la forma que tenía el defecto original: escenarios completos en español dentro de los cuatro paquetes. Se verificó inyectando exactamente eso —metiendo el criterio español en el paquete PT— y el barrido acotado lo sigue atrapando.

## Entorno reproducible

Las ocho suites PostgreSQL omitidas ahora corren. Instancias locales desechables, ninguna URL productiva:

| Instancia | Puerto | Contenido |
| --- | --- | --- |
| PostgreSQL 17.11 + pgvector 0.8.6 | 55437 | `parallly_eval_isolation` |
| PostgreSQL 17.11 + pgvector 0.8.6 | 55439 | `parallly_knowledge_eval_isolation` |
| Valkey 8.1 (`noeviction`) | 55440 | — |

Variables (credenciales sintéticas, sólo loopback): `PARALLLY_ISOLATION_TEST_URL`, `AGENT_RELEASE_TEST_DATABASE_URL`, `AGENT_REVISION_TEST_DATABASE_URL`, `CATALOG_ORDERS_TEST_DATABASE_URL`, `REPAIR_ORDERS_TEST_DATABASE_URL`, `OPERATIONAL_NOTICE_REVIEW_TEST_DATABASE_URL` y `DATABASE_URL` a la primera; `KNOWLEDGE_MEMORY_TEST_DATABASE_URL`, `KNOWLEDGE_TEST_DATABASE_URL`, `LEARNING_EVIDENCE_TEST_DATABASE_URL` y `KNOWLEDGE_CONFLICT_TEST_DATABASE_URL` a la segunda; `DISPATCH_QUEUE_TEST_REDIS_URL` y `PARALLLY_SAMPLING_REDIS_URL` a Valkey; más `RUN_PIPELINE_OWNERSHIP_PG_TESTS=1`.

Cada suite comprueba por su cuenta que el host sea loopback y que el nombre de la base termine en `_eval_isolation`, y limpia los esquemas que crea. Esa comprobación es deliberada: impide que una corrida apunte a una instancia compartida o productiva.

**Una trampa del entorno, anotada porque cuesta una hora encontrarla.** Los contenedores corren dentro de WSL y la VM de WSL se apaga sola cuando ningún cliente `wsl.exe` está conectado, llevándose el demonio de Docker y los contenedores con él. Desde Windows eso se ve como un relay de localhost intermitente: la conexión funciona justo después de crear los contenedores y deja de funcionar un minuto más tarde. Se sostiene manteniendo una sesión WSL abierta mientras dura la validación. Es una particularidad de esta máquina, no del repositorio.
