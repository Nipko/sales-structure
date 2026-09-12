import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';

import { FREE_SERVICE_MESSAGES_PER_NUMBER_MONTH } from '../../modules/billing/whatsapp-spend/free-allowance';
import { WHATSAPP_FREE_SERVICE_ALLOWANCE } from '../../modules/billing/whatsapp-rates/whatsapp-rate-table.generated';

/**
 * ═══ THE GENERATORS THAT AGREED WITH THEMSELVES ═══
 *
 * Three artefacts in this repository are generated from the code and then read
 * as evidence: `closure-report.json`, `closure-report.md` and the canary's
 * figures as they appear in prose. Each of them had a check, each check exited
 * zero, and each was checking something other than what its output claimed.
 *
 *   · `meta-october-rows.cjs` destructured `FREE_SERVICE_DELIVERIES_PER_MONTH`
 *     from a module that does not export it. JavaScript answered `undefined`,
 *     the row interpolated it, and `closure-report.md` told every reader "y
 *     **undefined** entregas de servicio gratuitas por número y mes". `--check`
 *     agreed, because the committed JSON carried the same string: it was
 *     comparing the mistake to itself.
 *   · `--check` exited BEFORE the markdown was built, so `closure-report.md` —
 *     the file people actually read, the one a release note quotes — was
 *     verified by nothing at all.
 *   · the contradiction sweep asked three questions of rows it had just built
 *     with a constructor that derives the answer, so "sin contradicciones" was
 *     a restatement of the constructor presented as a finding.
 *   · `check-canary-figures.cjs` classified a document only if it matched a
 *     frozen list of the PREVIOUSLY-WRONG literals, so three documents quoting
 *     the CURRENT figures were checked by nobody — and nothing in `.github/`
 *     ran the script at all.
 *
 * What these tests pin is therefore not "the numbers are right today" but "a
 * wrong number could not have got here quietly": a missing export aborts, a
 * hand-edited markdown fails, a row is re-judged from the artefact rather than
 * from the constructor, and a document quoting a figure is checked wherever it
 * says it.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const AUDIT = resolve(ROOT, 'docs', 'audits', '2026-09-09');

const read = (...parts: string[]): string =>
    readFileSync(resolve(...parts), 'utf8').replace(/\r\n/g, '\n');

const OCTOBER_ROWS = read(AUDIT, 'meta-october-rows.cjs');
const CLOSURE_GENERATOR = read(AUDIT, 'generate-closure-report.cjs');
const VERIFY_ARTIFACTS = read(AUDIT, 'verify-artifacts.cjs');
const CLOSURE_MARKDOWN = read(AUDIT, 'closure-report.md');
const CLOSURE_JSON = JSON.parse(read(AUDIT, 'closure-report.json'));

/**
 * The `.cjs` generators are loaded with Node's own `require`, not Jest's.
 *
 * Jest's transform map here covers `.ts` only, so its resolver has nothing to
 * do with a `.cjs` file; `createRequire` gives the real thing. Both files are
 * safe to load because their executable bodies are behind
 * `require.main === module` — `check-canary-figures.cjs` in particular would
 * otherwise spawn the planner, which boots ts-node over the whole API tree.
 */
const nodeRequire = createRequire(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// A NAME DESTRUCTURED FROM A MODULE THAT DOES NOT EXPORT IT
// ─────────────────────────────────────────────────────────────────────────────

/** Names a TypeScript module exports, following `export * from` one hop at a time. */
const exportedNames = (file: string, seen = new Set<string>()): Set<string> => {
    const names = new Set<string>();
    if (seen.has(file) || !existsSync(file)) return names;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    const declared = /export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/g;
    for (const match of source.matchAll(declared)) names.add(match[1]);
    // `export { a, b as c }` exports `a` and `c`.
    for (const match of source.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g)) {
        for (const clause of match[1].split(',')) {
            const parts = clause.trim().split(/\s+as\s+/);
            if (parts.length && parts[parts.length - 1]) names.add(parts[parts.length - 1].trim());
        }
    }
    for (const match of source.matchAll(/export\s*\*\s*from\s*'([^']+)'/g)) {
        const target = resolve(dirname(file), match[1]);
        for (const name of exportedNames(`${target}.ts`, seen)) names.add(name);
        for (const name of exportedNames(resolve(target, 'index.ts'), seen)) names.add(name);
    }
    for (const match of source.matchAll(/export\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
        const target = resolve(dirname(file), match[2]);
        const reexported = new Set([
            ...exportedNames(`${target}.ts`, seen),
            ...exportedNames(resolve(target, 'index.ts'), seen),
        ]);
        for (const clause of match[1].split(',')) {
            const parts = clause.trim().split(/\s+as\s+/);
            const exposed = parts[parts.length - 1]?.trim();
            if (exposed && (reexported.has(parts[0].trim()) || reexported.size === 0)) names.add(exposed);
        }
    }
    return names;
};

/** Every `const { … } = api('modules/…')` in a generator, as (module, names). */
const apiDestructures = (source: string): Array<{ module: string; names: string[] }> =>
    [...source.matchAll(/const\s*\{([^}]*)\}\s*=\s*api\(\s*'([^']+)'\s*\)/g)].map(match => ({
        module: match[2],
        names: match[1].split(',').map(part => part.split(':')[0].split('=')[0].trim()).filter(Boolean),
    }));

describe('los generadores leen exports que existen', () => {
    /**
     * The test that would have caught it. `FREE_SERVICE_DELIVERIES_PER_MONTH`
     * appeared exactly once in the whole repository — inside the destructure
     * that asked for it — and nothing anywhere said so.
     */
    it.each([
        ['meta-october-rows.cjs', OCTOBER_ROWS],
        ['generate-closure-report.cjs', CLOSURE_GENERATOR],
    ])('%s: cada nombre desestructurado existe en el módulo del que sale', (_label, source) => {
        const missing: string[] = [];
        const destructures = apiDestructures(source);
        expect(destructures.length).toBeGreaterThan(0);
        for (const { module, names } of destructures) {
            const file = resolve(ROOT, 'apps', 'api', 'src', module);
            expect(existsSync(file)).toBe(true);
            const exported = exportedNames(file);
            for (const name of names) if (!exported.has(name)) missing.push(`${module} → ${name}`);
        }
        expect(missing).toEqual([]);
    });

    it('una cifra derivada que no resuelve detiene el generador en vez de renderizarse', () => {
        const { figure } = nodeRequire(resolve(AUDIT, 'meta-october-rows.cjs'));
        for (const bad of [undefined, null, NaN, Infinity, '1000', {}]) {
            expect(() => figure('freeAllowance', bad)).toThrow(/not a finite number/);
        }
        expect(figure('freeAllowance', 1000)).toBe(1000);
        expect(figure('zero', 0)).toBe(0);
    });
});

describe('el informe versionado no le dice al lector una cifra sin resolver', () => {
    it('closure-report.md no contiene `undefined` ni `NaN`', () => {
        // The revision line is a SHA and can legitimately contain `nan`; the
        // check is on the whole-word token, and the line is exempt anyway.
        const offenders = CLOSURE_MARKDOWN.split('\n')
            .filter(line => !line.startsWith('Revisión: `'))
            .filter(line => /\b(undefined|NaN)\b/.test(line));
        expect(offenders).toEqual([]);
    });

    it('una lista vacía se dice con una palabra, no con la cadena vacía', () => {
        // `Sin comando ligado: . Sin cobro ligado: .` and `Abiertos: .` are what
        // `[].join(', ')` renders, and a reader cannot tell that from a sentence
        // that got truncated.
        expect(CLOSURE_MARKDOWN).not.toMatch(/ligado: \./);
        expect(CLOSURE_MARKDOWN).not.toMatch(/Abiertos: \./);
        const a1 = CLOSURE_MARKDOWN.split('\n').find(line => line.startsWith('| A1 |'));
        const g1 = CLOSURE_MARKDOWN.split('\n').find(line => line.startsWith('| G1 |'));
        expect(a1).toMatch(/Sin comando ligado: \S/);
        expect(g1).toMatch(/Abiertos: \S/);
    });

    it('la franquicia gratuita del informe es la que declara el producto', () => {
        /**
         * Computed here from the product modules rather than from the artefact,
         * so this comparison has two independent sides. Reading the number out
         * of `closure-report.json` and comparing it with `closure-report.md`
         * would have passed happily while both said `undefined`.
         */
        expect(WHATSAPP_FREE_SERVICE_ALLOWANCE.deliveries)
            .toBe(FREE_SERVICE_MESSAGES_PER_NUMBER_MONTH);
        const row = CLOSURE_MARKDOWN.split('\n')
            .find(line => line.startsWith('| Entregas de servicio gratuitas por número y mes |'));
        expect(row).toBe(`| Entregas de servicio gratuitas por número y mes | ${WHATSAPP_FREE_SERVICE_ALLOWANCE.deliveries} |`);
        expect(CLOSURE_JSON.rows.find((entry: { id: string }) => entry.id === 'M2').evidence)
            .toContain(`${WHATSAPP_FREE_SERVICE_ALLOWANCE.deliveries} entregas de servicio gratuitas`);
    });
});

describe('el markdown también se verifica', () => {
    /**
     * The ordering defect, asserted as ordering. `--check` used to sit above the
     * markdown and `process.exit(0)` out of the file fifteen lines before
     * `lines` existed, which is why a hand-edited `closure-report.md` passed
     * every gate in the repository.
     */
    it('el markdown se arma antes de que --check decida', () => {
        const markdownAt = CLOSURE_GENERATOR.indexOf('const nextMarkdown =');
        const checkAt = CLOSURE_GENERATOR.indexOf("const CHECK = process.argv.includes('--check')");
        expect(markdownAt).toBeGreaterThan(0);
        expect(checkAt).toBeGreaterThan(markdownAt);
    });

    it('--check compara el markdown versionado, no sólo el JSON', () => {
        const checkBlock = CLOSURE_GENERATOR.slice(
            CLOSURE_GENERATOR.indexOf("const CHECK = process.argv.includes('--check')"));
        expect(checkBlock).toContain('closure-report.md is stale');
        expect(checkBlock).toMatch(/comparable\(storedMarkdown\)\s*!==\s*comparable\(nextMarkdown\)/);
    });

    it('verify-artifacts.cjs sigue llegando a ese --check', () => {
        expect(VERIFY_ARTIFACTS).toContain('generate-closure-report.cjs');
        expect(VERIFY_ARTIFACTS).toContain("'--check'");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// EL BARRIDO DE CONTRADICCIONES, SOBRE EL ARTEFACTO Y NO SOBRE EL CONSTRUCTOR
// ─────────────────────────────────────────────────────────────────────────────

describe('las filas del artefacto se juzgan contra sus propias condiciones', () => {
    /**
     * Recomputed here, in a second implementation, from the committed JSON. The
     * generator's own sweep used to run only over rows it had just built with a
     * constructor that derives `status` from `open` and `gates` — so asking
     * whether `status` agreed with `open` and `gates` could not fail, and the
     * document reported that as "sin contradicciones".
     */
    const GATES = Object.keys(CLOSURE_JSON.gates);

    it('el estado guardado es el que sale de sus condiciones', () => {
        const disagreeing = CLOSURE_JSON.rows
            .map((row: { id: string; open: number; gates: number[]; status: string }) => {
                const expected = Number(row.open) > 0 ? 'abierta'
                    : row.gates.length ? 'bloqueada' : 'aceptada';
                return row.status === expected ? null : `${row.id}: ${row.status} ≠ ${expected}`;
            })
            .filter(Boolean);
        expect(disagreeing).toEqual([]);
    });

    it('ninguna fila abierta deja de decir qué falta, y ningún gate nombrado es inventado', () => {
        const problems: string[] = [];
        for (const row of CLOSURE_JSON.rows as Array<{
            id: string; status: string; openLabel: string; gates: number[];
            evidence: string; provenance: string; artefact: string | null;
        }>) {
            if (row.status === 'abierta' && !String(row.openLabel ?? '').trim()) {
                problems.push(`${row.id}: abierta sin decir qué falta`);
            }
            for (const gate of row.gates) {
                if (!GATES.includes(String(gate))) problems.push(`${row.id}: gate ${gate} no existe`);
            }
            if (/\b(undefined|NaN)\b/.test(`${row.openLabel} ${row.evidence}`)) {
                problems.push(`${row.id}: interpola una cifra que no resolvió`);
            }
            if (row.provenance === 'executed_evidence'
                && !existsSync(resolve(ROOT, row.artefact ?? ''))) {
                problems.push(`${row.id}: nombra un artefacto que no existe`);
            }
        }
        expect(problems).toEqual([]);
    });

    it('el generador aplica el barrido a las filas releídas del artefacto', () => {
        // Not only to the ones it just built: over those the comparison is with
        // the constructor that produced them.
        expect(CLOSURE_GENERATOR).toMatch(/contradictionsIn\(stored\?\.rows/);
        expect(CLOSURE_GENERATOR).toMatch(/contradictionsIn\(JSON\.parse\(fs\.readFileSync\(jsonPath/);
    });

    it('el documento ya no presenta como hallazgo algo que no podía fallar', () => {
        expect(CLOSURE_MARKDOWN)
            .not.toContain('ninguna fila se declara aceptada con una condición abierta');
        expect(CLOSURE_MARKDOWN).toContain('no podría fallar');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// LAS CIFRAS DEL CANARIO, DONDE SEA QUE UN DOCUMENTO LAS DIGA
// ─────────────────────────────────────────────────────────────────────────────

describe('el chequeo de las cifras del canario', () => {
    const checker = nodeRequire(resolve(ROOT, 'apps', 'api', 'scripts', 'check-canary-figures.cjs'));
    /** What the planner says today, hard-coded so this spec spawns nothing. */
    const TODAY = { cases: 204, calls: 612, subject: 408, judge: 204, cents: 108 };
    /** The same run after somebody changes the planner. */
    const MOVED = { cases: 210, calls: 630, subject: 420, judge: 210, cents: 111 };

    /**
     * The three that were invisible. Each states today's figures in prose — with
     * slashes, with "y" instead of a comma, with a line break in the middle —
     * and none of them matched any of the six shapes the checker knew, so none
     * was checked in either direction.
     */
    const QUOTING_CURRENT = [
        'docs/audits/2026-09-10/whatsapp-runtime-batch-report.md',
        'docs/audits/2026-09-10/whatsapp-runtime-post-closure-independent-review.md',
        'docs/handoffs/2026-09-10/claude-whatsapp-runtime-true-closure.md',
    ];

    const textOf = (relative: string): string => read(ROOT, relative);

    it.each(QUOTING_CURRENT)('%s: sus cifras se encuentran y coinciden hoy', relative => {
        const { matched, stale } = checker.inspect(textOf(relative), TODAY);
        expect(matched).toBeGreaterThan(0);
        expect(stale).toEqual([]);
    });

    it.each(QUOTING_CURRENT)('%s: queda en rojo cuando el planificador cambia', relative => {
        const { stale } = checker.inspect(textOf(relative), MOVED);
        expect(stale.length).toBeGreaterThan(0);
    });

    it('una cita histórica exenta no se reporta ni se reescribe', () => {
        const relative = 'docs/audits/2026-09-10/certification-canary.md';
        const quoted: string[] = checker.QUOTED_SUPERSEDED[relative];
        expect(quoted.length).toBeGreaterThan(0);
        const text = textOf(relative);
        for (const sentence of quoted) expect(text).toContain(sentence);
        const exempt = checker.inspect(text, TODAY, quoted);
        expect(exempt.quotedHits).toBeGreaterThan(0);
        expect(exempt.stale).toEqual([]);
        // `--fix` runs through the same callback: the sentence that records the
        // correction must come back byte-identical, or the document that caught
        // the error becomes one that never mentions it.
        for (const sentence of quoted) expect(exempt.fixed).toContain(sentence);
        // And without the exemption the very same sentence IS a divergence, so
        // the exemption is doing work rather than decorating a passing check.
        expect(checker.inspect(text, TODAY).stale.length).toBeGreaterThan(0);
    });

    it('el round-trip de cada patrón no pierde texto en ningún documento del repositorio', () => {
        /**
         * The guard the rebuild depends on: every literal segment of a pattern
         * has to sit inside its own capture group, because the replacement
         * reassembles the match from its groups. An earlier regex rebuild of
         * this file turned "204 casos, 408 llamadas, techo US$0,76" into
         * "204612US$1,08" by leaving literals outside. `inspect` throws when the
         * round trip loses a character, so running it over the whole corpus is
         * the assertion.
         */
        const files: string[] = checker.markdownFiles(resolve(ROOT, 'docs'));
        expect(files.length).toBeGreaterThan(0);
        for (const relative of files) {
            expect(() => checker.inspect(textOf(relative), TODAY)).not.toThrow();
            expect(() => checker.inspect(textOf(relative), MOVED)).not.toThrow();
        }
    });

    it('cada documento clasificado a mano existe en el repositorio', () => {
        const classified = [
            ...checker.ASSERTING,
            ...Object.keys(checker.HISTORICAL),
            ...Object.keys(checker.QUOTED_SUPERSEDED),
        ];
        for (const relative of classified) expect(existsSync(resolve(ROOT, relative))).toBe(true);
    });

    it('las cifras retiradas siguen retiradas', () => {
        // A ledger entry the planner produces again would make the net demand
        // that a CORRECT document explain itself.
        const rendering = `${TODAY.cases} casos, ${TODAY.calls} llamadas, `
            + `techo ${checker.usdEs(TODAY.cents)} / ${checker.usdEn(TODAY.cents)}`;
        for (const entry of checker.RETIRED) expect(entry.shape.test(rendering)).toBe(false);
    });

    it('alguien lo corre: candidate.yml invoca el chequeo', () => {
        /**
         * It did not. A repository-wide search for `check-canary-figures` across
         * `.github/`, `package.json`, `apps/api/src` and `infra/` returned the
         * file itself and nothing else, while the workflow ran the other three
         * generator checks two lines away.
         */
        const workflow = read(ROOT, '.github', 'workflows', 'candidate.yml');
        expect(workflow).toContain('node apps/api/scripts/check-canary-figures.cjs --check');
    });

    it('el planificador se puede invocar desde la raíz del repositorio', () => {
        /**
         * The reason nothing ran it: the planner registers ts-node and ts-node
         * looks for a `tsconfig.json` from the CURRENT WORKING DIRECTORY, which
         * this repository does not have at its root. From the root — the one
         * directory CI runs things from — it died on `TS5109` before printing a
         * figure. Exercised for real rather than asserted, because the fix is an
         * environment variable and an environment variable is exactly the kind
         * of thing a source-text assertion will happily confirm while the
         * process still fails.
         */
        // NOT supplying TS_NODE_PROJECT here. That is the whole claim: the
        // script has to set it for itself, because CI runs it from the root with
        // a bare environment. Passing it in from the test proved that the test
        // could fix the problem, which nobody doubted.
        const env = { ...process.env };
        delete env.TS_NODE_PROJECT;
        const output = execFileSync(process.execPath, [
            resolve(ROOT, 'apps', 'api', 'scripts', 'plan-certification-canary.cjs'),
        ], { cwd: ROOT, encoding: 'utf8', env });
        expect(output).toMatch(/^CERTIFICATION_CANARY cases=\d+ calls=\d+/m);
    }, 180_000);

    describe('a figure this programme retired', () => {
        /**
         * ═══ THE SECOND NET THAT CAUGHT NOTHING ═══
         *
         * `RETIRED` is described in the checker as "a second net" for an old
         * figure written in a shape no current claim recognises. It was computed
         * and then used for exactly one thing — deciding whether the document
         * said anything at all — so a file whose only canary content was
         * `US$0,76` printed "agrees with the planner (0 figure(s))" and `--check`
         * exited 0. Reproduced with a probe before this was written.
         *
         * The probe is written into the tree and removed, because the checker
         * resolves its own root: a fixture directory it never scans would prove
         * nothing about the sweep CI runs.
         */
        const PROBE_DIR = resolve(ROOT, 'docs', 'audits', '_canary_probe');
        const PROBE = resolve(PROBE_DIR, 'probe.md');
        const CHECKER = resolve(ROOT, 'apps', 'api', 'scripts', 'check-canary-figures.cjs');

        const check = (): { status: number; out: string } => {
            try {
                const out = execFileSync(process.execPath, [CHECKER, '--check'],
                    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
                return { status: 0, out };
            } catch (error: any) {
                return { status: error.status ?? 1, out: String(error.stdout || '') + String(error.stderr || '') };
            }
        };

        afterEach(() => { try { fs.rmSync(PROBE_DIR, { recursive: true, force: true }); } catch { /* gone */ } });

        it('is refused when a document states it', () => {
            fs.mkdirSync(PROBE_DIR, { recursive: true });
            fs.writeFileSync(PROBE, 'Corrida canaria\n\nEl techo es US$0,76 por pasada.\n');
            const { status, out } = check();
            expect({ status, named: out.includes('_canary_probe') }).toEqual({ status: 1, named: true });
            expect(out).toContain('retired');
        });

        /**
         * ═══ `--fix` MUST NOT CLAIM A DOCUMENT IT DID NOT TOUCH ═══
         *
         * The mode the file header advertises as the remedy reported success
         * for a document it had not written. `--fix` decided what was left by
         * an ALLOWLIST of problem phrasings that "need a human"; the retired-
         * figure branch writes nothing and phrases itself in none of those
         * ways, so every problem it raised was assumed fixed. Reproduced:
         * exit 0, "rewritten from the planner", document byte-identical.
         *
         * CI runs `--check`, so a stale document could never go green there —
         * which is exactly why this one was survivable for so long. The lie
         * was developer-facing, and a developer who trusts it stops looking.
         */
        const fix = (): { status: number; out: string } => {
            try {
                const out = execFileSync(process.execPath, [CHECKER, '--fix'],
                    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
                return { status: 0, out };
            } catch (error: any) {
                return { status: error.status ?? 1, out: String(error.stdout || '') + String(error.stderr || '') };
            }
        };

        it('does not report a fix for a document it left untouched', () => {
            fs.mkdirSync(PROBE_DIR, { recursive: true });
            const source = 'Corrida canaria\n\nEl techo es US$0,76 por pasada.\n';
            fs.writeFileSync(PROBE, source);

            const { status, out } = fix();

            // The document is the evidence: unchanged, so nothing was fixed.
            expect(fs.readFileSync(PROBE, 'utf8')).toBe(source);
            expect(status).toBe(1);
            expect(out).toContain('still diverge and were NOT rewritten');
            // And it must not say the opposite sentence anywhere.
            expect(out).not.toMatch(/^rewritten from the planner/m);
        });

        it('is refused even with today’s figures beside it', () => {
            // A document that states BOTH is not safer; it contradicts itself on
            // the same page, which is how certification-canary.md came to say
            // US$1,08 in one paragraph and US$0,76 in another while this checker
            // called it agreed.
            fs.mkdirSync(PROBE_DIR, { recursive: true });
            fs.writeFileSync(PROBE,
                'Corrida canaria\n\n204 casos, 612 llamadas, techo US$1,08.\n\n'
                + 'Antes costaba US$0,76.\n');
            expect(check().status).toBe(1);
        });

        it('passes a document whose figures AGREE with the planner', () => {
            // This case used to write `El techo es US$1,08 por pasada.` and
            // read its green as proof the checker recognises today's ceiling.
            // It does not: no claim matches a bare US$ figure -- the loose
            // ones are anchored on `casos`/`llamadas` and say so -- so that
            // text is classified as saying nothing about the canary and
            // SKIPPED before any comparison. Status 0 was guaranteed for any
            // ceiling in that shape, `US$9,99` included, so the assertion
            // discriminated nothing.
            //
            // A real positive control is one line away, in a shape the
            // checker actually reads.
            fs.mkdirSync(PROBE_DIR, { recursive: true });
            fs.writeFileSync(PROBE,
                'Corrida canaria\n\n204 casos, 612 llamadas.\n');
            expect(check().status).toBe(0);
        });

        it('and fails the same sentence with figures the planner does not produce', () => {
            // The other half, and what makes the case above mean anything: the
            // SAME shape, different numbers. Without the pair, a document the
            // checker skips entirely is indistinguishable from one it read and
            // approved.
            fs.mkdirSync(PROBE_DIR, { recursive: true });
            fs.writeFileSync(PROBE,
                'Corrida canaria\n\n999 casos, 1 llamadas.\n');
            expect(check().status).toBe(1);
        });
    });
});
