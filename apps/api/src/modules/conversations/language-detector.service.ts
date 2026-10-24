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
/** What the turn knows beyond the message: the catalogue names in play and the customer's recent messages (oldest first). */
export interface LanguageDetectionContext {
    names?: readonly string[];
    recentCustomerMessages?: readonly string[];
}

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
        es: { words: ['quiero', 'quisiera', 'necesito', 'busco', 'tengo', 'puedo', 'cuanto', 'cuesta', 'donde', 'tienen', 'cual', 'cuales', 'agendar', 'reservar', 'cita', 'turno', 'disponibilidad', 'disponible', 'arriendo',
            // Spanish typed WITHOUT accents or ¿ (the usual way on a phone): words that are Spanish and nothing else, so a request such as
            // «Busco apartamento en venta en Usaquen de 3 habitaciones, hasta 600 millones» is recognised after an English chat.
            'hasta', 'habitaciones', 'habitacion', 'dormitorios', 'millones', 'millon', 'venta', 'buscamos', 'quisieramos', 'necesitamos', 'cuantos', 'cuantas', 'quien', 'quienes', 'cuando'], chars: /[ñ¿¡]/ },
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
        es: ['el', 'los', 'las', 'una', 'del', 'con', 'mis', 'sus', 'estoy', 'hay', 'soy', 'eres', 'interesa', 'interesan', 'funcionan', 'funciona', 'nosotros', 'ustedes', 'usted', 'tambien', 'quiero', 'tengo', 'busco', 'necesito',
            'hasta', 'habitaciones', 'habitacion', 'dormitorios', 'millones', 'millon', 'venta', 'buscamos', 'necesitamos', 'cuantos', 'cuantas',
            // Everyday Spanish that Portuguese, English and French spell differently (pt «e/seu/muito/faço/ontem/hoje/noite/já/isso»).
            'y', 'su', 'mi', 'lo', 'ya', 'eso', 'esto', 'mucho', 'mucha', 'muchos', 'muchas', 'hago', 'dime', 'dejas', 'puedes', 'puede', 'pueden', 'quieres', 'ayer', 'hoy', 'manana', 'tiempo', 'noche', 'noches'],
        en: ['the', 'is', 'are', 'was', 'of', 'to', 'in', 'it', 'my', 'with', 'this', 'that', 'for', 'and', 'you', 'your', 'have', 'has', 'be', 'can', 'will', 'about', 'from', 'what', 'how', 'does', 'not', 'want', 'need',
            'much', 'many', 'night', 'there', 'any'],
        // Not «dos»: it is Portuguese «of the» AND Spanish «two» («me los dejas a 100 mil los dos»).
        pt: ['os', 'uma', 'da', 'das', 'com', 'nao', 'voce', 'voces', 'tem', 'estou', 'meu', 'minha', 'pra', 'quero', 'preciso', 'gostaria', 'tambem',
            'muito', 'muita', 'seu', 'sua', 'isso', 'isto', 'hoje', 'ontem', 'noite', 'faco', 'pode', 'tempo', 'amanha'],
        fr: ['le', 'les', 'des', 'du', 'une', 'est', 'sont', 'avec', 'dans', 'pour', 'vous', 'nous', 'je', 'mon', 'ma', 'mes', 'pas', 'veux', 'besoin', 'voudrais',
            // «et» (and) and everyday French that Spanish, Portuguese and English spell differently.
            'et', 'mais', 'temps', 'demain', 'nuit', 'aujourd'],
    };

    /**
     * The words of a short customer question that only one language spells this way: «qué debo llevar al tour?»
     * (production 2026-10-22, answered in English after an English chat — none of its words was known here, and «tour»
     * is every language's). They count for the current-message rule only, which already sets aside a message built
     * around a name; the full-sentence rule keeps its own list, so «Hotel Aurora con las vistas al mar» still keeps
     * the stored language.
     */
    private readonly questionWords: Record<string, string[]> = {
        es: ['al', 'debo', 'debes', 'debe', 'debemos', 'deberia', 'llevar', 'llevo', 'traer', 'traigo'],
        pt: ['ao', 'aos', 'devo', 'deves', 'deve', 'devemos', 'deveria', 'levar', 'levo', 'trazer', 'trago'],
        fr: ['dois', 'doit', 'devons', 'devez', 'apporter', 'emporter', 'amener', 'au', 'aux'],
        en: ['should', 'bring', 'must', 'take'],
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
     * Greetings, thanks and yes/no words. People sprinkle them across languages, so they are never evidence that the
     * customer SWITCHED language — but they still are a sign of the language they belong to (they keep it).
     */
    private readonly courtesyWords = new Set(['hola', 'gracias', 'buenas', 'buenos', 'hello', 'thanks', 'thank', 'please', 'ola', 'obrigado', 'obrigada', 'sim', 'bonjour', 'bonsoir', 'merci', 'salut', 'oui']);

    /**
     * Everything the message shows of `lang`: distinct marker, function and request words (half a point for a weak
     * marker), one point for a character only that language uses, and for Portuguese a standalone «e» (and) — «e tem
     * estacionamento?» — which Spanish only writes before an i-sound («padre e hijo») and «e-mail» never is.
     * With `courtesy: false` greetings and thanks do not count.
     */
    private languageEvidence(lang: string, tokens: Set<string>, raw: string, courtesy: boolean): number {
        const words = new Set([...(this.markers[lang] ?? []), ...(this.sentenceWords[lang] ?? []), ...(this.strongMarkers[lang]?.words ?? []), ...(this.questionWords[lang] ?? [])]);
        let hits = 0;
        for (const word of words) if (tokens.has(word) && (courtesy || !this.courtesyWords.has(word))) hits++;
        for (const word of this.weakMarkers[lang] ?? []) if (tokens.has(word)) hits += 0.5;
        if (this.diacritics[lang]?.test(raw) || this.strongMarkers[lang]?.chars?.test(raw)) hits++;
        if (lang === 'pt' && /(?:^|[\s,;:!?.¡¿])e\s+(?!h?i)\p{L}/u.test(raw)) hits++;
        return hits;
    }

    /**
     * A capitalised word in the middle of a sentence is a name (a hotel, a plan, a city, a brand): «Hotel Aurora con
     * las vistas al mar», «Plan Aurora el sabado». A message built around a name is judged by the strict rules only.
     */
    private mentionsName(text: string): boolean {
        const words = (text || '').trim().split(/\s+/);
        for (let i = 1; i < words.length; i++) {
            const word = words[i].replace(/^[^\p{L}]+/u, '');
            if (!/^\p{Lu}/u.test(word) || /^I(?:['’]|$)/.test(word)) continue;
            if (/[.!?:¡¿]$/.test(words[i - 1]) || /^[¡¿]/.test(words[i])) continue;
            return true;
        }
        return false;
    }

    /**
     * The language of THIS message when it plainly is not the stored one. Production 2026-10-22: «a cuánto la noche en
     * su hotel?» and «me sangra mucho la encía, qué hago?» after an English chat, «dime el total de pedidos que tengo
     * registrados» after a Portuguese one and «e tem estacionamento?» after an English one were all answered in the
     * stored language: each carried one or two words of the new language and none of the old, and only a full sentence
     * with three pieces of evidence (or two request words) could switch.
     *
     * The current message wins when it has three or more words, no name in it, not a single sign of the stored language
     * (courtesy words included: «quiero ver el menu please» stays English), and evidence for one language with no
     * competitor: two pieces, or one in a message of four words or more. Courtesy words never count towards a switch;
     * «ok», «sí», «gracias», «muchas gracias», «what?» keep the stored language.
     */
    private currentMessageLanguage(previous: string | null, tokens: Set<string>, raw: string, text: string, wordCount: number): string | null {
        if (!previous || wordCount < 3 || this.mentionsName(text)) return null;
        if (this.languageEvidence(previous, tokens, raw, true) > 0) return null;
        const ranked = Object.keys(this.sentenceWords)
            .filter(lang => lang !== previous)
            .map(lang => [lang, this.languageEvidence(lang, tokens, raw, false)] as const)
            .sort((a, b) => b[1] - a[1]);
        const [best, evidence] = ranked[0];
        const rival = ranked[1]?.[1] ?? 0;
        if (rival === 0) return evidence >= 2 || (evidence >= 1 && wordCount >= 4) ? best : null;
        return evidence >= rival + 2 ? best : null;
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
     * The words that make a short message SAY something in one language: its verbs and interrogatives («tiene», «hay»,
     * «cuánto», «consúltalo»; «tem», «você», «quanto»; «coûte», «combien», «je»; «does», «have»). A message built of
     * nouns, names and courtesy words («Plan Aurora el sabado por favor», «Hotel Aurora con las vistas al mar») has
     * none, so it is never read as a switch. Words two of the languages share («funciona», «vale», «existe») are not here.
     */
    private readonly predicateWords: Record<string, string[]> = {
        es: ['tiene', 'tienen', 'tienes', 'tengo', 'tenemos', 'hay', 'cuesta', 'cuestan', 'cuanto', 'cuanta', 'cuantos', 'cuantas', 'puedo',
            'puede', 'puedes', 'pueden', 'quiero', 'quisiera', 'necesito', 'busco', 'debo', 'consultalo', 'consultala', 'consultalos',
            'consultame', 'revisalo', 'revisala', 'confirmalo', 'confirmala', 'confirmame', 'averigualo', 'dime', 'dame', 'mandame',
            'enviame', 'hago', 'estoy', 'incluye', 'incluyen', 'sirve', 'llega', 'quedan', 'hacen', 'aceptan', 'donde', 'cual',
            'cuales', 'cuando', 'quien', 'quienes', 'manejan', 'ofrecen', 'traen', 'esta', 'estan',
            // What a shop customer asks a business (production QA: «venden cargadores?» after a French case was answered in
            // French — no word of it was known). Not «vende»/«vender» (Portuguese spells them the same) nor «vale» (pt too).
            'venden', 'abren', 'cierran', 'atienden', 'reciben', 'envian', 'entregan', 'cobran', 'trabajan', 'sirven', 'preparan',
            'valen', 'llevan'],
        pt: ['tem', 'voce', 'voces', 'quanto', 'quanta', 'quantos', 'quantas', 'custa', 'custam', 'posso', 'pode', 'podem', 'quero',
            'preciso', 'gostaria', 'consegue', 'inclui', 'incluem', 'fica', 'ficam', 'estou', 'faz', 'fazem', 'procuro', 'devo', 'qual',
            'quais', 'aceitam', 'oferecem', 'esta', 'estao',
            'vendem', 'abrem', 'fecham', 'atendem', 'recebem', 'enviam', 'entregam', 'cobram', 'trabalham', 'servem', 'levam', 'trazem',
            // «sou» (I am): Spanish writes «soy», French «suis».
            'sou'],
        fr: ['coute', 'coutent', 'combien', 'je', 'est', 'sont', 'avez', 'pouvez', 'puis', 'peux', 'veux', 'voudrais', 'faut',
            'inclut', 'dois', 'doit', 'cherche', 'ai', 'reste', 'proposez', 'acceptez', 'quel', 'quelle', 'quels', 'quelles',
            'vendez', 'vendent', 'faites', 'ouvrez', 'fermez', 'livrez', 'envoyez', 'travaillez'],
        // Not «stock» (a loanword in Spanish and French: «hay stock?» is Spanish) nor «charge» (a French word too).
        en: ['is', 'are', 'does', 'have', 'has', 'can', 'could', 'would', 'how', 'what', 'cost', 'costs', 'need', 'want', 'include',
            'includes', 'should', 'where', 'when', 'which', 'offer', 'accept',
            'sell', 'sells', 'open', 'deliver', 'ship', 'make', 'carry'],
    };

    /**
     * Words of one language only that a short question often carries next to a name: months, «cupo», «personas».
     * They support a predicate word; on their own they decide nothing.
     */
    private readonly clearWords: Record<string, string[]> = {
        es: ['enero', 'febrero', 'marzo', 'mayo', 'junio', 'julio', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre',
            'cupo', 'cupos', 'personas', 'precio', 'precios'],
        pt: ['janeiro', 'fevereiro', 'maio', 'junho', 'julho', 'setembro', 'outubro', 'novembro', 'dezembro', 'vaga', 'vagas',
            'pessoas', 'preco', 'frete', 'na', 'nas', 'ao', 'sem'],
        fr: ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
            'garantie', 'semaine', 'samedi', 'dimanche', 'personnes', 'prix', 'il', 'ce'],
        en: ['january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
            'warranty', 'week', 'saturday', 'sunday', 'people', 'price', 'the', 'an', 'it', 'there', 'any'],
    };

    /**
     * Nouns and adjectives of ONE language that a short customer question carries when it has no verb: «haircut price?»,
     * «precio del corte?», «prix de la manucure ?». Production QA 2026-10-22: with «es» stored, «haircut price?» was
     * answered in Spanish because a message with no predicate word decided nothing. They decide a message only when no
     * language has a predicate in it, with two of them or one next to a function word of the same language, and no
     * evidence for any other language (see `contentLanguage`); a bare «price?» stays neutral.
     * Never here: names and catalogue terms (taken out before), and words two languages share — «hotel», «tour», «menu»,
     * «total», «disponible», «entrega» (es AND pt), «corte» (es AND pt «corte de cabelo»), «garantia», «reembolso»,
     * «pedido», «parking» (en AND fr). «stock» and «delivery» are English loanwords in Spanish and French: they count for
     * English only, and a single one never decides, so a Spanish message needs a second English word to read as English.
     */
    private readonly contentWords: Record<string, string[]> = {
        en: ['price', 'prices', 'pricing', 'haircut', 'haircuts', 'room', 'rooms', 'night', 'nights', 'stock', 'delivery', 'shipping',
            'available', 'dish', 'dishes', 'headphones', 'warranty', 'discount', 'refund', 'size', 'weekend', 'breakfast', 'appointment',
            // Shop and service nouns. Not «cases» (French «cases»), «desserts» (French too) nor «location» (French «location» = rental).
            'charger', 'chargers', 'speaker', 'speakers', 'makeup', 'rent'],
        es: ['precio', 'precios', 'habitacion', 'habitaciones', 'noche', 'noches', 'envio', 'envios', 'domicilio', 'descuento',
            'desayuno', 'talla', 'manicura', 'audifonos', 'existencias', 'cita',
            'cargador', 'cargadores', 'funda', 'fundas', 'parlante', 'parlantes', 'postre', 'postres', 'maquillaje', 'arriendo'],
        // Not «capas» nor «sobremesas»: Spanish spells them the same. «café da manhã» counts by its «manha» (and «da»).
        pt: ['preco', 'precos', 'quarto', 'quartos', 'noite', 'noites', 'frete', 'cabelo', 'desconto', 'tamanho', 'fones', 'estoque',
            'diaria', 'diarias',
            'carregador', 'carregadores', 'capinha', 'capinhas', 'manha', 'maquiagem', 'aluguel'],
        // «petit-déjeuner» splits into «petit» and «dejeuner». Not «desserts» (English too) nor «location» (English too).
        fr: ['prix', 'chambre', 'chambres', 'nuit', 'nuits', 'livraison', 'manucure', 'cheveux', 'remise', 'taille', 'remboursement',
            'dejeuner', 'casque', 'casques',
            'chargeur', 'chargeurs', 'coque', 'coques', 'ecouteurs', 'petit', 'maquillage', 'loyer'],
    };

    /**
     * Function words that count next to a content word only: Portuguese «do» (of the) is an English verb too, so it is no
     * evidence in a sentence, but in a message with no predicate («preço do Tour QA Aurora?») it cannot be the English «do».
     */
    private readonly contentFunctionWords: Record<string, string[]> = { pt: ['do'] };

    /**
     * The language of a short message with no predicate word, by its content words (see `contentWords`): two of one
     * language, or one plus a function word of the same language, and no word or character of any other language. A word
     * more than one language owns counts for nobody.
     */
    private contentLanguage(tokens: Set<string>, raw: string, vocabularies: Map<string, Set<string>>): string | null {
        const langs = Object.keys(this.contentWords);
        const owners = (token: string) => langs.filter(lang => vocabularies.get(lang)?.has(token)
            || this.contentWords[lang].includes(token) || (this.contentFunctionWords[lang] ?? []).includes(token));
        const evidence = new Map(langs.map(lang => [lang, { content: 0, function: 0 }]));
        for (const token of tokens) {
            const owned = owners(token);
            if (owned.length !== 1) continue;
            const entry = evidence.get(owned[0])!;
            if (this.contentWords[owned[0]].includes(token)) entry.content++;
            else entry.function++;
        }
        for (const lang of langs) if (this.clearCharacters[lang]?.test(raw)) evidence.get(lang)!.function++;
        const present = langs.filter(lang => evidence.get(lang)!.content + evidence.get(lang)!.function > 0);
        if (present.length !== 1) return null;
        const { content, function: functionWords } = evidence.get(present[0])!;
        return content >= 2 || (content >= 1 && functionWords >= 1) ? present[0] : null;
    }

    /** Accented words of ONE language, tested on the raw text: «sí» (pt «sim», fr «oui»), «há» (es «hay»), «você», «où». */
    private readonly clearCharacters: Record<string, RegExp> = {
        es: /(?<!\p{L})sí(?!\p{L})|[ñ¿¡]|(?<!\p{L})(?:qué|cómo|dónde|cuándo|cuánt[oa]s?|quién(?:es)?|cuál(?:es)?)(?!\p{L})/u,
        pt: /[ãõ]|(?<!\p{L})(?:há|é|você|vocês)(?!\p{L})/u,
        fr: /[èùœëîû]|(?<!\p{L})(?:ça|où)(?!\p{L})/u,
    };

    /**
     * The message with every name taken out: the catalogue names of the turn, a capitalised word in the middle of a
     * sentence («el Aurora», «el Tour QA Aurora»), a word in capitals («QA», «PDF») and figures. A name is how the
     * business wrote it, not the customer's language — but the words AROUND it are.
     */
    nameFreeText(text: string, names: readonly string[] = []): string {
        let out = String(text || '');
        const known = [...new Set(names.map(name => String(name || '').trim()).filter(name => name.length >= 3))]
            .sort((a, b) => b.length - a.length);
        for (const name of known) out = out.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), ' ');
        const words = out.trim().split(/\s+/).filter(Boolean);
        const kept: string[] = [];
        for (let i = 0; i < words.length; i++) {
            const word = words[i].replace(/^[^\p{L}\d]+/u, '');
            const letters = word.replace(/[^\p{L}]/gu, '');
            if (/\d/.test(word) && letters.length <= 2) continue;
            if (letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) continue;
            const sentenceStart = i === 0 || /[.!?:¡¿]$/.test(words[i - 1]) || /^[¡¿]/.test(words[i]);
            if (!sentenceStart && /^\p{Lu}/u.test(word) && !/^I(?:['’]|$)/.test(word)) continue;
            kept.push(words[i]);
        }
        return kept.join(' ');
    }

    /**
     * The language of the message by its own words once names are taken out, or null when it cannot be told.
     * It needs a predicate word (a verb or an interrogative, see `predicateWords`), two pieces of evidence or two words,
     * and not a single sign of any other language. «el Aurora tiene garantía?», «hay cupo en el Tour QA Aurora el 15 de
     * noviembre para 2?» and «Sí, por favor consúltalo.» are Spanish whatever the stored language (production
     * 2026-10-22: answered in French and in Portuguese). «Aurora», «ok», «15», «👍», «gracias», «el Want Pack» and
     * «Plan Aurora el sabado por favor» carry no predicate and decide nothing.
     */
    clearLanguageOf(text: string, names: readonly string[] = []): string | null {
        const free = this.nameFreeText(text, names);
        const normalized = this.normalize(free);
        if (!normalized) return null;
        const words = normalized.split(/\s+/).filter(token => /[a-z]/.test(token));
        const tokens = new Set(words);
        for (const t of [...tokens]) if (t.includes("'")) for (const part of t.split("'")) if (part) tokens.add(part);
        const raw = free.normalize('NFC').toLowerCase();
        const vocabularies = new Map(Object.keys(this.predicateWords).map(lang => [lang, new Set([...(this.markers[lang] ?? []),
            ...(this.sentenceWords[lang] ?? []), ...(this.strongMarkers[lang]?.words ?? []), ...(this.questionWords[lang] ?? []),
            ...this.predicateWords[lang], ...(this.clearWords[lang] ?? [])])] as const));
        // A word two of the languages spell the same way («disponible» is Spanish AND French, «está» Spanish AND
        // Portuguese) is evidence for neither. Production (store, stored «es»): «le Aurora est disponible ?» was answered in
        // Spanish because «disponible» counted as a Spanish word next to the French «le» and «est», and a rival with any
        // evidence makes the message undecided. It still says the message HAS a verb, for each language that owns it.
        const shared = (token: string) => [...vocabularies.values()].filter(vocabulary => vocabulary.has(token)).length > 1;
        const ranked = Object.keys(this.predicateWords).map(lang => {
            const vocabulary = vocabularies.get(lang)!;
            let hits = 0;
            let predicates = 0;
            let verbs = 0;
            for (const token of tokens) {
                if (vocabulary.has(token) && !shared(token)) hits++;
                if (this.predicateWords[lang].includes(token)) {
                    predicates++;
                    if (!this.interrogatives.has(token)) verbs++;
                }
            }
            if (this.clearCharacters[lang]?.test(raw)) hits++;
            // «há» (there is) and a standalone «é» (is) are Portuguese verbs none of the other three languages writes: «o prato
            // Spark é sem glúten? sou celíaca» (stored «es») had no other predicate and was answered, the fixed allergen
            // text included, in Spanish.
            if (lang === 'pt' && /(?<!\p{L})(?:há|é)(?!\p{L})/u.test(raw)) { predicates++; verbs++; }
            return { lang, hits, predicates, verbs };
        }).sort((a, b) => b.hits - a.hits);
        const [best, second] = ranked;
        // No verb or interrogative in any language: only content words of one language can tell it («haircut price?»).
        if (ranked.every(entry => entry.predicates === 0)) return this.contentLanguage(tokens, raw, vocabularies);
        if (best.hits === 0 || second.hits > 0 || best.predicates === 0) return null;
        if (best.hits >= 2) return best.lang;
        // ONE word of evidence: it must be a verb («tiene garantía?»), in a message of two words that are not a bare
        // acknowledgement. A lone interrogative is as often a borrowed word: «ok what», «cual», «how?» decide nothing.
        const content = words.filter(word => !this.acknowledgements.has(word));
        return best.verbs > 0 && content.length >= 2 ? best.lang : null;
    }

    /** Interrogatives of the predicate lists: evidence, but never enough on their own. */
    private readonly interrogatives = new Set(['cuanto', 'cuanta', 'cuantos', 'cuantas', 'donde', 'cual', 'cuales', 'cuando', 'quien', 'quienes',
        'quanto', 'quanta', 'quantos', 'quantas', 'qual', 'quais', 'combien', 'quel', 'quelle', 'quels', 'quelles', 'how', 'what', 'where',
        'when', 'which']);

    /** Acknowledgements that carry no language: «ok», «okay», «vale». */
    private readonly acknowledgements = new Set(['ok', 'okay', 'oki', 'okey', 'k', 'vale', 'dale', 'listo', 'perfect', 'perfecto', 'perfeito', 'parfait', 'super', 'cool']);

    /**
     * The language the customer was writing in: the newest of their recent messages whose own words tell it. It
     * replaces a stored language that lagged behind them (a Spanish message the detector once missed left «fr» stored,
     * and «Sí, por favor» was answered in French).
     */
    private recentCustomerLanguage(messages: readonly string[] | undefined, names: readonly string[]): string | null {
        for (const message of [...(messages ?? [])].reverse().slice(0, 5)) {
            const language = this.strongLanguageOf(message) ?? this.clearLanguageOf(message, names);
            if (language) return language;
        }
        return null;
    }

    /** The language the marker words alone decide, with no stored language to lean on. */
    private strongLanguageOf(text: string): string | null {
        const normalized = this.normalize(text || '');
        if (normalized.length < 3) return null;
        const tokens = new Set(normalized.split(/\s+/).filter(Boolean));
        const raw = (text || '').normalize('NFC').toLowerCase();
        const ranked = Object.entries(this.markers).map(([lang, words]) =>
            [lang, words.filter(word => tokens.has(word)).length + (this.diacritics[lang]?.test(raw) ? 1 : 0)] as const)
            .sort((a, b) => b[1] - a[1]);
        const margin = ranked[0][1] - (ranked[1]?.[1] ?? 0);
        return (ranked[0][1] >= 2 && margin >= 2) || (ranked[0][1] >= 3 && margin >= 1) ? ranked[0][0] : null;
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
        // An accented interrogative («qué», «cómo», «dónde», «cuánto»…) is Spanish only: Portuguese writes «quê», «como»,
        // «onde», «quanto» and French none of them. Typed with its accent it marks a Spanish question that a loanword
        // («qué debo llevar al tour?») would otherwise leave to the stored language.
        es: /[ñ¿¡]|(?<!\p{L})(?:qué|cómo|dónde|cuándo|cuánt[oa]s?|quién(?:es)?|cuál(?:es)?)(?!\p{L})/u,
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
    detect(text: string, fallback: string, previous?: string | null, context?: LanguageDetectionContext): string {
        return this.detectDetailed(text, fallback, previous, context).language;
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
    detectDetailed(text: string, fallback: string, previous?: string | null, context?: LanguageDetectionContext): { language: string; persist: boolean } {
        const names = context?.names ?? [];
        // The customer's own recent messages outrank a stored language that lagged behind them.
        const recent = this.recentCustomerLanguage(context?.recentCustomerMessages, names);
        if (recent && recent !== (previous ? this.short(previous) : null)) {
            previous = recent;
            fallback = recent;
        }
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
        // Clear words of ONE language around the names of the message («el Aurora tiene garantía?») decide the turn,
        // whatever language is stored. Only a message that says nothing in any language keeps the stored one.
        const clear = this.clearLanguageOf(text, names);
        if (clear) return { language: clear, persist: !!prev };
        const wordCount = normalized.split(/\s+/).filter(Boolean).length;
        const sentenceLanguage = this.fullSentenceLanguage(prev, tokens, raw, wordCount, scores);
        if (sentenceLanguage) return { language: sentenceLanguage, persist: true };
        const currentLanguage = this.currentMessageLanguage(prev, tokens, raw, text, wordCount);
        if (currentLanguage) return { language: currentLanguage, persist: true };
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
