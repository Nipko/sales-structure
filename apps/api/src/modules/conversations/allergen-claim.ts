import { humanOfferQuestionText } from './human-offer';

/**
 * F4300-26 (health). A restaurant whose only dish has `allergens: []` and `tags: []` was described as «no contiene
 * lácteos según la información disponible», «podría ser adecuado» for a lactose intolerance, «a gluten-free option» for
 * a celiac customer and «does not list nuts as an allergen… Would you like to proceed?». An empty allergen list means the
 * business recorded nothing, never that the dish is free of anything.
 *
 * A reply may say an item is FREE of an allergen, or SAFE / SUITABLE for an allergy or intolerance, only when the data
 * the turn holds for that item says so explicitly: a tag or dietary label of the business that names the allergen as
 * absent («gluten_free», «sin lactosa», «apto celíacos»), and no recorded allergen of that same family. Anything else is
 * replaced, deterministically, by the honest sentence: the business has not registered that information (or records the
 * allergen), and the customer confirms with the business before consuming it.
 *
 * The claim is recognised as a family, not as sentences: a free-of marker (sin, libre de, sem, sans, without, -free), a
 * negated containment verb (no contiene, does not list, não contém, ne contient pas) or an aptness word (apto, safe,
 * suitable, adequado) followed by a word of the allergen lexicon, read by its root in es/en/pt/fr.
 */

export type AllergenFamily = 'gluten' | 'dairy' | 'nuts' | 'peanut' | 'shellfish' | 'egg' | 'soy' | 'fish' | 'sesame' | 'any';

/** Roots per family, on folded text (no accents, lower case). `any` is the word «allergen» / «allergic» itself. */
const FAMILY_ROOTS: Record<AllergenFamily, string> = {
    gluten: 'gluten\\w*|glutem|trigo|wheat|ble|tacc|celiac\\w*|celiaq\\w*|coeliac\\w*|coeliaq\\w*',
    dairy: 'lact\\w*|leche\\w*|milk|dairy|leite|lait|laitiers?|latic\\w*',
    nuts: 'nuez|nueces|nuts?|noix|noz|nozes|frutos? secos?|almendras?|almonds?|avellanas?|hazelnuts?|castanhas?|fruits? a coques?',
    peanut: 'mani|manies|cacahuetes?|cacahuates?|peanuts?|amendoi\\w*|arachides?',
    shellfish: 'marisco\\w*|shellfish|crustace\\w*|fruits? de mer|frutos? do mar|camaron\\w*|shrimps?|crevettes?',
    egg: 'huevos?|eggs?|ovos?|oeufs?',
    soy: 'soya|soja|soy',
    fish: 'pescados?|fish|peixes?|poissons?',
    sesame: 'sesamo|sesame|ajonjoli|gergelim',
    any: 'alerg\\w*|allerg\\w*|intoleran\\w*',
};
const FAMILY_RES = Object.entries(FAMILY_ROOTS).map(([family, roots]) => [family as AllergenFamily, new RegExp(`^(?:${roots})$`)] as const);
const ALLERGEN = `(?:${Object.values(FAMILY_ROOTS).join('|')})`;

/** Determiners and quantifiers that may stand between the marker and the allergen («no contiene ningún tipo de gluten»). */
const GAP = '(?:(?:ningun\\w*|nenhum\\w*|aucun\\w*|any|no|ni|nada|pas|point|de|del|d|la|el|los|las|um|uma|o|a|os|as|du|des|le|les|tipo|type|of|rastros?|trazas?|traces?|vestigios?)\\s+){0,4}';
/** The allergen is followed by «registrado / informed / listed»: that speaks of the record, not of the dish. */
const NOT_RECORD = '(?!\\s+(?:\\w+\\s+)?(?:registrad\\w*|informad\\w*|declarad\\w*|cargad\\w*|documentad\\w*|cadastrad\\w*|recorded|registered|informed|declared|on file|enregistr\\w*|renseign\\w*|indiqu\\w*))';
const CONTAIN = '(?:conten\\w*|contien\\w*|contain\\w*|contem|contenh\\w*|contient\\w*|llev\\w*|lev\\w*|tien\\w*|tem|tenha|has|have|had|incluy\\w*|inclu\\w*|list\\w*|carr\\w*|tra[ei]\\w*|use\\w*|usa\\w*|utiliz\\w*|comport\\w*|possed\\w*|a|ont)';
const NEGATION = '(?:no|nao|not|never|nunca|jamais|ne|n|doesn t|don t|didn t|isn t|aren t|won t)';
const CLITIC = '(?:(?:se|le|les|lo|la|nos|en|y|really|actually|realmente)\\s+)?';

const CLAIMS: RegExp[] = [
    // sin gluten · libre de lácteos · sem glúten · sans arachides · without nuts · free of dairy
    new RegExp(`\\b(?:sin|sem|sans|without|libres? de|livres? de|exent[oa]s? de|isent[oa]s? de|exempts? de|free (?:of|from))\\s+${GAP}(${ALLERGEN})\\b${NOT_RECORD}`, 'g'),
    // gluten-free · dairy free · nut-free · gluten friendly
    new RegExp(`\\b(${ALLERGEN})\\s*(?:free|frei|friendly|safe)\\b`, 'g'),
    // no contiene lácteos · does not list nuts · não contém glúten · ne contient pas de lactose · n'a pas de gluten
    new RegExp(`\\b${NEGATION}\\s+${CLITIC}(?:\\w+\\s+)?${CONTAIN}\\s+${GAP}(${ALLERGEN})\\b${NOT_RECORD}`, 'g'),
    // contains no dairy · has zero gluten · não tem nenhum glúten
    new RegExp(`\\b${CONTAIN}\\s+(?:no|zero|cero|nenhum\\w*|ningun\\w*|aucun\\w*|nada de|pas de)\\s+${GAP}(${ALLERGEN})\\b${NOT_RECORD}`, 'g'),
    // apto para celíacos · safe for people with a nut allergy · adequado para intolerantes à lactose · convient aux allergiques
    new RegExp(`\\b(?:apt[oa]s?|adecuad[oa]s?|segur[oa]s?|safe|suitable|okay|ok|fine|adequad[oa]s?|indicad[oa]s?|recomendad[oa]s?|sure?s?|adapte\\w*|convien\\w*|conviene)\\s+(?:para|for|pour|pra|au|aux)\\s+(?:\\w+\\s+){0,3}?(${ALLERGEN})\\b`, 'g'),
    // apto celíacos (no preposition)
    new RegExp(`\\b(?:apt[oa]s?|adecuad[oa]s?|adequad[oa]s?)\\s+(${ALLERGEN})\\b`, 'g'),
];

/** A sentence that says it cannot confirm, or asks whether, is honest about the gap, not a claim. */
const HEDGE = new RegExp([
    `\\b(?:no|not|n t|cannot|cant|nao|ne|pas|sin)\\s+(?:\\w+\\s+){0,2}(?:confirm|garantiz|guarante|asegur|verific|verify|assur|certif|promet|promis|sabe|sei|sais|sure)\\w*`,
    `\\b(?:informacion|information|informacao|informations|datos?|data|info|confirm\\w*|garantiz\\w*|guarantee\\w*|sure|segur\\w*|certez\\w*|idea)\\s+(?:\\w+\\s+){0,2}(?:si|whether|if|se)\\b`,
    `\\bno se si\\b`,
    // «Si no tiene alergias…» speaks of the customer, not of the item.
    `\\b(?:si|if|whether)\\s*$`,
].join('|'));
/** In a question, a claim right after a need of the customer («¿busca opciones sin gluten?») asks, it does not state. */
const ASKS_NEED = /\b(?:busca\w*|necesit\w*|prefier\w*|requier\w*|quier\w*|desea\w*|looking|need\w*|want\w*|prefer\w*|procur\w*|precis\w*|cherch\w*|voul\w*|souhait\w*|besoin)\s+(?:\w+\s+){0,3}$/;

function fold(text: unknown): string {
    return String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
        .replace(/[’'`´_-]/g, ' ').replace(/[^\p{L}\p{N}?\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function allergenFamilyOf(word: string): AllergenFamily | null {
    const folded = fold(word);
    for (const [family, re] of FAMILY_RES) if (re.test(folded)) return family;
    return null;
}

function familiesIn(text: string): Set<AllergenFamily> {
    const found = new Set<AllergenFamily>();
    const folded = fold(text);
    const re = new RegExp(`\\b(${ALLERGEN})\\b`, 'g');
    for (const match of folded.matchAll(re)) {
        const family = allergenFamilyOf(match[1]);
        if (family) found.add(family);
    }
    return found;
}

const sentencesOf = (reply: string): string[] => reply.split(/(?<=[.!?…])\s+|\n+/u).map(part => part.trim()).filter(Boolean);

/** The allergen families the sentence claims the item is free of / safe for. A hedge, or a question about a need, claims nothing. */
export function allergenClaimsIn(sentence: string): AllergenFamily[] {
    const question = /[?¿]/.test(sentence);
    const folded = fold(sentence).replace(/\?/g, ' ').replace(/\s+/g, ' ');
    const families = new Set<AllergenFamily>();
    for (const claim of CLAIMS) {
        for (const match of folded.matchAll(claim)) {
            const before = folded.slice(0, match.index ?? 0);
            if (HEDGE.test(before)) continue;
            const family = allergenFamilyOf(match[1]);
            if (!family || (question && (family === 'any' || ASKS_NEED.test(before)))) continue;
            families.add(family);
        }
    }
    return [...families];
}

export interface AllergenItem {
    name: string;
    /** Recorded allergens; undefined when the business recorded none (empty list, null, "not_informed"). */
    allergens?: string[];
    /** Tags and dietary labels as the business wrote them. */
    labels: string[];
}

const LABEL_KEYS = ['tags', 'dietary', 'dietaryTags', 'dietary_tags', 'dietaryLabels', 'labels'];
const asStrings = (value: unknown): string[] => Array.isArray(value)
    ? value.filter(v => typeof v === 'string' && v.trim()).map(String)
    : typeof value === 'string' && value.trim() && value.trim() !== 'not_informed' ? [value] : [];

/** Every record with a name and allergen / tag data in tool results (objects or JSON text) and verified facts. */
export function allergenItemsFrom(sources: readonly unknown[]): AllergenItem[] {
    const items: AllergenItem[] = [];
    const byName = new Map<string, AllergenItem>();
    const add = (name: string, allergens: string[] | undefined, labels: string[]) => {
        const key = fold(name);
        const existing = byName.get(key);
        if (existing) {
            if (allergens?.length) existing.allergens = [...(existing.allergens || []), ...allergens];
            existing.labels.push(...labels);
            return;
        }
        const item = { name, allergens: allergens?.length ? allergens : undefined, labels };
        byName.set(key, item);
        items.push(item);
    };
    const visit = (value: unknown, depth: number): void => {
        if (depth > 8 || value == null) return;
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (/^[[{]/.test(trimmed) && /allergen|tags|dietary/i.test(trimmed)) {
                try { visit(JSON.parse(trimmed), depth + 1); } catch { /* not JSON */ }
            }
            return;
        }
        if (Array.isArray(value)) { value.forEach(entry => visit(entry, depth + 1)); return; }
        if (typeof value !== 'object') return;
        const record = value as Record<string, unknown>;
        // A verified fact view / fact: { subjectName, field: 'allergens' | 'tags', value }.
        const factName = record.subjectName ?? (record.subject as any)?.name;
        if (typeof factName === 'string' && typeof record.field === 'string') {
            const field = record.field.toLowerCase();
            if (field === 'allergens') add(factName, asStrings(record.value), []);
            else if (LABEL_KEYS.map(k => k.toLowerCase()).includes(field)) add(factName, undefined, asStrings(record.value));
            return;
        }
        const name = record.name ?? record.title;
        if (typeof name === 'string' && name.trim() && ('allergens' in record || LABEL_KEYS.some(key => key in record))) {
            add(name.trim(), asStrings(record.allergens), LABEL_KEYS.flatMap(key => asStrings(record[key])));
        }
        for (const child of Object.values(record)) if (child && typeof child === 'object' || typeof child === 'string') visit(child, depth + 1);
    };
    for (const source of sources) visit(source, 0);
    return items;
}

const FREE_LABEL = /\b(?:free|sin|sem|sans|without|libres?|livres?|apt[oa]s?|friendly|safe|no|zero|0)\b/;

/** An explicit label of the business says the item is free of / fit for that family. */
function labelSupports(label: string, family: AllergenFamily): boolean {
    const folded = fold(label);
    if (!FREE_LABEL.test(folded)) return false;
    return familiesIn(folded).has(family) || (family === 'any' && familiesIn(folded).size > 0 && /\balerg|\ballerg/.test(folded));
}

function recordsFamily(item: AllergenItem, family: AllergenFamily): boolean {
    if (!item.allergens?.length) return false;
    if (family === 'any') return true;
    return item.allergens.some(allergen => familiesIn(allergen).has(family) || allergenFamilyOf(allergen) === family);
}

export type AllergenClaimSituation = 'not_informed' | 'contains';

function supports(item: AllergenItem, family: AllergenFamily): AllergenClaimSituation | null {
    if (recordsFamily(item, family)) return 'contains';
    return item.labels.some(label => labelSupports(label, family)) ? null : 'not_informed';
}

const GENERIC_NAME_WORDS = new Set(['plato', 'platos', 'dish', 'dishes', 'prato', 'plat', 'combo', 'menu', 'producto', 'product',
    'produto', 'produit', 'item', 'opcion', 'option', 'opcao', 'especial', 'special', 'casa', 'house', 'maison', 'del', 'de', 'la', 'el',
    'los', 'las', 'the', 'and', 'con', 'with', 'com', 'avec', 'para', 'for', 'pour']);

/** Items the sentence names: by their whole name, else by a distinctive word of it. */
function namedIn(sentence: string, items: readonly AllergenItem[]): AllergenItem[] {
    const folded = ` ${fold(sentence)} `;
    const whole = items.filter(item => fold(item.name) && folded.includes(` ${fold(item.name)} `));
    if (whole.length) return whole;
    return items.filter(item => fold(item.name).split(' ').some(word => word.length >= 4 && !GENERIC_NAME_WORDS.has(word) && folded.includes(` ${word} `)));
}

/** Why the claim is not backed, or null when every item it speaks of backs it. */
export function unbackedAllergenClaim(reply: string, items: readonly AllergenItem[]): AllergenClaimSituation | null {
    let worst: AllergenClaimSituation | null = null;
    for (const sentence of sentencesOf(String(reply ?? ''))) {
        const families = allergenClaimsIn(sentence);
        if (!families.length) continue;
        const named = namedIn(sentence, items).length ? namedIn(sentence, items) : namedIn(reply, items);
        for (const family of families) {
            if (named.length) {
                // Every item the reply speaks of must back the claim.
                for (const item of named) {
                    const gap = supports(item, family);
                    if (gap === 'contains') return 'contains';
                    if (gap) worst = 'not_informed';
                }
            } else {
                // «Tenemos opciones sin gluten» with no dish named: one item must back it.
                const verdicts = items.map(item => supports(item, family));
                if (!verdicts.some(verdict => verdict === null)) worst = worst || (verdicts.includes('contains') && verdicts.every(v => v === 'contains') ? 'contains' : 'not_informed');
            }
        }
    }
    return worst;
}

const TEXTS: Record<string, Record<AllergenClaimSituation, string>> = {
    es: {
        not_informed: 'El negocio no ha registrado información de alérgenos para ese plato o producto, así que no puedo confirmarle si es apto para usted. Por favor, confírmelo directamente con el negocio antes de consumirlo.',
        contains: 'La información registrada por el negocio indica que ese plato o producto contiene ese alérgeno, así que no puedo confirmarle que sea apto para usted. Por favor, confírmelo directamente con el negocio antes de consumirlo.',
    },
    en: {
        not_informed: 'The business has not registered allergen information for that dish or product, so I cannot confirm whether it is safe for you. Please confirm it directly with the business before consuming it.',
        contains: 'The information the business registered shows that dish or product contains that allergen, so I cannot confirm it is safe for you. Please confirm it directly with the business before consuming it.',
    },
    pt: {
        not_informed: 'O estabelecimento não registrou informações sobre alérgenos para esse prato ou produto, então não posso confirmar se é adequado para você. Por favor, confirme diretamente com o estabelecimento antes de consumi-lo.',
        contains: 'As informações registradas pelo estabelecimento indicam que esse prato ou produto contém esse alérgeno, então não posso confirmar que seja adequado para você. Por favor, confirme diretamente com o estabelecimento antes de consumi-lo.',
    },
    fr: {
        not_informed: 'L’établissement n’a pas enregistré d’informations sur les allergènes pour ce plat ou ce produit, je ne peux donc pas vous confirmer qu’il vous convient. Merci de le vérifier directement auprès de l’établissement avant de le consommer.',
        contains: 'Les informations enregistrées par l’établissement indiquent que ce plat ou ce produit contient cet allergène, je ne peux donc pas vous confirmer qu’il vous convient. Merci de le vérifier directement auprès de l’établissement avant de le consommer.',
    },
};

export function allergenHonestText(situation: AllergenClaimSituation, lang: string | undefined, canOfferPerson: boolean): string {
    const code = String(lang || 'es').slice(0, 2).toLowerCase();
    const sentence = (TEXTS[code] || TEXTS.es)[situation];
    return canOfferPerson ? `${sentence} ${humanOfferQuestionText(code)}` : sentence;
}

export interface AllergenClaimInput {
    reply: string;
    /** Everything the turn holds about items: tool results of this turn, tool messages of the thread, verified facts. */
    sources: readonly unknown[];
    lang?: string;
    canOfferPerson: boolean;
}

/** The reply, or the honest replacement when it claims an item is free of / safe for an allergen the data does not back. */
export function guardAllergenClaim(input: AllergenClaimInput): { text: string; replaced: boolean; situation?: AllergenClaimSituation } {
    const situation = unbackedAllergenClaim(input.reply, allergenItemsFrom(input.sources));
    if (!situation) return { text: input.reply, replaced: false };
    return { text: allergenHonestText(situation, input.lang, input.canOfferPerson), replaced: true, situation };
}
