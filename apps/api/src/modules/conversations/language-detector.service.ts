import { Injectable } from '@nestjs/common';

/**
 * Lightweight heuristic language detector.
 *
 * We intentionally avoid heavy NLP libraries (franc, cld3) because this runs
 * on every inbound message. Instead, we score the message against small
 * stop-word sets per supported language and pick the winner.
 *
 * Supported: es, en, pt, fr. For anything else we fall back to the tenant
 * default configured on the agent.
 *
 * Returns a short language code ('es' | 'en' | 'pt' | 'fr' | fallback).
 */
@Injectable()
export class LanguageDetectorService {
    // Curated stop-word sets — high-signal words that are unlikely to appear
    // in other languages. Keep short to minimize false positives.
    private readonly markers: Record<string, string[]> = {
        es: ['que', 'de', 'la', 'el', 'es', 'en', 'por', 'para', 'con', 'una', 'uno', 'los', 'las', 'no', 'si', 'hola', 'gracias', 'cuando', 'donde', 'como', 'quiero', 'necesito', 'puedo', 'tengo', 'usted', 'nosotros'],
        en: ['the', 'and', 'you', 'for', 'are', 'but', 'not', 'with', 'this', 'that', 'hello', 'thanks', 'thank', 'want', 'need', 'have', 'would', 'could', 'please', 'when', 'where', 'what', 'how'],
        pt: ['que', 'de', 'nao', 'nao', 'para', 'com', 'uma', 'por', 'esta', 'isso', 'obrigado', 'obrigada', 'ola', 'quero', 'preciso', 'voce', 'nos', 'quando', 'onde', 'como', 'tambem'],
        fr: ['que', 'de', 'le', 'la', 'les', 'pour', 'avec', 'une', 'bonjour', 'merci', 'est', 'sont', 'veux', 'besoin', 'vous', 'nous', 'quand', 'comment', 'aussi', 'mais', "c'est"],
    };

    /**
     * Detect the language of a user message. Returns the short code
     * ('es' | 'en' | 'pt' | 'fr') when confident, otherwise `fallback`.
     *
     * Confidence rule: winner must score at least 2, AND beat second place
     * by at least 2 points. Otherwise we cannot tell — stick with fallback.
     */
    detect(text: string, fallback: string): string {
        const normalized = this.normalize(text);
        if (normalized.length < 3) return this.short(fallback);

        const tokens = new Set(normalized.split(/\s+/).filter(Boolean));

        const scores: Record<string, number> = {};
        for (const [lang, words] of Object.entries(this.markers)) {
            let score = 0;
            for (const w of words) {
                if (tokens.has(w)) score++;
            }
            scores[lang] = score;
        }

        const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        const [winner, winnerScore] = ranked[0];
        const secondScore = ranked[1]?.[1] ?? 0;

        if (winnerScore >= 2 && winnerScore - secondScore >= 2) {
            return winner;
        }
        return this.short(fallback);
    }

    /**
     * Normalize the configured language (e.g. 'es-CO', 'pt-BR', 'en_US')
     * to a short code ('es', 'pt', 'en'). If the configured value is
     * already short or unknown, return as-is lowercased.
     */
    short(language: string | undefined | null): string {
        if (!language) return 'es';
        return language.toLowerCase().split(/[-_]/)[0];
    }

    /** Lowercase, strip accents, collapse punctuation. */
    private normalize(text: string): string {
        return text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s']/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
}
