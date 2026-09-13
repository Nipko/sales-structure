import {
    EXTERNAL_EFFECT_PRODUCERS, EFFECT_CLASSES, EFFECT_AUDIENCES, EFFECT_CHANNELS,
    EGRESS_LANES, COVERAGE_LEVELS, EFFECT_PROPERTIES,
    metaBillsDelivery, isMetaBillableCustomerMessage,
} from './external-effect-inventory';

/**
 * ═══ A COUNTER MAY NOT BE MOVED BY A FILE NAME ═══
 *
 * M1 and M5 are about WhatsApp: what Meta can bill the tenant's WABA for, and
 * what a right-to-erasure request has to reach inside those messages. They used
 * to select their producers with a regular expression over the `source` and
 * `egress` STRINGS:
 *
 *     /whatsapp|instagram|messenger|telegram|dispatch|outbound|channel|notice/i
 *
 * which is a question about spelling. It swept in twenty-seven producers, and
 * nine of them were not messages to a customer at all — internal platform
 * alerts, coupon alerts, the email channel's inbound reply, the retired
 * conversational SMS adapter, connecting and testing a channel, creating a
 * WhatsApp template, writing the business profile, rotating a token. A WhatsApp
 * row could open because a token rotation has no erasure path, and closing it
 * would have meant work on something the row was never about.
 *
 * So the inventory now declares a `reach` per producer and the rows read that.
 * These cases are what stops the declaration from becoming decoration: the
 * shape is checked, the pairs that must agree are checked, and the derived
 * answer is checked against the channels it is derived from.
 */
describe('every producer says what kind of effect it is', () => {
    it('declares a complete, well-typed reach — no producer is unclassified', () => {
        // The type requires it; this is what catches a cast or a merge that
        // dropped one, and it names the producer rather than failing on a count.
        for (const producer of EXTERNAL_EFFECT_PRODUCERS) {
            expect({ id: producer.id, ok: EFFECT_CLASSES.includes(producer.reach.class) })
                .toEqual({ id: producer.id, ok: true });
            expect({ id: producer.id, ok: EFFECT_AUDIENCES.includes(producer.reach.audience) })
                .toEqual({ id: producer.id, ok: true });
            expect({ id: producer.id, ok: typeof producer.reach.personalData === 'boolean' })
                .toEqual({ id: producer.id, ok: true });
            expect({ id: producer.id, channels: producer.reach.channels.length > 0 })
                .toEqual({ id: producer.id, channels: true });
            for (const channel of producer.reach.channels) {
                expect({ id: producer.id, channel, known: EFFECT_CHANNELS.includes(channel) })
                    .toEqual({ id: producer.id, channel, known: true });
            }
        }
    });

    it('derives "Meta bills this" from the channels rather than declaring it', () => {
        // Declared, the two could disagree — a producer could lose WhatsApp and
        // keep the billable flag, which is the shape of every drift this file
        // exists to prevent.
        for (const producer of EXTERNAL_EFFECT_PRODUCERS) {
            expect({ id: producer.id, billed: metaBillsDelivery(producer.reach) })
                .toEqual({ id: producer.id, billed: producer.reach.channels.includes('whatsapp') });
        }
    });

    it('only lets a producer skip erasure when nothing personal leaves', () => {
        // `not_applicable` is a statement about the CONTENT of the effect, not
        // about the effort spent on it. A producer that carries a name and a
        // phone number and claims nothing to erase is the exact confusion the
        // level was introduced to end.
        const dishonest = EXTERNAL_EFFECT_PRODUCERS.filter(producer =>
            producer.properties.erasure.level === 'not_applicable' && producer.reach.personalData);
        expect(dishonest.map(producer => producer.id)).toEqual([]);
    });

    it('does not let a personal-data producer hide a gap as "not applicable"', () => {
        // The inverse, stated separately because it is the one that would let a
        // real gap leave a counter silently.
        for (const producer of EXTERNAL_EFFECT_PRODUCERS) {
            if (!producer.reach.personalData) continue;
            expect({ id: producer.id, level: producer.properties.erasure.level })
                .not.toEqual({ id: producer.id, level: 'not_applicable' });
        }
    });

    it('reserves retained for a real legal-retention erasure boundary', () => {
        for (const producer of EXTERNAL_EFFECT_PRODUCERS) {
            for (const property of EFFECT_PROPERTIES.filter(property => property !== 'erasure')) {
                expect({ id: producer.id, property, level: producer.properties[property].level })
                    .not.toEqual({ id: producer.id, property, level: 'retained' });
            }
            if (producer.properties.erasure.level !== 'retained') continue;
            expect({ id: producer.id, personalData: producer.reach.personalData })
                .toEqual({ id: producer.id, personalData: true });
            expect(producer.properties.erasure.note).toMatch(/fiscal|legal|regulator/i);
        }
    });

    it('keeps every property on a known level', () => {
        for (const producer of EXTERNAL_EFFECT_PRODUCERS) {
            for (const property of EFFECT_PROPERTIES) {
                expect({ id: producer.id, property,
                    known: COVERAGE_LEVELS.includes(producer.properties[property].level) })
                    .toEqual({ id: producer.id, property, known: true });
            }
            expect({ id: producer.id, lane: EGRESS_LANES.includes(producer.lane) })
                .toEqual({ id: producer.id, lane: true });
        }
    });
});

describe('what the October WhatsApp rows are allowed to count', () => {
    const billable = EXTERNAL_EFFECT_PRODUCERS.filter(isMetaBillableCustomerMessage);

    it('counts only customer messages that can leave over WhatsApp', () => {
        for (const producer of billable) {
            expect({ id: producer.id, cls: producer.reach.class })
                .toEqual({ id: producer.id, cls: 'customer_message' });
            expect(producer.reach.channels).toContain('whatsapp');
        }
        // A non-empty set, because an empty one would make every row green.
        expect(billable.length).toBeGreaterThan(10);
    });

    it('excludes, BY NAME, the nine the old regex swept in', () => {
        // Named rather than counted. A future edit that quietly re-classifies a
        // token rotation as a customer message would restore the defect, and a
        // count would not notice.
        const excluded = [
            'human.channel.connection_test',   // the tenant messaging itself on telegram/sms
            'ops.platform_alerts',             // our own operators
            'ops.coupon_alerts',               // our own operators
            'channel.email.inbound_reply',     // a customer, but only ever over email
            'channel.sms.conversational',      // a customer, but only ever over sms
            'meta.channel_management',         // configures an account; sends nobody anything
            'whatsapp.template_management',    // configures an asset
            'whatsapp.business_profile',       // configures an asset
            'channels.token_refresh',          // a credential, not a message
        ];
        const ids = billable.map(producer => producer.id);
        for (const id of excluded) {
            // It must still EXIST — excluded from a row, never dropped from the
            // inventory, which is the other way this correction could go wrong.
            expect(EXTERNAL_EFFECT_PRODUCERS.map(p => p.id)).toContain(id);
            expect(ids).not.toContain(id);
        }
    });

    it('includes, BY NAME, the replies a customer actually receives', () => {
        // The half that stops this from being a way to make a row green. If any
        // of these leaves the set, a real WhatsApp send has left the counter.
        for (const id of ['agent.reply.durable', 'human.agent.reply',
            'human.whatsapp.manual_send', 'broadcast.campaign',
            'appointments.booking_confirmation', 'payments.outcome_notice']) {
            expect(billable.map(producer => producer.id)).toContain(id);
        }
    });

    it('leaves nothing homeless: every producer belongs to exactly one class', () => {
        // The correction narrowed a counter, and narrowing is only honest if
        // what leaves lands somewhere. Every producer is in a class, so every
        // gap is still reported under one of them.
        const counted = EFFECT_CLASSES.reduce((total, cls) =>
            total + EXTERNAL_EFFECT_PRODUCERS.filter(p => p.reach.class === cls).length, 0);
        expect(counted).toBe(EXTERNAL_EFFECT_PRODUCERS.length);
    });
});
