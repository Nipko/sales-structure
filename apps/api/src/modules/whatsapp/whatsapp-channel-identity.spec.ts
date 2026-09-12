import {
    whatsAppSenderIdentity, whatsAppStatusIdentity, isDiallable, diallablePhone,
} from '@parallext/shared';
import { normalizePhoneE164 } from '../../common/utils/phone.util';

/**
 * ═══ A CUSTOMER WITH NO PHONE NUMBER ═══
 *
 * Meta's business-scoped user ids let somebody write to a business without the
 * business ever seeing a number: the webhook carries `from_user_id` where it
 * used to carry `from`. `whatsapp-webhook.service.ts` requires `msg.from` to be
 * a non-empty string and DISCARDS the message otherwise — a deliberate guard
 * against an unanswerable message that, against a portfolio where usernames
 * have rolled out, turns into silence: the customer writes, nothing answers,
 * and the only trace is an error log.
 *
 * The cases below are the ones the handoff names: only a scoped id, phone and
 * scoped id together, phone alone, a changed identifier, a failed status with
 * no recipient at all, a replay, and two portfolios that mint the same string.
 */
const SCOPE = { wabaId: 'waba-1', phoneNumberId: '15550001111' };

describe('who wrote, when there may be no phone number', () => {
    it('reads a phone sender exactly as it always did', () => {
        // The existing tenants are the ones with the most to lose. A phone must
        // come out byte for byte, so no contact moves and no history splits.
        const identity = whatsAppSenderIdentity(
            { from: '573001112233' }, [{ wa_id: '573001112233', profile: { name: 'Ana' } }], SCOPE)!;
        expect(identity.kind).toBe('phone');
        expect(identity.addressKey).toBe('573001112233');
        expect(identity.phone).toBe('573001112233');
        expect(identity.phoneProvenance).toBe('message_sender');
    });

    it('reads a sender who has only a business-scoped id', () => {
        const identity = whatsAppSenderIdentity({ from_user_id: 'BSU_abc123XYZ' }, [], SCOPE)!;
        expect(identity.kind).toBe('business_scoped');
        expect(identity.identifier).toBe('BSU_abc123XYZ');
        // Absent, not empty and not guessed: a person who has not shared their
        // number can still ask a question and get one answered.
        expect(identity.phone).toBeNull();
        expect(identity.phoneProvenance).toBeNull();
    });

    it('takes the phone as an ALIAS when the portfolio asserts one', () => {
        const identity = whatsAppSenderIdentity(
            { from_user_id: 'BSU_abc123XYZ' },
            [{ user_id: 'BSU_abc123XYZ', wa_id: '573001112233' }], SCOPE)!;
        expect(identity.kind).toBe('business_scoped');
        expect(identity.phone).toBe('573001112233');
        // Where it came from travels with it. An alias asserted by a portfolio
        // is not the same fact as a number the sender wrote from.
        expect(identity.phoneProvenance).toBe('portfolio_contact');
        // And the KEY is still the scoped one: the person is identified by who
        // they are to this portfolio, not by an alias that can be withdrawn.
        expect(identity.addressKey).toBe('bsuid:waba-1:BSU_abc123XYZ');
    });

    it('never lets two portfolios collide on the same apparent id', () => {
        // `contacts` is keyed `(channel_type, external_id)`. A scoped id is
        // unique WITHIN a portfolio and says nothing across them, so keying on
        // the bare string would fuse two strangers into one contact with one
        // history — the same defect as coercing an unknown sender to ''.
        const here = whatsAppSenderIdentity({ from_user_id: 'SAME_ID_1234' }, [], SCOPE)!;
        const elsewhere = whatsAppSenderIdentity(
            { from_user_id: 'SAME_ID_1234' }, [], { wabaId: 'waba-2' })!;
        expect(here.addressKey).not.toBe(elsewhere.addressKey);
    });

    it('refuses a scoped id it cannot scope', () => {
        // Better no identity than an unscoped key: the key IS the collision.
        expect(whatsAppSenderIdentity({ from_user_id: 'BSU_abc123XYZ' }, [], {})).toBeNull();
    });

    it('treats a changed identifier as a different counterpart', () => {
        // Meta states the scoped id changes when the person changes their
        // number. That is a NEW counterpart to this portfolio, and pretending
        // otherwise would merge two people or split one silently — the choice
        // belongs to identity resolution, with evidence, not to this parser.
        const before = whatsAppSenderIdentity({ from_user_id: 'BSU_before_11' }, [], SCOPE)!;
        const after = whatsAppSenderIdentity({ from_user_id: 'BSU_after_22' }, [], SCOPE)!;
        expect(before.addressKey).not.toBe(after.addressKey);
    });

    it('is stable across a replay of the same webhook', () => {
        const once = whatsAppSenderIdentity({ from_user_id: 'BSU_abc123XYZ' }, [], SCOPE)!;
        const twice = whatsAppSenderIdentity({ from_user_id: 'BSU_abc123XYZ' }, [], SCOPE)!;
        expect(twice.addressKey).toBe(once.addressKey);
    });

    it('answers null only when the message really names nobody', () => {
        expect(whatsAppSenderIdentity({}, [], SCOPE)).toBeNull();
        expect(whatsAppSenderIdentity({ from: '   ' }, [], SCOPE)).toBeNull();
        // And refuses a shape that is neither: a scoped id has to look like one.
        expect(whatsAppSenderIdentity({ from_user_id: 'no spaces allowed' }, [], SCOPE)).toBeNull();
    });

    it('picks the right sender out of a batch carrying several', () => {
        const contacts = [
            { user_id: 'BSU_other_999', wa_id: '573009998888' },
            { user_id: 'BSU_ours_1234', wa_id: '573001112233' },
        ];
        const identity = whatsAppSenderIdentity({ from_user_id: 'BSU_ours_1234' }, contacts, SCOPE)!;
        expect(identity.phone).toBe('573001112233');
    });

    it('does not borrow an alias from an unrelated contact row', () => {
        // The batch has two contacts and neither matches, so there is no
        // unambiguous row to fall back to. Labelling this sender with somebody
        // else's number is the defect the batch-level lookup already has a
        // comment about, and it would be worse here: the alias would be stored.
        const contacts = [
            { user_id: 'BSU_other_999', wa_id: '573009998888' },
            { user_id: 'BSU_third_777', wa_id: '573007776666' },
        ];
        expect(whatsAppSenderIdentity({ from_user_id: 'BSU_ours_1234' }, contacts, SCOPE)!.phone)
            .toBeNull();
    });
});

describe('the status of a message we sent', () => {
    it('reads a phone recipient', () => {
        expect(whatsAppStatusIdentity({ recipient_id: '573001112233' }, SCOPE)!.kind).toBe('phone');
    });

    it('reads a scoped recipient', () => {
        const identity = whatsAppStatusIdentity({ recipient_user_id: 'BSU_abc123XYZ' }, SCOPE)!;
        expect(identity.addressKey).toBe('bsuid:waba-1:BSU_abc123XYZ');
    });

    it('answers null for a failed status that carries no recipient', () => {
        // Meta says some failed statuses omit contact identifiers entirely. The
        // status is still about a message WE sent, identified by its `wamid`;
        // inventing a recipient to hang it on would be worse than recording it
        // against the message alone.
        expect(whatsAppStatusIdentity({ status: 'failed' }, SCOPE)).toBeNull();
    });
});

describe('the one question every existing caller has to start asking', () => {
    it('keeps an opaque id away from phone normalisation', () => {
        // THE CASE THIS EXISTS FOR. `normalizePhoneE164` strips non-digits and
        // applies country rules, so a scoped id comes out of it as a plausible
        // phone number belonging to SOMEBODY ELSE — not a failed send, a message
        // delivered to a stranger.
        // An ALL-DIGIT scoped id, which is the dangerous shape: the letters in
        // a prefixed one make normalisation refuse it, and refusing is safe.
        // This one it accepts.
        const scoped = whatsAppSenderIdentity({ from_user_id: '17325551234' }, [], SCOPE)!;
        expect(scoped.kind).toBe('business_scoped');
        expect(isDiallable(scoped)).toBe(false);

        // What would have happened without the guard, asserted rather than
        // described, so the danger is visible in the test that prevents it:
        // an opaque identifier becomes a valid, diallable North American
        // number that belongs to somebody who never wrote to this business.
        expect(normalizePhoneE164(scoped.identifier)).toBe('+17325551234');
    });

    it('says a phone sender IS diallable', () => {
        const phone = whatsAppSenderIdentity({ from: '573001112233' }, [], SCOPE)!;
        expect(isDiallable(phone)).toBe(true);
        expect(diallablePhone(phone)).toBe('573001112233');
    });

    it('hands back an asserted alias for the things that genuinely need one', () => {
        // Authentication templates — copy-code, one-tap, zero-tap — require a
        // phone, and so does an SMS fallback. A caller that gets null has to ASK
        // for it and say what for, rather than guess or quietly skip the step.
        const withAlias = whatsAppSenderIdentity(
            { from_user_id: 'BSU_abc123XYZ' },
            [{ user_id: 'BSU_abc123XYZ', wa_id: '573001112233' }], SCOPE)!;
        expect(diallablePhone(withAlias)).toBe('573001112233');

        const without = whatsAppSenderIdentity({ from_user_id: 'BSU_abc123XYZ' }, [], SCOPE)!;
        expect(diallablePhone(without)).toBeNull();
    });
});
