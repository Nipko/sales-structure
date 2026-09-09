/*
 * The state of the local remainder, read from the code that decides it.
 *
 * The closing directive asks for "un informe generado desde autoridades
 * ejecutables, no una narración manual", and it is right to: every counter in
 * this programme that was written by hand went stale — the 32/10 of the task
 * matrix, the `complete` of the channel matrix, "otras salidas", "faltan
 * términos en otras familias". A number a person retypes is a number that will
 * be wrong on the day it matters.
 *
 * So this asks the authorities themselves and writes what they answer:
 *
 *   · the task competence matrix, for profiles, tasks and certification;
 *   · the certification plan, for what a real generative run would cost;
 *   · the channel certification matrix, for implemented/operating/certified;
 *   · the agent output inventory, for every place the words come to rest;
 *   · the terms-binding inventory, for what the customer agreed to.
 *
 * No database, no model, no provider, no tenant. Run from the repository root:
 *   node docs/audits/2026-09-09/generate-closure-state.cjs
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

const { buildTaskCompetenceMatrix } = api('modules/simulation/task-competence-matrix.ts');
const { planCertificationRun } = api('modules/simulation/certification-plan.ts');
const { buildChannelCertificationMatrix, summariseChannelCertification } =
    api('modules/channels/channel-certification-matrix.ts');
const { channelCertificationRuntime } = api('modules/channels/channel-certification-runtime.ts');
const { AGENT_OUTPUT_STORES, openAgentOutputStores } = api('modules/learning/agent-output-inventory.ts');
const { FAMILY_TERMS_BINDINGS, familiesWithUnboundCharge, familiesWithUnboundCommand } =
    api('modules/conversations/terms-binding-inventory.ts');
const { CONVERSATIONAL_CHANNELS } = require(path.join(root, 'packages/shared/src/index.ts'));

const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const matrix = buildTaskCompetenceMatrix();
const plan = planCertificationRun({ channels: [...CONVERSATIONAL_CHANNELS], models: ['gpt-4.1-mini'] });
const channels = buildChannelCertificationMatrix(channelCertificationRuntime());
const channelSummary = summariseChannelCertification(channels);
const openStores = openAgentOutputStores();
const unboundCharge = familiesWithUnboundCharge();
const unboundCommand = familiesWithUnboundCommand();

const state = {
    revision,
    generatedFrom: [
        'modules/simulation/task-competence-matrix.ts',
        'modules/simulation/certification-plan.ts',
        'modules/channels/channel-certification-matrix.ts',
        'modules/learning/agent-output-inventory.ts',
        'modules/conversations/terms-binding-inventory.ts',
    ],
    taskMatrix: matrix.summary,
    certificationPlan: {
        profiles: plan.profiles.length, languages: plan.languages, channels: plan.channels,
        models: plan.models, k: plan.k, tokenBound: plan.tokenBound,
        requiredCases: plan.totals.requiredCases, modelCalls: plan.totals.modelCalls,
        maxCostUsdCents: plan.totals.maxCostUsdCents, maxSeconds: plan.totals.maxSeconds,
        refusals: plan.refusals,
    },
    channelCertification: {
        ...channelSummary,
        rows: channels.map(row => ({
            channel: row.channelType, selfService: row.selfService, state: row.state,
            certified: row.certified, pending: row.pending, untested: row.untested, unproven: row.unproven,
        })),
    },
    agentOutputs: {
        stores: AGENT_OUTPUT_STORES.length,
        open: openStores.map(row => ({ id: row.id, store: row.store, remedy: row.remedy })),
    },
    termsBinding: {
        families: FAMILY_TERMS_BINDINGS.length,
        unboundCommand: unboundCommand.map(row => row.family),
        unboundCharge: unboundCharge.map(row => row.family),
    },
};

fs.writeFileSync(path.join(__dirname, 'closure-state.json'), JSON.stringify(state, null, 2) + '\n');

const list = values => (values.length ? values.map(value => `\`${value}\``).join(', ') : '—');
const markdown = [
    '# Estado del remanente local, leído del código',
    '',
    'Generado por `docs/audits/2026-09-09/generate-closure-state.cjs`. **Ningún número de este documento**',
    '**está escrito a mano**: cada uno lo responde la autoridad que lo decide. Todos los contadores de este',
    'programa que sí se escribieron a mano envejecieron —el 32/10 de la matriz, el `complete` de canales,',
    '«otras salidas», «faltan términos en otras familias»—, y ése es exactamente el motivo.',
    '',
    `Revisión: \`${revision}\`. Sin base de datos, sin modelo, sin proveedor, sin tenant.`,
    '',
    '## Matriz de tareas',
    '',
    `| Perfiles | Tareas | Comprometen al negocio | Sin positivo verificable | Sin verificador | Certificados |`,
    '|---:|---:|---:|---:|---:|---:|',
    `| ${matrix.summary.profiles} | ${matrix.summary.tasks} | ${matrix.summary.committingTasks} `
        + `| ${matrix.summary.tasksMissingPositiveCases} | ${matrix.summary.tasksMissingVerifiers} `
        + `| ${matrix.summary.certifiedProfiles} |`,
    '',
    '## Lo que costaría certificar el catálogo',
    '',
    `Un modelo (${list(plan.models)}), ${plan.channels.length} canales, ${plan.languages.length} idiomas, k=${plan.k}:`,
    '',
    `- **${plan.totals.requiredCases.toLocaleString('es')}** casos requeridos`,
    `- **${plan.totals.modelCalls.toLocaleString('es')}** llamadas al modelo (derivadas de los mensajes de cliente de cada escenario)`,
    `- techo **US$${(plan.totals.maxCostUsdCents / 100).toFixed(2)}** con un límite declarado de `
        + `${plan.tokenBound.inputPerTurn} tokens de entrada y ${plan.tokenBound.outputPerTurn} de salida por turno`,
    `- **${Math.round(plan.totals.maxSeconds / 3600)} h** de tiempo de modelo`,
    `- rechazos del plan: ${list(plan.refusals)}`,
    '',
    '## Certificación de canales',
    '',
    `| Autoservicio | Implementados | Operando | Certificados |`,
    '|---:|---:|---:|---:|',
    `| ${channelSummary.selfService} | ${channelSummary.implemented} | ${channelSummary.operating} | ${channelSummary.certified} |`,
    '',
    '| Canal | Estado | Sin implementar | Declarado, nunca operado | Operando sin prueba |',
    '|---|---|---|---|---|',
    ...channels.filter(row => row.selfService).map(row =>
        `| ${row.channelType} | ${row.state} | ${list([...row.pending])} | ${list([...row.untested])} | ${list([...row.unproven])} |`),
    '',
    '## Dónde descansan las palabras del agente',
    '',
    `${AGENT_OUTPUT_STORES.length} lugares inventariados, **${openStores.length} abiertos**:`,
    '',
    '| Store | Qué lo cerraría |',
    '|---|---|',
    ...openStores.map(row => `| \`${row.id}\` | ${row.remedy} |`),
    '',
    '## Términos que el cliente aceptó',
    '',
    `${FAMILY_TERMS_BINDINGS.length} familias. Sin comando vinculado: ${list(unboundCommand.map(row => row.family))}.`,
    '',
    `Sin cobro vinculado: ${list(unboundCharge.map(row => row.family))}.`,
    '',
    'Para actualizar: `node docs/audits/2026-09-09/generate-closure-state.cjs` desde la raíz.',
    '',
];
fs.writeFileSync(path.join(__dirname, 'closure-state.md'), markdown.join('\n'));
process.stdout.write(JSON.stringify({
    taskMatrix: state.taskMatrix,
    plan: { cases: plan.totals.requiredCases, calls: plan.totals.modelCalls, cents: plan.totals.maxCostUsdCents },
    channels: { certified: channelSummary.certified, operating: channelSummary.operating, implemented: channelSummary.implemented },
    outputs: { stores: AGENT_OUTPUT_STORES.length, open: openStores.length },
    terms: { families: FAMILY_TERMS_BINDINGS.length, unboundCommand: unboundCommand.length, unboundCharge: unboundCharge.length },
}) + '\n');
