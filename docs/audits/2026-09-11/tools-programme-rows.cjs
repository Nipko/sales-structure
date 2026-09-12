/*
 * ═══ T1–T6: THE TOOLS PROGRAMME, MEASURED THE WAY M0–M6 IS ═══
 *
 * The tools programme had a generated audit — 20 verticals, 76 profiles, 123
 * static tools, 268 tasks — and no row in the closure table. So its state lived
 * in prose, which is the arrangement that produced the October disagreement:
 * one document saying zero rows open and an independent review saying forty-five
 * per cent, both about the same repository, and a reader with no way to tell.
 *
 * These rows read the same authorities the product reads. A row may report a
 * counter; it may not decide that a counter is acceptable, and no sentence
 * written here can close one.
 *
 * ── WHAT A ROW MAY NOT BE BUILT FROM ────────────────────────────────────────
 *
 * Not prose, not a file count, and not the existence of a test. `open` is a
 * number produced by reading a declared authority or the source itself, and if
 * the reading cannot be made mechanical the row says `declared` and carries the
 * condition that would settle it.
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(ROOT, rel));

/**
 * A derivation whose source moved must STOP, not report zero.
 *
 * The first version of this file guessed two paths. One was wrong, so the
 * control sweep found no contract and reported "1 control without a consumer:
 * contract not found"; the other parsed `DISCOVERY_ORDER` with a single-quote
 * regular expression against a list written in double quotes, found nothing,
 * and reported "0 of 0 items without a tour" — an ACCEPTED row, derived from
 * an empty list. A green produced by a broken reading is worse than a red,
 * because a red gets fixed.
 */
function mustFind(value, what) {
    if (value === null || value === undefined || (Array.isArray(value) && !value.length)) {
        throw new Error(`tools rows: ${what} — la derivación no encontró su fuente, `
            + 'y una fila no puede quedar en cero porque su lectura se rompió');
    }
    return value;
}

function unwrapExpression(node) {
    let current = node;
    while (current && (ts.isAsExpression(current) || ts.isParenthesizedExpression(current)
        || ts.isSatisfiesExpression(current) || ts.isTypeAssertionExpression(current))) {
        current = current.expression;
    }
    if (current && ts.isCallExpression(current) && current.arguments.length === 1) {
        return unwrapExpression(current.arguments[0]);
    }
    return current;
}

function propertyName(node) {
    if (!node) return '';
    if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
    return '';
}

/** Read the live authority register; one non-null divergence is one open T2 correction. */
function readinessDivergenceGaps(source = read('apps/api/src/common/utils/readiness-predicate-authority.util.ts')) {
    const tree = ts.createSourceFile('readiness-predicate-authority.util.ts', source,
        ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let registry = null;
    const visit = node => {
        if (ts.isVariableDeclaration(node) && propertyName(node.name) === 'READINESS_PREDICATE_AUTHORITY') {
            registry = unwrapExpression(node.initializer);
        }
        ts.forEachChild(node, visit);
    };
    visit(tree);
    if (!registry || !ts.isObjectLiteralExpression(registry)) {
        mustFind(null, 'el objeto READINESS_PREDICATE_AUTHORITY');
    }
    const entries = [];
    const gaps = [];
    for (const member of registry.properties) {
        if (!ts.isPropertyAssignment(member)) continue;
        const key = propertyName(member.name);
        const body = unwrapExpression(member.initializer);
        if (!key || !body || !ts.isObjectLiteralExpression(body)) continue;
        entries.push(key);
        const divergence = body.properties.find(prop => ts.isPropertyAssignment(prop)
            && propertyName(prop.name) === 'divergence');
        if (!divergence || !ts.isPropertyAssignment(divergence)) {
            throw new Error(`tools rows: ${key} no declara divergence; T2 no puede inferir silencio como conformidad`);
        }
        if (unwrapExpression(divergence.initializer).kind !== ts.SyntaxKind.NullKeyword) gaps.push(key);
    }
    mustFind(entries, 'las entradas de READINESS_PREDICATE_AUTHORITY');
    return gaps;
}

/** Structural proof that Assist gets executable operations from the enforcing service. */
function assistOperationAuthorityGaps(source = read('apps/api/src/modules/copilot/copilot.service.ts')) {
    const tree = ts.createSourceFile('copilot.service.ts', source,
        ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let importsAuthority = false;
    let injectsAuthority = false;
    let callsAuthority = false;
    let derivesCreatable = false;
    let readsProvisioningCapabilities = false;
    const textOf = node => source.slice(node.getStart(tree), node.end);
    const visit = node => {
        if (ts.isImportDeclaration(node) && node.moduleSpecifier.getText(tree).includes('agent-content-proposal.service')) {
            importsAuthority = textOf(node).includes('AgentContentProposalService');
        }
        if (ts.isParameter(node) && propertyName(node.name) === 'operations'
            && node.type?.getText(tree).includes('AgentContentProposalService')) injectsAuthority = true;
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
            && node.expression.name.text === 'listOperations'
            && node.expression.expression.getText(tree) === 'this.operations') callsAuthority = true;
        if (ts.isVariableDeclaration(node) && propertyName(node.name) === 'creatableOperations'
            && node.initializer && textOf(node.initializer).includes('operationVerdicts')) derivesCreatable = true;
        if (ts.isPropertyAccessExpression(node) && node.name.text === 'effectiveCapabilities') {
            readsProvisioningCapabilities = true;
        }
        ts.forEachChild(node, visit);
    };
    visit(tree);
    const gaps = [];
    if (!importsAuthority) gaps.push('Assist no importa AgentContentProposalService');
    if (!injectsAuthority) gaps.push('Assist no inyecta AgentContentProposalService');
    if (!callsAuthority) gaps.push('Assist no consulta listOperations');
    if (!derivesCreatable) gaps.push('Assist no deriva las operaciones ejecutables del veredicto compartido');
    if (readsProvisioningCapabilities) gaps.push('Assist vuelve a leer effectiveCapabilities como autoridad paralela');
    return gaps;
}

/**
 * Every configurable control the business-profile contract declares, paired
 * with whether anything OUTSIDE the contract, the editor and the tests reads it.
 *
 * A flag that only its own schema and its own form mention is a control the
 * owner can switch with no consequence — which is worse than an absent one,
 * because the screen says it did something.
 */
function controlsWithoutConsumer(contractSource, productiveFiles) {
    /**
     * PER FAMILY, not per flag name.
     *
     * The first version asked whether ANY productive file mentioned the flag.
     * `emailConfirmations` is declared by eighteen families and read by three,
     * so one consumer made the sweep report zero orphans — an ACCEPTED row over
     * fifteen controls an owner can switch with no consequence. A flag name is
     * not a control; the pair (family, flag) is.
     */
    const families = [];
    const FAMILY = /^ {4}([a-zA-Z][\w]*)\??\s*:\s*\{/gm;
    let match;
    while ((match = FAMILY.exec(contractSource)) !== null) {
        let depth = 1;
        let i = FAMILY.lastIndex;
        while (depth > 0 && i < contractSource.length) {
            if (contractSource[i] === '{') depth += 1;
            else if (contractSource[i] === '}') depth -= 1;
            i += 1;
        }
        families.push({ name: match[1], body: contractSource.slice(FAMILY.lastIndex, i) });
    }
    mustFind(families, 'las familias configurables del contrato');

    const orphaned = [];
    for (const family of families) {
        for (const flagMatch of family.body.matchAll(/\b(can[A-Z]\w+|[a-z]\w*Confirmations)\b\s*\??\s*:/g)) {
            const flag = flagMatch[1];
            // A consumer names BOTH: the family whose configuration it reads and
            // the flag it acts on. A file that mentions the flag for another
            // family proves nothing about this one.
            const consumed = productiveFiles.some(file =>
                file.text.includes(flag) && file.text.includes(family.name));
            if (!consumed) orphaned.push(`${family.name}.${flag}`);
        }
    }
    return orphaned;
}

/** Files that can actually act on a flag: not the contract, not a form, not a test. */
function productiveSources() {
    // Every API module, because a control's consumer is wherever the effect is
    // produced — appointments, tours, properties, orders — and guessing a short
    // list is how a real consumer gets counted as absent.
    const roots = ['apps/api/src/modules'];
    const out = [];
    const walk = dir => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!entry.name.endsWith('.ts')) continue;
            if (entry.name.includes('.spec.') || entry.name.endsWith('.d.ts')) continue;
            // The contract declares; it does not consume.
            if (entry.name.includes('agent-configuration-contract')) continue;
            out.push({ rel: path.relative(ROOT, full), text: fs.readFileSync(full, 'utf8') });
        }
    };
    for (const r of roots) walk(path.join(ROOT, r));
    return out;
}

/**
 * Does the assessment hand the evidence reader an authoritative scope?
 *
 * Read from the call rather than from a comment. Without a scope the reader
 * cannot recognise evidence produced under the current configuration, so every
 * intent stays `not_verified` for ever — which looks identical, from the
 * outside, to an agent nobody has tested.
 */
function evidenceScopeWired() {
    const REL = 'apps/api/src/modules/copilot/agent-assessment.service.ts';
    if (!exists(REL)) return { wired: false, detail: 'assessment service missing' };
    const text = read(REL);
    const call = /intentEvidence\(([^;]*?)\)\s*;/s.exec(text);
    if (!call) return { wired: false, detail: 'assessment does not call intentEvidence at all' };
    const args = call[1];
    const wired = /scope|Scope/.test(args);
    return {
        wired,
        detail: wired
            ? 'the assessment passes a scope to intentEvidence'
            : `intentEvidence is called with no scope: ${args.replace(/\s+/g, ' ').trim().slice(0, 120)}`,
    };
}

/**
 * Items a business can reach in discovery, against items the tour can explain.
 *
 * An item that appears in the dashboard and not in the tour is a screen the
 * owner is sent to with no explanation of what it is for, what it needs, what
 * it can confirm or what it costs.
 */
function tourCoverageGaps() {
    const RESOLVER = 'apps/dashboard/src/lib/vertical-dashboard-resolver.ts';
    if (!exists(RESOLVER)) return { missing: ['resolver missing'], discovery: 0 };
    const resolver = read(RESOLVER);
    const block = mustFind(
        /const DISCOVERY_ORDER[^=]*=\s*\[([\s\S]*?)\];/.exec(resolver),
        'DISCOVERY_ORDER en vertical-dashboard-resolver.ts');
    // Double OR single quotes: the list is written with double, and a regular
    // expression that only knew single ones reported an empty universe as an
    // accepted row.
    const discovery = mustFind(
        [...block[1].matchAll(/["']([A-Za-z][\w]*)["']/g)].map(m => m[1]),
        'los elementos de DISCOVERY_ORDER');

    // The tour's own per-item table, wherever it lives.
    const candidates = [
        'apps/dashboard/src/app/admin/setup-wizard/_components/ToolsTour.tsx',
    ].filter(exists);
    mustFind(candidates, 'el componente del tour (ToolsTour)');
    const tour = candidates.map(read).join('\n');
    // The per-item table itself, not every `key:` in the file -- a component
    // is full of object literals, and sweeping all of them would mark every
    // item covered: the same false green this function already produced once.
    const table = mustFind(/A_BY_ITEM[^=]*=\s*\{([\s\S]*?)\n\s*\};/.exec(tour),
        'la tabla A_BY_ITEM dentro de ToolsTour');
    const covered = new Set([...table[1].matchAll(/^\s*["']?([A-Za-z][\w]*)["']?\s*:/gm)]
        .map(m => m[1]));
    return {
        missing: discovery.filter(item => !covered.has(item)),
        discovery: discovery.length,
    };
}

/**
 * The rows, built with the closure report's own constructor so one table and
 * one contradiction check cover the whole programme.
 */
/**
 * Is the tools programme WIRED INTO the closure machinery?
 *
 * T7's own condition, and the one that can be satisfied by writing a
 * document instead of a gate — which is how the tool-profile artefact went
 * stale without stopping a release. So it is read from three places that
 * would each have to be edited to break it:
 *
 *   · the generator is one of the entries `verify-artifacts.cjs` iterates,
 *     which is the single shared authority the workflows call;
 *   · each of `candidate`, `deploy` and `vertical-quality` invokes that
 *     verifier rather than its own copy of the list;
 *   · the T rows exist in this module, so the closure table reports the
 *     programme at all.
 *
 * A missing piece is named, never counted as a bare number: "1 pendiente"
 * on a wiring row sends the reader looking through three files.
 */
function closureWiring(rowIds, io = { read, exists }) {
    // The reader is a parameter so a test can DROP one of the three
    // pieces and see the row go red, without writing a mutated workflow
    // to disk in a repository where a concurrent stage is a recorded
    // incident. Defaults to the real tree.
    const { read, exists } = io;
    const missing = [];
    const verifier = 'docs/audits/2026-09-09/verify-artifacts.cjs';
    const verifierSource = exists(verifier) ? read(verifier) : '';
    if (!verifierSource) {
        mustFind(null, 'el verificador compartido de artefactos');
    }
    if (!verifierSource.includes('2026-09-11/generate-tool-profile-audit.cjs')) {
        missing.push('el verificador compartido no ejecuta generate-tool-profile-audit');
    }
    for (const workflow of ['candidate', 'deploy', 'vertical-quality']) {
        const rel = `.github/workflows/${workflow}.yml`;
        if (!exists(rel)) { missing.push(`falta el workflow ${workflow}`); continue; }
        if (!read(rel).includes('verify-artifacts.cjs')) {
            missing.push(`${workflow} no llama al verificador compartido`);
        }
    }
    const expected = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
    for (const id of expected) {
        if (!rowIds.includes(id)) missing.push(`la tabla de cierre no reporta ${id}`);
    }
    return missing;
}

function toolsRows(row, audit) {
    const summary = audit?.summary ?? {};
    const coverage = summary.taskCoverage ?? {};

    // The configurable surface really lives in the agent-configuration contract.
    const contractRel = mustFind(
        ['packages/shared/src/index.ts'].find(exists),
        'el contrato ToolsConfig en packages/shared/src/index.ts');
    const orphanedControls = controlsWithoutConsumer(read(contractRel), productiveSources());

    const scope = evidenceScopeWired();
    const tours = tourCoverageGaps();
    const readinessGaps = readinessDivergenceGaps();
    const assistGaps = assistOperationAuthorityGaps();

    /**
     * The five `file_claim` tasks are step-up NEGATIVES on purpose: the product
     * refuses them and the matrix records the refusal. Counting them as missing
     * positives would invite somebody to fabricate a positive, which is the one
     * outcome nobody wants from a coverage number.
     */
    const missingVerifiers = Number(coverage.tasksMissingVerifiers ?? 0);
    const stepUpNegatives = Number(coverage.tasksMissingPositiveCases ?? 0);

    const rows = [
        row('T1', { provenance: 'derived',
            open: orphanedControls.length,
            openLabel: `${orphanedControls.length} controles configurables (familia.bandera) sin `
                + `consumidor productivo${orphanedControls.length
                    ? `: ${orphanedControls.slice(0, 6).join(', ')}`
                    + (orphanedControls.length > 6 ? ` y ${orphanedControls.length - 6} más` : '')
                    : ''}`,
            gates: [],
            evidence: 'Derivado del contrato de perfil de negocio contra los módulos que pueden '
                + 'actuar sobre cada bandera, excluyendo el propio contrato, el editor y las '
                + 'pruebas. Una bandera que sólo su esquema y su formulario mencionan es un '
                + 'control que el dueño puede mover sin consecuencia, y la pantalla dice que hizo algo.' }),

        row('T2', { provenance: 'derived',
            open: readinessGaps.length,
            openLabel: `${readinessGaps.length} predicados de preparación aún divergen de su herramienta`
                + (readinessGaps.length ? `: ${readinessGaps.join(', ')}` : ''),
            gates: [],
            evidence: 'Derivado de cada entrada no nula de `READINESS_PREDICATE_AUTHORITY`. '
                + 'Cada readiness cita el predicado que su herramienta evalúa y el registro se '
                + 'reduce únicamente cuando la corrección aterriza junto con su prueba.' }),

        row('T3', { provenance: 'derived',
            open: scope.wired ? 0 : 1,
            openLabel: scope.wired ? '' : 'assessment no entrega un scope autoritativo, así que '
                + 'toda evidencia queda `not_verified` de forma permanente',
            gates: [],
            evidence: `Leído de la llamada, no de un comentario: ${scope.detail}. Sin scope el `
                + 'lector no puede reconocer evidencia producida bajo la configuración actual, y '
                + 'un agente probado se ve igual que uno que nadie probó.' }),

        row('T4', { provenance: 'derived',
            open: tours.missing.length,
            openLabel: `${tours.missing.length} de ${tours.discovery} elementos de descubrimiento `
                + `sin recorrido${tours.missing.length ? `: ${tours.missing.join(', ')}` : ''}`,
            gates: [],
            evidence: 'Derivado de `DISCOVERY_ORDER` contra la tabla por elemento del tour. Un '
                + 'elemento que aparece en el panel y no en el recorrido es una pantalla a la que '
                + 'se manda al dueño sin decirle para qué sirve, qué datos necesita, qué puede '
                + 'confirmar ni qué cuesta.' }),

        row('T5', { provenance: 'derived',
            open: Math.max(0, missingVerifiers - stepUpNegatives),
            openLabel: `${Math.max(0, missingVerifiers - stepUpNegatives)} tareas sin verificador `
                + `sobre ${coverage.tasks ?? 0} (${stepUpNegatives} son negativos de step-up `
                + '`file_claim`, que no llevan positivo por diseño)',
            gates: [1, 4],
            evidence: `Universo canónico conservado: ${coverage.profiles ?? 0} perfiles, `
                + `${coverage.tasks ?? 0} tareas, ${coverage.committingTasks ?? 0} que comprometen `
                + 'al negocio. La verificación determinista local es lo que esta fila mide; la '
                + `certificación por canal y modelo real sigue en cero (${coverage.certifiedProfiles ?? 0}`
                + '/76) y es gate externo, no trabajo local.' }),

        row('T6', { provenance: 'derived',
            open: assistGaps.length,
            openLabel: assistGaps.join('; '),
            gates: [],
            evidence: 'Derivado del AST de `copilot.service.ts`: Assist inyecta '
                + '`AgentContentProposalService`, consulta `listOperations`, deriva de sus '
                + 'veredictos la lista ejecutable y no vuelve a leer `effectiveCapabilities` '
                + 'como una autoridad paralela.' }),
    ];

    /**
     * T7 is about this table existing and being ENFORCED, so it is derived
     * from the wiring and appended after the rows it counts — it cannot
     * report whether T1–T6 are present before they are built.
     */
    const wiring = closureWiring(rows.map(entry => entry.id));
    rows.push(row('T7', { provenance: 'derived',
        open: wiring.length,
        openLabel: wiring.join('; '),
        gates: [],
        evidence: 'El programa de herramientas entra al gate oficial por UNA autoridad '
            + 'compartida: `verify-artifacts.cjs` ejecuta `generate-tool-profile-audit '
            + '--check` junto con los otros generadores, y `candidate`, `deploy` y '
            + '`vertical-quality` llaman a ese verificador en vez de llevar cada uno su '
            + 'propia lista. El artefacto de herramientas quedó stale sin impedir un cierre '
            + 'precisamente porque no estaba ahí. Que el gate se pone rojo ante una fuente '
            + 'modificada lo demuestra una prueba que cambia una fuente auditada y captura '
            + 'la transición, no la afirmación de que el árbol está al día. Las seis filas '
            + 'T1–T6 se derivan de lecturas del código, nunca de prosa ni de la existencia '
            + 'de un test.' }));
    return rows;
}

module.exports = {
    toolsRows, controlsWithoutConsumer, evidenceScopeWired, tourCoverageGaps, closureWiring,
    readinessDivergenceGaps, assistOperationAuthorityGaps,
};
