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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const inventory = require(SCRIPT);

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
    const PROBE = resolve(API_SRC, 'modules', 'channels', 'gate-census-probe.generated.ts');

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
        writeFileSync(PROBE, UNGATED, 'utf8');
        const found = census().ungatedEgress
            .filter((entry: any) => entry.file.endsWith('gate-census-probe.generated.ts'));
        expect(found.length).toBe(1);
        expect(found[0].what).toContain('messages');
    });

    it('does not accept an admission that exists only in a comment', () => {
        // The failure this prevents: a check that greps the whole file text goes
        // green on `// TODO: call this.admitSpend(...)`. The gate is read from
        // code with comments and template literals stripped, so prose proves
        // nothing — and the only way to be sure of that is to write the prose.
        writeFileSync(PROBE, UNGATED.replace('export class', [
            '// Later: this.admitSpend({ tenantId, channelType: \'whatsapp\' });',
            '/* and spend gate wiring: spendGate.admit(request) */',
            'const NOTE = `this.gateOrSuppress(outbound, \'probe\')`;',
            'void NOTE;',
            'export class',
        ].join('\n')), 'utf8');
        expect(census().ungatedEgress
            .filter((entry: any) => entry.file.endsWith('gate-census-probe.generated.ts')).length)
            .toBe(1);
    });

    it('accepts it once the admission is a real call', () => {
        writeFileSync(PROBE, UNGATED.replace(
            '        await fetch(',
            '        const admission = await this.admitSpend({ to });\n'
            + '        if (admission === null) return;\n'
            + '        await fetch('), 'utf8');
        expect(census().ungatedEgress
            .filter((entry: any) => entry.file.endsWith('gate-census-probe.generated.ts')).length)
            .toBe(0);
    });

    it('exits non-zero, and names the file, when a violation exists', () => {
        // The unit above proves the classification. This proves the CONSEQUENCE:
        // the command CI runs actually fails. A census that finds a violation
        // and exits 0 stops nothing.
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
