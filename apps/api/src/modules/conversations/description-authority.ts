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
 *
 * Second follow-up (production after #217, 03d9fae9):
 *  - en hotel «According to the catalogue, Spark QA Habitacion 20261018T113247Z is available. The room accommodates…», fr real
 *    estate «D'après le catalogue, Spark QA Inmueble 20261018T2220Z est disponible. Dans la ville de Spark QA Ciudad. Il dispose
 *    de 2 chambres…»: the availability sentence was put in front whenever the removed text was the only one to name the item,
 *    with the record's technical suffix. The item is named again only where the first sentence left needs it (it opens on «it /
 *    il / ele / its / sus…», or carries «sus / its / ses / dele» of the item), inside that sentence, by its spoken name
 *    (`spokenItemName`: no «20261018T113247Z» / date suffix). A clause left without its verb («dans la ville de Spark QA
 *    Ciudad», the complement of the removed «est un bien fictif de test») joins the next sentence («Dans la ville de Spark QA
 *    Ciudad, Spark QA Inmueble dispose de 2 chambres») or the one before, instead of standing as a sentence;
 *  - en tour «It is not a commercial offer and does not allow real bookings.» was sent as «Does not allow real bookings.»: «does
 *    not allow / accept real bookings», «ne permet pas de réservations réelles», «não permite fazer reservas reais» are the claim
 *    too, and a predicate left after its removed subject clause («It is a test tour and does not include transport») gets the
 *    subject back («It does not include transport»).
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
    /\b(?:does not|doesn't|do not|don't|cannot|can't|can not|will not|won't) (?:allow|accept|take|support|permit|admit|enable|process) (?:any )?(?:real|actual|genuine) (?:bookings?|reservations?|orders?|purchases?|sales?|transactions?)\b/,
    /\bnot (?:a |an )?(?:real|actual|genuine|commercial) (?:offer|offering|product|item|dish|meal|room|listing|property|package|tour|reservation|booking|inventory|stock)\b/,
    /\b(?:does not|doesn't|do not|don't|is not|isn't|are not|aren't) (?:correspond|belong|tied|linked|part of)\w* (?:to )?(?:any |the |our )?(?:real|actual|live) (?:inventory|stock|products?|catalog(?:ue)?|offer)\b/,
    /\b(?:fictional|fictitious|fake|dummy|synthetic|placeholder|test|testing|qa) (?:test |qa )?(?:product|item|dish|meal|room|listing|property|package|tour|offer|entry|record|data|unit)s?\b/,
    /\bfor (?:qa|testing|test|internal testing)(?: purposes?)?\b/,
    // es
    /\bno (?:es|son|constituye|constituyen|representa|representan) (?:una |un )?(?:oferta|producto|articulo|plato|habitacion|inmueble|paquete)s? (?:comercial\w*|real\w*)\b/,
    /\bno (?:es|son) (?:para |de )?(?:uso )?comercial\w*/,
    /\bno (?:permite|permiten|admite|admiten|acepta|aceptan) (?:hacer |realizar )?(?:reservas?|pedidos?|compras?|ventas?) reales?\b/,
    /\bno (?:corresponde|corresponden|pertenece|pertenecen) a (?:un |una |ningun |ninguna |el |la |los |las )?(?:inventario|stock|producto|oferta|catalogo)s? real\w*/,
    // A trial offer («clase de prueba», «aula de teste», «séance de test») is a real product: only the plural «de/para pruebas» and «de QA» count.
    /\bpara (?:uso de )?(?:pruebas|testeo|qa|test)\b|\bde (?:pruebas(?: de qa)?|qa)\b/,
    // pt
    /\bnao (?:e|sao) (?:uma |um )?(?:oferta|produto|item|prato|quarto|imovel|pacote)s? (?:comercia\w*|rea(?:l|is))\b/,
    /\bnao (?:e|sao) (?:para |de )?(?:uso )?comercia\w*/,
    /\bnao (?:permite|permitem|aceita|aceitam|admite|admitem) (?:fazer |realizar )?(?:reservas?|pedidos?|compras?|vendas?) reais?\b/,
    /\bnao (?:corresponde|correspondem|pertence|pertencem) a (?:um |uma |nenhum |nenhuma |o |a |os |as )?(?:inventario|estoque|produto|oferta|catalogo)s? rea(?:l|is)\b/,
    /\bpara (?:uso de )?(?:testes|qa)\b|\bde (?:testes|qa)\b/,
    // fr
    /\b(?:n'est|ne sont) pas (?:une |un )?(?:offre|produit|article|plat|chambre|bien|forfait)s? (?:commercia\w*|reel\w*)/,
    /\b(?:inventaire|stock) reel\b/,
    /\bne (?:permet|permettent|accepte|acceptent|prend|prennent|autorise|autorisent) pas (?:de |d'|les |des )?(?:faire |passer |effectuer )?(?:de |d'|des )?(?:(?:reservations?|commandes?|achats?|ventes?) reel\w*|(?:vrai\w*|veritable\w*) (?:reservations?|commandes?|achats?|ventes?))/,
    /\bpour (?:les )?tests\b|\bde (?:tests|qa)\b/,
    /\bpas (?:destine\w* )?(?:a un |a l'|a )?usage commercial\b/,
    // any language
    /\b(?:sintetic\w*|synthetic|synthetique\w*|fictici\w*|fictional|fictitious|fictif|fictive|fictifs|fictives)\b/,
].map(re => re.source).join('|'));

/** The lists of a catalogue read that hold items; `notForSale` is never one: those are not offered. */
const ROW_LISTS = ['items', 'products', 'properties', 'packages', 'listings', 'vehicles', 'services', 'courses', 'plans', 'promotions', 'results', 'rooms'];
const CLOSED_STATUS = /^(?:inactive|inactivo|archived|draft|sold|sold_out|soldout|unavailable|withdrawn|retired|disabled|paused|reserved|rented|closed|agotado)$/;

/** `labels`: the row's place fields (address, city, zone…), said as they are like its name, never a claim. */
interface CatalogRow { name: string; description: string; offered: boolean; labels?: string[] }

/** Where a record is: the business writes these, and a QA or real one may hold any word («Direccion sintetica QA»). */
const PLACE_FIELDS = ['address', 'city', 'location', 'location_address', 'locationAddress', 'neighborhood', 'zone', 'district', 'destination', 'departure_location', 'departureLocation', 'street', 'country', 'state'];

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
            const labels = PLACE_FIELDS.map(key => row[key]).filter((v): v is string => typeof v === 'string' && !!v.trim()).map(v => v.trim().slice(0, 120));
            rows.push({ name: row.name.trim().slice(0, 120), description: typeof row.description === 'string' ? row.description : '', offered, labels });
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

/**
 * A record name as the customer would say it: without the technical stamp QA and import tooling append («Spark QA Habitacion
 * 20261018T113247Z», «… 2026-10-18», «… 20261018»). Only such a stamp at the end goes («iPhone 15», «Tour 2» stay). Pure.
 */
const TECHNICAL_SUFFIX = /(?:[\s_-]+(?:\d{8}T\d{4,6}(?:\.\d+)?Z?|\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:?\d{2}(?::?\d{2})?(?:\.\d+)?Z?)?|\d{8,}))+\s*$/i;
export function spokenItemName(name: string): string {
    const spoken = String(name ?? '').replace(TECHNICAL_SUFFIX, '').trim();
    return spoken || String(name ?? '').trim();
}

/** «As for X, …»: names the item at the head of a sentence whose possessive («sus ingredientes», «its price») points at it. */
const AS_FOR: Record<string, (name: string) => string> = {
    es: name => `En cuanto a ${name}, `,
    en: name => `As for ${name}, `,
    pt: name => `Quanto a ${name}, `,
    fr: name => `Quant à ${name}, `,
};
/** A subject pronoun opening the sentence that stands for the item: replaced by its name. Impersonal uses are not the item. */
const SUBJECT_PRONOUN: Record<string, RegExp> = {
    es: /^(?:él|ella)\s+/iu,
    en: /^(?:it(?:'s|’s| is)|it)\s+(?!(?:is |'s |’s )?(?:important|possible|necessary|recommended|advisable|best|better|worth|a good idea|likely|unlikely|seems|looks|depends|appears)\b)/iu,
    pt: /^(?:ele|ela)\s+/iu,
    fr: /^(?:il|elle|c'est|c’est)\s+(?!(?:y a|faut|est (?:possible|important|nécessaire|necessaire|recommandé|recommande|conseillé|conseille|préférable|preferable))\b)/iu,
};
/** A possessive of the item at the start («Its price», «Sus ingredientes», «Ses chambres»). */
const LEADING_POSSESSIVE: Record<string, RegExp> = {
    es: /^(?:su|sus)\s/iu,
    en: /^(?:its|their)\s/iu,
    pt: /^(?:seu|sua|seus|suas)\s/iu,
    fr: /^(?:son|sa|ses|leur|leurs)\s/iu,
};
/** A possessive of the item further in («no hay información sobre sus ingredientes»). pt «seu/sua» is the customer's «your»: only «dele/dela». */
const INNER_POSSESSIVE: Record<string, RegExp> = {
    es: /(?<![\p{L}\p{N}])(?:su|sus)\s/iu,
    // «on its way» is an idiom, not the item's (production QA 25-oct: «…so it is not on its way» got «As for Spark QA Plato, …»).
    en: /(?<![\p{L}\p{N}])(?:its|their)\s(?!way\b)/iu,
    pt: /(?<![\p{L}\p{N}])(?:dele|dela|deles|delas)(?![\p{L}\p{N}])/iu,
    fr: /(?<![\p{L}\p{N}])(?:ses|leurs?)\s/iu,
};

/** The first letter of a sentence lowered when it is an ordinary word (not «I», an acronym or a name). */
function lowerFirst(text: string): string {
    return text.replace(/^(\s*)(\p{Lu})(\p{Ll}*)(?![\p{L}\p{N}])/u, (all, lead: string, first: string, rest: string) =>
        rest.length >= 1 ? lead + first.toLowerCase() + rest : all);
}

/**
 * The sentence with the item named where a pronoun of it opens it: «It costs…» → «Spark QA Habitacion costs…», «Il dispose…» →
 * «Spark QA Inmueble dispose…», «Its price…» → «Spark QA Plato's price…». Null when it does not open on one. Pure.
 */
function namedSubject(sentence: string, name: string, lang: string): string | null {
    const marker = /^\s*(?:[-*•]\s+)?/.exec(sentence)?.[0] ?? '';
    const body = sentence.slice(marker.length);
    const subject = SUBJECT_PRONOUN[lang]?.exec(body);
    if (subject) {
        const word = subject[0].trim().toLowerCase();
        const verb = /^(?:it's|it’s|it is)$/.test(word) ? 'is ' : /^c['’]est$/.test(word) ? 'est ' : '';
        return marker + name + ' ' + verb + body.slice(subject[0].length);
    }
    if (lang === 'en' && /^its\s/i.test(body)) return marker + `${name}’s ` + body.slice(4);
    return null;
}

/**
 * The first sentence of what is left, with the item named when it needs it: it opens on a pronoun of the item, or carries a
 * possessive of it («sus ingredientes»), and does not name it. A question, or a sentence that already names it, stays. Pure.
 */
function withAntecedent(text: string, name: string, lang: string): string {
    const end = /[.!?…]+["»”)]*(?=\s|$)/u.exec(text);
    const first = end ? text.slice(0, end.index + end[0].length) : text;
    const rest = text.slice(first.length);
    if (/\?\s*$/.test(first) || names(first, { name, description: '', offered: true })) return text;
    const subject = namedSubject(first, name, lang);
    if (subject) return subject + rest;
    const marker = /^\s*(?:[-*•]\s+)?/.exec(first)?.[0] ?? '';
    const body = first.slice(marker.length);
    if (!LEADING_POSSESSIVE[lang]?.test(body) && !INNER_POSSESSIVE[lang]?.test(body)) return text;
    return marker + (AS_FOR[lang] ?? AS_FOR.es)(name) + lowerFirst(body) + rest;
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
/** A sentence that opens on «however» after the sentence it contrasted with was taken out. Not pt «mais» («more»). */
const CONTRASTIVE_OPENING = /^(\s*(?:[-*•]\s+)?)(?:however|but|sin embargo|no obstante|pero|por[eé]m|contudo|no entanto|cependant|toutefois|pourtant)\s*,?\s+/iu;
const NEGATIVE_ADDITIVE_OPENING = /^(\s*(?:[-*•]\s+)?)(tampoco|tampouco)\s+(?!no\b|n[aã]o\b)/iu;
/** What is left at the start of a sentence whose first clause went: a connector or a relative pronoun. */
const LEADING_CONNECTOR = /^(?:(?:que|which|who|lo que|o que|ce qui|qui|and|y|e|et|but|pero|mas|mais|so|then|therefore|thus|por eso|por lo tanto|por isso|portanto|entonces|ent[aã]o|donc|ainsi|also|tambi[eé]n|tamb[eé]m|aussi|however|sin embargo|por[eé]m|cependant|aunque|although|though|note|nota|ojo|importante)(?![\p{L}\p{N}])[\s,:]*)+/iu;

/** A clause that opens on its verb: the predicate of a subject said in the clause before it («… and does not include transport»). */
const SUBJECTLESS = /^(?:does|doesn't|doesn’t|do|don't|don’t|cannot|can't|can’t|can|has|have|is|are|includes?|offers?|costs?|comes|features|no|tiene|tienen|incluye|incluyen|cuesta|ofrece|está|esta|não|nao|tem|têm|inclui|custa|oferece|é|ne|n'|n’|comprend|inclut|coûte|offre|dispose|propose|est)(?![\p{L}])/iu;
/** The subject of a copular clause: «It» in «It is not a commercial offer», «The Spark QA Plato» in «The Spark QA Plato is a test dish». */
const COPULA_SUBJECT = /^\s*(\p{L}.*?)\s+(?:is|are|es|son|está|están|é|são|est|sont)(?![\p{L}])/iu;
/** A clause that opens on a preposition or a participle of place: no verb of its own («dans la ville de X», «located in X»). */
const VERBLESS_OPENING = /^\s*(?:dans|en|à|au|aux|sur|près|pres|chez|in|at|on|near|inside|within|with|con|cerca|junto|em|na|nas|nos|perto|com|situé\w*|situe\w*|située?s?|located|situated|ubicad\w*|situad\w*|localizad\w*)(?![\p{L}])/iu;

/**
 * F4300-35 residue (production 25-oct): «includes a virtual tour and a synthetic guide, but does not include …» lost the claim
 * clause and was sent as «Inclui um percurso virtual e mas não inclui …» / «Incluant un parcours virtuel et mais excluant …»: the
 * «and» that joined the removed clause stayed right before the «but» of the next one. An additive connector left in front of a
 * contrastive one goes, and the contrast keeps a comma («…virtual, mas não inclui …»). pt «e mais» («and more») is not a pair.
 */
const ORPHAN_ADDITIVE = /\s*,?\s+(?:y|e|and|et)\s*,?\s+(?=(pero|but|mas|mais|por[eé]m|contudo|todavia|no entanto|sin embargo|no obstante|however|cependant|toutefois|pourtant)(?![\p{L}\p{N}]))/giu;
/**
 * A connector left at the end of what is kept, right before the sentence's punctuation («Incluye un tour virtual y.»). Lowercase
 * only: «Contiene vitamina E.» ends on a name, not on «e».
 */
const TRAILING_CONNECTOR = /(?:[\s,;:]+(?:y|e|and|et|ni|nor|or|ou|pero|but|mas|mais|por[eé]m|sin embargo|however|cependant|also|tambi[eé]n|tamb[eé]m|aussi|adem[aá]s))+(?=[\s,;:]*[.!?…]*["»”)]*\s*$)/u;

const CONTRASTIVE_DELIMITER = /^\s+(?:mas|mais|pero|but|porem|porém|sin embargo|however|cependant)\s+$/iu;

/** The kept text without a connector the removed clause left orphaned. Pure. */
function withoutOrphanConnectors(text: string): string {
    return text
        .replace(ORPHAN_ADDITIVE, (all: string, contrast: string) => (/^\s*,?\s+e\s/iu.test(all) && /^mais$/i.test(contrast) ? all : ', '))
        .replace(TRAILING_CONNECTOR, '');
}

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
function withoutClaimClauses(sentence: string, isClaim: (text: string) => boolean, nameTokens: ReadonlySet<string>): { text: string | null; removed: string; fragment?: boolean } {
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
    for (let k = 1; k < kept.length; k++) {
        // «A and [claim] but C»: the contrast before C is what joins what is left, not the «and» of the removed clause.
        const before = delimiters[kept[k] - 1];
        const joint = kept[k] - kept[k - 1] > 1 && CONTRASTIVE_DELIMITER.test(before) && /^\s+(?:y|e|and|et)\s+$/iu.test(delimiters[kept[k - 1]])
            ? before : delimiters[kept[k - 1]];
        text += joint + clauses[kept[k]];
    }
    const marker = /^\s*(?:[-*•]\s+|\d+[.)]\s+)/.exec(sentence)?.[0] ?? '';
    let fragment = false;
    if (kept[0] > 0) {
        const bare = text.replace(LEADING_CONNECTOR, '');
        // «It is not a commercial offer and does not include transport»: the predicate gets its subject back.
        const subject = drop[kept[0] - 1] && /^\s+(?:y|e|and|et)\s+$/iu.test(delimiters[kept[0] - 1]) && SUBJECTLESS.test(bare)
            ? COPULA_SUBJECT.exec(clauses[kept[0] - 1].slice(marker.length))?.[1] : undefined;
        if (subject && subject.split(/\s+/).length <= 6) text = capitalize(subject) + ' ' + lowerFirst(bare);
        else {
            text = capitalize(bare);
            // «…est un bien fictif de test, dans la ville de X.»: the complement of the removed clause, with no verb of its own.
            fragment = kept.length === 1 && /^\s*[,;:]\s+$/.test(delimiters[kept[0] - 1]) && VERBLESS_OPENING.test(bare)
                && bare.split(/\s+/).length <= 12;
        }
        if (marker && !text.startsWith(marker)) text = marker + text;
    }
    if (kept[kept.length - 1] < clauses.length - 1) {
        const terminal = /[.!?…]+["»”)]*\s*$/.exec(sentence)?.[0].trim() ?? '';
        text = text.replace(/[\s,;:—–-]+$/u, '') + terminal;
    }
    text = withoutOrphanConnectors(text);
    if (contentWords(text.slice(marker.length), nameTokens) < 2) return { text: null, removed: sentence };
    return { text, removed, fragment };
}

/**
 * The reply without what says an item the turn's reads offer is not for sale, or not a real or commercial offer (a test,
 * synthetic or fictional item, not real inventory). A sentence is looked at when it makes such a claim and either names an
 * offered item, or names no item while no read of the turn marks any item unavailable and an offered item's description speaks
 * of its own state (a test item, «no vender»). Only the clauses that make the claim go: the rest of the sentence (the answer,
 * the item's name) stays. A sentence that opens on «also» after a removed one loses it; when the removed text was the only one
 * to name the item and the first sentence left points at it («It costs…», «sus ingredientes»), that sentence names it (by its
 * spoken name). Only when nothing is left does the reply say the catalogue lists it as available. Pure.
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
    // A place field is said like a name: «Direccion sintetica QA» is where the hotel is, not a claim that it is synthetic.
    const nameTokens = new Set(rows.flatMap(row => [row.name, ...(row.labels ?? [])].flatMap(text => fold(text).match(/[\p{L}\p{N}]+/gu) ?? [])));
    const longNameTokens = new Set(rows.flatMap(row => [row.name, ...(row.labels ?? [])].flatMap(text => nameWords(text))));
    const isClaim = (text: string) => {
        const bare = withoutNames(text, nameTokens, longNameTokens);
        return NOT_FOR_SALE.test(bare) || NOT_REAL.test(bare);
    };
    const unavailable = rows.filter(row => !row.offered);
    const echoed = offered.filter(row => DESCRIPTION_STATE.test(fold(row.description)));

    const code = String(input.lang || 'es').slice(0, 2).toLowerCase();
    const lang = AVAILABLE_TEXT[code] ? code : 'es';
    const items = new Set<string>();
    const named = new Set<string>();
    const removed: string[] = [];
    let previousDropped = false;
    /** Whether a removal came before (or inside) the first sentence the reply keeps: only then can its pronouns point at nothing. */
    let firstKeptAfterRemoval: boolean | null = null;
    /** The one item the removed text named, by its spoken name, when it is a single one. */
    const soleNamed = () => named.size === 1 ? spokenItemName([...named][0]) : null;
    const lines = input.reply.split('\n').map(line => {
        if (!line.trim()) return line;
        const sentences = line.split(/(?<=[.!?…])\s+/);
        const kept: string[] = [];
        let fragment: string | null = null;
        for (const sentence of sentences) {
            let next: string | null = sentence;
            let isFragment = false;
            const claims = isClaim(sentence);
            const namedHere = claims ? offered.filter(row => names(sentence, row)) : [];
            // A sentence about an item the reads mark unavailable says what the data says.
            if (claims && !unavailable.some(row => names(sentence, row)) && (namedHere.length || echoed.length)) {
                (namedHere.length ? namedHere : echoed).forEach(row => items.add(row.name));
                const cut = withoutClaimClauses(sentence, isClaim, nameTokens);
                removed.push(cut.removed);
                offered.filter(row => names(cut.removed, row)).forEach(row => named.add(row.name));
                next = cut.text;
                isFragment = !!cut.fragment;
            } else if (previousDropped) {
                next = capitalize(sentence.replace(ADDITIVE_OPENING, '$1').replace(CONTRASTIVE_OPENING, '$1'))
                    .replace(NEGATIVE_ADDITIVE_OPENING, (_, lead: string, word: string) => lead + (/^tampou/i.test(word) ? 'Não ' : 'No '));
            }
            previousDropped = next === null;
            if (next !== null && fragment !== null && !/\?["»”)]*\s*$/.test(next)) {
                // The verbless complement leads the next sentence: «Dans la ville de X, Spark QA Inmueble dispose de 2 chambres.»
                const name = soleNamed();
                const subject = name ? namedSubject(next, name, lang) : null;
                next = fragment.replace(/[.!?…]+["»”)]*\s*$/u, '') + ', ' + (subject ?? lowerFirst(next));
                fragment = null;
            }
            if (next !== null && isFragment) { fragment = next; continue; }
            if (next !== null) {
                if (firstKeptAfterRemoval === null) firstKeptAfterRemoval = removed.length > 0;
                kept.push(next);
            }
        }
        if (fragment !== null && kept.length) {
            // Nothing after it on the line: it closes the sentence before («…, dans la ville de X.»).
            const last = kept.length - 1;
            const terminal = /[.!?…]+["»”)]*\s*$/u.exec(kept[last])?.[0] ?? '.';
            if (!/\?/.test(terminal)) kept[last] = kept[last].slice(0, kept[last].length - terminal.length) + ', ' + lowerFirst(fragment);
        }
        return kept.length ? kept.join(' ') : null;
    }).filter((line): line is string => line !== null);
    if (!removed.length) return keep;

    const available = AVAILABLE_TEXT[lang];
    let text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (/\p{L}/u.test(text) && text.split(/\s+/).length >= 3) {
        // The removed text was the only one to name the item: «sus ingredientes», «It costs…» would point at nothing. The item
        // is named in that sentence, by its spoken name; nothing is put in front of a sentence that needs no antecedent.
        const name = soleNamed();
        if (name && firstKeptAfterRemoval) text = withAntecedent(text, name, lang);
        return { text, changed: true, action: 'removed', items: [...items], removed };
    }
    return { text: available([...items].slice(0, 5).map(spokenItemName).join(', ')), changed: true, action: 'fallback', items: [...items], removed };
}
