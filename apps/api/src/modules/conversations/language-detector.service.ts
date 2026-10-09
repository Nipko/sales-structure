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
    // DISCRIMINATIVE markers only — words shared across languages ('que', 'de',
    // 'para', 'por', 'la', 'una'...) were removed because they inflated every
    // language's score equally and stopped the winner from clearing the margin
    // (Portuguese in particular always lost to the tenant default).
    private readonly markers: Record<string, string[]> = {
        // 'tres' is NOT a French marker: "très" loses its accent in normalize()
        // and collides with Spanish "tres personas".
        es: ['hola', 'gracias', 'quiero', 'necesito', 'puedo', 'tengo', 'usted', 'ustedes', 'nosotros', 'pero', 'muy', 'tambien', 'aqui', 'ahora', 'quisiera', 'disculpa', 'cuanto', 'cuesta', 'donde', 'tienen', 'buenas', 'buenos', 'busco', 'estoy', 'cual', 'cuales', 'tienes'],
        en: ['the', 'and', 'you', 'for', 'are', 'but', 'not', 'with', 'this', 'that', 'hello', 'thanks', 'thank', 'want', 'need', 'have', 'would', 'could', 'please', 'when', 'where', 'what', 'how', 'your', 'can', 'looking', "i'm", 'price', 'cost'],
        pt: ['nao', 'obrigado', 'obrigada', 'voce', 'voces', 'preciso', 'isso', 'tambem', 'entao', 'ola', 'sim', 'quero', 'gostaria', 'muito', 'quanto', 'custa', 'tudo', 'bom', 'uma', 'qual', 'quais', 'procuro', 'meu', 'minha', 'pessoas', 'funcionamento', 'tem', 'preco', 'precos'],
        fr: ['bonjour', 'bonsoir', 'merci', 'vous', 'nous', 'veux', 'besoin', 'comment', 'aussi', "c'est", 'oui', 'est', 'sont', 'avec', 'pourquoi', 'voudrais', 'combien', 'salut', 'je', 'quel', 'quels', 'quelle', 'quelles', 'horaires', 'votre', 'pour', 'avez', 'une', 'dans', 'cherche', 'acheter', 'jusqu', 'prix'],
    };

    /**
     * Words that are Portuguese but one letter away from a Spanish word a typo or a regionalism produces
     * ("onde queda el local?", "tenho una duda"): half a point each, so ONE of them never decides the
     * language by itself while two ("onde fica", "onde posso") or one next to a real marker do.
     */
    private readonly weakMarkers: Record<string, string[]> = { pt: ['onde', 'posso', 'tenho', 'fica'] };

    /**
     * Words that ask for something or state a need, in each language. TWO of them in one message, with no sign of the
     * stored language in it, switch to theirs («quiero agendar», «I need an appointment»): a single one never does,
     * because a lone «what?», «how?», «need» or «cual» is just as often a borrowed word, a brand («Want Pack») or a typo.
     * Courtesy words (hola, gracias, please, merci) are NOT here: people sprinkle them across languages.
     */
    private readonly strongMarkers: Record<string, { words: string[]; chars?: RegExp }> = {
        es: { words: ['quiero', 'quisiera', 'necesito', 'busco', 'tengo', 'puedo', 'cuanto', 'cuesta', 'donde', 'tienen', 'cual', 'cuales', 'agendar', 'reservar', 'cita', 'turno', 'disponibilidad', 'disponible', 'arriendo'], chars: /[ñ¿¡]/ },
        en: { words: ['want', 'need', 'would', 'could', 'looking', 'what', 'where', 'when', 'how', 'book', 'booking', 'appointment', 'schedule', 'available', 'availability'] },
        pt: { words: ['quero', 'gostaria', 'preciso', 'procuro', 'quanto', 'custa', 'voce', 'voces', 'nao', 'agendar', 'marcar', 'reservar', 'consulta', 'disponivel'], chars: /[ãõ]/ },
        fr: { words: ['veux', 'besoin', 'voudrais', 'cherche', 'combien', 'reserver', 'rendez', 'disponible', 'disponibilite'], chars: /[èùœëîû]/ },
    };

    /**
     * Function words that belong to ONE of the four languages (never a word another of them also uses: «do» is
     * Portuguese «of the» and an English verb, «as» is a Portuguese article and an English word, «como» is Spanish AND
     * Portuguese, «apartamento»/«visitas»/«ver» are Spanish AND Portuguese, so none of those is here). A message of a
     * full sentence carries several of them; a borrowed word, a brand or a courtesy word carries none.
     */
    private readonly sentenceWords: Record<string, string[]> = {
        es: ['el', 'los', 'las', 'una', 'del', 'con', 'mis', 'sus', 'estoy', 'hay', 'soy', 'eres', 'interesa', 'interesan', 'funcionan', 'funciona', 'nosotros', 'ustedes', 'usted', 'tambien', 'quiero', 'tengo', 'busco', 'necesito'],
        en: ['the', 'is', 'are', 'was', 'of', 'to', 'in', 'it', 'my', 'with', 'this', 'that', 'for', 'and', 'you', 'your', 'have', 'has', 'be', 'can', 'will', 'about', 'from', 'what', 'how', 'does', 'not', 'want', 'need'],
        pt: ['os', 'uma', 'da', 'dos', 'das', 'com', 'nao', 'voce', 'voces', 'tem', 'estou', 'meu', 'minha', 'pra', 'quero', 'preciso', 'gostaria', 'tambem'],
        fr: ['le', 'les', 'des', 'du', 'une', 'est', 'sont', 'avec', 'dans', 'pour', 'vous', 'nous', 'je', 'mon', 'ma', 'mes', 'pas', 'veux', 'besoin', 'voudrais'],
    };

    /**
     * How much of the message is in `lang` for the purpose of a FULL-SENTENCE switch: distinct function words, plus the
     * language's strong request words, plus 2 for an unmistakable character (¿ ¡ ñ, ã õ, è ù œ…).
     */
    private sentenceEvidence(lang: string, tokens: Set<string>, raw: string): number {
        const words = new Set([...(this.sentenceWords[lang] ?? []), ...(this.strongMarkers[lang]?.words ?? [])]);
        let hits = 0;
        for (const word of words) if (tokens.has(word)) hits++;
        return hits + (this.strongMarkers[lang]?.chars?.test(raw) ? 2 : 0);
    }

    /**
     * Whether the message carries at least two DIFFERENT strong markers of the language (a diacritic counts as one).
     * ¿ ¡ ñ are unmistakably Spanish, so in a message of three words or more they count as two.
     */
    private hasStrongMarker(lang: string, tokens: Set<string>, raw: string, wordCount = 0): boolean {
        const strong = this.strongMarkers[lang];
        if (!strong) return false;
        const charWeight = lang === 'es' && wordCount >= 3 ? 2 : 1;
        const hits = strong.words.filter(word => tokens.has(word)).length + (strong.chars?.test(raw) ? charWeight : 0);
        return hits >= 2;
    }

    /**
     * A whole sentence in another language is the customer's language now, even when the stored one is sticky:
     * «Me interesa ver un apartamento en Chapinero, ¿cómo funcionan las visitas?» after an English chat.
     *
     * It needs ALL of: a stored language, five or more words, not a single sign of the stored language in the message
     * (no marker, no diacritic, no function word), and at least three pieces of evidence for the new one with no real
     * competitor. A lone «what?», «Want Pack», «cual», «me mandas el link please» never get here.
     */
    private fullSentenceLanguage(
        previous: string | null,
        tokens: Set<string>,
        raw: string,
        wordCount: number,
        scores: Record<string, number>,
    ): string | null {
        if (!previous || wordCount < 5 || (scores[previous] ?? 0) > 0) return null;
        if (this.sentenceEvidence(previous, tokens, raw) > 0) return null;
        const ranked = Object.keys(this.sentenceWords)
            .filter(lang => lang !== previous)
            .map(lang => [lang, this.sentenceEvidence(lang, tokens, raw)] as const)
            .sort((a, b) => b[1] - a[1]);
        const [best, bestEvidence] = ranked[0];
        const rival = ranked[1]?.[1] ?? 0;
        return bestEvidence >= 3 && rival <= 1 ? best : null;
    }

    /**
     * Distinctive diacritics, tested on the RAW text (normalize() strips accents).
     * Only characters that belong to ONE of the four languages count:
     * ã/õ are Portuguese only; è/ù/œ/ë/î/û are French only; ñ/¿/¡ are Spanish
     * only. ç and à occur in both Portuguese and French, ê/ô likewise, and
     * é/á/í/ó/ú are shared — those score for nobody.
     */
    private readonly diacritics: Record<string, RegExp> = {
        // A standalone "é" (is) is Portuguese only: "Qual é a política de reembolso?" carries a single
        // marker word ("qual"), which never overrides an established Spanish conversation by itself.
        pt: /[ãõ]|(?:^|[^\p{L}])é(?![\p{L}])/u,
        fr: /[èùœëîû]/,
        es: /[ñ¿¡]/,
    };

    /**
     * Detect the language of a user message. Returns the short code
     * ('es' | 'en' | 'pt' | 'fr') when confident, otherwise `fallback`.
     *
     * Confidence rule: the winner scores at least 1 and no other language scores
     * at all (a single clean marker is enough for a short question), OR it scores
     * at least 2 and beats second place by at least 2 (3+ hits need only 1).
     * Otherwise we cannot tell — stick with fallback.
     */
    detect(text: string, fallback: string, previous?: string | null): string {
        return this.detectDetailed(text, fallback, previous).language;
    }

    /**
     * Same as `detect`, plus whether the result is solid enough to be PERSISTED
     * as the conversation's language.
     *
     * Switching away from `previous` needs strong evidence (2+ markers, or a
     * distinctive diacritic plus a marker). A single marker never overrides an
     * established language: "me mandas el link please" stays Spanish. With no
     * previous language a single marker is accepted for this turn only
     * (`persist: false`).
     */
    detectDetailed(text: string, fallback: string, previous?: string | null): { language: string; persist: boolean } {
        const normalized = this.normalize(text);
        if (normalized.length < 3) return { language: this.short(fallback), persist: true };

        const tokens = new Set(normalized.split(/\s+/).filter(Boolean));
        // "d'ouverture", "jusqu'a": also expose the pieces around the elision.
        for (const t of [...tokens]) {
            if (t.includes("'")) for (const part of t.split("'")) if (part) tokens.add(part);
        }
        const raw = (text || '').normalize('NFC').toLowerCase();

        const scores: Record<string, number> = {};
        for (const [lang, words] of Object.entries(this.markers)) {
            let score = 0;
            for (const w of words) {
                if (tokens.has(w)) score++;
            }
            for (const w of this.weakMarkers[lang] ?? []) {
                if (tokens.has(w)) score += 0.5;
            }
            if (this.diacritics[lang]?.test(raw)) score++;
            scores[lang] = score;
        }

        const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        const [winner, winnerScore] = ranked[0];
        const secondScore = ranked[1]?.[1] ?? 0;
        const margin = winnerScore - secondScore;

        if ((winnerScore >= 2 && margin >= 2) || (winnerScore >= 3 && margin >= 1)) {
            return { language: winner, persist: true };
        }
        const prev = previous ? this.short(previous) : null;
        const wordCount = normalized.split(/\s+/).filter(Boolean).length;
        const sentenceLanguage = this.fullSentenceLanguage(prev, tokens, raw, wordCount, scores);
        if (sentenceLanguage) return { language: sentenceLanguage, persist: true };
        if (winnerScore >= 1 && secondScore === 0) {
            if (prev && prev !== winner) {
                // A REQUEST in another language ("quiero agendar corte y estilo" after "What are your opening hours?")
                // is the customer's language now: the stored one holds only while the message shows a sign of it or
                // lacks TWO strong markers of the new one. A courtesy word ("please", "gracias") or a single borrowed
                // word ("what?", "how?", "el Want Pack", "cual") never switches, nor persists, a language.
                if ((scores[prev] ?? 0) === 0 && this.hasStrongMarker(winner, tokens, raw, wordCount)) return { language: winner, persist: true };
                return { language: prev, persist: true };
            }
            return { language: winner, persist: !!prev };
        }
        return { language: this.short(fallback), persist: true };
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
            .replace(/[‘’]/g, "'")
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s']/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
}
