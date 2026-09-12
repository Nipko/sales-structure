import { WhatsAppAdapter } from './whatsapp.adapter';
import { isScopedAddressKey, SCOPED_ADDRESS_PREFIX } from '@parallext/shared';

/**
 * ═══ THE OUTBOUND HALF THAT DOES NOT EXIST YET ═══
 *
 * The ingress can now accept a customer who wrote without a phone number: their
 * `contacts.external_id` is `bsuid:<portfolio>:<id>`, and that string is what a
 * producer carries as the recipient.
 *
 * Put in `to`, it is not a destination. Meta's `/messages` endpoint expects a
 * phone there, so the POST is rejected and what an operator sees is a provider
 * error about a malformed number, on a conversation that looks entirely
 * ordinary. Worse, it is a charge attempt and a retry loop for a message that
 * can never land.
 *
 * Meta DOES accept a business-scoped id as a destination, through a different
 * field. Implementing that against a shape nobody here has exercised would be
 * guessing, and guessing about a destination is how a message reaches the wrong
 * person. So the transport refuses by name and without posting: a gap that says
 * so is not an outage, and the refusal is the thing that keeps it visible.
 */
describe('sending to a customer who has no phone number', () => {
    function adapter() {
        const posts: any[] = [];
        const instance: any = Object.create(WhatsAppAdapter.prototype);
        Object.assign(instance, {
            apiUrl: 'https://graph.facebook.com/v21.0',
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        const realFetch = globalThis.fetch;
        (globalThis as any).fetch = jest.fn(async (url: string, init: any) => {
            posts.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
            return {
                ok: true, status: 200,
                json: async () => ({ messages: [{ id: 'wamid.OUT' }] }),
                text: async () => '',
            } as any;
        });
        return { instance, posts, restore: () => { (globalThis as any).fetch = realFetch; } };
    }

    const request = (to: string) => ({
        itemKind: 'text' as const,
        to,
        channelAccountId: '15550001111',
        payload: { text: 'hola' },
    });

    it('refuses a business-scoped recipient without posting anything', async () => {
        const a = adapter();
        try {
            const outcome = await a.instance.sendStrict(
                request(`${SCOPED_ADDRESS_PREFIX}waba-1:BSU_abc123XYZ`), 'token');
            expect(outcome).toEqual({
                kind: 'rejected',
                errorCode: 'scoped_recipient_unsupported',
                // Not retryable: no amount of waiting turns this into an
                // address, and a retry is a second charge attempt for a message
                // that can never land.
                retryable: false,
            });
            expect(a.posts).toEqual([]);
        } finally { a.restore(); }
    });

    it('still sends to a phone exactly as it did', async () => {
        const a = adapter();
        try {
            const outcome = await a.instance.sendStrict(request('573001112233'), 'token');
            // 'accepted': the provider took it, which is not the same as
            // delivered — this transport is careful about that distinction.
            expect(outcome.kind).toBe('accepted');
            expect(a.posts).toHaveLength(1);
            expect(a.posts[0].body.to).toBe('573001112233');
        } finally { a.restore(); }
    });

    it('recognises the key shape the ingress writes, and nothing else', () => {
        expect(isScopedAddressKey('bsuid:waba-1:BSU_abc')).toBe(true);
        // A phone must never be mistaken for one, or every send stops.
        expect(isScopedAddressKey('573001112233')).toBe(false);
        expect(isScopedAddressKey('')).toBe(false);
        expect(isScopedAddressKey(null)).toBe(false);
        expect(isScopedAddressKey(undefined)).toBe(false);
    });
});
