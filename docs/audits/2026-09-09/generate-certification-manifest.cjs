/*
 * The package to hand over before anybody authorises spending on models.
 *
 * The directive asks for "un manifest exacto de lo que requiere LLM, costo y
 * autorización" and, before requesting any external gate, "un paquete revisable:
 * variables requeridas sin secretos, cuentas/canales exactos, destinatarios,
 * casos, duración, costo máximo, criterios de abortar, rollback, métricas,
 * consultas de verificación y evidencia esperada".
 *
 * Every number here is computed, none typed. The plan comes from
 * `planCertificationRun`, whose scenario universe is the same `requiredScenarios`
 * the certification report demands, and whose rates are the router's own
 * catalogue — so the figure asked for and the figure billed cannot be two
 * different price lists. The per-model breakdown is a real choice to make: the
 * cheapest model in the catalogue certifies the same 78.120 cases for a fraction
 * of the most expensive one, and that trade-off should be visible before the
 * decision, not after the invoice.
 *
 * No secret is read, printed or required. The variables below are NAMES.
 *
 * Run from the repository root:
 *   node docs/audits/2026-09-09/generate-certification-manifest.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
process.env.TS_NODE_PROJECT = path.join(root, 'apps/api/tsconfig.json');
require(path.join(root, 'node_modules/ts-node')).register({ transpileOnly: true });
require(path.join(root, 'node_modules/tsconfig-paths')).register({
    baseUrl: root, paths: { '@parallext/shared': ['packages/shared/src/index.ts'] },
});
const api = name => require(path.join(root, 'apps/api/src', name));

const { planCertificationRun } = api('modules/simulation/certification-plan.ts');
const { LLM_MODEL_CATALOGUE } = api('modules/ai/router/llm-router.service.ts');
const { CERTIFICATION_LEDGER_DDL } = api('modules/simulation/certification-ledger.ts');
const { CONVERSATIONAL_CHANNELS, EVAL_LANGUAGES } = require(path.join(root, 'packages/shared/src/index.ts'));

const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const channels = [...CONVERSATIONAL_CHANNELS];

/** The key each provider's models are reached with. Names only. */
const PROVIDER_ENV = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GOOGLE_GENERATIVE_AI_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    xai: 'XAI_API_KEY',
};

// One plan per model, so the cost of the choice is the thing being decided.
const perModel = LLM_MODEL_CATALOGUE
    .filter(model => model.supportsTools)
    .map(model => {
        const plan = planCertificationRun({ channels, models: [model.id] });
        return {
            model: model.id,
            provider: model.provider,
            tier: model.tier,
            envVar: PROVIDER_ENV[model.provider] || null,
            requiredCases: plan.totals.requiredCases,
            modelCalls: plan.totals.modelCalls,
            maxCostUsdCents: plan.totals.maxCostUsdCents,
            maxHours: Math.round(plan.totals.maxSeconds / 3600),
            planHash: plan.planHash,
        };
    })
    .sort((a, b) => a.maxCostUsdCents - b.maxCostUsdCents);

// Models without tool support cannot certify a catalogue whose cases execute
// writers. Saying so is part of the manifest: a reader comparing this list
// against the catalogue must not read the absence as an oversight.
const excluded = LLM_MODEL_CATALOGUE
    .filter(model => !model.supportsTools)
    .map(model => ({ model: model.id, provider: model.provider, reason: 'no_tool_support' }));

const reference = perModel[0];
const manifest = {
    version: 1,
    revision,
    generatedFrom: [
        'modules/simulation/certification-plan.ts',
        'modules/simulation/certification-ledger.ts',
        'modules/ai/router/llm-router.service.ts',
    ],
    gate: 'llm_credentials_and_budget',
    scope: {
        profiles: planCertificationRun({ channels, models: [reference.model] }).profiles.length,
        languages: [...EVAL_LANGUAGES],
        channels,
        k: 1,
    },
    requiredEnvironmentVariables: [...new Set(perModel.map(row => row.envVar).filter(Boolean))],
    perModel,
    excludedModels: excluded,
    tokenBound: planCertificationRun({ channels, models: [reference.model] }).tokenBound,
    ledgerTables: CERTIFICATION_LEDGER_DDL
        .map(statement => /CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS ([a-z_]+)/.exec(statement)?.[1])
        .filter(Boolean),
};

fs.writeFileSync(path.join(__dirname, 'certification-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const usd = cents => `US$${(cents / 100).toFixed(2)}`;
const cheapest = perModel[0];
const dearest = perModel[perModel.length - 1];
const lines = [
    '# Paquete para el gate de credenciales LLM y presupuesto',
    '',
    'Generado por `docs/audits/2026-09-09/generate-certification-manifest.cjs`. **Ningún número está**',
    '**escrito a mano**: el plan sale de `planCertificationRun`, cuyo universo de escenarios es el mismo',
    '`requiredScenarios` que exige el reporte de certificación, y cuyas tarifas salen del catálogo del propio',
    'router. La cifra que se pide autorizar y la que se factura no pueden ser dos listas de precios distintas.',
    '',
    `Revisión: \`${revision}\`. **Este documento no contiene ni requiere ningún secreto**: las variables se`,
    'nombran, no se leen.',
    '',
    '## Qué se pide',
    '',
    `Autorización para ejecutar la matriz generativa: **${cheapest.requiredCases.toLocaleString('es')} casos**`,
    `por modelo (${manifest.scope.profiles} perfiles × ${manifest.scope.languages.length} idiomas ×`,
    `${channels.length} canales × k=${manifest.scope.k}), con una credencial de proveedor y un techo de gasto.`,
    '',
    '## Costo por modelo, que es la decisión',
    '',
    '| Modelo | Proveedor | Tier | Variable | Llamadas | Techo de costo | Horas de modelo |',
    '|---|---|---|---|---:|---:|---:|',
    ...perModel.map(row => `| \`${row.model}\` | ${row.provider} | ${row.tier} | \`${row.envVar}\` `
        + `| ${row.modelCalls.toLocaleString('es')} | ${usd(row.maxCostUsdCents)} | ${row.maxHours} |`),
    '',
    `Del más barato al más caro hay un factor de **${(dearest.maxCostUsdCents / cheapest.maxCostUsdCents).toFixed(1)}×**`,
    `(${usd(cheapest.maxCostUsdCents)} contra ${usd(dearest.maxCostUsdCents)}) por el mismo trabajo. El techo sale de un`,
    `límite declarado de ${manifest.tokenBound.inputPerTurn} tokens de entrada y ${manifest.tokenBound.outputPerTurn}`,
    'de salida por turno, redondeado hacia arriba: un presupuesto que redondea hacia abajo es un presupuesto que se pasa.',
    '',
    ...(excluded.length ? [
        'Quedan fuera del catálogo certificable, y se dice por qué en vez de omitirlos:',
        '',
        ...excluded.map(row => `- \`${row.model}\` (${row.provider}): ${row.reason}.`),
        '',
    ] : []),
    '## Variables requeridas (nombres, sin valores)',
    '',
    ...manifest.requiredEnvironmentVariables.map(name => `- \`${name}\``),
    '',
    'Se necesita **una** de ellas: la del proveedor del modelo elegido. Ninguna va a un commit ni a un log.',
    '',
    '## Dónde aterriza la evidencia',
    '',
    `Tablas del ledger, creadas por \`ensureCertificationLedger\`: ${manifest.ledgerTables.map(name => `\`${name}\``).join(', ')}.`,
    '',
    'Cada caso guarda identidad estable, hash de definición del escenario, modelo realmente servido, canal,',
    'idioma, intento, costo, latencia, transcript, tools, verificación y estado. El reporte se calcula desde',
    'esas filas (`certificationEvidenceFromLedger`), nunca desde objetos construidos por una prueba.',
    '',
    '## Criterios de aborto',
    '',
    '- `budget_usd_cents` alcanzado → el ejecutor deja de entregar casos y el run queda `finished` con',
    '  `stop_reason=budget_exhausted`. El control es **antes** de arrendar el caso, así que el exceso máximo',
    '  es un caso, no ilimitado.',
    '- `deadline_at` pasado → `stop_reason=deadline_passed`, medido con `clock_timestamp()`.',
    '- Cancelación del operador → `cancelCertificationRun`, y no se entrega ni un caso más.',
    '- Tasa de error por proveedor: si `state=error` supera el 5 % de los casos registrados, cancelar y revisar',
    '  antes de seguir gastando. La consulta está abajo.',
    '',
    '## Rollback',
    '',
    'No hay nada que revertir en producción: el ejecutor no toca tenants reales, no envía mensajes y no publica.',
    'Un run abandonado se cancela y sus filas quedan como historial. Si el gasto fue en vano —por ejemplo porque',
    'cambió la configuración del agente— la evidencia se invalida sola: `certificationEvidenceFromLedger` devuelve',
    '`staleRun` y no entrega nada.',
    '',
    '## Consultas de verificación',
    '',
    '```sql',
    '-- Progreso y gasto real (no el techo).',
    'SELECT state, count(*)::int, COALESCE(SUM(cost_usd_cents),0)::int AS cents',
    '  FROM agent_certification_cases WHERE run_id = $1::uuid GROUP BY state;',
    '',
    '-- Tasa de error, el criterio de aborto por proveedor.',
    'SELECT round(100.0 * count(*) FILTER (WHERE state = \'error\')',
    '             / NULLIF(count(*) FILTER (WHERE state <> \'pending\'), 0), 2) AS error_pct',
    '  FROM agent_certification_cases WHERE run_id = $1::uuid;',
    '',
    '-- Casos sin ningún intento aprobado: el hueco, contado una vez por caso.',
    'SELECT count(*)::int FROM (',
    '  SELECT case_key, BOOL_OR(state = \'passed\') AS proven',
    '    FROM agent_certification_cases WHERE run_id = $1::uuid GROUP BY case_key',
    ') c WHERE proven = false;',
    '',
    '-- El modelo que de verdad contestó, que no siempre es el que se pidió.',
    'SELECT served_model, count(*)::int FROM agent_certification_cases',
    ' WHERE run_id = $1::uuid AND state = \'passed\' GROUP BY served_model;',
    '```',
    '',
    '## Evidencia esperada al terminar',
    '',
    `- ${cheapest.requiredCases.toLocaleString('es')} casos con estado distinto de \`pending\`;`,
    '- un `AgentReleaseRunEvidence` sellado por canal, con `models` nombrando el modelo servido;',
    '- un `CertificationReport` con `evidenceKind: executed_runs` y un estado por perfil;',
    '- el gasto real por debajo del techo autorizado, verificable con la primera consulta.',
    '',
    'Mientras esta autorización no exista, **cero perfiles certificados** es el resultado correcto y así se',
    'reporta. No es un defecto del ejecutor: es la ausencia de una corrida que nadie pagó.',
    '',
    'Para actualizar: `node docs/audits/2026-09-09/generate-certification-manifest.cjs` desde la raíz.',
    '',
];
fs.writeFileSync(path.join(__dirname, 'certification-manifest.md'), lines.join('\n'));
process.stdout.write(JSON.stringify({
    models: perModel.length,
    cheapest: { model: cheapest.model, cents: cheapest.maxCostUsdCents },
    dearest: { model: dearest.model, cents: dearest.maxCostUsdCents },
    cases: cheapest.requiredCases,
}) + '\n');
