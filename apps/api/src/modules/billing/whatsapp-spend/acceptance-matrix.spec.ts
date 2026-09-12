import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ACCEPTANCE_MATRIX, AcceptanceScenario, uncoveredScenarios } from './acceptance-matrix';

/**
 * ═══ THE MAPPING HAS TO BE TRUE, OR IT IS WORSE THAN NOT HAVING ONE ═══
 *
 * A table saying "scenario 3 is covered by that test over there" is a claim,
 * and a claim that nothing checks rots the moment somebody renames a test. It
 * then reports coverage the repository does not have, which is strictly worse
 * than an empty column: an empty column makes somebody look.
 *
 * So every `covered` entry is verified against the file it names — the file
 * exists, and each fragment names a test that RUNS in it. A scenario with
 * `covered: null` is required to say what a test would have to do, so the gap
 * is actionable rather than a shrug.
 *
 * ── WHY THE FRAGMENT IS MATCHED AGAINST TITLES AND NOT AGAINST THE FILE ─────
 *
 * This check used to be `expect(text).toContain(fragment)` over the whole file,
 * which is a different claim from the one the matrix makes. Three rows were
 * living off it: `999` appeared in that file only in a header comment and in
 * the aside `October's unused 999 do not follow it.`, so deleting all twelve
 * `it()` blocks of the file left the row green; `nurturing` matched the
 * `import { NurturingService }` line; `flow` matched a mock payload.
 *
 * A fragment therefore has to be found inside an `it()` / `test()` TITLE, and
 * in exactly one of them — matching two titles means either can be deleted with
 * the row still green — and be long enough that a common word cannot do it.
 *
 * Parsing titles is what makes that possible, and a parser is itself a claim:
 * one that returned the whole file would restore the bug, and one that returned
 * nothing would fail everything. So it is pinned against a fixture built to
 * look exactly like the defect it was written for.
 */
const SRC = resolve(__dirname, '../../..');

/**
 * Short enough to be an accident. `flow`, `999` and `nurturing` — the three
 * fragments that were holding rows up without naming a test — are 4, 3 and 9
 * characters; nothing this size is distinctive to one test.
 */
const MIN_FRAGMENT_LENGTH = 20;

/** Past the string literal that starts at `open`, quotes and escapes honoured. */
function endOfString(text: string, open: number): number {
    const quote = text[open];
    for (let i = open + 1; i < text.length; i += 1) {
        if (text[i] === '\\') { i += 1; continue; }
        if (text[i] === quote) return i;
    }
    return text.length;
}

/**
 * The index just past the `)` that closes the `(` whose contents start at
 * `from`, or -1 if it never closes.
 *
 * `it.each([...])(title, fn)` puts the title in the SECOND call, and the table
 * in the first is full of arrow functions, strings and nested brackets — so the
 * parentheses have to be counted, and quoted text skipped, rather than looking
 * for the next `)`.
 */
function afterBalancedParen(text: string, from: number): number {
    let depth = 1;
    for (let i = from; i < text.length; i += 1) {
        const char = text[i];
        if (char === '\'' || char === '"' || char === '`') { i = endOfString(text, i); continue; }
        if (char === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) return -1; continue; }
        if (char === '/' && text[i + 1] === '*') {
            const close = text.indexOf('*/', i + 2);
            if (close < 0) return -1;
            i = close + 1;
            continue;
        }
        if (char === '(') depth += 1;
        else if (char === ')') { depth -= 1; if (depth === 0) return i + 1; }
    }
    return -1;
}

/** The string literal starting at `from` (whitespace skipped), or null. */
function stringLiteralAt(text: string, from: number): string | null {
    let i = from;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    const quote = text[i];
    if (quote !== '\'' && quote !== '"' && quote !== '`') return null;
    const end = endOfString(text, i);
    return text.slice(i + 1, end);
}

/**
 * The same text with comment bodies and string contents blanked out.
 *
 * Offsets are preserved — every removed character becomes a space — so the
 * openers are FOUND in this copy while the titles are READ from the original.
 *
 * Without it the opener scan ran over raw source, so a commented-out
 * `it('a title nobody runs')`, or one quoted inside a docblock explaining what
 * NOT to do, counted as a test. For a check whose entire job is to prove a
 * scenario is answered by something that executes, prose was the one thing it
 * must never accept — and this file is full of prose about tests.
 */
function maskedForScanning(text: string): string {
    const out = text.split('');
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (char === '/' && text[i + 1] === '/') {
            const end = text.indexOf('\n', i);
            const stop = end < 0 ? text.length : end;
            for (let j = i; j < stop; j += 1) out[j] = ' ';
            i = stop;
            continue;
        }
        if (char === '/' && text[i + 1] === '*') {
            const close = text.indexOf('*/', i + 2);
            const stop = close < 0 ? text.length : close + 2;
            for (let j = i; j < stop; j += 1) if (out[j] !== '\n') out[j] = ' ';
            i = stop - 1;
            continue;
        }
        if (char === '\'' || char === '"' || char === '`') {
            const end = endOfString(text, i);
            // Quotes kept where they are: `stringLiteralAt` reads the ORIGINAL
            // text at these offsets and needs them to still be quotes.
            for (let j = i + 1; j < end; j += 1) if (out[j] !== '\n') out[j] = ' ';
            i = end;
            continue;
        }
    }
    return out.join('');
}

/**
 * Every `it()` / `test()` title a spec file declares AND RUNS.
 *
 * `describe()` titles are deliberately NOT here: a describe is a folder, and a
 * scenario answered by "some test inside that block" is the file-level claim
 * the matrix refuses to make. The tagged-template form of `each` is not
 * recognised either, so a fragment aimed at one fails rather than passing on a
 * guess — the safe direction for a check whose whole job is to be strict.
 *
 * `.skip` and `.todo` are excluded for the same reason they are excluded from a
 * test run: they do not execute, so they answer nothing. The opener pattern
 * listed them, which meant a scenario could be marked covered by a test
 * somebody had switched off — the exact shape of "green because nobody looked"
 * this matrix exists to prevent.
 */
export function testTitlesIn(source: string): readonly string[] {
    // Newlines normalised: `core.autocrlf` writes CRLF on a Windows checkout,
    // and a title spanning one would match on Linux and not here, about a file
    // neither machine changed.
    const text = source.split('\r\n').join('\n');
    const scan = maskedForScanning(text);
    const titles: string[] = [];
    const opener = /\b(?:it|test)((?:\.(?:only|failing|concurrent|each))*)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = opener.exec(scan)) !== null) {
        let cursor = match.index + match[0].length;
        if (match[1].includes('each')) {
            cursor = afterBalancedParen(text, cursor);
            if (cursor < 0) break;
            while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
            if (text[cursor] !== '(') continue;
            cursor += 1;
        }
        const title = stringLiteralAt(text, cursor);
        if (title !== null) titles.push(title.split('\n').map(line => line.trim()).join(' '));
    }
    return titles;
}

/** The titles of `source` that contain `fragment`. The matrix requires one. */
export function titlesAnswering(source: string, fragment: string): readonly string[] {
    return testTitlesIn(source).filter(title => title.includes(fragment));
}

describe('the R5 acceptance matrix, checked rather than asserted', () => {
    it('has all eighteen rows the handoff prints', () => {
        expect(ACCEPTANCE_MATRIX).toHaveLength(18);
    });

    it('states what evidence each scenario has to produce', () => {
        for (const row of ACCEPTANCE_MATRIX) {
            expect(row.scenario.length).toBeGreaterThan(8);
            expect(row.evidence.length).toBeGreaterThan(15);
        }
    });

    describe('the title reader the whole mapping rests on', () => {
        /**
         * Built to look like the file that carried the defect: a header comment
         * and an inline aside that both say `999`, an import line that says
         * `nurturing`, a mock payload that says `flow`, and real tests that say
         * none of those things.
         */
        const FIXTURE = [
            'import { NurturingService } from \'./nurturing.service\';',
            '/**',
            ' * 999, 1000 and 1001 are where an off-by-one costs a business money.',
            ' */',
            'const payload = { metadata: { flowId: \'flow-1\' } };',
            // Prose about a test is not a test. The opener scan used to run
            // over raw source, so both of these counted — in a repository
            // whose specs are mostly long comments ABOUT tests.
            '// it(\'a title nobody ever runs\', () => {});',
            '/** Do not write `it(\'a docblock example\', ...)` like this. */',
            'describe(\'the free allowance\', () => {',
            '    it(\'is still free at the 1000th and charges from the 1001st\', async () => {',
            '        // October\'s unused 999 do not follow it.',
            '        expect(await send()).toBe(1);',
            '    });',
            '    it.each([[\'a\', 1], [\'b\', 2]])(\'keeps %s apart from the rest\', () => {});',
            '    test(`a title written as a template literal`, () => {});',
            '    it.skip(\'one that is not running today\', () => {});',
            '});',
        ].join('\n');

        it('reads the titles, and only the titles', () => {
            expect(testTitlesIn(FIXTURE)).toEqual([
                'is still free at the 1000th and charges from the 1001st',
                'keeps %s apart from the rest',
                'a title written as a template literal',
                // `one that is not running today` is an `it.skip` in the
                // fixture and is deliberately ABSENT: a skipped test executes
                // nothing, so it answers no scenario. The reader used to
                // accept `.skip` and `.todo`, which let a row be marked covered
                // by a test somebody had switched off — green because nobody
                // looked, which is the thing this matrix exists to stop.
            ]);
        });

        it('refuses the three fragments the old whole-file match accepted', () => {
            // Every one of these IS in the text — which is exactly why matching
            // the text was not a check. If this ever passes again, the mapping
            // has gone back to being satisfied by comments and imports.
            for (const fragment of ['999', 'nurturing', 'flow']) {
                expect(FIXTURE).toContain(fragment);
                expect(titlesAnswering(FIXTURE, fragment)).toEqual([]);
            }
        });

        it('still finds a real title, so it is not failing everything', () => {
            expect(titlesAnswering(FIXTURE, 'charges from the 1001st'))
                .toEqual(['is still free at the 1000th and charges from the 1001st']);
        });
    });

    describe('every scenario it claims is covered', () => {
        const covered = ACCEPTANCE_MATRIX.filter(row => row.covered !== null);

        it('names at least one real test for the ones that are', () => {
            // Not "most of them". If this drops to zero the matrix has stopped
            // being about this repository.
            expect(covered.length).toBeGreaterThan(0);
        });

        it.each(covered.map(row => [row.scenario, row.covered!] as const))(
            '%s is answered by tests that exist', (_scenario, covers) => {
                const file = resolve(SRC, covers.file);
                expect(existsSync(file)).toBe(true);
                const text = readFileSync(file, 'utf8');
                expect(covers.titles.length).toBeGreaterThan(0);
                for (const fragment of covers.titles) {
                    // A fragment this short cannot be about one test, whatever
                    // it happens to match.
                    expect(fragment.length).toBeGreaterThanOrEqual(MIN_FRAGMENT_LENGTH);
                    // Exactly one: two matches means either test can be deleted
                    // with the row still green, which is the failure this check
                    // exists to prevent.
                    expect({ fragment, matched: titlesAnswering(text, fragment) })
                        .toEqual({ fragment, matched: [expect.stringContaining(fragment)] });
                }
            });
    });

    describe('every scenario it admits is not', () => {
        const missing = uncoveredScenarios();

        it.each(missing.map(row => [row.scenario, row] as const))(
            '%s says what a test would have to do', (_scenario, row) => {
                // A gap with no description is a gap nobody can pick up.
                expect(row.missing).toBeDefined();
                expect(row.missing!.length).toBeGreaterThan(60);
            });

        it('is counted, not hidden', () => {
            // The number is the point. It is what R5 reports, and it is a fact
            // about the repository rather than about who wrote the list — which
            // is why the uncovered rows are IN the table rather than left out
            // of it to make the column look full.
            // Some are covered and some are not, and BOTH halves are asserted:
            // an all-covered matrix would mean somebody deleted the gaps
            // instead of closing them, and an all-uncovered one would mean the
            // mapping stopped being about this repository.
            expect(missing.length).toBeGreaterThan(0);
            expect(missing.length).toBeLessThan(ACCEPTANCE_MATRIX.length);
        });

        it('names only tests CI actually runs, gate included', () => {
            /**
             * ═══ "RUNS" IS CONDITIONAL FOR MOST OF THESE ═══
             *
             * Half the covered rows point at `.postgres.spec.ts` files that
             * open with `connection ? describe : describe.skip`. On a laptop
             * with no disposable database those suites skip themselves, and a
             * parser that reads titles out of the SOURCE cannot tell the
             * difference — it would go on reporting the row covered by a test
             * nothing executed.
             *
             * That is a real limit and it is closed by the workflow rather
             * than by the parser: `candidate.yml` supplies
             * `PARALLLY_ISOLATION_TEST_URL` and then gates on
             * `assert-no-skipped-tests.cjs`, which reads Jest's own report and
             * refuses a run with skipped tests in it. So the guarantee is
             * "these run in CI", not "these ran wherever you are" — and this
             * case pins the two halves of that sentence, because a silent
             * removal of either would turn the matrix back into a document.
             */
            const workflow = readFileSync(
                resolve(SRC, '..', '..', '..', '.github', 'workflows', 'candidate.yml'), 'utf8');
            const gated = ACCEPTANCE_MATRIX
                .map(row => row.covered?.file)
                .filter((file): file is string => !!file && file.includes('.postgres.spec.ts'));
            expect(gated.length).toBeGreaterThan(0);

            // Every one of them really is conditional — read from the file, so
            // this cannot drift into asserting a shape nothing has.
            for (const file of new Set(gated)) {
                const source = readFileSync(resolve(SRC, file), 'utf8');
                expect({ file, conditional: /\?\s*describe\s*:\s*describe\.skip/.test(source) })
                    .toEqual({ file, conditional: true });
            }

            // And the workflow both un-skips them and refuses a skipped run.
            expect(workflow).toContain('PARALLLY_ISOLATION_TEST_URL');
            expect(workflow).toContain('assert-no-skipped-tests.cjs');
        });

        it('reports these four gaps, by name', () => {
            // What replaces the assertion that used to stand here. That one
            // added the two halves and compared the sum to the whole, and
            // because `covered` is an object or `null` the sum WAS the whole
            // for every possible input: eighteen rows all pointing at files
            // that do not exist satisfied it. A check that cannot fail is
            // decoration. This list is written out by hand precisely so that
            // it is not computed from the thing it is checking: closing a gap
            // or opening one has to come here and say so.
            expect(uncoveredScenarios().map(row => row.scenario)).toEqual([
                'Pregunta resuelta y cinco "gracias"',
                'Misma pregunta requerida sin progreso',
                'Bot contra bot y ráfaga de contactos',
                'Humano, REST, campaña y recordatorio',
                // The nurturing row was opened by the adversarial pass and is
                // closed again — not by relabelling it, but because the missing
                // half got built: nurturing now honours `leads.opted_out`, the
                // flag `compliance.isBlocked` cannot see, and a test fails if
                // that gate is removed.
            ]);
        });

        it('splits the table by what each row says, with no third state', () => {
            // The partition is only real if `covered` is an object or `null`
            // and nothing else — an `undefined` left by a half-finished edit
            // would be counted as neither, and the row would vanish from both
            // the coverage check and the gap counter.
            for (const row of ACCEPTANCE_MATRIX) {
                expect(Object.prototype.hasOwnProperty.call(row, 'covered')).toBe(true);
                if (row.covered === null) continue;
                expect(typeof row.covered.file).toBe('string');
                expect(row.covered.file.endsWith('.spec.ts')).toBe(true);
                expect(Array.isArray(row.covered.titles)).toBe(true);
            }
            // And the filter has to be the one doing the separating: fed a
            // covered row and an uncovered one, it returns the uncovered one.
            const synthetic: AcceptanceScenario[] = [
                { scenario: 'una fila con prueba', evidence: 'e',
                    covered: { file: 'x.spec.ts', titles: ['t'] } },
                { scenario: 'una fila sin prueba', evidence: 'e', covered: null, missing: 'm' },
            ];
            expect(uncoveredScenarios(synthetic).map(row => row.scenario))
                .toEqual(['una fila sin prueba']);
        });
    });

    it('names no scenario twice', () => {
        const names = ACCEPTANCE_MATRIX.map(row => row.scenario);
        expect(new Set(names).size).toBe(names.length);
    });
});
