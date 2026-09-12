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
 * So EVERY markdown document under `docs/` is read, and the question asked of
 * it is what it SAYS, not what list it is on: a document stating a canary
 * figure is checked against the planner, and one stating a figure the planner
 * no longer produces has to say why — as a whole document (`HISTORICAL`) or as
 * one exact quoted sentence (`QUOTED_SUPERSEDED`). Silence is what let the
 * wrong number travel.
 *
 * It was the other way round, and that is the bug this shape fixes: a document
 * was only classified if it matched a frozen list of the previously-wrong
 * literals, so the three documents quoting the CURRENT figures were checked by
 * nothing, and the day the planner moved they would have gone on quoting a
 * stale ceiling while this script printed "every document agrees".
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
const planner = path.join(root, 'apps/api/scripts/plan-certification-canary.cjs');

/** The authority, asked once. Never re-derived here. */
function plannedFigures() {
    /**
     * The planner registers `ts-node/register/transpile-only` and then requires
     * `../src/...`. ts-node looks for a `tsconfig.json` starting at the CURRENT
     * WORKING DIRECTORY, and this repository has none at its root — every
     * project keeps its own. So from the root the planner fell back to ts-node's
     * defaults and died on `TS5109: Option 'moduleResolution' must be set to
     * 'NodeNext'` before printing a single figure, which `execFileSync` turned
     * into a throw and this checker into a stack trace.
     *
     * That is why nothing had wired this check into CI: it could not run from
     * the one directory CI runs things from. The project is named explicitly
     * rather than by changing directory, because the planner also resolves
     * `@parallext/shared` through the root's `node_modules`.
     */
    const output = execFileSync(process.execPath, [planner], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, TS_NODE_PROJECT: path.join(root, 'apps/api/tsconfig.json') },
    });
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
 * Documents `--fix` is allowed to REWRITE.
 *
 * Listed by hand on purpose: a glob would quietly bind a document nobody meant
 * to bind, and `--fix` would then edit prose nobody meant it to edit.
 *
 * Being on this list is no longer what makes a document CHECKED — every
 * document under `docs/` is checked now, by what it says (see below). This list
 * only answers "may a script rewrite this sentence, or does a person have to?".
 */
const ASSERTING = [
    'docs/audits/2026-09-10/certification-canary.md',
    'docs/audits/2026-09-10/release-closure-report.md',
];

/**
 * Documents allowed to carry a SUPERSEDED figure throughout, because quoting it
 * is their whole subject. Each one says why, and the reason is part of the
 * check: an entry whose document no longer carries an old figure at all has
 * lost its excuse and is reported as dead, so this list cannot silently grow
 * into a blanket exemption.
 */
const HISTORICAL = {
    'docs/audits/2026-09-10/codex-certification-runner-review.md':
        'the independent review that refuted the 408/US$0,76 ceiling',
    'docs/audits/2026-09-10/codex-release-readiness-review.md':
        'the readiness review that refused 408/US$0,76 as a validated ceiling',
    'docs/handoffs/2026-09-10/claude-october-release-parallel-execution.md':
        'the handoff that names US$0,76 as the figure NOT to treat as an authorisation',
};

/**
 * Single SENTENCES allowed to carry an old figure inside a document that is
 * otherwise current.
 *
 * `certification-canary.md` asserts today's figures AND carries the paragraph
 * that records the correction — "Este documento decía **408 llamadas y
 * US$0,76**". A per-document exemption would have to excuse the whole file, and
 * `--fix` would then be free to rewrite the correction into "Este documento
 * decía **612 llamadas y US$1,08**", which is a sentence that says nothing and
 * erases the fact that this document was once wrong.
 *
 * So the exemption is the sentence, quoted exactly. If the document stops
 * containing it the entry is dead and the check says so, which is the property
 * a blanket list does not have.
 */
const QUOTED_SUPERSEDED = {
    'docs/audits/2026-09-10/certification-canary.md': [
        'Este documento decía **408 llamadas y US$0,76**',
    ],
};

/**
 * Figures this programme has RETIRED, kept as a second net.
 *
 * The net is NOT what classifies a document any more — that was the defect.
 * Classification is by what a document asserts, so a file quoting today's
 * figures is checked and goes stale the day the planner changes; this list only
 * catches an old figure written in a shape no claim below recognises.
 *
 * It is verified against the planner rather than frozen: an entry the planner
 * produces again is not superseded, and leaving it here would make the net
 * demand that a CORRECT document explain itself.
 */
const RETIRED = [
    { shape: /US\$0,76/, was: 'the ceiling before the judge call was counted' },
    { shape: /US\$0\.76/, was: 'the same ceiling, in the English rendering' },
    { shape: /408 llamadas/, was: 'the call count before the judge call was counted' },
];

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

        // ── The shapes prose actually uses, rather than the two the planner
        //    block prints ─────────────────────────────────────────────────────
        //
        // The patterns above only recognise the canary's own rendering and one
        // hand-written sentence with `**` around it and commas in exactly the
        // right places. Three documents quoting the CURRENT figures — a batch
        // report, an independent review and a handoff — said them with slashes,
        // with "y" instead of a comma, and with a line break in the middle, so
        // none of them matched and none of them was checked. They were invisible
        // to this file in both directions: nothing said they agreed, and nothing
        // would have said they had stopped agreeing.
        //
        // These three are deliberately anchored on `casos`/`llamadas` rather
        // than on a bare `US$`: a canary document also quotes the FULL MATRIX
        // ceiling, and a pattern loose enough to catch `techo US$677,40` in a
        // neighbouring handoff would be demanding that the full matrix agree
        // with the canary's planner.
        { name: 'casos y llamadas juntos en prosa',
            find: /(\d+)(\s+casos?[,/\s]{0,6})(\d+)([,/\s]{1,6}llamadas)/g,
            groups: [1, 3], want: [String(figures.cases), String(figures.calls)], required: false },
        { name: 'el techo nombrado junto a las llamadas',
            find: /(llamadas[\s/,]{1,8}(?:y\s+)?(?:techo\s+)?\**)(US\$\d+,\d\d)/g,
            groups: [2], want: [usdEs(figures.cents)], required: false },
        { name: 'el techo en centavos junto a las llamadas',
            find: /(llamadas[\s/,]{1,6}(?:y\s+)?)(\d+)( centavos)/g,
            groups: [2], want: [String(figures.cents)], required: false },
    ];
}

function inspect(text, figures, quoted = []) {
    const stale = [];
    let matched = 0;
    let quotedHits = 0;
    let fixed = text;
    for (const claim of claims(figures)) {
        let seen = 0;
        fixed = fixed.replace(claim.find, (...args) => {
            const parts = args.slice(0, -2);
            // A match that sits inside a sentence this document is allowed to
            // quote is left exactly as it is, and does not count as an
            // assertion. Returning the original matters as much as not
            // reporting it: `--fix` runs through this same callback, and a
            // rewrite here would erase the correction the sentence exists to
            // record.
            if (quoted.some(sentence => sentence.includes(parts[0]))) {
                quotedHits += 1;
                return parts[0];
            }
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
    return { stale, fixed, matched, quotedHits };
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

/**
 * Everything below runs only when this file is the program.
 *
 * `plannedFigures()` spawns the planner, which boots ts-node over the whole API
 * tree and takes the better part of a minute; a spec that wants to ask whether a
 * given sentence is recognised must not pay that, and must not spawn anything at
 * all. So the pieces are exported and the CLI is a function — the same pieces the
 * CLI uses, not a copy of them, because a copy is how a checker and its test come
 * to disagree about what the checker does.
 */
function main() {
    const FIX = process.argv.includes('--fix');
    const figures = plannedFigures();
    const problems = [];
    /** Documents this run rewrote AND re-verified. The only basis for saying so. */
    const rewritten = new Set();

    console.log(`canary planner: cases=${figures.cases} calls=${figures.calls} `
        + `subject=${figures.subject} judge=${figures.judge} ceiling=${usdEn(figures.cents)}`);

    // ── The retired ledger has to still be retired ──────────────────────────────
    //
    // Everything the planner says today, in every rendering this file knows how to
    // write, so a RETIRED entry that matches it is caught. Without this the ledger
    // is a frozen list that can outlive the fact it records, and the day the
    // planner produced one of these figures again the net would start demanding
    // that correct documents explain themselves.
    const currentRenderings = `${figures.cases} casos, ${figures.calls} llamadas, `
        + `techo ${usdEs(figures.cents)} / ${usdEn(figures.cents)} / ${figures.cents} centavos; `
        + `cases ${figures.cases} model calls ${figures.calls} `
        + `(${figures.subject} subject + ${figures.judge} judge)`;
    for (const entry of RETIRED) {
        if (entry.shape.test(currentRenderings)) {
            problems.push(`RETIRED ${entry.shape}: the planner produces this figure again `
                + `(${entry.was}), so it is not superseded — remove it from the ledger`);
        }
    }

    // ── Every document under `docs/`, classified by what it SAYS ────────────────
    //
    // This loop used to run only over the two documents in ASSERTING, and a second
    // loop classified the rest by matching a frozen list of the PREVIOUSLY WRONG
    // literals. A document quoting the CURRENT figures matched neither, so it was
    // not checked at all: three of them — a batch report, an independent review and
    // a handoff — each carried "204 casos / 612 llamadas / US$1,08" with nothing
    // watching, and the day the planner moved they would have kept saying it while
    // this script exited 0 and reported that every document agreed.
    //
    // So the question asked of a document is no longer "is it on a list" but "does
    // it state a canary figure". If it does, it is checked. Being on ASSERTING now
    // only decides whether `--fix` may rewrite it or a person must.
    const asserted = [];
    for (const relative of markdownFiles(path.join(root, 'docs'))) {
        const file = path.join(root, relative);
        // Newlines normalised before matching: `core.autocrlf` gives a Windows
        // checkout CRLF and a Linux one LF, and a checker that disagrees between
        // the two is a checker nobody trusts.
        const original = fs.readFileSync(file, 'utf8');
        const crlf = original.includes('\r\n');
        const text = crlf ? original.split('\r\n').join('\n') : original;

        const quoted = QUOTED_SUPERSEDED[relative] ?? [];
        for (const sentence of quoted) {
            if (!text.includes(sentence)) {
                problems.push(`${relative}: QUOTED_SUPERSEDED names a sentence this document no longer `
                    + `contains (${JSON.stringify(sentence)}) — the exemption is dead, remove it`);
            }
        }

        const { stale, fixed, matched, quotedHits } = inspect(text, figures, quoted);
        // ── THE EXEMPTION IS THE SENTENCE, NOT THE DOCUMENT ──────────────
        //
        // Asking whether a retired figure appears anywhere in an exempt
        // sentence exempts EVERY occurrence of it in the file. That is how
        // certification-canary.md kept a live `US$0,76` at line 86 on the
        // strength of a sentence at line 39 that quotes the old figure in order
        // to say it was wrong. The exempt sentences are cut out first, so what
        // remains is every occurrence nobody excused.
        const unexcused = quoted.reduce(
            (rest, sentence) => rest.split(sentence).join(' '), text);
        const retired = RETIRED.filter(entry => entry.shape.test(unexcused));
        const historical = relative in HISTORICAL;

        if (!matched && !quotedHits && !retired.length) continue;  // says nothing about the canary
        asserted.push(relative);

        if (historical) {
            console.log(`${relative}: carries a superseded figure on purpose — ${HISTORICAL[relative]}`);
            continue;
        }
        if (stale.length) {
            for (const problem of stale) problems.push(`${relative}: ${problem}`);
            if (FIX && ASSERTING.includes(relative)) {
                fs.writeFileSync(file, crlf ? fixed.split('\n').join('\r\n') : fixed);
                // ── SAY "REWRITTEN" ONLY ABOUT A DOCUMENT THAT WAS ──────────
                //
                // Re-read through the same inspection rather than trusting the
                // write. `--fix` exists to be believed by whoever runs it, and
                // a rewrite that left a divergence behind - a figure in a shape
                // the replacer does not reach, say - would otherwise be
                // announced as a fix and exit 0.
                const after = inspect(fixed, figures, quoted);
                if (after.stale.length) {
                    for (const problem of after.stale) {
                        problems.push(`${relative}: SURVIVED --fix — ${problem}. The rewrite did not `
                            + 'reach it; this needs a human.');
                    }
                } else {
                    rewritten.add(relative);
                    console.log(`${relative}: rewritten from the planner`);
                }
            } else if (!ASSERTING.includes(relative)) {
                problems.push(`${relative}: states a canary figure the planner no longer produces and is `
                    + 'in no list. Say which it is: ASSERTING (and `--fix` rewrites it), HISTORICAL with '
                    + 'the reason the whole document quotes the old number, or QUOTED_SUPERSEDED with the '
                    + 'exact sentence that may keep it.');
            }
            continue;
        }
        // ── A RETIRED FIGURE IS A PROBLEM, NOT A CURIOSITY ──────────────────
        //
        // `retired` was computed and then used for exactly one thing: deciding
        // whether the document said anything at all. A file whose only canary
        // content was a superseded figure therefore reached the bottom of this
        // loop and printed "agrees with the planner (0 figure(s))" — a sentence
        // that is false twice over — and `--check` exited 0. Reproduced with a
        // probe asserting `US$0,76`, the figure this programme retired.
        //
        // It has to be the other way round: a retired figure with no current
        // one beside it is a document quoting yesterday's number as if it were
        // today's, which is the whole subject of this file. HISTORICAL and
        // QUOTED_SUPERSEDED are the two ways to say it is deliberate, and both
        // are checked above this line.
        // Not `&& !matched`: a document that states BOTH the retired figure and
        // the current one is not safer, it contradicts itself on the same page
        // — which is exactly how certification-canary.md came to say US$1,08 at
        // line 33 and US$0,76 at line 86 while this checker called it agreed.
        if (retired.length) {
            problems.push(`${relative}: states ${retired.map(entry => entry.was).join(', ')}, which `
                + 'this programme retired, in a sentence nobody exempted. Either it is quoting an '
                + 'old number on purpose — HISTORICAL with the reason, or QUOTED_SUPERSEDED with the '
                + 'exact sentence — or it is stale and has to be rewritten from the planner.');
            continue;
        }

        // A document on ASSERTING that no longer states anything this checker can
        // read is the silent-drift case the list exists to prevent.
        if (ASSERTING.includes(relative) && !matched) {
            problems.push(`${relative}: listed as asserting the canary, but quotes no figure in a `
                + 'shape this checker recognises — either it stopped asserting one (remove it from '
                + 'ASSERTING) or it says it in a new shape (teach the checker)');
            continue;
        }
        // `matched` can be zero here only when every figure in the document is
        // an exempt quotation; saying "agrees with the planner (0 figure(s))"
        // in that case reads as a pass on something nobody checked.
        console.log(matched
            ? `${relative}: agrees with the planner (${matched} figure(s)`
                + `${quotedHits ? `, ${quotedHits} cita(s) histórica(s) exenta(s)` : ''})`
            : `${relative}: quotes ${quotedHits} superseded figure(s), each exempted by name`);
    }

    // A document on a list and not on disk is a list nobody maintained.
    for (const relative of [...ASSERTING, ...Object.keys(HISTORICAL), ...Object.keys(QUOTED_SUPERSEDED)]) {
        if (!fs.existsSync(path.join(root, relative))) {
            problems.push(`${relative}: classified by this checker and missing from the repository`);
        }
    }
    // And an excuse that is no longer needed is an excuse that will cover the next
    // mistake instead.
    for (const relative of Object.keys(HISTORICAL)) {
        if (fs.existsSync(path.join(root, relative)) && !asserted.includes(relative)) {
            problems.push(`${relative}: listed as HISTORICAL but carries no canary figure at all — the `
                + 'exemption is dead and would silently cover the next figure written into this file');
        }
    }

    if (!problems.length) {
        console.log('every document either agrees with the generator or says why it quotes an older figure');
        process.exit(0);
    }
    for (const problem of problems) console.error(`  ${problem}`);
    if (FIX) {
        // ── WHAT IS LEFT IS WHAT WAS NOT WRITTEN ────────────────────────────
        //
        // This used to be an ALLOWLIST of problem phrasings that "need a
        // human", and every problem outside the list was assumed to have been
        // fixed. A retired figure with no current one beside it is reported
        // from a branch that writes nothing and phrases itself in none of those
        // ways, so `--fix` printed "rewritten from the planner" and exited 0
        // over a document it had not touched. Reproduced with a probe
        // asserting `US$0,76`: stale empty, retired matched, zero writes, exit 0.
        //
        // So the question is asked the other way round, from the ledger of
        // documents this run actually rewrote AND re-verified. A problem about
        // a file nobody wrote is a problem that is still there, whatever it
        // says about itself — which is the same correction the restore script
        // needed: a positive statement about what this run did, not an
        // inference from what it did not complain about.
        const left = problems.filter(problem => !rewritten.has(problem.split(':')[0]));
        console.error(left.length
            ? `${left.length} still diverge and were NOT rewritten; ${rewritten.size} document(s) were`
            : `rewritten from the planner (${rewritten.size} document(s))`);
        process.exit(left.length ? 1 : 0);
    }
    console.error(`${problems.length} divergence(s). Run with --fix to rewrite what can be rewritten.`);
    process.exit(1);
}

module.exports = {
    claims, inspect, markdownFiles, plannedFigures, usdEn, usdEs,
    ASSERTING, HISTORICAL, QUOTED_SUPERSEDED, RETIRED, root,
};

if (require.main === module) main();
