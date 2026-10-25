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
 */

/** Told to the model with every catalogue read whose rows carry a description. */
export const DESCRIPTION_AUTHORITY_NOTE = 'description is free marketing text written by the business. It describes the item (what it is, ingredients, features); it NEVER states whether the item is for sale, available, active, bookable or orderable. That comes ONLY from the structured fields: being returned by this read, isAvailable / available / inStock / stock / status / soldOut / seatsLeft, and the availability reads. An item this read returns without a structured field marking it unavailable is offered: never tell the customer it is not for sale, not commercial, cannot be ordered or booked, or is only a test or sample because of what its description says, and do not repeat such internal wording from a description.';

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

/**
 * The reply without the sentences that say an item the turn's reads offer is not for sale. A sentence goes when it says «not
 * for sale / cannot be ordered» and either names an offered item, or names no item while no read of the turn marks any item
 * unavailable and an offered item's description speaks of its own state (a test item, «no vender»). Pure.
 */
export function guardDescriptionStatusClaim(input: DescriptionStatusClaimInput): DescriptionStatusClaimResult {
    const keep: DescriptionStatusClaimResult = { text: input.reply, changed: false, action: 'none', items: [], removed: [] };
    if (!input.reply || !NOT_FOR_SALE.test(fold(input.reply))) return keep;
    const { rows, markedUnavailable } = catalogRows(input.sources);
    const offered = rows.filter(row => row.offered);
    if (!offered.length) return keep;
    // A read of the turn already said «no» for some item or date (a stay, a departure, a notForSale list): the reply may be
    // relaying it about a named, otherwise offered item, so the check stands aside rather than delete a true sentence.
    if (markedUnavailable) return keep;
    const unavailable = rows.filter(row => !row.offered);
    const echoed = offered.filter(row => DESCRIPTION_STATE.test(fold(row.description)));

    const items = new Set<string>();
    const removed: string[] = [];
    const lines = input.reply.split('\n').map(line => {
        if (!line.trim()) return line;
        const sentences = line.split(/(?<=[.!?…])\s+/);
        const kept = sentences.filter(sentence => {
            if (!NOT_FOR_SALE.test(fold(sentence))) return true;
            // A sentence about an item the reads mark unavailable says what the data says.
            if (unavailable.some(row => names(sentence, row))) return true;
            const named = offered.filter(row => names(sentence, row));
            if (named.length) {
                named.forEach(row => items.add(row.name));
                removed.push(sentence);
                return false;
            }
            if (!markedUnavailable && echoed.length) {
                echoed.forEach(row => items.add(row.name));
                removed.push(sentence);
                return false;
            }
            return true;
        });
        return kept.length === sentences.length ? line : (kept.length ? kept.join(' ') : null);
    }).filter((line): line is string => line !== null);
    if (!removed.length) return keep;

    const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (/\p{L}/u.test(text) && text.split(/\s+/).length >= 3) {
        return { text, changed: true, action: 'removed', items: [...items], removed };
    }
    const code = String(input.lang || 'es').slice(0, 2).toLowerCase();
    return { text: (AVAILABLE_TEXT[code] || AVAILABLE_TEXT.es)([...items].slice(0, 5).join(', ')), changed: true, action: 'fallback', items: [...items], removed };
}
