import { Injectable, Logger } from '@nestjs/common';
import type { VerifiedFactView } from '@parallext/shared';
import { ledgerBacksAmount } from './runtime/facts-ledger';
import { addressFormOf } from './transition-engine';

export interface PriceValidationResult {
    ok: boolean;
    /** Prices stated in the response that were not present in any turn input. */
    hallucinatedPrices: number[];
}

interface MoneyMention {
    amount: number;
    /** Undefined means that the marker is ambiguous (for example "$" or "pesos"). */
    currency?: string;
    /** Where the mention sits in the text it was read from (response side). */
    index?: number;
    length?: number;
}

/**
 * The conversation's live verified facts (`agentRuntime.factsLedger`). An amount that is not in this turn's evidence
 * still passes when a live confirmed money fact of the SAME subject backs it (see `ledgerBacksAmount`).
 */
export interface PriceLedger {
    facts: readonly VerifiedFactView[];
    customerText?: string;
}

/** What else the turn says that a computed total may rest on: the customer's message (the quantity they asked for). */
export interface PriceValidationOptions {
    customerText?: string;
}

const UNVERIFIED_PRICE_REPLIES: Record<string, string> = {
    es: 'No tengo un precio verificado en la información disponible. Puedo ayudarle a confirmarlo con el equipo.',
    en: 'I do not have a verified price in the available information. I can help you confirm it with the team.',
    pt: 'Não tenho um preço verificado nas informações disponíveis. Posso ajudar a confirmá-lo com a equipe.',
    fr: 'Je ne dispose pas d’un prix vérifié dans les informations disponibles. Je peux vous aider à le confirmer auprès de l’équipe.',
};
/** The Spanish «tú» variant. Portuguese (neutral «você» construction), English and French («vous») have one register. */
const UNVERIFIED_PRICE_REPLY_ES_TU = 'No tengo un precio verificado en la información disponible. Puedo ayudarte a confirmarlo con el equipo.';

/** Said after the sentences with an unverified amount were taken out and a verified price stays in the reply. */
const UNVERIFIED_AMOUNT_NOTES: Record<string, string> = {
    es: 'El otro importe no lo tengo verificado; puedo ayudarle a confirmarlo con el equipo.',
    en: 'I do not have the other amount verified; I can help you confirm it with the team.',
    pt: 'Não tenho o outro valor verificado; posso ajudar a confirmá-lo com a equipe.',
    fr: 'Je n’ai pas de montant vérifié pour le reste ; je peux vous aider à le confirmer auprès de l’équipe.',
};
const UNVERIFIED_AMOUNT_NOTE_ES_TU = 'El otro importe no lo tengo verificado; puedo ayudarte a confirmarlo con el equipo.';

function replyLanguage(systemPrompt: string): string {
    return systemPrompt.match(/<language>\s*(es|en|pt|fr)\s*<\/language>/i)?.[1]?.toLowerCase() || 'es';
}

function addressIsTu(systemPrompt: string, form?: unknown): boolean {
    const declared = form ?? systemPrompt.match(/<address_form>\s*([^<]*?)\s*<\/address_form>/i)?.[1];
    return addressFormOf(declared) === 'tu';
}

/**
 * Deterministic fail-closed reply used when a corrective LLM pass is still unsafe.
 *
 * It is said in the turn's form of address, like the transition-engine texts: a persona that addresses the customer as
 * «usted» got «Puedo ayudarte» here and the register switched mid-conversation. `form` is the turn's resolved
 * `regional.addressForm`; without it the `<address_form>` the prompt assembler wrote into the system prompt (the same
 * value) is read. Both go through `addressFormOf`, so «vos» reads as «tú» and anything unknown as «usted».
 */
export function buildUnverifiedPriceReply(systemPrompt: string, form?: unknown): string {
    const language = replyLanguage(systemPrompt);
    if (language === 'es' && addressIsTu(systemPrompt, form)) return UNVERIFIED_PRICE_REPLY_ES_TU;
    return UNVERIFIED_PRICE_REPLIES[language] || UNVERIFIED_PRICE_REPLIES.es;
}

/** The note that closes a reply whose unverified amount was taken out, in the turn's language and form of address. */
export function unverifiedAmountNote(systemPrompt: string, form?: unknown): string {
    const language = replyLanguage(systemPrompt);
    if (language === 'es' && addressIsTu(systemPrompt, form)) return UNVERIFIED_AMOUNT_NOTE_ES_TU;
    return UNVERIFIED_AMOUNT_NOTES[language] || UNVERIFIED_AMOUNT_NOTES.es;
}

/** Normalize "50.000" / "50,000" / "1.200,50" / "1,200.50" → numeric (LatAm-aware). */
function normalizeAmount(raw: string): number | null {
    let s = (raw || '').replace(/[^\d.,]/g, '');
    if (!s) return null;
    // A trailing group of 1-2 digits after . or , is a decimal; anything else
    // (e.g. ".000") is a thousands separator.
    const decMatch = s.match(/[.,](\d{1,2})$/);
    let dec = '';
    if (decMatch) { dec = decMatch[1]; s = s.slice(0, -(dec.length + 1)); }
    s = s.replace(/[.,]/g, '');
    if (!s) return null;
    const n = Number(dec ? `${s}.${dec}` : s);
    return isNaN(n) ? null : n;
}

function normalizeCurrency(marker?: string): string | undefined {
    const value = (marker || '').trim().toUpperCase();
    if (!value || value === '$' || value === 'PESOS') return undefined;
    if (value === 'R$' || value === 'REALES') return 'BRL';
    if (value === 'S/' || value === 'SOLES') return 'PEN';
    if (value === '€' || value === 'EURO' || value === 'EUROS') return 'EUR';
    if (value === '£') return 'GBP';
    if (/D[OÓ]LAR/.test(value)) return undefined;
    return value;
}

/** Currency-adjacent amounts: "$50.000", "49 USD", "1,200 pesos", "S/ 80". */
export function moneyMentionsIn(text: string): MoneyMention[] {
    const out: MoneyMention[] = [];
    // A thousands group may be separated by a space, NBSP or NNBSP ("119 900 COP", what
    // French/Portuguese locales and some models write) as well as by "." or ",": reading
    // only "900" blocked a price the tool had returned. Space-separated groups take an
    // optional decimal tail; "49.900 450 unidades" stays 49900 + a quantity.
    const amount = '((?:\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+(?:[.,]\\d{1,2})?(?!\\d)|\\d[\\d.,]*))';
    const re = new RegExp(
        `(R\\$|S\\/|\\$|€|£|COP|USD|MXN|ARS|CLP|PEN|EUR|BRL)\\s?${amount}|${amount}\\s?(pesos|d[oó]lares?|d[oó]lar|euros?|reales|soles|COP|USD|MXN|ARS|CLP|PEN|EUR|BRL)`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const n = normalizeAmount(m[2] || m[3]);
        if (n != null) out.push({ amount: n, currency: normalizeCurrency(m[1] || m[4]), index: m.index, length: m[0].length });
    }
    return out;
}

const compatibleCurrency = (a?: string, b?: string) => !a || !b || a === b;

/**
 * F4300-36: the quantities a computed total may multiply by. «¿y si pido dos?», «3 noches», «x2», «un par»: a small whole number
 * (2..50) the customer's message or the reply's sentence says, in digits or as a word (es/en/pt/fr, two to ten). Amounts, times
 * («15:00»), dates («25/10», «25 de octubre») and decimals are not quantities.
 */
const QUANTITY_WORDS: Record<string, number> = {
    dos: 2, two: 2, dois: 2, duas: 2, deux: 2,
    tres: 3, 'três': 3, three: 3, trois: 3,
    cuatro: 4, four: 4, quatro: 4, quatre: 4,
    cinco: 5, five: 5, cinq: 5,
    seis: 6, six: 6,
    siete: 7, seven: 7, sete: 7, sept: 7,
    ocho: 8, eight: 8, oito: 8, huit: 8,
    nueve: 9, nine: 9, nove: 9, neuf: 9,
    diez: 10, ten: 10, dez: 10, dix: 10,
};
const QUANTITY_WORD = new RegExp(`(?<![\\p{L}\\p{N}])(${Object.keys(QUANTITY_WORDS).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
const A_WEEK = /(?<![\p{L}])(?:una semana|uma semana|a week|one week|une semaine)(?![\p{L}])/iu;
const HALF_DOZEN = /(?<![\p{L}])(?:media docena|half a dozen|meia d[uú]zia|une demi-douzaine|demi-douzaine)(?![\p{L}])/iu;
const PAIR = /(?<![\p{L}])(?:un par|a couple|a pair|um par|uma dupla|une paire)(?![\p{L}])/iu;
/** A month after a day number («25 de octubre», «3 June», «12 févr.»): a date, not a quantity. «2 margaritas» stays a quantity. */
const MONTH = '(?:(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|june|july|august|september|october|november|december|janeiro|fevereiro|mar[cç]o|maio|junho|julho|setembro|outubro|novembro|dezembro|janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre)|(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|set|oct|out|nov|dic|dez|jan|apr|aug|dec|janv|f[eé]vr?|avr|juil|d[eé]c)\\.?)(?!\\p{L})';
const QUANTITY_DIGITS = new RegExp(`(?<![\\d.,:/-])(\\d{1,2})(?![\\d:/]|[.,]\\d|\\s*(?:%|h\\b|am\\b|pm\\b|de\\s+${MONTH}|${MONTH}))`, 'giu');

export function quantitiesIn(text: string): number[] {
    if (!text) return [];
    // Amounts are not quantities: «13.500 COP» never gives 13 or 50.
    let bare = text;
    for (const mention of moneyMentionsIn(text)) {
        bare = bare.slice(0, mention.index!) + ' '.repeat(mention.length!) + bare.slice(mention.index! + mention.length!);
    }
    const found = new Set<number>();
    for (const m of bare.matchAll(QUANTITY_DIGITS)) {
        const n = Number(m[1]);
        if (n >= 2 && n <= 50) found.add(n);
    }
    for (const m of bare.matchAll(QUANTITY_WORD)) found.add(QUANTITY_WORDS[m[1].toLowerCase()]);
    if (PAIR.test(bare)) found.add(2);
    // «media docena de platos» (production QA 27-oct) is six.
    if (HALF_DOZEN.test(bare)) found.add(6);
    // «¿cuánto costaría una semana en la habitación?» (production QA 27-oct) is seven nights.
    if (A_WEEK.test(bare)) found.add(7);
    return [...found];
}

/** The sentence of `text` around a mention (a thousands separator «13.500» does not end a sentence). */
function sentenceAround(text: string, index: number, length: number): string {
    let start = 0;
    for (let i = index - 1; i >= 0; i--) {
        if (text[i] === '\n' || (/[.!?]/.test(text[i]) && !/\d/.test(text[i + 1] ?? ''))) { start = i + 1; break; }
    }
    const rest = text.slice(index + length);
    const end = rest.search(/\n|[.!?](?!\d)/);
    return text.slice(start, end < 0 ? text.length : index + length + end);
}

/** Upper bound on the combinations a sum is searched over (fail closed beyond it). */
const SUM_SEARCH_BUDGET = 200_000;
/** A larger pool of amounts only sums the ones the reply itself states and verified. */
const SUM_POOL_LIMIT = 40;
/** Rounding only: a computed total may differ by at most one unit of currency. */
const ROUNDING = 1;

/**
 * Output guardrail (#3 — "verified responses"). Catches the highest-risk
 * hallucination for a sales/booking agent: stating a PRICE the model was never
 * given (the Air Canada failure mode, where a bot invented a refund policy).
 *
 * Designed for a low false-positive rate:
 *  - From the RESPONSE we only consider amounts that carry a currency marker
 *    ("$50.000", "49 USD", "1.200 pesos") — bare numbers like "5 minutos" or
 *    "3 sucursales" are ignored.
 *  - The ALLOWED set contains only monetary values from what the model saw this
 *    turn (system prompt context, history, tool results, RAG chunks). Rule numbers,
 *    dates and quantities can therefore never authorize a made-up price.
 *  - F4300-36: a TOTAL computed from allowed amounts passes — an allowed amount times a quantity the customer or the reply's
 *    sentence says («si pido dos» → 2 × 13.500 = 27.000; «3 noches» × nightPrice), or the sum of 2–5 different allowed
 *    amounts (at most one of them times a quantity: nights × night price + cleaning fee). Only rounding is tolerated (≤ 1
 *    unit); no percentage or discount is ever derived. «¿cuánto cuesta el plato Spark? y si pido dos?» read 13.500 COP and
 *    the whole reply was replaced by «No tengo un precio verificado» because 27.000 was not literally in the menu.
 */
@Injectable()
export class ResponseValidatorService {
    private readonly logger = new Logger(ResponseValidatorService.name);

    validatePrices(responseText: string, inputCorpus: string, ledger?: PriceLedger, options: PriceValidationOptions = {}): PriceValidationResult {
        const stated = moneyMentionsIn(responseText || '');
        if (stated.length === 0) return { ok: true, hallucinatedPrices: [] };

        const allowed = [
            ...moneyMentionsIn(inputCorpus || ''),
            ...this.extractStructuredMoneyAmounts(inputCorpus || ''),
        ];
        const backed = (mention: MoneyMention) => this.matchesAny(mention, allowed)
            || (!!ledger?.facts.length && ledgerBacksAmount(responseText, {
                amount: mention.amount, currency: mention.currency, index: mention.index ?? 0, length: mention.length ?? 0,
            }, ledger.facts, ledger.customerText));
        const direct = stated.map(mention => ({ mention, ok: backed(mention) }));
        if (direct.every(entry => entry.ok)) return { ok: true, hallucinatedPrices: [] };

        // What a computed total may rest on: the turn's amounts, the reply's own verified amounts and the live confirmed
        // money facts of the conversation.
        const replyVerified = direct.filter(entry => entry.ok).map(entry => entry.mention);
        const ledgerAmounts: MoneyMention[] = (ledger?.facts ?? [])
            .filter(fact => fact.kind === 'money' && fact.priceStatus === 'confirmed' && typeof fact.value === 'number')
            .map(fact => ({ amount: fact.value as number, currency: fact.currency ? fact.currency.toUpperCase() : undefined }));
        const customerQuantities = quantitiesIn(options.customerText ?? ledger?.customerText ?? '');

        const hallucinated = direct
            .filter(entry => !entry.ok)
            .map(entry => entry.mention)
            .filter(mention => {
                const quantities = [...new Set([...customerQuantities,
                    ...quantitiesIn(sentenceAround(responseText, mention.index ?? 0, mention.length ?? 0))])];
                return !this.derivedTotal(mention, [...allowed, ...ledgerAmounts], replyVerified, quantities);
            })
            .map(mention => mention.amount)
            .filter((amount, index, all) => all.indexOf(amount) === index);
        return { ok: hallucinated.length === 0, hallucinatedPrices: hallucinated };
    }

    /**
     * Whether `stated` is a total computed from verified amounts of its currency: one amount times a quantity said in the turn,
     * or the sum of 2–5 different amounts of which at most one is multiplied by such a quantity. Rounding (≤ 1 unit) only.
     */
    private derivedTotal(stated: MoneyMention, turnAmounts: MoneyMention[], replyVerified: MoneyMention[], quantities: number[]): boolean {
        const target = stated.amount;
        if (!(target > 0)) return false;
        const amountsOf = (mentions: MoneyMention[]) => [...new Set(mentions
            .filter(candidate => compatibleCurrency(stated.currency, candidate.currency))
            .map(candidate => candidate.amount)
            .filter(amount => amount > 0 && amount <= target + ROUNDING))];
        const close = (value: number) => Math.abs(value - target) <= ROUNDING;

        let bases = amountsOf([...turnAmounts, ...replyVerified]);
        for (const base of bases) if (quantities.some(q => close(base * q))) return true;

        if (bases.length > SUM_POOL_LIMIT) bases = amountsOf(replyVerified);
        if (bases.length < 2) return false;
        bases.sort((a, b) => b - a);
        let budget = SUM_SEARCH_BUDGET;
        // Each amount at most once (13.500 + 13.500 is «two» and needs the quantity said), at most one multiplied term.
        const search = (from: number, sum: number, terms: number, multiplied: boolean): boolean => {
            if (terms >= 2 && close(sum)) return true;
            if (terms === 5 || --budget <= 0) return false;
            for (let i = from; i < bases.length; i++) {
                const options = [bases[i], ...(multiplied ? [] : quantities.map(q => bases[i] * q))];
                for (let k = 0; k < options.length; k++) {
                    if (sum + options[k] > target + ROUNDING) continue;
                    if (search(i + 1, sum + options[k], terms + 1, multiplied || k > 0)) return true;
                }
            }
            return false;
        };
        return search(0, 0, 0, false);
    }

    /** Prices encoded as XML/JSON fields by the turn assembler and tool results. */
    private extractStructuredMoneyAmounts(text: string): MoneyMention[] {
        const out: MoneyMention[] = [];
        const regions = text.match(/<[^>]{1,1000}>|\{[^{}]{1,1000}\}/g) || [];
        for (const region of regions) {
            const price = region.match(/(?:^|[\s,{])["']?(?:price|amount|total|total_amount|totalAmount|total_price|totalPrice|night_price|nightPrice|cleaning_fee|cleaningFee|totalPrice)["']?\s*(?:=|:)\s*["']?(\d[\d.,]*)/i)?.[1];
            const currency = region.match(/(?:^|[\s,{])["']?currency["']?\s*(?:=|:)\s*["']?([A-Za-z]{3})/i)?.[1];
            if (!price) continue;
            const amount = normalizeAmount(price);
            if (amount != null) out.push({ amount, currency: currency ? normalizeCurrency(currency) : undefined });
        }
        // Fallback: bare nightPrice/totalPrice numbers anywhere in tool JSON even without currency in same region
        // (list_properties returns {nightPrice:180000,currency:COP} but region split may separate them)
        const barePrices = text.match(/"(?:nightPrice|night_price|totalPrice|total_price)"\s*:\s*(\d[\d.,]*)/gi) || [];
        for (const m of barePrices) {
            const v = m.match(/(\d[\d.,]*)/)?.[1];
            const n = v ? normalizeAmount(v) : null;
            if (n != null && !out.some(o => o.amount === n)) out.push({ amount: n, currency: undefined });
        }
        return out;
    }

    private matchesAny(stated: MoneyMention, allowed: MoneyMention[]): boolean {
        for (const candidate of allowed) {
            if (stated.currency && candidate.currency && stated.currency !== candidate.currency) continue;
            const a = candidate.amount;
            const n = stated.amount;
            if (a === n) return true;
            // 0.5% tolerance for rounding ("about $50,000").
            if (a !== 0 && Math.abs(a - n) / Math.max(a, n) < 0.005) return true;
        }
        return false;
    }
}

const CORRECTIVE_PRICE_INSTRUCTION: Record<string, string> = {
    es: 'Tu respuesta anterior mencionó uno o más precios que NO aparecen en la información que tienes. Reescríbela usando ÚNICAMENTE precios presentes en el contexto; si no tienes el precio exacto, dilo con naturalidad y ofrece confirmarlo. Devuelve solo el mensaje corregido.',
    en: 'Your previous reply mentioned one or more prices that do NOT appear in the information you have. Rewrite it using ONLY prices present in the context; if you do not have the exact price, say so naturally and offer to confirm it. Return only the corrected message.',
    pt: 'Sua resposta anterior mencionou um ou mais preços que NÃO aparecem nas informações que você tem. Reescreva-a usando APENAS preços presentes no contexto; se você não tem o preço exato, diga isso com naturalidade e ofereça confirmá-lo. Devolva apenas a mensagem corrigida.',
    fr: "Ta réponse précédente mentionnait un ou plusieurs prix qui n'apparaissent PAS dans les informations dont tu disposes. Réécris-la en utilisant UNIQUEMENT des prix présents dans le contexte ; si tu n'as pas le prix exact, dis-le naturellement et propose de le confirmer. Renvoie uniquement le message corrigé.",
};

/**
 * The corrective price retry, written in the turn's language: an instruction in
 * Spanish pulls the rewritten reply into Spanish even when the customer wrote
 * in another language. Unknown languages fall back to Spanish, the base language.
 */
export function correctivePriceInstruction(lang?: string): string {
    const code = String(lang || 'es').slice(0, 2).toLowerCase();
    return CORRECTIVE_PRICE_INSTRUCTION[code] ?? CORRECTIVE_PRICE_INSTRUCTION.es;
}

export interface VerifiedPriceReply {
    reply: string;
    validation: PriceValidationResult;
    blocked: boolean;
    /** When blocked: 'sentences', only the sentences with an unverified amount went; 'template', the whole reply was replaced. */
    action?: 'sentences' | 'template';
}

/** A sentence opening that pointed at the sentence before it («Also», «However», «En total»): dropped with it. */
const DEPENDENT_OPENING = /^(\s*(?:[-*•]\s+)?)(?:tambi[eé]n|tamb[eé]m|also|aussi|adem[aá]s|al[eé]m disso|de plus|sin embargo|however|por[eé]m|cependant|pero|but|mas|mais)\s*,?\s+/iu;
const capitalizeFirst = (text: string) => text.replace(/^(\s*(?:[-*•]\s+)?[¿¡"«“(]*)(\p{Ll})/u, (_, lead: string, letter: string) => lead + letter.toUpperCase());

/**
 * F4300-36: the reply without the sentences that state an unverified amount, when what is left still states a verified price.
 * «El plato Spark cuesta 13.500 COP. Si pide dos, serían 30.000 COP.» keeps the first sentence and closes with the honest note,
 * instead of the whole reply becoming «No tengo un precio verificado» (which hid the real 13.500 too). Null when nothing
 * verifiable is left: the caller falls back to the whole-reply template. Pure but for the validator.
 */
export function withoutUnverifiedPriceSentences(
    candidate: string,
    validation: PriceValidationResult,
    inputCorpus: string,
    systemPrompt: string,
    validator: Pick<ResponseValidatorService, 'validatePrices'>,
    ledger?: PriceLedger,
    form?: unknown,
    options: PriceValidationOptions = {},
): string | null {
    if (validation.ok || !candidate || !validation.hallucinatedPrices.length) return null;
    const unverified = new Set(validation.hallucinatedPrices);
    let removed = 0;
    let previousDropped = false;
    const lines = candidate.split('\n').map(line => {
        if (!line.trim()) return line;
        const kept: string[] = [];
        for (const sentence of line.split(/(?<=[.!?…])\s+/)) {
            if (moneyMentionsIn(sentence).some(mention => unverified.has(mention.amount))) {
                removed++;
                previousDropped = true;
                continue;
            }
            kept.push(previousDropped ? capitalizeFirst(sentence.replace(DEPENDENT_OPENING, '$1')) : sentence);
            previousDropped = false;
        }
        return kept.length ? kept.join(' ') : null;
    }).filter((line): line is string => line !== null);
    if (!removed) return null;
    const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    // Something verifiable is left: a price the turn backs, in a reply that is more than a greeting.
    if (!moneyMentionsIn(text).length || !/\p{L}/u.test(text)) return null;
    const recheck = ledger ? validator.validatePrices(text, inputCorpus, ledger, options) : validator.validatePrices(text, inputCorpus, undefined, options);
    if (!recheck.ok) return null;
    // A question that closed the reply («¿Desea pedirlo?») stays last: the note goes before it.
    const note = unverifiedAmountNote(systemPrompt, form);
    const closing = /(?:^|\s)([¿]?[^.!?…\n]*\?)\s*$/u.exec(text);
    if (closing && closing.index > 0) return `${text.slice(0, closing.index).trimEnd()} ${note} ${closing[1].trim()}`;
    return `${text} ${note}`;
}

/**
 * Final boundary after a corrective LLM pass. Keeping this pure makes the
 * fail-closed decision independently testable without booting ConversationsModule.
 */
export function enforceVerifiedPriceReply(
    candidate: string,
    inputCorpus: string,
    systemPrompt: string,
    validator: Pick<ResponseValidatorService, 'validatePrices'>,
    ledger?: PriceLedger,
    form?: unknown,
    options?: PriceValidationOptions,
): VerifiedPriceReply {
    const validation = options
        ? validator.validatePrices(candidate, inputCorpus, ledger, options)
        : ledger ? validator.validatePrices(candidate, inputCorpus, ledger) : validator.validatePrices(candidate, inputCorpus);
    if (validation.ok) return { reply: candidate, validation, blocked: false };
    const trimmed = withoutUnverifiedPriceSentences(candidate, validation, inputCorpus, systemPrompt, validator, ledger, form, options);
    return trimmed
        ? { reply: trimmed, validation, blocked: true, action: 'sentences' }
        : { reply: buildUnverifiedPriceReply(systemPrompt, form), validation, blocked: true, action: 'template' };
}
