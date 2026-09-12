/**
 * ═══ WHO WROTE, WHEN THERE MAY BE NO PHONE NUMBER ═══
 *
 * Every part of this platform identifies a WhatsApp customer by their phone.
 * Meta's business-scoped user ids end that assumption: a person can write
 * without the business ever seeing a number, and the webhook then carries
 * `from_user_id` where it used to carry `from`. That half this repository
 * genuinely RECEIVES: both ingress roads read it.
 *
 * The status half is a claim, not an observation. Meta's business-scoped id
 * page — summarised in `docs/research/2026-09-10/` — says statuses carry
 * `recipient_user_id` and that some failed statuses carry no contact
 * identifier at all. Nothing in this codebase has ever received that field:
 * both surviving status readers take `recipient_id` only. So this module is
 * wired for the INBOUND side, and `whatsAppStatusIdentity` below has no
 * production caller.
 *
 * That message USED TO BE discarded. Both ingresses required `msg.from` to be
 * a non-empty string and logged "Mensaje SIN REMITENTE descartado" otherwise —
 * deliberately, because a sender with no address was unanswerable and would
 * have broken the `contacts` INSERT. Against a portfolio where usernames have
 * rolled out, that reasoning turned into silence: the customer wrote, nothing
 * answered, and the only trace was an error log.
 *
 * They now ask this module instead, and discard only when NO identity resolves
 * at all. Written in the past tense on purpose: this paragraph was left in the
 * present by the same batch that fixed it, three paragraphs below a sentence
 * saying both ingress roads read the field — so the file contradicted itself,
 * and the sentence a reader uses to decide whether phone-less inbound is still
 * broken said yes when the answer was no.
 *
 * ── WHY THIS IS A TYPE AND NOT A STRING ─────────────────────────────────────
 *
 * The temptation is to put the opaque id where the phone used to go. Two things
 * break immediately:
 *
 *   · `normalizePhoneE164` would run over it. It strips non-digits and applies
 *     country rules, so an opaque id becomes a plausible-looking phone number
 *     that belongs to somebody else. A wrong number is not a failed send; it is
 *     a message delivered to a stranger.
 *   · `contacts` is keyed `(channel_type, external_id)`. A business-scoped id is
 *     unique WITHIN a portfolio and says nothing across them, so two portfolios
 *     that happen to mint the same string would be fused into one contact —
 *     the same defect as coercing an unknown sender to `''`, which this
 *     repository has already had once.
 *
 * So the address carries its KIND, and the key for a scoped id carries the
 * scope. A phone stays exactly what it was, byte for byte, so nothing about
 * existing contacts moves.
 *
 * ── PROVENANCE, BECAUSE AN ALIAS IS A CLAIM ─────────────────────────────────
 *
 * When both arrive, the phone is an alias the PORTFOLIO asserts for this user.
 * It is recorded with where it came from, never inferred: a username and a
 * business-scoped id are different things, the id changes when the person
 * changes their number, and two businesses seeing "the same" person is not
 * something either of them may be told.
 */

/** How a WhatsApp counterpart can be addressed. */
export type WhatsAppAddressKind = 'phone' | 'business_scoped';

export interface WhatsAppChannelIdentity {
    readonly kind: WhatsAppAddressKind;
    /**
     * The stable key for this counterpart on this channel.
     *
     * A phone is itself, unchanged — existing contacts must not move. A scoped
     * id is prefixed with its portfolio, because it means nothing outside one.
     */
    readonly addressKey: string;
    /** The raw identifier as Meta sent it. */
    readonly identifier: string;
    /** The portfolio the identifier is scoped to, for `business_scoped`. */
    readonly portfolioId: string | null;
    /**
     * A phone, ONLY when Meta actually sent one.
     *
     * Never derived from the identifier, never guessed from a prefix. Absent is
     * a real answer and callers have to handle it: a person who has not shared
     * their number can still ask a question and get one answered.
     */
    readonly phone: string | null;
    /** Where the phone came from, so an alias is never mistaken for a fact. */
    readonly phoneProvenance: 'message_sender' | 'portfolio_contact' | null;
}

/** A scoped id is opaque: digits, letters, and the separators Meta uses. */
const SCOPED_ID = /^[A-Za-z0-9_-]{4,120}$/;
/** A phone as Meta sends it on this surface: digits, no plus, no spaces. */
const WA_PHONE = /^[0-9]{6,20}$/;

const text = (value: unknown): string =>
    (typeof value === 'string' ? value.trim() : '');

/**
 * The portfolio a scoped identifier belongs to.
 *
 * Falls back to the WABA id, then to the phone number id, because those are the
 * two things every webhook carries and either bounds the scope correctly. It is
 * NEVER allowed to be empty: an unscoped key would be the collision this whole
 * module exists to prevent, so an identity that cannot be scoped is refused.
 */
export interface PortfolioScope {
    readonly wabaId?: string | null;
    readonly phoneNumberId?: string | null;
}

function scopeOf(scope: PortfolioScope): string | null {
    return text(scope.wabaId) || text(scope.phoneNumberId) || null;
}

/**
 * Read who wrote, from one webhook message plus the batch's contact list.
 *
 * `null` means the message names nobody this process can answer — which stays a
 * discard, as it was, but now only for the case that really is anonymous rather
 * than for every message without a phone.
 */
export function whatsAppSenderIdentity(
    message: unknown,
    contacts: readonly unknown[],
    scope: PortfolioScope,
): WhatsAppChannelIdentity | null {
    const msg = (message ?? {}) as Record<string, unknown>;
    const from = text(msg.from);
    const scopedId = text(msg.from_user_id) || text(msg.user_id);

    // The batch-level contact row for this sender. Matched on whichever
    // identifier the message carried, and — as before — falling back to the
    // single contact only when there is exactly one, where no ambiguity exists.
    const rows = (contacts ?? []).map(row => (row ?? {}) as Record<string, unknown>);
    const contact = rows.find(row =>
        (from && text(row.wa_id) === from)
        || (scopedId && (text(row.user_id) === scopedId || text(row.wa_id) === scopedId)))
        ?? (rows.length === 1 ? rows[0] : undefined);

    // ── THE EXISTING PATH IS NOT ALLOWED TO MOVE ────────────────────────────
    //
    // Any non-empty `from` is a phone, byte for byte, exactly as before. An
    // earlier version required six-to-twenty digits, which looks like sanity
    // and is actually a new way to DISCARD a real customer's message: this
    // change is supposed to be purely additive, and a shape rule applied to the
    // identifier every tenant already uses is the opposite of additive.
    //
    // `WA_PHONE` still decides whether an ALIAS asserted by a portfolio is
    // well-formed enough to store, which is a new field nobody depends on yet.
    if (from) {
        return Object.freeze({
            kind: 'phone' as const,
            addressKey: from,
            identifier: from,
            portfolioId: scopeOf(scope),
            phone: from,
            phoneProvenance: 'message_sender' as const,
        });
    }

    if (!scopedId || !SCOPED_ID.test(scopedId)) return null;

    const portfolioId = scopeOf(scope);
    // Refused rather than keyed on the bare id: a scoped identifier with no
    // scope is a key two portfolios can collide on, and a collision here merges
    // two strangers into one contact with one conversation history.
    if (!portfolioId) return null;

    // A phone the PORTFOLIO asserts for this user, if it sent one. Only a
    // well-formed one: a malformed alias recorded as fact is worse than none.
    const asserted = text(contact?.wa_id);
    const phone = asserted && WA_PHONE.test(asserted) ? asserted : null;

    return Object.freeze({
        kind: 'business_scoped' as const,
        addressKey: `bsuid:${portfolioId}:${scopedId}`,
        identifier: scopedId,
        portfolioId,
        phone,
        phoneProvenance: phone ? ('portfolio_contact' as const) : null,
    });
}

/**
 * Who a delivery status is about. NOT WIRED — no production caller.
 *
 * Kept because the shape is right and the wiring would be one line, not
 * because anything uses it: both status readers take `recipient_id`, and
 * neither imports this. `recipient_user_id` appears nowhere in this codebase
 * outside this function and its unit spec — it is Meta's DOCUMENTED field,
 * not one we have observed arriving, and the difference is the whole reason
 * this sentence is here. The raw status bodies are already stored verbatim
 * in `whatsapp_webhook_events`, which is where that evidence will come from.
 *
 * When a real status with a scoped recipient turns up there, wire this and
 * delete the "not wired" sentence in the SAME commit: the claim and the
 * caller move together, or this docblock becomes the next defect.
 *
 * Until then the only branch that runs is the fallback: a `recipient_id` is
 * a phone byte for byte, and a status naming nobody answers `null` — it is
 * still about a message we sent, identified by its `wamid`, and inventing a
 * recipient to attach it to would be worse than recording it against the
 * message alone.
 */
export function whatsAppStatusIdentity(
    status: unknown,
    scope: PortfolioScope,
): WhatsAppChannelIdentity | null {
    const row = (status ?? {}) as Record<string, unknown>;
    return whatsAppSenderIdentity(
        { from: text(row.recipient_id), from_user_id: text(row.recipient_user_id) },
        [],
        scope,
    );
}

/** The prefix a business-scoped address key carries. */
export const SCOPED_ADDRESS_PREFIX = 'bsuid:';

/**
 * Is this stored address key a business-scoped id rather than a phone?
 *
 * The question every SEND has to ask now that the ingress can accept one.
 * `contacts.external_id` is what producers carry as the recipient, and for a
 * scoped sender that string is `bsuid:<portfolio>:<id>` — which is not a
 * destination Meta's `/messages` endpoint understands in the `to` field.
 */
export function isScopedAddressKey(address: unknown): boolean {
    return typeof address === 'string' && address.startsWith(SCOPED_ADDRESS_PREFIX);
}

/**
 * Is this string safe to hand to phone normalisation?
 *
 * The one question every existing caller has to start asking. `normalizePhoneE164`
 * strips non-digits and applies country rules, so a business-scoped id would come
 * out of it as a plausible phone number belonging to somebody else.
 */
export function isDiallable(identity: WhatsAppChannelIdentity | null | undefined): boolean {
    return !!identity && identity.kind === 'phone';
}

/**
 * The phone to use for anything that genuinely requires one, or `null`.
 *
 * Authentication templates (copy-code, one-tap, zero-tap) require a phone, and
 * so does an SMS fallback. A caller that gets `null` must ask for it and say
 * what for — not guess, and not quietly skip the step.
 */
export function diallablePhone(identity: WhatsAppChannelIdentity | null | undefined): string | null {
    if (!identity) return null;
    return identity.phone;
}
