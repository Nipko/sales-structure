import { WhatsappSpendService, joinForHash } from './whatsapp-spend.service';

/**
 * ═══ THE KEY A RETRY RECOMPUTES ═══
 *
 * The reservation row is the single witness of an uncertain COMMIT, and it is
 * only reachable if the key can be derived from the effect alone. A random id
 * minted inside a failed attempt is not recomputable, so the retry would mint a
 * second one and double-spend — the same class of mistake as the outbound
 * `jobId` incident.
 *
 * Two properties matter and neither is obvious: the same effect must always
 * produce the same key, and two DIFFERENT effects must never produce the same
 * one. A colliding key is one message adopting another message's reservation.
 */
describe('the effect key', () => {
    const service = new WhatsappSpendService({} as any);
    const base = {
        tenantId: '11111111-1111-4111-8111-111111111111',
        channelAccountId: '15550001111',
        recipientRef: 'contact-1',
        category: 'service',
        producer: 'conversation_reply',
        ordinal: 0,
        contentDigest: 'abc123',
    };

    it('is the same for the same effect, every time', () => {
        expect(service.effectKey(base)).toBe(service.effectKey({ ...base }));
    });

    it('is hex, because BullMQ rejects a job id containing a colon', () => {
        expect(service.effectKey(base)).toMatch(/^[0-9a-f]{64}$/);
    });

    it.each(['tenantId', 'channelAccountId', 'recipientRef', 'category', 'producer', 'contentDigest'])(
        'changes when %s changes', field => {
            expect(service.effectKey({ ...base, [field]: 'different' }))
                .not.toBe(service.effectKey(base));
        });

    it('changes with the ordinal, so two items of one answer are two effects', () => {
        expect(service.effectKey({ ...base, ordinal: 1 })).not.toBe(service.effectKey(base));
    });

    describe('why the parts are length-prefixed', () => {
        it('cannot be made to collide by moving a boundary', () => {
            // Under any plain separator that can appear inside a part,
            // ("ab","c") and ("a","bc") hash identically — and a collision here
            // is one message adopting another's reservation.
            expect(joinForHash(['ab', 'c'])).not.toBe(joinForHash(['a', 'bc']));
            expect(service.effectKey({ ...base, recipientRef: 'ab', category: 'c' }))
                .not.toBe(service.effectKey({ ...base, recipientRef: 'a', category: 'bc' }));
        });

        it('cannot hide a corrupted separator', () => {
            // This codebase has already shipped a hash whose separator was
            // silently a NUL instead of a space; nineteen tests passed and an
            // independent recomputation found it. The prefix is the separator,
            // so there is nothing invisible left to get wrong.
            expect(joinForHash(['a', 'bb'])).toBe('1#a2#bb');
            expect(joinForHash([])).toBe('');
        });

        it('survives a part that contains the prefix character', () => {
            expect(joinForHash(['1#x'])).toBe('3#1#x');
            expect(joinForHash(['1#x'])).not.toBe(joinForHash(['1', 'x']));
        });
    });

    describe('the content digest', () => {
        it('is stable for the same content and different for different content', () => {
            expect(service.contentDigest(['hola', { a: 1 }]))
                .toBe(service.contentDigest(['hola', { a: 1 }]));
            expect(service.contentDigest(['hola'])).not.toBe(service.contentDigest(['hola ']));
        });

        it('does not keep the content, only a fixed-length digest of it', () => {
            // The key travels into logs and queue ids. A message body must not.
            const digest = service.contentDigest(['una frase muy identificable del cliente']);
            expect(digest).toMatch(/^[0-9a-f]{32}$/);
            expect(digest).not.toContain('cliente');
        });
    });
});
