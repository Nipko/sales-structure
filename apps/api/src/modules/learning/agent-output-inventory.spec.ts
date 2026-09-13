import * as fs from 'fs';
import * as path from 'path';
import { AGENT_OUTPUT_STORES, OUTPUT_REACH, OUTPUT_STATUS, openAgentOutputStores } from './agent-output-inventory';

/**
 * The inventory is only worth having if it cannot quietly go stale.
 *
 * Two halves. The first checks the table against itself: every row says what
 * reaches it and why, an open row says what would close it, and nothing claims
 * a retraction reaches a store that carries no provenance — which is impossible,
 * because a retraction matches on a release id and there is nothing to match.
 *
 * The second sweeps the source tree for the files that WRITE agent words to a
 * durable place and requires every one of them to be claimed. That is the half
 * that stops the list going stale: a new resting place fails here instead of
 * joining the unreached set in silence, which is exactly how "otras salidas" got
 * to be a phrase instead of a list.
 *
 * What this cannot catch, said out loud: a file that writes agent text through an
 * indirection the sweep does not recognise. The sweep is a net, not a proof, and
 * the same limitation is stated in `external-effect-inventory.spec.ts` for the
 * same reason.
 */

const SRC = path.resolve(__dirname, '..', '..');
const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/');

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__fixtures__') continue;
            walk(full, out);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

const SOURCES = walk(SRC).map(file => ({ source: rel(file), text: fs.readFileSync(file, 'utf8') }));

/**
 * Writing the agent's own words somewhere they survive the turn.
 *
 * Each pattern is a place words are PUT, not a place they pass through: the
 * assistant history writer, the draft, the envelope, the outbox payload, the
 * transcript stores and the two reply caches.
 */
const OUTPUT_WRITERS: readonly RegExp[] = Object.freeze([
    /pendingDraft/,
    /turnReplyKey\(/,
    /widgetReplyKey\(/,
    /saveAiMessage\(/,
    /recordResult\(/,
    /\btranscript\s*:/,
    /observedReplies/,
    /handoff_summary/,
    /INSERT INTO widget_agent_replies/,
]);

/** The inventory, its spec, and the retraction primitives themselves. */
const SELF = new Set([
    'modules/learning/agent-output-inventory.ts',
    'modules/learning/learning-evaluation-retention.ts',
    'modules/widget/widget-agent-reply-retention.ts',
    'modules/conversations/agent-turn-ledger.ts',
    'modules/channels/agent-dispatch-outbox.ts',
    'modules/compliance/compliance.service.ts',
]);

const writers = SOURCES
    .filter(file => !SELF.has(file.source) && OUTPUT_WRITERS.some(pattern => pattern.test(file.text)))
    .map(file => file.source)
    .sort();

const claimed = new Set(AGENT_OUTPUT_STORES.flatMap(row => row.sources));

describe('every place the agent\'s words come to rest', () => {
    it('sweeps a real source tree', () => {
        // A broken sweep would make the claim below pass against an empty set,
        // which is the one way this contract could stop protecting anything.
        expect(SOURCES.length).toBeGreaterThan(400);
        expect(writers.length).toBeGreaterThan(3);
    });

    it('claims every file that writes agent words somewhere durable', () => {
        const unclaimed = writers.filter(source => !claimed.has(source) && !SELF.has(source));
        expect({ unclaimed }).toEqual({ unclaimed: [] });
    });

    it('says what reaches every store, and why', () => {
        for (const row of AGENT_OUTPUT_STORES) {
            expect(OUTPUT_REACH).toContain(row.reachedByRetraction);
            expect(OUTPUT_REACH).toContain(row.reachedByContactErasure);
            expect(OUTPUT_STATUS).toContain(row.status);
            // A rationale is not decoration: `no` without one is a gap nobody
            // can act on, and `yes` without one is a claim nobody can check.
            expect(row.rationale.length).toBeGreaterThan(40);
            // A store nobody can point at is a store nobody can check.
            expect(row.sources.length).toBeGreaterThan(0);
        }
    });

    it('makes an open gap say what would close it', () => {
        for (const row of openAgentOutputStores()) {
            expect(typeof row.remedy).toBe('string');
            expect((row.remedy ?? '').length).toBeGreaterThan(30);
        }
        // And a closed or accepted row never carries one, so `remedy` always
        // means "this is outstanding" rather than "somebody had an idea".
        for (const row of AGENT_OUTPUT_STORES.filter(entry => entry.status !== 'open')) {
            expect(row.remedy).toBeUndefined();
        }
    });

    it('never claims a retraction reaches a store with no provenance', () => {
        // A retraction matches on a release id. A row that carries none cannot
        // be found by one, whatever the table would like to say.
        for (const row of AGENT_OUTPUT_STORES.filter(entry => !entry.carriesProvenance)) {
            expect(row.reachedByRetraction).not.toBe('yes');
        }
    });

    it('has one row per id and a stable order of ids', () => {
        const ids = AGENT_OUTPUT_STORES.map(row => row.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('names the widest hole rather than averaging it away', () => {
        const open = openAgentOutputStores().map(row => row.id);
        // The legacy reply path used to be the one that mattered most: live,
        // holding the words with no provenance, and only closable by a switch
        // nobody could flip for a real tenant. It is closed now — the job is a
        // reference and the words live where both keys can reach them — so what
        // this asserts is that it stays closed.
        expect(open).not.toContain('outbound_queue_job');
        // eslint-disable-next-line no-console
        console.log(`[agent-output-inventory] ${AGENT_OUTPUT_STORES.length} stores, ${open.length} open: ${open.join(', ')}`);
    });
});
