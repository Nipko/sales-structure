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
const {
    ACCEPTED_UNFROZEN, commercialCoverage, commercialReadersWithoutFrozenAuthority,
} = api('modules/evaluation-revision/commercial-reader-inventory.ts');
const {
    RETRIEVAL_CASES, RETRIEVAL_CHALLENGES, RETRIEVAL_LANGUAGES,
} = api('modules/knowledge/evaluation/retrieval-dataset.ts');
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
const { octoberAuthorities, octoberRows } = require('./meta-october-rows.cjs');
const { toolsRows } = require('../2026-09-11/tools-programme-rows.cjs');

/**
 * A list that is empty says so, in a word.
 *
 * `[].join(', ')` is the empty string, and the empty string interpolated into a
 * sentence produces `Sin comando ligado: . Sin cobro ligado: .` and
 * `Abiertos: .` — which is what A1 and G1 said for as long as those rows were
 * green. A reader cannot tell that from a truncated sentence or a generator
 * that half-ran, so the good news arrives looking like a bug. Zero is the
 * interesting case here and it has to be legible.
 */
const listOrNone = (items, none) => items.length ? items.join(', ') : none;

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
/**
 * D2 and E2 used to be `declared` with a hand-written `open: 1`, and both said
 * something that had stopped being true: D2 claimed no dataset, no thresholds
 * and no published numbers while all three existed, and E2 claimed unfrozen
 * commercial readers while every one of them rested on a clock nobody can
 * capture, each accepted with a written reason. A table that says a closed thing
 * is open is the same defect as one that says an open thing is closed — it just
 * fails in the flattering direction on the next row.
 *
 * So both now read the authority the product itself reads.
 */
const retrievalGaps = [
    ...RETRIEVAL_LANGUAGES.filter(language => !RETRIEVAL_CASES.some(row => row.language === language))
        .map(language => `idioma sin caso: ${language}`),
    ...RETRIEVAL_CHALLENGES.filter(challenge => !RETRIEVAL_CASES.some(row => row.challenge === challenge))
        .map(challenge => `desafío sin caso: ${challenge}`),
    ...(fs.existsSync(path.join(root, 'docs/runbooks/rag-quality-and-slo.md')) ? [] : ['runbook sin publicar']),
];

/**
 * The October programme's counters, computed the same way as the rest: from the
 * modules the product runs and from a census of the source tree, never from a
 * sentence. They are asked once here so a row cannot quietly re-derive one and
 * get a different answer than the row beside it.
 */
const october = octoberAuthorities({ root, api, shared });

const coverage = commercialCoverage();
const unexplainedUnfrozen = commercialReadersWithoutFrozenAuthority()
    .filter(reader => reader.unfrozen.some(token => !(token in ACCEPTED_UNFROZEN)));

const GATES = {
    1: 'credenciales y cuentas de canal para pilotos reales (WhatsApp, Instagram, Messenger, Telegram)',
    2: 'credenciales de proveedor LLM, modelo, techo de gasto y autorización de ejecución',
    3: 'personas nuevas reclutadas para sesiones moderadas',
    4: 'cuentas autorizadas de alternativas y revisores ciegos',
    5: 'autorización posterior para push, despliegue, migración y activación',
    6: 'cuenta WABA, número, moneda, tarjeta, financiación, permisos y plantillas reales',
    7: 'destinatario consentido, presupuesto y autorización de llamadas a Meta',
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
/**
 * ═══ A FOURTH STATE, BECAUSE THREE WERE FORCING A LIE ═══
 *
 * `abierta` means somebody still has local work. `bloqueada` means the work
 * is done and an external gate holds it. `aceptada` means it is finished.
 *
 * M6 is none of those. Advanced marketing, Direct Send, calls, groups and the
 * resale wallet are NOT BUILT and are outside October's scope by an explicit
 * decision. Reporting that as `abierta` keeps a release open for ever on
 * scope somebody deliberately removed from it; reporting it as `aceptada`
 * would call unbuilt functionality done, which is the worse of the two;
 * omitting the row reads as closed, and this table already learned that a
 * row nobody prints is a row everybody assumes is fine.
 *
 * So `deferred` is its own status, and it is the only one that REQUIRES a
 * decision, an owner and a reopening condition. A deferral with nobody's
 * name on it is a wish, and one with no condition is an abandonment.
 */
const row = (id, { open = 0, openLabel = '', gates = [], evidence, commits = [], provenance,
    artefact = null, deferral = null }) => {
    if (!['derived', 'executed_evidence', 'declared'].includes(provenance)) {
        throw new Error(`row ${id}: provenance must be declared explicitly`);
    }
    if (deferral) {
        for (const field of ['decision', 'owner', 'reopenWhen']) {
            if (!String(deferral[field] ?? '').trim()) {
                throw new Error(`row ${id}: a deferral needs ${field}; `
                    + 'without it this is an abandonment wearing a status');
            }
        }
        if (Number(open) > 0) {
            throw new Error(`row ${id}: a deferred row may not also report open local work`);
        }
    }
    return {
        id,
        open: Number(open),
        openLabel,
        gates,
        status: deferral ? 'diferida'
            : Number(open) > 0 ? 'abierta' : gates.length ? 'bloqueada' : 'aceptada',
        provenance,
        artefact,
        evidence,
        commits,
        deferral,
    };
};

const ROWS = [
    row('A1', { provenance: 'derived',
        open: unboundCommand.length + unboundCharge.length,
        openLabel: `${unboundCommand.length} familias sin comando ligado y ${unboundCharge.length} sin cobro ligado`,
        evidence: `Inventario calculado de ${FAMILY_TERMS_BINDINGS.length} familias `
            + `(\`terms-binding-inventory.ts\`). Cita y matrícula ligan comando y cobro; el pedido de catálogo pasó a `
            + `cobrar desde \`orders.catalog_terms\` y a rechazar la fila que no acordó nada. Sin comando ligado: `
            + `${listOrNone(unboundCommand.map(entry => `\`${entry.family}\``), 'ninguna')}. Sin cobro ligado: `
            + `${listOrNone(unboundCharge.map(entry => `\`${entry.family}\``), 'ninguna')}.`,
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
    row('D2', { provenance: 'derived',
        open: retrievalGaps.length,
        openLabel: `${retrievalGaps.length} huecos en el dataset de recuperación o en sus números publicados`,
        gates: retrievalGaps.length ? [] : [2],
        evidence: `${RETRIEVAL_CASES.length} casos etiquetados que cubren los ${RETRIEVAL_LANGUAGES.length} idiomas y `
            + `los ${RETRIEVAL_CHALLENGES.length} desafíos declarados, con umbrales barridos y números publicados en `
            + '`docs/runbooks/rag-quality-and-slo.md`. Lo que queda no es local: el entailment semántico necesita el '
            + 'modelo real, así que la fila pasa de abierta a bloqueada por el gate de LLM en vez de aceptarse '
            + 'con la mitad medida.',
        commits: ['f2a6a2e8', '7a9e7c18', '71387107'],
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
    row('E2', { provenance: 'derived',
        open: unexplainedUnfrozen.length,
        openLabel: `${unexplainedUnfrozen.length} lecturas comerciales que descansan en algo sin congelar y sin motivo escrito`,
        evidence: `${coverage.commercial} de ${coverage.readers} grupos son comerciales y ${coverage.frozen} tienen `
            + `su autoridad congelada entera. Las ${coverage.unfrozen} restantes descansan únicamente en los `
            + `${Object.keys(ACCEPTED_UNFROZEN).length} relojes aceptados con motivo escrito `
            + `(${Object.keys(ACCEPTED_UNFROZEN).join(', ')}), ninguno de los cuales se puede capturar: lo que los `
            + 'cierra es que el resultado viaje con el instante en que se tomó. La mitad concurrente la prueba '
            + '`commercial-authority.postgres.spec.ts` contra PostgreSQL real, con dos tenants y dos workers.',
        commits: ['33dd2487'],
    }),
    row('E3', { provenance: 'declared',  gates: [5, 1], evidence: 'Outbox durable obligatorio, transporte estricto, recuperación, reconciliación con actor y evidencia, pantalla de operador y alerta real. El ajuste heredado dispatch.normalOutbox sólo delimita la evidencia del canario; no puede devolver una respuesta al carril eliminado.' }),
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
            + `${listOrNone(openStores.map(store => `\`${store.id}\``), 'ninguno')}.`,
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

/**
 * M0–M6 and R0–R6, appended rather than kept in a second table.
 *
 * A second report with its own rules is how two documents about one repository
 * come to disagree — which is exactly what happened: this generator said zero
 * rows open while an independent review put the October programme at about 45%,
 * because this generator was not measuring that programme at all. One table,
 * one row constructor, one contradiction check.
 */
ROWS.push(...octoberRows(row, october));

/**
 * T1-T6, the tools programme, in the SAME table for the same reason.
 *
 * It had a generated audit and no row, so its state lived in prose -- the
 * arrangement that produced the October disagreement, where this generator
 * reported zero rows open while an independent review put the programme at
 * about forty-five per cent, because this generator was not measuring it.
 */
const toolAudit = JSON.parse(fs.readFileSync(
    path.join(root, 'docs/audits/2026-09-11/tool-profile-audit.json'), 'utf8'));
ROWS.push(...toolsRows(row, toolAudit));

// ─── Consistency, checked rather than promised ──────────────────────────────
/**
 * ═══ THE SWEEP THAT COULD NOT FAIL, AND WHAT REPLACED IT ═══
 *
 * The first version of this block asked three questions of the rows it had just
 * built: `aceptada` with an open condition, `bloqueada` with no gate, `abierta`
 * with no condition. `row()` derives `status` from exactly `open` and `gates`,
 * so all three were unsatisfiable by construction — and the document reported
 * the result as a finding ("Sin contradicciones: ninguna fila se declara
 * aceptada con una condición abierta...") while a release note leaned on it. A
 * check that cannot fail is not evidence; it is a sentence with the shape of
 * one, which is worse than no sentence because it consumes the reader's trust.
 *
 * Two things changed.
 *
 *  · The predicates became a function over ROWS, so the same sweep also runs
 *    over the rows PARSED BACK from the committed artefact. There `status` is a
 *    stored string nobody recomputed, so recomputing it can disagree: a row
 *    hand-edited to read `aceptada`, a gate renumbered out from under a row, a
 *    status left behind by a half-finished regeneration.
 *  · Predicates were added about what a row SAYS rather than about how it was
 *    built, and those a freshly constructed row can violate too: an `abierta`
 *    row whose `openLabel` is empty renders an empty "Qué falta" cell, and a
 *    figure that failed to resolve renders the word `undefined` — which is
 *    exactly what M2 did, for as long as this artefact existed, without a
 *    single check noticing.
 */
const UNRESOLVED = /\b(undefined|NaN)\b/;
function contradictionsIn(rows) {
    const found = [];
    for (const entry of rows) {
        const gates = Array.isArray(entry.gates) ? entry.gates : [];
        // Recomputed from the row's own conditions rather than read off it.
        // Over freshly built rows this restates the constructor; over the rows
        // read back from the artefact it is the only thing standing between a
        // reader and a status somebody typed.
        // A deferral is the one status that cannot be derived from open and
        // gates, because it is a DECISION rather than a measurement. So it is
        // checked against what a deferral must carry instead: without a
        // decision, an owner and a reopening condition it is an abandonment
        // wearing a status, and it may never also report open local work.
        const deferral = entry.deferral;
        if (deferral) {
            for (const field of ['decision', 'owner', 'reopenWhen']) {
                if (!String(deferral[field] ?? '').trim()) {
                    found.push(`${entry.id}: está diferida y no dice ${field}`);
                }
            }
            if (Number(entry.open) > 0) {
                found.push(`${entry.id}: está diferida y además reporta trabajo local abierto`);
            }
            if (entry.status !== 'diferida') {
                found.push(`${entry.id}: lleva una decisión de diferimiento y su estado dice `
                    + `\`${entry.status}\``);
            }
            continue;
        }
        const expected = Number(entry.open) > 0 ? 'abierta' : gates.length ? 'bloqueada' : 'aceptada';
        if (entry.status !== expected) {
            found.push(`${entry.id}: el artefacto dice \`${entry.status}\` y sus condiciones `
                + `(open=${entry.open}, gates=${gates.length}) dan \`${expected}\``);
        }
        // An open row that does not say what is missing prints an empty cell,
        // and an empty cell reads as "nothing missing" — the opposite.
        if (expected === 'abierta' && !String(entry.openLabel ?? '').trim()) {
            found.push(`${entry.id}: abierta sin decir qué falta`);
        }
        for (const gate of gates) if (!GATES[gate]) found.push(`${entry.id}: gate ${gate} no existe`);
        for (const [field, text] of [['openLabel', entry.openLabel], ['evidence', entry.evidence]]) {
            if (UNRESOLVED.test(String(text ?? ''))) {
                // The token itself is deliberately NOT repeated in this message:
                // it ends up in the rendered document, where the sweep below
                // would trip over the warning about the trip.
                found.push(`${entry.id}: el campo \`${field}\` interpola una cifra que no resolvió; `
                    + 'la autoridad de la que sale no existe o cambió de nombre');
            }
        }
        if (entry.provenance === 'executed_evidence'
            && !fs.existsSync(path.join(root, entry.artefact ?? ''))) {
            found.push(`${entry.id}: nombra un artefacto que no existe (${entry.artefact})`);
        }
    }
    /**
     * Una fila por programa, contada por su prefijo.
     *
     * Era un 39 escrito a mano, y una tanda que agregaba un programa entero
     * tenía que editar el número para que el generador volviera a correr — lo
     * que convierte el guardarraíl en un trámite. Ahora cada grupo declara
     * cuántas filas tiene y el total se deriva: agregar una fila sin declararla
     * sigue siendo rojo, que es lo que el guardarraíl existía para hacer.
     */
    const GROUPS = [
        { name: 'A1–H3', test: id => /^[A-H]\d/.test(id), expected: 25 },
        { name: 'M0–M6/R0–R6', test: id => /^[MR]\d/.test(id), expected: 14 },
        { name: 'T1–T7', test: id => /^T\d/.test(id), expected: 7 },
    ];
    let accounted = 0;
    for (const group of GROUPS) {
        const actual = rows.filter(entry => group.test(entry.id)).length;
        accounted += actual;
        if (actual !== group.expected) {
            found.push(`el grupo ${group.name} tiene ${actual} filas y debe tener ${group.expected}`);
        }
    }
    if (accounted !== rows.length) {
        found.push(`la tabla tiene ${rows.length} filas y sólo ${accounted} pertenecen a un `
            + 'grupo declarado; una fila sin grupo no la cuenta nadie');
    }
    // Every id exactly once. Two rows with one id is how a table reports a status
    // twice and a reader takes whichever they saw first.
    const seenIds = new Set();
    for (const entry of rows) {
        if (seenIds.has(entry.id)) found.push(`${entry.id}: la fila aparece dos veces`);
        seenIds.add(entry.id);
    }
    return found;
}
const contradictions = contradictionsIn(ROWS);
// The programme is not finished while any of these hold, and the document is
// not allowed to imply otherwise.
const finished = ROWS.every(entry => entry.status === 'aceptada') && matrix.summary.certifiedProfiles > 0;

const counts = {
    aceptada: ROWS.filter(entry => entry.status === 'aceptada').length,
    bloqueada: ROWS.filter(entry => entry.status === 'bloqueada').length,
    abierta: ROWS.filter(entry => entry.status === 'abierta').length,
    diferida: ROWS.filter(entry => entry.status === 'diferida').length,
};
/**
 * Every row lands in exactly one bucket.
 *
 * Adding `diferida` without adding it here left one row counted nowhere, so the
 * four numbers summed to forty-four over a forty-five row table -- and the
 * missing one was the row about scope somebody had deliberately removed, which
 * is precisely the row a reader would want to find.
 */
const counted = counts.aceptada + counts.bloqueada + counts.abierta + counts.diferida;
if (counted !== ROWS.length) {
    throw new Error(`los estados suman ${counted} sobre ${ROWS.length} filas; `
        + 'hay un estado que nadie cuenta');
}
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
        egressCallSites: october.rows.length,
        chargeableCallSites: october.billable.length,
        chargeableOutsideGate: october.bypasses.length,
        chargeableOffDurableLane: october.offDurable.length,
        chargeableOffDurableByLane: october.byLane,
        censusArtefactStale: october.censusStale,
        proactivePolicies: october.policies,
        dispatchItemKinds: october.itemKinds,
        spendScopes: october.spendScopes,
        restShapesWithoutDurableItem: october.unrepresentable,
    },
    rows: ROWS,
};
const jsonPath = path.join(__dirname, 'closure-report.json');
const mdPath = path.join(__dirname, 'closure-report.md');
const nextJson = JSON.stringify(state, null, 2) + '\n';

/**
 * The rendered state, which has to be the STORED state.
 *
 * This chain fell through to `**abierta**` for anything it did not name, so
 * the moment `diferida` existed the JSON counted one deferral and the table a
 * reader actually opens printed it as open local work. A fourth state added to
 * stop a release staying open for ever, rendering as the state it replaced.
 *
 * So the default is an ERROR now. A fifth state will fail loudly here instead
 * of quietly borrowing the meaning of the fourth.
 */
const label = entry => {
    if (entry.status === 'aceptada') return '**aceptada**';
    if (entry.status === 'bloqueada') return `**bloqueada** por gate ${entry.gates.join(' y ')}`;
    if (entry.status === 'abierta') return '**abierta**';
    if (entry.status === 'diferida') return '**diferida** por decisión de alcance';
    throw new Error(`row ${entry.id}: el estado \`${entry.status}\` no se sabe imprimir`);
};
const lines = [
    '# Estado de los programas A1–H3 y M0–M6/R0–R6, decidido por el código',
    '',
    'Generado por `docs/audits/2026-09-09/generate-closure-report.cjs`. Cada fila declara una **condición**, y',
    'el estado sale de ella: con una condición local sin cumplir la fila está `abierta`; con la condición',
    'cumplida y un gate externo nombrado está `bloqueada`; sólo sin condición y sin gate está `aceptada`.',
    'Cerrar un hueco cambia esta tabla cambiando el código, y reabrirlo la cambia de vuelta.',
    '',
    `Revisión: \`${revision}\`.`,
    '',
    `**El programa no está terminado.** ${counts.aceptada} filas aceptadas, ${counts.bloqueada} bloqueadas por un`,
    `gate externo concreto, ${counts.abierta} abiertas y ${counts.diferida} diferidas por decisión`,
    `explícita de alcance; ${matrix.summary.certifiedProfiles} perfiles certificados`,
    `de ${matrix.summary.profiles}.`,
    '',
    contradictions.length
        ? `⚠️ Contradicciones detectadas: ${contradictions.join('; ')}.`
        : `Sin contradicciones en las ${ROWS.length} filas: a cada una se le recalculó el estado a partir `
            + 'de sus propias condiciones, ninguna fila abierta deja de decir qué falta, ningún gate '
            + 'nombrado falta de la lista, ninguna cifra quedó sin resolver y todo artefacto citado '
            + 'existe.',
    '',
    // Said out loud because the previous version of this line was not true of
    // anything: over una fila recién construida el estado SALE del constructor,
    // así que compararlo con el constructor no puede fallar. Lo que le da fuerza
    // es la segunda pasada, sobre el artefacto releído del disco.
    'Ese barrido corre dos veces: sobre las filas recién construidas y otra vez sobre las filas '
        + 'releídas del artefacto versionado, donde el estado es una cadena guardada que nadie '
        + 'recalculó. La primera pasada, sola, no podría fallar — el constructor deriva el estado de '
        + 'las mismas condiciones con las que se lo compara — y por eso no se presenta sola.',
    '',
    '## Los gates externos',
    '',
    ...Object.entries(GATES).map(([id, text]) => `${id}. ${text}.`),
    '',
    '## Las filas',
    '',
    '| ID | Estado | De dónde sale | Qué falta | Evidencia | Commits |',
    '|---|---|---|---|---|---|',
    ...ROWS.map(entry => {
        // An open row that ALSO names a gate says both: the local work is what
        // makes it open, and the gate is what will still be waiting afterwards.
        // A deferred row prints its reopening condition here. `—` in this
        // column reads as "nothing missing", which for a deferral is the
        // opposite of true: what is missing is an authorisation, and the
        // whole point of the state is that somebody can see the condition
        // that brings the scope back.
        const missing = entry.status === 'diferida'
            ? `diferida por ${entry.deferral.owner}; se reabre cuando ${entry.deferral.reopenWhen}`
            : entry.status !== 'abierta' ? '—'
                : entry.gates.length
                    ? `${entry.openLabel} (y después, gate ${entry.gates.join(' y ')})`
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
    `| Call sites de egress censados | ${october.rows.length} |`,
    `| De ellos, cobrables | ${october.billable.length} |`,
    `| Cobrables fuera del gate económico | ${october.bypasses.length} |`,
    `| Cobrables fuera del carril durable | ${october.offDurable.length} |`,
    `| Productores declarados en el inventario de efectos | ${october.producers.length} |`,
    `| De ellos, con alguna propiedad en \`none\` | ${october.effects.uncovered.length} |`,
    `| Políticas proactivas registradas | ${october.policies.length} |`,
    `| Tipos de item que el carril durable transporta | ${october.itemKinds.length} |`,
    `| Alcances de gasto | ${october.spendScopes.length} |`,
    `| Entregas de servicio gratuitas por número y mes | ${october.freeAllowance} |`,
    '',
    'Para actualizar: `node docs/audits/2026-09-09/generate-closure-report.cjs` desde la raíz.',
    '',
];
const nextMarkdown = lines.join('\n');

/**
 * Last stop before anything is written or compared: a figure that did not
 * resolve.
 *
 * `contradictionsIn` catches it inside a row, but the document says numbers
 * outside the rows too — the counter table at the bottom is a plain
 * interpolation of `october.*`, and that is where `| Entregas de servicio
 * gratuitas por número y mes | undefined |` was printed. So the RENDERED text
 * is swept as well: whatever path produced it, a report is not allowed to tell
 * a reader `undefined`.
 *
 * The revision line is exempt because it is a SHA, and the word `NaN` can occur
 * inside one.
 */
const unresolvedLines = nextMarkdown.split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => !line.startsWith('Revisión: `') && UNRESOLVED.test(line));
if (unresolvedLines.length) {
    console.error('el informe renderizó una cifra sin resolver; no se escribe:');
    for (const { line, number } of unresolvedLines) console.error(`  línea ${number}: ${line.trim()}`);
    process.exit(1);
}

/**
 * `--check` is what CI runs: it regenerates in memory and fails when a committed
 * artefact does not correspond to HEAD. The version of this document that
 * shipped had been generated two commits earlier and nothing noticed.
 * `generatedAt` is excluded from the comparison — it changes every run and is
 * not a fact about the repository.
 *
 * ── AND THE MARKDOWN, WHICH IS THE FILE PEOPLE ACTUALLY READ ────────────────
 *
 * This block used to `process.exit(0)` here, BEFORE the markdown was built
 * fifteen lines below, so `closure-report.md` was verified by nothing at all:
 * `verify-artifacts.cjs` shells this script with `--check`, this script checked
 * the JSON and left. A markdown edited by hand — or simply left behind by a run
 * that wrote the JSON and died — passed every gate in the repository. So the
 * markdown is rebuilt and compared too, which is the only comparison that
 * covers the document the release note quotes.
 */
const CHECK = process.argv.includes('--check');
if (CHECK) {
    const stored = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, 'utf8')) : null;
    // The rows as the ARTEFACT carries them, swept BEFORE the staleness
    // comparison — order matters. A hand-edited status also makes the artefact
    // differ from this run, so comparing first would answer every such edit
    // with "regenerate it" and never once say what was actually wrong with the
    // file somebody is reading.
    const storedContradictions = contradictionsIn(stored?.rows ?? []);
    if (stored && storedContradictions.length) {
        console.error(`closure-report.json carries contradictory rows: ${storedContradictions.join('; ')}`);
        process.exit(1);
    }
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
    // The same two exemptions as the JSON, and one more: `core.autocrlf` is
    // true on the Windows checkouts this is developed on and false on CI, so a
    // byte comparison would disagree between the two about a file neither
    // machine changed.
    const comparable = text => text.split('\r\n').join('\n').split('\n')
        .map(line => line.startsWith('Revisión: `') ? 'Revisión: `<sha>`.' : line).join('\n');
    const storedMarkdown = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : null;
    if (storedMarkdown === null || comparable(storedMarkdown) !== comparable(nextMarkdown)) {
        console.error('closure-report.md is stale: regenerate it (el markdown versionado no es el que '
            + 'este HEAD produce)');
        process.exit(1);
    }
    console.log(`closure-report.json and closure-report.md match the code (generated at ${stored.revision})`);
    process.exit(0);
}
fs.writeFileSync(jsonPath, nextJson);
fs.writeFileSync(mdPath, nextMarkdown);

/**
 * The sweep again, over what is now on disk.
 *
 * Writing and then verifying looks redundant next to verifying what is in
 * memory, and is not: `JSON.stringify` drops `undefined` fields and turns a
 * `Map` or a `BigInt` into something else or into an exception, so the rows a
 * reader gets are not always the rows this process held. Reading them back is
 * the only way to sweep the artefact rather than the intention.
 */
const writtenContradictions = contradictionsIn(JSON.parse(fs.readFileSync(jsonPath, 'utf8')).rows);
if (writtenContradictions.length) {
    console.error(`el artefacto escrito contiene contradicciones: ${writtenContradictions.join('; ')}`);
    process.exit(1);
}
process.stdout.write(JSON.stringify({ counts, finished, contradictions }) + '\n');
