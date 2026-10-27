/**
 * The customer's past orders, said from the orders the turn READ (F4300-11).
 *
 * Production QA (store tenant, image 128b1fb4, 25-oct 07:31 UTC): «what did I buy last time?» read list_my_catalog_orders (six
 * orders, all cancelled, the newest 20FD6A98, Audífono QA Aurora, 119.900 COP) and the customer got the outcome-claim template
 * «I cannot treat that as done: I have no record that it was completed…». They answered «I'm not asking you to confirm
 * anything, I just want to know what I purchased last time» and got the same template again. On 22-oct the same template had
 * replaced the answer to «¿cuáles son mis pedidos?».
 *
 * When the claim guard catches a draft about the customer's past orders (a question, not a request to change anything), the
 * answer is not the template: it is what the read says — the newest order, what it held, its total and its real status — so
 * a draft that said a cancelled purchase was completed ends as «Status: cancelled», never as «shall I ask the team?».
 */
import { formatPriceWithCurrency } from './booking-engine.service';
import { shortReference } from './transition-engine';

type Lang = 'es' | 'en' | 'pt' | 'fr';

interface OrderView {
    id: string;
    reference: string;
    status: string;
    paymentStatus: string;
    total: unknown;
    currency: string | null;
    items: Array<{ name: string; quantity: number | null }>;
    createdAt: number;
}

const LIST_READS = new Set(['list_my_orders', 'list_my_catalog_orders']);

const STATUS_WORDS: Record<string, Record<Lang, string>> = {
    cancelled: { es: 'cancelado', en: 'cancelled', pt: 'cancelado', fr: 'annulée' },
    pending: { es: 'pendiente', en: 'pending', pt: 'pendente', fr: 'en attente' },
    received: { es: 'recibido', en: 'received', pt: 'recebido', fr: 'reçue' },
    confirmed: { es: 'confirmado', en: 'confirmed', pt: 'confirmado', fr: 'confirmée' },
    preparing: { es: 'en preparación', en: 'being prepared', pt: 'em preparo', fr: 'en préparation' },
    ready: { es: 'listo', en: 'ready', pt: 'pronto', fr: 'prête' },
    on_the_way: { es: 'en camino', en: 'on its way', pt: 'a caminho', fr: 'en route' },
    delivered: { es: 'entregado', en: 'delivered', pt: 'entregue', fr: 'livrée' },
    completed: { es: 'completado', en: 'completed', pt: 'concluído', fr: 'terminée' },
    paid: { es: 'pagado', en: 'paid', pt: 'pago', fr: 'payée' },
    failed: { es: 'fallido', en: 'failed', pt: 'com falha', fr: 'échouée' },
    refunded: { es: 'reembolsado', en: 'refunded', pt: 'reembolsado', fr: 'remboursée' },
    rejected: { es: 'rechazado', en: 'rejected', pt: 'recusado', fr: 'refusée' },
};
const STATUS_ALIASES: Record<string, string> = {
    canceled: 'cancelled', cancelado: 'cancelled', cancelada: 'cancelled', anulado: 'cancelled', anulada: 'cancelled', voided: 'cancelled',
    in_preparation: 'preparing', in_progress: 'preparing', out_for_delivery: 'on_the_way', dispatched: 'on_the_way', shipped: 'on_the_way',
    picked_up: 'delivered', fulfilled: 'delivered', entregado: 'delivered',
};
const CANCELLED = new Set(['cancelled']);

function statusWord(raw: string, lang: Lang): string {
    const key = String(raw || '').trim().toLowerCase();
    const canonical = STATUS_ALIASES[key] ?? key;
    return STATUS_WORDS[canonical]?.[lang] ?? key.replace(/_/g, ' ');
}

function langOf(lang?: string): Lang {
    const code = String(lang || 'es').slice(0, 2).toLowerCase();
    return (['es', 'en', 'pt', 'fr'] as const).includes(code as Lang) ? code as Lang : 'es';
}

function view(row: any): OrderView | null {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || typeof row.status !== 'string') return null;
    const items = (Array.isArray(row.items) ? row.items : [])
        .map((item: any) => ({ name: String(item?.productName ?? item?.name ?? '').trim(), quantity: Number.isFinite(Number(item?.quantity)) ? Number(item.quantity) : null }))
        .filter((item: { name: string }) => !!item.name);
    return {
        id: row.id,
        reference: typeof row.reference === 'string' && row.reference.trim() ? row.reference.trim() : shortReference(row.id),
        status: row.status,
        paymentStatus: typeof row.paymentStatus === 'string' ? row.paymentStatus : '',
        total: row.total ?? row.totalAmount ?? null,
        currency: typeof row.currency === 'string' ? row.currency : null,
        items,
        createdAt: Date.parse(String(row.createdAt ?? row.created_at ?? '')),
    };
}

/**
 * The newest order the turn read, merged with its detail read when there is one (the list may carry no items), and how many
 * orders the customer has when the list says it is complete. Null when the turn read no order.
 */
export function pastOrdersOfTurn(reads: ReadonlyArray<{ name?: string; result?: any }>): { latest: OrderView; count: number | null } | null {
    const details = new Map<string, OrderView>();
    let listed: OrderView[] = [];
    let count: number | null = null;
    for (const read of reads || []) {
        const result = read?.result;
        if (!result || typeof result !== 'object' || result.error || result.success === false) continue;
        if (LIST_READS.has(String(read.name)) && Array.isArray(result.orders)) {
            const rows = result.orders.map(view).filter((row: OrderView | null): row is OrderView => !!row);
            if (rows.length >= listed.length) {
                listed = rows;
                count = typeof result.total === 'number' ? result.total : result.hasMore === false || result.complete === true ? rows.length : null;
            }
            continue;
        }
        for (const row of [result.order, /order/.test(String(read.name)) ? result : null]) {
            const detail = view(row);
            if (detail) details.set(detail.id, detail);
        }
    }
    const candidates = listed.length ? listed : [...details.values()];
    if (!candidates.length) return null;
    const dated = candidates.every(row => Number.isFinite(row.createdAt));
    const newest = dated ? candidates.reduce((best, row) => (row.createdAt > best.createdAt ? row : best), candidates[0]) : candidates[0];
    const detail = details.get(newest.id);
    const latest: OrderView = detail ? {
        ...newest, ...detail,
        items: detail.items.length ? detail.items : newest.items,
        total: detail.total ?? newest.total, currency: detail.currency ?? newest.currency,
    } : newest;
    return { latest, count: listed.length ? count : null };
}

const TEXT: Record<Lang, {
    lead: (ref: string) => string; items: (list: string) => string; total: (amount: string) => string;
    status: (status: string) => string; payment: (status: string) => string; count: (n: number) => string;
}> = {
    es: {
        lead: ref => `Su último pedido es el ${ref}`, items: list => `: ${list}`, total: amount => `, por ${amount}`,
        status: status => `. Estado: ${status}`, payment: status => `; pago: ${status}`, count: n => ` En total tiene ${n} pedidos registrados.`,
    },
    en: {
        lead: ref => `Your most recent order is ${ref}`, items: list => `: ${list}`, total: amount => `, for ${amount}`,
        status: status => `. Status: ${status}`, payment: status => `; payment: ${status}`, count: n => ` You have ${n} orders on record.`,
    },
    pt: {
        lead: ref => `Seu último pedido é o ${ref}`, items: list => `: ${list}`, total: amount => `, no valor de ${amount}`,
        status: status => `. Status: ${status}`, payment: status => `; pagamento: ${status}`, count: n => ` Ao todo, você tem ${n} pedidos registrados.`,
    },
    fr: {
        lead: ref => `Votre dernière commande est la ${ref}`, items: list => ` : ${list}`, total: amount => `, pour ${amount}`,
        status: status => `. Statut : ${status}`, payment: status => ` ; paiement : ${status}`, count: n => ` Vous avez ${n} commandes enregistrées au total.`,
    },
};

/**
 * The deterministic answer to «what did I buy / order last time?» from the orders the turn read: the newest order, its items,
 * its total and its REAL status (a cancelled order is said cancelled; its pending payment is not mentioned, it is owed by no one).
 * Null when the turn read no order.
 */
export function pastOrdersReportText(reads: ReadonlyArray<{ name?: string; result?: any }>, lang?: string): string | null {
    const found = pastOrdersOfTurn(reads);
    if (!found) return null;
    const l = langOf(lang);
    const T = TEXT[l];
    const { latest, count } = found;
    const items = latest.items.map(item => (item.quantity && item.quantity > 0 ? `${item.quantity} × ${item.name}` : item.name)).join(', ');
    const total = formatPriceWithCurrency(l, latest.total, latest.currency);
    const canonical = STATUS_ALIASES[latest.status.toLowerCase()] ?? latest.status.toLowerCase();
    const payment = !CANCELLED.has(canonical) && latest.paymentStatus && !/^unknown$/i.test(latest.paymentStatus)
        ? T.payment(statusWord(latest.paymentStatus, l)) : '';
    return T.lead(latest.reference)
        + (items ? T.items(items) : '')
        + (total ? T.total(total) : '')
        + T.status(statusWord(latest.status, l)) + payment + '.'
        + (count && count > 1 ? T.count(count) : '');
}

/**
 * F4300-43 (production QA 26-oct, store tenant, image 994c54a7): «¿cuánto pagué en mi último pedido de la tienda?» read the six
 * orders (all cancelled, payment pending, no payment reference) and the reply was «En su último pedido en la tienda, pagó
 * 119.900 COP», in the four languages. Nothing was ever charged. The total of an order is not money the customer paid.
 *
 * Only the verbs that say the CUSTOMER paid count: «pagó», «ha pagado», «you paid», «você pagou», «vous avez payé». The nouns
 * («el pago está pendiente», «payment: pending») say nothing of the kind.
 */
// The passive says it too (production QA 27-oct): «Votre dernier Audífono QA Aurora a été payé 119 900 COP».
const PAID_CLAIM = /(?<!\p{L})(?:pagó|pagaste|pagaron|(?:ha|has|han) pagado|abonó|(?:fue|fueron) pagad[oa]s?|you(?:'ve| have)? paid|(?:was|were) paid|(?:você |voce )?pagou|(?:foi|foram) pag[oa]s?|(?:vous avez|tu as) payée?s?|(?:a|ont) été payée?s?)(?!\p{L})/iu;
const PAID_STATUSES = new Set(['paid', 'captured', 'succeeded', 'settled', 'approved']);

const NOT_PAID: Record<Lang, string> = {
    es: ' No consta ningún pago de este pedido.',
    en: ' No payment is recorded for this order.',
    pt: ' Não consta nenhum pagamento deste pedido.',
    fr: ' Aucun paiement n’est enregistré pour cette commande.',
};

/**
 * The reply corrected from the orders the turn read when it says the customer paid for the newest order and that order shows
 * no payment; null when the reply claims no payment, the turn read no order, or the newest order is paid.
 */
export function unpaidOrderCorrection(reply: string, reads: ReadonlyArray<{ name?: string; result?: any }>, lang?: string): string | null {
    if (!PAID_CLAIM.test(String(reply || ''))) return null;
    const found = pastOrdersOfTurn(reads);
    if (!found || PAID_STATUSES.has(found.latest.paymentStatus.toLowerCase())) return null;
    const report = pastOrdersReportText(reads, lang);
    return report ? report + NOT_PAID[langOf(lang)] : null;
}

/**
 * F4300-11 residual (production QA 27-oct, store tenant, image e96577f4): «¿qué producto compré en mi último pedido de la tienda?»
 * read the orders and was answered «En su último pedido de la tienda, Ref. 20FD6A98, compró 1 unidad del producto Audífono QA
 * Aurora por 119.900 COP» — and «you purchased», «você comprou», «vous avez acheté» — without a word that the order is cancelled.
 * A cancelled order is not a purchase: the reply that tells it as one, and never says it was cancelled, is said from the read.
 */
const PURCHASE_CLAIM = /(?<!\p{L})(?:compr[óo]|compraste|compraron|(?:ha|has|han) comprado|you(?:'ve| have)? (?:purchased|bought)|(?:você |voce )?comprou|(?:vous avez|tu as|j'ai|j’ai) achetée?s?)(?!\p{L})/iu;
const CANCEL_WORD = /(?<!\p{L})(?:cancel|anul|annul)/iu;

/**
 * The report of the orders read when the reply tells the newest order (by its reference or an item of it) as bought and that order
 * is cancelled, and the reply never says so; null otherwise.
 */
export function cancelledPurchaseCorrection(reply: string, reads: ReadonlyArray<{ name?: string; result?: any }>, lang?: string): string | null {
    const text = String(reply || '');
    if (!PURCHASE_CLAIM.test(text) || CANCEL_WORD.test(text)) return null;
    const found = pastOrdersOfTurn(reads);
    if (!found) return null;
    const { latest } = found;
    if (!CANCELLED.has(STATUS_ALIASES[latest.status.toLowerCase()] ?? latest.status.toLowerCase())) return null;
    const folded = foldText(text);
    const told = folded.includes(foldText(latest.reference)) || latest.items.some(item => folded.includes(foldText(item.name)));
    return told ? pastOrdersReportText(reads, lang) : null;
}

/**
 * F4300-45 residual (production QA 26-oct, store tenant, image fc0c6c76): with #242 «¿cuál fue mi primer pedido en la tienda?»
 * read the six orders, and the reply named the NEWEST one — «Su primer pedido en la tienda fue el 10 de octubre de 2026, con el
 * número de Ref. 20FD6A98» — in es/pt/en/fr. The list comes newest first; the oldest order is of 8-oct. The customer's first
 * order is said from the oldest order the turn read.
 */
const FIRST_ORDER = /(?<!\p{L})(?:mi (?:primer|primera) (?:pedido|compra|orden)|my (?:first|earliest|oldest) (?:store |shop |restaurant )?(?:order|purchase)|(?:meu primeiro pedido|minha primeira compra|minha primeira encomenda)|(?:ma premi[eè]re commande|mon premier achat))(?!\p{L})/iu;

const LOCALE: Record<Lang, string> = { es: 'es-CO', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR' };
const FIRST_LEAD: Record<Lang, (ref: string, date: string) => string> = {
    es: (ref, date) => `Su primer pedido es el ${ref}, del ${date}`,
    en: (ref, date) => `Your first order is ${ref}, placed on ${date}`,
    pt: (ref, date) => `Seu primeiro pedido é o ${ref}, de ${date}`,
    fr: (ref, date) => `Votre première commande est la ${ref}, du ${date}`,
};

/** The orders the turn's list reads returned, newest list first (as `pastOrdersOfTurn` picks it). */
function listedOrdersOfTurn(reads: ReadonlyArray<{ name?: string; result?: any }>): OrderView[] {
    let listed: OrderView[] = [];
    for (const read of reads || []) {
        const result = read?.result;
        if (!result || typeof result !== 'object' || result.error || result.success === false) continue;
        if (!LIST_READS.has(String(read.name)) || !Array.isArray(result.orders)) continue;
        const rows = result.orders.map(view).filter((row: OrderView | null): row is OrderView => !!row);
        if (rows.length >= listed.length) listed = rows;
    }
    return listed;
}

const foldText = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Month names of the four languages, folded, mapped to their month number (1-12). */
const MONTHS: ReadonlyMap<string, number> = (() => {
    const months = new Map<string, number>();
    for (const locale of Object.values(LOCALE)) {
        const format = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });
        for (let m = 0; m < 12; m++) months.set(foldText(format.format(new Date(Date.UTC(2026, m, 15)))), m + 1);
    }
    return months;
})();
const MONTH_NAMES = [...MONTHS.keys()].join('|');
const DAY_MONTH = new RegExp(`(?<!\\d)(\\d{1,2})(?:er|º|°)?\\s+(?:de\\s+)?(${MONTH_NAMES})(?!\\p{L})`, 'gu');
const MONTH_DAY = new RegExp(`(?<!\\p{L})(${MONTH_NAMES})\\s+(\\d{1,2})(?!\\d)`, 'gu');

// Production QA 27-oct (image c3cf6985): «feito em 2026-10-08» — the model also cites the read's ISO date.
const ISO_DAY = /(?<!\d)\d{4}-(\d{2})-(\d{2})(?!\d)/g;

/** The dates the reply cites («7 de outubro», «October 10», «1er octobre», «2026-10-08»), as `month-day` keys. */
function citedDays(reply: string): string[] {
    const text = foldText(reply);
    return [
        ...[...text.matchAll(DAY_MONTH)].map(m => `${MONTHS.get(m[2])}-${Number(m[1])}`),
        ...[...text.matchAll(MONTH_DAY)].map(m => `${MONTHS.get(m[1])}-${Number(m[2])}`),
        ...[...text.matchAll(ISO_DAY)].map(m => `${Number(m[1])}-${Number(m[2])}`),
    ];
}

/** A date formatted in the tenant's zone, or in UTC when the zone is unknown or invalid. */
function zoned<T>(timeZone: string | undefined, make: (zone: string) => T): T {
    try {
        return make(timeZone || 'UTC');
    } catch {
        return make('UTC');
    }
}

/**
 * The reply corrected from the orders read when the customer asks for their FIRST order and the reply names the newest one
 * (its reference) instead of the oldest, or names the oldest but tells it with another order's date; null otherwise (another
 * question, no dated order, a reply that names another order of the list, or one that tells the oldest order — by its reference
 * or by none — with its own date or with no date).
 *
 * F4300-45 (production QA 27-oct, image 399e594e): «qual foi meu primeiro pedido na loja?» named the oldest order, 2EACE76F, «feito
 * em 10 de outubro de 2026» — the newest order's date; 2EACE76F is of 7-oct. With #247 (c3cf6985) «when did I place my first order
 * in the store?» got «You placed your first order on October 8, 2026»: no reference, the date of no order in the tenant's zone.
 */
export function firstOrderCorrection(customerText: string, reply: string, reads: ReadonlyArray<{ name?: string; result?: any }>,
    lang?: string, timeZone?: string): string | null {
    if (!FIRST_ORDER.test(String(customerText || ''))) return null;
    const rows = listedOrdersOfTurn(reads).filter(row => Number.isFinite(row.createdAt));
    if (!rows.length) return null;
    const oldest = rows.reduce((best, row) => (row.createdAt < best.createdAt ? row : best), rows[0]);
    const newest = rows.reduce((best, row) => (row.createdAt > best.createdAt ? row : best), rows[0]);
    const text = String(reply || '').toUpperCase();
    const names = (row: OrderView) => text.includes(row.reference.toUpperCase());
    const newestAsFirst = oldest.id !== newest.id && names(newest) && !names(oldest);
    if (!newestAsFirst) {
        if (!names(oldest) && rows.some(names)) return null;
        const own = zoned(timeZone, zone => {
            const parts = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'numeric', timeZone: zone }).formatToParts(new Date(oldest.createdAt));
            return `${Number(parts.find(p => p.type === 'month')?.value)}-${Number(parts.find(p => p.type === 'day')?.value)}`;
        });
        const cited = citedDays(String(reply || ''));
        if (!cited.length || cited.includes(own)) return null;
    }
    const l = langOf(lang);
    const date = zoned(timeZone, zone => new Intl.DateTimeFormat(LOCALE[l], { day: 'numeric', month: 'long', year: 'numeric', timeZone: zone })
        .format(new Date(oldest.createdAt)));
    const T = TEXT[l];
    const items = oldest.items.map(item => (item.quantity && item.quantity > 0 ? `${item.quantity} × ${item.name}` : item.name)).join(', ');
    const total = formatPriceWithCurrency(l, oldest.total, oldest.currency);
    return FIRST_LEAD[l](oldest.reference, date)
        + (items ? T.items(items) : '')
        + (total ? T.total(total) : '')
        + T.status(statusWord(oldest.status, l)) + '.'
        // «¿mi primer pedido está pagado?» (production QA 27-oct): the correction must still say whether it was paid.
        + (PAID_STATUSES.has(oldest.paymentStatus.toLowerCase()) ? '' : NOT_PAID[l]);
}
