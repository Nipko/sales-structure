import type { TurnContext } from '@parallext/shared';

const MONEY_FIELDS = new Set([
    'price', 'amount', 'total', 'totalamount', 'totalprice', 'nightprice', 'pricepernight',
    'unitprice', 'subtotal', 'cleaningfee', 'servicefee', 'deposit', 'depositamount',
    'amountdue', 'amountpaid', 'balance', 'balanceamount', 'discountamount', 'shippingcost',
    'shippingamount', 'taxamount', 'tuition', 'monthlyprice', 'annualprice', 'copay',
]);
export const KNOWLEDGE_READERS: ReadonlySet<string> = new Set(['search_faqs', 'get_policy', 'search_knowledge_base']);

export interface MoneyFact { amount: number; currency?: string }

/** Lower-cased, underscore-free name of a money-bearing domain field (`night_price` → `nightprice`), or null. */
export function moneyFieldName(key: string): { field: string; cents: boolean } | null {
    const field = key.replace(/_/g, '').toLowerCase();
    const cents = field.endsWith('cents');
    const base = cents ? field.slice(0, -5) : field;
    return MONEY_FIELDS.has(base) ? { field: base, cents } : null;
}

/** Keys whose content is never business data: arguments, notes and people. */
export const NON_DATA_KEYS: ReadonlySet<string> = new Set(['args', 'arguments', 'metadata', 'notes', 'customer', 'contact', 'input']);

/** A tool answer that carries no business data: never monetary (or any other) authority. */
export function isFailedToolResult(result: any): boolean {
    return !result || !!result.error || result.success === false
        || ['failed', 'error', 'unauthorized', 'provider_down', 'not_configured'].includes(result.status);
}

/** Typed amounts found in domain fields; arguments, notes and people are skipped. */
export function collectMoneyFacts(value: unknown, inheritedCurrency?: string, into: MoneyFact[] = []): MoneyFact[] {
    if (!value || typeof value !== 'object') return into;
    if (Array.isArray(value)) {
        value.forEach(item => collectMoneyFacts(item, inheritedCurrency, into));
        return into;
    }
    const record = value as Record<string, unknown>;
    const currency = typeof record.currency === 'string' ? record.currency : inheritedCurrency;
    for (const [key, child] of Object.entries(record)) {
        const money = moneyFieldName(key);
        if (money && (typeof child === 'number' || typeof child === 'string')) {
            const amount = typeof child === 'number' ? child : Number(child);
            if (Number.isFinite(amount) && amount >= 0) into.push({ amount: money.cents ? amount / 100 : amount, currency });
        } else if (!NON_DATA_KEYS.has(key)) {
            collectMoneyFacts(child, currency, into);
        }
    }
    return into;
}

/** Current package prices belong to catalogue readers. Policy fees are a
 * separate question and keep their published-policy/FAQ authority. */
export function requiresCanonicalPackagePrice(query: string): boolean {
    const text = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    // A separate cancellation clause must not downgrade an explicit catalogue
    // price request, e.g. "cuesta el tour; no quiero cancelar".
    if (/\b(?:precio|price|preco|prix|valor|tarifa|cuesta|costs?|custa|coute)\s+(?:(?:el|la|del|de|do|da|of|the|du|des|un|une|por|persona|per|person)\s+)*(?:tour\w*|paquet\w*|package\w*|pacot\w*|excurs\w*|forfait\w*)\b/.test(text)) return true;
    if (/\b(?:cancel\w*|reembolso\w*|refund\w*|penal\w*|annul\w*|rembours\w*)\b/.test(text)) return false;
    return /\b(?:tour\w*|paquet\w*|package\w*|pacot\w*|excurs\w*|forfait\w*)\b/.test(text)
        && /\b(?:precio\w*|cuesta\w*|cost\w*|price\w*|preco\w*|custa\w*|prix|cout\w*|tarif\w*|valor\w*)\b/.test(text);
}

/**
 * Build price evidence from domain fields and retrieved business sources.
 * Customer messages, model history, memory, prompts, arguments and arbitrary
 * tool messages/notes are never monetary authority.
 */
export function buildTrustedPriceCorpus(
    context: Partial<TurnContext> = {},
    executed: Array<{ name: string; result: any }> = [],
    options: { canonicalPackagePrice?: boolean } = {},
): string {
    const facts: MoneyFact[] = [];
    const sourceText: string[] = [];
    const addKnowledgeText = (value: unknown): void => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) return value.forEach(addKnowledgeText);
        for (const [key, child] of Object.entries(value)) {
            if (['answer', 'content', 'chunk_text', 'body', 'text'].includes(key) && typeof child === 'string') sourceText.push(child);
            else if (['data', 'results', 'faqs', 'policy', 'articles', 'chunks', 'hits'].includes(key)) addKnowledgeText(child);
        }
    };
    collectMoneyFacts(context.availableServices, undefined, facts);
    collectMoneyFacts(context.catalog, undefined, facts);
    collectMoneyFacts(context.activeObjects, undefined, facts);
    collectMoneyFacts(context.recentOrders, undefined, facts);
    for (const hit of context.retrievedKnowledge || []) {
        if (hit.content && !options.canonicalPackagePrice) sourceText.push(hit.content);
    }
    for (const { name, result } of executed) {
        if (isFailedToolResult(result)) continue;
        if (options.canonicalPackagePrice && KNOWLEDGE_READERS.has(name)) continue;
        collectMoneyFacts(result, undefined, facts);
        if (KNOWLEDGE_READERS.has(name)) addKnowledgeText(result);
    }
    return JSON.stringify({ facts, sources: sourceText });
}
