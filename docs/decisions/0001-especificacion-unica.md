# 0001 — Especificación de requisitos del negocio como fuente única

- Estado: aprobada
- Fecha: 2026-10-30 · Decide: dueño (aprobación de C0 §7) · Autor: agente (rebanada R1)
- Ámbito: `packages/business-spec/`, `apps/api/src/modules/readiness/`, `docs/domain/`, CI (`verify-artifacts`, `candidate.yml`)

## Contexto
Qué debe tener definido un negocio para que el agente responda sin inventar estaba repartido en piezas que no se hablaban: `VerticalReadinessService` contaba filas, `AgentQualityService` repetía con otra regla los mismos chequeos, el `readiness` del manifiesto por subtipo no tenía evaluador y el arnés QA adivinaba la respuesta esperada (CATGEN/FAQGEN, causa del 72,9 % de los `fail_case`). La fase B produjo una especificación (B2 v0.2, D1–D15), y la validación manual con los tenants QA dental y comida mostró que se puede aplicar de punta a punta.

## Decisión
- La especificación vive en el repositorio, en `packages/business-spec/spec/` (`core.yaml`, `objects.yaml`, `profiles.yaml`, `intents.yaml`, `requirement.schema.json`), versión `1.0.0-rc.1`. Los YAML de trabajo de B2 dejan de ser fuente.
- Todo el código que la interpreta es puro y está en el mismo paquete: `compile`, `compose`, reglas L1–L7, motor (`evaluate`), `qaTruth` y la CLI. La API solo lee la base (`SnapshotReader`, de solo lectura); en rebanadas posteriores guarda valores y emite eventos.
- La lectura humana se **genera** (`docs/domain/business-requirements.md`); el formato aprobado está escrito a mano en `docs/domain/business-requirements-format.md`.
- La CI falla ante cualquier defecto de la especificación (`business-spec --check` dentro de `verify-artifacts`, que corren `candidate`, `deploy` y `vertical-quality`) y corre las pruebas del paquete en `candidate.yml`.
- No se hace en R1: ningún cambio del runtime del agente, de la base ni de la imagen de la API.

## Consecuencias
- Implementación: `packages/business-spec/src/{compile,compose,facts,status,legacy-status}.ts`, `src/engine/`, `src/qa/truth.ts`, `bin/business-spec.cjs`; `apps/api/src/modules/readiness/snapshot-reader.ts`; `npm run readiness:report --workspace=@parallext/api`.
- Verificación: un test por defecto de la especificación, un caso que cumple y otro que no por cada uno de los 95 requisitos, fotos golden de los 7 tenants QA (`packages/business-spec/test/fixtures/qa-tenants/`) y el mismo `resultHash` para la misma foto.
- Queda obsoleto y se retira en su rebanada (C0 §4.2): `VerticalReadinessService`, `READINESS` y `TOOL_GROUP_READINESS` (R4); `ReadinessCitationV1` y los 20 chequeos de datos de `AgentQualityService` (R2); `kb_unanswered_queries` (R5). El generador QA viejo deja de ser fuente de la respuesta esperada desde ya: la da `business-spec qa-truth`.

## Alternativas descartadas
- **`docs/` como fuente**: los datos de entrada del producto no van en `docs/` (K2 §5.1).
- **`packages/shared`**: 71 módulos mezclados; el arnés QA (Python, fuera del repo) debe consumir `dist/spec.json` y la CLI sin cargar todo `shared`.
- **Un DSL de predicados**: para 95 predicados cuesta más de lo que ahorra; se usan 5 formas genéricas y 42 evaluadores propios.
