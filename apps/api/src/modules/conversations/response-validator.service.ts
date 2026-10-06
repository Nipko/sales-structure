import { Injectable, Logger } from '@nestjs/common';

export interface PriceValidationResult {
    ok: boolean;
    /** Prices stated in the response that were not present in any turn input. */
    hallucinatedPrices: number[];
}

interface MoneyMention {
    amount: number;
    /** Undefined means that the marker is ambiguous (for example "$" or "pesos"). */
    currency?: string;
}

const UNVERIFIED_PRICE_REPLIES: Record<string, string> = {
    es: 'No tengo un precio verificado en la información disponible. Puedo ayudarte a confirmarlo con el equipo.',
    en: 'I do not have a verified price in the available information. I can help you confirm it with the team.',
    pt: 'Não tenho um preço verificado nas informações disponíveis. Posso ajudar a confirmá-lo com a equipe.',
    fr: 'Je ne dispose pas d’un prix vérifié dans les informations disponibles. Je peux vous aider à le confirmer auprès de l’équipe.',
};

/** Deterministic fail-closed reply used when a corrective LLM pass is still unsafe. */
export function buildUnverifiedPriceReply(systemPrompt: string): string {
    const language = systemPrompt.match(/<language>\s*(es|en|pt|fr)\s*<\/language>/i)?.[1]?.toLowerCase() || 'es';
    return UNVERIFIED_PRICE_REPLIES[language] || UNVERIFIED_PRICE_REPLIES.es;
}

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
 */
@Injectable()
export class ResponseValidatorService {
    private readonly logger = new Logger(ResponseValidatorService.name);

    validatePrices(responseText: string, inputCorpus: string): PriceValidationResult {
        const stated = this.extractMoneyAmounts(responseText || '');
        if (stated.length === 0) return { ok: true, hallucinatedPrices: [] };

        const allowed = [
            ...this.extractMoneyAmounts(inputCorpus || ''),
            ...this.extractStructuredMoneyAmounts(inputCorpus || ''),
        ];
        const hallucinated = stated
            .filter(mention => !this.matchesAny(mention, allowed))
            .map(mention => mention.amount)
            .filter((amount, index, all) => all.indexOf(amount) === index);
        return { ok: hallucinated.length === 0, hallucinatedPrices: hallucinated };
    }

    /** Currency-adjacent amounts: "$50.000", "49 USD", "1,200 pesos", "S/ 80". */
    private extractMoneyAmounts(text: string): MoneyMention[] {
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
            const n = this.normalize(m[2] || m[3]);
            if (n != null) out.push({ amount: n, currency: this.normalizeCurrency(m[1] || m[4]) });
        }
        return out;
    }

    /** Prices encoded as XML/JSON fields by the turn assembler and tool results. */
    private extractStructuredMoneyAmounts(text: string): MoneyMention[] {
        const out: MoneyMention[] = [];
        const regions = text.match(/<[^>]{1,1000}>|\{[^{}]{1,1000}\}/g) || [];
        for (const region of regions) {
            const price = region.match(/(?:^|[\s,{])["']?(?:price|amount|total|total_amount|totalAmount|total_price|totalPrice|night_price|nightPrice|cleaning_fee|cleaningFee|totalPrice)["']?\s*(?:=|:)\s*["']?(\d[\d.,]*)/i)?.[1];
            const currency = region.match(/(?:^|[\s,{])["']?currency["']?\s*(?:=|:)\s*["']?([A-Za-z]{3})/i)?.[1];
            if (!price) continue;
            const amount = this.normalize(price);
            if (amount != null) out.push({ amount, currency: currency ? this.normalizeCurrency(currency) : undefined });
        }
        // Fallback: bare nightPrice/totalPrice numbers anywhere in tool JSON even without currency in same region
        // (list_properties returns {nightPrice:180000,currency:COP} but region split may separate them)
        const barePrices = text.match(/"(?:nightPrice|night_price|totalPrice|total_price)"\s*:\s*(\d[\d.,]*)/gi) || [];
        for (const m of barePrices) {
            const v = m.match(/(\d[\d.,]*)/)?.[1];
            const n = v ? this.normalize(v) : null;
            if (n != null && !out.some(o => o.amount === n)) out.push({ amount: n, currency: undefined });
        }
        return out;
    }

    private normalizeCurrency(marker?: string): string | undefined {
        const value = (marker || '').trim().toUpperCase();
        if (!value || value === '$' || value === 'PESOS') return undefined;
        if (value === 'R$' || value === 'REALES') return 'BRL';
        if (value === 'S/' || value === 'SOLES') return 'PEN';
        if (value === '€' || value === 'EURO' || value === 'EUROS') return 'EUR';
        if (value === '£') return 'GBP';
        if (/D[OÓ]LAR/.test(value)) return undefined;
        return value;
    }

    /** Normalize "50.000" / "50,000" / "1.200,50" / "1,200.50" → numeric (LatAm-aware). */
    private normalize(raw: string): number | null {
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
): VerifiedPriceReply {
    const validation = validator.validatePrices(candidate, inputCorpus);
    return validation.ok
        ? { reply: candidate, validation, blocked: false }
        : { reply: buildUnverifiedPriceReply(systemPrompt), validation, blocked: true };
}
