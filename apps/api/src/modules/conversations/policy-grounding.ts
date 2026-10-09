import { normalizeForIntent } from '@parallext/shared';
import { isInformationSeekingMessage } from '../../common/conversation/intent-normalizer';
import { humanOfferQuestionText } from './human-offer';

/**
 * A question about the COST or the TERMS of cancelling or moving something («¿se puede cancelar sin costo?», «¿cuál es la política de
 * cancelación?», «¿cobran por reprogramar?») is answered ONLY from what the business wrote: a published policy, an FAQ, a knowledge
 * article, or the owner's own persona instructions. With none of those in the turn, the model's «por lo general… sin costo» is an
 * invented policy, and a customer who cancels because of it has been misled about money.
 *
 * This is the deterministic half of that rule (the prompt already asks the model not to invent policies): when the customer asked such
 * a question, the turn holds no source for it, and the reply states terms anyway, the reply is replaced by the honest one — «no tengo
 * esa información» — with the offer of a person from the team (the same offer the rest of the platform uses, so a «sí» opens a real
 * handoff).
 */

const TOPIC = /\b(?:cancel\w*|anul\w*|reprogram\w*|reagend\w*|reschedul\w*|remarc\w*|annul\w*|no show|inasistencia|inasistir|faltar|cambiar (?:la |mi )?(?:cita|hora|fecha))\b/;
const COST_OR_POLICY = /\b(?:sin costo|sin cargo|sin penalizacion|sin multa|gratis|gratuit\w*|costo|costos|cuesta|cobr\w*|cargo|cargos|penaliz\w*|multa|politica|politicas|condicion\w*|plazo|antelacion|anticipacion|horas antes|dias antes|penalty|policy|policies|fee|fees|charge|charged|cost|free|frais|politique|taxa|custo)\b/;

/** Is this message asking what cancelling / moving costs or what the terms are (and not asking to do it)? */
export function isCancellationPolicyQuestion(raw: unknown): boolean {
    const text = String(raw ?? '');
    if (!text.trim() || text.length > 300) return false;
    const folded = normalizeForIntent(text);
    if (!TOPIC.test(folded) || !COST_OR_POLICY.test(folded)) return false;
    return /[?¿]/.test(text) || isInformationSeekingMessage(text);
}

/** Words that STATE terms: a cost, a notice period, a «usually», a policy that «allows». */
const STATES_TERMS = /\b(?:sin costo|sin cargo|sin penalizacion|sin multa|sin recargo|gratis|gratuit\w*|aviso previo|previo aviso|politicas? (?:permiten|permite|establece|establecen|indican|indica|son|es)|por lo general|generalmente|normalmente|usualmente|habitualmente|suele|suelen|\d+ horas|horas de (?:antelacion|anticipacion)|se cobra|cobramos|cargo adicional|penalizacion|without (?:any )?(?:charge|cost|fee|penalty)|free of charge|at no cost|typically|usually|generally|policy allows|policies allow|sans frais|gratuitement|geralmente|normalmente|sem custo|sem cobranca)\b/;

/** The reply already says it does not know: nothing to correct. */
const ADMITS_NOT_KNOWING = /\b(?:no (?:tengo|cuento con|dispongo de|manejo|conozco|tenemos)(?: [a-z]+){0,3} (?:informacion|dato|datos|politica|politicas|detalle|detalles)|no (?:esta|figura|aparece|hay)(?: [a-z]+){0,3} (?:configurad\w*|especificad\w*|definid\w*|publicad\w*|informacion)|no puedo (?:confirmar|asegurar|garantizar)|i (?:do not|don'?t|dont) have|i (?:can not|cannot|can'?t) confirm|no information|n[ai]?o tenho|nao posso confirmar|je n'?ai pas|je ne peux pas confirmer)\b/;

export function replyStatesTerms(reply: unknown): boolean {
    const folded = normalizeForIntent(String(reply ?? ''));
    return !!folded && STATES_TERMS.test(folded);
}

export function replyAdmitsNotKnowing(reply: unknown): boolean {
    const folded = normalizeForIntent(String(reply ?? ''));
    return !!folded && ADMITS_NOT_KNOWING.test(folded);
}

const POLICY_WORDS = /(?:cancel|anul|reprogram|reagend|reembols|refund|devoluc|no show|politic|policy|penaliz|annul|remboursement)/;

/** The tools whose result is a business-written source for a policy (a published policy, FAQs, knowledge, a package's own terms). */
const SOURCE_TOOLS = new Set(['get_policy', 'search_faqs', 'search_knowledge_base', 'get_package_details', 'get_tour_details']);

export interface PolicyEvidenceInput {
    retrievedKnowledge?: ReadonlyArray<{ title?: unknown; content?: unknown }> | null;
    executedTools?: ReadonlyArray<{ name?: string; result?: any }> | null;
    /** The system prompt: only the owner's `<persona>` block counts (the contract talks about policies in general). */
    systemPrompt?: string | null;
}

/** A data field (not prose) that holds the terms of a record: `"cancellationFee":25000`, `"refund_policy":"…"`, `"penalty":…`. */
const TERMS_FIELD = /"(?:cancellation_?(?:policy|fee|terms|charge)|refund_?(?:policy|terms)|late_?cancel\w*|no_?show_?(?:fee|policy)|penalty|penalties)"\s*:\s*(?!null|""|"none"|0\b|false)/i;

const hasPolicyWords = (value: unknown) => POLICY_WORDS.test(normalizeForIntent(typeof value === 'string' ? value : JSON.stringify(value ?? '')).slice(0, 20_000));

/** Does the turn hold a source the business wrote for cancellation / rescheduling terms? */
export function hasPolicyEvidence(input: PolicyEvidenceInput): boolean {
    for (const item of input.retrievedKnowledge ?? []) {
        if (hasPolicyWords(`${item?.title ?? ''} ${item?.content ?? ''}`)) return true;
    }
    for (const tool of input.executedTools ?? []) {
        const result = tool?.result;
        // Any read of the business's own data that carries its terms for this record (a fee, a cancellation policy field): also a source.
        if (result && typeof result === 'object' && !result.error && TERMS_FIELD.test(JSON.stringify(result).slice(0, 20_000))) return true;
        if (!tool?.name || !SOURCE_TOOLS.has(tool.name) || !result || typeof result !== 'object' || result.error) continue;
        if (tool.name === 'get_policy' && typeof result.content === 'string' && result.content.trim()) return true;
        if (tool.name === 'get_package_details' || tool.name === 'get_tour_details') {
            if (typeof result.cancellationPolicy === 'string' && result.cancellationPolicy.trim() && result.cancellationPolicy !== 'none') return true;
            continue;
        }
        if (hasPolicyWords(result)) return true;
    }
    const prompt = String(input.systemPrompt ?? '');
    const start = prompt.indexOf('<persona>');
    if (start >= 0) {
        const end = prompt.indexOf('</persona>', start);
        const persona = normalizeForIntent(end >= 0 ? prompt.slice(start, end + 10) : prompt.slice(start));
        if (/(?:cancel|anul|reprogram)\w*[^.\n]{0,80}(?:\d+\s*(?:horas|h|hrs|dias|hours|days)|sin costo|sin cargo|gratis|penaliz|cargo|fee|free)/.test(persona)) return true;
    }
    return false;
}

/**
 * True when the reply must be replaced: the customer asked for cancellation / rescheduling terms, the turn holds no source for them,
 * and the reply states terms (or at least does not say it does not know).
 */
export function isUngroundedPolicyAnswer(input: PolicyEvidenceInput & { userText: unknown; reply: unknown }): boolean {
    if (!isCancellationPolicyQuestion(input.userText)) return false;
    if (replyAdmitsNotKnowing(input.reply)) return false;
    if (!replyStatesTerms(input.reply)) return false;
    return !hasPolicyEvidence(input);
}

const NO_POLICY: Record<string, string> = {
    es: 'No tengo información sobre la política de cancelación de este negocio, así que no puedo confirmarle si tiene costo.',
    en: 'I do not have information about this business’s cancellation policy, so I cannot confirm whether it has a cost.',
    pt: 'Não tenho informações sobre a política de cancelamento deste negócio, então não posso confirmar se há custo.',
    fr: 'Je n’ai pas d’informations sur la politique d’annulation de cet établissement, je ne peux donc pas confirmer si elle est gratuite.',
};

/** The honest reply, with the offer of a person from the team when one can be reached from this conversation. */
export function noPolicyInformationText(lang: string | undefined, canOfferPerson: boolean): string {
    const code = (lang || 'es').slice(0, 2).toLowerCase();
    const sentence = NO_POLICY[code] ?? NO_POLICY.es;
    return canOfferPerson ? `${sentence} ${humanOfferQuestionText(lang)}` : sentence;
}
