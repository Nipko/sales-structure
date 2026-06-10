import { Injectable, Logger } from '@nestjs/common';

export interface PriceValidationResult {
    ok: boolean;
    /** Prices stated in the response that were not present in any turn input. */
    hallucinatedPrices: number[];
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
 *  - The ALLOWED set is every number that appeared in anything the model saw this
 *    turn (system prompt context, history, tool results, RAG chunks). A price
 *    echoed from the catalog/KB is therefore allowed; only invented ones flag.
 */
@Injectable()
export class ResponseValidatorService {
    private readonly logger = new Logger(ResponseValidatorService.name);

    validatePrices(responseText: string, inputCorpus: string): PriceValidationResult {
        const stated = this.extractMoneyAmounts(responseText || '');
        if (stated.length === 0) return { ok: true, hallucinatedPrices: [] };

        const allowed = this.extractAllNumbers(inputCorpus || '');
        const hallucinated = stated.filter(n => !this.matchesAny(n, allowed));
        return { ok: hallucinated.length === 0, hallucinatedPrices: hallucinated };
    }

    /** Currency-adjacent amounts: "$50.000", "49 USD", "1,200 pesos", "S/ 80". */
    private extractMoneyAmounts(text: string): number[] {
        const out: number[] = [];
        const re = /(?:\$|€|£|R\$|S\/|COP|USD|MXN|ARS|CLP|PEN|EUR|BRL)\s?(\d[\d.,]*)|(\d[\d.,]*)\s?(?:pesos|d[oó]lares?|d[oó]lar|euros?|reales|soles|COP|USD|MXN|ARS|CLP|PEN|EUR|BRL)/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            const n = this.normalize(m[1] || m[2]);
            if (n != null) out.push(n);
        }
        return out;
    }

    private extractAllNumbers(text: string): number[] {
        const out: number[] = [];
        const re = /\d[\d.,]*/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            const n = this.normalize(m[0]);
            if (n != null) out.push(n);
        }
        return out;
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

    private matchesAny(n: number, allowed: number[]): boolean {
        for (const a of allowed) {
            if (a === n) return true;
            // 0.5% tolerance for rounding ("about $50,000").
            if (a !== 0 && Math.abs(a - n) / Math.max(a, n) < 0.005) return true;
        }
        return false;
    }
}
