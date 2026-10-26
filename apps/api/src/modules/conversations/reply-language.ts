import { withoutLoanwords } from './language-loanwords';

/**
 * The language a reply is written in, judged by FUNCTION and SERVICE words (articles, prepositions, auxiliaries,
 * the words of a sales reply): a reply of a dozen words always has several, unlike the marker words the
 * customer-message detector relies on. Words that two of the four languages share (le, la, de, en, que, mas,
 * mais, a, o, se, este, dias, sabado…) are left out, so a hit is evidence.
 *
 * What is NOT the reply's own language is removed before scoring: URLs and e-mails, text in quotes, markdown
 * links, every catalog name known this turn ("Case for iPhone 15 with MagSafe" inside a Spanish reply) and the
 * loanwords every language writes alike ("check-in", "tour", "wifi", see language-loanwords.ts).
 *
 * Returns null unless one language is clearly ahead: at least 4 hits and three times the runner-up, or at least 3 hits
 * and none for any other language.
 * It decides whether to ask for a rewrite, so a miss costs nothing and a false positive costs a needless model
 * call (and a risk to the wording): the bar is deliberately high.
 */
export type ReplyLang = 'es' | 'en' | 'pt' | 'fr';

const WORDS: Record<ReplyLang, readonly string[]> = {
    es: ['el', 'los', 'las', 'del', 'al', 'una', 'unos', 'unas', 'y', 'pero', 'muy', 'tambien', 'sin', 'su', 'sus', 'lo', 'es', 'son',
        'estan', 'hay', 'tiene', 'tienen', 'tenemos', 'puede', 'pueden', 'puedo', 'puedes', 'nuestro', 'nuestra', 'nuestros', 'nuestras',
        'usted', 'ustedes', 'cuando', 'donde', 'hasta', 'esto', 'eso', 'ese', 'esa', 'esos', 'esas', 'estos', 'con', 'otro', 'otra', 'otros',
        'otras', 'mi', 'mis', 'tu', 'tus', 'ya', 'siguiente', 'siguientes', 'despues', 'segun', 'solo', 'asi', 'quiere', 'quieres',
        'gustaria', 'ayudarle', 'ayudarte', 'gracias', 'hola', 'buenos', 'buenas', 'tardes', 'alli', 'ahi', 'cual', 'cuales', 'cuanto',
        'cuesta', 'precio', 'precios', 'tienda', 'cita', 'citas', 'servicio', 'servicios', 'producto', 'productos', 'lunes', 'martes',
        'miercoles', 'jueves', 'viernes', 'hoy', 'manana', 'ayer', 'fecha', 'horas', 'correo', 'nombre', 'incluye', 'incluyen',
        'ofrecemos', 'factura', 'empaque', 'cerramos', 'van', 'voy', 'eres', 'soy', 'fue'],
    en: ['the', 'and', 'of', 'to', 'in', 'is', 'are', 'you', 'your', 'for', 'with', 'this', 'that', 'it', 'we', 'our', 'can', 'will', 'if',
        'not', 'be', 'have', 'has', 'at', 'by', 'from', 'but', 'please', 'hello', 'thanks', 'thank', 'would', 'could', 'about', 'what',
        'which', 'when', 'where', 'how', 'there', 'their', 'they', 'them', 'these', 'those', 'than', 'then', 'also', 'just', 'very',
        'more', 'any', 'some', 'other', 'available', 'price', 'order', 'product', 'products', 'appointment', 'today',
        'tomorrow', 'name', 'time', 'date', 'help', 'need', 'want', 'let', 'know', 'does', 'am', 'was', 'were', 'been', 'its', 'my', 'us',
        'ask', 'return', 'refund', 'policy', 'within', 'days', 'purchase', 'receipt'],
    pt: ['os', 'um', 'uma', 'uns', 'umas', 'do', 'da', 'dos', 'das', 'em', 'na', 'nas', 'seu', 'sua', 'seus', 'suas', 'ele', 'ela', 'nao',
        'sao', 'estao', 'tem', 'temos', 'podem', 'pode', 'posso', 'nosso', 'nossa', 'nossos', 'nossas', 'voce', 'voces', 'apos', 'pela',
        'pelo', 'ao', 'aos', 'muito', 'tambem', 'ate', 'sem', 'com', 'obrigado', 'obrigada', 'bom', 'boa', 'noite', 'produto', 'produtos',
        'servico', 'servicos', 'preco', 'precos', 'disponivel', 'disponiveis', 'entrega', 'embalagem', 'prazo', 'terca', 'quarta', 'sexta',
        'hoje', 'amanha', 'ontem', 'nome', 'inclui', 'oferecemos', 'fechamos', 'fica', 'ficam', 'gostaria', 'ajudar', 'quer', 'isso',
        'esse', 'essa', 'esses', 'essas', 'neste', 'nesta', 'onde', 'quando', 'qual', 'quais', 'quanto', 'custa', 'foi', 'sou', 'vou',
        'vai', 'tudo', 'outro', 'outra', 'outros', 'outras'],
    fr: ['des', 'du', 'et', 'est', 'sont', 'vous', 'votre', 'vos', 'nous', 'notre', 'nos', 'pour', 'dans', 'avec', 'cette', 'ces', 'pas',
        'qui', 'aux', 'sur', 'peut', 'pouvez', 'pouvons', 'avez', 'avons', 'elle', 'je', 'une', 'bonjour', 'bonsoir', 'merci', 'produit',
        'produits', 'prix', 'livraison', 'commande', 'souhaitez', 'voulez', 'aussi', 'etre', 'avoir', 'tout', 'tous', 'toute', 'toutes',
        'autre', 'autres', 'leur', 'leurs', 'ici', 'comment', 'pourquoi', 'quand', 'quel', 'quelle', 'quels', 'quelles', 'combien',
        'garantie', 'remboursement', 'politique', 'retour', 'achat', 'facture', 'emballage', 'lundi', 'mardi', 'mercredi', 'jeudi',
        'vendredi', 'samedi', 'dimanche', 'aujourd', 'demain', 'hier', 'heure', 'nom', 'courriel', 'inclut', 'offrons', 'ouvrons',
        'fermons', 'serait', 'suis', 'sommes', 'ete', 'fait', 'faire', 'donc', 'alors', 'chez', 'jusqu', 'depuis', 'avant', 'apres',
        'pendant', 'selon', 'ceci', 'cela', 'celui', 'ceux'],
};

/** The words of a sales / booking reply (payment, delivery, appointments, returns) that exist in ONE language only. */
const VOCABULARY: Record<ReplyLang, readonly string[]> = {
    es: ['pago', 'pagos', 'tarjeta', 'tarjetas', 'recargo', 'enlace', 'enlaces', 'llega', 'llegara', 'sucursal', 'sucursales', 'tallas', 'talla',
        'colores', 'negro', 'rojo', 'recordatorio', 'lamentablemente', 'descuento', 'perfecto', 'dos', 'treinta', 'cuarenta', 'siempre',
        'tarda', 'tardan', 'ubicados', 'indicaciones', 'tengo', 'siento', 'hablo',
        // The closing offer («¿Desea que le ayude con algo más?») left inside a French reply (production QA 2026-10-25).
        'desea', 'desean', 'deseas', 'ayude', 'ayuda', 'ayudo', 'ayudar',
        // Renting a listing (F4300-16 residual, production 24-oct: «Sí, el Spark QA Inmueble está en arriendo» to an English turn).
        'arriendo', 'arriendos', 'alquiler', 'alquileres', 'arrendamiento'],
    en: ['accept', 'credit', 'cards', 'card', 'debit', 'bank', 'transfers', 'transfer', 'payments', 'payment', 'per', 'month', 'taxes', 'included',
        'free', 'shipping', 'costs', 'cost', 'units', 'colors', 'black', 'blue', 'red', 'store', 'located', 'floor', 'mall', 'arrive', 'arrives',
        'shipped', 'link', 'reminder', 'sorry', 'understand', 'frustration', 'team', 'review', 'solution', 'warranty', 'slots', 'sunday',
        'saturday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'morning', 'evening', 'afternoon', 'size', 'sizes', 'both',
        'two', 'three', 'five', 'thirty', 'hours', 'opening', 'business', 'address', 'city', 'center', 'close', 'near', 'next', 'day',
        'rent', 'rental', 'lease'],
    pt: ['dois', 'duas', 'depois', 'leva', 'levam', 'uteis', 'trinta', 'quarenta', 'vinte', 'sim', 'aceitamos', 'pagamento', 'pagamentos',
        'cartao', 'segue', 'avisar', 'precisar', 'precisa', 'procura', 'ja', 'maioria', 'mudar', 'marcado', 'ficou', 'agendamento', 'cores',
        'preto', 'vermelho', 'lembrete', 'desconto', 'entendi', 'perfeito', 'cidade', 'andar', 'loja', 'lojas', 'tamanhos', 'tamanho', 'ambos',
        'frete', 'gratis', 'atendimento', 'seguranca', 'chega', 'sempre', 'recomendo', 'sugiro', 'carrega', 'compativel', 'celulares', 'escrever', 'ajuda',
        'prazer', 'prefere', 'saude', 'economizar', 'aguardando', 'localizacao', 'indicacoes', 'estacao', 'proxima', 'chegar', 'fico', 'eu', 'meu',
        'minha', 'meus', 'minhas', 'tenho', 'sinto', 'falo',
        'aluguel', 'alugar', 'locacao'],
    fr: ['carte', 'cartes', 'virement', 'bancaire', 'paiement', 'paiements', 'frais', 'comprises', 'gratuite', 'boutique', 'magasin', 'magasins',
        'etage', 'ville', 'zone', 'lien', 'rappel', 'desole', 'comprends', 'equipe', 'examiner', 'couleur', 'couleurs', 'noir', 'bleu', 'rouge',
        'tailles', 'taille', 'moyenne', 'epuise', 'oui', 'deux', 'trois', 'cinq', 'trente', 'quarante', 'jours', 'jour', 'toujours', 'jamais',
        'meilleure', 'meilleur', 'maintenant', 'adresse', 'horaires', 'ouverture', 'forfait', 'coute', 'mois', 'complet', 'seulement', 'simplement',
        'loyer', 'louer', 'commandes'],
};

const SETS = Object.fromEntries(
    (Object.keys(WORDS) as ReplyLang[]).map(lang => [lang, new Set([...WORDS[lang], ...VOCABULARY[lang]])]),
) as Record<ReplyLang, Set<string>>;

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The text with what is not the reply's own language removed: URLs, e-mails, quotes, links and known names. */
export function ownLanguageText(text: string, ignore: readonly string[] = []): string {
    let out = String(text || '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
        .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ' ')
        .replace(/«[^»]*»|“[^”]*”|"[^"\n]*"/g, ' ')
        .replace(/<[^>]*>/g, ' ');
    const names = [...new Set(ignore.map(name => String(name || '').trim()).filter(name => name.length >= 3))]
        .sort((a, b) => b.length - a.length);
    for (const name of names) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(escaped, 'giu'), ' ');
    }
    // Loanwords («check-in», «tour», «wifi», «delivery», «ok») are written alike in a reply of any language: no evidence.
    return withoutLoanwords(out);
}

function scoresOf(text: string, ignore: readonly string[]): Array<[ReplyLang, number]> {
    const tokens = fold(ownLanguageText(text, ignore)).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
    const scores: Record<ReplyLang, number> = { es: 0, en: 0, pt: 0, fr: 0 };
    for (const token of tokens) {
        for (const lang of Object.keys(SETS) as ReplyLang[]) if (SETS[lang].has(token)) scores[lang]++;
    }
    return (Object.entries(scores) as Array<[ReplyLang, number]>).sort((a, b) => b[1] - a[1]);
}

export function replyLanguageOf(text: string, ignore: readonly string[] = []): ReplyLang | null {
    const ranked = scoresOf(text, ignore);
    const [best, bestScore] = ranked[0];
    const second = ranked[1][1];
    return (bestScore >= 4 && bestScore >= 3 * second) || (bestScore >= 3 && second === 0) ? best : null;
}

/**
 * The language the reply is clearly written in when it is NOT `code`; null when it is `code` or cannot be told.
 * Knowing the turn language allows one more case: a short reply whose catalog name took most of its words away
 * («El Corte y estilo dura 45 minutos, ¿le agendo una cita?» to a Portuguese turn) has no word at all of `code`
 * and two or more of ONE other language — that, too, is a reply written in another language.
 */
export function languageMismatch(text: string, code: string, ignore: readonly string[] = []): ReplyLang | null {
    return wholeReplyMismatch(text, code, ignore) ?? sentenceInOtherLanguage(text, code, ignore);
}

/**
 * `languageMismatch` judged on the reply as a whole, for a reply too short to hold a sentence of its own (4 to 7 words).
 * Production QA 23/24-oct: «Não tenho informação confirmada…» to a Spanish turn had no word of Spanish and two of
 * Portuguese, but a short reply was judged by the strict bar only and went out as written.
 */
export function wholeReplyMismatch(text: string, code: string, ignore: readonly string[] = []): ReplyLang | null {
    const written = replyLanguageOf(text, ignore);
    if (written) return written !== code ? written : null;
    const ranked = scoresOf(text, ignore);
    const [best, bestScore] = ranked[0];
    const own = ranked.find(([lang]) => lang === code)?.[1] ?? 0;
    return best !== code && bestScore >= 2 && own === 0 && ranked[1][1] === 0 ? best : null;
}

/**
 * A reply saying the agent does not speak a language, or speaks only one («Lo siento, pero no hablo francés», production
 * QA 23/24-oct, to a French message after a Spanish case): the language it is written in, whatever its length. The
 * agent answers in every language it supports, so such a reply is never right for a turn in another language.
 */
const LANGUAGE_DENIAL: Record<ReplyLang, RegExp> = {
    es: /(?<!\p{L})(?:no\s+(?:hablo|s[eé]\s+hablar|puedo\s+(?:hablar|responder|escribir)(?:te|le)?\s+en)|s[oó]lo\s+(?:hablo|puedo\s+(?:hablar|responder)))(?!\p{L})/iu,
    en: /(?<!\p{L})I\s+(?:(?:do\s+not|don['’]t|can\s*not|can['’]t)\s+(?:speak|reply\s+in|respond\s+in|write\s+in)|only\s+speak)(?!\p{L})/iu,
    pt: /(?<!\p{L})(?:n[ãa]o\s+(?:falo|sei\s+falar|consigo\s+(?:falar|responder|escrever)\s+em)|s[óo]\s+falo)(?!\p{L})/iu,
    fr: /(?<!\p{L})je\s+ne\s+(?:parle|sais\s+pas\s+parler|peux\s+pas\s+(?:parler|r[ée]pondre|[ée]crire)\s+en)(?!\p{L})/iu,
};

export function languageDenialOf(text: string): ReplyLang | null {
    for (const lang of Object.keys(LANGUAGE_DENIAL) as ReplyLang[]) if (LANGUAGE_DENIAL[lang].test(String(text || ''))) return lang;
    return null;
}

/**
 * A reply that opens in the turn language and drifts into another one mid-way («Sinto muito… Le recomiendo que busque
 * atención urgente…», production 2026-10-22) scores as undecided — or even as the turn language — as a whole. Each
 * sentence of 6+ words is judged on its own, with the same strict bar: one clearly in another language is a mismatch.
 */
function sentenceInOtherLanguage(text: string, code: string, ignore: readonly string[]): ReplyLang | null {
    const sentences = ownLanguageText(text, ignore).split(/(?<=[.!?…])\s+|[\n\r]+|(?=[¿¡])/);
    for (const sentence of sentences) {
        if (sentence.trim().split(/\s+/).filter(word => /\p{L}/u.test(word)).length < 6) continue;
        const written = replyLanguageOf(sentence) ?? mixedInto(sentence, code);
        if (written && written !== code) return written;
    }
    return null;
}

/**
 * Words of another language that are ordinary words of the turn language too, so they are no evidence inside it: French «son»
 * («son statut») and «es» («tu es»), Portuguese «a» and «tu».
 */
const ALSO_IN: Partial<Record<ReplyLang, ReadonlySet<string>>> = {
    fr: new Set(['son', 'es', 'tu', 'mi']),
    pt: new Set(['tu', 'mi', 'son']),
    en: new Set(['a', 'son']),
};

/**
 * A sentence that starts in one language and ends in another («El total de su última commande est de 119 900 COP et son statut
 * est annulé.», production QA 26-oct, a French turn) is undecided as a whole. Two or more different words of another language
 * next to two or more of the turn language is a mixed sentence: it is in that other language for the rewrite. Pure.
 */
function mixedInto(sentence: string, code: string): ReplyLang | null {
    const tokens = new Set(fold(sentence).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean));
    const own = SETS[code as ReplyLang];
    if (!own || [...tokens].filter(token => own.has(token)).length < 2) return null;
    const ambiguous = ALSO_IN[code as ReplyLang] ?? new Set<string>();
    for (const lang of Object.keys(SETS) as ReplyLang[]) {
        // English words inside a sentence are product names more often than drift («Case for iPhone 15 with MagSafe»).
        if (lang === code || lang === 'en') continue;
        const foreign = [...tokens].filter(token => SETS[lang].has(token) && !own.has(token) && !ambiguous.has(token));
        if (foreign.length >= 2) return lang;
    }
    return null;
}

/** Why a language rewrite cannot be sent: it is empty, it is still in the source language, or it lost a figure, URL or name. */
export type RewriteRejectionReason = 'empty' | 'still_source_language' | 'denies_language' | 'lost_figure' | 'lost_url' | 'lost_name';

const FIGURE = /\d[\d.,:]*\d|\d/g;
/**
 * A figure grouped by spaces («13 500», «1 200 000», with a space, a no-break or a narrow no-break space: the French
 * and Portuguese way of writing thousands) is ONE figure. Production QA 25-oct (image 0330ef7a): a French draft said
 * «13 500», its Spanish rewrite «13.500»; read as the two figures «13» and «500», the rewrite was rejected for losing
 * both, the retry asked to copy «13 | 500», and the model complied with «Las cifras 13 y 500 son parte de este precio.»
 */
const FIGURE_WITH_GROUPS = /\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?(?!\d)|\d[\d.,:]*\d|\d/g;
/** The figures of a text, a space-grouped figure as one. */
const figuresOf = (text: string): string[] => String(text || '').match(FIGURE_WITH_GROUPS) || [];
const URL_PATTERN = /https?:\/\/[^\s)>\]]+|www\.[^\s)>\]]+/gi;
const digitsOf = (token: string) => token.replace(/[^\d]/g, '');
const trimUrl = (url: string) => url.replace(/[.,;:!?]+$/, '');
/** Case, accents and spacing do not make a name another name. */
const loose = (value: string) => fold(value).replace(/\s+/g, ' ').trim();

/**
 * The exact strings of `original` a translation must carry unchanged: the catalog names it mentions (as the reply
 * wrote them), its figures (prices, durations, hours, dates) and its URLs. They are handed to the rewrite request, so
 * the model is told what to copy instead of being judged afterwards on something it did not know it had to keep
 * («Corte y estilo» translated to «Corte e estilo» in a Portuguese rewrite, production 2026-10-22).
 */
export function verbatimTermsOf(original: string, names: readonly string[] = []): { names: string[]; figures: string[]; urls: string[] } {
    const text = String(original || '');
    const urls = [...new Set((text.match(URL_PATTERN) || []).map(trimUrl))];
    // Figures inside a URL travel with the URL.
    const figures = [...new Set(figuresOf(text.replace(URL_PATTERN, ' ')))];
    const folded = loose(text);
    const found = new Set<string>();
    for (const name of names) {
        const clean = String(name || '').trim();
        if (clean.length < 3 || !folded.includes(loose(clean))) continue;
        const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
        found.add(text.match(new RegExp(escaped, 'iu'))?.[0] ?? clean);
    }
    return { names: [...found], figures, urls };
}

/**
 * Why `rewrite` may not replace `original`, or null when it may. Figures and URLs are compared exactly (the digits,
 * the URL itself) and are never loosened; names case-, accent- and space-folded. `missing` lists what was lost, as
 * `original` wrote it. `sourceLang`, when given, also rejects a rewrite still written in the language being corrected
 * (judged against `targetLang`, the turn language, when that is given).
 */
export function rewriteRejection(
    original: string, rewrite: string, names: readonly string[] = [], sourceLang?: ReplyLang | null, targetLang?: string,
): { reason: RewriteRejectionReason; missing: string[] } | null {
    const text = String(rewrite || '').trim();
    // A space-grouped figure is kept whether the rewrite writes it whole («13.500», «13500», «13 500») or as the same groups.
    const have = new Set([...(text.match(FIGURE) || []), ...figuresOf(text)].map(digitsOf));
    const lostFigures = figuresOf(original).filter(token => !have.has(digitsOf(token))
        && !(/\s/.test(token) && (token.match(FIGURE) || []).every(part => have.has(digitsOf(part)))));
    if (lostFigures.length) return { reason: 'lost_figure', missing: [...new Set(lostFigures)] };
    const lostUrls = (String(original || '').match(URL_PATTERN) || []).map(trimUrl).filter(url => !text.includes(url));
    if (lostUrls.length) return { reason: 'lost_url', missing: [...new Set(lostUrls)] };
    const lowered = loose(text);
    const lostNames = verbatimTermsOf(original, names).names.filter(name => !lowered.includes(loose(name)));
    if (lostNames.length) return { reason: 'lost_name', missing: lostNames };
    if (!text) return { reason: 'empty', missing: [] };
    // A rewrite of «I do not speak French» that still says so in French is no answer either.
    if (languageDenialOf(original) && languageDenialOf(text)) return { reason: 'denies_language', missing: [] };
    const stillIn = targetLang ? languageMismatch(text, targetLang, names) : replyLanguageOf(text, names);
    if (sourceLang && stillIn === sourceLang) return { reason: 'still_source_language', missing: [] };
    return null;
}

/** The figures, URLs and names a rewrite must still carry: a translation may not change what the reply says. */
export function rewritePreserves(original: string, rewrite: string, names: readonly string[] = []): boolean {
    const rejection = rewriteRejection(original, rewrite, names);
    return !rejection || rejection.reason === 'empty';
}

/**
 * The business's own names known this turn: catalog products, services and the names a tool returned. They are
 * written as the owner wrote them (often English: "Case for iPhone 15 with MagSafe"), whatever the reply's language.
 */
export function catalogNamesOfTurn(context?: any, executed?: Array<{ name: string; result: any }>): string[] {
    const out = new Set<string>();
    const add = (value: unknown) => { if (typeof value === 'string' && value.trim().length >= 3 && value.length <= 120) out.add(value.trim()); };
    for (const product of context?.catalog ?? []) add(product?.title);
    for (const service of context?.availableServices ?? []) add(service?.name);
    add(context?.bookingState?.service?.name);
    add(context?.bookingInterest?.service?.name);
    const visit = (value: any, depth: number): void => {
        if (!value || typeof value !== 'object' || depth > 4) return;
        if (Array.isArray(value)) { value.slice(0, 50).forEach(item => visit(item, depth + 1)); return; }
        for (const [key, child] of Object.entries(value)) {
            if (/^(?:name|title|serviceName|productName|label)$/.test(key)) add(child);
            else visit(child, depth + 1);
        }
    };
    for (const tool of executed ?? []) visit(tool?.result, 0);
    return [...out];
}
