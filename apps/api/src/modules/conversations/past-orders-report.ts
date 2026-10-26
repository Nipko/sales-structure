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
const PAID_CLAIM = /(?<!\p{L})(?:pagó|pagaste|pagaron|(?:ha|has|han) pagado|abonó|you(?:'ve| have)? paid|(?:você |voce )?pagou|(?:vous avez|tu as) payée?s?)(?!\p{L})/iu;
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
