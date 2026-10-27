/**
 * F4300-37 (production QA 27-oct, store tenant): «¿cuánto costarían tres Audífono QA Aurora?» with 2 units left was answered «Para
 * tres unidades, el costo total sería 359.700 COP (3 × 119.900 COP)» — in es/pt/en/fr — and never said that only 2 are left. The
 * product and its stock were in the turn's <catalog>.
 *
 * When the customer names one product of the turn's catalogue and asks for more units than its stock, and the reply never says
 * how many are left, the reply says it.
 */
import { quantitiesIn } from './response-validator.service';

export interface StockedProduct {
    title: string;
    stock?: number;
}

const fold = (text: string): string => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The text names the product: its whole name, or every word of it of three letters or more. */
function names(text: string, title: string): boolean {
    const said = ` ${fold(text)} `;
    const own = fold(title);
    if (own.length < 3) return false;
    if (said.includes(` ${own} `)) return true;
    const words = own.split(' ').filter(word => word.length >= 3);
    return words.length > 0 && words.every(word => said.includes(` ${word} `) || said.includes(` ${word}s `));
}

const LEFT_WORDS: Record<number, string[]> = {
    0: ['cero', 'zero', 'ninguna', 'ninguno', 'nenhuma', 'nenhum', 'aucune', 'aucun', 'none', 'no units', 'agotado', 'esgotado', 'sold out', 'épuisé'],
    1: ['una', 'uno', 'one', 'uma', 'um', 'une', 'un'],
    2: ['dos', 'two', 'duas', 'dois', 'deux'],
    3: ['tres', 'three', 'tres', 'trois'],
    4: ['cuatro', 'four', 'quatro', 'quatre'],
    5: ['cinco', 'five', 'cinq'],
};
const STOCK_WORD = /(?<!\p{L})(?:quedan?|queda|disponibles?|disponíveis|disponivel|disponível|disponibilit[eé]|stock|estoque|inventario|left|available|in stock|restam?|resta|reste(?:nt)?|unidades?|units?|unités?)(?!\p{L})/iu;

/** The reply already says how many are left: the stock number next to a stock word in one sentence. */
function saysStock(reply: string, left: number): boolean {
    return reply.split(/(?<=[.!?])\s+|\n/).some(sentence => {
        if (!STOCK_WORD.test(sentence)) return false;
        const folded = ` ${fold(sentence)} `;
        return new RegExp(`(?<![\\d.,])${left}(?![\\d.,])`).test(sentence)
            || (LEFT_WORDS[left] ?? []).some(word => folded.includes(` ${fold(word)} `));
    });
}

const TEXTS: Record<string, (left: number, title: string, asked: number) => string> = {
    es: (left, title, asked) => left > 0
        ? `Tenga en cuenta que solo quedan ${left} ${left === 1 ? 'unidad' : 'unidades'} de ${title} (pidió ${asked}).`
        : `Tenga en cuenta que por ahora no quedan unidades de ${title}.`,
    pt: (left, title, asked) => left > 0
        ? `Observe que só restam ${left} ${left === 1 ? 'unidade' : 'unidades'} de ${title} (você pediu ${asked}).`
        : `Observe que no momento não restam unidades de ${title}.`,
    en: (left, title, asked) => left > 0
        ? `Please note that only ${left} ${left === 1 ? 'unit' : 'units'} of ${title} ${left === 1 ? 'is' : 'are'} left (you asked for ${asked}).`
        : `Please note that there are no units of ${title} left right now.`,
    fr: (left, title, asked) => left > 0
        ? `Veuillez noter qu’il ne reste que ${left} ${left === 1 ? 'unité' : 'unités'} de ${title} (vous en avez demandé ${asked}).`
        : `Veuillez noter qu’il ne reste plus d’unités de ${title} pour le moment.`,
};

/** The reply with the stock said, when the customer asked for more units than the one product named has; null otherwise. */
export function stockShortfallNote(reply: string, customerText: string, catalog: readonly StockedProduct[] | undefined, lang?: string): string | null {
    const text = String(reply || '');
    if (!text.trim()) return null;
    const named = (catalog ?? []).filter(product => product?.title && names(customerText, product.title));
    if (named.length !== 1) return null;
    const [product] = named;
    if (typeof product.stock !== 'number' || !Number.isFinite(product.stock)) return null;
    // The quantities of the message, without the ones inside the product's own name («Pack 3»).
    const asked = quantitiesIn(String(customerText || '')).filter(n => !quantitiesIn(product.title).includes(n));
    if (asked.length !== 1) return null;
    const left = Math.max(0, Math.floor(product.stock));
    const [wanted] = asked;
    if (wanted <= left || saysStock(text, left)) return null;
    const say = TEXTS[String(lang || 'es').slice(0, 2)] ?? TEXTS.es;
    return `${text.trim()}\n\n${say(left, product.title, wanted)}`;
}
