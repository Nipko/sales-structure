import * as fs from 'fs';
import * as path from 'path';
import {
    EXTERNAL_EFFECT_PRODUCERS, EGRESS_INFRASTRUCTURE, EFFECT_PROPERTIES, EGRESS_LANES,
    COVERAGE_LEVELS, PRODUCER_STATUSES, PRODUCER_DERIVATIONS, NON_PRODUCER_KINDS,
    producersMissing, summariseExternalEffects,
} from './external-effect-inventory';
import { HANDOFF_EFFECT_DESTINATIONS } from '../handoff/handoff-effects';
import { DISPATCH_ITEM_KINDS } from './agent-dispatch-outbox';

/**
 * What stops the inventory from becoming a comfortable story.
 *
 * The value of the inventory is entirely in whether it still describes the code,
 * so the derivation matters more than the table. Two sweeps of the source tree
 * decide what must be in it:
 *
 *   1. **Messages.** Every non-spec file that reaches an egress primitive — the
 *      shared outbound queue, the channel gateway, an adapter send, a template
 *      send, the operational notice outbox, the email service, an SMS sender,
 *      the operator Telegram bot. This is derivable because everything that
 *      reaches a person goes through one of a small, named set of doors, and it
 *      is the sweep that matters most: "human replies" and "approvals" were
 *      forgotten precisely because nobody was counting the doors.
 *
 *   2. **Third-party writes.** Every non-spec file naming a third-party API
 *      host. Weaker than the first — a host literal is a proxy for a call, and a
 *      tenant-supplied URL has no literal at all — but it catches the modules
 *      that talk to Google, Meta, Wompi, Factus, HubSpot and the rest.
 *
 * Neither sweep can decide whether a file DECIDES an effect or merely carries
 * one out, so a swept file must be claimed either as a producer or as
 * infrastructure with a written reason. An unclaimed file fails by name.
 *
 * What is honestly NOT derivable: the SIX PROPERTIES. No sweep can tell whether
 * a producer keeps a receipt. Those are declared, and what is checked here is
 * that a declaration resolves to code (a file, a symbol, an exported mechanism)
 * and that it does not flatter itself (a lane cannot report more than the lane
 * provides; a `none` must give a reason). A property that quietly becomes false
 * is the failure mode this file cannot catch, and saying so is part of the
 * contract.
 */

const SRC = path.resolve(__dirname, '..', '..');
const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/');

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === 'dist') continue;
            walk(full, out);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
            && !entry.name.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

const SOURCES = walk(SRC).map(file => ({ source: rel(file), text: fs.readFileSync(file, 'utf8') }));

/**
 * The doors a message leaves through.
 *
 * Adapters define these methods without a receiver, so the leading dot is what
 * separates "I am the transport" from "I am asking the transport to act". The
 * import patterns catch the producers that hand a whole message to a queue or
 * to the mailer instead of calling a method on an adapter.
 */
const MESSAGE_EGRESS = [
    /from '[^']*outbound-queue\.service'/,
    /\.sendMessage\(/, /\.sendTextMessage\(/, /\.sendMediaMessage\(/, /\.sendStrict\(/,
    /\.sendFlowMessage\(/, /\.sendTemplate\(/, /\.sendInteractiveMessage\(/, /\.sendLocationMessage\(/,
    /enqueueOperationalNotice\(/,
    /from '[^']*email\/email\.service'/,
    /from '[^']*tenant-notification-sms\.service'/,
    /from '[^']*sms-sender\.service'/,
    /from '[^']*sms-alert\.service'/,
    /from '[^']*telegram-alert\.service'/,
];

/** Hosts we write to. A literal is a proxy for a call, which is why sweep 2 is the weaker one. */
const THIRD_PARTY_HOST = new RegExp('https://[a-z0-9.-]*(' + [
    'graph\\.facebook\\.com', 'graph\\.instagram\\.com', 'api\\.instagram\\.com', 'api\\.telegram\\.org',
    'api\\.twilio\\.com', 'googleapis\\.com', 'graph\\.microsoft\\.com', 'exp\\.host',
    'hooks\\.slack\\.com', 'hostaway\\.com', 'hubapi\\.com', 'pipedrive\\.com', 'wompi\\.co',
    'factus\\.com\\.co', 'mercadopago\\.com', 'mindbodyonline\\.com', 'toasttab\\.com',
    'cliniko\\.com', 'myshopify\\.com',
].join('|') + ')');

/** The inventory and this spec name hosts in prose; they are not producers. */
const SELF = ['modules/channels/external-effect-inventory.ts'];

const messageProducers = SOURCES
    .filter(file => !SELF.includes(file.source) && MESSAGE_EGRESS.some(pattern => pattern.test(file.text)))
    .map(file => file.source).sort();
const thirdPartyWriters = SOURCES
    .filter(file => !SELF.includes(file.source) && THIRD_PARTY_HOST.test(file.text))
    .map(file => file.source).sort();

const claimedByProducer = new Set(EXTERNAL_EFFECT_PRODUCERS.map(row => row.source));
const claimedAsRoad = new Set(EGRESS_INFRASTRUCTURE.map(row => row.source));
const claimed = new Set([...claimedByProducer, ...claimedAsRoad]);

describe('the sweeps still find something', () => {
    // A broken pattern would make every "is it claimed?" assertion below pass
    // against an empty set, which is the one way this contract could quietly
    // stop protecting anything.
    it('sweeps a real source tree', () => {
        expect(SOURCES.length).toBeGreaterThan(500);
        expect(SOURCES.map(file => file.source)).toContain('modules/channels/agent-dispatch-outbox.ts');
    });

    it('finds message producers, and finds the ones the review said were forgotten', () => {
        expect(messageProducers.length).toBeGreaterThan(30);
        expect(messageProducers).toContain('modules/agent-console/agent-console.service.ts');
        expect(messageProducers).toContain('modules/conversations/tool-approval-effects.service.ts');
        expect(messageProducers).toContain('modules/broadcast/broadcast-queue.processor.ts');
    });

    it('finds third-party writers', () => {
        expect(thirdPartyWriters.length).toBeGreaterThan(20);
        expect(thirdPartyWriters).toContain('modules/billing/adapters/wompi.adapter.ts');
        expect(thirdPartyWriters).toContain('modules/reviews/reviews.service.ts');
    });
});

describe('every producer the codebase has is in the inventory', () => {
    it.each(['message', 'third-party'] as const)('%s sweep: nothing is unclaimed', kind => {
        const swept = kind === 'message' ? messageProducers : thirdPartyWriters;
        const missing = swept.filter(source => !claimed.has(source));
        // Named, not counted: the point of failing is to say which file arrived
        // without anyone deciding what its six answers are.
        expect(missing).toEqual([]);
    });

    it('a `census` entry really is in the sweep it claims', () => {
        const swept = new Set([...messageProducers, ...thirdPartyWriters]);
        const unearned = EXTERNAL_EFFECT_PRODUCERS
            .filter(row => row.derivation === 'census' && !swept.has(row.source))
            .map(row => `${row.id} → ${row.source}`);
        expect(unearned).toEqual([]);
    });

    it('infrastructure is listed because it was swept, not to pad the list', () => {
        const swept = new Set([...messageProducers, ...thirdPartyWriters]);
        const pointless = EGRESS_INFRASTRUCTURE
            .filter(row => !swept.has(row.source)).map(row => row.source);
        expect(pointless).toEqual([]);
    });

    it('never calls the same file both a producer and a road', () => {
        // `channel-management.controller.ts` sends a test message AND revokes
        // subscriptions; both are producer entries. What must not happen is one
        // entry claiming an effect while another excuses the same file from
        // having one.
        const both = [...claimedByProducer].filter(source => claimedAsRoad.has(source));
        expect(both).toEqual([]);
    });
});

describe('every entry names something that exists', () => {
    const text = new Map(SOURCES.map(file => [file.source, file.text]));

    it.each(EXTERNAL_EFFECT_PRODUCERS.map(row => [row.id, row] as const))(
        '%s resolves to a file and a symbol', (_id, row) => {
            const body = text.get(row.source);
            expect(body).toBeDefined();
            // A rename that leaves the entry behind is exactly how an inventory
            // starts describing a system that no longer exists.
            expect(body).toContain(row.symbol);
        });

    it.each(EGRESS_INFRASTRUCTURE.map(row => [row.source, row] as const))(
        '%s is a real file with a written reason', (_source, row) => {
            expect(text.get(row.source)).toBeDefined();
            expect(NON_PRODUCER_KINDS).toContain(row.kind);
            // "wiring" is a reason; an empty string is a shrug.
            expect(row.reason.length).toBeGreaterThan(20);
        });

    it('gives every producer id exactly once', () => {
        const ids = EXTERNAL_EFFECT_PRODUCERS.map(row => row.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('describes what actually leaves the process, not just who calls it', () => {
        for (const row of EXTERNAL_EFFECT_PRODUCERS) {
            expect(row.effect.length).toBeGreaterThan(30);
            expect(row.egress.length).toBeGreaterThan(15);
        }
    });
});

describe('the lanes match the code that owns them', () => {
    const processor = fs.readFileSync(
        path.join(SRC, 'modules', 'channels', 'outbound-queue.processor.ts'), 'utf8');

    it('has a lane for every discriminator of the shared queue job', () => {
        // Derived from the union rather than from a list somebody maintains: a
        // fifth kind of job added to `OutboundJobData` is a fifth way for an
        // effect to leave, and it has to arrive in this file too.
        // The union's own object members carry semicolons, so it ends where the
        // next top-level declaration begins — not at the first `;`.
        const union = processor.slice(processor.indexOf('export type OutboundJobData'));
        const end = Math.min(...['\n@', '\nexport ', '\nconst ']
            .map(marker => union.indexOf(marker)).filter(index => index > 0));
        const declaration = union.slice(0, end);
        const discriminators = new Set(
            [...declaration.matchAll(/\b(outbound|approvalEffect|operationalNotice|dispatch)\??:/g)]
                .map(match => match[1]));
        expect([...discriminators].sort())
            .toEqual(['approvalEffect', 'dispatch', 'operationalNotice', 'outbound']);
        const lanes: Record<string, string> = {
            dispatch: 'dispatch_outbox', approvalEffect: 'approved_effect',
            operationalNotice: 'operational_notice', outbound: 'outbound_queue',
        };
        for (const discriminator of discriminators) {
            expect(EGRESS_LANES).toContain(lanes[discriminator] as any);
            expect(EXTERNAL_EFFECT_PRODUCERS.some(row => row.lane === lanes[discriminator])).toBe(true);
        }
    });

    it('claims durable dispatch only for the item kinds the outbox can carry', () => {
        // The outbox refuses anything outside this set, so a producer claiming
        // the lane for something else would be claiming a row that cannot exist.
        expect([...DISPATCH_ITEM_KINDS].sort()).toEqual(['flow', 'media', 'payment_link', 'text']);
        const durableReply = EXTERNAL_EFFECT_PRODUCERS.find(row => row.id === 'agent.reply.durable')!;
        expect(durableReply.lane).toBe('dispatch_outbox');
        // And it is not on by default, which is the honest half of that claim.
        expect(durableReply.status).toBe('pilot_gated');
    });

    it('accounts for every handoff destination the table can hold', () => {
        // Nine destinations, and the fan-out entry has to name them. This is what
        // catches a tenth destination being added to the effects table without
        // anyone deciding what its six answers are.
        expect(HANDOFF_EFFECT_DESTINATIONS.length).toBe(9);
        const handoffText = EXTERNAL_EFFECT_PRODUCERS
            .filter(row => row.lane === 'handoff_effects' || row.id.startsWith('handoff.'))
            .map(row => `${row.effect} ${row.egress} ${row.id}`).join(' ').toLowerCase();
        for (const destination of HANDOFF_EFFECT_DESTINATIONS) {
            expect(handoffText).toContain(destination === 'crm' ? 'crm' : destination);
        }
    });

    it('every declared lane, status, level and derivation is one the type allows', () => {
        for (const row of EXTERNAL_EFFECT_PRODUCERS) {
            expect(EGRESS_LANES).toContain(row.lane);
            expect(PRODUCER_STATUSES).toContain(row.status);
            expect(PRODUCER_DERIVATIONS).toContain(row.derivation);
            for (const property of EFFECT_PROPERTIES) {
                expect(COVERAGE_LEVELS).toContain(row.properties[property].level);
            }
        }
    });
});

describe('no entry claims a property the code does not support', () => {
    const durableLaneEvidence: Record<string, { file: string; symbols: string[] }> = {
        dispatch_outbox: {
            file: 'modules/channels/agent-dispatch-outbox.ts',
            symbols: ['admitDispatch', 'settleDispatch', 'expireDispatchLeases',
                'redactDispatchOutbox', 'resolveDispatchReconciliation'],
        },
        approved_effect: {
            file: 'modules/conversations/tool-approval-effects.service.ts',
            symbols: ['lease_token', 'reconciliation_required', 'customer_memory_erasure', 'recoverTenant'],
        },
        operational_notice: {
            file: 'modules/operational-notices/operational-notice.service.ts',
            symbols: ['lease_token', 'reconciliation_required', 'recoverCron', 'provider_reference'],
        },
        handoff_effects: {
            file: 'modules/handoff/handoff-effects.ts',
            symbols: ['admitHandoffEffect', 'settleHandoffEffect', 'expireHandoffEffectLeases'],
        },
    };

    it.each(Object.entries(durableLaneEvidence))(
        '%s can actually do what its traffic claims', (_lane, evidence) => {
            const body = fs.readFileSync(path.join(SRC, ...evidence.file.split('/')), 'utf8');
            for (const symbol of evidence.symbols) expect(body).toContain(symbol);
        });

    it('a producer on the plain outbound queue reports what the queue gives, no more', () => {
        // Redis is the whole record on that lane: no admission row, no receipt a
        // webhook can match, nothing erasure can reach inside a queued job. An
        // entry there claiming `durable` authority or receipt would be reporting
        // a mechanism the lane does not have — which is the exact way a table
        // like this turns into false assurance.
        for (const row of EXTERNAL_EFFECT_PRODUCERS.filter(entry => entry.lane === 'outbound_queue')) {
            expect(row.properties.authority.level).toBe('none');
            expect(row.properties.erasure.level).toBe('none');
            expect(row.properties.receipt.level).not.toBe('durable');
            expect(row.properties.uncertainOutcome.level).toBe('none');
        }
    });

    it('a producer with no queue and no row cannot claim durable recovery', () => {
        // The one exception is stated and checked: the Web Chat widget has no
        // provider, so its admission IS its delivery and there is nothing to
        // recover. Everything else inline is a call with no record behind it.
        const inlineDurable = EXTERNAL_EFFECT_PRODUCERS
            .filter(row => row.lane === 'inline' && row.properties.recovery.level === 'durable')
            .map(row => row.id);
        expect(inlineDurable).toEqual(['human.agent.reply.widget', 'channels.token_refresh']);
    });

    it('says out loud that the durable reply path is off by default', () => {
        const rollout = fs.readFileSync(
            path.join(SRC, 'modules', 'channels', 'dispatch-rollout.service.ts'), 'utf8');
        // The inventory calls it `pilot_gated`; this is where that word comes from.
        expect(rollout).toContain('enabled: raw.enabled === true');
        expect(EXTERNAL_EFFECT_PRODUCERS.some(row =>
            row.id === 'agent.reply.legacy' && row.status === 'live')).toBe(true);
    });
});

describe('the inventory is honest about what is not covered', () => {
    it('gives a reason wherever it reports nothing', () => {
        for (const row of EXTERNAL_EFFECT_PRODUCERS) {
            for (const property of EFFECT_PROPERTIES) {
                const cell = row.properties[property];
                // A bare `none` teaches nobody anything and cannot be argued
                // with. The reason is the whole content of the cell.
                expect(cell.note.length).toBeGreaterThan(25);
                if (cell.level !== 'durable') expect(cell.note).not.toMatch(/^(none|n\/a|todo)$/i);
            }
        }
    });

    it('does not flatter the code: the gaps are real and named', () => {
        const summary = summariseExternalEffects();
        expect(summary.producers).toBe(EXTERNAL_EFFECT_PRODUCERS.length);
        // If this ever reached zero it would mean either that everything was
        // fixed or that somebody edited the table instead of the code. The list
        // below says which producers are meant to be here, so the second case
        // fails rather than passes.
        expect(summary.uncovered.length).toBeGreaterThan(0);
        for (const id of ['human.agent.reply', 'human.whatsapp.manual_send', 'automation.http_request']) {
            expect(summary.uncovered).toContain(id);
        }
    });

    it('records the human reply as the worst-covered producer, because it is', () => {
        const human = EXTERNAL_EFFECT_PRODUCERS.find(row => row.id === 'human.agent.reply')!;
        // Four of six at `none`, and the receipt cell has to keep saying why:
        // the row is written `delivered` before the send, and the send is
        // swallowed. A future edit that softens this without changing
        // `agent-console.service.ts` fails here.
        expect(EFFECT_PROPERTIES.filter(property => human.properties[property].level === 'none').length)
            .toBeGreaterThanOrEqual(4);
        expect(human.properties.receipt.note).toContain('delivered');
        const service = fs.readFileSync(
            path.join(SRC, 'modules', 'agent-console', 'agent-console.service.ts'), 'utf8');
        expect(service).toContain("'outbound', 'delivered'");
        expect(service).toContain('Could not send agent message via channel');
    });

    it('reports a switched-off or retained producer instead of omitting it', () => {
        const byId = new Map(EXTERNAL_EFFECT_PRODUCERS.map(row => [row.id, row]));
        // Omitting these is how a list stops being an inventory: the email
        // channel and conversational SMS are not offered, and their absence
        // would read as "there is no such producer" rather than "it is off".
        expect(byId.get('channel.email.inbound_reply')?.status).toBe('internal_only');
        expect(byId.get('channel.sms.conversational')?.status).toBe('legacy');
        expect(byId.get('handoff.agent_sms')?.status).toBe('off');
        expect(byId.get('billing.stripe')?.status).toBe('off');
        expect(byId.get('integrations.outbox_scaffolding')?.status).toBe('off');
    });

    it('the SMS producers are off because a kill switch says so, not because we hope', () => {
        const killSwitch = fs.readFileSync(
            path.join(SRC, 'modules', 'sms-credits', 'sms-kill-switch.service.ts'), 'utf8');
        // Fails closed: an unreadable setting means no SMS. That is what makes
        // `off` a fact rather than a configuration everyone assumes.
        expect(killSwitch).toContain('return false');
        expect(EXTERNAL_EFFECT_PRODUCERS.filter(row => row.status === 'off').length).toBeGreaterThan(2);
    });

    it('answers "who has nothing at all for this property" in one call', () => {
        for (const property of EFFECT_PROPERTIES) {
            const missing = producersMissing(property);
            // Every property has at least one producer holding nothing. That is
            // the state of the system, and the inventory exists to say it.
            expect(missing.length).toBeGreaterThan(0);
            expect(summariseExternalEffects().gapsByProperty[property])
                .toEqual(missing.map(row => row.id).sort());
        }
    });

    it('corrects the assumption that calendar writes were uncovered', () => {
        // The review listed calendar writes among the producers left behind.
        // They are on a leased outbox with provider-side idempotency keys and a
        // reconcile pass — better covered than most message paths. The
        // inventory records what is true, not what was assumed.
        const calendar = EXTERNAL_EFFECT_PRODUCERS.find(row => row.id === 'calendar.event_write')!;
        expect(calendar.properties.idempotency.level).toBe('durable');
        expect(calendar.properties.uncertainOutcome.level).toBe('durable');
        const outbox = fs.readFileSync(
            path.join(SRC, 'modules', 'appointments', 'calendar-sync-outbox.service.ts'), 'utf8');
        expect(outbox).toContain('reconciliation_required');
        expect(outbox).toContain('idempotency_key');
    });
});
