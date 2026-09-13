# Revisión independiente del cierre de Claude y preparación de octubre

Fecha: 10 de septiembre de 2026. Revisión focalizada de código, herramientas de ensayo, contratos y evidencia; no es una nueva ejecución de toda la regresión ni una auditoría exhaustiva de cada archivo del PR.

## Dictamen

**Se puede avanzar en paralelo con la adaptación Meta. El candidato actual todavía no está listo para desplegarse.** Hay defectos locales reproducibles en staging y en el ejecutor que debería validar modelos. No corresponde atribuir todo lo pendiente a host, credenciales o autorizaciones externas.

El trabajo anterior aporta persistencia y recuperación de turnos/efectos, términos aceptados, publicación/rollback, evaluación y controles de despliegue. Es trabajo que se debe conservar. La nueva adaptación de WhatsApp y la nueva oferta comercial siguen en documentos de investigación y ejecución; no quedaron implementadas por los commits del cierre de Claude.

**Decisión del usuario durante esta revisión:** usar el VPS y entorno existentes, donde algunos tenants ya prueban la plataforma. El plan se ajustó a ese destino, sin exigir otro host. Se requiere un despliegue operativo gradual por tenant y pruebas previas de migraciones/restore; no ejecutar seed/reset sintético sobre esos datos. Los defectos de staging conservan su evidencia, pero no deben convertirse en una obligación de contratar otro servidor ni confundirse con el camino de producción.

**Aclaración final del usuario:** priorizar el cambio completo de la plataforma, sin dedicar más trabajo a sostener lo anterior; admite migraciones puntuales/manuales. La directiva final prevé una única versión y corte con mantenimiento si hace falta. Ya no exige compatibilidad del binario antiguo con el esquema nuevo ni convivencia de runtimes. Conserva datos/consentimientos/efectos y un procedimiento de recuperación adecuado a la migración. Las recomendaciones históricas de compatibilidad deben leerse subordinadas a esta decisión.

## Estado comprobado

| Elemento | Evidencia y alcance |
|---|---|
| Base local | `7c9eb04b`, rama `claude/agent-platform-finalization-20260909`. Frente a la referencia local `origin/main`: 311 commits y 1.039 archivos modificados, +160.553/−8.759 líneas. No se ejecutó fetch para actualizar esa referencia. |
| PR remoto | [PR #21](https://github.com/Nipko/sales-structure/pull/21), abierto y draft. HEAD remoto `8940320d`, distinto del local por la última adenda documental. GitHub informa MERGEABLE/CLEAN; eso no constituye aprobación funcional de despliegue. |
| Checks del PR | Consultados mediante GitHub CLI. `PR contract and unit evidence` pasó; `Chromium smoke` terminó success el 10-sep a las 17:30 UTC. Los jobs de integración y release no corrieron en ese evento PR. GitGuardian neutral. |
| Integración que citó Claude | [Run 34505286042](https://github.com/Nipko/sales-structure/actions/runs/34505286042), `workflow_dispatch`, HEAD `2aa48cc8`: integración y contratos success; weekly release skipped. Confirma lo que Claude afirmó, en ese SHA y con el alcance de ese workflow. |
| Regresión local grande | Las 610 suites/6.655 pruebas y demás puertas constan en el informe de Claude, con corridas ligadas a SHAs. Esta revisión no repitió esa batería ni presenta esos conteos como una ejecución propia. |
| Artefactos | El verificador de artefactos pasó durante la revisión. Verifica correspondencia con sus generadores; no detecta por sí solo los defectos de adaptación entre servicios descritos abajo. |
| Publicación y rollback | Hay recorrido PostgreSQL/controladores/servicios/prompt y pruebas de UI complementarias. La parte navegador intercepta API; la parte de servidor usa evaluación/modelo sintéticos. No es prueba continua de navegador→HTTP real→modelo real→proveedor. |
| Canario | El planificador reproduce 204 casos/408 llamadas y US$0,76. El contrato del ejecutor y las llamadas adicionales impiden considerar esa cifra un techo económico validado. |
| Staging y proveedores | No se verificó despliegue sobre host ni cuenta real de canal. Certificación declarada: 0/76 perfiles. Los hallazgos locales deben cerrarse antes de gastar para probar esos gates. |

Los cuatro cambios ajenos presentes al iniciar se conservaron: `CLAUDE.md`, `docs/plan-profitability-2026-07.md`, `.validate-index.cjs` y `docs/whatsapp-meta-pricing-2026-10.md`.

## Bloqueos hallados

Las dos auditorías enlazadas contienen rutas, líneas, reproducciones y criterios de reparación. Los siguientes grupos resumen el impacto; no son un conteo de vulnerabilidades independientes.

### 1. Staging valida valores que no son los que ejecutaría

El workflow usa `docker-compose.prod.yml`, que fija `parallext_engine` en PostgreSQL y en las URLs de API/worker/WhatsApp. El workflow escribe `parallext_staging` en `.env`, pero las claves explícitas de Compose prevalecen. Los scripts de staging rechazan el destino efectivo. Además, las imágenes de dashboard existentes incorporan URLs productivas durante el build; cambiar variables al arrancar no transforma ese bundle en uno de staging.

Hay que validar configuración resuelta, destinos efectivos y tráfico del navegador. Un host distinto por sí solo no resuelve esta diferencia.

Las rutas de salud también divergen: el workflow consulta `/health`, mientras la API expone `/api/v1/health`. La auditoría amplía la revisión a rutas de widget/webhook y al token sintético faltante.

### 2. El aislamiento puede omitirse

`assessStagingIsolation` devuelve `ok:true` con las variables sintéticas válidas y `productionDigests: []`: no comparó ningún secreto. El job rollback tiene `always()` y permite la acción manual aunque el guard haya fallado; la dependencia indirecta no equivale a exigir `needs.guard.result == 'success'`.

Se necesita cobertura explícita del inventario y del camino completo de ejecución, incluida la rama de rollback.

### 3. El ensayo pierde los artefactos y no activa el despacho que pretende probar

El seed escribe `/tmp/seed.json` en un contenedor efímero `run --rm`; el workflow intenta leerlo con `exec api` en otro contenedor. Lo mismo sucede con otros artefactos. El piloto configura `web_widget`, pero los canales soportados por `DispatchRolloutService` son WhatsApp, Messenger, Instagram y Telegram. La configuración produce cero canales efectivos; comprobar que se guardó el JSON no prueba entrega.

### 4. Falta construir el candidato sin pasar primero por main

Staging sólo descarga imágenes. El camino de build/push existente depende de jobs restringidos a `main`, cuyo workflow también despliega producción. No hay una construcción de candidato de PR para staging en ese camino. Tampoco se sincroniza explícitamente el código/Compose del host con el SHA de `image_tag`.

Construcción, configuración, prueba y evidencia deben identificar el mismo candidato. **No fusionar para obtener las imágenes con las que se pretendía ensayar antes de fusionar.**

Detalles y reproducción: [auditoría de staging](codex-staging-review.md), [script sintético](reproduce-staging-contract.cjs).

### 5. La certificación no consume el contrato real de evaluación

El runner busca `gate.results`; `EvalService.runGateV2` devuelve `gate.scenarios`. Ante una evaluación compatible con el retorno real, con `passed:true` y modelo informado, la reproducción obtiene `passed:false`, `servedModel:''`, `verification:null` y `costUsdCents:0`. El gate no publica el costo en la propiedad que el runner intenta leer.

Eso invalida el camino de certificación y puede perder contabilidad del gasto. No es una certificación falsa positiva: en la reproducción falla; tampoco constituye una protección de gasto suficiente porque el trabajo ya se ejecutó.

El adaptador de benchmark tiene el mismo defecto y puede convertir el fallo de lectura en fracaso confirmado/costo cero dentro de un resumen marcado comparable. La reproducción usa sujetos sintéticos y no representa un resultado competitivo real. Debe corregirse antes de usarlo como evidencia.

### 6. Plan de costo y ejecución divergen

El runtime llama a un juez adicional por escenario; las 408 llamadas anunciadas sólo cuentan turnos. Para 204 escenarios con k=1, hay al menos 204 invocaciones adicionales al juez, antes de considerar loops u otros costos. La reserva por caso también usa redondeos que no coinciden con el techo agregado del plan. No se midió un nuevo precio real ni se autoriza gasto por estas cuentas.

El runner debe unir autoridad, modelo, presupuesto, uso y resultado reales, y el canario debe volver a presupuestarse. Medir un solo perfil no demuestra el costo ni la calidad de la matriz completa.

Detalles y reproducción: [auditoría del runner](codex-certification-runner-review.md), [script sintético](reproduce-certification-runner-contract.cjs).

También se identificaron condiciones **pendientes de reproducción PostgreSQL**: reintentos que no copian su reserva; preflight que puede omitir acuerdos NULL/incompletos; y primera instalación vacía que consulta `public.tenants` antes de crearla. Se debe ensayar además la ventana de escrituras de la versión anterior entre preflight y migración. Son trabajo local comprobable, no requisitos de credenciales de proveedor.

## Lo nuevo aún pendiente

La auditoría del código sigue encontrando selección alternativa de número en `channel-token.service.ts` y separación de captions/enlaces en `dispatch-items.ts`. La búsqueda de campos BSUID/financiación y del error 131042 no encontró su implementación en los runtimes inspeccionados. La ausencia de cadenas es indicio, no prueba exhaustiva; los frentes deben demostrar cada comportamiento con el recorrido real.

Siguen pendientes cuenta/pagador exactos, financiación guiada, tarifas de octubre, autorización monetaria común de todos los emisores WhatsApp, recuperación ante pagos, pausas sin nuevos avisos cobrables y la actualización de onboarding/Assist/landing/planes. Los créditos IA actuales no equivalen a autorización del gasto Meta.

## Camino a la entrega

El [plan integrado para Claude](../../handoffs/2026-09-10/claude-october-release-parallel-execution.md) dispone F0 de correcciones y cuatro frentes con propietarios: cuenta/identidad; tarifas y envíos; conversación/productores; experiencia/integración. Contratos, migraciones, registro de módulos y archivos globales tienen un único integrador.

Propuesta: implementar e integrar del 10 al 23 de septiembre; candidato y ensayo del despliegue del 24 al 26; piloto en el VPS existente y correcciones del 27 al 29; reservar el 30 para recuperación y financiación. Es una planificación condicionada a capacidad, acceso operativo, cuentas y presupuesto, no una promesa de haber terminado todo el programa el 1 de octubre.

El objetivo confirmado es una versión conjunta, desarrollada mediante tandas, migrada en el VPS actual y comprobada inicialmente con sus tenants de prueba. No mantener un runtime viejo para otros tenants. La protección WhatsApp no puede quedar opcional en una ruta de envío. Certificación universal, benchmark y funciones sin evidencia permanecen abiertas o restringidas; no se anuncian como terminadas para justificar el lanzamiento.

Los contenedores/migraciones siguen siendo compartidos por los tenants del VPS; la lista de piloto no aísla esos efectos. Además, Meta aplicará las tarifas correspondientes aunque un tenant no participe del piloto. Todas las cuentas que sigan enviando al llegar octubre necesitan preparación de financiación y gasto; las pendientes requieren una resolución explícita.

Esta revisión entrega diagnóstico, reproducciones y directiva. No modifica el runtime, no ejecuta proveedores, no crea infraestructura, no hace push ni despliega. Claude debe aplicar y probar las correcciones, integrar los cambios nuevos y devolver un candidato concreto para aprobación.
