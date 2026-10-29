import { Injectable } from '@nestjs/common';
import { withoutLoanwords } from './language-loanwords';

/**
 * The «y» of the French «il y a» / «il n'y a» / «qu'il y a» / «y a-t-il» (there is) is no Spanish «y» (and).
 * Production QA 25-oct (image 0330ef7a): «qu'est-ce qu'il y a au menu ?» after a Spanish case was answered in Spanish —
 * its «y» was a Spanish word, so the message showed a sign of the stored language and a Spanish rival to every French word.
 */
const FRENCH_THERE_IS_Y = /(?<=(?<!\p{L})(?:il\s+|n['’]\s*))y(?=\s+(?:a|avait|aura|aurait|en)(?!\p{L}))|(?<!\p{L})y(?=\s+(?:a|avait|aura)-t-)/giu;

/** The text the detector scores: loanwords out, and the «y» of «il y a» out. */
function scoredText(text: string): string {
    return withoutLoanwords(text).replace(FRENCH_THERE_IS_Y, ' ');
}

/** Lowercase words that join the words of a business name («Color y tratamiento», «Corte e escova»): part of the name. */
const NAME_JOINERS = new Set(['y', 'e', 'et', 'and', '&']);

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
/** An elided article or pronoun before a word («d’Audífono», «l’hôtel»): written in French only, of the four languages. */
const FRENCH_ELISION = /(?<!\p{L})(?:l|d|qu|j|n|c|s|m|t)['’](?=\p{L})/u;

/** What the turn knows beyond the message: the catalogue names in play and the customer's recent messages (oldest first). */
export interface LanguageDetectionContext {
    names?: readonly string[];
    recentCustomerMessages?: readonly string[];
    /** The tenant's configured language: it breaks a tie between two languages a message may be in («hora de entrada?»). */
    preferred?: string | null;
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
        pt: ['nao', 'obrigado', 'obrigada', 'voce', 'voces', 'preciso', 'isso', 'tambem', 'entao', 'ola', 'sim', 'quero', 'gostaria', 'muito', 'quanto', 'custa', 'tudo', 'bom', 'uma', 'qual', 'quais', 'procuro', 'meu', 'minha', 'pessoas', 'funcionamento', 'tem', 'preco', 'precos',
            // F4300-16 (production QA 28-oct): «oi, somos um grupo de 12 amigos», «com 30.000 pesos, dá para dois pratos Spark?», «qto
            // custa…», «o audifono tem fio?» were read as Spanish (or as the stored English). Portuguese spellings no other language uses.
            'oi', 'dois', 'duas', 'qto', 'qtos', 'qta', 'qtas', 'quantos', 'quantas', 'prato', 'pratos', 'fio', 'estao', 'ate', 'eu', 'cabem'],
        fr: ['bonjour', 'bonsoir', 'merci', 'vous', 'nous', 'veux', 'besoin', 'comment', 'aussi', "c'est", 'oui', 'est', 'sont', 'avec', 'pourquoi', 'voudrais', 'combien', 'salut', 'je', 'quel', 'quels', 'quelle', 'quelles', 'horaires', 'votre', 'pour', 'avez', 'une', 'dans', 'cherche', 'acheter', 'jusqu', 'prix', 'fil', 'filaire', 'il', 'elle'],
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
        // Not «consulta»: Spanish spells it the same («qué consulta me recomiendan…?» after a Portuguese case was read as a
        // sign of Portuguese and kept it, production QA 24-oct).
        pt: { words: ['quero', 'gostaria', 'preciso', 'procuro', 'quanto', 'custa', 'voce', 'voces', 'nao', 'agendar', 'marcar', 'reservar', 'disponivel'], chars: /[ãõ]/ },
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
            'y', 'su', 'mi', 'lo', 'ya', 'eso', 'esto', 'mucho', 'mucha', 'muchos', 'muchas', 'hago', 'dime', 'dejas', 'puedes', 'puede', 'pueden', 'quieres', 'ayer', 'hoy', 'manana', 'tiempo', 'noche', 'noches',
            // F4300-16f: quantifiers of a short question (pt «algum/alguma», fr «quelque», en «any»). Not «algo»: Portuguese too.
            'alguna', 'alguno', 'algun', 'algunas', 'algunos',
            // «hola, sigue alguien ahí?» (production QA 29-oct): pt «alguém/aí/ninguém», fr «quelqu'un/là/personne».
            'alguien', 'ahi', 'nadie'],
        en: ['the', 'is', 'are', 'was', 'of', 'to', 'in', 'it', 'my', 'with', 'this', 'that', 'for', 'and', 'you', 'your', 'have', 'has', 'be', 'can', 'will', 'about', 'from', 'what', 'how', 'does', 'not', 'want', 'need',
            'much', 'many', 'night', 'there', 'any',
            // F4300-16f: the time and quantity words a short question carries («any promotions today?»).
            'anything', 'something', 'today', 'tonight', 'tomorrow', 'kids', 'less', 'cheaper'],
        // Not «dos»: it is Portuguese «of the» AND Spanish «two» («me los dejas a 100 mil los dos»).
        pt: ['os', 'uma', 'da', 'das', 'com', 'nao', 'voce', 'voces', 'tem', 'estou', 'meu', 'minha', 'pra', 'quero', 'preciso', 'gostaria', 'tambem',
            'muito', 'muita', 'seu', 'sua', 'isso', 'isto', 'hoje', 'ontem', 'noite', 'faco', 'pode', 'tempo', 'amanha',
            'alguma', 'algum', 'algumas', 'alguns',
            // F4300-16 (production QA 28-oct): see the markers.
            'oi', 'uns', 'umas', 'dois', 'duas', 'eu', 'qto', 'qtos', 'qtas', 'quantos', 'quantas', 'num', 'numa', 'criancas', 'crianca'],
        fr: ['le', 'les', 'des', 'du', 'une', 'est', 'sont', 'avec', 'dans', 'pour', 'vous', 'nous', 'je', 'mon', 'ma', 'mes', 'pas', 'veux', 'besoin', 'voudrais',
            // «et» (and) and everyday French that Spanish, Portuguese and English spell differently.
            'et', 'mais', 'temps', 'demain', 'nuit', 'aujourd', 'quelque', 'quelques'],
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
            // F4300-16 (production QA 28-oct): an order or booking code («was my order 5603A623 delivery or pickup?») is not a name —
            // it held the stored Spanish and the English question was answered in Spanish.
            if (/\d/.test(words[i])) continue;
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
        // F4300-16 (production QA 28-oct): «hola, soy vegetariana» after a French case and «hi, I am vegetarian» after a Spanish one kept
        // the stored language — a self-introduction had no verb of either. pt «sou» was there already; fr «suis» too via «je».
        // «hola, sigue alguien ahí?» after a French case was answered in French (production QA 29-oct, RET qa03): pt «segue», fr «suit».
        es: ['soy', 'sigue', 'siguen', 'tiene', 'tienen', 'tienes', 'tengo', 'tenemos', 'hay', 'cuesta', 'cuestan', 'cuanto', 'cuanta', 'cuantos', 'cuantas', 'puedo',
            'puede', 'puedes', 'pueden', 'quiero', 'quisiera', 'necesito', 'busco', 'debo', 'consultalo', 'consultala', 'consultalos',
            'consultame', 'revisalo', 'revisala', 'confirmalo', 'confirmala', 'confirmame', 'averigualo', 'dime', 'dame', 'mandame',
            'enviame', 'hago', 'estoy', 'incluye', 'incluyen', 'sirve', 'llega', 'quedan', 'hacen', 'aceptan', 'donde', 'cual',
            'cuales', 'cuando', 'quien', 'quienes', 'manejan', 'ofrecen', 'traen', 'esta', 'estan',
            // What a shop customer asks a business (production QA: «venden cargadores?» after a French case was answered in
            // French — no word of it was known). Not «vende»/«vender» (Portuguese spells them the same) nor «vale» (pt too).
            'venden', 'abren', 'cierran', 'atienden', 'reciben', 'envian', 'entregan', 'cobran', 'trabajan', 'sirven', 'preparan',
            'valen', 'llevan',
            // What a product or a dish is or holds (production QA 23/24-oct: «el audífono Aurora trae estuche?» after a Portuguese
            // case and «de qué color es el audífono Aurora?» after an English one were answered in the previous language).
            // Not «lleva» (Portuguese «leva» is another word, but «sale» and «come» are English words).
            'es', 'trae', 'contiene', 'contienen', 'viene', 'vienen', 'lleva',
            // Advice a customer asks for: the «ie» of these stems is Spanish only (pt «recomenda», «sugere», fr «recommande»).
            'recomiendan', 'recomienda', 'recomiendas', 'recomiendo', 'sugieren', 'sugiere', 'sugieres', 'aconsejan', 'aconseja',
            // The imperatives of a request (production QA 25-oct, image fab82f84: «háblame del Audífono QA Aurora» after a Portuguese case
            // was answered in Portuguese — once the name is out only «del» was left). Pronoun-attached forms are Spanish only (pt «fala»,
            // «conta», «diz», «mostra»; fr «parlez», «dites»).
            'hablame', 'hableme', 'hablenme', 'cuentame', 'cuenteme', 'cuentenme', 'dime', 'digame', 'diganme', 'muestrame', 'muestreme',
            'muestrenme', 'explicame', 'expliqueme', 'describeme', 'describame', 'ensename', 'ensenenme', 'recomiendame', 'recomiendeme',
            // F4300-16f: «¿abierto mañana?». Portuguese writes «aberto», French «ouvert».
            'abierto', 'abierta', 'abiertos', 'abiertas',
            // F4300-16g (production QA 25-oct, image c9db6219): «ponen implantes dentales?» after an English case was answered in
            // English twice — no word of it was known. Portuguese writes «põem», «fazemos», «ficam»/«restam», French «mettez».
            'ponen', 'pones', 'ponemos', 'pongo', 'hacemos', 'haces', 'hace', 'quedaba', 'quedaban', 'quedamos'],
        pt: ['tem', 'voce', 'voces', 'quanto', 'quanta', 'quantos', 'quantas', 'custa', 'custam', 'posso', 'pode', 'podem', 'quero',
            'preciso', 'gostaria', 'consegue', 'inclui', 'incluem', 'fica', 'ficam', 'estou', 'faz', 'fazem', 'procuro', 'devo', 'qual',
            'quais', 'aceitam', 'oferecem', 'esta', 'estao',
            'vendem', 'abrem', 'fecham', 'atendem', 'recebem', 'enviam', 'entregam', 'cobram', 'trabalham', 'servem', 'levam', 'trazem',
            // «sou» (I am): Spanish writes «soy», French «suis».
            'sou',
            'traz', 'contem', 'vem',
            // F4300-16 (production 24-oct): «quando sai o Spark QA Tour?» and «quantos pedidos eu já fiz aí?» were answered in the
            // previous case's language. Spanish writes «cuando», «sale», «hice», «hizo»; French «quand», «sort», «fait».
            'quando', 'sai', 'saem', 'fiz', 'fez', 'fizemos',
            // Production QA 25-oct (image 0330ef7a): «me fala mais sobre o Spark QA Inmueble» was answered in Spanish — no word of
            // it was known. Spanish says «háblame», «cuéntame», «dime», «muéstrame»; French «parlez», «racontez», «dites».
            'fala', 'falam', 'falar', 'conta', 'contam', 'contar', 'diz', 'dizem', 'mostra', 'mostram',
            // F4300-16f: «aberto amanhã?». Spanish writes «abierto», «disponible».
            'aberto', 'aberta', 'abertos', 'abertas', 'disponivel', 'disponiveis',
            // F4300-16 (production QA 26-oct): Portuguese typed the way customers type, «onde fika o spark qa inmueble» and «qto dura a
            // consulta geral», after a Spanish case was answered in Spanish. Spanish writes «donde»/«cuánto», French «où»/«combien».
            'onde', 'qto', 'qta', 'qtos', 'qtas', 'oq',
            // «o Tour QA Aurora aceita um grupo de 10?» after an English case was answered in English (production QA 26-oct, image
            // 6f1d3bf6). Spanish writes «acepta», French «accepte».
            'aceita', 'aceitas', 'pagam', 'pagamos',
            // F4300-16 (production QA 28-oct): «se formos 4, quanto pagamos pelo Spark QA Tour?» after an English case was answered in
            // English. Spanish writes «fuéramos»/«fuimos», French «sommes».
            'formos', 'fomos'],
        fr: ['paient', 'payez', 'coute', 'coutent', 'combien', 'je', 'est', 'sont', 'avez', 'pouvez', 'puis', 'peux', 'veux', 'voudrais', 'faut',
            'inclut', 'dois', 'doit', 'cherche', 'ai', 'reste', 'proposez', 'acceptez', 'quel', 'quelle', 'quels', 'quelles',
            'vendez', 'vendent', 'faites', 'ouvrez', 'fermez', 'livrez', 'envoyez', 'travaillez',
            // «le plat Spark contient-il du soja ?» (production QA, answered in Spanish after a Spanish case).
            'contient', 'contiennent', 'comprend', 'vient',
            // «parlez-moi du Spark QA Inmueble» (production QA 25-oct: answered in Spanish, no word of it was known).
            'parlez', 'parle', 'racontez', 'raconte', 'dites', 'montrez', 'expliquez', 'explique', 'donnez', 'conseillez', 'recommandez',
            // F4300-16f: «ouvert demain ?». Not «disponible» (Spanish too).
            'ouvert', 'ouverte', 'ouverts', 'ouvertes'],
        // Not «stock» (a loanword in Spanish and French: «hay stock?» is Spanish) nor «charge» (a French word too).
        // F4300-16 (production QA 29-oct): «do kids pay less?» after a French case was answered in French, «crianças pagam menos?» after
        // an English one in English — a short question whose only verb is «pay».
        en: ['pay', 'pays', 'deliver', 'am', 'is', 'are', 'does', 'have', 'has', 'can', 'could', 'would', 'how', 'what', 'cost', 'costs', 'need', 'want', 'include',
            'includes', 'should', 'where', 'when', 'which', 'offer', 'accept',
            'sell', 'sells', 'open', 'deliver', 'ship', 'make', 'carry', 'contain', 'contains',
            // The imperatives of a request (production QA 24-oct: «tell me about the Aurora tour» after a Spanish case was
            // answered in Spanish — once the name is out, «about» and «the» were evidence but nothing was a verb). Not «show»
            // («el show»), «describe» (Spanish «describe»), «send» nor «give» («please send it» keeps the stored language).
            'tell', 'explain', 'recommend',
            // F4300-16f (production QA 25-oct): the adjective is the predicate of a question with no verb («parking available?»,
            // «open tomorrow?»). Spanish writes «abierto»/«disponible», Portuguese «aberto»/«disponível», French «ouvert».
            'available'],
    };

    /**
     * Constructions that are a verb or a question of ONE language whatever the words around them, tested on the message
     * with names taken out. Production QA 23/24-oct (one test customer whose history spans cases): «o que está incluído no
     * Spark QA Tour?» was answered in French, «me mandas dos del plato Spark?» in English and «le plat Spark contient-il du
     * soja ?» in Spanish — each word of them is shared («o», «que», «está», «no», «me», «dos») or unknown, but the
     * construction is not:
     *  - pt «o que» (Spanish says «qué» / «lo que», French «ce que») and «-uído» (Spanish writes «incluido», «construido»);
     *  - es a message opening with «me/te» and a «tú» verb («me mandas», «me pasas», «te puedo»… Portuguese says «me manda»);
     *  - fr the inverted subject of a question («contient-il», «avez-vous», «est-ce que»).
     * Each counts as one word of evidence AND as a verb of its language.
     */
    private readonly predicatePatterns: Record<string, RegExp[]> = {
        pt: [/(?<!\p{L})o que(?!\p{L})/u, /uíd[oa]s?(?!\p{L})/u],
        // A clitic before an «ustedes» verb anywhere in the message («qué consulta me recomiendan…?», «nos envían…»):
        // Portuguese writes «me recomendam» / «nos enviam», French and English put no -an/-en verb there.
        es: [/^[\s¿¡"'«]*(?:me|te)\s+\p{L}{2,}(?:as|es)(?!\p{L})/u, /(?<!\p{L})(?:me|te|nos|les?)\s+\p{L}{3,}(?:an|en)(?!\p{L})/u],
        // An English request or question frame: «tell me about…», «what is…», «how much…», «what's…».
        en: [/(?<!\p{L})(?:tell|show|give|send)\s+(?:me|us)(?!\p{L})/u, /(?<!\p{L})(?:what|how|where|which|who)(?:['’]s|\s+(?:is|are|was|much|many|long|does|do|can))(?!\p{L})/u],
        // F4300-16g: «j'ai réservé un tour ?» (production QA 25-oct, answered in English): the elided «j'» (I) before a verb is
        // French only — Spanish, Portuguese and English never elide a «j».
        fr: [/\p{L}-(?:t-)?(?:il|elle|ils|elles|on|vous|nous|je|tu)(?!\p{L})/u, /(?<!\p{L})est-ce(?!\p{L})/u, /(?<!\p{L})j['’]\p{L}/u],
    };

    /**
     * Words of one language only that a short question often carries next to a name: months, «cupo», «personas».
     * They support a predicate word; on their own they decide nothing.
     */
    private readonly clearWords: Record<string, string[]> = {
        es: ['enero', 'febrero', 'marzo', 'mayo', 'junio', 'julio', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre',
            'cupo', 'cupos', 'personas', 'precio', 'precios',
            // Portuguese «melhor(es)», French «meilleur»: «qué consulta es mejor…?».
            'mejor', 'mejores'],
        pt: ['janeiro', 'fevereiro', 'maio', 'junho', 'julho', 'setembro', 'outubro', 'novembro', 'dezembro', 'vaga', 'vagas',
            'pessoas', 'preco', 'frete', 'na', 'nas', 'ao', 'sem',
            // F4300-16g: «quanto fica dois pratos Spark?». Spanish writes «platos», «dos»; French «plats», «deux».
            'prato', 'pratos', 'duas',
            // Spanish «general», French «général».
            'geral'],
        fr: ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
            'garantie', 'semaine', 'samedi', 'dimanche', 'personnes', 'prix', 'il', 'ce',
            // «parlez-moi…», «vous avez quoi à manger ?», «qu'est-ce qu'il y a…»: Spanish «mí/qué», Portuguese «mim/quê».
            'moi', 'toi', 'quoi', 'qu', 'manger'],
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
     * «pedido», «parking» (en AND fr). «stock» is an English loanword in Spanish and French: it counts for English only,
     * and a single one never decides, so a Spanish message needs a second English word to read as English. «delivery»,
     * «check-in», «tour», «wifi»… are taken out of the message before anything is scored (see language-loanwords.ts).
     */
    private readonly contentWords: Record<string, string[]> = {
        en: ['price', 'prices', 'pricing', 'haircut', 'haircuts', 'room', 'rooms', 'night', 'nights', 'stock', 'shipping',
            'available', 'dish', 'dishes', 'headphones', 'warranty', 'discount', 'refund', 'size', 'weekend', 'breakfast', 'appointment',
            // Shop and service nouns. Not «cases» (French «cases»), «desserts» (French too) nor «location» (French «location» = rental).
            'charger', 'chargers', 'speaker', 'speakers', 'makeup', 'rent',
            // F4300-16f: what a short restaurant question asks for, and its time and quantity words, which count as content
            // here so «any promotions today?» decides by two of them. Not «promotion(s)» (French too) nor «vegan» (French «végan»).
            'vegetarian', 'vegetarians', 'any', 'anything', 'something', 'today', 'tonight', 'tomorrow'],
        es: ['precio', 'precios', 'habitacion', 'habitaciones', 'noche', 'noches', 'envio', 'envios', 'domicilio', 'descuento',
            'desayuno', 'talla', 'manicura', 'audifonos', 'existencias', 'cita',
            'cargador', 'cargadores', 'funda', 'fundas', 'parlante', 'parlantes', 'postre', 'postres', 'maquillaje', 'arriendo',
            // Not «algo» nor «vegetariano» (Portuguese too).
            'promocion', 'promociones', 'alguna', 'alguno', 'algun', 'algunas', 'algunos', 'hoy', 'manana'],
        // Not «capas» nor «sobremesas»: Spanish spells them the same. «café da manhã» counts by its «manha» (and «da»).
        pt: ['preco', 'precos', 'quarto', 'quartos', 'noite', 'noites', 'frete', 'cabelo', 'desconto', 'tamanho', 'fones', 'estoque',
            'diaria', 'diarias',
            'carregador', 'carregadores', 'capinha', 'capinhas', 'manha', 'maquiagem', 'aluguel',
            // «o que tem no cardápio hoje?»: Spanish «carta» / «menú», French «carte».
            'cardapio', 'cardapios',
            'promocao', 'promocoes', 'prato', 'pratos', 'alguma', 'algum', 'algumas', 'alguns', 'hoje', 'amanha'],
        // «petit-déjeuner» splits into «petit» and «dejeuner». Not «desserts» (English too) nor «location» (English too).
        fr: ['prix', 'chambre', 'chambres', 'nuit', 'nuits', 'livraison', 'manucure', 'cheveux', 'remise', 'taille', 'remboursement',
            'dejeuner', 'casque', 'casques',
            'chargeur', 'chargeurs', 'coque', 'coques', 'ecouteurs', 'petit', 'maquillage', 'loyer',
            'vegetarien', 'vegetarienne', 'vegetariens', 'vegetariennes', 'chose', 'quelque', 'quelques', 'aujourd', 'demain'],
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
        // «-ión» / «-iones» (revisión, información): Portuguese writes «-ão» / «-ões», French and English no accent.
        es: /(?<!\p{L})sí(?!\p{L})|[ñ¿¡]|(?<!\p{L})(?:qué|cómo|dónde|cuándo|cuánt[oa]s?|quién(?:es)?|cuál(?:es)?)(?!\p{L})|\p{L}{2,}ión(?!\p{L})|\p{L}{2,}iones(?!\p{L})/u,
        // «-ário(s)» / «-ária(s)» (horário, salário) and «-ência» / «-ância»: Spanish writes «horario», «-encia», French
        // «horaire», «-ence». «já» (es «ya»), «aí» (es «ahí», fr «là»), «lá» (es «allá»).
        pt: /[ãõ]|(?<!\p{L})(?:há|é|você|vocês|já|aí|lá)(?!\p{L})|\p{L}ári[oa]s?(?!\p{L})|\p{L}[êâ]nci[oa]s?(?!\p{L})/u,
        fr: /[èùœëîû]|(?<!\p{L})(?:ça|où)(?!\p{L})/u,
    };

    /**
     * Everyday words two or three of the four languages spell the same way (accents aside), with the languages that own
     * them. Alone they tell nothing, but a message made of them still RULES OUT the languages that never write them:
     * «hora de entrada?» is Spanish or Portuguese, never English; «precio de la consulta especializada?» is Spanish
     * («precio»), never French. They override the single-language lists for the same word («van», «son» are English too).
     */
    private readonly sharedWords: Record<string, readonly string[]> = {
        de: ['es', 'pt', 'fr'], que: ['es', 'pt', 'fr'], a: ['es', 'pt', 'fr'], se: ['es', 'pt', 'fr'], te: ['es', 'pt', 'fr'],
        me: ['es', 'pt', 'fr', 'en'], no: ['es', 'pt', 'en'], la: ['es', 'fr'], en: ['es', 'fr'], o: ['es', 'pt'], por: ['es', 'pt'],
        para: ['es', 'pt'], mas: ['es', 'pt'], mais: ['pt', 'fr'], eu: ['pt', 'fr'], ai: ['pt', 'fr'], van: ['es', 'en'], son: ['es', 'en'],
        hora: ['es', 'pt'], horas: ['es', 'pt'], horario: ['es', 'pt'], horarios: ['es', 'pt'], entrada: ['es', 'pt'], sabado: ['es', 'pt'],
        domingo: ['es', 'pt'], consulta: ['es', 'pt'], consultas: ['es', 'pt'], especializada: ['es', 'pt'], especializado: ['es', 'pt'],
        general: ['es', 'pt'], barato: ['es', 'pt'], barata: ['es', 'pt'], caro: ['es', 'pt'], cara: ['es', 'pt', 'fr'], pedido: ['es', 'pt'],
        pedidos: ['es', 'pt'], reserva: ['es', 'pt'], esta: ['es', 'pt'], este: ['es', 'pt'], ja: ['pt'], prato: ['pt'], pratos: ['pt'],
        plato: ['es'], platos: ['es'], saida: ['pt'], salida: ['es'],
        // F4300-16 residual (production 24-oct): «qual o valor do Spark QA Inmueble?». «valor» is Spanish AND Portuguese (French
        // «valeur», English «value»); «do» is Portuguese «of the» AND the English verb, never Spanish or French.
        valor: ['es', 'pt'], valores: ['es', 'pt'], do: ['pt', 'en'],
        // «me fala mais sobre o…», «háblame sobre el…»: Spanish AND Portuguese (French «sur», English «about»).
        sobre: ['es', 'pt'],
        // F4300-16f: «algo vegetariano?» is Spanish or Portuguese; «promotions» is English or French.
        algo: ['es', 'pt'], vegetariano: ['es', 'pt'], vegetariana: ['es', 'pt'], vegetarianos: ['es', 'pt'], vegetarianas: ['es', 'pt'],
        promotion: ['en', 'fr'], promotions: ['en', 'fr'],
        // F4300-16g (production QA 25-oct): «quanto fica dois pratos Spark?» after an English case was answered in English —
        // «dois» is Portuguese «two» AND French «(je) dois», so it was French evidence next to «quanto fica». And «cuántos
        // Audífono QA Aurora les quedan?» after a French case was answered in French: «les»/«le» are French articles AND the
        // Spanish dative pronouns («les quedan», «le queda»).
        dois: ['pt', 'fr'], les: ['es', 'fr'], le: ['es', 'fr'],
    };

    /**
     * The time and quantity words of a short question with no verb («algo vegetariano?», «any … today?»): with one of them,
     * two known words are enough for `languageExcludingStored` to rule the stored language out.
     */
    private readonly quantityAndTimeWords = new Set(['algo', 'alguna', 'alguno', 'algun', 'algunas', 'algunos', 'hoy', 'manana',
        'alguma', 'algum', 'algumas', 'alguns', 'hoje', 'amanha', 'quelque', 'quelques', 'aujourd', 'demain', 'any', 'anything',
        'something', 'today', 'tonight', 'tomorrow']);

    /** The languages that write `token`: the shared table first, else every single-language list that holds it. */
    private ownersOf(token: string): readonly string[] {
        if (this.sharedWords[token]) return this.sharedWords[token];
        const lists = [this.markers, this.sentenceWords, this.questionWords, this.predicateWords, this.clearWords, this.contentWords, this.weakMarkers];
        return Object.keys(this.predicateWords).filter(lang =>
            lists.some(list => list[lang]?.includes(token)) || !!this.strongMarkers[lang]?.words.includes(token));
    }

    /**
     * F4300-16 (production 24-oct, image 7f375dd8): the language of a message every word of which the STORED language
     * never writes, even when no word of it is unique to one language. One test customer ran many cases in one
     * conversation and «precio de la consulta especializada?» (after French), «qual o prato mais barato?» and
     * «hora de entrada?» (after English), «horário de sábado?» (after Spanish) were answered in the previous language:
     * «de», «la», «mais», «hora», «entrada» are each shared, so no rule found ONE language, and the stored one stayed.
     *
     * Each known word (and each accent of one language) narrows the languages the message can be in; unknown words narrow
     * nothing. The message decides when three or more non-courtesy words are known, the languages left are not empty and
     * the stored language is not among them. Among two left, the tenant's language wins, then es, pt, fr, en. Anything
     * shorter keeps the stored language: «ok», «gracias», «uma consulta», «consulta general».
     *
     * Names are taken out first and never count. F4300-16 residual (production 24-oct, image b168adb0): «qual o valor do
     * Spark QA Inmueble?» after a French case was answered in French because a message with a capitalised name in it was
     * set aside altogether, and listing and product names are in most sales questions. A message around a name decides
     * only when the words left carry a verb or a question word of a remaining language («qual», «is», «est», «es»): a noun
     * phrase around a name («Hotel Aurora con las vistas al mar», «Plan Aurora el sabado por favor») keeps the stored one.
     */
    private languageExcludingStored(previous: string | null, text: string, names: readonly string[], preferred?: string | null): string | null {
        if (!previous) return null;
        const aroundName = this.mentionsName(text);
        const free = this.nameFreeText(text, names);
        const tokens = new Set(this.normalize(free).split(/\s+/).filter(token => /[a-z]/.test(token)));
        const raw = free.normalize('NFC').toLowerCase();
        let candidates = new Set(Object.keys(this.predicateWords));
        let known = 0;
        for (const token of tokens) {
            const owners = this.ownersOf(token);
            if (!owners.length) continue;
            candidates = new Set([...candidates].filter(lang => owners.includes(lang)));
            if (!this.courtesyWords.has(token) && !this.acknowledgements.has(token)) known++;
        }
        for (const [lang, pattern] of Object.entries(this.clearCharacters)) {
            if (pattern.test(raw)) candidates = new Set([...candidates].filter(candidate => candidate === lang));
        }
        const enough = known >= 3 || (known >= 2 && [...tokens].some(token => this.quantityAndTimeWords.has(token)));
        if (!enough || !candidates.size || candidates.has(previous)) return null;
        if (aroundName && ![...candidates].some(lang => this.hasPredicate(lang, tokens, raw))) return null;
        const preferredShort = preferred ? this.short(preferred) : null;
        if (preferredShort && candidates.has(preferredShort)) return preferredShort;
        return ['es', 'pt', 'fr', 'en'].find(lang => candidates.has(lang)) ?? null;
    }

    /** Whether the (name-free) message holds a verb or a question word of `lang` (see `predicateWords`, `predicatePatterns`). */
    private hasPredicate(lang: string, tokens: Set<string>, raw: string): boolean {
        if ((this.predicateWords[lang] ?? []).some(word => tokens.has(word))) return true;
        if (lang === 'pt' && /(?<!\p{L})(?:há|é)(?!\p{L})/u.test(raw)) return true;
        return (this.predicatePatterns[lang] ?? []).some(pattern => pattern.test(raw));
    }

    /**
     * The message with every name taken out: the catalogue names of the turn, a capitalised word in the middle of a
     * sentence («el Aurora», «el Tour QA Aurora»), a word in capitals («QA», «PDF») and figures. A name is how the
     * business wrote it, not the customer's language — but the words AROUND it are.
     */
    nameFreeText(text: string, names: readonly string[] = [], keepLoanwords = false): string {
        let out = String(text || '');
        const known = [...new Set(names.map(name => String(name || '').trim()).filter(name => name.length >= 3))]
            .sort((a, b) => b.length - a.length);
        for (const name of known) out = out.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), ' ');
        // Loanwords («check-in», «tour», «wifi») are no language either; names first, so «Tour QA Aurora» goes as a name.
        out = keepLoanwords ? out.replace(FRENCH_THERE_IS_Y, ' ') : scoredText(out);
        const words = out.trim().split(/\s+/).filter(Boolean);
        const kept: string[] = [];
        // Whether the previous word was a name taken out: a joiner right after it («Color y tratamiento») is the name's.
        let afterName = false;
        for (let i = 0; i < words.length; i++) {
            const word = words[i].replace(/^[^\p{L}\d]+/u, '');
            const letters = word.replace(/[^\p{L}]/gu, '');
            if (/\d/.test(word) && letters.length <= 2) continue;
            if (letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) { afterName = true; continue; }
            // An elided article before a name («de l'Audífono QA Aurora», «d'Aurora»): the article is the customer's, the name not.
            const elided = /^(\p{Ll}{1,2}['’])\p{Lu}/u.exec(word);
            if (elided) { kept.push(elided[1]); afterName = true; continue; }
            const sentenceStart = i === 0 || /[.!?:¡¿]$/.test(words[i - 1]) || /^[¡¿]/.test(words[i]);
            if (!sentenceStart && /^\p{Lu}/u.test(word) && !/^I(?:['’]|$)/.test(word)) { afterName = true; continue; }
            if (afterName && NAME_JOINERS.has(word.toLowerCase()) && /^\p{L}/u.test(words[i + 1] ?? '')) { afterName = false; continue; }
            afterName = false;
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
        // The shared table counts too: «mais» is Portuguese «more» AND French «but» («me fala mais sobre…» was French evidence).
        const shared = (token: string) => (this.sharedWords[token]?.length ?? 0) > 1
            || [...vocabularies.values()].filter(vocabulary => vocabulary.has(token)).length > 1;
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
            // An elided article or pronoun («d’Audífono», «l’hôtel», «qu’il») is French: Spanish, Portuguese and English do not elide
            // before a word. F4300-16 (production QA 26-oct): «combien d’Audífono QA Aurora en stock ?» after an English case kept
            // only «combien» once the name and the loanword «stock» were out, and was answered in English. Read on the message as
            // written: once the name is out, «d’» is no longer before a word.
            if (lang === 'fr' && FRENCH_ELISION.test(String(text || '').toLowerCase())) hits++;
            // «há» (there is) and a standalone «é» (is) are Portuguese verbs none of the other three languages writes: «o prato
            // Spark é sem glúten? sou celíaca» (stored «es») had no other predicate and was answered, the fixed allergen
            // text included, in Spanish.
            if (lang === 'pt' && /(?<!\p{L})(?:há|é)(?!\p{L})/u.test(raw)) { predicates++; verbs++; }
            if ((this.predicatePatterns[lang] ?? []).some(pattern => pattern.test(raw))) { hits++; predicates++; verbs++; }
            // An accented Spanish interrogative («qué consulta…?», «cuál es…?») asks a question in Spanish only: Portuguese writes
            // «que»/«quê»/«qual», French none of them. It is a predicate, never a verb, so on its own it still decides nothing.
            if (lang === 'es' && this.spanishInterrogative.test(raw)) predicates++;
            return { lang, hits, predicates, verbs };
        }).sort((a, b) => b.hits - a.hits);
        const [best, second] = ranked;
        // No verb or interrogative in any language: only content words of one language can tell it («haircut price?»).
        if (ranked.every(entry => entry.predicates === 0)) return this.contentLanguage(tokens, raw, vocabularies);
        if (best.hits === 0 || second.hits > 0 || best.predicates === 0) return null;
        if (best.hits >= 2) return best.lang;
        // A question OPENED by an interrogative of one language and carried on for two more words is a question in that language,
        // however the rest is typed: «onde fika o spark qa inmueble» (production QA 26-oct, a Spanish reply). A lone or trailing
        // interrogative («ok what», «how?», «el plan cual») still decides nothing.
        const opening = this.normalize(this.nameFreeText(text, names, true)).split(/\s+/).filter(word => /[a-z]/.test(word));
        if (opening.length >= 3 && this.interrogatives.has(opening[0]) && this.predicateWords[best.lang].includes(opening[0])) return best.lang;
        // ONE word of evidence: it must be a verb («tiene garantía?»), in a message of two words that are not a bare
        // acknowledgement. A lone interrogative is as often a borrowed word: «ok what», «cual», «how?» decide nothing.
        // A loanword is no evidence, but it is a word the customer wrote: «tienen delivery?» is a two-word Spanish question.
        const content = this.normalize(this.nameFreeText(text, names, true)).split(/\s+/)
            .filter(word => /[a-z]/.test(word) && !this.acknowledgements.has(word));
        return best.verbs > 0 && content.length >= 2 ? best.lang : null;
    }

    private readonly spanishInterrogative = /(?<!\p{L})(?:qué|cómo|dónde|cuándo|cuánt[oa]s?|quién(?:es)?|cuál(?:es)?)(?!\p{L})/u;

    /** Interrogatives of the predicate lists: evidence, but never enough on their own. */
    private readonly interrogatives = new Set(['cuanto', 'cuanta', 'cuantos', 'cuantas', 'donde', 'cual', 'cuales', 'cuando', 'quien', 'quienes',
        'quanto', 'quanta', 'quantos', 'quantas', 'qual', 'quais', 'quando', 'combien', 'quel', 'quelle', 'quels', 'quelles', 'how', 'what', 'where',
        'when', 'which', 'onde', 'qto', 'qta', 'qtos', 'qtas', 'oq']);

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
    private strongLanguageOf(message: string): string | null {
        const text = scoredText(message);
        const normalized = this.normalize(text);
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
        // F4300-16 residual (production 24-oct): «a qué hora es el check-in?» after an English case was answered in English —
        // the «in» of «check-in» was an English word. Loanwords are no evidence of any language, so they are scored out.
        // `text` keeps them for the name rules (nameFreeText takes them out after the names).
        const plain = scoredText(text || '');
        const normalized = this.normalize(plain);
        if (normalized.length < 3) return { language: this.short(fallback), persist: true };

        const tokens = new Set(normalized.split(/\s+/).filter(Boolean));
        // "d'ouverture", "jusqu'a": also expose the pieces around the elision.
        for (const t of [...tokens]) {
            if (t.includes("'")) for (const part of t.split("'")) if (part) tokens.add(part);
        }
        const raw = plain.normalize('NFC').toLowerCase();

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
        const notStored = this.languageExcludingStored(prev, text, names, context?.preferred);
        if (notStored) return { language: notStored, persist: true };
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
