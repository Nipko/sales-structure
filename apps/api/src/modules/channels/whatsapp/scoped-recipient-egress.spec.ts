import { WhatsAppAdapter } from './whatsapp.adapter';
import {
    isScopedAddressKey, parseScopedAddressKey, SCOPED_ADDRESS_PREFIX,
    whatsAppProviderRecipient,
} from '@parallext/shared';

/**
 * ═══ THE OUTBOUND HALF OF A PHONE-PRIVATE CUSTOMER ═══
 *
 * The ingress can now accept a customer who wrote without a phone number: their
 * `contacts.external_id` is `bsuid:<portfolio>:<id>`, and that string is what a
 * producer carries as the recipient.
 *
 * Meta accepts either a phone or a raw BSUID in the same `to` field. The
 * portfolio prefix exists only in our storage key, to prevent two businesses
 * from merging contacts. The transport removes that envelope at the last hop.
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

    it('posts a raw business-scoped id without its storage-only portfolio prefix', async () => {
        const a = adapter();
        try {
            const outcome = await a.instance.sendStrict(
                request(`${SCOPED_ADDRESS_PREFIX}waba-1:BSU_abc123XYZ`), 'token');
            expect(outcome).toEqual({ kind: 'accepted', receipt: 'wamid.OUT' });
            expect(a.posts).toHaveLength(1);
            expect(a.posts[0].body.to).toBe('BSU_abc123XYZ');
        } finally { a.restore(); }
    });

    it('refuses a malformed scoped key before posting', async () => {
        const a = adapter();
        try {
            const outcome = await a.instance.sendStrict(request('bsuid:waba-1:'), 'token');
            expect(outcome).toEqual({
                kind: 'rejected', errorCode: 'recipient_not_addressable', retryable: false,
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
        expect(parseScopedAddressKey('bsuid:waba-1:BSU_abc123XYZ'))
            .toEqual({ portfolioId: 'waba-1', identifier: 'BSU_abc123XYZ' });
        expect(whatsAppProviderRecipient('bsuid:waba-1:BSU_abc123XYZ')).toBe('BSU_abc123XYZ');
        expect(whatsAppProviderRecipient('573001112233')).toBe('573001112233');
    });

    it('accepts the documented 256-character BSUID bound and refuses 257', () => {
        const atLimit = 'A'.repeat(256);
        const overLimit = 'A'.repeat(257);
        expect(parseScopedAddressKey(`bsuid:waba-1:${atLimit}`)?.identifier).toBe(atLimit);
        expect(parseScopedAddressKey(`bsuid:waba-1:${overLimit}`)).toBeNull();
        expect(whatsAppProviderRecipient(`bsuid:waba-1:${overLimit}`)).toBeNull();
    });
});
