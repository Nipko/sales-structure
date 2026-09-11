import {
    applyFundingSignal, clearPause, describePause, isPaused, readPause, type SendPause,
} from './account-send-pause';
import { detailSaysFunding, fundingSignalFrom, isFundingCode } from './meta-funding-signals';

const AT = new Date('2026-10-05T12:00:00.000Z');

describe('recognising that Meta cannot bill the business', () => {
    it('knows the documented code', () => {
        expect(isFundingCode(131042)).toBe(true);
        expect(isFundingCode('131042')).toBe(true);
        // The delivery-status writer namespaces every code it stores.
        expect(fundingSignalFrom({ source: 'status_webhook', code: 'whatsapp:131042' }))
            .toMatchObject({ code: 131042, source: 'status_webhook' });
    });

    it('does not invent codes it cannot vouch for', () => {
        // A code added from memory that turns out to mean something else would
        // pause a working account on a message that merely failed — the exact
        // outage this module exists to prevent, caused by the module.
        for (const code of [131026, 131047, 470, 100, 131000]) {
            expect(fundingSignalFrom({ source: 'http_response', code })).toBeNull();
        }
    });

    it('reads an explanation Meta gives in words', () => {
        expect(detailSaysFunding('Business eligibility payment issue')).toBe(true);
        expect(detailSaysFunding('Please add a valid payment method to continue')).toBe(true);
        expect(fundingSignalFrom({ source: 'http_response', code: 100,
            detail: 'payment method is missing for this account' })?.code).toBe(100);
    });

    it('does not pause a business because its customers talk about payments', () => {
        // The looser match this avoids: a tenant selling payment plans, or an
        // agent answering "how do I pay?", would pause itself.
        expect(detailSaysFunding('the customer asked about payment options')).toBe(false);
        expect(detailSaysFunding('Payment received, thank you')).toBe(false);
        expect(detailSaysFunding('Re-engagement message')).toBe(false);
        expect(fundingSignalFrom({ source: 'status_webhook', code: 470,
            detail: 'title="" details="Message failed to send because more than 24 hours have passed"' }))
            .toBeNull();
    });
});

describe('the pause itself', () => {
    const signal = (at: Date, detail = 'Business eligibility payment issue') =>
        fundingSignalFrom({ source: 'http_response', code: 131042, detail, at })!;

    it('starts on the first sighting', () => {
        const pause = applyFundingSignal(null, signal(AT));
        expect(isPaused(pause)).toBe(true);
        expect({ since: pause.since, observations: pause.observations })
            .toEqual({ since: AT.toISOString(), observations: 1 });
    });

    it('does not restart itself every time it fails again', () => {
        // `since` is when the problem began. Moved forward on every failed
        // message, a three-day outage would look like it started thirty
        // seconds ago — and nobody would know how long customers had gone
        // unanswered.
        const later = new Date(AT.getTime() + 3 * 86_400_000);
        const first = applyFundingSignal(null, signal(AT));
        const again = applyFundingSignal(first, signal(later));
        expect({ since: again.since, lastSeen: again.lastSeen, seen: again.observations })
            .toEqual({ since: AT.toISOString(), lastSeen: later.toISOString(), seen: 2 });
    });

    it('clears only on evidence, and says what the evidence was', () => {
        const paused = applyFundingSignal(null, signal(AT));
        const cleared = clearPause(paused, { by: 'provider_accepted', at: new Date(AT.getTime() + 60_000) })!;
        expect(isPaused(cleared)).toBe(false);
        expect(cleared.clearedBy).toBe('provider_accepted');
        // Kept rather than deleted: "this happened and was fixed" is what an
        // operator needs when it happens a second time.
        expect(cleared.since).toBe(AT.toISOString());
    });

    it('lets a person who fixed the card try again', () => {
        // Without this, a paused account can only recover by being sent from —
        // which it cannot be, because it is paused.
        const cleared = clearPause(applyFundingSignal(null, signal(AT)),
            { by: 'operator', note: 'card added in Meta Business Manager' })!;
        expect({ by: cleared.clearedBy, note: cleared.clearedNote })
            .toEqual({ by: 'operator', note: 'card added in Meta Business Manager' });
    });

    it('reopens with a new start date when the problem comes back', () => {
        const cleared = clearPause(applyFundingSignal(null, signal(AT)), { by: 'operator' });
        const relapse = new Date(AT.getTime() + 30 * 86_400_000);
        const reopened = applyFundingSignal(cleared, signal(relapse));
        expect({ since: reopened.since, seen: reopened.observations, paused: isPaused(reopened) })
            .toEqual({ since: relapse.toISOString(), seen: 1, paused: true });
    });

    it('clearing something that is not paused changes nothing', () => {
        expect(clearPause(null, { by: 'operator' })).toBeNull();
    });
});

describe('reading it back out of an account', () => {
    const stored = (over: Record<string, unknown> = {}) => ({
        sendPause: {
            reason: 'funding_not_ready', code: 131042, detail: 'no payment method',
            since: AT.toISOString(), lastSeen: AT.toISOString(), source: 'http_response',
            observations: 2, ...over,
        },
    });

    it('round-trips a real pause', () => {
        const pause = readPause(stored())!;
        expect({ paused: isPaused(pause), code: pause.code, seen: pause.observations })
            .toEqual({ paused: true, code: 131042, seen: 2 });
    });

    it('treats anything malformed as NOT paused', () => {
        // The failure mode matters. A garbled field read as "paused" silences a
        // working account on the strength of a JSON typo; read as "not paused"
        // it costs money and is visible in the ledger the same day.
        expect(readPause(undefined)).toBeNull();
        expect(readPause({ sendPause: 'yes' })).toBeNull();
        expect(readPause({ sendPause: { reason: 'something_else' } })).toBeNull();
        expect(readPause(stored({ since: 'not a date' }))).toBeNull();
        expect(readPause(stored({ clearedAt: 'soon' }))).toBeNull();
    });

    it('reads a cleared pause as not paused', () => {
        const pause = readPause(stored({ clearedAt: AT.toISOString(), clearedBy: 'operator' }))!;
        expect(isPaused(pause)).toBe(false);
    });

    it('explains itself in terms somebody can act on', () => {
        const line = describePause(readPause(stored())!);
        // The three things a paused account must say: what stopped, that it is
        // Meta's bill and not ours, and that customers are still being heard.
        expect(line).toContain('paused');
        expect(line).toContain('Meta charges the business directly');
        expect(line).toContain('Incoming messages are still being received');
    });
});

describe('what a pause never touches', () => {
    it('is a property of one account, carried nowhere else', () => {
        // The type carries no tenant and no other account, so there is nothing
        // for a wider pause to be written into. A tenant with a second number
        // on a funded WABA keeps working by construction.
        const pause: SendPause = applyFundingSignal(null,
            fundingSignalFrom({ source: 'http_response', code: 131042, at: AT })!);
        expect(Object.keys(pause).sort())
            .toEqual(['code', 'detail', 'lastSeen', 'observations', 'reason', 'since', 'source']);
    });
});
