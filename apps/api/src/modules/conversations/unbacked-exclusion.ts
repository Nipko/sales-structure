/**
 * F4300-54 (production QA 28-oct, travel and menu tenants): «the Spark QA Tour does not include photos / lunch / hotel pickup», «el
 * plato Spark no incluye postre», «n'inclut pas de dessert», in es/en/pt/fr — the package read had no includes and no excludes, and
 * the dish no list of what comes with it. The reply even said «there are no included items listed» and still denied the item. An
 * exclusion is a fact of the business: said only when the read lists it.
 *
 * When the turn read a package or a menu, a sentence that denies an inclusion of an item no read excludes is said as «not recorded».
 * A negation scoped to a list that exists («entre sus comodidades», «among its amenities», «según la descripción») is left alone.
 */

export interface ToolRead { name?: string; result?: any }

const NEGATION: Record<string, RegExp> = {
    es: /(?<!\p{L})no\s+(?:incluye|incluyen|trae|traen|viene\s+con|tiene\s+incluid[oa]s?)\s+(.+)$/iu,
    en: /(?<!\p{L})(?:does\s+not|doesn['’]t|do\s+not|don['’]t)\s+(?:include|come\s+with)\s+(.+)$/iu,
    pt: /(?<!\p{L})n[ãa]o\s+(?:inclui|incluem|vem\s+com|traz)\s+(.+)$/iu,
    fr: /(?<!\p{L})(?:n['’]inclu(?:t|ent)\s+pas|ne\s+comprend\s+pas|ne\s+comprennent\s+pas|n['’]est\s+pas\s+servi\s+avec)\s+(.+)$/iu,
};
// A negation scoped to a list the business did record is that list's fact.
const SCOPED = /(?<!\p{L})(?:entre\s+sus\s+(?:comodidades|servicios|amenidades)|among\s+(?:its|the)\s+(?:amenities|services|features)|parmi\s+ses\s+(?:équipements|equipements|services)|entre\s+as\s+comodidades|seg[uú]n\s+la\s+descripci[oó]n|according\s+to\s+the\s+description|selon\s+la\s+description|segundo\s+a\s+descri[cç][aã]o)(?!\p{L})/iu;

const TEXT: Record<string, (item: string) => string> = {
    es: item => `No consta en la información registrada si incluye ${item}.`,
    en: item => `Whether it includes ${item} is not recorded in the information I have.`,
    pt: item => `Não consta na informação registrada se inclui ${item}.`,
    fr: item => `Les informations enregistrées ne précisent pas si cela inclut ${item}.`,
};

// «n'inclut pas d'inclusions ou d'exclusions spécifiques», «no incluye extras»: no item named, only the fact that none is recorded.
const GENERIC_ITEM = /^(?:inclusi|exclusi|extra|item|ítem|element|élément|iten|nada|nothing|rien|specific|espec[ií]fic)/i;
const GENERIC_TEXT: Record<string, string> = {
    es: 'No consta en la información registrada qué incluye.',
    en: 'What it includes is not recorded in the information I have.',
    pt: 'Não consta na informação registrada o que inclui.',
    fr: 'Les informations enregistrées ne précisent pas ce qui est inclus.',
};

const fold = (text: string) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Every «excludes» entry and every menu-item text the turn read; null when the turn read no package and no menu. */
function readExclusions(reads: ReadonlyArray<ToolRead>): string[] | null {
    let catalogRead = false;
    const out: string[] = [];
    const walk = (value: any, depth = 0): void => {
        if (!value || typeof value !== 'object' || depth > 6) return;
        if (Array.isArray(value)) { value.forEach(item => walk(item, depth + 1)); return; }
        for (const [key, entry] of Object.entries(value)) {
            if (/^(?:excludes|exclusions|notIncluded|not_included)$/i.test(key) && Array.isArray(entry)) {
                out.push(...entry.filter((x): x is string => typeof x === 'string'));
            } else if (/^(?:description|includes)$/i.test(key) && typeof entry === 'string') {
                out.push(entry);
            } else walk(entry, depth + 1);
        }
    };
    for (const read of reads || []) {
        if (!/package|menu/i.test(String(read?.name || '')) || !read?.result || read.result.error) continue;
        catalogRead = true;
        walk(read.result);
    }
    return catalogRead ? out : null;
}

/** The denied item: the words after the negation up to the end of what it names. */
function deniedItem(rest: string): string {
    return rest.split(/[.,;:!?]|\s(?:como|as|comme|en\s+tant|como\s+parte|ni|nor|ou|o|or|et|e|y|and|dans|in|no|but|pero|mais|mas)\s/i)[0]
        .replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ')
        // «n'inclut pas DE dessert», «does not include ANY meals»: the partitive belongs to the negation.
        .replace(/^(?:de|d['’]|des|du|any)\s*/i, '');
}

/** The reply with each unbacked denied inclusion said as «not recorded»; null when there is none. */
export function unbackedExclusionCorrection(reply: string, reads: ReadonlyArray<ToolRead>, lang?: string): string | null {
    const text = String(reply || '');
    const exclusions = readExclusions(reads);
    if (!text.trim() || exclusions === null) return null;
    const code = String(lang || 'es').slice(0, 2);
    const negation = NEGATION[code] ?? NEGATION.es;
    const say = TEXT[code] ?? TEXT.es;
    const listed = fold(exclusions.join(' | '));
    let changed = false;
    const sentences = text.split(/(?<=[.!?])\s+(?=\p{Lu}|¿|¡)/u).map(sentence => {
        if (SCOPED.test(sentence)) return sentence;
        const match = sentence.match(negation);
        if (!match) return sentence;
        const item = deniedItem(match[1]);
        if (!item) return sentence;
        // Backed when a read lists it: any word of four letters or more of the item in an excludes entry or the item's own text.
        // F4300-54 residue (production QA 29-oct): «does not include transportation» for the excludes entry «Transporte» — the reply
        // translates the recorded item, so a word's six-letter stem in an entry backs it too.
        const words = fold(item).split(/[^a-z0-9]+/).filter(word => word.length >= 4);
        if (words.some(word => listed.includes(word) || (word.length >= 6 && listed.includes(word.slice(0, 6))))) return sentence;
        changed = true;
        return GENERIC_ITEM.test(item) ? (GENERIC_TEXT[code] ?? GENERIC_TEXT.es) : say(item);
    });
    return changed ? sentences.join(' ') : null;
}
