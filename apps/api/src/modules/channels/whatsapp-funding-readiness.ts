/**
 * ═══ IS THIS NUMBER READY TO KEEP DELIVERING AFTER 1 OCTOBER? ═══
 *
 * From 1 October 2026 Meta charges the business's own WhatsApp account per
 * delivered service message. Meta's own notice is a date, not a budget: a
 * WhatsApp Business account with no payment method on file by 30 September
 * 2026 stops having its service messages delivered as of 1 October 2026. It
 * does NOT say that the 1,000 free service deliveries per number and month
 * keep flowing without one, so nothing here may assume a card-less account
 * "still has its allowance" — see docs/whatsapp-meta-pricing-2026-10.md
 * (section 2, "Las reglas, con su fecha", and section 6).
 *
 * The engine already handles that AFTER the fact: error 131042 on a send, or on
 * a webhook after an HTTP 200, pauses the account's billable producers and
 * shows the administrator what to resolve. That is the right behaviour and it
 * is too late. The tenant finds out when their customers stop getting answers.
 *
 * This is the question asked BEFORE: for each number, does it have a funding
 * method attached, and when did we last actually establish that?
 *
 * ── THE FOUR WAYS THIS GOES WRONG, AND WHY EACH STATE EXISTS ────────────────
 *
 * `absent` is the expensive answer — it is the one that makes a product tell
 * somebody to go and add a card. Being wrong about it in either direction is
 * costly, so absence is only ever concluded from a VALID answer about the right
 * resource with the right permission:
 *
 *   · a Graph error or a timeout is `unknown`, never `absent`. "We could not
 *     ask" and "we asked and there is nothing" are different facts, and folding
 *     the first into the second sends a working tenant to fix a problem they do
 *     not have — after which they stop believing the next warning;
 *   · a 200 that did not include the field because nobody requested it, or
 *     because this token cannot see it, is `unknown` too. An absent key in a
 *     response you did not ask the right question of proves nothing;
 *
 *     KNOWN GAP, said out loud rather than left to be discovered: Graph tends to
 *     OMIT fields that have no value instead of emitting them as `null`. If a
 *     WABA with no payment method answers `{"id":"..."}` and nothing else, this
 *     function reports `unknown` — which means the one outcome the module was
 *     built to produce, "you have no card, go add one", may never be reached in
 *     practice. It is left this way on purpose: the same empty body is also what
 *     a token without billing permission gets, and the two are indistinguishable
 *     from here. Closing it needs evidence from a real account with and without
 *     funding under a Tech Provider token — not a guess encoded as a rule. Until
 *     then the screen says "we could not establish it", which is true, and the
 *     deadline copy tells the owner to add the method regardless;
 *
 *     RE-CHECKED 17-sep-2026 (Ola 6), because the panel reported exactly this:
 *     a WABA with no card reads `unknown`. The behaviour is confirmed and kept.
 *     What the code proves: `WhatsappConnectionService.checkFunding` asks for
 *     `?fields=id,primary_funding_id` and discards any 200 whose `id` is not
 *     this WABA, so by the time a body reaches this function the token CAN
 *     read the node — the ambiguity is only the one field. What Meta's
 *     reference says: the WhatsApp Business Account node lists
 *     `primary_funding_id` as a numeric string ("Primary funding ID for the
 *     WhatsApp Business Account paid service") under the node's own
 *     permissions, and says nothing about how "no funding source" is
 *     represented. An explicit `null` or `""` is therefore the only answer that
 *     is evidence of absence; an omitted key is either "none" or "not shown to
 *     a partner token", and Graph gives no marker to tell them apart. Mapping
 *     omission to `absent` would send every tenant whose card Meta simply does
 *     not show us to add one they already have. Consequence downstream: the
 *     `whatsapp_delivery` quality check raises `funding_absent` only from an
 *     established `absent`, never from `unknown`;
 *
 *   · `attached` is not solvency. A card can be attached and declined, expired
 *     or over its limit, and Meta will still say it is attached. So `attached`
 *     is never treated as "this will work", only as "the thing that is missing
 *     is not this";
 *   · `restricted` is what 131042 means: Meta says the business is not eligible
 *     to be charged right now. It outranks `attached`, because it is an observed
 *     refusal rather than a configuration reading.
 *
 * `not_checked` is the honest starting state, and it is deliberately not a
 * synonym for `absent`. A tenant who connected a number five minutes ago has
 * not been checked; telling them their funding is missing would be a guess
 * dressed as a finding.
 *
 * ── AND WHY NOTHING HERE CALLS META ─────────────────────────────────────────
 *
 * This module classifies an answer someone else fetched. It opens no
 * connection and holds no token, so it can be exercised exhaustively against
 * the shapes Meta actually returns — including the ones nobody can reproduce on
 * demand, like a 500 mid-migration — and the classification cannot drift from
 * the transport by being tested through a double of it.
 */

/** What we currently know about a number's ability to be charged. */
export const FUNDING_READINESS_STATES = [
    'not_checked', 'attached', 'absent', 'restricted', 'unknown',
] as const;
export type FundingReadinessState = (typeof FUNDING_READINESS_STATES)[number];

/** Where the conclusion came from. A state without this cannot be argued with. */
export const FUNDING_EVIDENCE_SOURCES = [
    /** Read from the WhatsApp Business Account resource on the Graph API. */
    'graph_account_read',
    /** Meta refused a send or a status with a payment-eligibility error. */
    'provider_refusal',
    /** Nobody has established anything yet. */
    'never_asked',
] as const;
export type FundingEvidenceSource = (typeof FUNDING_EVIDENCE_SOURCES)[number];

export interface FundingReadiness {
    readonly state: FundingReadinessState;
    readonly source: FundingEvidenceSource;
    /** Why, in a sentence an operator can act on. Always present. */
    readonly detail: string;
    /** When this was established. `null` only for `not_checked`. */
    readonly checkedAt: Date | null;
    /**
     * True when the state is one a person has to do something about.
     *
     * `unknown` is deliberately NOT actionable: the thing to do about it is ask
     * again, which is the system's job, not theirs. Putting it in front of
     * somebody is how a warning becomes noise and the real one gets ignored.
     */
    readonly actionable: boolean;
}

/** What a Graph read of the account looked like. Shaped, never fetched here. */
export interface GraphAccountAnswer {
    /** The HTTP status. `0` for a request that never got one. */
    readonly status: number;
    /** The parsed body, or `null` when there was none or it did not parse. */
    readonly body: unknown;
    /**
     * Whether the request actually ASKED for the funding field.
     *
     * A Graph read returns only the fields requested, so a response with no
     * `primary_funding_id` is evidence of absence exactly when the field was
     * requested. Without this flag the same body means two different things and
     * the cheap reading — "the key is missing, so there is no card" — is the
     * one that produces a false alarm.
     */
    readonly requestedFundingField: boolean;
}

const detailOf = (state: FundingReadinessState, why: string) => `${state}: ${why}`;

/** Meta's own error codes that mean "this business cannot be charged". */
export const PAYMENT_ELIGIBILITY_CODES: readonly number[] = Object.freeze([131042]);

/** Graph errors that mean "we were not allowed to look", never "nothing is there". */
const PERMISSION_CODES: readonly number[] = Object.freeze([10, 190, 200, 803]);

const readError = (body: unknown): { code: number | null; message: string } => {
    const error = (body as any)?.error;
    if (!error || typeof error !== 'object') return { code: null, message: '' };
    const code = Number(error.code);
    return {
        code: Number.isFinite(code) ? code : null,
        message: String(error.message ?? error.type ?? '').slice(0, 200),
    };
};

/**
 * Classify one Graph read of a WhatsApp Business Account.
 *
 * Never throws and never returns `attached` on anything but a 200 that was
 * asked the right question and answered it.
 */
export function readFundingFromGraph(answer: GraphAccountAnswer, at: Date): FundingReadiness {
    const checkedAt = at;
    const { code, message } = readError(answer.body);

    // An observed payment-eligibility refusal outranks everything: it is Meta
    // saying no, not a field being read.
    if (code !== null && PAYMENT_ELIGIBILITY_CODES.includes(code)) {
        return Object.freeze({
            state: 'restricted' as const, source: 'graph_account_read' as const, checkedAt,
            actionable: true,
            detail: detailOf('restricted',
                `Meta rechazó por elegibilidad de pago (${code})${message ? `: ${message}` : ''}`),
        });
    }

    if (answer.status === 0) {
        return Object.freeze({
            state: 'unknown' as const, source: 'graph_account_read' as const, checkedAt,
            actionable: false,
            detail: detailOf('unknown', 'la consulta a Meta no obtuvo respuesta; '
                + 'no sabemos si hay método de pago, y no saberlo no es lo mismo que no haberlo'),
        });
    }

    if (code !== null && PERMISSION_CODES.includes(code)) {
        return Object.freeze({
            state: 'unknown' as const, source: 'graph_account_read' as const, checkedAt,
            actionable: false,
            detail: detailOf('unknown', `el token no pudo leer la cuenta (${code})`
                + `${message ? `: ${message}` : ''}; falta permiso, no falta tarjeta`),
        });
    }

    if (answer.status >= 500 || answer.status === 429) {
        return Object.freeze({
            state: 'unknown' as const, source: 'graph_account_read' as const, checkedAt,
            actionable: false,
            detail: detailOf('unknown',
                `Meta contestó ${answer.status}; es un problema de Meta, no del método de pago`),
        });
    }

    if (answer.status !== 200) {
        return Object.freeze({
            state: 'unknown' as const, source: 'graph_account_read' as const, checkedAt,
            actionable: false,
            detail: detailOf('unknown', `Meta contestó ${answer.status}`
                + `${message ? ` (${message})` : ''}`),
        });
    }

    // A 200 that was never asked the question answers nothing.
    if (!answer.requestedFundingField) {
        return Object.freeze({
            state: 'unknown' as const, source: 'graph_account_read' as const, checkedAt,
            actionable: false,
            detail: detailOf('unknown', 'la consulta no pidió el campo de financiación, '
                + 'así que su ausencia en la respuesta no prueba nada'),
        });
    }

    const funding = (answer.body as any)?.primary_funding_id;
    if (!answer.body || typeof answer.body !== 'object' || (answer.body as any).error
        || !Object.prototype.hasOwnProperty.call(answer.body, 'primary_funding_id')
        || (funding !== null && typeof funding !== 'string')) {
        return Object.freeze({ state: 'unknown' as const, source: 'graph_account_read' as const,
            checkedAt, actionable: false, detail: detailOf('unknown', 'Meta no aportó evidencia interpretable de financiación') });
    }
    const attached = typeof funding === 'string' ? funding.trim() : '';
    if (attached) {
        return Object.freeze({
            state: 'attached' as const, source: 'graph_account_read' as const, checkedAt,
            actionable: false,
            // Attached is not solvent, and the sentence says so rather than
            // letting a green tick imply it.
            detail: detailOf('attached', 'hay un método de pago asociado a la cuenta. '
                + 'Eso no garantiza que tenga fondos ni que el cobro se apruebe'),
        });
    }

    return Object.freeze({
        state: 'absent' as const, source: 'graph_account_read' as const, checkedAt,
        actionable: true,
        // La franquicia de 1.000 entregas es una TARIFA, no un plazo de gracia.
        // `docs/whatsapp-meta-pricing-2026-10.md` prohíbe explícitamente decir
        // que se puede empezar sin tarjeta hasta agotarla: esa excepción no está
        // documentada y el 1-oct, sin método de pago, las entregas se detienen.
        detail: detailOf('absent', 'la cuenta respondió correctamente y no tiene método de pago. '
            + 'Agrégalo en la WABA antes del 30 de septiembre de 2026: el 1 de octubre, sin método de pago, '
            + 'Meta deja de entregar los mensajes de servicio'),
    });
}

/**
 * What an observed provider refusal says about funding.
 *
 * The send path already pauses an account on 131042; this turns the same
 * observation into the readiness an operator reads, so the two cannot say
 * different things about one number.
 */
export function readFundingFromRefusal(input: {
    readonly errorCode: number | string | null | undefined;
    readonly detail?: string;
}, at: Date): FundingReadiness | null {
    const code = Number(input.errorCode);
    if (!Number.isFinite(code) || !PAYMENT_ELIGIBILITY_CODES.includes(code)) return null;
    return Object.freeze({
        state: 'restricted' as const, source: 'provider_refusal' as const, checkedAt: at,
        actionable: true,
        detail: detailOf('restricted', `Meta rechazó un envío por elegibilidad de pago (${code})`
            + `${input.detail ? `: ${String(input.detail).slice(0, 200)}` : ''}`),
    });
}

/**
 * How long a stored Graph reading stays evidence. Older than this it is
 * `not_checked` — except an established absence, which never ages out (see
 * `readStoredFunding`).
 */
export const STORED_FUNDING_MAX_AGE_MS = 86_400_000;

/**
 * The reading `check-funding` stored on the account, when it is still evidence.
 *
 * One reader for every consumer — the funding-readiness endpoint and the
 * quality check — so they cannot disagree about which stored answer counts. It
 * counts only when it is about the WABA the number belongs to NOW (a reconnect
 * to another WABA makes it someone else's answer), is not dated in the future,
 * and names a state a Graph read can produce. Anything else is `null`: nothing
 * established, which the caller reads as `not_checked`, never as `absent`.
 *
 * AGE. `attached`, `unknown` and `restricted` are snapshots of something that
 * changes on its own — a card is removed, Meta answers next time, an
 * eligibility problem is resolved in Meta's own screens — so after a day they
 * stop counting. A `restricted` that still holds re-establishes itself: the
 * next real send is refused with 131042 and pauses the number, and a live
 * pause outranks every stored reading.
 *
 * `absent` does not age out. It is an explicit answer from Meta ("this account
 * has no payment method"), and before `FUNDING_REQUIRED_FROM` nothing at
 * runtime can re-establish it: Meta still delivers service messages without a
 * card, so no send is ever refused for it. Expiring it turned an owner's own
 * check into a 24-hour warning — the delivery check went back to pass with
 * nothing changed, days before the deadline. It stands until a NEWER reading
 * replaces it (the next `check-funding` writes over it) or the number moves to
 * another WABA.
 */
export function readStoredFunding(metadata: unknown, now: Date = new Date()): FundingReadiness | null {
    const meta = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, any>;
    const saved = meta.fundingReadiness;
    if (!saved || typeof saved !== 'object') return null;
    const checked = new Date(saved.checkedAt ?? '').getTime();
    const expired = saved.state !== 'absent' && now.getTime() - checked >= STORED_FUNDING_MAX_AGE_MS;
    if (!saved.wabaId || saved.wabaId !== meta.wabaId || !Number.isFinite(checked)
        || checked > now.getTime() || expired
        || !['attached', 'absent', 'unknown', 'restricted'].includes(saved.state)) return null;
    return {
        state: saved.state, source: 'graph_account_read', checkedAt: new Date(checked),
        actionable: ['absent', 'restricted'].includes(saved.state), detail: 'Stored Meta funding reading',
    };
}

/**
 * What a send pause says about funding: the pause is Meta refusing a real send,
 * so a 131042 behind it is `restricted`. Any other code returns `null` here —
 * the pause still stops every send (the admission refuses `account_paused`
 * whatever the code), it just is not evidence about the card.
 */
export function readFundingFromPause(pause: {
    readonly code: number | null; readonly detail: string; readonly lastSeen: string;
} | null | undefined): FundingReadiness | null {
    if (!pause) return null;
    return readFundingFromRefusal({ errorCode: pause.code, detail: pause.detail }, new Date(pause.lastSeen));
}

/** The state of a number nobody has asked about yet. */
export function neverAsked(): FundingReadiness {
    return Object.freeze({
        state: 'not_checked' as const, source: 'never_asked' as const, checkedAt: null,
        actionable: false,
        detail: detailOf('not_checked', 'todavía no comprobamos esta cuenta. '
            + 'No comprobado no es lo mismo que sin método de pago'),
    });
}

/**
 * Which of two readings wins.
 *
 * An observed refusal beats a configuration read whatever their timestamps say:
 * Meta refusing a real send is stronger evidence than a field on a resource,
 * and the refusal is the one a customer already felt.
 *
 * Otherwise the newer reading wins, and a reading that establishes nothing
 * (`unknown`) does NOT overwrite one that established something. Letting a
 * timeout erase yesterday's `absent` is how a warning disappears on its own.
 */
export function moreAuthoritative(left: FundingReadiness, right: FundingReadiness): FundingReadiness {
    const rank = (reading: FundingReadiness) =>
        reading.state === 'restricted' && reading.source === 'provider_refusal' ? 3
            : reading.state === 'restricted' ? 2
                : reading.state === 'unknown' || reading.state === 'not_checked' ? 0 : 1;
    const [leftRank, rightRank] = [rank(left), rank(right)];
    if (leftRank !== rightRank) return leftRank > rightRank ? left : right;
    const leftAt = left.checkedAt?.getTime() ?? -1;
    const rightAt = right.checkedAt?.getTime() ?? -1;
    return leftAt >= rightAt ? left : right;
}

/**
 * Is this number ready to keep delivering?
 *
 * Deliberately three answers rather than two. `unknown` is not `ready`, because
 * saying yes on no evidence is the failure this module exists to prevent; and
 * it is not `not_ready` either, because sending somebody to fix a problem
 * nobody established is how they learn to ignore the warning that matters.
 */
export function deliveryReadiness(reading: FundingReadiness): 'ready' | 'not_ready' | 'unestablished' {
    if (reading.state === 'attached') return 'ready';
    if (reading.state === 'absent' || reading.state === 'restricted') return 'not_ready';
    return 'unestablished';
}
