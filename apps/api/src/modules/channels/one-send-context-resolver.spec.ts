import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

/**
 * ═══ ONE RESOLVER, BECAUSE TWO DISAGREED ═══
 *
 * `resolveSendContext` answers the question every chargeable send depends on:
 * which number this leaves from, whose WhatsApp Business Account Meta bills,
 * and on which credential. There were two implementations with the same name,
 * the same request type and the same contract version — and they disagreed
 * about the one field that decides who pays.
 *
 * `whatsapp-connection.service.ts` answered `payer.kind: 'unknown'` with the
 * WABA id sitting in the row it had just read. Under `enforce` that is a
 * refusal, so any sink pointed at that copy would have gone silent while the
 * queue lane — which asks the other one — kept working. It had no production
 * callers, and that is precisely what made it dangerous: a second
 * implementation nobody exercises is a trap for whoever needs one next and
 * opens that file first.
 *
 * ── WHY THIS TEST IS STRUCTURAL AND NOT A BEHAVIOUR TEST ────────────────────
 *
 * Because the defect is not a wrong answer; it is the EXISTENCE of a second
 * place to ask. A behaviour test would pass against both copies — both of them
 * did pass, for months. The only thing that catches this class of defect is
 * counting the definitions.
 */
describe('there is exactly one send-context resolver', () => {
    const MODULES = resolve(__dirname, '..');
    /** A definition, not a call: `async resolveSendContext(` at method position. */
    const DEFINITION = /\basync\s+resolveSendContext\s*\(/g;

    const sources = (dir: string): string[] => {
        const found: string[] = [];
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) { found.push(...sources(full)); continue; }
            if (!/\.ts$/.test(entry) || /\.spec\.ts$/.test(entry)) continue;
            if (entry === 'spend-gate-double.ts') continue; // a test fixture, declared as such
            found.push(full);
        }
        return found;
    };

    it('is defined in exactly one production file', () => {
        const definitions = sources(MODULES)
            .filter(file => DEFINITION.test(readFileSync(file, 'utf8')))
            .map(file => relative(MODULES, file).replace(/\\/g, '/'));
        // Named rather than counted: a failure has to say WHICH file grew a
        // second opinion about who pays.
        expect(definitions).toEqual(['channels/channel-token.service.ts']);
    });

    it('and that one names a payer when it knows the WABA', () => {
        // The substance of the disagreement, pinned here so deleting the copy
        // cannot quietly take the correct behaviour with it. Its full
        // behaviour is proven against real PostgreSQL in
        // `connection-selection.postgres.spec.ts`.
        const source = readFileSync(
            join(MODULES, 'channels/channel-token.service.ts'), 'utf8');
        expect(source).toContain("? { kind: 'business_direct', wabaId: wa.wabaId");
    });
});
