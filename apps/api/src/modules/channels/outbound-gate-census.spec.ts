import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * ═══ ZERO CHARGEABLE WHATSAPP PRODUCERS OUTSIDE THE ECONOMIC BOUNDARY ═══
 *
 * From 1 October 2026 every delivered WhatsApp service message is a charge on
 * the tenant's own WABA. "How many places can send one without asking" stopped
 * being an architecture question and became a bill.
 *
 * The number has to be zero, and a number that has to stay at zero needs a
 * check that FAILS rather than a document that ages. These tests are about the
 * check itself, because a green check that cannot go red is worse than no check
 * at all: it teaches everybody that the property is guarded when it is not.
 *
 * So the mutations here are deliberate and unkind. A new file that posts to
 * Meta must be caught. A gate that exists only in a comment must not count. A
 * gate deleted from a sink must turn every producer behind it red. Each of
 * those is run for real, against the real sweep, and the assertion is that the
 * check notices.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT = resolve(ROOT, 'apps', 'api', 'scripts', 'outbound-producer-inventory.cjs');
const API_SRC = resolve(ROOT, 'apps', 'api', 'src');

// A .cjs script, loaded the way the command line loads it. Importing it
// would compile a copy; requiring it exercises the file CI runs.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const inventory = require(SCRIPT);

/**
 * The October rows, so a mutation of the census can be followed all the way
 * to the closure row it is supposed to move. The generator asks these the
 * same way; the loaders it passes are reproduced here rather than imported,
 * because importing the generator would run it and write the artefact.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const october = require(resolve(ROOT, 'docs', 'audits', '2026-09-09', 'meta-october-rows.cjs'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const apiModule = (name: string) => require(resolve(API_SRC, name));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharedModule = require(resolve(ROOT, 'packages', 'shared', 'src', 'index.ts'));

/** The census, recomputed from the source tree — never from the committed report. */
function census() {
    return inventory.gateCensus(inventory.collect());
}

describe('the economic boundary', () => {
    it('leaves no chargeable WhatsApp producer outside it', () => {
        const { bypasses } = census();
        // Named, not counted: a failure here has to say WHERE, or the next
        // person reads "expected 1 to be 0" and has to redo the whole sweep.
        expect(bypasses.map((row: any) => `${row.file}:${row.line} (${row.method}) → `
            + `${row.terminus || 'unresolved'}`)).toEqual([]);
    });

    it('leaves no provider egress without either an admission or a declared road', () => {
        const { ungatedEgress } = census();
        expect(ungatedEgress.map((entry: any) => `${entry.file}:${entry.line} — ${entry.what}`))
            .toEqual([]);
    });

    it('resolves every chargeable producer to a real sink, never to "unresolved"', () => {
        // Unresolved is not a neutral state. A producer whose sink the script
        // cannot name is a producer nobody can prove is gated, so the check
        // counts it as a violation — and this test makes sure the tree never
        // quietly fills up with them.
        const chargeable = census().classified.filter((row: any) => row.needsGate);
        expect(chargeable.length).toBeGreaterThan(0);
        for (const row of chargeable) {
            expect({ at: `${row.file}:${row.line}`, terminus: row.terminus })
                .toEqual({ at: `${row.file}:${row.line}`, terminus: expect.any(String) });
        }
    });
});

describe('the check can actually go red', () => {
    /**
     * A file that sends, written into the real tree for the length of one test.
     *
     * This is the mutation that matters most: somebody adds a service that posts
     * to Meta directly, which is exactly how the twenty-six bypasses appeared in
     * the first place. Running it through the real sweep — not a fixture, not a
     * hand-made row — is the only way to know the sweep would have caught them.
     */
    const PROBE_REL = 'modules/channels/gate-census-probe.generated.ts';
    const PROBE = resolve(API_SRC, 'modules', 'channels', 'gate-census-probe.generated.ts');

    /** Runs the real sweep over a tree that contains `text` at `PROBE_REL`. */
    const withProbe = (text: string) => inventory.withSourceOverlay(
        [{ app: 'api', rel: PROBE_REL, text }], () => census());

    const probeViolations = (text: string) => withProbe(text).ungatedEgress
        .filter((entry: any) => entry.file.endsWith('gate-census-probe.generated.ts'));

    const UNGATED = `// Temporary fixture written by outbound-gate-census.spec.ts.
export class GateCensusProbeService {
    async send(phoneNumberId: string, token: string, to: string): Promise<void> {
        await fetch(\`https://graph.facebook.com/v21.0/\${phoneNumberId}/messages\`, {
            method: 'POST',
            headers: { Authorization: \`Bearer \${token}\` },
            body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text' }),
        });
    }
}
`;

    afterEach(() => rmSync(PROBE, { force: true }));

    it('reports a new file that posts to Meta with no admission', () => {
        const found = probeViolations(UNGATED);
        expect(found.length).toBe(1);
        expect(found[0].what).toContain('messages');
    });

    it('does not accept an admission that exists only in a comment', () => {
        // The failure this prevents: a check that greps the whole file text goes
        // green on `// TODO: call this.admitSpend(...)`. The gate is read from
        // code with comments and template literals stripped, so prose proves
        // nothing — and the only way to be sure of that is to write the prose.
        expect(probeViolations(UNGATED.replace('export class', [
            '// Later: this.admitSpend({ tenantId, channelType: \'whatsapp\' });',
            '/* and spend gate wiring: spendGate.admit(request) */',
            'const NOTE = `this.gateOrSuppress(outbound, \'probe\')`;',
            'void NOTE;',
            'export class',
        ].join('\n'))).length).toBe(1);
    });

    it('accepts it once the admission is a real call', () => {
        expect(probeViolations(UNGATED.replace(
            '        await fetch(',
            '        const admission = await this.admitSpend({ to });\n'
            + '        if (admission === null) return;\n'
            + '        await fetch(')).length).toBe(0);
    });

    it('names a loop fan-out as ONE ADMISSION, MANY SENDS rather than as ungated', () => {
        // The consequence, through the command CI runs. A probe that gates
        // properly and then sends inside a loop is not an ungated file, and
        // being told it is would send somebody to add a second gate.
        const BT = String.fromCharCode(96);
        writeFileSync(PROBE, [
            '// Temporary fixture written by outbound-gate-census.spec.ts.',
            'export class GateCensusLoopProbeService {',
            '    async send(ids: string[], to: string): Promise<void> {',
            '        const admission = await this.admitSpend({ to });',
            '        if (!admission) return;',
            '        for (const id of ids) {',
            '            await fetch(' + BT + 'https://graph.facebook.com/v21.0/${id}/messages' + BT + ', {});',
            '        }',
            '    }',
            '    private async admitSpend(_input: unknown): Promise<boolean> { return true; }',
            '}',
            '',
        ].join(String.fromCharCode(10)), 'utf8');

        const out = mkdtempSync(join(tmpdir(), 'gate-census-loop-'));
        let status = 0;
        let stderr = '';
        try {
            execFileSync(process.execPath, [SCRIPT, '--check', '--out', join(out, 'inventory.md')],
                { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (error: any) {
            status = error.status;
            stderr = String(error.stderr || '');
        } finally {
            rmSync(out, { recursive: true, force: true });
        }
        expect(status).toBe(1);
        expect(stderr).toContain('ONE ADMISSION, MANY SENDS');
        expect(stderr).toContain('gate-census-probe.generated.ts');
        // The instruction has to be the RIGHT one.
        expect(stderr).toContain('move the admission inside the loop');
        expect(stderr).not.toContain('with no admission call');
    });

    it('exits non-zero, and names the file, when a violation exists', () => {
        // The unit above proves the classification. This proves the CONSEQUENCE:
        // the command CI runs actually fails. A census that finds a violation
        // and exits 0 stops nothing.
        //
        // The ONE case here that still writes to the tree, because it has to:
        // `--check` is a separate process and cannot see an in-memory overlay.
        // What it writes is an ADDED file, never a mutation of a shipped one,
        // its name is in `.gitignore`, and a survivor is by construction what
        // this very census reports — so it announces itself three ways.
        writeFileSync(PROBE, UNGATED, 'utf8');
        const out = mkdtempSync(join(tmpdir(), 'gate-census-'));
        let status = 0;
        let stderr = '';
        try {
            execFileSync(process.execPath, [SCRIPT, '--check', '--out', join(out, 'inventory.md')],
                { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (error: any) {
            status = error.status;
            stderr = String(error.stderr || '');
        } finally {
            rmSync(out, { recursive: true, force: true });
        }
        expect({ status, named: stderr.includes('gate-census-probe.generated.ts') })
            .toEqual({ status: 1, named: true });
    });
});

describe('one admission covers one POST, and it comes first', () => {
    /**
     * ═══ PRESENCE WAS NOT DOMINANCE, AND ONE WAS NOT TWO ═══
     *
     * The census asked "does this file contain a gate call anywhere?". Two
     * things pass that and must not: a gate in a DIFFERENT method from the
     * POST, and a SECOND POST behind one admission. The second is not
     * hypothetical — it is exactly what the Flow text fallback turned out to
     * be: one reservation, two messages on a customer's phone, two charges, and
     * a row that can only settle once.
     *
     * These run against the real matcher, on synthetic files, because the
     * property is about ORDER and COUNT rather than about any particular sink.
     */
    const gate = '        const admission = await this.admitSpend({ to });';
    const post = '        await fetch(`https://graph.facebook.com/v21.0/${id}/messages`, {});';

    const uncovered = (lines: string[]) => {
        const text = lines.join(String.fromCharCode(10));
        const egressLines: number[] = [];
        lines.forEach((line, index) => { if (line.includes('/messages`')) egressLines.push(index + 1); });
        return inventory.egressCredits(text, egressLines);
    };

    it('accepts an admission that precedes its POST', () => {
        expect(uncovered([gate, post])).toEqual([]);
    });

    it('refuses a gate that runs AFTER the POST it is supposed to authorise', () => {
        // Reserving afterwards is a record of money already spent, not a limit
        // on spending it — and reading downward is how everybody checks.
        expect(uncovered([post, gate])).toEqual([1]);
    });

    it('refuses a SECOND POST behind one admission', () => {
        // The one that matters. The file is gated, the first send is covered,
        // and the second is a charge nothing authorised.
        expect(uncovered([gate, post, post])).toEqual([3]);
    });

    it('accepts two POSTs when each has its own admission', () => {
        expect(uncovered([gate, post, gate, post])).toEqual([]);
    });

    it('reads a gate and a POST on one line as one act', () => {
        // `if (await this.admitSpend(x)) return post(x)` is an authorisation
        // and its send, written together. Ordering them by line alone would
        // read the send as first and call it uncovered.
        expect(uncovered(['        if (await this.admitSpend({ to })) '
            + 'await fetch(`https://graph.facebook.com/v21.0/${id}/messages`, {});'])).toEqual([]);
    });

    it('reports a POST inside a LOOP whose admission is outside it', () => {
        // The claim the docblock above `egressCredits` had made all along and
        // the walk did not keep: "a loop that sends twice behind one admission
        // is reported". It was not. The walk knew about function frames and
        // nothing else, so one credit paid for a POST that runs N times —
        // one reservation settling N charges, which the ledger cannot do.
        expect(uncovered([gate, 'for (const id of ids) {', post, '}'])).toEqual([3]);
        expect(uncovered([gate, 'while (await this.hasMore()) {', post, '}'])).toEqual([3]);
        // `do` has no parenthesised head; its `while` is at the other end.
        expect(uncovered([gate, 'do {', post, '} while (more);'])).toEqual([3]);
    });

    it('still accepts a gate INSIDE the loop, which runs once per iteration', () => {
        // The half that keeps this from being a check that blocks honest code.
        // A gate in the loop body is a gate per send; what is reported is
        // crossing OUT of a loop to find the credit, not the loop itself.
        expect(uncovered(['for (const id of ids) {', gate, post, '}'])).toEqual([]);
        expect(uncovered(['for (const a of as) {', 'for (const b of bs) {',
            gate, post, '}', '}'])).toEqual([]);
        // And the mixed case: gated in the outer loop, sending in the inner.
        expect(uncovered(['for (const a of as) {', gate,
            'for (const b of bs) {', post, '}', '}'])).toEqual([4]);
    });

    it('reads a condition that CALLS something as a condition', () => {
        // `opensFunction` forbade a nested `(` inside the keyword's
        // parentheses, so `if (this.isReady(id)) {` — a condition that calls
        // something, which is most of them — fell through to the signature
        // fallback and became a FUNCTION frame. That put the method's own
        // credits out of reach of its own POST and reported a properly gated
        // send. A check whose failures are wrong is one people re-baseline.
        expect(uncovered([gate, 'if (this.isReady(id)) {', post, '}'])).toEqual([]);
        expect(uncovered([gate, 'if (ok) {', post, '}'])).toEqual([]);
        expect(uncovered([gate, 'switch (this.kindOf(x)) {', 'case 1:', post, '}'])).toEqual([]);
        expect(uncovered(['try {', gate, '} catch (error: any) { return; }', post])).toEqual([]);
        // And a real function signature is still a function frame, so a gate
        // before a callback does not pay for a POST inside it.
        expect(uncovered(['async send(to: string): Promise<void> {', gate, post, '}'])).toEqual([]);
    });

    it('finds the keyword that owns the brace, not only the first on the line', () => {
        // Both classifiers were anchored to the start of the text, which is
        // right for almost every line in this tree and wrong for the ones that
        // are not. The three shapes below were all misread, and they fail in
        // OPPOSITE directions — which is why one test is not enough.

        // Over-report: a statement before the condition made the `if` a
        // FUNCTION frame, putting the method's own credit out of reach of its
        // own POST and failing a properly gated send.
        expect(uncovered([gate, 'const n = xs.length; if (this.isReady(id)) {', post, '}']))
            .toEqual([]);

        // Under-report, and the direction that costs money: a guarded loop was
        // not a loop, so a fan-out behind one admission passed. This shape is
        // in `compliance.service.ts` today.
        expect(uncovered([gate, 'if (ready) for (const x of xs) {', post, '}']))
            .toEqual([3]);
        expect(uncovered([gate, '} else if (a) for (const x of xs) {', post, '}']))
            .toEqual([3]);
        expect(uncovered([gate, 'let i = 0; do {', post, '} while (more);']))
            .toEqual([3]);
    });

    it('says WHICH mistake it is, because the two have different fixes', () => {
        // The walk already knew: `spend()` distinguishes "no credit at all"
        // from "a credit found outside a loop". It was thrown away at the
        // call site, so a loop that admits once and sends N times was
        // reported as having "no admission call" — which is false, and tells
        // somebody to add a gate they already have. This suite treats a
        // violation message that misdescribes the defect as a defect one sink
        // over; it is one here too.
        const loop = inventory.egressCoverage(
            [gate, 'for (const id of ids) {', post, '}'].join(String.fromCharCode(10)), [3]);
        expect(loop.uncovered).toEqual([3]);
        expect(loop.reasons.get(3)).toBe('repeats');

        // A genuinely ungated send keeps the original diagnosis.
        const bare = inventory.egressCoverage(post, [1]);
        expect(bare.reasons.get(1)).toBe('ungated');

        // And a SECOND post behind one admission is 'ungated' rather than
        // 'repeats': the credit is simply spent, there is no loop, and the
        // fix really is another admission.
        const twice = inventory.egressCoverage(
            [gate, post, post].join(String.fromCharCode(10)), [2, 3]);
        expect(twice.reasons.get(3)).toBe('ungated');
    });

    it('does not read the SECOND HALF of a condition as a signature', () => {
        // A multi-line `if (a` / `    && b) {` puts the closing half on its own
        // line, where no keyword is in sight, and the signature fallback read
        // `&& b) {` as a function frame — putting the method's own credits out
        // of reach of its own POST and failing a properly gated send.
        expect(uncovered(['async send(id: string) {', gate,
            'if (this.isReady(id)', '    && ok) {', post, '}', '}'])).toEqual([]);
        expect(uncovered(['async send(id: string) {', gate,
            'if (a', '    || b) {', post, '}', '}'])).toEqual([]);

        // And a real multi-line SIGNATURE is still a function: its closing line
        // begins with `)`, not with an operator, which is the whole difference.
        expect(uncovered(['async send(', '    to: string,', '): Promise<void> {',
            gate, post, '}'])).toEqual([]);
    });

    it('still lets a gate inside a GUARDED loop pay for its own send', () => {
        // The half that keeps the widening from being a new false-positive
        // generator: what is reported is crossing OUT of a loop, and a guard
        // in front of the loop changes nothing about that.
        expect(uncovered(['if (ready) for (const x of xs) {', gate, post, '}'])).toEqual([]);
    });

    it('does not let a gate in another method cover a POST', () => {
        // Presence, not dominance. The file contains both; the send path
        // touches neither.
        expect(uncovered([post, '    }', '    async elsewhere() {', gate, '    }'])).toEqual([1]);
    });

    it('catches a second POST added inside an already-gated sink', () => {
        // The probe the census did not have: not a NEW ungated file, which it
        // already catches, but one more send inside a file that is already
        // marked green. That is how a fallback, a retry or a "just also notify
        // them" line becomes a second charge nobody sees.
        const SECOND_POST_REL = 'modules/channels/gate-census-second-post.generated.ts';
        const GATED_TWICE = `// Temporary fixture written by outbound-gate-census.spec.ts.
export class GateCensusSecondPostService {
    async send(id: string, to: string): Promise<void> {
        const admission = await this.admitSpend({ to });
        if (!admission) return;
        await fetch(\`https://graph.facebook.com/v21.0/\${id}/messages\`, { method: 'POST' });
        // And one more, behind the same admission.
        await fetch(\`https://graph.facebook.com/v21.0/\${id}/messages\`, { method: 'POST' });
    }
    private async admitSpend(_input: unknown): Promise<boolean> { return true; }
}
`;
        const found = inventory.withSourceOverlay(
            [{ app: 'api', rel: SECOND_POST_REL, text: GATED_TWICE }],
            () => census(),
        ).ungatedEgress.filter((entry: any) => entry.file.endsWith('gate-census-second-post.generated.ts'));
        // One violation, not two: the first send is properly covered.
        expect(found.length).toBe(1);
    });
});

describe('the gate the sinks are checked against', () => {
    it('is a call the sink files really contain', () => {
        // Re-derived here instead of trusting the census: if both the script and
        // this test asked the script the same question, they would agree about a
        // wrong answer. The evidence is the file on disk.
        const sinks = [...new Set(census().classified
            .filter((row: any) => row.needsGate).map((row: any) => row.terminus))] as string[];
        expect(sinks.length).toBeGreaterThan(0);
        for (const sink of sinks) {
            const code = inventory.codeOnly(readFileSync(resolve(API_SRC, sink), 'utf8'));
            expect({ sink, asks: inventory.GATE_CALLS.some((call: string) => code.includes(call)) })
                .toEqual({ sink, asks: true });
        }
    });

    it('names every road it lets through, with the reason', () => {
        // A road is an exemption unless somebody has to write down why. Each one
        // must carry a sentence, and the sentence has to be a sentence — an
        // empty string would pass a truthiness check and say nothing.
        for (const [file, reason] of Object.entries(inventory.PROVIDER_ROADS) as [string, string][]) {
            expect({ file, reason: reason.length > 30 }).toEqual({ file, reason: true });
        }
    });
});

describe('a gate deleted from a REAL sink', () => {
    /**
     * ═══ THE MUTATION THE SUITE CLAIMED AND NEVER RAN ═══
     *
     * The header of this file says "a gate deleted from a sink must turn every
     * producer behind it red". Every mutation above ADDS a file; none removed a
     * gate from a sink that already exists, and that is the one the census got
     * wrong: it asked "does this file contain a gate call anywhere?", and
     * `outbound-queue.processor.ts` contains several across distinct lanes.
     * Deleting the one that guards the durable send path left the answer
     * yes, the census reported zero producers outside the boundary, and every
     * AI reply on every tenant would have gone to Meta unauthorised.
     *
     * So this runs the real sweep over a tree where that gate is gone. It is
     * the only test here that can tell a dominance check from a grep.
     *
     * ── WHY THE TREE IS NEVER WRITTEN ───────────────────────────────────────
     *
     * The first version did this by writing the mutated processor over the real
     * file and restoring it in a `finally`. A `finally` does not run for a
     * SIGKILL, a killed jest worker, or a machine that loses power — and what
     * survives is the file that dispatches every AI reply calling a method that
     * does not exist, in a repository where a parallel session's `git add -A`
     * is a recorded incident. The value of the test was never worth that.
     *
     * `withSourceOverlay` gives the census the mutated text in memory. The
     * sweep is the same sweep; the disk is not involved, so there is nothing to
     * restore and nothing that can fail to be restored.
     */
    const SINK_REL = 'modules/channels/outbound-queue.processor.ts';
    const SINK = resolve(API_SRC, 'modules', 'channels', 'outbound-queue.processor.ts');
    const GATE = 'admission = await this.admitSpend({';

    /** Runs `work` against a tree where that one gate call is gone. */
    function withoutTheDurableGate<T>(work: () => T): T {
        const original = readFileSync(SINK, 'utf8');
        if (!original.includes(GATE)) throw new Error('the gate call site moved; update this test');
        return inventory.withSourceOverlay([{
            app: 'api',
            rel: SINK_REL,
            text: original.replace(GATE, 'admission = await this.noGateAtAll({'),
        }], work);
    }

    it('leaves the real file byte-for-byte alone while it does that', () => {
        // The property that matters more than any assertion below it: this
        // suite cannot damage the send path, whatever happens to the process.
        const before = readFileSync(SINK, 'utf8');
        withoutTheDurableGate(() => census());
        expect(readFileSync(SINK, 'utf8')).toBe(before);
        // And during, too — the mutation must be invisible to anything reading
        // the disk, which is what a concurrent `git add` is doing.
        withoutTheDurableGate(() => expect(readFileSync(SINK, 'utf8')).toBe(before));
    });

    it('turns the sink itself from gated to not gated', () => {
        expect(inventory.sinkVerdict('modules/channels/outbound-queue.processor.ts').fullyGated)
            .toBe(true);
        const after = withoutTheDurableGate(() => {
            // The memo is per-run and `gateCensus` clears it; ask through a run.
            census();
            return inventory.sinkVerdict('modules/channels/outbound-queue.processor.ts');
        });
        // It still ASKS — seven other gates remain — and that is precisely why
        // presence was never the question. What changed is that its provider
        // egress is no longer covered by any of them.
        expect({ hasGate: after.hasGate, fullyGated: after.fullyGated, uncovered: after.uncovered })
            .toEqual({ hasGate: true, fullyGated: false, uncovered: [expect.any(Number)] });
    });

    it('turns every producer behind it into a violation, in the same run', () => {
        expect(census().bypasses).toEqual([]);
        const bypasses = withoutTheDurableGate(() => census().bypasses);
        // Named rather than counted: the point is WHICH producers lose cover,
        // and the answer has to include the lane that serves every tenant today.
        // Named by FILE, not by file:line. A line number here is a second
        // place to update every time an unrelated edit shifts the file, and a
        // test that fails for that reason teaches people to re-baseline it —
        // which is how a check stops being believed.
        const files = new Set(bypasses.map((row: any) => row.file));
        expect(bypasses.length).toBeGreaterThan(5);
        expect([...files]).toContain('modules/conversations/conversations.service.ts');
        for (const row of bypasses) {
            expect(row.terminus).toBe('modules/channels/outbound-queue.processor.ts');
        }
    });

    it('says which way the sink failed, not just that it failed', () => {
        // "does not ask the money authority" would be a lie here: it asks seven
        // times. A violation message that misdescribes the defect sends the next
        // person to add a gate that is already there.
        const rows = withoutTheDurableGate(() => census().bypasses);
        expect(rows[0].terminusUncovered.length).toBeGreaterThan(0);
    });

    it('makes the closure row that is NAMED after authorisation go red', () => {
        // ═══ THE ROW HAS TO REACT TO ITS OWN QUESTION ═══
        //
        // R6's criterion is textual: no WhatsApp producer may generate a
        // delivery outside the applicable authorisation. Its counter used to
        // be `offDurable + bypasses` — a lane membership added to an
        // authorisation failure — so it read seven while the authorisation
        // itself was fully covered, and it would have read seven whether or
        // not a gate existed anywhere.
        //
        // Now it is `bypasses`, which is the property it names. That change
        // LOWERED a counter from seven to zero and moved the row from open to
        // blocked, so the number needs a guard that a sentence cannot give
        // it: delete the gate from the real sink and the row must go red. A
        // counter that cannot be made non-zero is not a measurement.
        const rowsFor = () => {
            const authorities = october.octoberAuthorities({ root: ROOT, api: apiModule, shared: sharedModule });
            return october.octoberRows((id: string, entry: any) => ({ id, ...entry }), authorities);
        };
        const r6 = (rows: any[]) => rows.find(entry => entry.id === 'R6')!;

        // At HEAD every durable send passes the money authority, so nothing is
        // outside it and the row waits on its external gates.
        const atHead = r6(rowsFor());
        expect(atHead.open).toBe(0);
        expect(atHead.gates.length).toBeGreaterThan(0);

        // With that one gate gone, every producer behind it is unauthorised
        // and the row says so.
        const mutated = r6(withoutTheDurableGate(rowsFor));
        expect(mutated.open).toBeGreaterThan(0);
        expect(String(mutated.openLabel)).toContain('autorización aplicable');

        // R0 and R4 now have no legacy lane left either. They are local
        // implementation rows, so zero means accepted without inventing an
        // external gate that their criteria never named.
        const rows = rowsFor();
        for (const id of ['R0', 'R4']) {
            const entry = rows.find((candidate: any) => candidate.id === id)!;
            expect(entry.open).toBe(0);
            expect(entry.gates ?? []).toEqual([]);
        }
    });

    it('goes back to zero when the gate comes back', () => {
        withoutTheDurableGate(() => census());
        expect(census().bypasses).toEqual([]);
        expect(census().ungatedEgress).toEqual([]);
    });
});

describe('the line numbers the audit publishes', () => {
    it('are the lines the sends are really on', () => {
        // Every stripper used to collapse what it removed onto one line, so a
        // forty-line block comment moved every coordinate after it forty lines
        // up. The whole output of this script is `file:line`, so the report, the
        // violation message and the dominance walk were all quoting positions
        // that do not exist in the file anybody opens.
        const raw = readFileSync(resolve(API_SRC, 'modules', 'channels',
            'outbound-queue.processor.ts'), 'utf8').split(/\r?\n/);
        const sends = census().egress
            .filter((entry: any) => entry.file.endsWith('outbound-queue.processor.ts'));
        expect(sends.length).toBeGreaterThan(0);
        for (const entry of sends) {
            const line = raw[entry.line - 1] || '';
            expect({ at: entry.line, sends: /sendStrict\(|sendMessage\(|\/messages/.test(line) })
                .toEqual({ at: entry.line, sends: true });
        }
    });

    it('survive a multi-line template literal between the gate and the POST', () => {
        // The two strippers disagreed by different amounts — one collapsed
        // template literals, the other kept them — so in a file full of
        // multi-line SQL the gate lines and the egress lines were being compared
        // in two different coordinate systems. A gate that runs AFTER its POST
        // could land before it in the merged order and be read as authorising it.
        // A backtick built rather than written, so this fixture can describe a
        // template literal without ending the one it lives in.
        const BT = String.fromCharCode(96);
        const LITERAL_REL = 'modules/channels/gate-census-literal.generated.ts';
        const SOURCE = [
            '// Temporary fixture written by outbound-gate-census.spec.ts.',
            'export class GateCensusLiteralService {',
            '    async send(id: string, to: string): Promise<void> {',
            '        const sql = ' + BT + '',
            '            SELECT one, two, three',
            '            FROM somewhere',
            '            WHERE id = $1',
            '        ' + BT + ';',
            '        void sql; void to;',
            '        await fetch(' + BT + 'https://graph.facebook.com/v21.0/${id}/messages' + BT + ', {});',
            '        const admission = await this.admitSpend({ to });',
            '        void admission;',
            '    }',
            '    private async admitSpend(_input: unknown): Promise<boolean> { return true; }',
            '}',
            '',
        ].join('\n');
        const found = inventory.withSourceOverlay(
            [{ app: 'api', rel: LITERAL_REL, text: SOURCE }], () => census(),
        ).ungatedEgress.filter((entry: any) => entry.file.endsWith('gate-census-literal.generated.ts'));
        // The gate is BELOW the POST, so the POST is uncovered — and the
        // line it is reported at is the line it is written on.
        expect(found.map((entry: any) => entry.line)).toEqual([10]);
    });
});

describe('the durable lane has an entrance, and the sweep can see it', () => {
    /**
     * ═══ A ROAD REDIRECTS THE QUESTION; IT MUST NEVER DROP IT ═══
     *
     * `proactive-dispatch.service.ts` is declared a ROAD, and the contract of
     * that list — written in the script and in the tests below — is that the
     * question moves one level up to whoever chose to use the road. It was
     * being dropped instead: no primitive matched `proactive.send(`, so not one
     * of its call sites was classified at all. Ten billable WhatsApp producers
     * were already through it and the census counted twenty-one call sites
     * without them. A probe file that reached Meta through it came back
     * absent from the producer list, absent from the bypasses and absent from
     * the ungated-egress sweep: 0 / 0 / 0.
     *
     * Three of the primitives that fix it are receiver NAMES, which is exactly
     * how the blind spot was born — so the name is also checked against the
     * TYPE, and a member this list has never heard of is a failure that says
     * what to add rather than a silence.
     */
    const LANE_REL = 'modules/recall/lane-entrance.generated.ts';

    const probeSource = (receiver: string) => [
        '// Temporary fixture written by outbound-gate-census.spec.ts.',
        "import { ProactiveDispatchService } from '../channels/proactive-dispatch.service';",
        '',
        'export class LaneEntranceProbeService {',
        '    constructor(private ' + receiver + ': ProactiveDispatchService) {}',
        '    async remind(tenantId: string, to: string): Promise<void> {',
        '        await this.' + receiver + '.send(tenantId, {',
        "            channelType: 'whatsapp', channelAccountId: 'x', recipient: to,",
        "            items: [{ kind: 'template', templateName: 'promo' }],",
        '        } as never);',
        '    }',
        '}',
        '',
    ].join(String.fromCharCode(10));

    /** Runs `work` over a tree containing the probe, without touching disk. */
    const withLaneProbe = <T>(receiver: string, work: () => T): T => inventory.withSourceOverlay(
        [{ app: 'api', rel: LANE_REL, text: probeSource(receiver) }], work);

    it('classifies a producer that reaches Meta through the proactive entrance', () => {
        const { rows, bypasses } = withLaneProbe('proactive', () => ({
            rows: inventory.collect().filter((row: any) => row.file.endsWith('lane-entrance.generated.ts')),
            bypasses: census().bypasses
                .filter((row: any) => row.file.endsWith('lane-entrance.generated.ts')),
        }));
        expect(rows.length).toBe(1);
        expect(rows[0].lane).toBe('dispatch_outbox');
        // Classified AND covered: the durable lane's gate is at the sink it
        // terminates on, which is the whole reason a road redirects the question.
        expect(bypasses).toEqual([]);
    });

    it('reports a receiver name the primitive list has never heard of', () => {
        // The next producer may call its field `lane`. A sweep keyed on names
        // would go silent again; this one names the file, the line and the fix.
        const { found, classified } = withLaneProbe('lane', () => ({
            found: census().laneEntrances
                .filter((entry: any) => entry.file.endsWith('lane-entrance.generated.ts')),
            classified: inventory.collect()
                .filter((row: any) => row.file.endsWith('lane-entrance.generated.ts')),
        }));
        expect(found.length).toBe(1);
        expect(found[0].receiver).toBe('lane');
        // And it is NOT quietly classified as a producer, which is the state
        // that made ten of them invisible.
        expect(classified.length).toBe(0);
    });

    it('exits non-zero on that unknown receiver, naming what to add', () => {
        // The second and last case that writes: `--check` is another process.
        const PROBE = resolve(API_SRC, 'modules', 'recall', 'lane-entrance.generated.ts');
        writeFileSync(PROBE, probeSource('lane'), 'utf8');
        const out = mkdtempSync(join(tmpdir(), 'lane-entrance-'));
        let status = 0;
        let stderr = '';
        try {
            execFileSync(process.execPath, [SCRIPT, '--check', '--out', join(out, 'inventory.md')],
                { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (error: any) {
            status = error.status;
            stderr = String(error.stderr || '');
        } finally {
            rmSync(out, { recursive: true, force: true });
            rmSync(PROBE, { force: true });
        }
        expect({ status, named: stderr.includes('lane-entrance.generated.ts'),
            says: stderr.includes("'lane.send('") }).toEqual({ status: 1, named: true, says: true });
    });

    it('counts the producers already on the lane, by name', () => {
        // A count alone would pass on the wrong ten. These are the producers the
        // independent review listed as invisible; each must now be a call site.
        const onLane = inventory.collect()
            .filter((row: any) => row.lane === 'dispatch_outbox'
                && row.primitive.includes('.send'))
            .map((row: any) => row.file);
        for (const file of [
            'modules/appointments/appointment-notifications.service.ts',
            'modules/appointments/appointment-reminders.service.ts',
            'modules/automation/automation-jobs.processor.ts',
            'modules/automation/drip-sequence.service.ts',
            'modules/automation/nurturing.service.ts',
            'modules/broadcast/broadcast-queue.processor.ts',
            'modules/conversations/conversations.service.ts',
            'modules/recall/recall.service.ts',
            'modules/agent-console/agent-console.service.ts',
            'modules/whatsapp/whatsapp.controller.ts',
        ]) {
            expect({ file, onTheLane: onLane.includes(file) }).toEqual({ file, onTheLane: true });
        }
    });
});
