/**
 * Country language behaviour packs.
 *
 * Two capabilities that must never be confused:
 *
 * - **Recognition** — understanding local expressions, address forms,
 *   corrections, refusals, requests for a human and safety signals.
 * - **Generation** — replying clearly in the register the tenant or the customer
 *   chose, without caricaturing the country or imitating slang by default.
 *
 * A local expression can be perfectly valid language and still not be
 * transactional consent. `hágale`, `órale`, `ya po`, `dale`, `listo`, `pura
 * vida`, `ta bien`, `pode ser` and `beleza` variously mean acceptance,
 * comprehension, surprise, positive evaluation, closure or mere continuation.
 * For payments, cancellations, penalised bookings, accepting terms and
 * sensitive changes, an isolated word must never authorise the action.
 *
 * This registry is deliberately NOT a list of phrases for the prompt. It feeds a
 * deterministic normaliser that produces intent + confidence + evidence; the
 * prompt only receives the pack's identity and the terms it may generate.
 */

export type IntentClass =
    /** Explicit, unambiguous authorisation. */
    | 'affirm'
    /** "I understood", not "I consent". */
    | 'acknowledge'
    | 'reject'
    /** Cancel the workflow, or cancel an existing object — different things. */
    | 'cancel'
    | 'correct'
    | 'request_human'
    | 'opt_out'
    | 'continue'
    | 'unclear';

export type IntentConfidence = 'high' | 'medium' | 'low';

export interface IntentAlias {
    /** Normalised form: lowercase, accent-stripped. */
    value: string;
    intent: IntentClass;
    confidence: IntentConfidence;
    /** Why this alias is not stronger, for reviewers. */
    notes?: string;
}

/**
 * Effect classes a pending action can have. The effect — not the phrasing —
 * decides how strong an affirmation has to be.
 */
export type ConfirmationEffect =
    /** Irreversible or costly: money, contracts, consent, penalised cancels. */
    | 'high_impact'
    /** Creates or changes a real operational object. */
    | 'transactional'
    /** Low-risk parameter: a date, a party size, a preference. */
    | 'parameter';

export interface CountryLanguagePack {
    id: string;
    version: string;
    country: string;
    status: 'draft' | 'fallback_only' | 'pilot' | 'certified';
    primaryLocale: string;
    fallbackPack: string;
    /** Recognition aliases layered on top of the pan-regional base. */
    aliases: IntentAlias[];
    /** Terms the agent may generate, by domain. Internal ids never change. */
    preferredTerms?: Record<string, string>;
    /** Registers that must never be produced for this country. */
    prohibitedRegisters?: string[];
}

/** Normalise for matching: lowercase, strip accents, collapse whitespace. */
export function normalizeForIntent(text: unknown): string {
    return String(text ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[.!¡¿?]+$/g, '')
        .replace(/[,;]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Pan-regional base, valid wherever no country pack applies.
 *
 * `high` is reserved for expressions that cannot mean anything but consent.
 * Everything that also works as "I heard you" is `medium` at best — which is
 * the whole point: the strength lives on the alias, and the effect of the
 * pending action decides whether that strength is enough.
 */
export const BASE_INTENT_ALIASES: readonly IntentAlias[] = Object.freeze([
    // ---- explicit affirmation ------------------------------------------
    { value: 'si', intent: 'affirm', confidence: 'high' },
    { value: 'si confirmo', intent: 'affirm', confidence: 'high' },
    { value: 'confirmo', intent: 'affirm', confidence: 'high' },
    { value: 'confirmar', intent: 'affirm', confidence: 'high' },
    { value: 'confirmado', intent: 'affirm', confidence: 'high' },
    { value: 'acepto', intent: 'affirm', confidence: 'high' },
    { value: 'autorizo', intent: 'affirm', confidence: 'high' },
    { value: 'si autorizo', intent: 'affirm', confidence: 'high' },
    { value: 'de acuerdo', intent: 'affirm', confidence: 'high' },
    { value: 'correcto', intent: 'affirm', confidence: 'high' },
    { value: 'procede', intent: 'affirm', confidence: 'high' },
    { value: 'adelante', intent: 'affirm', confidence: 'high' },
    { value: 'hazlo', intent: 'affirm', confidence: 'high' },
    { value: 'yes', intent: 'affirm', confidence: 'high' },
    { value: 'i confirm', intent: 'affirm', confidence: 'high' },
    { value: 'confirm', intent: 'affirm', confidence: 'high' },
    { value: 'go ahead', intent: 'affirm', confidence: 'high' },
    { value: 'sim', intent: 'affirm', confidence: 'high' },
    { value: 'confirmo sim', intent: 'affirm', confidence: 'high' },
    { value: 'concordo', intent: 'affirm', confidence: 'high' },
    { value: 'aceito', intent: 'affirm', confidence: 'high' },
    { value: 'pode confirmar', intent: 'affirm', confidence: 'high' },
    { value: 'oui', intent: 'affirm', confidence: 'high' },
    { value: 'je confirme', intent: 'affirm', confidence: 'high' },
    { value: 'allez-y', intent: 'affirm', confidence: 'high' },

    // ---- contextual affirmation: continues, does not authorise ----------
    {
        value: 'dale', intent: 'affirm', confidence: 'medium',
        notes: 'Continua o acepta segun contexto; no autoriza dinero por si sola.',
    },
    {
        value: 'listo', intent: 'affirm', confidence: 'medium',
        notes: 'El "sí" mas comun de Colombia y tambien un simple "ya esta".',
    },
    { value: 'va', intent: 'affirm', confidence: 'medium', notes: 'Tambien es el verbo ir.' },
    { value: 'vamos', intent: 'affirm', confidence: 'medium' },
    { value: 'bueno', intent: 'affirm', confidence: 'medium' },
    { value: 'por supuesto', intent: 'affirm', confidence: 'medium' },
    { value: 'exacto', intent: 'affirm', confidence: 'medium' },
    { value: 'eso', intent: 'affirm', confidence: 'low' },
    { value: 'sure', intent: 'affirm', confidence: 'medium' },
    {
        value: 'de una', intent: 'affirm', confidence: 'medium',
        notes: 'Pan-regional; expresa inmediatez antes que consentimiento.',
    },
    { value: 'pode ser', intent: 'affirm', confidence: 'low', notes: 'Provisional: "podria ser".' },
    { value: 'pode fazer', intent: 'affirm', confidence: 'high' },
    { value: 'combinado', intent: 'affirm', confidence: 'medium' },
    { value: 'fechado', intent: 'affirm', confidence: 'medium' },
    { value: 'ta bom', intent: 'affirm', confidence: 'medium' },
    { value: 'tudo certo', intent: 'affirm', confidence: 'low', notes: 'Tambien describe un estado.' },

    // ---- acknowledgement: comprehension, never consent ------------------
    { value: 'ok', intent: 'acknowledge', confidence: 'high' },
    { value: 'oka', intent: 'acknowledge', confidence: 'high' },
    { value: 'okay', intent: 'acknowledge', confidence: 'high' },
    { value: 'perfecto', intent: 'acknowledge', confidence: 'high' },
    { value: 'claro', intent: 'acknowledge', confidence: 'high' },
    { value: 'genial', intent: 'acknowledge', confidence: 'high' },
    { value: 'excelente', intent: 'acknowledge', confidence: 'high' },
    { value: 'beleza', intent: 'acknowledge', confidence: 'high', notes: 'Tambien saludo.' },
    { value: 'entendido', intent: 'acknowledge', confidence: 'high' },
    { value: 'gracias', intent: 'acknowledge', confidence: 'high' },
    { value: 'obrigado', intent: 'acknowledge', confidence: 'high' },
    { value: 'obrigada', intent: 'acknowledge', confidence: 'high' },
    { value: 'merci', intent: 'acknowledge', confidence: 'high' },
    { value: 'thanks', intent: 'acknowledge', confidence: 'high' },
    { value: 'thank you', intent: 'acknowledge', confidence: 'high' },

    // ---- rejection ------------------------------------------------------
    { value: 'no', intent: 'reject', confidence: 'high' },
    { value: 'nop', intent: 'reject', confidence: 'high' },
    { value: 'no gracias', intent: 'reject', confidence: 'high' },
    { value: 'no confirmo', intent: 'reject', confidence: 'high' },
    { value: 'no acepto', intent: 'reject', confidence: 'high' },
    { value: 'mejor no', intent: 'reject', confidence: 'high' },
    { value: 'todavia no', intent: 'reject', confidence: 'high' },
    { value: 'aun no', intent: 'reject', confidence: 'high' },
    { value: 'nao', intent: 'reject', confidence: 'high' },
    { value: 'melhor nao', intent: 'reject', confidence: 'high' },
    { value: 'ainda nao', intent: 'reject', confidence: 'high' },
    { value: 'non', intent: 'reject', confidence: 'high' },
    { value: 'je refuse', intent: 'reject', confidence: 'high' },
    { value: 'pas maintenant', intent: 'reject', confidence: 'high' },
    { value: 'not now', intent: 'reject', confidence: 'high' },
    { value: 'no thanks', intent: 'reject', confidence: 'high' },

    // ---- cancellation ---------------------------------------------------
    { value: 'cancela', intent: 'cancel', confidence: 'high' },
    { value: 'cancelar', intent: 'cancel', confidence: 'high' },
    { value: 'cancelalo', intent: 'cancel', confidence: 'high' },
    { value: 'dejemoslo', intent: 'cancel', confidence: 'high' },
    { value: 'olvidalo', intent: 'cancel', confidence: 'high' },
    { value: 'ya no', intent: 'cancel', confidence: 'high' },
    { value: 'cancel', intent: 'cancel', confidence: 'high' },
    { value: 'never mind', intent: 'cancel', confidence: 'high' },
    { value: 'nevermind', intent: 'cancel', confidence: 'high' },
    { value: 'cancela isso', intent: 'cancel', confidence: 'high' },
    { value: 'deixa pra la', intent: 'cancel', confidence: 'high' },
    { value: 'annuler', intent: 'cancel', confidence: 'high' },

    // ---- correction -----------------------------------------------------
    { value: 'quise decir', intent: 'correct', confidence: 'high' },
    { value: 'me equivoque', intent: 'correct', confidence: 'high' },
    { value: 'corrijo', intent: 'correct', confidence: 'high' },
    { value: 'mas bien', intent: 'correct', confidence: 'high' },
    { value: 'en realidad', intent: 'correct', confidence: 'high' },
    { value: 'na verdade', intent: 'correct', confidence: 'high' },
    { value: 'quis dizer', intent: 'correct', confidence: 'high' },
    { value: 'corrigindo', intent: 'correct', confidence: 'high' },
    { value: 'actually', intent: 'correct', confidence: 'high' },
    { value: 'i meant', intent: 'correct', confidence: 'high' },

    // ---- human ----------------------------------------------------------
    { value: 'asesor', intent: 'request_human', confidence: 'high' },
    { value: 'agente', intent: 'request_human', confidence: 'medium', notes: 'Puede referirse al bot.' },
    { value: 'humano', intent: 'request_human', confidence: 'high' },
    { value: 'una persona', intent: 'request_human', confidence: 'high' },
    { value: 'persona real', intent: 'request_human', confidence: 'high' },
    { value: 'representante', intent: 'request_human', confidence: 'high' },
    { value: 'ejecutivo', intent: 'request_human', confidence: 'medium' },
    { value: 'supervisor', intent: 'request_human', confidence: 'high' },
    { value: 'operador', intent: 'request_human', confidence: 'high' },
    { value: 'atendente', intent: 'request_human', confidence: 'high' },
    { value: 'falar com uma pessoa', intent: 'request_human', confidence: 'high' },
    { value: 'pessoa de verdade', intent: 'request_human', confidence: 'high' },
    { value: 'human agent', intent: 'request_human', confidence: 'high' },
    { value: 'talk to a human', intent: 'request_human', confidence: 'high' },
    { value: 'real person', intent: 'request_human', confidence: 'high' },
    { value: 'parler a un humain', intent: 'request_human', confidence: 'high' },
    { value: 'conseiller', intent: 'request_human', confidence: 'high' },
]);

/**
 * Country overlays.
 *
 * Every entry is a CANDIDATE until validated with native speakers, a consented
 * corpus and per-subtype evals — which is why every pack ships `draft`. The
 * Diccionario de americanismos is descriptive: it documents that a form exists,
 * not how often it is used today, and certainly not that it constitutes
 * commercial consent.
 */
export const COUNTRY_LANGUAGE_PACKS: Readonly<Record<string, CountryLanguagePack>> = Object.freeze({
    CO: {
        id: 'es-CO', version: '1', country: 'CO', status: 'draft',
        primaryLocale: 'es-CO', fallbackPack: 'es-419',
        aliases: [
            { value: 'hagale', intent: 'affirm', confidence: 'medium', notes: 'Acepta o incita a actuar.' },
            { value: 'de una', intent: 'affirm', confidence: 'medium', notes: 'Expresa inmediatez antes que consentimiento.' },
            { value: 'listo pues', intent: 'affirm', confidence: 'medium' },
            { value: 'sumerce', intent: 'continue', confidence: 'low', notes: 'Tratamiento regional; no es intencion.' },
        ],
        preferredTerms: { rental: 'arriendo', deposit: 'separacion', delivery: 'domicilio', appointment: 'cita' },
        prohibitedRegisters: ['parce', 'bro'],
    },
    MX: {
        id: 'es-MX', version: '1', country: 'MX', status: 'draft',
        primaryLocale: 'es-MX', fallbackPack: 'es-419',
        aliases: [
            { value: 'sale', intent: 'affirm', confidence: 'medium', notes: 'Tambien "salida" o "precio".' },
            { value: 'orale', intent: 'acknowledge', confidence: 'low', notes: 'Exhortacion o sorpresa segun contexto.' },
            { value: 'andale', intent: 'affirm', confidence: 'medium' },
            { value: 'jalo', intent: 'affirm', confidence: 'medium' },
            // Contiene "siempre" y "no": reversion, jamas afirmacion.
            { value: 'siempre no', intent: 'reject', confidence: 'high', notes: 'Reversion; contiene "no".' },
        ],
        preferredTerms: { rental: 'renta', deposit: 'enganche', booking: 'reservacion', invoice: 'CFDI' },
    },
    AR: {
        id: 'es-AR', version: '1', country: 'AR', status: 'draft',
        primaryLocale: 'es-AR', fallbackPack: 'es-419',
        aliases: [
            { value: 'barbaro', intent: 'acknowledge', confidence: 'medium', notes: 'Evaluacion positiva; no autoriza.' },
            { value: 'de una', intent: 'affirm', confidence: 'medium' },
            { value: 'confirma', intent: 'affirm', confidence: 'high' },
        ],
        preferredTerms: { appointment: 'turno', deposit: 'sena', rental: 'alquiler' },
    },
    CL: {
        id: 'es-CL', version: '1', country: 'CL', status: 'draft',
        primaryLocale: 'es-CL', fallbackPack: 'es-419',
        aliases: [
            { value: 'ya', intent: 'affirm', confidence: 'low', notes: 'Acuerdo, tiempo o marcador discursivo.' },
            { value: 'ya po', intent: 'affirm', confidence: 'medium' },
            { value: 'si po', intent: 'affirm', confidence: 'high' },
            { value: 'al tiro', intent: 'continue', confidence: 'low', notes: 'Inmediatez, no consentimiento.' },
        ],
        preferredTerms: { appointment: 'hora', rental: 'arriendo', deposit: 'pie', invoice: 'boleta' },
    },
    PE: {
        id: 'es-PE', version: '1', country: 'PE', status: 'draft',
        primaryLocale: 'es-PE', fallbackPack: 'es-419',
        aliases: [
            { value: 'ya', intent: 'affirm', confidence: 'low' },
            { value: 'ya pues', intent: 'affirm', confidence: 'medium' },
        ],
        preferredTerms: { pickup: 'recojo', deposit: 'separacion', invoice: 'boleta' },
    },
    BR: {
        id: 'pt-BR', version: '1', country: 'BR', status: 'draft',
        primaryLocale: 'pt-BR', fallbackPack: 'pt-BR',
        aliases: [
            { value: 'bora', intent: 'affirm', confidence: 'medium' },
            { value: 'blz', intent: 'acknowledge', confidence: 'high' },
            { value: 'vc', intent: 'continue', confidence: 'low' },
            { value: 'nao me mande mensagens', intent: 'opt_out', confidence: 'high' },
        ],
        preferredTerms: { appointment: 'agendamento', booking: 'reserva', deposit: 'sinal', invoice: 'nota fiscal' },
    },
    UY: {
        id: 'es-UY', version: '1', country: 'UY', status: 'draft',
        primaryLocale: 'es-UY', fallbackPack: 'es-419',
        aliases: [
            { value: 'ta', intent: 'acknowledge', confidence: 'low', notes: 'Acuerdo, comprension, cierre o estado.' },
            { value: 'barbaro', intent: 'acknowledge', confidence: 'medium' },
            { value: 'de una', intent: 'affirm', confidence: 'medium' },
        ],
        preferredTerms: { appointment: 'turno', deposit: 'sena' },
    },
    PY: {
        id: 'es-PY', version: '1', country: 'PY', status: 'draft',
        primaryLocale: 'es-PY', fallbackPack: 'es-419',
        aliases: [{ value: 'de una', intent: 'affirm', confidence: 'medium' }],
        preferredTerms: { appointment: 'turno', deposit: 'sena' },
    },
    BO: {
        id: 'es-BO', version: '1', country: 'BO', status: 'draft',
        primaryLocale: 'es-BO', fallbackPack: 'es-419',
        aliases: [
            { value: 'ya', intent: 'affirm', confidence: 'low' },
            { value: 'ya no mas', intent: 'continue', confidence: 'low', notes: 'Inmediatez, no aceptacion.' },
        ],
        preferredTerms: { pickup: 'recojo', deposit: 'anticipo' },
    },
    EC: {
        id: 'es-EC', version: '1', country: 'EC', status: 'draft',
        primaryLocale: 'es-EC', fallbackPack: 'es-419',
        aliases: [
            { value: 'ya', intent: 'affirm', confidence: 'low' },
            { value: 'de una', intent: 'affirm', confidence: 'medium' },
        ],
        preferredTerms: { rental: 'arriendo', deposit: 'entrada' },
    },
    VE: {
        id: 'es-VE', version: '1', country: 'VE', status: 'draft',
        primaryLocale: 'es-VE', fallbackPack: 'es-419',
        aliases: [
            { value: 'fino', intent: 'acknowledge', confidence: 'medium', notes: 'Evaluacion positiva.' },
            { value: 'de una', intent: 'affirm', confidence: 'medium' },
        ],
        preferredTerms: { deposit: 'inicial' },
    },
    CR: {
        id: 'es-CR', version: '1', country: 'CR', status: 'draft',
        primaryLocale: 'es-CR', fallbackPack: 'es-419',
        aliases: [
            { value: 'hagale', intent: 'affirm', confidence: 'medium' },
            { value: 'dele', intent: 'affirm', confidence: 'medium' },
            { value: 'pura vida', intent: 'acknowledge', confidence: 'low', notes: 'Saludo, agradecimiento, evaluacion o cierre.' },
        ],
        preferredTerms: { deposit: 'prima' },
    },
    PA: {
        id: 'es-PA', version: '1', country: 'PA', status: 'draft',
        primaryLocale: 'es-PA', fallbackPack: 'es-419',
        aliases: [{ value: 'dale', intent: 'affirm', confidence: 'medium' }],
        preferredTerms: { deposit: 'abono' },
    },
    DO: {
        id: 'es-DO', version: '1', country: 'DO', status: 'draft',
        primaryLocale: 'es-DO', fallbackPack: 'es-419',
        aliases: [
            { value: 'ta bien', intent: 'affirm', confidence: 'medium' },
            { value: 'ya', intent: 'affirm', confidence: 'low' },
        ],
        preferredTerms: { deposit: 'inicial', pickup: 'recogida' },
    },
    GT: {
        id: 'es-GT', version: '1', country: 'GT', status: 'draft',
        primaryLocale: 'es-GT', fallbackPack: 'es-419',
        aliases: [
            { value: 'cabal', intent: 'affirm', confidence: 'low', notes: 'Confianza baja hasta validar con corpus.' },
            { value: 'va', intent: 'affirm', confidence: 'medium' },
        ],
        preferredTerms: { deposit: 'enganche' },
    },
    US: {
        id: 'en-US', version: '1', country: 'US', status: 'fallback_only',
        primaryLocale: 'en-US', fallbackPack: 'en',
        aliases: [],
    },
    CA: {
        id: 'en-CA', version: '1', country: 'CA', status: 'fallback_only',
        primaryLocale: 'en-CA', fallbackPack: 'en',
        aliases: [],
    },
});

/**
 * Minimum confidence an affirmation needs, by the effect of what is pending.
 *
 * This is the rule the whole design exists for. `listo` is the most common
 * Colombian yes AND a plain "that's done" — good enough to advance a date,
 * never good enough to charge a card.
 */
export const MIN_CONFIDENCE_BY_EFFECT: Readonly<Record<ConfirmationEffect, IntentConfidence>> = {
    high_impact: 'high',
    transactional: 'medium',
    parameter: 'medium',
};

export function packForCountry(country?: string | null): CountryLanguagePack | null {
    const code = String(country || '').trim().toUpperCase();
    return COUNTRY_LANGUAGE_PACKS[code] || null;
}
