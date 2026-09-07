import { createHash } from 'crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';

export const CATALOG_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CENTS = 999999999999999n; // PostgreSQL numeric(15,2).
export interface CatalogRequestedItem { productId: string; quantity: number; productName?: string; unitPrice?: number; currency?: string }
export interface CatalogOrderTerms {
    version: 1; action: 'create'; currency: string; totalAmountCents: string;
    items: { productId: string; productName: string; quantity: number; unitAmountCents: string; totalAmountCents: string; tracksStock: boolean }[];
    notes: string;
}
export interface CatalogCancelTerms {
    version: 1; action: 'cancel'; orderId: string; orderVersion: number;
    status: string; paymentStatus: string; currency: string; totalAmountCents: string;
}
export type CatalogTerms = CatalogOrderTerms | CatalogCancelTerms;
export interface CatalogCreateInput {
    contactId?: string | null; conversationId?: string | null; opportunityId?: string | null;
    status?: 'pending' | 'confirmed' | 'paid'; paymentMethod?: string; notes?: string; currency?: string;
    items: CatalogRequestedItem[]; idempotencyKey?: string; expectedTermsHash?: string;
}
export interface CatalogCommandOptions { source: 'agent' | 'tenant_user'; expectedTermsHash?: string; actorId?: string | null; }
export function catalogHash(value: unknown): string {
    const stable = (item: any): any => Array.isArray(item) ? item.map(stable) : item && typeof item === 'object'
        ? Object.fromEntries(Object.keys(item).sort().map(key => [key, stable(item[key])])) : item;
    return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
export function catalogItems(value: unknown): CatalogRequestedItem[] {
    if (!Array.isArray(value) || !value.length || value.length > 100) throw new BadRequestException('catalog_items_invalid');
    const seen = new Set<string>();
    return value.map(item => {
        const productId = typeof item?.productId === 'string' ? item.productId.toLowerCase() : '';
        if (!CATALOG_UUID.test(productId) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000 || seen.has(productId)) throw new BadRequestException('catalog_items_invalid');
        seen.add(productId);
        return { productId, quantity: item.quantity };
    }).sort((a, b) => a.productId.localeCompare(b.productId));
}
export function catalogText(value: unknown, limit = 2000): string {
    if (value == null) return '';
    if (typeof value !== 'string' || value.length > limit) throw new BadRequestException('catalog_text_invalid');
    return value.trim();
}
export function catalogCurrency(value: unknown): string {
    const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!/^[A-Z]{3}$/.test(code)) throw new ConflictException('catalog_currency_unavailable');
    return code;
}
export function catalogCents(value: unknown): bigint {
    const text = String(value ?? '');
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new ConflictException('catalog_price_invalid');
    const [whole, fraction = ''] = text.split('.');
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (cents > MAX_CENTS) throw new ConflictException('catalog_amount_out_of_range');
    return cents;
}
export function catalogDecimal(cents: bigint): string {
    if (cents < 0 || cents > MAX_CENTS) throw new ConflictException('catalog_amount_out_of_range');
    return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
export function catalogTerms(products: any[], items: CatalogRequestedItem[], notes: string, source: CatalogCommandOptions['source']): CatalogOrderTerms {
    const byId = new Map(products.map(row => [row.id, row]));
    const currencies = new Set<string>(); let total = 0n;
    const lines = items.map(item => {
        const product = byId.get(item.productId);
        if (!product) throw new ConflictException('catalog_product_not_found');
        if (product.is_available !== true) throw new CatalogProductReviewError('catalog_product_unavailable', product, item.quantity);
        if (source === 'agent' && product.requires_prescription === true) throw new CatalogProductReviewError('catalog_prescription_review_required', product, item.quantity);
        const tracksStock = product.stock !== null && product.stock !== undefined;
        if (tracksStock && (!Number.isInteger(Number(product.stock)) || Number(product.stock) < item.quantity)) throw new CatalogProductReviewError('catalog_stock_insufficient', product, item.quantity);
        const unit = catalogCents(product.price), amount = unit * BigInt(item.quantity);
        catalogDecimal(amount); total += amount; catalogDecimal(total);
        currencies.add(catalogCurrency(product.currency));
        return { ...item, productName: String(product.name), unitAmountCents: String(unit), totalAmountCents: String(amount), tracksStock };
    });
    if (currencies.size !== 1) throw new ConflictException('catalog_currency_mismatch');
    return { version: 1, action: 'create', currency: [...currencies][0], totalAmountCents: String(total), items: lines, notes };
}
export class CatalogTermsChangedError extends ConflictException {
    constructor(readonly currentTerms: CatalogTerms) { super('catalog_terms_changed'); }
}
/** Only facts obtained from the locked canonical product row may accompany a failure. */
export class CatalogProductReviewError extends ConflictException {
    readonly evidence: {productId:string;productName:string;requested:number;available?:number};
    constructor(code:string, product:{id:string;name:string;stock:unknown}, requested:number) {
        super(code);
        this.evidence={productId:product.id,productName:String(product.name),requested,
            ...(product.stock!==null&&product.stock!==undefined&&Number.isInteger(Number(product.stock))&&Number(product.stock)>=0
                ?{available:Number(product.stock)}:{})};
    }
}
export function catalogTermsReviewResult(terms: CatalogTerms, error = 'confirmation_required'): Record<string, unknown> {
    return { error, persisted:false,requiresConfirmation:true,retryable:false,catalogTerms:terms,
        message: terms.action==='create'
            ? 'Show the exact products, quantities, unit prices, total and currency, then ask for explicit confirmation. This records an order only; it does not confirm payment or delivery.'
            : 'Show which owned order will be cancelled and its current status and amount, then ask for explicit cancellation confirmation. No refund or payment reversal is included.' };
}
export function catalogActionError(error: unknown): Record<string, unknown> {
    const code = error instanceof Error ? error.message : '';
    const recognized = new Set(['catalog_items_invalid','catalog_text_invalid','catalog_product_not_found','catalog_product_unavailable',
        'catalog_prescription_review_required','catalog_stock_insufficient','catalog_price_invalid','catalog_amount_out_of_range',
        'catalog_currency_unavailable','catalog_currency_mismatch','catalog_request_changed','catalog_order_not_found',
        'catalog_cancellation_review_required','catalog_stock_reconciliation_required','catalog_version_changed','catalog_terms_required','contact_erased',
        'catalog_contact_invalid','catalog_conversation_invalid','catalog_limit_invalid','catalog_status_invalid']);
    // A transport/commit acknowledgement error does not prove rollback. Do not
    // tell the customer nothing happened when the database outcome is unknown.
    if(!recognized.has(code)&&!(error instanceof CatalogTermsChangedError)) return {
        error:'catalog_operation_unavailable',outcome:'unverified',retryable:false,shouldHandoff:true,
        message:'The order operation could not be verified. Check the owned order through the normal privacy and ownership checks before retrying. Do not claim creation, cancellation, payment, dispatch or refund.'};
    return { error: recognized.has(code) ? code : 'catalog_operation_unavailable', persisted: false, retryable: false,
        ...(error instanceof CatalogProductReviewError ? error.evidence : {}),
        ...(error instanceof CatalogTermsChangedError ? { error: 'catalog_terms_changed', catalogTerms: error.currentTerms, requiresConfirmation: true } : {}),
        ...(['catalog_prescription_review_required','catalog_cancellation_review_required','catalog_stock_reconciliation_required'].includes(code) ? { shouldHandoff: true } : {}),
        message: 'No order action was completed. Use the current catalog/order evidence to explain the problem and the next safe step. Do not claim payment, dispatch, refund or medical approval.' };
}
