import { pressKey } from './press-key';

/**
 * ═══ THE KEY THAT NAMES THE PRESS ═══
 *
 * The console's durable origin key was `agent_console:<conversation>:<randomUUID()>`
 * whenever the caller did not name the press — and no caller ever did, so the
 * duplicate the inventory named as a property of the old inline lane ("a double
 * click, a retried request or a reconnecting socket sends the message again")
 * survived the migration onto the durable lane, now with a committed row per
 * copy. `ProactiveDispatchService.originId` forbids `randomUUID` in as many
 * words, for this exact reason.
 *
 * The client supplies the key now, which makes its SHAPE an input from outside.
 * These cases are about what that means.
 */
describe('the press key a console client supplies', () => {
    it('accepts an opaque token the client can reproduce on its retry', () => {
        expect(pressKey('7f3a9c1e4b2d48f0a6c5')).toBe('7f3a9c1e4b2d48f0a6c5');
        expect(pressKey('  press_2026-10-05_a1  ')).toBe('press_2026-10-05_a1');
    });

    it('refuses a key carrying the outbox’s own separator', () => {
        // `agent_console:<conversation>:<press>` is a grammar, and a colon in
        // the last field lets a caller write the middle one. Two conversations
        // could then be made to collide on a single row — one customer's reply
        // suppressed as a duplicate of another's.
        expect(pressKey('abcdefgh:injected')).toBeUndefined();
        expect(pressKey('abcdefgh/injected')).toBeUndefined();
        expect(pressKey('abcdefgh injected')).toBeUndefined();
    });

    it('refuses one too short to be an identity, or too long to be a key', () => {
        expect(pressKey('short')).toBeUndefined();
        expect(pressKey('x'.repeat(121))).toBeUndefined();
        expect(pressKey('x'.repeat(120))).toBe('x'.repeat(120));
    });

    it('answers undefined for anything that is not a string', () => {
        for (const value of [undefined, null, 42, {}, [], true]) {
            expect(pressKey(value)).toBeUndefined();
        }
    });

    it('refuses rather than failing the send', () => {
        // The consequence of the shape check, stated as a property: a malformed
        // key costs the caller its protection against a repeat, never the
        // customer their reply. `undefined` is what the service reads as "this
        // caller named no press", which is exactly today's behaviour.
        expect(pressKey('!!!')).toBeUndefined();
    });
});
