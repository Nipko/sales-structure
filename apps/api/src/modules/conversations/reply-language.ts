/**
 * The language a reply is written in, judged by FUNCTION and SERVICE words (articles, prepositions, auxiliaries,
 * the words of a sales reply): a reply of a dozen words always has several, unlike the marker words the
 * customer-message detector relies on. Words that two of the four languages share (le, la, de, en, que, mas,
 * mais, a, o, se, este, dias, sabado…) are left out, so a hit is evidence.
 *
 * What is NOT the reply's own language is removed before scoring: URLs and e-mails, text in quotes, markdown
 * links, and every catalog name known this turn ("Case for iPhone 15 with MagSafe" inside a Spanish reply).
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
        'more', 'any', 'some', 'other', 'available', 'price', 'delivery', 'order', 'product', 'products', 'appointment', 'today',
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
        'tarda', 'tardan', 'ubicados', 'indicaciones'],
    en: ['accept', 'credit', 'cards', 'card', 'debit', 'bank', 'transfers', 'transfer', 'payments', 'payment', 'per', 'month', 'taxes', 'included',
        'free', 'shipping', 'costs', 'cost', 'units', 'colors', 'black', 'blue', 'red', 'store', 'located', 'floor', 'mall', 'arrive', 'arrives',
        'shipped', 'link', 'reminder', 'sorry', 'understand', 'frustration', 'team', 'review', 'solution', 'warranty', 'slots', 'sunday',
        'saturday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'morning', 'evening', 'afternoon', 'size', 'sizes', 'both',
        'two', 'three', 'five', 'thirty', 'hours', 'opening', 'business', 'address', 'city', 'center', 'close', 'near', 'next', 'day'],
    pt: ['dois', 'duas', 'depois', 'leva', 'levam', 'uteis', 'trinta', 'quarenta', 'vinte', 'sim', 'aceitamos', 'pagamento', 'pagamentos',
        'cartao', 'segue', 'avisar', 'precisar', 'precisa', 'procura', 'ja', 'maioria', 'mudar', 'marcado', 'ficou', 'agendamento', 'cores',
        'preto', 'vermelho', 'lembrete', 'desconto', 'entendi', 'perfeito', 'cidade', 'andar', 'loja', 'lojas', 'tamanhos', 'tamanho', 'ambos',
        'frete', 'gratis', 'atendimento', 'seguranca', 'chega', 'sempre', 'recomendo', 'sugiro', 'carrega', 'compativel', 'celulares', 'escrever', 'ajuda',
        'prazer', 'prefere', 'saude', 'economizar', 'aguardando', 'localizacao', 'indicacoes', 'estacao', 'proxima', 'chegar', 'fico', 'eu', 'meu',
        'minha', 'meus', 'minhas'],
    fr: ['carte', 'cartes', 'virement', 'bancaire', 'paiement', 'paiements', 'frais', 'comprises', 'gratuite', 'boutique', 'magasin', 'magasins',
        'etage', 'ville', 'zone', 'lien', 'rappel', 'desole', 'comprends', 'equipe', 'examiner', 'couleur', 'couleurs', 'noir', 'bleu', 'rouge',
        'tailles', 'taille', 'moyenne', 'epuise', 'oui', 'deux', 'trois', 'cinq', 'trente', 'quarante', 'jours', 'jour', 'toujours', 'jamais',
        'meilleure', 'meilleur', 'maintenant', 'adresse', 'horaires', 'ouverture', 'forfait', 'coute', 'mois', 'complet', 'seulement', 'simplement'],
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
    return out;
}

export function replyLanguageOf(text: string, ignore: readonly string[] = []): ReplyLang | null {
    const tokens = fold(ownLanguageText(text, ignore)).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
    const scores: Record<ReplyLang, number> = { es: 0, en: 0, pt: 0, fr: 0 };
    for (const token of tokens) {
        for (const lang of Object.keys(SETS) as ReplyLang[]) if (SETS[lang].has(token)) scores[lang]++;
    }
    const ranked = (Object.entries(scores) as Array<[ReplyLang, number]>).sort((a, b) => b[1] - a[1]);
    const [best, bestScore] = ranked[0];
    const second = ranked[1][1];
    return (bestScore >= 4 && bestScore >= 3 * second) || (bestScore >= 3 && second === 0) ? best : null;
}

/** The language the reply is clearly written in when it is NOT `code`; null when it is `code` or cannot be told. */
export function languageMismatch(text: string, code: string, ignore: readonly string[] = []): ReplyLang | null {
    const written = replyLanguageOf(text, ignore);
    return written && written !== code ? written : null;
}

/** The figures, URLs and names a rewrite must still carry: a translation may not change what the reply says. */
export function rewritePreserves(original: string, rewrite: string, names: readonly string[] = []): boolean {
    const digits = (value: string) => (String(value).match(/\d[\d.,:]*\d|\d/g) || []).map(token => token.replace(/[^\d]/g, ''));
    const have = new Set(digits(rewrite));
    if (!digits(original).every(token => have.has(token))) return false;
    const urls = String(original).match(/https?:\/\/[^\s)>\]]+|www\.[^\s)>\]]+/gi) || [];
    if (!urls.every(url => rewrite.includes(url.replace(/[.,;:!?]+$/, '')))) return false;
    const lowered = fold(rewrite);
    return names.filter(name => name.trim().length >= 3 && fold(original).includes(fold(name))).every(name => lowered.includes(fold(name)));
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
