# 0030 — Catálogo LLM configurable sin desplegar, con promoción por medición

- Estado: aceptada; fases 1 (#416), 2 (#417) y 4 implementadas, fases 3 y 5 pendientes
- Fecha: 2026-11-09 · Decide: dueño · Autor: Claude
- Ámbito: `apps/api` (`ai/router`, `ai/health`, `ai/providers`, `settings`, los servicios con modelo fijo), `apps/dashboard` (`admin/settings/ai-config`), `apps/api/scripts/rehearsal`.
- Relacionadas: [0026](0026-salud-de-proveedores-llm.md) (salud de proveedores), [0027](0027-costo-llm-cache-y-rechazos.md) (precios de caché), [0028](0028-piso-de-herramientas-dentro-del-plan.md) (piso de herramientas), [0029](0029-migracion-del-catalogo-llm-nov-2026.md) (migración del catálogo).

## Contexto

La migración de ADR-0029 necesitó un PR de cerca de 80 archivos para un cambio que, en el fondo, era «estos modelos, a estos precios, en este orden». Hoy todo lo que decide qué modelo responde está escrito en código:

| Qué | Dónde vive hoy | Quién lo lee |
|---|---|---|
| Modelos, tier, precios (entrada, salida, caché), contexto, herramientas | `MODEL_REGISTRY` en `llm-router.service.ts` | router, `LLM_MODEL_CATALOGUE` (sonda de salud, `agent-turn-session`, `certification-plan`, `certification-contract`) |
| Orden de cada tarea (`conversation`, `tool_calling`, `classify`) | `FALLBACK_CHAINS` | router |
| Modelo fijo de los servicios auxiliares | ~20 literales: copilot (×5), agent-console (×4), handoff (×2), conversations, intent-interpreter, nurturing, feature-requests, knowledge-conflict, crm-insights, image-vision, `COPILOT_EXTRACTION_MODEL`, jueces | cada servicio |
| Nombres por tier para mostrar | `llm.config.ts`, `persona.service.ts`, dashboard `_types.ts` | UI |
| Parámetros que cada familia acepta | `model-request-params.ts` | adaptadores, sonda, visión |

Lo que ya funciona sin código:

- **El respaldo ante caídas**: la sonda y el disyuntor sacan de rotación a un proveedor que falla.
- **El aviso de retiro**: `model_not_found` dispara `alertModelGone`, aunque solo cuando el modelo ya desapareció.
- **Las claves de API**: se guardan cifradas en `platform_settings` y se editan desde el panel de super admin. `LlmKeyService` las cachea 30 s.

Hay dos lecciones de ADR-0029 que el diseño tiene que respetar:

1. **Un modelo «mejor y más barato» según el proveedor no lo es necesariamente para nosotros.** gpt-5.6-luna es más caro que gpt-6-luna y sacó 12/28 en la confirmación firmada, contra 28/28. El orden de las cadenas se decide con el banco QA propio, no con la tabla del proveedor.
2. **Cada familia nueva trae un parámetro que rompe la llamada**: `max_tokens` en gpt-6, `temperature` en Claude 5, `thinkingBudget: 0` en gemini 3. Un modelo nuevo de una familia desconocida no puede activarse desde un panel, porque fallaría en producción con 400.

## Decisión

### 1. Lo que pasa a ser configuración y lo que sigue en código

| Configuración (base de datos, desde el panel) | Código (PR y despliegue) |
|---|---|
| Alta de un modelo de una **familia conocida** | Un **proveedor** nuevo (adaptador) |
| Precios, incluidos los de caché, con fuente y fecha | Una **familia** nueva o un cambio de parámetros (`model-request-params.ts` + test) |
| Tier, contexto, `supportsTools` | Las reglas de ruteo: piso de herramientas, ruteo por valor, afinidad, partición por plan |
| Orden de cada cadena | Los umbrales de la promoción (§4) |
| Qué modelo cumple cada **rol** auxiliar (§3) | |
| Retirar o reactivar un modelo | |

El catálogo de código no desaparece: pasa a ser la **versión semilla**. Arranca un entorno vacío, sirve de último recurso si la base no responde y es lo que regenera `certification-manifest`.

### 2. Catálogo versionado e inmutable

Dos tablas nuevas en el esquema `public` (migración Prisma):

- `llm_catalog_versions`:
  - `id`;
  - `version` (entero creciente);
  - `status` (`draft` | `active` | `superseded`);
  - `snapshot` (JSONB con `models[]`, `chains`, `roles`);
  - `parent_version`;
  - `reason` (texto obligatorio);
  - `created_by` y `published_by`;
  - `created_at` y `published_at`;
  - `validation` (JSONB con el resultado de §4).
- `llm_model_measurements`:
  - `model_id`;
  - `bench` (`rehearsal_7t` | `signed_confirmation` | `classify_verifier`);
  - `n`;
  - `pass`;
  - `pass_rate`;
  - `cost_per_case_usd`;
  - `catalog_version` (la versión contra la que se midió);
  - `api_commit`;
  - `run_ref` (ruta del `out/*.json`);
  - `measured_at`.

Reglas:

- **Una sola versión `active`.** Publicar es atómico: la versión nueva pasa a `active` y la anterior a `superseded`, en una transacción.
- **Nada se borra.** Retirar un modelo es sacarlo de las cadenas y marcarlo `retired: true` dentro del snapshot. Su precio sigue en el catálogo para contabilizar el gasto histórico (ADR-0027).
- **Volver atrás es publicar de nuevo una versión anterior.** Se crea una versión nueva con el snapshot copiado, para que el historial muestre el retroceso.

Un `LlmCatalogService` reemplaza a `MODEL_REGISTRY`, `FALLBACK_CHAINS` y `LLM_MODEL_CATALOGUE` como única fuente:

- Carga la versión activa y la cachea en memoria.
- Valida la caché contra la clave Redis `llm:catalog:active_version`, que se lee como mucho cada 10 s; publicar la incrementa. La API y el worker toman el cambio en ≤10 s sin reiniciar.
- Si Postgres no responde al arrancar, usa la semilla de código y emite un aviso. Si falla en caliente, conserva la última versión cargada.
- `evaluationRoutingSignature()` hashea el **snapshot activo** en lugar de las constantes. Así, publicar una versión invalida a propósito los ensayos en curso (`evaluation_dependencies_changed:runtime.model_routing`), como pasa hoy con un despliegue.
- `certification-plan` guarda en el plan la `catalog_version` cuyos precios usó para calcular el gasto máximo. Un cambio de precio posterior no altera un plan ya autorizado.

### 3. Roles en lugar de nombres de modelo en los servicios

Los ~20 literales se reemplazan por un rol: `llm.execute({ role: 'aux_reasoning', ... })`. El rol se resuelve contra `snapshot.roles`.

| Rol | Hoy | Usos |
|---|---|---|
| `aux_reasoning` | gpt-6-luna | copilot, agent-console, handoff, conversations (resúmenes), intent-interpreter, nurturing, feature-requests, knowledge-conflict, extracción del onboarding |
| `aux_cheap` | deepseek-flash | crm-insights |
| `judge_rehearsal` | deepseek-flash | juez del ensayo |
| `judge_quality` | gpt-6-luna | `QUALITY_JUDGE_CALL`, juez de certificación |
| `vision` | [gemini-3.5-flash-lite, grok-4.3, gpt-6-luna] | image-vision |

Un rol es una lista ordenada, así que también tiene respaldo. Hay una validación (§4) para que los jueces no coincidan con el modelo que juzgan: `judge_rehearsal` no puede ser la cabeza de `conversation` ni de `tool_calling`, y la cabeza de `classify` no puede ser `judge_rehearsal`. Es la regla que hoy vive en un comentario de `FALLBACK_CHAINS`. `llm.config.ts`, `persona.service.ts` y el `_types.ts` del dashboard dejan de tener nombres: leen el catálogo por la API.

### 4. Publicar exige validación; liderar exige medición

Un borrador se valida al pedir publicarlo. El resultado queda en `validation` y el panel lo muestra.

**Bloqueantes (no se puede publicar):**

1. Cada modelo pertenece a una familia conocida: la nueva función `modelFamily(provider, id)` de `model-request-params.ts` devuelve algo distinto de `unknown`. Así se evita el 400 en la primera llamada.
2. Todos los precios están definidos (entrada, salida, lectura de caché y escritura donde el proveedor la cobra), con `price_source_url` y `price_checked_at`.
3. Una **llamada real** con los parámetros del adaptador, hecha con la sonda de ADR-0026 extendida, contesta bien: un turno corto y, si `supportsTools`, una llamada a herramienta con argumentos válidos.
4. Cada cadena tiene al menos dos proveedores con clave configurada. Es la lección del 8-nov, cuando OpenAI quedó sin créditos.
5. La cabeza de `tool_calling` tiene `supportsTools` y un tier de `TOOL_CALLING_LEAD_TIERS`.
6. Los jueces son independientes (§3).
7. Ningún modelo de una cadena o rol está `retired`.

**De medición, para cambiar la cabeza de una cadena o rol:**

- `tool_calling` y `conversation`: el candidato tiene, contra la versión activa, una medición `rehearsal_7t` de menos de 14 días con `pass_rate` ≥ el de la cabeza actual − 0,01, y una `signed_confirmation` con `pass` ≥ el de la cabeza actual.
- `classify`: una medición `classify_verifier` (los casos de traspaso y de evidencia del ensayo) sin regresiones frente a la cabeza actual.
- Si no se cumple, se puede publicar igual con **«publicar sin medición»**. Esa opción exige un motivo, queda marcada en el historial y el panel la muestra en rojo hasta que haya una medición. Sirve para emergencias: un proveedor caído o un modelo retirado antes de tiempo.

Bajar un modelo en la cadena, retirarlo o corregir un precio no exige medición. Esos cambios no hacen que un modelo peor pase a responder primero.

### 5. Medir desde el catálogo

`apps/api/scripts/rehearsal/measure.cjs` y el banco de confirmación firmada pasan a:

- aceptar `--candidate <model_id>` en lugar de depender solo de `LLM_MEASUREMENT_LEAD_MODEL` (la variable se conserva para el runner);
- medir contra la versión **borrador** sin publicarla: el runner carga ese snapshot por id, y la API en producción no se entera;
- escribir el resultado en `llm_model_measurements` con un endpoint de super admin.

El panel muestra, junto a cada modelo, su última medición en cada banco.

### 6. Vigilancia de proveedores

Un job diario (`LlmCatalogWatchService`, en el worker) consulta la lista de modelos de cada proveedor con clave: `GET /v1/models` en OpenAI, xAI, DeepSeek y Anthropic, y `models.list` en Gemini. Después compara:

- **Un modelo del catálogo que ya no aparece**, o que aparece con fecha de retiro cuando el proveedor la publica: aviso por el canal de ADR-0026 *antes* del 404, con los roles y cadenas que lo usan.
- **Un modelo nuevo de una familia conocida**: entra en la lista «candidatos» del panel, sin precio ni tier y sin tocar ninguna cadena.
- **Una familia desconocida**: el mismo aviso, marcado «requiere código».

Las APIs de modelos no devuelven precios, así que el job no los toca: los precios se cargan a mano con su fuente. El job tampoco publica nada.

### 7. Panel (`admin/settings/ai-config`)

Pestaña «Catálogo»:

- Tabla de modelos: proveedor, tier, precios, caché, contexto, herramientas, última medición y estado de salud.
- Cadenas y roles, reordenables.
- Botón «Crear borrador desde la versión activa».
- Validar, medir y publicar.
- Historial con diff entre versiones, quién y por qué, y «volver a esta versión».

Solo `super_admin`. Cada publicación queda en `audit.service`.

## Flujo cuando salga un modelo nuevo

1. El job diario lo detecta y lo pone en «candidatos», o lo anuncia el proveedor.
2. Un super admin lo agrega a un borrador con precio y tier, en una posición baja de la cadena.
3. «Validar» hace la llamada real y revisa las reglas.
4. «Medir» corre el banco de los 7 tenants y la confirmación firmada contra el borrador.
5. Si la medición iguala o supera a la cabeza actual, se mueve a la cabeza y se publica. En ≤10 s queda en producción, sin despliegue.
6. Si algo sale mal, se vuelve a la versión anterior con un clic.

Cuando un modelo **baja de precio**, se edita el precio y se publica, sin medir. Cuando un modelo **se retira**, el aviso llega antes del 404: se baja o se retira del borrador y se publica.

## Fases de implementación

Cada fase es un PR separado, con CI en verde y sin cambiar el comportamiento hasta la fase 2.

1. **`LlmCatalogService` y roles, solo sobre la semilla de código.**
   - Todos los lectores (`MODEL_REGISTRY`, `FALLBACK_CHAINS`, `LLM_MODEL_CATALOGUE`, los ~20 literales, `llm.config`, persona y dashboard) pasan a leer el servicio.
   - Comportamiento idéntico. La firma de ruteo cambia una sola vez.
   - `modelFamily()` y sus tests.
2. **Tablas, versiones, caché Redis y endpoints de super admin.**
   - Endpoints: leer, crear borrador, validar y publicar.
   - Validaciones bloqueantes 1–7.
   - La semilla se carga como versión 1.
3. **Panel**: catálogo, cadenas, roles e historial.
4. **Mediciones**: `llm_model_measurements`, `measure.cjs --candidate` contra un borrador y la regla de promoción.
5. **Vigilancia diaria** de las listas de modelos.

Orden recomendado: 1 → 2 → 4 → 3 → 5. Con las fases 1, 2 y 4, una migración como la de ADR-0029 ya se hace con llamadas al API, sin PR. El panel se puede agregar después.

## Implementación de la fase 2 (9-nov-2026)

Decisiones tomadas al implementarla, que precisan lo de arriba:

- **Dónde vive.** `LlmCatalogService` (`ai/catalog/`) carga la versión y la pone a regir con `setActiveLlmCatalog()`. Los lectores siguen usando `activeLlmCatalog()`, que es síncrona, así que no cambian. El controlador es `ai/llm-catalog.controller.ts`, bajo `admin/llm-catalog`, solo para `super_admin`.
- **Endpoints:**
  - `GET /` (activa);
  - `GET versions`;
  - `GET versions/:v`;
  - `POST drafts` (`reason`, `fromVersion?`, `snapshot?`);
  - `PUT drafts/:v`;
  - `POST drafts/:v/validate` (`unmeasured?`);
  - `POST drafts/:v/publish` (`unmeasured?`, `reason?`);
  - `POST versions/:v/restore` (`reason`).
- **La semilla.** Se guarda como versión 1 la primera vez que arranca con la tabla vacía. Desde entonces, **editar `llm-catalog.ts` ya no cambia el catálogo de un entorno con versiones**: el cambio se publica por el API. El log avisa cuando la versión activa difiere de la semilla.
- **Interruptor de emergencia.** `LLM_CATALOG_SOURCE=seed` hace que rija la semilla de código e ignora la base.
- **Llamada real (regla 3).** Va por el adaptador de cada proveedor: un turno corto y, si `supportsTools`, una llamada a `record_probe` con argumentos válidos.
  - Solo se llama a los modelos nuevos, a los que cambian de proveedor o de `supportsTools` y a los que pasan a encabezar una cadena o un rol. Los que no cambian ya los vigila la sonda de ADR-0026, y volver a llamarlos haría que la falla momentánea de un proveedor bloquee la publicación de emergencia que lo saca.
  - Estas llamadas no pasan por el guardián de gasto: cuestan centavos y no son de ningún tenant.
- **Regla de medición, mientras no existe la fase 4.** No hay tabla de mediciones todavía, así que todo cambio de cabeza bloquea, salvo dos casos:
  - con «publicar sin medición», que exige un motivo y queda en `validation.unmeasured`;
  - al volver a una versión que ya rigió (`restore`).
- **Validar contra la base.** Validar y publicar comparan contra la versión activa leída de Postgres, no contra la de memoria. Si otra publicación entra entre la validación y la transacción, la publicación se rechaza con `catalog_active_changed`.
- **Auditoría.** Cada publicación deja una fila `llm_catalog.published` en `audit_logs`, con `tenant_id` nulo.
- **Constantes que se leían al cargar el módulo.** Ahora son funciones:
  - `qualityJudgeCall()` y `qualityRubricHash()`;
  - `rehearsalJudgeDefaultModel()` (`RehearsalJudge.model` es un getter);
  - `evidenceVerifierModel()`;
  - `copilotExtractionModel()`;
  - `judgeModel()`.

  Publicar otro `judge_quality` cambia el `rubric_hash`, como antes lo cambiaba un despliegue.
- **Plan de certificación.** Registra `catalogVersion` fuera del `planHash`: es de dónde salieron los precios, no parte de lo que se autoriza.
- **Validaciones nuevas en `catalogIntegrityProblems`:**
  - fuente y fecha del precio;
  - modelo retirado dentro de una cadena o un rol;
  - modelo duplicado en una cadena;
  - tier de la cabeza de `tool_calling`.

  Un modelo retirado no exige familia conocida.

## Implementación de la fase 4 (9-nov-2026)

- **Tabla.** `public.llm_model_measurements` guarda modelo, banco, `n`, `pass` y `pass_rate`, que calcula el servicio, no quien llama. También guarda el costo por caso, `catalog_version` (la versión, borrador o activa, contra la que se midió), `api_commit`, `run_ref` y notas. Nada se borra.
- **Quién escribe:**
  - `measure.cjs --record` registra el ensayo como `rehearsal_7t`. No registra si quedan menos de 150 casos válidos.
  - `record-measurement.cjs` registra la confirmación firmada, el verificador de `classify` o una medición ya hecha.
  - `POST admin/llm-catalog/measurements` lo hace por el API.
- **Medir un borrador.** `measure.cjs --draft <v>` hace que ese proceso use la versión pedida. La API y el worker siguen con la publicada.
  - Sin `--draft`, el proceso fija la versión activa para que no cambie a mitad de la medición.
  - `--candidate <modelo>` es el líder (lo mismo que `LLM_MEASUREMENT_LEAD_MODEL`) y tiene que estar en `conversation` y `tool_calling`.
- **Criterio del ensayo.** Cuenta como acierto `answered` o `missing_data`. Los errores de infraestructura no entran en `n`. Es el criterio de `compare2.py`, con el que se eligió el catálogo de ADR-0029.
- **Regla de promoción** (`promotion-rule.ts`), que se aplica al validar:
  - `conversation` y `tool_calling`: el candidato necesita `rehearsal_7t` con tasa ≥ la de la cabeza − 0,01 y `signed_confirmation` con tasa ≥ la de la cabeza.
  - `classify`: `classify_verifier` sin regresión frente a la cabeza.
  - **Antigüedad.** La medición del candidato vale 14 días. La de la cabeza sirve de referencia sin importar su edad. Si la cabeza no tiene medición, basta la del candidato y queda un aviso.
  - **Versión medida.** No se exige que la medición sea contra la versión activa exacta: cada corrección de precio la invalidaría. `catalog_version` queda para trazabilidad.
  - **Roles.** No hay banco para ellos:
    - un juez nuevo (`judge_quality` o `judge_rehearsal`) exige «publicar sin medición», porque cambia la vara con que se mide todo lo demás;
    - los roles auxiliares solo dejan un aviso.
  - **Dónde queda.** La validación guarda en `promotion` las mediciones que usó. Si la tabla no responde, todo cambio de cabeza cuenta como sin medición.

## Consecuencias

- Una migración como la de ADR-0029 pasa de un PR de ~80 archivos a un borrador, una medición y una publicación.
- El orden de las cadenas deja de estar en un comentario y pasa a una tabla con historial: quién lo cambió, por qué y con qué medición.
- **Es un nuevo punto de fallo de configuración.** Una publicación mala afecta a todos los tenants en segundos. Lo mitigan:
  - las validaciones bloqueantes;
  - la llamada real antes de publicar;
  - la regla de medición;
  - volver atrás con un clic.
- `docs/generated/certification-manifest.*` describe la **semilla**, no lo que corre en producción. El panel muestra la versión activa, y cada ensayo y cada plan de certificación registran su `catalog_version`.
- Siguen necesitando código, 1 o 2 veces al año:
  - un proveedor nuevo;
  - una familia con parámetros desconocidos.

## Alternativas descartadas

- **Variables de entorno por modelo o cadena.** Exigen reiniciar los contenedores, no tienen historial ni validación y se desincronizan entre la API y el worker.
- **Filas sueltas en `platform_settings`, una clave por modelo.** Sin versiones atómicas, un cambio a medias deja una cadena que apunta a un modelo sin precio. Esa tabla sigue siendo para claves y ajustes simples.
- **Elegir automáticamente el modelo más barato que pase la medición.** Hoy la medición cubre lectura y confirmación, pero no escrituras dentro del pipeline (los tenants QA no tienen `WRITE_MODE`). Una persona tiene que aprobar el cambio de cabeza.
- **Leer precios de un agregador externo.** Ningún proveedor publica precios por API. Un tercero puede equivocarse o ir con retraso, y el gasto real (ADR-0027) depende de la tarifa exacta, incluida la de caché.
- **Catálogo por tenant.** Los planes ya limitan los tiers (ADR-0028). Un catálogo por tenant multiplicaría lo que hay que medir. Si algún día hace falta, va como capa sobre la versión activa, no en lugar de ella.
