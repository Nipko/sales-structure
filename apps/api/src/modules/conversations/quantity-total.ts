/**
 * F4300-47 residue (production QA 29-oct, store tenant): after «¿tienen el Audífono QA Aurora en azul?» (price said), «¿y si me llevo
 * 2?» / «and if I take 2?» / «et si j’en prends 2 ?» was answered «Puedo ayudarle a hacer un pedido de 2 unidades del Audífono QA
 * Aurora» — es/en/pt/fr — and the total never came. The product and its price were in the turn's <catalog>.
 *
 * When the customer asks for a quantity of the one catalogue product the reply (or the message) names, the reply carries no amount
 * and the stock covers it, the total is said before the closing question.
 */
import { formatPriceWithCurrency } from './booking-engine.service';
import { moneyMentionsIn, quantitiesIn } from './response-validator.service';

export interface PricedProduct {
    title: string;
    price?: number;
    currency?: string;
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
    return words.length > 0 && words.every(word => said.includes(` ${word} `));
}

/**
 * Production QA 29/30-oct (travel, ES and EN, three times): «¿qué incluye exactamente ese tour de 4 HORAS?» / «What's included in
 * that 4-hour tour?» got «Por 4 unidades serían 500 EUR (4 × 125 EUR)»: a duration is not a quantity of units.
 */
const DURATION = /(?<![\p{L}\p{N}])(\d{1,2})\s*-?\s*(?:h|hrs?|horas?|hours?|heures?|minutos?|minutes?|mins?)(?![\p{L}])/giu;
function durationsIn(text: string): number[] {
    return [...String(text || '').matchAll(DURATION)].map(m => Number(m[1]));
}

const TEXTS: Record<string, (n: number, total: string, unit: string) => string> = {
    es: (n, total, unit) => `Por ${n} unidades serían ${total} (${n} × ${unit}).`,
    en: (n, total, unit) => `For ${n} units it would be ${total} (${n} × ${unit}).`,
    pt: (n, total, unit) => `Por ${n} unidades seriam ${total} (${n} × ${unit}).`,
    fr: (n, total, unit) => `Pour ${n} unités, cela ferait ${total} (${n} × ${unit}).`,
};

export interface ToolRead { name?: string; result?: any }

/**
 * The priced items the turn's reads returned (production QA 29-oct: the menu reaches the turn through get_menu, not the projected
 * catalogue — «¿y si pido 3?» got «¿podría confirmarme la dirección de entrega?» and no total).
 */
function readItems(reads: ReadonlyArray<ToolRead> | undefined): PricedProduct[] {
    const out: PricedProduct[] = [];
    for (const read of reads ?? []) {
        if (!/menu|product/i.test(String(read?.name || '')) || !read?.result || read.result.error) continue;
        const rows = [read.result.items, read.result.products, read.result.product ? [read.result.product] : null].find(Array.isArray) ?? [];
        for (const row of rows) {
            const title = row?.name ?? row?.title;
            if (title && typeof row?.price === 'number') out.push({ title: String(title), price: row.price, currency: row.currency, stock: row.stock });
        }
    }
    return out;
}

export function quantityTotalNote(reply: string, customerText: string, catalog: readonly PricedProduct[] | undefined, lang?: string,
    reads?: ReadonlyArray<ToolRead>): string | null {
    const text = String(reply || '').trim();
    if (!text) return null;
    const known = new Map<string, PricedProduct>();
    for (const item of [...(catalog ?? []), ...readItems(reads)]) if (item?.title && !known.has(item.title)) known.set(item.title, item);
    const priced = [...known.values()].filter(product => product?.title && typeof product.price === 'number' && Number.isFinite(product.price) && product.price > 0);
    let named = priced.filter(product => names(customerText, product.title) || names(text, product.title));
    // «¿y si me llevo 2?» → «el total sería 119.900 COP»: no name said, but the reply's only amount is one product's own price.
    if (!named.length) {
        const said = moneyMentionsIn(text);
        named = said.length === 1 ? priced.filter(product => Math.abs(product.price! - said[0].amount) < 0.005) : [];
    }
    if (named.length !== 1) return null;
    const [product] = named;
    const asked = quantitiesIn(String(customerText || '')).filter(n => !quantitiesIn(product.title).includes(n) && !durationsIn(customerText).includes(n));
    if (asked.length !== 1) return null;
    const [n] = asked;
    const code0 = String(lang || 'es').slice(0, 2);
    const mentions = moneyMentionsIn(text);
    if (mentions.length) return unitSaidAsTotal(text, mentions, product, n, code0);
    // More than the stock is the stock note's to say (F4300-37).
    if (typeof product.stock === 'number' && Number.isFinite(product.stock) && n > product.stock) return null;
    const code = String(lang || 'es').slice(0, 2);
    const total = formatPriceWithCurrency(code, product.price! * n, product.currency);
    const unit = formatPriceWithCurrency(code, product.price!, product.currency);
    if (!total || !unit) return null;
    const note = (TEXTS[code] ?? TEXTS.es)(n, total, unit);
    const closing = text.match(/(?<=[.!]\s+)[^.!?]*\?\s*$/u);
    if (closing) return `${text.slice(0, closing.index!).trimEnd()} ${note} ${closing[0].trim()}`;
    if (/\?\s*$/.test(text)) return `${note} ${text}`;
    return `${text} ${note}`;
}

// «would be a total of», «el total sería», «ao todo», «au total», «soit»: the words that announce the total.
const TOTAL_LEAD = /(?<!\p{L})(?:total|en\s+total|in\s+total|au\s+total|ao\s+todo|no\s+total|suma|sumar[ií]an?|soit|ferait|seriam?|ser[ií]an?|would\s+be|would\s+come\s+to|comes?\s+to)(?:\s+(?:de|of|do|da|del|à|a))?\s*:?\s*$/iu;

/**
 * F4300-47 residue (production QA 29-oct, image 8aeb23b1): «and if I take 2?» → «Ordering 2 units would be a total of 119,900 COP» —
 * the unit price said as the total. When the only amount of the reply is the named product's unit price and the words before it
 * announce a total, it becomes «TOTAL (n × unit)».
 */
function unitSaidAsTotal(text: string, mentions: ReturnType<typeof moneyMentionsIn>, product: PricedProduct, n: number, code: string): string | null {
    if (mentions.length !== 1) return null;
    const [m] = mentions;
    if (Math.abs(m.amount - product.price!) >= 0.005) return null;
    const start = m.index!, end = start + m.length!;
    if (!TOTAL_LEAD.test(text.slice(Math.max(0, start - 40), start))) return null;
    const total = formatPriceWithCurrency(code, product.price! * n, m.currency ?? product.currency);
    if (!total) return null;
    return `${text.slice(0, start)}${total} (${n} × ${text.slice(start, end)})${text.slice(end)}`;
}
