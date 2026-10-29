/**
 * F4300-47 (production QA 27-oct, image c3cf6985/1a719d86): a total the customer asked for was left as words. «¿cuánto pagaríamos dos
 * personas por corte y estilo?» → «El precio del servicio Corte y estilo es 40.000 COP por persona. Para dos personas, sería el doble
 * de ese valor.»; «combien coûte une demi-douzaine de plats Spark ?» → «…13 500 COP. Pour une demi-douzaine, le coût serait six fois
 * ce montant.»; the same with «o dobro desse preço», «twice that amount», in salon, tours, hotel and menu, in es/pt/en/fr.
 *
 * When the reply already said an amount and then multiplies it in words («el doble de ese valor», «six fois ce montant») by a
 * quantity the CUSTOMER asked for, the words become the total, with its working: «80.000 COP (2 × 40.000 COP)». A multiplier the
 * customer never asked for («the double room») or with no amount before it is left as it is.
 */
import { formatPriceWithCurrency } from './booking-engine.service';
import { moneyMentionsIn, quantitiesIn } from './response-validator.service';

const NUMBER_WORDS: Record<string, number> = {
    dos: 2, two: 2, dois: 2, duas: 2, deux: 2, tres: 3, 'três': 3, three: 3, trois: 3, cuatro: 4, four: 4, quatro: 4, quatre: 4,
    cinco: 5, five: 5, cinq: 5, seis: 6, six: 6, siete: 7, seven: 7, sete: 7, sept: 7, ocho: 8, eight: 8, oito: 8, huit: 8,
    nueve: 9, nine: 9, nove: 9, neuf: 9, diez: 10, ten: 10, dez: 10, dix: 10,
};
const TIMES_OF: Record<string, number> = { doble: 2, dobro: 2, double: 2, twice: 2, triple: 3, triplo: 3 };

// What the multiplier refers back to: «ese valor», «desse preço», «that amount», «ce montant», «du prix».
const BACK = String.raw`(?:(?:de|do|del|du|of)\s+)?(?:(?:ese|este|esse|este|desse|deste|dessa|that|this|the|ce|cet|le|el|o)\s+)?(?:valor|precio|preço|preco|monto|importe|montant|prix|amount|price|value)`;
// «el doble» / «o dobro» need their article (a «habitación doble» is a room), «twice», «double», «triple» and «N veces» need what
// they multiply («a double room», «I asked twice» are no totals).
const MULTIPLIER = new RegExp(String.raw`(?<!\p{L})(?:(?:el|o)\s+(doble|dobro|triplo)(?:\s+${BACK})?|(?:(?:le|the)\s+)?(twice|double|triple)\s+${BACK}|(\d{1,2}|\p{L}+)\s+(?:veces|vezes|fois|times)\s+${BACK})(?!\p{L})`, 'giu');

/** The reply with each worded multiple of an amount it said turned into the total; null when there is none to turn. */
export function spelledTotalCorrection(reply: string, customerText: string, lang?: string): string | null {
    const text = String(reply || '');
    const asked = quantitiesIn(String(customerText || ''));
    if (!asked.length) return null;
    const mentions = moneyMentionsIn(text);
    if (!mentions.length) return null;
    const unitToken = unitTokenTotals(text, asked, lang);
    if (unitToken) return unitToken;
    let changed = false;
    const out = text.replace(MULTIPLIER, (whole: string, doubled?: string, word?: string, count?: string, offset?: number) => {
        const key = String(doubled || word || count || '').toLowerCase();
        const n = TIMES_OF[key] ?? (/^\d+$/.test(key) ? Number(key) : NUMBER_WORDS[key]);
        if (!n || !asked.includes(n)) return whole;
        const before = mentions.filter(m => (m.index ?? 0) + (m.length ?? 0) <= (offset ?? 0));
        const base = before[before.length - 1];
        if (!base) return whole;
        const total = formatPriceWithCurrency(String(lang || 'es'), base.amount * n, base.currency);
        if (!total) return whole;
        changed = true;
        return `${total} (${n} × ${text.slice(base.index!, base.index! + base.length!)})`;
    });
    // «150.000 COP multiplicado por 7 noches», «150,000 COP multiplied by 7 nights» (production QA 27-oct, «una semana»): the
    // amount and its working without the total — the total goes first, the working after it.
    let worked = '';
    let cursor = 0;
    for (const match of out.matchAll(WORKED)) {
        const at = match.index ?? 0;
        const key = match[1].toLowerCase();
        const n = /^\d+$/.test(key) ? Number(key) : NUMBER_WORDS[key];
        const base = moneyMentionsIn(out).find(m => (m.index ?? 0) >= cursor && (m.index ?? 0) + (m.length ?? 0) === at);
        const total = base && n && asked.includes(n) ? formatPriceWithCurrency(String(lang || 'es'), base.amount * n, base.currency) : '';
        if (!base || !total) continue;
        worked += `${out.slice(cursor, base.index!)}${total} (${n} × ${out.slice(base.index!, at)})`;
        cursor = at + match[0].length;
        changed = true;
    }
    if (changed) return worked + out.slice(cursor);
    return unitOnlyCorrection(text, String(customerText || ''), lang);
}

// «a week in the room» → «150,000 COP per night. The total price depends on the exact dates» (production QA 27-oct, en after #252):
// the unit amount said and the total left out. The nights or people the customer named, and the reply's amount per night / per person.
const UNITS = {
    night: { asked: String.raw`noches?|nights?|noites?|nuits?`, per: String.raw`(?:por|per|par|a|the)\s+(?:noche|night|noite|nuit)|(?:la|a)\s+nuit|nightly|(?:por\s+)?di[aá]ria`,
        word: { es: 'noches', en: 'nights', pt: 'noites', fr: 'nuits' } },
    person: { asked: String.raw`personas?|people|persons?|pessoas?|personnes?`, per: String.raw`(?:por|per|par)\s+(?:persona|person|pessoa|personne)|each person|cada (?:persona|pessoa)`,
        word: { es: 'personas', en: 'people', pt: 'pessoas', fr: 'personnes' } },
} as const;
const A_WEEK = /(?<!\p{L})(?:una semana|uma semana|a week|one week|une semaine)(?!\p{L})/iu;
const FROM = /(?:desde|from|a partir de|à partir de)\s*$/iu;
const DEFERRED = /[^.!?\n]*(?<!\p{L})(?:depende|depends|dépend|dependerá)(?!\p{L})[^.!?\n]*(?:fechas|dates|datas)[^.!?\n]*[.!?]?\s*/iu;
const TOTAL_TEXT: Record<string, (n: number, unit: string, total: string, working: string) => string> = {
    es: (n, unit, total, working) => `Para ${n} ${unit}: ${total} (${working}).`,
    en: (n, unit, total, working) => `For ${n} ${unit}: ${total} (${working}).`,
    pt: (n, unit, total, working) => `Para ${n} ${unit}: ${total} (${working}).`,
    fr: (n, unit, total, working) => `Pour ${n} ${unit} : ${total} (${working}).`,
};

// F4300-47 residue (production QA 28-oct, image 7417ba99): «si somos 4», «if there are 4 of us», «se formos 4», «si nous sommes 4» name
// the people without the word «personas» — the reply said «125 EUR por persona» and no total, in all four languages.
const GROUP = new RegExp(String.raw`(?<!\p{L})(?:somos|seremos|vamos|iremos|formos|seremos|sommes|serons|allons)\s+(\d{1,2}|\p{L}+)(?![\p{L}\d])|(?<![\p{L}\d])(\d{1,2}|\p{L}+)\s+of\s+us(?!\p{L})`, 'giu');

function askedCount(customerText: string, unit: string, group = false): number | null {
    const found = new Set<number>();
    const counts = [...customerText.matchAll(new RegExp(String.raw`(?<![\p{L}\d])(\d{1,2}|\p{L}+)\s+(?:${unit})(?!\p{L})`, 'giu'))].map(m => m[1]);
    if (group) counts.push(...[...customerText.matchAll(GROUP)].map(m => m[1] || m[2]));
    for (const word of counts) {
        const key = word.toLowerCase();
        const n = /^\d+$/.test(key) ? Number(key) : NUMBER_WORDS[key];
        if (n && n >= 2) found.add(n);
    }
    return found.size === 1 ? [...found][0] : null;
}

/** The reply that says only the amount per night / per person of a count the customer named, with that total said; null otherwise. */
function unitOnlyCorrection(reply: string, customerText: string, lang?: string): string | null {
    const mentions = moneyMentionsIn(reply);
    if (!mentions.length) return null;
    const language = String(lang || 'es').slice(0, 2);
    for (const [key, unit] of Object.entries(UNITS)) {
        const n = key === 'night' && A_WEEK.test(customerText) ? 7 : askedCount(customerText, unit.asked, key === 'person');
        if (!n) continue;
        const per = new RegExp(String.raw`^\s*(?:${unit.per})(?!\p{L})`, 'iu');
        // «o preço por pessoa é de 125 EUR», «the price per person is 125 EUR» (production QA 28-oct, image 2d2f73f2): the unit before
        // the amount, two words at most between them.
        const perBefore = new RegExp(String.raw`(?:${unit.per})(?!\p{L})\s+(?:\p{L}+\s+){0,2}$`, 'iu');
        const units = mentions.filter(m => per.test(reply.slice(m.index! + m.length!)) || perBefore.test(reply.slice(Math.max(0, m.index! - 40), m.index!)));
        if (units.length !== 1) continue;
        const [base] = units;
        // The total is there already (any amount n times the unit amount).
        if (mentions.some(m => Math.abs(m.amount - base.amount * n) < 0.005)) return null;
        const total = formatPriceWithCurrency(language, base.amount * n, base.currency);
        if (!total) return null;
        const from = FROM.test(reply.slice(0, base.index!)) ? { es: 'desde ', en: 'from ', pt: 'a partir de ', fr: 'à partir de ' }[language] ?? '' : '';
        const said = (TOTAL_TEXT[language] ?? TOTAL_TEXT.es)(n, (unit.word as Record<string, string>)[language] ?? unit.word.es,
            from + total, `${n} × ${reply.slice(base.index!, base.index! + base.length!)}`);
        const deferred = reply.match(DEFERRED);
        if (deferred) return `${reply.slice(0, deferred.index!).trimEnd()} ${said} ${reply.slice(deferred.index! + deferred[0].length)}`.trim();
        const rest = reply.slice(base.index! + base.length!);
        const end = rest.search(/[.!?](?!\d)/);
        const at = end < 0 ? reply.length : base.index! + base.length! + end + 1;
        return `${reply.slice(0, at)} ${said}${reply.slice(at)}`.replace(/ {2,}/g, ' ').trim();
    }
    return null;
}

const WORKED = new RegExp(String.raw`\s*(?:multiplicad[oa]s? por|multiplied by|multipli[eé]e?s? par)\s+(\d{1,2}|\p{L}+)(?:\s+(?:noches|nights|noites|nuits|personas|people|pessoas|personnes|veces|times|vezes|fois))?`, 'giu');

/**
 * F4300-47 residue (production QA 28-oct, rendered facts on, image ae71309a): the model cites a price by its token and has no token for
 * the total, so it wrote the unit price where the total goes — «el total sería 3 veces 13.500 COP, es decir, 13.500 COP por cada
 * plato», «pagará 119.900 COP cada uno, lo que suma un total de 119.900 COP por los dos», «150 000 COP par nuit multiplié par 6
 * nuits, soit 150 000 COP» — in es/en/pt/fr, menu, store and hotel. With a quantity the customer asked for, these say the total:
 *   · «N veces / times / fois / vezes X» → «TOTAL (N × X)»;
 *   · «X por noche / per night / par nuit multiplicado por / multiplied by / multiplié par N …» → «TOTAL (N × X por noche)»;
 *   · «total (de) X» / «soit X» / «es decir X» where X is the unit price already said → «TOTAL (N × X)» — never when what follows
 *     is per unit («por cada plato», «each», «chacun», «par nuit»).
 */
const COUNT_TIMES = /(?<!\p{L})(\d{1,2}|\p{L}+)\s+(?:veces|times|fois|vezes)\s+$/iu;
const UNIT_TIMES = /^\s+(?:por|per|par|a|the)\s+\p{L}+\s+(?:multiplicad[oa]s?\s+por|multiplied\s+by|multipli[eé]e?s?\s+par)\s+(\d{1,2}|\p{L}+)(?:\s+(?:noches|nights|noites|nuits|personas|people|pessoas|personnes|platos|dishes|pratos|plats|unidades|units|unités))?/iu;
const TOTAL_LEAD = /(?<!\p{L})(?:total(?:\s+(?:de|of|del?))?|en\s+total|in\s+total|au\s+total|ao\s+todo|no\s+total|suma(?:\s+un\s+total\s+de)?|soit|es\s+decir,?|that\s+is,?|ou\s+seja,?|c['’]est-[àa]-dire,?|lo\s+que\s+(?:suma|da)(?:\s+un\s+total\s+de)?)\s*:?\s*$/iu;
const PER_UNIT_AFTER = /^\s*(?:por\s+cada|cada\s+uno|cada\s+una|por\s+(?:noche|persona|plato|unidad)|each|per\s+\p{L}+|par\s+\p{L}+|chacun|chacune|por\s+(?:noite|pessoa|prato)|cada)(?!\p{L})/iu;

function countOf(word: string): number {
    const key = word.toLowerCase();
    return /^\d+$/.test(key) ? Number(key) : (NUMBER_WORDS[key] ?? 0);
}

function unitTokenTotals(text: string, asked: number[], lang?: string): string | null {
    const language = String(lang || 'es');
    const mentions = moneyMentionsIn(text);
    const say = (amount: number, currency: string | undefined) => formatPriceWithCurrency(language, amount, currency);
    // 1. «N veces X», «X por noche multiplicado por N noches».
    for (const m of mentions) {
        const start = m.index!, end = start + m.length!;
        const amountText = text.slice(start, end);
        const before = text.slice(0, start).match(COUNT_TIMES);
        if (before) {
            const n = countOf(before[1]);
            const total = n >= 2 && asked.includes(n) ? say(m.amount * n, m.currency) : '';
            if (total) return `${text.slice(0, start - before[0].length)}${before[0].match(/^\s*/)![0]}${total} (${n} × ${amountText})${text.slice(end)}`.replace(/\s{2,}/g, ' ');
        }
        const after = text.slice(end).match(UNIT_TIMES);
        if (after) {
            const n = countOf(after[1]);
            const total = n >= 2 && asked.includes(n) ? say(m.amount * n, m.currency) : '';
            if (total) {
                const unit = after[0].split(/\s+(?:multiplicad|multiplied|multipli)/i)[0].trim();
                return `${text.slice(0, start)}${total} (${n} × ${amountText} ${unit})${text.slice(end + after[0].length)}`;
            }
        }
    }
    // 2. «total de X» where X is the unit price said before it, and nothing in the reply is the total yet.
    const wanted = asked.filter(n => n >= 2);
    if (wanted.length !== 1) return null;
    const [n] = wanted;
    for (let i = 1; i < mentions.length; i++) {
        const m = mentions[i];
        const start = m.index!, end = start + m.length!;
        if (!mentions.slice(0, i).some(prev => Math.abs(prev.amount - m.amount) < 0.005)) continue;
        if (mentions.some(other => Math.abs(other.amount - m.amount * n) < 0.005)) return null;
        if (!TOTAL_LEAD.test(text.slice(Math.max(0, start - 40), start)) || PER_UNIT_AFTER.test(text.slice(end))) continue;
        const total = say(m.amount * n, m.currency);
        if (total) return `${text.slice(0, start)}${total} (${n} × ${text.slice(start, end)})${text.slice(end)}`;
    }
    return null;
}
