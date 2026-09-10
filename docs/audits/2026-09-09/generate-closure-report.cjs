/*
 * The A1–H3 table, decided by the code rather than by whoever is writing.
 *
 * The acceptance criterion asks for "un informe generado desde autoridades
 * ejecutables, no una narración manual", with all 25 rows marked `aceptada`,
 * `bloqueada por gate externo concreto` or `abierta`, and "sin
 * contradicciones". A hand-written table cannot promise that: this programme
 * has already shipped a table that said "lo que queda: los cuatro gates
 * externos" one line above a paragraph listing nine rows of local work.
 *
 * So each row declares a CONDITION, and the status follows from it:
 *
 *   · a row with an unmet local condition is `abierta`, whatever anybody hoped;
 *   · a row whose local condition is met but whose closure needs somebody
 *     else's credentials, accounts or people is `bloqueada`, and names which
 *     gate;
 *   · only a row with no unmet condition and no gate is `aceptada`.
 *
 * The conditions are counters read from the same authorities the product uses,
 * so the table cannot drift from the code: closing a gap changes the table by
 * changing the code, and reopening one changes it back.
 *
 * Run from the repository root:
 *   node docs/audits/2026-09-09/generate-closure-report.cjs
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
const shared = require(path.join(root, 'packages/shared/src/index.ts'));

const { buildTaskCompetenceMatrix } = api('modules/simulation/task-competence-matrix.ts');
const { AGENT_OUTPUT_STORES, openAgentOutputStores } = api('modules/learning/agent-output-inventory.ts');
const { FAMILY_TERMS_BINDINGS, familiesWithUnboundCharge, familiesWithUnboundCommand } =
    api('modules/conversations/terms-binding-inventory.ts');
const { EVAL_WRITER_SANDBOX_FAMILIES } = api('modules/conversations/agent-test-tool-policy.ts');
const { buildChannelCertificationMatrix, summariseChannelCertification } =
    api('modules/channels/channel-certification-matrix.ts');
const { channelCertificationRuntime } = api('modules/channels/channel-certification-runtime.ts');
const { CERTIFICATION_LEDGER_DDL } = api('modules/simulation/certification-ledger.ts');
const { BENCHMARK_LEDGER_DDL } = api('modules/simulation/benchmark-harness.ts');
const { agentIssueResolutionDefects, routedAgentOperations } = shared;

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const revision = git('rev-parse', 'HEAD');

// ─── The authorities, asked once ────────────────────────────────────────────
const matrix = buildTaskCompetenceMatrix();
const openStores = openAgentOutputStores();
const unboundCommand = familiesWithUnboundCommand();
const unboundCharge = familiesWithUnboundCharge();
const blockedFamilies = Object.entries(EVAL_WRITER_SANDBOX_FAMILIES)
    .filter(([, family]) => !['audited', 'identity_challenge'].includes(family.status))
    .map(([name]) => name);
const channels = summariseChannelCertification(buildChannelCertificationMatrix(channelCertificationRuntime()));
const routed = routedAgentOperations();
const routedWithoutHandoff = routed
    .filter(operation => !Array.isArray(operation.requirements) || !Array.isArray(operation.readiness)
        || typeof operation.resultCheck !== 'string' || !operation.resultCheck)
    .map(operation => operation.key);
const resolutionDefects = agentIssueResolutionDefects();
/**
 * The five `file_claim` tasks have no effect verifier and no positive case ON
 * PURPOSE: in an evaluation the task exists to prove the identity step-up
 * refuses it, so there is no effect to verify and a "positive" would be the
 * agent doing what it must not. Counting them as gaps would make E1 permanently
 * open for a control working correctly — so they are excluded here, by name and
 * in the open, rather than by lowering a threshold until the number looks good.
 */
const DECLARED_TASK_EXCEPTIONS = ['file_claim'];
const matrixTasks = matrix.profiles.flatMap(profile => profile.tasks);
const undeclaredTaskGaps = matrixTasks.filter(task =>
    !DECLARED_TASK_EXCEPTIONS.includes(task.key)
    && (task.gaps.includes('effect_verifier_missing') || task.gaps.includes('positive_task_case_missing')));
const declaredTaskGaps = matrixTasks.filter(task => DECLARED_TASK_EXCEPTIONS.includes(task.key)).length;

/**
 * Is the executor wired to something a person can invoke, and can it be
 * rehearsed with no provider? Read off the module and the runner rather than
 * asserted: this is exactly the claim that was wrong before — a durable executor
 * with no caller — so it is the claim that has to be computed.
 */
const simulationModule = fs.readFileSync(
    path.join(root, 'apps/api/src/modules/simulation/simulation.module.ts'), 'utf8');
const certificationRunner = fs.readFileSync(
    path.join(root, 'apps/api/src/modules/simulation/certification-runner.ts'), 'utf8');
const executorOperable = ['CertificationService', 'CertificationProcessor', 'CertificationController']
    .every(symbol => simulationModule.includes(symbol))
    && certificationRunner.includes('dryRunCertificationRunner')
    && certificationRunner.includes('parallelyCertificationRunner');

const certificationTables = CERTIFICATION_LEDGER_DDL
    .filter(statement => statement.includes('CREATE TABLE')).length;
const benchmarkTables = BENCHMARK_LEDGER_DDL.filter(statement => statement.includes('CREATE TABLE')).length;

/** The five external gates, named exactly once so no row can invent a sixth. */
const GATES = {
    1: 'credenciales y cuentas de canal para pilotos reales (WhatsApp, Instagram, Messenger, Telegram)',
    2: 'credenciales de proveedor LLM, modelo, techo de gasto y autorización de ejecución',
    3: 'personas nuevas reclutadas para sesiones moderadas',
    4: 'cuentas autorizadas de alternativas y revisores ciegos',
    5: 'autorización posterior para push, despliegue, migración y activación',
};

/**
 * One row, and — as important — where its status came from.
 *
 * The first version of this file claimed "cada fila sale del código", and that
 * was too wide: about half the table set `open: 1` or named a gate by hand, so
 * changing the code in those areas changed nothing here. A table that cannot
 * tell you which half you are reading is a table that invites you to trust the
 * wrong half.
 *
 *  · `derived` — the status is a counter read out of the code at generation
 *    time. Close the gap and the row changes by itself;
 *  · `executed_evidence` — the status rests on an artefact in this repository
 *    produced by an actual run, named in `artefact`;
 *  · `declared` — a human judgement. Legitimate, and pending review: it is
 *    counted separately and listed, so nobody reads it as computed.
 */
const row = (id, { open = 0, openLabel = '', gates = [], evidence, commits = [], provenance, artefact = null }) => {
    if (!['derived', 'executed_evidence', 'declared'].includes(provenance)) {
        throw new Error(`row ${id}: provenance must be declared explicitly`);
    }
    return {
        id,
        open: Number(open),
        openLabel,
        gates,
        status: Number(open) > 0 ? 'abierta' : gates.length ? 'bloqueada' : 'aceptada',
        provenance,
        artefact,
        evidence,
        commits,
    };
};

const ROWS = [
    row('A1', { provenance: 'derived',
        open: unboundCommand.length + unboundCharge.length,
        openLabel: `${unboundCommand.length} familias sin comando ligado y ${unboundCharge.length} sin cobro ligado`,
        evidence: `Inventario calculado de ${FAMILY_TERMS_BINDINGS.length} familias `
            + `(\`terms-binding-inventory.ts\`). Cita y matrícula ligan comando y cobro; el pedido de catálogo pasó a `
            + `cobrar desde \`orders.catalog_terms\` y a rechazar la fila que no acordó nada. Sin comando ligado: `
            + `${unboundCommand.map(entry => `\`${entry.family}\``).join(', ')}. Sin cobro ligado: `
            + `${unboundCharge.map(entry => `\`${entry.family}\``).join(', ')}.`,
        commits: ['a806ef62', 'f121dc5f'],
    }),
    row('A2', { provenance: 'declared',  gates: [1], evidence: 'Comando, retención, settlement, avisos durables y revisión sin reenvío implementados y probados con PostgreSQL. La conciliación contra un proveedor real no puede correrse sin su cuenta.' }),
    row('A3', { provenance: 'declared',  gates: [1], evidence: 'Propuesta, consentimiento, aprobación humana y entrega durable probados con PostgreSQL y Socket.IO. La entrega real necesita un canal conectado.' }),
    row('A4', { provenance: 'declared',  gates: [1], evidence: 'Transacciones, lectores, promoción y restauración única comprobadas contra PostgreSQL.' }),
    row('B1', { provenance: 'executed_evidence', artefact: 'docs/audits/2026-09-09/order-sensitivity-runs.md',  gates: [1], evidence: 'El turno completo corre de punta a punta sobre PostgreSQL, Valkey, BullMQ y Socket.IO reales, con crash en cada frontera, una erasure en vuelo y los primitivos a través de un PgBouncer real en modo transacción.' }),
    row('B2', { provenance: 'derived',
        open: blockedFamilies.length,
        openLabel: `${blockedFamilies.length} familias bloqueadas`,
        evidence: `Las ${Object.keys(EVAL_WRITER_SANDBOX_FAMILIES).length} familias del registro tienen writer canónico `
            + 'auditado, con id de inbound compartido con el runtime y el ledger. Cero bloqueadas.',
    }),
    row('C1', { provenance: 'declared',  gates: [1], evidence: 'Árbitro, dueño por puerto, consentimiento por misión, corrección y reanudación probados en los cuatro idiomas del contrato (es/en/pt/fr).' }),
    row('C2', { provenance: 'derived',
        open: unboundCommand.length,
        openLabel: `${unboundCommand.length} familias cuyo writer ejecuta sin que le muestren lo acordado`,
        evidence: 'Ciclos de agenda y de mascotas con recibos atómicos comprobados. El cierre de esta fila es el mismo que el de A1.',
    }),
    row('C3', { provenance: 'derived',
        // Not "nobody ran it": the executor exists, is wired to an entrypoint
        // and is rehearsable without a provider. What is left is the credential,
        // which is a gate and not an open local hole.
        open: executorOperable ? 0 : 1,
        openLabel: 'el ejecutor de certificación no está cableado a ningún entrypoint',
        gates: [2],
        evidence: `Contratos MCP y dependencias base implementados. El ejecutor está cableado a servicio, cola y endpoint, y se ensaya sin proveedor; la cobertura por tarea la decide una corrida real: ${matrix.summary.certifiedProfiles} perfiles certificados de ${matrix.summary.profiles}.`,
    }),
    row('D1', { provenance: 'declared',  gates: [3], evidence: 'Muestreo, revisión humana con CAS y anotaciones RAG implementados. No se certifica veracidad global y el propio informe lo dice; una revisión de muestra necesita personas.' }),
    row('D2', { provenance: 'declared',
        open: 1,
        openLabel: 'calidad semántica bajo carga sin dataset, umbrales ni números publicados',
        evidence: 'CAS, recuperación, fusión de identidad y borrado comprobados con pgvector real. Disponibilidad bajo carga está medida; calidad semántica bajo carga no, y una no es la otra.',
    }),
    row('D3', { provenance: 'declared',  gates: [3], evidence: 'Atribución observable y diagnóstico técnico probados. No equivalen a veracidad ni a entailment, y el informe lo dice.' }),
    row('E1', { provenance: 'derived',
        open: undeclaredTaskGaps.length,
        openLabel: `${undeclaredTaskGaps.length} tareas sin caso positivo propio o sin verificador de efecto`,
        evidence: `${matrix.summary.profiles} perfiles, ${matrix.summary.tasks} tareas, `
            + `${matrix.summary.committingTasks} que comprometen al negocio, y cero tareas sin caso positivo propio o `
            + `sin verificador fuera de las ${declaredTaskGaps} declaradas: \`file_claim\` en las cinco subtipos de `
            + 'seguros existe para probar que el escalón de identidad la rechaza, así que no hay efecto que verificar '
            + 'y un "positivo" sería el agente haciendo lo que no debe. Certificar estas tareas es H1.',
    }),
    row('E2', { provenance: 'declared',
        open: 1,
        openLabel: 'lectores comerciales sin congelar y sin evaluación bajo tráfico concurrente',
        evidence: 'Núcleo, FAQs, políticas, temporalidad, réplica RAG administrada, jueces y retención integrados.',
    }),
    row('E3', { provenance: 'declared',  gates: [5, 1], evidence: 'Outbox durable, transporte estricto, recuperación, reconciliación con actor y evidencia, pantalla de operador y alerta real. El interruptor sigue apagado por defecto: encenderlo es una activación.' }),
    row('F1', { provenance: 'derived',
        open: executorOperable ? 0 : 1,
        openLabel: 'el ejecutor de certificación no está cableado a ningún entrypoint',
        gates: [2],
        evidence: 'Assessment común implementado y probado; su cierre es una corrida real de certificación, cuyo ejecutor ya existe y se ensaya sin proveedor.',
    }),
    row('F2', { provenance: 'derived',
        open: resolutionDefects.length + routedWithoutHandoff.length,
        openLabel: `${resolutionDefects.length} defectos en la tabla de resolución y ${routedWithoutHandoff.length} derivaciones sin traspaso declarado`,
        evidence: 'Cada blocker y cada recomendación del assessment tiene resolución declarada, con prueba de cobertura que falla al aparecer un código sin ella; el universo lo produce el código que emite los códigos, no un barrido de texto. Las '
            + `${routed.length} operaciones que Assist no ejecuta declaran requisitos no secretos, preparación, pantalla exacta y qué releer al volver.`,
        commits: ['37411849', 'f2a976d6'],
    }),
    row('F3', { provenance: 'declared',  gates: [3], evidence: 'Recorridos por tareas verificadas implementados y con pruebas de accesibilidad automáticas. Las sesiones moderadas necesitan personas.' }),
    row('F4', { provenance: 'declared',  gates: [3], evidence: 'Un solo vocabulario de seis estados proyectado y mostrado en el tablero. La validación visual necesita personas.' }),
    row('G1', { provenance: 'derived',
        open: openStores.length,
        openLabel: `${openStores.length} lugares donde las palabras del agente descansan sin alcance completo`,
        evidence: `${AGENT_OUTPUT_STORES.length} lugares inventariados con barrido del árbol de fuentes, cada uno diciendo qué lo alcanza y por qué. Abiertos: `
            + `${openStores.map(store => `\`${store.id}\``).join(', ')}.`,
        commits: ['d366baf3'],
    }),
    row('G2', { provenance: 'declared',  gates: [3], evidence: 'Curación y revisión en cuatro idiomas implementadas. La revisión humana de muestra necesita personas.' }),
    row('G3', { provenance: 'declared',  gates: [1], evidence: 'Comparación por runtime y evidencia en seis familias; publicación gradual y retiro implementados.' }),
    row('H1', { provenance: 'executed_evidence', artefact: 'docs/audits/2026-09-09/certification-manifest.md',
        gates: [2],
        evidence: `Ejecutor durable construido: ${certificationTables} tablas, arriendo con \`clock_timestamp()\`, resultado escrito una sola vez, reintento como intento nuevo, presupuesto y deadline verificados antes de entregar trabajo, invalidación por definición de escenario y por autoridad del agente, y el reporte alimentado desde esas filas. El manifiesto de costo por modelo está calculado. Ejecutarlo necesita una credencial y un techo de gasto autorizado.`,
        commits: ['e1ac3943', '4ec45699'],
    }),
    row('H2', { provenance: 'declared',
        gates: [2],
        evidence: 'Regresiones desde QA y ledger, linaje, identidad de misión y denominadores implementados; un resultado desconocido conserva ese estado y no se inventa tasa. Sus denominadores se llenan con la corrida de H1.',
    }),
    row('H3', { provenance: 'executed_evidence', artefact: 'docs/audits/2026-09-09/adversarial-validation.md',
        gates: [4, 1, 3],
        evidence: `Harness local construido: corpus generado y estratificado desde el catálogo con verificadores de resultado, sujetos sintéticos ejecutados, ${benchmarkTables} tablas de intentos y revisión ciega, y una negativa a enunciar comparación cuando falta el otro sujeto. Correr una alternativa necesita su cuenta.`,
        commits: ['aaf41d62'],
    }),
];

// ─── Consistency, checked rather than promised ──────────────────────────────
const contradictions = [];
for (const entry of ROWS) {
    if (entry.status === 'aceptada' && (entry.open > 0 || entry.gates.length)) {
        contradictions.push(`${entry.id}: aceptada con condiciones abiertas`);
    }
    if (entry.status === 'bloqueada' && !entry.gates.length) contradictions.push(`${entry.id}: bloqueada sin gate`);
    if (entry.status === 'abierta' && entry.open <= 0) contradictions.push(`${entry.id}: abierta sin condición`);
    for (const gate of entry.gates) if (!GATES[gate]) contradictions.push(`${entry.id}: gate ${gate} no existe`);
}
if (ROWS.length !== 25) contradictions.push(`la tabla tiene ${ROWS.length} filas y debe tener 25`);
for (const entry of ROWS) {
    if (entry.provenance === 'executed_evidence' && !fs.existsSync(path.join(root, entry.artefact ?? ''))) {
        contradictions.push(`${entry.id}: nombra un artefacto que no existe (${entry.artefact})`);
    }
}
// The programme is not finished while any of these hold, and the document is
// not allowed to imply otherwise.
const finished = ROWS.every(entry => entry.status === 'aceptada') && matrix.summary.certifiedProfiles > 0;

const counts = {
    aceptada: ROWS.filter(entry => entry.status === 'aceptada').length,
    bloqueada: ROWS.filter(entry => entry.status === 'bloqueada').length,
    abierta: ROWS.filter(entry => entry.status === 'abierta').length,
};
const provenance = {
    derived: ROWS.filter(entry => entry.provenance === 'derived').length,
    executed_evidence: ROWS.filter(entry => entry.provenance === 'executed_evidence').length,
    declared: ROWS.filter(entry => entry.provenance === 'declared').length,
};

const state = {
    version: 1, revision, generatedAt: new Date().toISOString(), finished, counts, provenance, contradictions,
    gates: GATES,
    authorities: {
        profiles: matrix.summary.profiles, tasks: matrix.summary.tasks,
        certifiedProfiles: matrix.summary.certifiedProfiles,
        termsFamilies: FAMILY_TERMS_BINDINGS.length,
        unboundCommand: unboundCommand.map(entry => entry.family),
        unboundCharge: unboundCharge.map(entry => entry.family),
        blockedWriterFamilies: blockedFamilies,
        outputStores: AGENT_OUTPUT_STORES.length, openOutputStores: openStores.map(store => store.id),
        channelsSelfService: channels.selfService, channelsCertified: channels.certified,
        routedOperations: routed.length, resolutionDefects,
    },
    rows: ROWS,
};
const jsonPath = path.join(__dirname, 'closure-report.json');
const nextJson = JSON.stringify(state, null, 2) + '\n';
/**
 * `--check` is what CI runs: it regenerates in memory and fails when the
 * committed artefact does not correspond to HEAD. The version of this document
 * that shipped had been generated two commits earlier and nothing noticed.
 * `generatedAt` is excluded from the comparison — it changes every run and is
 * not a fact about the repository.
 */
const CHECK = process.argv.includes('--check');
if (CHECK) {
    const stored = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, 'utf8')) : null;
    // Content, not the label. The revision and the timestamp change on every
    // commit, so comparing them would make this impossible to satisfy: the
    // artefact is regenerated, committed, and that commit moves HEAD past the
    // revision it just recorded. What goes stale is the CONTENT — a counter that
    // moved because somebody closed a gap, a row that changed status — and that
    // is what this compares. The stored revision is printed so drift is visible.
    const strip = value => value && JSON.stringify({ ...value, generatedAt: undefined, revision: undefined });
    if (!stored || strip(stored) !== strip(state)) {
        console.error(`closure-report.json is stale: regenerate it (stored at ${stored?.revision ?? 'missing'})`);
        process.exit(1);
    }
    console.log(`closure-report.json content matches the code (generated at ${stored.revision})`);
    process.exit(0);
}
fs.writeFileSync(jsonPath, nextJson);

const label = entry => entry.status === 'aceptada' ? '**aceptada**'
    : entry.status === 'bloqueada'
        ? `**bloqueada** por gate ${entry.gates.join(' y ')}`
        : '**abierta**';
const lines = [
    '# Estado del programa A1–H3, decidido por el código',
    '',
    'Generado por `docs/audits/2026-09-09/generate-closure-report.cjs`. Cada fila declara una **condición**, y',
    'el estado sale de ella: con una condición local sin cumplir la fila está `abierta`; con la condición',
    'cumplida y un gate externo nombrado está `bloqueada`; sólo sin condición y sin gate está `aceptada`.',
    'Cerrar un hueco cambia esta tabla cambiando el código, y reabrirlo la cambia de vuelta.',
    '',
    `Revisión: \`${revision}\`.`,
    '',
    `**El programa no está terminado.** ${counts.aceptada} filas aceptadas, ${counts.bloqueada} bloqueadas por un`,
    `gate externo concreto y ${counts.abierta} abiertas; ${matrix.summary.certifiedProfiles} perfiles certificados`,
    `de ${matrix.summary.profiles}.`,
    '',
    contradictions.length
        ? `⚠️ Contradicciones detectadas: ${contradictions.join('; ')}.`
        : 'Sin contradicciones: ninguna fila se declara aceptada con una condición abierta o un gate pendiente, '
            + 'ninguna se declara bloqueada sin nombrar el gate y ninguna se declara abierta sin decir qué falta.',
    '',
    '## Los cinco gates externos',
    '',
    ...Object.entries(GATES).map(([id, text]) => `${id}. ${text}.`),
    '',
    '## Las 25 filas',
    '',
    '| ID | Estado | De dónde sale | Qué falta | Evidencia | Commits |',
    '|---|---|---|---|---|---|',
    ...ROWS.map(entry => {
        // An open row that ALSO names a gate says both: the local work is what
        // makes it open, and the gate is what will still be waiting afterwards.
        const missing = entry.status !== 'abierta' ? '—'
            : entry.gates.length ? `${entry.openLabel} (y después, gate ${entry.gates.join(' y ')})`
                : entry.openLabel;
        const source = entry.provenance === 'derived' ? 'contador'
            : entry.provenance === 'executed_evidence' ? `corrida (\`${entry.artefact}\`)`
                : '**declaración**';
        return `| ${entry.id} | ${label(entry)} | ${source} | ${missing} `
            + `| ${entry.evidence} | ${entry.commits.length ? entry.commits.map(hash => `\`${hash}\``).join(' ') : '—'} |`;
    }),
    '',
    '## De dónde sale cada fila',
    '',
    `${provenance.derived} filas salen de un contador leído del código: cerrar el hueco las cambia solo.`,
    `${provenance.executed_evidence} descansan sobre un artefacto de una corrida real, nombrado en la tabla.`,
    `**${provenance.declared} son declaraciones humanas pendientes de revisión**: `
        + `${ROWS.filter(entry => entry.provenance === 'declared').map(entry => entry.id).join(', ')}. `
        + 'Cambiar el código de esas áreas no cambia su estado, y por eso se dicen aparte en vez de '
        + 'presentarse como calculadas.',
    '',
    '## Los contadores de los que sale la tabla',
    '',
    '| Autoridad | Valor |',
    '|---|---:|',
    `| Perfiles del catálogo | ${matrix.summary.profiles} |`,
    `| Tareas | ${matrix.summary.tasks} |`,
    `| Perfiles certificados | ${matrix.summary.certifiedProfiles} |`,
    `| Tareas sin positivo o sin verificador, fuera de las declaradas | ${undeclaredTaskGaps.length} |`,
    `| Familias con términos inventariadas | ${FAMILY_TERMS_BINDINGS.length} |`,
    `| Familias sin comando ligado | ${unboundCommand.length} |`,
    `| Familias sin cobro ligado | ${unboundCharge.length} |`,
    `| Familias de writer bloqueadas | ${blockedFamilies.length} |`,
    `| Lugares donde descansan las palabras del agente | ${AGENT_OUTPUT_STORES.length} |`,
    `| De ellos, abiertos | ${openStores.length} |`,
    `| Canales de autoservicio | ${channels.selfService} |`,
    `| Canales certificados | ${channels.certified} |`,
    `| Operaciones que Assist deriva a una pantalla | ${routed.length} |`,
    `| Defectos en la tabla de resolución de Assist | ${resolutionDefects.length} |`,
    '',
    'Para actualizar: `node docs/audits/2026-09-09/generate-closure-report.cjs` desde la raíz.',
    '',
];
fs.writeFileSync(path.join(__dirname, 'closure-report.md'), lines.join('\n'));
process.stdout.write(JSON.stringify({ counts, finished, contradictions }) + '\n');
