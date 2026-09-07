import {
    BASE_INTENT_ALIASES,
    ConfirmationEffect,
    IntentAlias,
    IntentClass,
    IntentConfidence,
    MIN_CONFIDENCE_BY_EFFECT,
    normalizeForIntent,
    packForCountry,
} from '@parallext/shared';
import { isOptOutMessage } from '../../modules/intake/intake-i18n';

/**
 * One classifier for what the customer just said.
 *
 * Four independent affirmation lists disagreed on fourteen tokens. The widest
 * lived in the intent interpreter and the narrowest in the central guard — the
 * one that actually gates booking, charging and cancelling. So `listo`, the
 * most common Colombian yes, made the booking engine call `createBooking(...,
 * 'text_confirmation')`, and the guard then re-checked the same word, returned
 * `unclear`, and escalated. The customer said yes and got a human.
 *
 * The fix is not to widen the guard's list. Widening it would let `listo`
 * authorise a payment, which is the opposite mistake and a far more expensive
 * one. Strength lives on the alias, and the EFFECT of what is pending decides
 * whether that strength is enough:
 *
 *   `listo` (medium) + pick a time slot (parameter)  → proceed
 *   `listo` (medium) + charge a card (high_impact)   → ask for explicit words
 *
 * Negation, qualification and correction always win over any affirmation in the
 * same message. `sí, pero…` and `dale si…` are `unclear`, never consent.
 */

export interface NormalizedIntent {
    intent: IntentClass;
    confidence: IntentConfidence;
    /** The alias that matched, kept for traces and audits. */
    matched?: string;
    /** The normalised text the decision was made on. */
    normalized: string;
    /** Pack that contributed the match, when a country overlay did. */
    packId?: string;
    /** True only when the whole utterance expresses acceptance, without a second task. */
    consentEligible?: boolean;
}

export interface NormalizeOptions {
    /** Operating country, for the pack overlay. */
    country?: string | null;
    /** Longest input treated as a possible confirmation. */
    maxLength?: number;
    /**
     * The turn is answering an explicit confirmation challenge with a visible
     * summary — not a free-form message.
     *
     * This is what separates an unsolicited "ok" from an "ok" that answers
     * "¿confirmo tu cita del martes a las 3?". The first acknowledges having
     * read something; the second is how most people say yes. Without the
     * distinction we either accept "ok" as consent to a payment, or we re-ask a
     * customer who already answered — both wrong, in opposite directions.
     */
    answeringExplicitQuestion?: boolean;
    /** Exact object names/identifiers from the authenticated pending proposal. */
    acceptedReferents?: readonly string[];
}

const DEFAULT_MAX_LENGTH = 120;

/**
 * Words that invalidate an affirmation appearing anywhere in the message.
 *
 * Checked across the whole text, not just at the start: "sí, pero primero
 * quiero saber el precio" opens with an affirmation and is not one.
 */
const QUALIFIER_ANYWHERE = /\b(pero|mas que|porem|but|mais|aunque|salvo|excepto|solo si|unicamente si|only if|si es que|se for|siempre que)\b/;

const NEGATION_ANYWHERE = /\b(no|nao|non|not|nunca|never|jamais|rechazo|espera|aun|ainda|todavia)\b/;

/** Cancellation is separated from plain negation: they resolve differently. */
const CANCEL_ANYWHERE = /\b(cancela|cancelar|cancelalo|cancel|annuler|arretez|olvidalo|olvidate|dejemoslo|deja de|deixa pra la|ya no quiero|no quiero continuar|nao quero continuar|i don't want to continue|i do not want to continue|je ne veux plus continuer|mejor nada|nada de eso)\b/;
const NEGATED_CANCELLATION = /\b(?:no (?:quiero |deseo |puedo |vayas a )?(?:cancelar|cancela|canceles)|nao (?:quero |desejo |posso )?cancelar|(?:don't|do not|not) (?:want to )?cancel|ne (?:veux |souhaite )?pas annuler)\b/;

const CORRECTION_ANYWHERE = /\b(quise decir|quería decir|me equivoque|corrijo|corrigiendo|mas bien|en realidad|na verdade|quis dizer|corrigindo|actually|i meant|je voulais dire)\b/;

const COURTESY = /^(?:muchas gracias|gracias|thank you|thanks|obrigado|obrigada|merci|por favor|please|s il vous plait|s'il vous plait)(?:\s+|$)/;
const INFORMATION_REQUEST = /\b(?:quiero saber|necesito saber|quisiera saber|saber primero|me explicas|explicame|me puedes explicar|quero saber|gostaria de saber|i want to know|i need to know|tell me|explain|je voudrais savoir|je veux savoir|expliquez)\b/;

/** Questions and qualifications are dialogue, never authorization evidence. */
export function isInformationSeekingMessage(raw: unknown): boolean {
    const text = normalizeForIntent(raw).replace(/^[¿¡\s]+/, '');
    const withoutCourtesy = text.replace(COURTESY, '').replace(/^(?:pero|but|mais|porem)\s+/, '');
    return /[?¿]/.test(String(raw ?? ''))
        || /^(?:que|como|cuando|donde|cuanto|cual|por que|para que|what|why|how|when|where|which|quanto|qual|por que|comment|pourquoi|quand|combien|quel|quelle)\b/.test(withoutCourtesy)
        || INFORMATION_REQUEST.test(text);
}

export function isPauseMessage(raw: unknown): boolean {
    const text = normalizeForIntent(raw);
    return /\b(?:prefiero hacerlo despues|lo hago despues|continuamos despues|mas tarde|en otro momento|por ahora no|espera|esperar|pause|wait|do this later|continue later|not now|mais tarde|prefiro depois|depois eu|agora nao|plus tard|pas maintenant|attendez)\b/.test(text);
}

export function isResumeMessage(raw: unknown): boolean {
    return /^(?:continuemos|continuar|continua|sigamos|retomemos|reanudar|resume|continue|let s continue|let's continue|vamos continuar|continuons|reprendre|reprenons)[.!\s]*$/.test(normalizeForIntent(String(raw || '')));
}

/**
 * Consume the entire acceptance, not just its first word. Courtesy may surround
 * acceptance, but gratitude by itself and a new date/price/task are not consent
 * to the currently displayed proposal. Explicit referents are allowed; new
 * terms require a new proposal and challenge from the domain workflow.
 */
function isWholeConsentExpression(text: string, aliases: IntentAlias[], acceptedReferents: readonly string[] = []): boolean {
    const choices = aliases.filter(a => a.intent === 'affirm' || a.intent === 'acknowledge')
        .filter(a => !COURTESY.test(a.value)).sort((a, b) => b.value.length - a.value.length);
    let rest = text;
    let accepted = false;
    const references = acceptedReferents.map(value => normalizeForIntent(value)).filter(Boolean).sort((a, b) => b.length - a.length);
    for (let guard = 0; rest && guard < 12; guard++) {
        const courtesy = COURTESY.exec(rest);
        if (courtesy) { rest = rest.slice(courtesy[0].length).trim(); continue; }
        const alias = choices.find(a => rest === a.value || rest.startsWith(`${a.value} `));
        if (alias) {
            accepted = true;
            rest = rest.slice(alias.value.length).trim();
            continue;
        }
        const referent = /^(?:(?:la|el|mi|esta|este|esa|ese|a|o|minha|meu|the|my|this|that|le|mon|ma|cette|ce)\s+)?(?:cita|reserva|operacion|pago|compra|pedido|appointment|booking|reservation|operation|payment|order|rendez-vous|paiement|commande|agendamento|pagamento|compra)(?:\s+|$)/.exec(rest);
        if (accepted && referent) { rest = rest.slice(referent[0].length).trim(); continue; }
        if (accepted) {
            const referenceText = rest.replace(/^(?:de la|de|del|para|for|of|du|do|da)\s+/, '');
            const reference = references.find(value => referenceText === value || referenceText.startsWith(`${value} `));
            if (reference) { rest = referenceText.slice(reference.length).trim(); continue; }
        }
        return false;
    }
    return accepted && !rest;
}

const CONFIDENCE_RANK: Record<IntentConfidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * Verbs that state consent outright, wherever they sit in the sentence.
 *
 * "dale, confirmo" and "ok confirmo" open with a contextual token and then say
 * the explicit thing. Reading only the opening would grade them `medium` and
 * re-ask a customer who could not have been clearer. The upgrade is applied
 * only AFTER negation, qualification and correction have been ruled out, so
 * "no confirmo" and "sí, pero…" can never reach it.
 */
const EXPLICIT_CONSENT_VERB = /\b(confirmo|confirmar|confirmado|autorizo|acepto|procede|proceda|hazlo|i confirm|confirm|go ahead|confirmo sim|concordo|aceito|pode confirmar|pode fazer|je confirme|allez-y)\b/;

function aliasesFor(country?: string | null): IntentAlias[] {
    const pack = packForCountry(country);
    // The country overlay goes FIRST so a national reading beats the regional
    // default for the same token — `ya` is a weak affirmation in Chile and a
    // plain adverb elsewhere.
    return pack ? [...pack.aliases, ...BASE_INTENT_ALIASES] : [...BASE_INTENT_ALIASES];
}

function matchAlias(text: string, aliases: IntentAlias[]): IntentAlias | null {
    let best: IntentAlias | null = null;
    let bestLength = 0;

    for (const alias of aliases) {
        const value = alias.value;
        const isExact = text === value;
        const isOpening = text.startsWith(`${value} `);
        if (!isExact && !isOpening) continue;
        // Longest match wins: `no gracias` must not be read as `no`, and
        // `siempre no` must not be read as `si`.
        if (value.length > bestLength) {
            best = alias;
            bestLength = value.length;
        }
    }
    return best;
}

/**
 * Classify a customer message into a single intent with a confidence.
 *
 * Order matters and is deliberate: opt-out and cancellation outrank everything
 * because getting those wrong is a compliance problem and a trust problem
 * respectively; correction outranks affirmation because a customer fixing a
 * detail is not confirming the old one.
 */
export function normalizeCustomerIntent(
    raw: unknown,
    options: NormalizeOptions = {},
): NormalizedIntent {
    const rawLower = String(raw ?? '').trim().toLowerCase();
    const normalized = normalizeForIntent(raw).replace(/^¡+/, '').trim();
    const base: NormalizedIntent = { intent: 'unclear', confidence: 'low', normalized };
    if (!normalized) return base;

    // Opt-out is legally load-bearing and already has a reviewed, four-language
    // implementation. Reusing it keeps one answer to "did they say stop".
    if (isOptOutMessage(String(raw ?? ''))) {
        return { ...base, intent: 'opt_out', confidence: 'high' };
    }

    const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
    const aliases = aliasesFor(options.country);
    const pack = packForCountry(options.country);

    // A human explicitly asking for a person must be heard in a long message
    // too — it usually arrives inside a complaint, not as a single word.
    const humanAlias = aliases.find(a => a.intent === 'request_human'
        && new RegExp(`\\b${a.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(normalized));
    if (humanAlias && /\b(hablar|habla|comunicar|pasame|pasar|quiero|necesito|talk|speak|falar|parler)\b/.test(normalized)) {
        return {
            ...base, intent: 'request_human', confidence: humanAlias.confidence,
            matched: humanAlias.value, packId: pack?.id,
        };
    }

    if (isInformationSeekingMessage(raw)) return base;
    if (NEGATED_CANCELLATION.test(normalized) && !/\bno\s*,\s*cancela/i.test(rawLower)) return base;

    if (CANCEL_ANYWHERE.test(normalized)) {
        return { ...base, intent: 'cancel', confidence: 'high' };
    }
    if (CORRECTION_ANYWHERE.test(normalized)) {
        return { ...base, intent: 'correct', confidence: 'high' };
    }

    // Beyond this point we are deciding whether something is a confirmation, and
    // a long message is a conversation, not a yes.
    if (normalized.length > maxLength) return base;

    const alias = matchAlias(normalized, aliases);
    if (!alias) {
        return base;
    }

    const packId = pack?.aliases.includes(alias) ? pack.id : undefined;
    const matched = { ...base, matched: alias.value, packId };

    if (alias.intent === 'affirm' || alias.intent === 'acknowledge') {
        // A qualifier or a negation elsewhere in the message downgrades any
        // affirmation to unclear. `dale si me confirmás el precio` is a
        // condition, and treating it as consent is how money moves by accident.
        if (QUALIFIER_ANYWHERE.test(normalized)) {
            return { ...matched, intent: 'unclear', confidence: 'low' };
        }
        const withoutAlias = normalized.slice(alias.value.length).trim();
        // Accent stripping makes Spanish `sí` (yes) and `si` (if) identical.
        // An isolated `si` is still a normal affirmative response, but an
        // unaccented `si` followed by a clause ("si tienen disponibilidad")
        // is conditional/question language unless it also contains an explicit
        // consent verb. Treating that query as consent can commit the pending
        // operation and, less severely, suppress the knowledge lookup it asked.
        const unaccentedSiClause = alias.value === 'si'
            && !!withoutAlias
            && /^si(?:\s|[,;])/i.test(rawLower)
            && !/^sí(?:\s|[,;])/i.test(rawLower);
        if (unaccentedSiClause && !EXPLICIT_CONSENT_VERB.test(normalized)) {
            return { ...matched, intent: 'unclear', confidence: 'low' };
        }
        if (withoutAlias && NEGATION_ANYWHERE.test(withoutAlias)) {
            return { ...matched, intent: 'unclear', confidence: 'low' };
        }
        // A bare `si` opening a message is "yes"; a `si` AFTER the affirmation
        // is "if". `dale si me confirmás el precio` is a condition, and reading
        // it as consent is exactly how money moves by accident.
        if (withoutAlias && /^si\b/.test(withoutAlias)) {
            return { ...matched, intent: 'unclear', confidence: 'low' };
        }
        const consentEligible = isWholeConsentExpression(normalized, aliases, options.acceptedReferents);
        if (!consentEligible) {
            // Preserve a bare thanks as acknowledgement for dialogue, while
            // recording that it cannot answer an operational challenge.
            return normalized === alias.value && alias.intent === 'acknowledge'
                ? { ...matched, intent: 'acknowledge', confidence: alias.confidence, consentEligible: false }
                : { ...matched, intent: 'unclear', confidence: 'low', consentEligible: false };
        }
        // The customer said the explicit thing after a contextual opener.
        if (EXPLICIT_CONSENT_VERB.test(normalized)) {
            return { ...matched, intent: 'affirm', confidence: 'high', consentEligible };
        }
        return { ...matched, intent: alias.intent, confidence: alias.confidence, consentEligible };
    }

    return { ...matched, intent: alias.intent, confidence: alias.confidence };
}

/**
 * Whether this message authorises an action of the given effect.
 *
 * An acknowledgement never authorises anything, whatever its confidence: `ok`
 * and `perfecto` are high-confidence recognitions of having understood, and
 * reading them as consent is the single most expensive misclassification here.
 */
export function authorizesEffect(
    intent: NormalizedIntent,
    effect: ConfirmationEffect,
    options: { answeringExplicitQuestion?: boolean } = {},
): boolean {
    if (intent.consentEligible !== true) return false;
    const required = MIN_CONFIDENCE_BY_EFFECT[effect];

    if (intent.intent === 'acknowledge') {
        // An acknowledgement can only ever be consent when it ANSWERS an
        // explicit challenge, and even then it counts as a contextual yes, not
        // an explicit one — so it can advance a booking and never authorise a
        // charge. An unsolicited "perfecto" mid-conversation authorises nothing.
        if (!options.answeringExplicitQuestion) return false;
        return CONFIDENCE_RANK.medium >= CONFIDENCE_RANK[required];
    }
    if (intent.intent !== 'affirm') return false;
    return CONFIDENCE_RANK[intent.confidence] >= CONFIDENCE_RANK[required];
}

/**
 * Legacy three-way shape used by the central execution guard.
 *
 * `confirmed` only when the message authorises a HIGH-IMPACT action, because
 * that guard sits in front of writers that move money and cancel paid objects.
 * Lower-impact flows call `normalizeCustomerIntent` directly with their own
 * effect, which is how `listo` can advance a booking step without ever being
 * able to authorise a charge.
 */
export function classifyConfirmation(
    raw: unknown,
    options: NormalizeOptions & { effect?: ConfirmationEffect } = {},
): 'confirmed' | 'rejected' | 'unclear' {
    const intent = normalizeCustomerIntent(raw, options);
    if (intent.intent === 'reject' || intent.intent === 'cancel') return 'rejected';
    if (authorizesEffect(intent, options.effect ?? 'high_impact', options)) return 'confirmed';
    return 'unclear';
}

/**
 * How strong a yes an action needs, derived from its policy.
 *
 * Regulated, sensitive or human-approved writes are `high_impact`: only an
 * unambiguous affirmation runs them. Everything else that writes is
 * `transactional`, where a contextual yes — `dale`, `listo`, or an `ok` that
 * answers the challenge — is the normal way people confirm an appointment.
 */
export function confirmationEffectForPolicy(policy: {
    effect?: string;
    assurance?: string;
    dataClassification?: string;
    humanApproval?: string;
} | null | undefined): ConfirmationEffect {
    if (!policy) return 'high_impact';
    if (policy.assurance === 'A3' || policy.assurance === 'A4') return 'high_impact';
    if (policy.humanApproval === 'runtime_enforced') return 'high_impact';
    if (policy.effect === 'write' && policy.dataClassification === 'sensitive') return 'high_impact';
    return 'transactional';
}
