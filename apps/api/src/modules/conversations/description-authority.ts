/**
 * F4300-35. A catalogue item's free-text description is not its state.
 *
 * Production QA 2026-10-24 (Telegram QA tenants):
 *  - restaurant: the dish «Spark QA Plato» is is_active = true, is_available = true, 13.500 COP, and its description (written by the
 *    business, any wording) says it is a synthetic QA dish «no vender». Asked its ingredients (es/en/fr/pt, 4 of 4) or the menu
 *    (en), the agent said «it is not for sale», and in the menu case then offered to order it. Asked its price or availability,
 *    it correctly said it can be ordered;
 *  - hotel: the active room «Spark QA Habitacion» was answered «habitación sintética para pruebas, no comercializable» next to
 *    its price and check-in time.
 * The structured fields (being returned by the read, is_active, is_available, stock, status, seats, an availability check) are
 * the only source of whether an item is for sale or available. Three pieces, one per layer:
 *  - `attachDescriptionAuthority`: every catalogue read whose rows carry a description says so next to them
 *    (`descriptionAuthority`), vertical-agnostic, whatever reader produced it;
 *  - the prompt rule 13h says the same in the contract;
 *  - `guardDescriptionStatusClaim`: a sentence of the reply that says an item a read of this turn returned as offered is not for
 *    sale / cannot be ordered or booked is taken out (only when no read of the turn marks an item not for sale, or the sentence
 *    names an item the reads offer). When nothing else is left, the reply is that the catalogue lists it as available.
 *
 * Follow-up (production after #215, same tenants):
 *  - pt «quais são os ingredientes do prato Spark?» was sent as «Também não há informações sobre alergênicos…»: the whole first
 *    sentence went, and with it the answer (no ingredients recorded) it carried next to «item sintético de teste e não está à
 *    venda». Only the clauses that make the claim go now; a following «também / también / also» left hanging loses it, and when
 *    the removed text was the only one to name the item («sus ingredientes») the reply opens with the catalogue's availability;
 *  - en hotel «a synthetic room for QA purposes, not for commercial use» and en store «a fictional test product and does not
 *    correspond to real inventory» were not caught: «not a real / commercial offer», «not real inventory», «synthetic / fictional
 *    / test item», «for QA / testing» are the same description-as-state claim (`NOT_REAL`), es/en/pt/fr.
 */

/** Told to the model with every catalogue read whose rows carry a description. */
export const DESCRIPTION_AUTHORITY_NOTE = 'description is free marketing text written by the business. It describes the item (what it is, ingredients, features); it NEVER states whether the item is for sale, available, active, bookable or orderable. That comes ONLY from the structured fields: being returned by this read, isAvailable / available / inStock / stock / status / soldOut / seatsLeft, and the availability reads. An item this read returns without a structured field marking it unavailable is offered: never tell the customer it is not for sale, not commercial, cannot be ordered or booked, is not a real or commercial offer, is not real inventory, or is only a test, sample, synthetic or fictional item because of what its description says, and do not repeat such internal wording from a description.';

/** The catalogue readers (every vertical) whose rows may carry a business-written description. */
export const DESCRIPTION_CATALOG_READERS: ReadonlySet<string> = new Set([
    'get_menu', 'get_restaurant_menu', 'get_promotions',
    'search_products', 'get_product', 'recommend_products',
    'list_properties', 'get_property_details',
    'search_packages', 'get_package_details', 'list_photo_packages',
    'search_listings', 'get_listing_details',
    'search_vehicles', 'get_vehicle_details',
    'list_services', 'list_clinic_services', 'list_home_services', 'list_pet_services',
    'get_courses', 'get_membership_plans', 'get_insurance_plans',
]);

const hasText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

/** True when the result (or a list in it) holds at least one row with a non-empty description. Pure. */
export function carriesDescription(result: unknown): boolean {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
    const value = result as Record<string, unknown>;
    if (hasText(value.description)) return true;
    return Object.values(value).some(list => Array.isArray(list)
        && list.some(row => !!row && typeof row === 'object' && hasText((row as Record<string, unknown>).description)));
}

/** The result of a catalogue read with `descriptionAuthority` when its rows carry a description; anything else unchanged. Pure. */
export function attachDescriptionAuthority<T>(toolName: string, result: T): T {
    if (!DESCRIPTION_CATALOG_READERS.has(toolName) || !carriesDescription(result)) return result;
    const value = result as unknown as Record<string, unknown>;
    if (value.error || value.descriptionAuthority) return result;
    return { ...value, descriptionAuthority: DESCRIPTION_AUTHORITY_NOTE } as unknown as T;
}

// ── The output check ───────────────────────────────────────────────────────────────────────────────────────────────────

const fold = (text: unknown) => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`]/g, "'");

/** «Not for sale / cannot be ordered or booked», es/en/pt/fr, on folded text. */
const NOT_FOR_SALE = new RegExp([
    // es
    /\bno (?:(?:esta|estan|se encuentra|se encuentran|es|son) )?(?:a la venta|en venta|para (?:la )?venta|comercializables?|vendibles?|reservables?|disponibles? (?:para|a) (?:la )?(?:venta|compra|pedidos?|pedir|ordenar|reserv\w*))\b/,
    /\bno se (?:vende|venden|comercializa|comercializan|puede (?:pedir|ordenar|comprar|reservar))\b(?! (?:por separado|suelt[oa]s?|individualmente|aparte))/,
    /\bno (?:lo |la |los |las )?(?:puede|pueden|podemos|puedes) (?:pedir|ordenar|comprar|reservar|vender)\b/,
    /\bfuera de (?:la )?venta\b/,
    // en
    /\b(?:not|n't) (?:(?:currently|actually|really) )?(?:for sale|on sale|sold(?! ?out| separately| individually)|sellable|for purchase|orderable|bookable|commercial(?:ly available)?|available (?:for|to) (?:sale|purchase|order|ordering|booking|book|buy|reserv\w*))\b/,
    /\b(?:cannot|can't|can not) be (?:ordered|purchased|bought|sold|booked|reserved)\b/,
    // pt
    /\bnao (?:(?:esta|estao|e|sao) )?(?:a venda|para (?:a )?venda|comercializ\w*|vendid[oa]s?|disponive(?:l|is) (?:para|a) (?:a )?(?:venda|compra|pedidos?|reserv\w*))\b/,
    /\bnao se (?:vende|vendem|comercializa)\b(?! (?:separad\w*|avuls\w*|individualmente))/,
    /\bnao (?:pode|podem|podemos) ser (?:pedid|comprad|vendid|reservad)\w*/,
    // fr
    /\b(?:n'est|ne sont) pas (?:(?:encore|actuellement) )?(?:en vente|a vendre|a la vente|commercialis\w*|vendu\w*|reservable\w*|disponibles? (?:a|pour) la (?:vente|commande|reservation))\b/,
    /\bne (?:se vend(?:ent)? pas|peut pas etre (?:commande|achete|vendu|reserve)\w*)\b(?! (?:separement|individuellement|a l'unite))/,
    /\bpas (?:a vendre|en vente)\b/,
    /\bhors (?:de la )?vente\b/,
].map(re => re.source).join('|'));

/** A description that speaks of the item's own state or of tests: the claim may have come from it. */
const DESCRIPTION_STATE = new RegExp([
    NOT_FOR_SALE,
    /\b(?:no|not|nao|ne pas|pas) (?:vender|sell|vendre|comercializar|offer|ofrecer|oferecer|proposer)\b/,
    /\b(?:do not|don't|never) (?:sell|offer|book)\b/,
    /\b(?:qa|test|tests|testing|prueba|pruebas|teste|testes|sintetic\w*|synthetic|synthetique|fictici\w*|fictitious|fictif|dummy|sample|muestra)\b/,
].map(re => re.source).join('|'));

/**
 * F4300-35 follow-up (production 2026-10-24): the description's internal wording said as the item's state in other words than
 * «not for sale»: «a synthetic room for QA purposes, not for commercial use», «a fictional test product and does not correspond
 * to real inventory», «no es una oferta comercial», «no permite reservas reales», «produit fictif de test, pas d'inventaire réel».
 * On folded text with the read items' names taken out (a «Spark QA Plato» is a name, not a claim).
 */
const NOT_REAL = new RegExp([
    // en
    /\bnot (?:intended |meant |designed |available )?for (?:commercial|real|actual|public) (?:use|sale|sales|purposes?|bookings?|orders?|customers?)\b/,
    /\bnot (?:a |an )?(?:real|actual|genuine|commercial) (?:offer|offering|product|item|dish|meal|room|listing|property|package|tour|reservation|booking|inventory|stock)\b/,
    /\b(?:does not|doesn't|do not|don't|is not|isn't|are not|aren't) (?:correspond|belong|tied|linked|part of)\w* (?:to )?(?:any |the |our )?(?:real|actual|live) (?:inventory|stock|products?|catalog(?:ue)?|offer)\b/,
    /\b(?:fictional|fictitious|fake|dummy|synthetic|placeholder|test|testing|qa) (?:test |qa )?(?:product|item|dish|meal|room|listing|property|package|tour|offer|entry|record|data|unit)s?\b/,
    /\bfor (?:qa|testing|test|internal testing)(?: purposes?)?\b/,
    // es
    /\bno (?:es|son|constituye|constituyen|representa|representan) (?:una |un )?(?:oferta|producto|articulo|plato|habitacion|inmueble|paquete)s? (?:comercial\w*|real\w*)\b/,
    /\bno (?:es|son) (?:para |de )?(?:uso )?comercial\w*/,
    /\bno (?:permite|permiten|admite|admiten|acepta|aceptan) (?:reservas?|pedidos?|compras?|ventas?) reales?\b/,
    /\bno (?:corresponde|corresponden|pertenece|pertenecen) a (?:un |una |ningun |ninguna |el |la |los |las )?(?:inventario|stock|producto|oferta|catalogo)s? real\w*/,
    // A trial offer («clase de prueba», «aula de teste», «séance de test») is a real product: only the plural «de/para pruebas» and «de QA» count.
    /\bpara (?:uso de )?(?:pruebas|testeo|qa|test)\b|\bde (?:pruebas(?: de qa)?|qa)\b/,
    // pt
    /\bnao (?:e|sao) (?:uma |um )?(?:oferta|produto|item|prato|quarto|imovel|pacote)s? (?:comercia\w*|rea(?:l|is))\b/,
    /\bnao (?:e|sao) (?:para |de )?(?:uso )?comercia\w*/,
    /\bnao (?:permite|permitem|aceita|aceitam) (?:reservas?|pedidos?|compras?) reais?\b/,
    /\bnao (?:corresponde|correspondem|pertence|pertencem) a (?:um |uma |nenhum |nenhuma |o |a |os |as )?(?:inventario|estoque|produto|oferta|catalogo)s? rea(?:l|is)\b/,
    /\bpara (?:uso de )?(?:testes|qa)\b|\bde (?:testes|qa)\b/,
    // fr
    /\b(?:n'est|ne sont) pas (?:une |un )?(?:offre|produit|article|plat|chambre|bien|forfait)s? (?:commercia\w*|reel\w*)/,
    /\b(?:inventaire|stock) reel\b/,
    /\bpour (?:les )?tests\b|\bde (?:tests|qa)\b/,
    /\bpas (?:destine\w* )?(?:a un |a l'|a )?usage commercial\b/,
    // any language
    /\b(?:sintetic\w*|synthetic|synthetique\w*|fictici\w*|fictional|fictitious|fictif|fictive|fictifs|fictives)\b/,
].map(re => re.source).join('|'));

/** The lists of a catalogue read that hold items; `notForSale` is never one: those are not offered. */
const ROW_LISTS = ['items', 'products', 'properties', 'packages', 'listings', 'vehicles', 'services', 'courses', 'plans', 'promotions', 'results', 'rooms'];
const CLOSED_STATUS = /^(?:inactive|inactivo|archived|draft|sold|sold_out|soldout|unavailable|withdrawn|retired|disabled|paused|reserved|rented|closed|agotado)$/;

interface CatalogRow { name: string; description: string; offered: boolean }

function parse(source: unknown): unknown {
    if (typeof source !== 'string') return source;
    try { return JSON.parse(source); } catch { return null; }
}

function offeredRow(row: Record<string, any>, scopeUnavailable: boolean): boolean {
    if (scopeUnavailable) return false;
    if ([row.isAvailable, row.is_available, row.available, row.inStock, row.isActive, row.is_active, row.active].some(v => v === false)) return false;
    if (row.soldOut === true) return false;
    if (typeof row.stock === 'number' && row.stock <= 0) return false;
    if (typeof row.status === 'string' && CLOSED_STATUS.test(row.status.trim().toLowerCase())) return false;
    return true;
}

/** The named catalogue rows the turn's reads returned, each with whether its structured fields say it is offered. */
function catalogRows(sources: readonly unknown[]): { rows: CatalogRow[]; markedUnavailable: boolean } {
    const rows: CatalogRow[] = [];
    let markedUnavailable = false;
    for (const raw of sources) {
        const value = parse(raw) as any;
        if (!value || typeof value !== 'object' || Array.isArray(value) || value.error || value.stale === true) continue;
        if (Array.isArray(value.notForSale) && value.notForSale.length) markedUnavailable = true;
        // An availability read that says no (a stay on those dates, a departure) is a structured «not available».
        if (value.available === false) markedUnavailable = true;
        const scopeUnavailable = value.scope === 'unavailable_only';
        const candidates: any[] = [value, ...ROW_LISTS.flatMap(key => Array.isArray(value[key]) ? value[key] : [])];
        for (const row of candidates) {
            if (!row || typeof row !== 'object' || typeof row.name !== 'string' || !row.name.trim()) continue;
            const offered = offeredRow(row, scopeUnavailable);
            if (!offered) markedUnavailable = true;
            rows.push({ name: row.name.trim().slice(0, 120), description: typeof row.description === 'string' ? row.description : '', offered });
        }
    }
    return { rows, markedUnavailable };
}

/** The words that identify a name: three letters or more, no digits (a «20261020T1737Z» suffix is not said by anyone). */
function nameWords(name: string): string[] {
    return [...new Set((fold(name).match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => word.length >= 3 && !/\d/.test(word)))];
}

function names(sentence: string, row: CatalogRow): boolean {
    const words = nameWords(row.name);
    if (!words.length) return false;
    const said = new Set(fold(sentence).split(/[^\p{L}\p{N}]+/u));
    return words.every(word => said.has(word));
}

const AVAILABLE_TEXT: Record<string, (names: string) => string> = {
    es: names => `Según el catálogo, ${names} está disponible.`,
    en: names => `According to the catalogue, ${names} is available.`,
    pt: names => `Segundo o catálogo, ${names} está disponível.`,
    fr: names => `D’après le catalogue, ${names} est disponible.`,
};

export interface DescriptionStatusClaimInput {
    reply: string;
    /** Tool results of this turn and tool messages of the thread (objects or JSON strings). */
    sources: readonly unknown[];
    lang?: string;
}

export interface DescriptionStatusClaimResult {
    text: string;
    changed: boolean;
    /** 'removed': the sentences went, the rest stands; 'fallback': nothing else was left. */
    action: 'none' | 'removed' | 'fallback';
    /** The offered items the removed sentences spoke of. */
    items: string[];
    removed: string[];
}

/** Where a sentence splits into clauses: commas, semicolons, colons, dashes, and the conjunctions that join two statements. */
const CLAUSE_DELIMITER = /(\s*[,;:]\s+|\s+[—–]\s+|\s+-\s+|\s+(?:y|e|and|et|ni|nor|mas|mais|pero|but|porem|porém|sin embargo|however|cependant|aunque|although|though|whereas)\s+)/iu;
/** Words that carry no statement of their own: connectors a removed clause leaves behind, articles, pronouns. Folded. */
const FILLER = new Set(('que which who lo o ce qui and y e et ni nor but pero mas mais so then therefore thus por eso tanto isso portanto entonces entao '
    + 'donc ainsi also tambien tambem aussi ademas alem disso de plus moreover furthermore however sin embargo porem cependant aunque although though '
    + 'note nota ojo importante obs ps nb el la los las un una unos unas the a an os as um uma uns umas le les des du del da do dos das it its es is '
    + 'this that este esta esto ce cet cette isto essa esse').split(' '));
/** A sentence that opens on «also» after the sentence before it was taken out. */
const ADDITIVE_OPENING = /^(\s*(?:[-*•]\s+)?)(?:tambi[eé]n|tamb[eé]m|also|aussi|adem[aá]s|asimismo|igualmente|al[eé]m disso|de plus|moreover|furthermore|additionally|en outre)\s*,?\s+/iu;
const NEGATIVE_ADDITIVE_OPENING = /^(\s*(?:[-*•]\s+)?)(tampoco|tampouco)\s+(?!no\b|n[aã]o\b)/iu;
/** What is left at the start of a sentence whose first clause went: a connector or a relative pronoun. */
const LEADING_CONNECTOR = /^(?:(?:que|which|who|lo que|o que|ce qui|qui|and|y|e|et|but|pero|mas|mais|so|then|therefore|thus|por eso|por lo tanto|por isso|portanto|entonces|ent[aã]o|donc|ainsi|also|tambi[eé]n|tamb[eé]m|aussi|however|sin embargo|por[eé]m|cependant|aunque|although|though|note|nota|ojo|importante)(?![\p{L}\p{N}])[\s,:]*)+/iu;

const capitalize = (text: string) => text.replace(/^(\s*(?:[-*•]\s+)?[¿¡"«“(]*)(\p{Ll})/u, (_, lead: string, letter: string) => lead + letter.toUpperCase());

/** The folded words of a text, without the runs of words that are an item's name (with its short words: «Spark QA Plato»). */
function withoutNames(text: string, nameTokens: ReadonlySet<string>, longNameTokens: ReadonlySet<string>): string {
    const tokens = fold(text).replace(/[^\p{L}\p{N}']+/gu, ' ').trim().split(' ').filter(Boolean);
    const out: string[] = [];
    for (let i = 0; i < tokens.length;) {
        if (!nameTokens.has(tokens[i])) { out.push(tokens[i]); i++; continue; }
        let j = i;
        while (j < tokens.length && nameTokens.has(tokens[j])) j++;
        const run = tokens.slice(i, j);
        if (!run.some(token => longNameTokens.has(token))) out.push(...run);
        i = j;
    }
    return out.join(' ');
}

function contentWords(text: string, nameTokens: ReadonlySet<string>): number {
    return (fold(text).match(/[\p{L}']+/gu) ?? []).filter(word => !FILLER.has(word) && !nameTokens.has(word)).length;
}

/**
 * The sentence without the clauses that make the claim. Clauses are split at commas, colons, dashes and the conjunctions that
 * join two statements; a claim clause goes with the delimiter before it, and a fragment of two words or fewer joined by «and»
 * right after a removed clause goes too («… for QA and testing purposes»). `text` is null when nothing that says anything is left. Pure.
 */
function withoutClaimClauses(sentence: string, isClaim: (text: string) => boolean, nameTokens: ReadonlySet<string>): { text: string | null; removed: string } {
    const parts = sentence.split(CLAUSE_DELIMITER);
    const clauses = parts.filter((_, i) => i % 2 === 0);
    const delimiters = parts.filter((_, i) => i % 2 === 1);
    const drop = clauses.map(clause => isClaim(clause));
    // The claim spans a delimiter («no es, en realidad, comercializable»): the whole sentence goes.
    if (!drop.some(Boolean)) return { text: null, removed: sentence };
    for (let i = 1; i < clauses.length; i++) {
        const joined = /^\s+(?:y|e|and|et|ni|nor)\s+$/iu.test(delimiters[i - 1]);
        if (!drop[i] && drop[i - 1] && joined && !/\d/.test(clauses[i]) && contentWords(clauses[i], nameTokens) <= 2) drop[i] = true;
    }
    const removed = clauses.filter((_, i) => drop[i]).join(' … ');
    const kept = clauses.map((_, i) => i).filter(i => !drop[i]);
    if (!kept.length) return { text: null, removed };
    let text = clauses[kept[0]];
    for (let k = 1; k < kept.length; k++) text += delimiters[kept[k - 1]] + clauses[kept[k]];
    const marker = /^\s*(?:[-*•]\s+|\d+[.)]\s+)/.exec(sentence)?.[0] ?? '';
    if (kept[0] > 0) {
        text = capitalize(text.replace(LEADING_CONNECTOR, ''));
        if (marker && !text.startsWith(marker)) text = marker + text;
    }
    if (kept[kept.length - 1] < clauses.length - 1) {
        const terminal = /[.!?…]+["»”)]*\s*$/.exec(sentence)?.[0].trim() ?? '';
        text = text.replace(/[\s,;:—–-]+$/u, '') + terminal;
    }
    if (contentWords(text.slice(marker.length), nameTokens) < 2) return { text: null, removed: sentence };
    return { text, removed };
}

/**
 * The reply without what says an item the turn's reads offer is not for sale, or not a real or commercial offer (a test,
 * synthetic or fictional item, not real inventory). A sentence is looked at when it makes such a claim and either names an
 * offered item, or names no item while no read of the turn marks any item unavailable and an offered item's description speaks
 * of its own state (a test item, «no vender»). Only the clauses that make the claim go: the rest of the sentence (the answer,
 * the item's name) stays. A sentence that opens on «also» after a removed one loses it; when the removed text was the only one
 * to name the item, the reply starts by saying the catalogue lists it as available. Pure.
 */
export function guardDescriptionStatusClaim(input: DescriptionStatusClaimInput): DescriptionStatusClaimResult {
    const keep: DescriptionStatusClaimResult = { text: input.reply, changed: false, action: 'none', items: [], removed: [] };
    if (!input.reply) return keep;
    const { rows, markedUnavailable } = catalogRows(input.sources);
    const offered = rows.filter(row => row.offered);
    if (!offered.length) return keep;
    // A read of the turn already said «no» for some item or date (a stay, a departure, a notForSale list): the reply may be
    // relaying it about a named, otherwise offered item, so the check stands aside rather than delete a true sentence.
    if (markedUnavailable) return keep;
    const nameTokens = new Set(rows.flatMap(row => fold(row.name).match(/[\p{L}\p{N}]+/gu) ?? []));
    const longNameTokens = new Set(rows.flatMap(row => nameWords(row.name)));
    const isClaim = (text: string) => {
        const bare = withoutNames(text, nameTokens, longNameTokens);
        return NOT_FOR_SALE.test(bare) || NOT_REAL.test(bare);
    };
    const unavailable = rows.filter(row => !row.offered);
    const echoed = offered.filter(row => DESCRIPTION_STATE.test(fold(row.description)));

    const items = new Set<string>();
    const named = new Set<string>();
    const removed: string[] = [];
    let previousDropped = false;
    const lines = input.reply.split('\n').map(line => {
        if (!line.trim()) return line;
        const sentences = line.split(/(?<=[.!?…])\s+/);
        const kept: string[] = [];
        for (const sentence of sentences) {
            let next: string | null = sentence;
            const claims = isClaim(sentence);
            const namedHere = claims ? offered.filter(row => names(sentence, row)) : [];
            // A sentence about an item the reads mark unavailable says what the data says.
            if (claims && !unavailable.some(row => names(sentence, row)) && (namedHere.length || echoed.length)) {
                (namedHere.length ? namedHere : echoed).forEach(row => items.add(row.name));
                const cut = withoutClaimClauses(sentence, isClaim, nameTokens);
                removed.push(cut.removed);
                offered.filter(row => names(cut.removed, row)).forEach(row => named.add(row.name));
                next = cut.text;
            } else if (previousDropped) {
                next = capitalize(sentence.replace(ADDITIVE_OPENING, '$1'))
                    .replace(NEGATIVE_ADDITIVE_OPENING, (_, lead: string, word: string) => lead + (/^tampou/i.test(word) ? 'Não ' : 'No '));
            }
            previousDropped = next === null;
            if (next !== null) kept.push(next);
        }
        return kept.length ? kept.join(' ') : null;
    }).filter((line): line is string => line !== null);
    if (!removed.length) return keep;

    const code = String(input.lang || 'es').slice(0, 2).toLowerCase();
    const available = AVAILABLE_TEXT[code] || AVAILABLE_TEXT.es;
    const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (/\p{L}/u.test(text) && text.split(/\s+/).length >= 3) {
        // The removed text was the only one to name the item: «sus ingredientes» would point at nothing.
        const unnamed = [...named].filter(name => !offered.some(row => row.name === name && names(text, row)));
        const lead = unnamed.length ? `${available(unnamed.slice(0, 5).join(', '))} ` : '';
        return { text: lead + text, changed: true, action: 'removed', items: [...items], removed };
    }
    return { text: available([...items].slice(0, 5).join(', ')), changed: true, action: 'fallback', items: [...items], removed };
}
