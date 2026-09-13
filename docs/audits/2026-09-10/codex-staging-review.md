# Revisión independiente de staging y preflight de términos

Fecha: 2026-09-10. HEAD inspeccionado: `7c9eb04b9978c668e77abe89eaad2e6f0f9ae615`.
Cambios solicitados: `3b51ab5a` (staging), `a10bf87c` (preflight antes de migrar).

**Dictamen: staging aún tiene bloqueos corregibles en el repositorio. No basta con suministrar host y secretos.** No se ejecutó SSH, Docker, proveedor ni base real; esta revisión no certifica producción. Se reprodujeron siete contradicciones con código real y datos sintéticos, y se identificaron dos condiciones adicionales mediante lectura de SQL/workflow. La revisión del recorrido de publicación pertenece a otra revisión y no se duplica aquí.

## Evidencia ejecutable

Desde la raíz del repositorio, con las dependencias ya instaladas:

```powershell
node docs/audits/2026-09-10/reproduce-staging-contract.cjs
```

Resultado en el HEAD indicado:

```text
REPRODUCED S03_EMPTY_DIGESTS_ACCEPTED {"checked":16,"ok":true,"findings":[]}
REPRODUCED S02_COMPOSE_REJECTED_BY_OWN_STAGING_GATE {"effectiveDatabase":"parallext_engine","refusal":"staging_target_refused:production_database_name:parallext_engine"}
REPRODUCED S06_PILOT_HAS_NO_EFFECTIVE_CHANNEL {"enabledFor":false,"effectiveChannels":[],"ignoredChannels":["web_widget"]}
REPRODUCED S01_ROLLBACK_RUNS_AFTER_GUARD_FAILURE ... wouldRun:true
REPRODUCED S05_ARTIFACT_WRITTEN_IN_REMOVED_CONTAINER ... sharedTmp:false
REPRODUCED S04_HEALTH_PATH_MISMATCH {"actualHealth":"/health","expectedHealth":"/api/v1/health"}
REPRODUCED S07_PRODUCTION_DASHBOARD_WITH_NO_STAGING_BUILD ... noStagingBuild:true
STAGING_REVIEW_REPRODUCER reproduced=7 checks=7 releaseAcceptance=false
```

El script carga las funciones TypeScript por transpilación, sustituye Redis/gateway por objetos sintéticos y lee YAML. No lee credenciales del entorno, no conecta a red, no inicia procesos ni escribe datos. S01 evalúa la expresión booleana del workflow; S04/S05/S07 comprueban contratos de rutas, contenedores y builds, **no son ejecuciones reales de GitHub Actions/Docker/HTTP**. Exit 0 significa que se reprodujeron los defectos, no que el cambio sea aceptable. Tras corregirlos, reemplazar este diagnóstico por regresiones positivas y negativas.

También se ejecutaron las tres suites existentes `staging-isolation.spec.ts`, `staging-operations.spec.ts` y `staging-workflow.spec.ts`: **3/3 suites, 46/46 pruebas**. Configuración local acotada: `ts-jest` con `isolatedModules:true`, `diagnostics:false`, sin el setup global de bases, entorno del proceso hijo limitado a variables de sistema. El primer intento con el programa TypeScript completo agotó el heap (~4 GB, exit 134); no se presenta como typecheck aprobado. Que las 46 pruebas pasen no contradice los siete defectos: cubren las funciones aisladas o el texto del workflow, no sus conexiones reales.

## Hallazgos priorizados

### S01 — P1: rollback manual omite el resultado de aislamiento

**Fuentes:** `.github/workflows/staging.yml:413`, `:414`, `:421`, `:435`, `:450`.

El job depende de `deploy` y `verify`, pero tiene `always() && (inputs.action == 'rollback' || ...)`. Para `action=rollback`, aunque `guard` falle y los otros dos queden `skipped`, la expresión da verdadero. Por tanto alcanza SSH y recreación sin haber aprobado confirmación, formato de SHA o aislamiento. No se realizó esa conexión: se reprodujo la evaluación de su condición. La prueba existente `staging-workflow.spec.ts:65` acepta una dependencia indirecta de `deploy`; no modela que `always()` elimina ese supuesto.

**Cierre:** dependencia explícita del guard, éxito obligatorio antes de cualquier acceso al host, y revalidación del objetivo. Probar combinaciones `guard=failure/cancelled/skipped`, rollback manual, fallo previo a recreación y fallo posterior. Ninguna debe ejecutar comandos contra un host no validado. La recuperación automática puede requerir un guard de recuperación basado en el último despliegue autorizado, pero no omitir aislamiento.

### S02 — P1: se valida una configuración, pero Docker ejecuta otra

**Fuentes:** `.github/workflows/staging.yml:123`, `:124`, `:202`, `:231`, `:232`, `:248`; `infra/docker/docker-compose.prod.yml:57`, `:91`, `:92`, `:152`, `:195`, `:231`; `apps/api/src/common/utils/staging-operations.ts:63`.

Guard valida las dos URLs `STAGING_*DATABASE_URL`; no se pasan al deploy. Se construyen URLs a `parallext_staging` en `.env`, pero el compose de producción fija en `environment` las URLs de API/worker/WhatsApp a `parallext_engine`, y también fija ese nombre para PostgreSQL y PgBouncer. Los valores explícitos del servicio prevalecen sobre `env_file`. Aplicando la URL efectiva a `assertStagingTarget`, el seed/smoke/piloto se niega: `production_database_name:parallext_engine`. En una instalación nueva, el compose tampoco crea `parallext_staging`. La base local de nombre de producción no demuestra que se haya tocado la base productiva; demuestra que la configuración comprobada no es la ejecutada.

El túnel añade otra divergencia: staging escribe `TUNNEL_TOKEN` (`staging.yml:242`), pero el servicio utiliza configuración montada desde `/opt/cloudflared` y `run parallext` (`docker-compose.prod.yml:23`, `:25`). No consume esa variable. Falta comprobar el túnel realmente montado, no sólo un token que no utiliza.

**Cierre:** compose/override propio y efectivo, o parametrización común completa. Validar `docker compose config` sobre exactamente los archivos/variables que se ejecutarán, incluyendo DB, Redis, túnel, volúmenes y URLs. Los scripts de staging deben poder aceptar el destino resultante y rechazar el productivo. No relajar la negativa del seed para acomodar el compose equivocado.

### S03 — P1: la ausencia de digests se anuncia como aislamiento aprobado

**Fuentes:** `apps/api/src/common/utils/staging-isolation.ts:170`, `:174`, `:186`; `apps/api/scripts/assert-staging-isolation.cjs:48`, `:56`, `:75`, `:94`; `apps/api/scripts/print-production-secret-digests.cjs:32`, `:53`.

La comparación sólo ocurre si existen digests y salt. Cero digests, o una entrada inválida descartada por el parser, no genera ningún finding. Reproducción: los 16 campos válidos sintéticos y `productionDigests:[]` producen `ok:true`. El CLI puede imprimir que staging no comparte nada tras comparar cero secretos. Además el generador permite un conjunto parcial y sólo avisa por stderr de nombres ausentes; un único digest no prueba cobertura de claves JWT, DB y SSH.

**Cierre:** rechazar conjunto vacío/inválido, exigir sal válida e inventario verificable de las familias críticas que se compararon, sin revelar valores. Probar falta de digest/salt, digest parcial, credencial compartida y credenciales distintas. No afirmar cobertura total si sólo se comparó un subconjunto.

### S04 — P1: los checks llaman rutas inexistentes y falta el token sintético de verificación

**Fuentes:** `.github/workflows/staging.yml:300`, `:348`, `:350`, `:457`; `apps/api/scripts/staging-smoke.cjs:87`, `:93`, `:116`, `:125`, `:129`; `apps/api/src/main.ts:147`; `apps/api/src/modules/health/health.controller.ts:18`, `:31`, `:60`; `apps/whatsapp/src/main.ts:11`; `apps/whatsapp/src/modules/health/health.controller.ts:31`; `apps/whatsapp/src/modules/webhooks/webhooks.controller.ts:22`; `apps/api/src/modules/widget/widget-public.controller.ts:31`, `:62`.

API tiene prefijo `api/v1`, pero deploy/rollback/smoke esperan `/health` o `/health/detailed`. Incluso una API sana agota la espera y fuerza rollback; el propio rollback vuelve a esperar la ruta incorrecta. WhatsApp ofrece `/api/v1/health/live` y `/api/v1/webhooks/whatsapp`, no `/health` ni `/api/v1/whatsapp/webhook`. Widget ofrece `/api/v1/widget/config/:widgetId`; el smoke usa `/api/v1/widget/public/config/:tenantId`. Su seed crea persona/tenant, pero no demuestra crear el widget que exige esa ruta.

El smoke además exige `META_VERIFY_TOKEN` o `WHATSAPP_VERIFY_TOKEN`, y ninguno forma parte de las variables escritas por staging. Se necesita un token sintético propio, sin registrar una app ni invocar a Meta. La negativa del token erróneo no queda probada recibiendo 404 en una ruta equivocada.

**Cierre:** usar los contratos reales, provisionar widget por su identidad correcta, configurar token sintético y probar positivo/negativo contra los procesos desplegados. Verificar cuerpo/status real de salud y que un 404 no cuenta como prueba de autorización.

### S05 — P1: se pierde la evidencia al eliminar el contenedor que la produjo

**Fuentes:** `.github/workflows/staging.yml:344`, `:345`, `:354`, `:355`, `:362`, `:363`, `:369`, `:370`, `:405`; `infra/docker/docker-compose.prod.yml:106`.

`compose run --rm api ... --json /tmp/seed.json` escribe en un contenedor efímero. Después `compose exec api cat /tmp/seed.json` lee el contenedor persistente, que no recibió ese archivo; `/tmp` no está compartido. Mismo defecto para smoke/publicación/piloto. Aun corrigiéndolo, “Collect the evidence” sólo crea `/tmp/staging-artifacts.tgz` en el host; no lo descarga ni publica. El único `upload-artifact` del workflow corresponde al guard. `mkdir -p artifacts` conserva archivos de corridas anteriores, sin separar run/SHA.

**Cierre:** salida estructurada a volumen/directorio por run montado en el productor, o stdout capturado de manera inequívoca; transferencia y `upload-artifact` siempre con identificador de corrida y SHA/digests. Prueba real mínima de creación, lectura desde runner y conservación tras eliminar el contenedor. No rescatar archivos de una corrida anterior para completar una actual.

### S06 — P1: el piloto nunca activa el outbox y su lectura SQL no lo detecta

**Fuentes:** `apps/api/src/common/utils/staging-operations.ts:124`, `:135`; `apps/api/src/modules/channels/dispatch-rollout.service.ts:54`, `:85`, `:115`; `apps/api/scripts/staging-smoke.cjs:146`; `apps/api/scripts/staging-dispatch-pilot.cjs:90`.

Se escribe `web_widget`, pero runtime sólo admite WhatsApp/Messenger/Instagram/Telegram para este outbox. Con el servicio real y una configuración sintética el resultado es `effectiveChannels:[]`, `ignoredChannels:['web_widget']` y `enabledFor=false`. El smoke sólo relee `platform_settings`: no entra un turno, no crea lote/efecto y no verifica recibo. El piloto puede parecer verde sin ensayar el mecanismo buscado.

La escritura directa tampoco invalida `dispatch:rollout`; advierte de 60 s de caché. Al corregir el canal, encendido y apagado deben comprobar el estado efectivo sin heredar una respuesta cacheada. `if:always()` programa el intento de apagado, pero no garantiza que haya ocurrido si SSH/script falla.

**Cierre:** fixture local de transporte estricto soportado y conexión sintética, sin credenciales reales, o un ensayo separado claramente nombrado. Probar turno→batch→effect→receipt→historial y modo de fallo/recuperación; apagar vía servicio operable con invalidación/readback. No habilitar un canal real sólo para volver verde esta prueba.

### S07 — P1: no hay build de candidato previo a producción ni correspondencia comprobada de SHA

**Fuentes:** `.github/workflows/staging.yml:97`, `:102`, `:160`, `:202`, `:219`, `:320`; `.github/workflows/deploy.yml:39`, `:403`, `:409`, `:410`, `:537`, `:541`, `:542`, `:607`, `:609`; `infra/docker/Dockerfile.dashboard:26`, `:37`; `apps/dashboard/src/lib/api.ts:20`.

Staging sólo hace pull de imágenes existentes. Los builds que las producen dependen de validación/E2E habilitados únicamente en `refs/heads/main`; luego siguen al job de despliegue productivo. No existe en este workflow un camino para construir imágenes del SHA de PR, probarlo en staging y sólo después promoverlo. Un despacho manual de deploy desde otra rama no lo resuelve: sus prerequisitos se omiten. Suministrar tags construidos externamente sería trabajo adicional, no una capacidad de este flujo.

Además el dashboard publicado se compila con API y WA de producción. Next.js inserta `NEXT_PUBLIC_*` en el bundle; escribir una URL de staging en `.env` al arrancar no cambia el JavaScript ya construido. El usuario de la página de staging podría llamar a producción. No se abrió esa página ni se emitió ninguna solicitud durante esta revisión.

Los checkouts del runner no usan `ref: inputs.image_tag`. El host no hace checkout, fetch ni sincronización de compose: utiliza lo que ya esté en `/opt/parallext-staging`. Por tanto pueden divergir **fuente del guard, compose del host e imágenes del input**. Validar 7–40 caracteres hex no verifica existencia, procedencia, integridad o pertenencia a una build aprobada; el build actual sólo publica tag SHA completo. Tampoco se fija digest OCI: un tag con forma de SHA no es inmutable por sí mismo.

**Cierre:** build de candidato separado del deploy productivo; resolución de SHA completo y manifiesto de digests por servicio, artefactos/configuración del mismo candidato; dashboard con configuración segura para el entorno (o runtime config diseñada y probada). Staging debe admitir el candidato antes de merge y producir evidencia referida exactamente a sus imágenes/configuración. La promoción no debe reconstruir silenciosamente otro artefacto.

### S08 — P1 condicionado a los datos: el preflight no equivale a la elegibilidad real de cobro

**Fuentes:** `apps/api/src/modules/tenant-payments/agreed-terms-preflight.ts:119`, `:127`, `:158`; `apps/api/prisma/tenant-schema.sql:1762`; `apps/api/src/modules/appointments/appointment-service-terms.ts:99`, `:103`.

Lectura de SQL, **no ejecutado contra PostgreSQL en esta revisión**. `appointments.metadata` admite SQL NULL. `NOT (NULL ? 'serviceTerms')` da NULL y la fila no se cuenta, aunque el resolver obtiene precio/divisa NULL y niega el pago. Un objeto `{"serviceTerms":null}` o `{"serviceTerms":{}}` tampoco se cuenta: la clave existe, pero el precio/divisa acordados faltan. Catálogo sólo verifica `action='create'`, no la completitud del acuerdo que usará el cobro. No se afirma que producción contenga estas formas: hace falta medirlas.

**Cierre:** preflight basado en las mismas condiciones de elegibilidad/estructura que el lector monetario, conservando la negativa a fabricar consentimiento. Regresión PostgreSQL con metadata SQL NULL, JSON null, objeto incompleto, precio/divisa ausentes o inválidos y acuerdo válido; distinguir datos no cobrables por diseño de referencias cobrables que la versión nueva dejará inutilizables. Inspeccionar datos reales sólo mediante reporte autorizado y sin información personal en logs.

### S09 — P1 para la primera instalación: el preflight requiere un catálogo público que aún no se ha creado

**Fuentes:** `.github/workflows/staging.yml:248`, `:269`, `:284`; `apps/api/scripts/preflight-agreed-terms.cjs:56`, `:58`, `:93`, `:97`.

Lectura del orden y del manejo de error, **sin ensayo de Docker/PostgreSQL vacío**. En host nuevo, iniciar PostgreSQL no crea `public.tenants`. El preflight la consulta antes de `prisma migrate deploy` y sale 2 con `42P01`; el workflow no proporciona un bootstrap inicial. Es correcta su negativa ante una inspección imposible, pero falta un recorrido separado para demostrar que una base realmente vacía puede inicializarse sin omitir el control de una actualización.

**Cierre:** bootstrap vacío autorizado y probado con comprobación positiva de vacío; después recorridos normales de actualización con preflight obligatorio. No resolverlo convirtiendo cualquier tabla ausente/error de conexión en “cero huérfanos”.

## Qué está bien y qué sigue sin demostrarse

- En producción, backup fail-closed precede al preflight; preflight precede a migración pública/tenants y a recreación (`deploy.yml:1145`, `:1205`, `:1221`, `:1230`, `:1274`). El preflight diferencia error de inspección de cero y considera aceptación ausente como todas las filas vivas en riesgo. Este orden mejora la protección, aunque no demuestra restore ni elegibilidad de cada fila.
- Consultas del preflight están cualificadas por schema, usan parámetros para probes y validan identificadores. No encontré una consulta multi-statement nueva que requiera inventar otro splitter. Usa conexión directa. El seed usa el splitter de `PrismaService` (`seed-staging-synthetic.cjs:65`) y ejecuta cada sentencia separada (`:104`); no se verificó aquí su DDL completo en una base nueva.
- El preflight es una fotografía: los procesos anteriores siguen sirviendo y escribiendo entre inspección y sustitución. No hay barrera demostrada que impida nuevas filas con formato antiguo en esa ventana. Para afirmar que ninguna se pierde, ensayar tráfico concurrente de la versión anterior y decidir compatibilidad temporal, pausa acotada de los writers afectados o segunda comprobación vinculada a su cese. Esto es una brecha de evidencia/diseño adicional, no una reproducción de una fila real.
- No se vio una prueba de restore de backup ni de compatibilidad del binario anterior con todas las migraciones nuevas; el comentario “aditivas por contrato” no sustituye esos ensayos.
- No se comprobó existencia de host, secretos, imágenes en registro, configuración de túnel, permisos SSH/registry ni una ejecución real. Esos son requisitos externos distintos de S01–S09.

## Orden propuesto para cerrar

1. Corregir el gate de rollback y la comparación incompleta; impedir que un test verde pueda tocar un entorno no comprobado.
2. Crear camino de build del candidato sin deploy productivo y configuración efectiva de staging del mismo SHA/digests; corregir dashboard y túnel.
3. Probar primera instalación vacía y actualización, luego rutas reales, seed, transferencia de artefactos y piloto efectivo con transporte sintético.
4. Extender preflight con formas límite de aceptación y prueba de escrituras concurrentes; validar backup/restore y rollback real de imágenes en el schema resultante.
5. Ejecutar host aislado con datos sintéticos, fallo intencional de preflight, despliegue correcto, rollback y archivo de evidencia por corrida. Sólo después evaluar la promoción del mismo artefacto. Credenciales/pilotos reales y calidad de agentes conservan sus gates propios.

No se editó código de producto ni workflows, ni se hizo commit/push. Los únicos archivos nuevos de esta revisión son este informe y su reproductor.
