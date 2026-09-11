import {
    readFundingFromGraph, readFundingFromRefusal, neverAsked, moreAuthoritative,
    deliveryReadiness, FUNDING_READINESS_STATES, PAYMENT_ELIGIBILITY_CODES,
} from './whatsapp-funding-readiness';

/**
 * ═══ "WE COULD NOT ASK" IS NOT "THERE IS NOTHING THERE" ═══
 *
 * From 1 October a WhatsApp account with no payment method attached STOPS
 * delivering. The engine already reacts to that after the fact — 131042 pauses
 * the account — and this is the question asked before, so a tenant can fix it
 * while their customers are still getting answers.
 *
 * `absent` is the expensive answer: it is the one that makes the product tell
 * somebody to go and add a card. Every case below is about not reaching it on
 * anything less than a valid answer to the right question. Getting that wrong
 * sends a working tenant to fix a problem they do not have, and a tenant who
 * has been sent on one false errand does not act on the next warning.
 *
 * Nothing here is fetched. The module classifies an answer somebody else got,
 * which is what lets these cases cover shapes nobody can reproduce on demand —
 * a 500 mid-migration, a token that lost a permission between two calls.
 */

const AT = new Date('2026-09-20T12:00:00.000Z');
const LATER = new Date('2026-09-21T12:00:00.000Z');

const graph = (over: Partial<Parameters<typeof readFundingFromGraph>[0]> = {}) =>
    readFundingFromGraph({
        status: 200, body: {}, requestedFundingField: true, ...over,
    }, AT);

const metaError = (code: number, message = 'synthetic') =>
    ({ error: { message, type: 'OAuthException', code, fbtrace_id: 'Axxxxx' } });

describe('whether a number can still be charged after 1 October', () => {
    it('has a state for every way the question can turn out', () => {
        expect([...FUNDING_READINESS_STATES].sort())
            .toEqual(['absent', 'attached', 'not_checked', 'restricted', 'unknown']);
    });

    describe('the answer that costs somebody an errand', () => {
        it('concludes absence from a valid answer that asked the right question', () => {
            const reading = graph({ body: { id: '123' }, requestedFundingField: true });
            expect(reading.state).toBe('absent');
            expect(reading.actionable).toBe(true);
            expect(reading.detail).toContain('1 de octubre');
        });

        it('does NOT conclude absence from a 200 that never asked for the field', () => {
            // A Graph read returns only the fields requested. An absent key in
            // a response you did not ask the right question of proves nothing,
            // and the cheap reading — "no key, no card" — is the one that
            // produces the false alarm.
            const reading = graph({ body: { id: '123' }, requestedFundingField: false });
            expect(reading.state).toBe('unknown');
            expect(reading.detail).toContain('no pidió el campo');
        });

        it.each([
            ['a token that may not read the account', 190],
            ['a permission the app no longer has', 10],
            ['an API-level permission error', 200],
            ['a rate-limited app', 803],
        ])('does NOT conclude absence from %s', (_case, code) => {
            const reading = graph({ status: 400, body: metaError(code) });
            expect(reading.state).toBe('unknown');
            expect(reading.detail).toContain('falta permiso, no falta tarjeta');
        });

        it.each([500, 502, 503, 429])(
            'does NOT conclude absence from a %s', status => {
                const reading = graph({ status, body: metaError(1) });
                expect(reading.state).toBe('unknown');
                expect(reading.detail).toContain('problema de Meta');
            });

        it('does NOT conclude absence from a request that never got an answer', () => {
            // A timeout and a refusal look identical from here and are not.
            const reading = graph({ status: 0, body: null });
            expect(reading.state).toBe('unknown');
            expect(reading.detail).toContain('no es lo mismo que no haberlo');
        });

        it('treats a blank funding id as absence, not as attachment', () => {
            expect(graph({ body: { primary_funding_id: '   ' } }).state).toBe('absent');
        });

        it.each([null, 0, false, [], {}])(
            'treats a funding id of %p as absence rather than a value', value => {
                expect(graph({ body: { primary_funding_id: value } }).state).toBe('absent');
            });
    });

    describe('attachment, which is not solvency', () => {
        it('reads an attached funding id as attached', () => {
            const reading = graph({ body: { primary_funding_id: 'fund-1' } });
            expect(reading.state).toBe('attached');
            expect(reading.actionable).toBe(false);
        });

        it('says out loud that attached does not mean it will be approved', () => {
            // A card can be attached and declined, expired, or over its limit,
            // and Meta will still say it is attached. A green tick that implies
            // solvency is a promise this system cannot keep.
            expect(graph({ body: { primary_funding_id: 'fund-1' } }).detail)
                .toContain('no garantiza que tenga fondos');
        });
    });

    describe('a refusal Meta actually made', () => {
        it('reads 131042 in a Graph body as restricted, whatever the status', () => {
            const reading = graph({ status: 400, body: metaError(131042, 'not eligible') });
            expect(reading.state).toBe('restricted');
            expect(reading.actionable).toBe(true);
            expect(reading.detail).toContain('131042');
        });

        it('turns the same code observed on a SEND into the same state', () => {
            // The send path already pauses on this. Sharing the reading is what
            // stops the pause banner and the readiness panel saying different
            // things about one number.
            const reading = readFundingFromRefusal({ errorCode: 131042, detail: 'blocked' }, AT)!;
            expect(reading.state).toBe('restricted');
            expect(reading.source).toBe('provider_refusal');
        });

        it.each([131026, 131047, 100, 0, null, undefined, 'nonsense'])(
            'says nothing about funding for code %p', code => {
                expect(readFundingFromRefusal({ errorCode: code as any }, AT)).toBeNull();
            });

        it('names the codes it treats as payment eligibility, so they can be argued with', () => {
            expect([...PAYMENT_ELIGIBILITY_CODES]).toEqual([131042]);
        });
    });

    describe('never having asked', () => {
        it('is its own state, not a synonym for absent', () => {
            // A tenant who connected a number five minutes ago has not been
            // checked. Telling them their funding is missing is a guess dressed
            // as a finding.
            const reading = neverAsked();
            expect(reading.state).toBe('not_checked');
            expect(reading.checkedAt).toBeNull();
            expect(reading.actionable).toBe(false);
            expect(reading.detail).toContain('no es lo mismo que sin método de pago');
        });
    });

    describe('which of two readings wins', () => {
        it('lets an observed refusal beat a newer configuration read', () => {
            // Meta refusing a real send is stronger evidence than a field on a
            // resource, and it is the one a customer already felt.
            const refusal = readFundingFromRefusal({ errorCode: 131042 }, AT)!;
            const attached = readFundingFromGraph(
                { status: 200, body: { primary_funding_id: 'fund-1' }, requestedFundingField: true },
                LATER);
            expect(moreAuthoritative(refusal, attached)).toBe(refusal);
            expect(moreAuthoritative(attached, refusal)).toBe(refusal);
        });

        it('never lets an unknown erase something that was established', () => {
            // A timeout must not make yesterday's `absent` disappear. A warning
            // that clears itself on a network hiccup is worse than no warning.
            const absent = readFundingFromGraph(
                { status: 200, body: {}, requestedFundingField: true }, AT);
            const timedOut = readFundingFromGraph(
                { status: 0, body: null, requestedFundingField: true }, LATER);
            expect(moreAuthoritative(absent, timedOut)).toBe(absent);
            expect(moreAuthoritative(timedOut, absent)).toBe(absent);
        });

        it('lets a newer established reading replace an older one', () => {
            // Somebody adding a card must clear the warning.
            const absent = readFundingFromGraph(
                { status: 200, body: {}, requestedFundingField: true }, AT);
            const attached = readFundingFromGraph(
                { status: 200, body: { primary_funding_id: 'fund-1' }, requestedFundingField: true },
                LATER);
            expect(moreAuthoritative(absent, attached)).toBe(attached);
        });

        it('lets anything at all replace never having asked', () => {
            const attached = readFundingFromGraph(
                { status: 200, body: { primary_funding_id: 'f' }, requestedFundingField: true }, AT);
            expect(moreAuthoritative(neverAsked(), attached)).toBe(attached);
        });
    });

    describe('what the product does with it', () => {
        it('calls only an attached account ready', () => {
            expect(deliveryReadiness(graph({ body: { primary_funding_id: 'f' } }))).toBe('ready');
        });

        it.each([
            ['absent', { status: 200, body: {}, requestedFundingField: true }],
            ['restricted', { status: 400, body: metaError(131042), requestedFundingField: true }],
        ])('calls a %s account not ready', (_state, answer) => {
            expect(deliveryReadiness(readFundingFromGraph(answer as any, AT))).toBe('not_ready');
        });

        it.each([
            ['a timeout', { status: 0, body: null, requestedFundingField: true }],
            ['a permission error', { status: 400, body: metaError(190), requestedFundingField: true }],
            ['a 200 that asked nothing', { status: 200, body: {}, requestedFundingField: false }],
        ])('calls %s unestablished — neither ready nor not ready', (_case, answer) => {
            expect(deliveryReadiness(readFundingFromGraph(answer as any, AT))).toBe('unestablished');
        });

        it('calls a never-checked account unestablished', () => {
            expect(deliveryReadiness(neverAsked())).toBe('unestablished');
        });

        it('asks a person to act only about something established', () => {
            // `unknown` is not actionable: the thing to do about it is ask
            // again, which is the system's job. Putting it in front of somebody
            // is how a warning becomes noise and the real one gets ignored.
            const actionable = (answer: any) => readFundingFromGraph(answer, AT).actionable;
            expect(actionable({ status: 200, body: {}, requestedFundingField: true })).toBe(true);
            expect(actionable({ status: 400, body: metaError(131042), requestedFundingField: true }))
                .toBe(true);
            expect(actionable({ status: 0, body: null, requestedFundingField: true })).toBe(false);
            expect(actionable({ status: 500, body: null, requestedFundingField: true })).toBe(false);
        });
    });

    it('always says why, whatever it concluded', () => {
        // A state with no sentence behind it is a state nobody can act on or
        // argue with.
        const readings = [
            neverAsked(),
            graph({ body: { primary_funding_id: 'f' } }),
            graph({ body: {} }),
            graph({ status: 0, body: null }),
            graph({ status: 400, body: metaError(131042) }),
        ];
        for (const reading of readings) {
            expect(reading.detail.length).toBeGreaterThan(30);
            expect(reading.detail.startsWith(reading.state)).toBe(true);
        }
    });
});
