/**
 * ═══ WHAT MAKES THIS PRESS OF SEND *THIS* PRESS ═══
 *
 * The console's durable origin key was `agent_console:${conversationId}:${randomUUID()}`
 * whenever the caller did not name the press — and no caller ever did. So the
 * one thing an origin key exists for was defeated at the only place it is
 * minted: `ProactiveDispatchService.originId`'s own docblock forbids
 * `randomUUID` in as many words, because "a random id minted inside a failed
 * attempt is not recomputable, so the retry would mint a second one and send a
 * second message". The inventory named that duplicate — "a double click, a
 * retried request or a reconnecting socket sends the message again" — as a
 * property of the OLD inline lane, while it survived the migration onto the
 * durable one, now with a committed row per copy.
 *
 * The fix is a key from the client, because only the client knows the
 * difference between the two cases the server cannot tell apart:
 *
 *   · the same press arriving twice — a timeout the server actually received,
 *     a socket reconnect, a retried request. One message is owed.
 *   · an agent deliberately sending "ok" twice. Two messages are owed.
 *
 * A key derived from the content would collapse the second into the first and
 * silently swallow an agent's second message, which is why it is not derived
 * from anything: it is an opaque token the console mints per press and reuses
 * when it retries that same press.
 *
 * ── WHY THE SHAPE IS VALIDATED AND NOT TRUSTED ──────────────────────────────
 *
 * The value reaches an `origin_key` that carries a UNIQUE constraint and is
 * read back in diagnostics. A caller that sent 4 KB of text, or a colon, would
 * be writing the outbox's own key grammar — `agent_console:<conversation>:<key>`
 * — from the outside, and two conversations could be made to collide on one
 * row. So anything that is not a short, flat token is refused, and refusing
 * means "behave as though none was sent" rather than failing the send: a
 * malformed key must not cost a customer their reply.
 */

/** A short opaque token: letters, digits, dash, underscore. No separators. */
const PRESS_KEY = /^[A-Za-z0-9_-]{8,120}$/;

/**
 * The supplied key if it is usable, or `undefined`.
 *
 * `undefined` is the honest default: it restores today's behaviour — one press,
 * one message, and no protection against a repeat — rather than inventing a key
 * the client cannot reproduce on its retry.
 */
export function pressKey(supplied: unknown): string | undefined {
    const value = typeof supplied === 'string' ? supplied.trim() : '';
    return PRESS_KEY.test(value) ? value : undefined;
}
