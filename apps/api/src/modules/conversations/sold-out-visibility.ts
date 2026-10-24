/**
 * F4300-29. Asked «¿qué productos tienen agotados?», «tem algum produto esgotado?», «is anything sold out right now?» or «which
 * products are out of stock?», the store agent answered «No, all the products in our catalog are currently available in stock» /
 * «no tengo un listado de agotados» while the catalogue held a product with stock 0 / is_available = false. Every read the model
 * had (search_products, the turn's <catalog>) listed only products for sale, so «nothing is sold out» looked true.
 *
 * Three pieces, one per layer:
 * - `productAvailabilityScope`: what search_products reads. "available" (default, unchanged for browsing and ordering), "unavailable"
 *   (sold out or withdrawn) or "any"; the result carries `scope`, and the default one a note saying sold-out items are not in it.
 * - `asksAboutSoldOutProducts`: the customer asks which products are sold out / out of stock. The pipeline then reads the catalogue
 *   with availability "unavailable" before the model answers.
 * - `guardSoldOutClaim`: a reply saying nothing is sold out / everything is available, to such a question, stands only when an
 *   availability-scoped read of this turn backs it. Otherwise it is replaced by a fixed text: the sold-out products the read
 *   returned, or that it cannot be confirmed.
 */

export type ProductAvailability = 'available' | 'unavailable' | 'any';
export type ProductReadScope = 'available_only' | 'unavailable_only' | 'all';

export const AVAILABLE_ONLY_NOTE = 'Only products currently for sale are listed. Sold-out or withdrawn products are not included, so this result cannot show whether any product is sold out. To list them, call search_products with availability "unavailable".';

/** The SQL predicate and the scope label of a search_products read. Anything but "unavailable" / "any" is the default. */
export function productAvailabilityScope(value: unknown): { availability: ProductAvailability; where: string | null; label: ProductReadScope; note?: string } {
    const availability: ProductAvailability = value === 'unavailable' || value === 'any' ? value : 'available';
    if (availability === 'unavailable') {
        // Sold out (tracked stock at or below zero) or switched off by the business.
        return { availability, where: '(is_available IS NOT TRUE OR (stock IS NOT NULL AND stock <= 0))', label: 'unavailable_only' };
    }
    if (availability === 'any') return { availability, where: null, label: 'all' };
    return { availability, where: 'is_available = true', label: 'available_only', note: AVAILABLE_ONLY_NOTE };
}

const fold = (text: unknown) => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`]/g, "'");

/** Sold-out vocabulary on folded text, es/en/pt/fr. */
const SOLD_OUT = "(?:agotad[oa]s?|sin (?:stock|existencias|inventario)|fuera de stock|sold[- ]?out|out of stock|out-of-stock|esgotad[oa]s?|sem estoque|fora de estoque|em falta|epuise(?:e|s|es)?|en rupture(?: de stock)?|rupture de stock|hors stock)";
/** «Not available», which speaks of products only next to a product word. */
const UNAVAILABLE = "(?:no (?:estan? |esten? )?disponibles?|unavailable|not available|indisponive(?:l|is)|nao (?:estao |esta )?disponive(?:l|is)|indisponibles?|pas disponibles?)";
const PRODUCT_WORD = '(?:productos?|products?|produtos?|produits?|articulos?|items?|artigos?|articles?|catalog\\w*|inventario|inventory|estoque|stock)';

/** The customer asks which products are sold out, out of stock or not available (a single product or the catalogue). */
export function asksAboutSoldOutProducts(customerText: string): boolean {
    const text = fold(customerText);
    if (!text.trim()) return false;
    if (new RegExp(`\\b${SOLD_OUT}`).test(text)) return true;
    return new RegExp(`\\b${UNAVAILABLE}\\b`).test(text) && new RegExp(`\\b${PRODUCT_WORD}\\b`).test(text);
}

const AVAILABLE = '(?:disponibles?|available|in stock|en stock|em estoque|disponive(?:l|is)|en existencia|a la venta|for sale|a venda|en vente)';
const COPULA = "(?:estan|esta|se encuentran|se encuentra|siguen|are|is|remain|estao|continuam|sont|est|restent|tienen|have|tem|ont)";
const UNIVERSAL = '(?:todos|todas|todo|all|everything|every|tudo|tous|toutes|tout)';
/** Quantifiers that deny the whole set («ningún producto está agotado», «nothing is sold out»). */
const NONE = '(?:none|nothing|ningun\\w*|nenhum\\w*|nada|aucun\\w*|rien)';
/** Plain negators: they deny the sold-out word only when no verb or cause stands between («no hay agotados», not «no se lo
 * vendo porque está agotado»). */
const NOT = '(?:no|not|nao)';
const NOT_GAP_STOP = '(?:esta|estan|este|esten|is|are|porque|because|since|pero|but|mas|mais|ya|already|ainda|still)';
/** «No, all the products in our catalog are currently available», «no hay productos agotados», «nothing is sold out», «aucun produit n'est épuisé». */
const CLAIM_RES = [
    new RegExp(`\\b${UNIVERSAL}\\b(?:\\s+\\S+){0,6}?\\s+${COPULA}\\b(?:\\s+\\S+){0,3}?\\s+${AVAILABLE}`),
    new RegExp(`(?:^|\\s)${NONE}\\b(?:\\s+\\S+){0,6}?\\s+${SOLD_OUT}`),
    new RegExp(`(?:^|\\s)${NOT}(?:\\s+(?!${NOT_GAP_STOP}\\b)\\S+){0,6}?\\s+${SOLD_OUT}`),
];

/** True when a clause of the reply says nothing is sold out / everything is available. */
export function claimsNothingSoldOut(reply: string): boolean {
    // Clauses: «No, el producto X está agotado» is an answer, not «no ... agotado».
    return fold(reply).split(/[,.;:!?¡¿\n]+/).some(clause => CLAIM_RES.some(re => re.test(clause.trim())));
}

interface ScopedRead { scope: ProductReadScope; soldOut: string[] }

function parse(source: unknown): unknown {
    if (typeof source !== 'string') return source;
    try { return JSON.parse(source); } catch { return null; }
}

/** The search_products-shaped reads of the turn that looked at products not for sale, with the sold-out names they returned. */
function scopedReads(sources: readonly unknown[]): ScopedRead[] {
    const reads: ScopedRead[] = [];
    for (const raw of sources) {
        const value = parse(raw) as any;
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        if (value.scope !== 'unavailable_only' && value.scope !== 'all') continue;
        if (value.error || value.stale === true || !Array.isArray(value.products) || (value.status && !['ok', 'empty'].includes(value.status))) continue;
        const soldOut = value.products
            .filter((p: any) => p && typeof p.name === 'string' && p.name.trim()
                && (value.scope === 'unavailable_only' || p.isAvailable === false || p.inStock === false))
            .map((p: any) => Array.from(String(p.name), (char: string) => (char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127 ? ' ' : char)).join('').trim().slice(0, 120));
        reads.push({ scope: value.scope, soldOut });
    }
    return reads;
}

const UNCONFIRMED: Record<string, string> = {
    es: 'En este momento no tengo confirmado qué productos están agotados, así que no puedo asegurarle que todo esté disponible. Si me indica el producto que le interesa, le confirmo su disponibilidad.',
    en: 'I cannot confirm right now which products are sold out, so I cannot assure you that everything is available. If you tell me which product you are interested in, I will confirm its availability.',
    pt: 'No momento não tenho confirmado quais produtos estão esgotados, então não posso garantir que tudo esteja disponível. Se me indicar o produto que lhe interessa, confirmo a disponibilidade.',
    fr: 'Je ne peux pas confirmer pour le moment quels produits sont épuisés, je ne peux donc pas vous assurer que tout est disponible. Si vous m’indiquez le produit qui vous intéresse, je vous confirme sa disponibilité.',
};
const LISTED: Record<string, (names: string) => string> = {
    es: names => `Según el catálogo, en este momento estos productos no están disponibles (agotados o fuera de venta): ${names}.`,
    en: names => `According to the catalogue, these products are not available right now (sold out or withdrawn from sale): ${names}.`,
    pt: names => `Segundo o catálogo, estes produtos não estão disponíveis no momento (esgotados ou retirados de venda): ${names}.`,
    fr: names => `D’après le catalogue, ces produits ne sont pas disponibles pour le moment (épuisés ou retirés de la vente) : ${names}.`,
};

export interface SoldOutClaimInput {
    customerText: string;
    reply: string;
    /** Tool results of this turn and tool messages of the thread (objects or JSON strings). */
    sources: readonly unknown[];
    lang?: string;
}

export type SoldOutClaimSituation = 'unscoped' | 'contradicted';

/** The reply, or the fixed text when it says nothing is sold out without an availability-scoped read backing it. */
export function guardSoldOutClaim(input: SoldOutClaimInput): { text: string; replaced: boolean; situation?: SoldOutClaimSituation } {
    const keep = { text: input.reply, replaced: false };
    if (!asksAboutSoldOutProducts(input.customerText) || !claimsNothingSoldOut(input.reply)) return keep;
    const code = String(input.lang || 'es').slice(0, 2).toLowerCase();
    const reads = scopedReads(input.sources);
    if (!reads.length) return { text: UNCONFIRMED[code] || UNCONFIRMED.es, replaced: true, situation: 'unscoped' };
    const soldOut = [...new Set(reads.flatMap(read => read.soldOut))];
    if (!soldOut.length) return keep;
    // A reply that names every sold-out product («X está agotado; lo demás está disponible») says what the read says.
    const reply = fold(input.reply);
    if (soldOut.every(name => reply.includes(fold(name)))) return keep;
    return { text: (LISTED[code] || LISTED.es)(soldOut.slice(0, 20).join(', ')), replaced: true, situation: 'contradicted' };
}
