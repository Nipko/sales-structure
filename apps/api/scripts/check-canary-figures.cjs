#!/usr/bin/env node
/*
 * ═══ ONE GENERATOR FOR THE CANARY'S NUMBERS, AND DOCUMENTS THAT AGREE ═══
 *
 * `plan-certification-canary.cjs` computes what a canary run would cost: cases,
 * subject calls, judge calls and a ceiling. It is the authority, because it
 * derives those from the same planner the runner uses.
 *
 * The numbers then get quoted in prose, and prose does not recompute. This
 * programme has already shipped that failure: the documents said "408 llamadas
 * y US$0,76" for weeks after the planner started counting the JUDGE as well, so
 * every reader was told a ceiling a third below the real one — and that figure
 * was being used to argue for an authorisation to spend real money.
 *
 *   node apps/api/scripts/check-canary-figures.cjs          # report
 *   node apps/api/scripts/check-canary-figures.cjs --check  # exit 1 when stale
 *   node apps/api/scripts/check-canary-figures.cjs --fix    # rewrite the stale
 *
 * ── ASSERTING A FIGURE IS NOT THE SAME AS QUOTING ONE ───────────────────────
 *
 * A closure report saying "techo US$0,76" is stale and must be rewritten. An
 * independent review saying "US$0,76 no constituye un techo validado" is quoting
 * the old claim in order to REFUTE it, and rewriting that sentence would erase
 * the correction from the record — turning a document that caught the error
 * into one that never mentions it.
 *
 * So documents are classified, by hand, into two lists. A document under
 * `docs/` that carries a superseded figure and is in NEITHER list FAILS: the
 * author has to say which it is. That is the whole point — silence is what let
 * the wrong number travel.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
const planner = path.join(root, 'apps/api/scripts/plan-certification-canary.cjs');

/** The authority, asked once. Never re-derived here. */
function plannedFigures() {
    const output = execFileSync(process.execPath, [planner], { cwd: root, encoding: 'utf8' });
    const line = output.split('\n').find(row => row.startsWith('CERTIFICATION_CANARY '));
    if (!line) throw new Error('the canary planner printed no CERTIFICATION_CANARY line');
    const read = name => {
        const match = line.match(new RegExp(`${name}=(\\d+)`));
        if (!match) throw new Error(`the canary planner printed no ${name}`);
        return Number(match[1]);
    };
    return {
        cases: read('cases'), calls: read('calls'),
        subject: read('subject'), judge: read('judge'), cents: read('cents'),
    };
}

const usdEn = cents => `US$${(cents / 100).toFixed(2)}`;
const usdEs = cents => `US$${(cents / 100).toFixed(2).replace('.', ',')}`;

/**
 * Documents that ASSERT the canary's figures as current fact. Checked, and
 * rewritten by `--fix`.
 *
 * Listed by hand on purpose: a glob would quietly bind a document nobody meant
 * to bind, and an unrelated edit would then fail this check.
 */
const ASSERTING = [
    'docs/audits/2026-09-10/certification-canary.md',
    'docs/audits/2026-09-10/release-closure-report.md',
];

/**
 * Documents allowed to carry a SUPERSEDED figure, because quoting it is the
 * point. Each one says why, and the reason is part of the check: a document
 * here that stops mentioning the correction has lost its excuse.
 */
const HISTORICAL = {
    'docs/audits/2026-09-10/codex-certification-runner-review.md':
        'the independent review that refuted the 408/US$0,76 ceiling',
    'docs/audits/2026-09-10/codex-release-readiness-review.md':
        'the readiness review that refused 408/US$0,76 as a validated ceiling',
    'docs/handoffs/2026-09-10/claude-october-release-parallel-execution.md':
        'the handoff that names US$0,76 as the figure NOT to treat as an authorisation',
};

/** The shapes a superseded figure takes. Any of them is a reason to classify. */
const SUPERSEDED = [/US\$0,76/, /US\$0\.76/, /408 llamadas/];

/** Each claim, the shape it takes in prose, and what the generator says. */
function claims(figures) {
    return [
        { name: 'the planner block: cases', find: /(\bcases\s+)(\d+)/g, groups: [2],
            want: [String(figures.cases)], required: false },
        { name: 'the planner block: model calls',
            find: /(\bmodel calls\s+)(\d+)(\s+\()(\d+)( subject \+ )(\d+)( judge)/g,
            groups: [2, 4, 6],
            want: [String(figures.calls), String(figures.subject), String(figures.judge)],
            required: false },
        { name: 'the planner block: cost ceiling', find: /(cost ceiling\s+)(US\$\d+\.\d\d)/g,
            groups: [2], want: [usdEn(figures.cents)], required: false },
        { name: 'the ceiling in Spanish prose', find: /(\*\*)(US\$\d+,\d\d)(\*\* contra)/g,
            groups: [2], want: [usdEs(figures.cents)], required: false },
        { name: 'the three figures in one sentence',
            // EVERY literal segment is its own capture group. The rebuild below
            // reassembles the match from its groups, so a literal left outside
            // one is silently deleted — which is exactly what happened the
            // first time this ran, turning "204 casos, 408 llamadas, techo
            // US$0,76" into "204612US$1,08".
            find: /(\*\*)(\d+)( casos, )(\d+)( llamadas, techo )(US\$\d+,\d\d)/g,
            groups: [2, 4, 6],
            want: [String(figures.cases), String(figures.calls), usdEs(figures.cents)],
            required: false },
        { name: 'the CERTIFICATION_CANARY summary line',
            find: /(CERTIFICATION_CANARY cases=)(\d+)( calls=)(\d+)( subject=)(\d+)( judge=)(\d+)( cents=)(\d+)/g,
            groups: [2, 4, 6, 8, 10],
            want: [String(figures.cases), String(figures.calls), String(figures.subject),
                String(figures.judge), String(figures.cents)],
            required: false },
    ];
}

function inspect(text, figures) {
    const stale = [];
    let matched = 0;
    let fixed = text;
    for (const claim of claims(figures)) {
        let seen = 0;
        fixed = fixed.replace(claim.find, (...args) => {
            const parts = args.slice(0, -2);
            seen += 1;
            matched += 1;
            claim.groups.forEach((group, index) => {
                if (parts[group] !== claim.want[index]) {
                    stale.push(`${claim.name}: says ${parts[group]}, the planner says ${claim.want[index]}`);
                }
            });
            const rebuilt = parts.slice(1).map((part, offset) => {
                const at = claim.groups.indexOf(offset + 1);
                return at === -1 ? part : claim.want[at];
            }).join('');
            // A rebuild that loses text is worse than no rebuild: it silently
            // mangles the sentence it was meant to correct. So the shape is
            // verified, not assumed — put the ORIGINAL values back and the
            // result must be the match, character for character.
            const roundTrip = parts.slice(1).join('');
            if (roundTrip !== parts[0]) {
                throw new Error(`${claim.name}: the pattern loses text when rebuilt `
                    + '(a literal segment is outside a capture group); refusing to rewrite');
            }
            return rebuilt;
        });
        if (!seen && claim.required) stale.push(`${claim.name}: not present`);
    }
    return { stale, fixed, matched };
}

/** Every markdown file under `docs/`, so nothing hides by not being listed. */
function markdownFiles(dir, found = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            markdownFiles(full, found);
        } else if (entry.name.endsWith('.md')) {
            found.push(path.relative(root, full).split(path.sep).join('/'));
        }
    }
    return found;
}

const FIX = process.argv.includes('--fix');
const figures = plannedFigures();
const problems = [];

console.log(`canary planner: cases=${figures.cases} calls=${figures.calls} `
    + `subject=${figures.subject} judge=${figures.judge} ceiling=${usdEn(figures.cents)}`);

for (const relative of ASSERTING) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) {
        problems.push(`${relative}: listed as asserting the canary and missing from the repository`);
        continue;
    }
    // Newlines normalised before matching: `core.autocrlf` gives a Windows
    // checkout CRLF and a Linux one LF, and a checker that disagrees between
    // the two is a checker nobody trusts.
    const original = fs.readFileSync(file, 'utf8');
    const crlf = original.includes('\r\n');
    const { stale, fixed, matched } = inspect(crlf ? original.split('\r\n').join('\n') : original, figures);
    if (!matched) {
        problems.push(`${relative}: listed as asserting the canary, but quotes no figure in a `
            + 'shape this checker recognises — either it stopped asserting one (remove it from '
            + 'ASSERTING) or it says it in a new shape (teach the checker)');
        continue;
    }
    if (!stale.length) {
        console.log(`${relative}: agrees with the planner (${matched} figure(s))`);
        continue;
    }
    for (const problem of stale) problems.push(`${relative}: ${problem}`);
    if (FIX) {
        fs.writeFileSync(file, crlf ? fixed.split('\n').join('\r\n') : fixed);
        console.log(`${relative}: rewritten from the planner`);
    }
}

// ── And nothing carries a superseded figure without saying why ──────────────
const unclassified = [];
for (const relative of markdownFiles(path.join(root, 'docs'))) {
    if (ASSERTING.includes(relative)) continue;
    const text = fs.readFileSync(path.join(root, relative), 'utf8');
    if (!SUPERSEDED.some(shape => shape.test(text))) continue;
    if (relative in HISTORICAL) {
        console.log(`${relative}: carries the superseded figure on purpose — ${HISTORICAL[relative]}`);
        continue;
    }
    unclassified.push(relative);
}
for (const relative of unclassified) {
    problems.push(`${relative}: carries a superseded canary figure and is in neither list. `
        + 'Say which it is: add it to ASSERTING (and it will be rewritten) or to HISTORICAL '
        + 'with the reason it quotes the old number.');
}

if (!problems.length) {
    console.log('every document either agrees with the generator or says why it quotes an older figure');
    process.exit(0);
}
for (const problem of problems) console.error(`  ${problem}`);
if (FIX) {
    const left = problems.filter(problem =>
        problem.includes('neither list') || problem.includes('shape this checker recognises'));
    console.error(left.length
        ? `${left.length} need a human decision; the rest were rewritten from the planner`
        : 'rewritten from the planner');
    process.exit(left.length ? 1 : 0);
}
console.error(`${problems.length} divergence(s). Run with --fix to rewrite what can be rewritten.`);
process.exit(1);
