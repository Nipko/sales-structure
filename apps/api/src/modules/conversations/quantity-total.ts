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
    if (!text || moneyMentionsIn(text).length) return null;
    const known = new Map<string, PricedProduct>();
    for (const item of [...(catalog ?? []), ...readItems(reads)]) if (item?.title && !known.has(item.title)) known.set(item.title, item);
    const priced = [...known.values()].filter(product => product?.title && typeof product.price === 'number' && Number.isFinite(product.price) && product.price > 0);
    const named = priced.filter(product => names(customerText, product.title) || names(text, product.title));
    if (named.length !== 1) return null;
    const [product] = named;
    const asked = quantitiesIn(String(customerText || '')).filter(n => !quantitiesIn(product.title).includes(n));
    if (asked.length !== 1) return null;
    const [n] = asked;
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
