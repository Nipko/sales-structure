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

    /**
     * The five `file_claim` tasks are step-up NEGATIVES on purpose: the product
     * refuses them and the matrix records the refusal. Counting them as missing
     * positives would invite somebody to fabricate a positive, which is the one
     * outcome nobody wants from a coverage number.
     */
    const missingVerifiers = Number(coverage.tasksMissingVerifiers ?? 0);
    const stepUpNegatives = Number(coverage.tasksMissingPositiveCases ?? 0);

    return [
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

        row('T2', { provenance: 'declared',
            open: 1,
            openLabel: 'la preparación por herramienta todavía no se audita contra el predicado '
                + 'real de cada una (activo, disponibilidad, capacidad, precio/moneda, propiedad '
                + 'del dato y relación con la cuenta)',
            gates: [],
            evidence: 'Condición de cierre: cada readiness cita el predicado que su herramienta '
                + 'evalúa de verdad y distingue falta de datos de error de lectura. Contar una '
                + 'fila cualquiera no basta: una cuenta sin capacidad no está lista por tener un '
                + 'servicio. Esta fila es `declared` porque la comparación predicado-a-predicado '
                + 'todavía no es mecánica; la condición dice qué la cerraría.' }),

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

        row('T6', { provenance: 'declared',
            open: 1,
            openLabel: 'Assist todavía no consume el diagnóstico común como única lista de '
                + 'capacidades y operaciones ejecutables',
            gates: [],
            evidence: 'Condición de cierre: Assist propone sólo operaciones que puede ejecutar, '
                + 'explica las demás con destino permitido por rol, y no mantiene un segundo '
                + 'listado de capacidades en los prompts. Activado, preparado, probado, degradado '
                + 'y bloqueado se mantienen como estados distintos.' }),
    ];
}

module.exports = { toolsRows, controlsWithoutConsumer, evidenceScopeWired, tourCoverageGaps };
