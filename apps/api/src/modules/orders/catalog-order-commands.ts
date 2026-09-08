import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { assertServedAgentAuthority, type ServedAgentAuthority } from '../persona/served-agent-authority';
import { PrismaService } from '../prisma/prisma.service';
import { TenantQuery, requireTenantContact } from '../../common/utils/tenant-contact.util';
import { resolveNativeEvidenceOpportunity } from '../../common/utils/native-evidence-opportunity.util';
import { CatalogCancelTerms, CatalogCommandOptions, CatalogCreateInput, CatalogOrderTerms, CatalogTermsChangedError,
    CATALOG_UUID, catalogCents, catalogCurrency, catalogDecimal, catalogHash, catalogItems, catalogTerms, catalogText } from './catalog-order-contract';

/** Tenant schema is a server-owned port, never a tool argument. No external effects. */
export class CatalogOrderCommands {
    constructor(private readonly prisma: PrismaService) {}

    private transaction<T>(schema: string, work: (query: TenantQuery) => Promise<T>): Promise<T> {
        return this.prisma.transactionInTenantSchema(schema, async query => {
            await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text', [`agent-privacy:${schema}`]);
            return work(query);
        });
    }
    private async identity(query: TenantQuery, schema: string, contactId: string | null, conversationId?: string | null): Promise<void> {
        await requireTenantContact(query, contactId);
        if (contactId) {
            const tables = await query<any[]>('SELECT to_regclass($1)::text AS name', [`${schema}.customer_memory_erasure`]);
            if (tables[0]?.name && (await query<any[]>('SELECT contact_id FROM customer_memory_erasure WHERE contact_id=$1::uuid', [contactId])).length) throw new ConflictException('contact_erased');
        }
        if (conversationId) {
            if (!CATALOG_UUID.test(conversationId) || !contactId) throw new BadRequestException('catalog_conversation_invalid');
            const rows = await query<any[]>('SELECT id FROM conversations WHERE id=$1::uuid AND contact_id=$2::uuid FOR SHARE', [conversationId, contactId]);
            if (!rows.length) throw new BadRequestException('catalog_conversation_invalid');
        }
    }
    private contact(value: unknown, required = false): string | null {
        if (value == null && !required) return null;
        if (typeof value !== 'string' || !CATALOG_UUID.test(value)) throw new BadRequestException('catalog_contact_invalid');
        return value.toLowerCase();
    }
    private async products(query: TenantQuery, items: CatalogCreateInput['items']): Promise<any[]> {
        // Every catalog writer and stock adjustment takes product locks in UUID order.
        return query<any[]>('SELECT id,name,price,currency,stock,is_available,requires_prescription FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [items.map(item => item.productId)]);
    }
    async quote(schema: string, data: CatalogCreateInput, source: CatalogCommandOptions['source'] = 'agent'): Promise<CatalogOrderTerms> {
        const items = catalogItems(data?.items), contactId = this.contact(data.contactId, source === 'agent');
        return this.transaction(schema, async query => {
            await this.identity(query, schema, contactId, data.conversationId);
            return catalogTerms(await this.products(query, items), items, catalogText(data.notes), source);
        });
    }
    async create(schema: string, data: CatalogCreateInput, options: CatalogCommandOptions): Promise<any> {
        if (!data || typeof data !== 'object') throw new BadRequestException('catalog_items_invalid');
        const items = catalogItems(data.items), contactId = this.contact(data.contactId, options.source === 'agent');
        const status = data.status || 'pending';
        if (!['pending','confirmed','paid'].includes(status) || (options.source === 'agent' && status !== 'pending')) throw new BadRequestException('catalog_status_invalid');
        const key = catalogText(data.idempotencyKey, 200) || null;
        if (options.source === 'agent' && (!key || !options.expectedTermsHash)) throw new ConflictException('catalog_terms_required');
        const notes = catalogText(data.notes), paymentMethod = catalogText(data.paymentMethod, 100) || 'cash';
        const requestHash = catalogHash({ contactId, conversationId: data.conversationId || null, opportunityId: data.opportunityId || null,
            items, notes, status, paymentMethod, currency: data.currency || null, expectedTermsHash: options.expectedTermsHash || null, source: options.source });
        return this.transaction(schema, async query => {
            await assertServedAgentAuthority(query, schema, options.operationalScope);
            await this.identity(query, schema, contactId, data.conversationId);
            if (key) {
                await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', [`catalog-order:${schema}:${key}`]);
                const existing = await query<any[]>('SELECT * FROM orders WHERE idempotency_key=$1 FOR UPDATE', [key]);
                if (existing[0]) {
                    if (existing[0].request_hash !== requestHash) throw new ConflictException('catalog_request_changed');
                    return { ...await this.result(query, existing[0]), idempotentReplay: true };
                }
            }
            const opportunityId = await resolveNativeEvidenceOpportunity(query, { contactId, conversationId: data.conversationId, trustedOpportunityId: data.opportunityId });
            const products = await this.products(query, items);
            const terms = catalogTerms(products, items, notes, options.source);
            if (data.currency && catalogCurrency(data.currency) !== terms.currency) throw new ConflictException('catalog_currency_mismatch');
            if (options.expectedTermsHash && options.expectedTermsHash !== catalogHash(terms)) throw new CatalogTermsChangedError(terms);
            const rows = await query<any[]>(`INSERT INTO orders(id,contact_id,opportunity_id,conversation_id,status,total_amount,currency,notes,metadata,idempotency_key,request_hash,catalog_terms)
                VALUES(gen_random_uuid(),$1::uuid,$2::uuid,$3::uuid,$4,$5::numeric,$6,$7,$8::jsonb,$9,$10,$11::jsonb) RETURNING *`,
                [contactId,opportunityId,data.conversationId || null,status,catalogDecimal(BigInt(terms.totalAmountCents)),terms.currency,notes,
                    JSON.stringify({payment_method:paymentMethod,catalogSource:options.source,createdBy:options.actorId || null}),key,requestHash,JSON.stringify(terms)]);
            const order = rows[0];
            if (!order?.id) throw new Error('catalog_order_insert_failed');
            const byId = new Map(products.map(product => [product.id, product]));
            for (const item of terms.items) {
                const stockDeducted = item.tracksStock ? item.quantity : 0;
                const line = await query<any[]>(`INSERT INTO order_items(id,order_id,product_id,product_name,quantity,unit_price,total_price,stock_deducted)
                    VALUES(gen_random_uuid(),$1::uuid,$2::uuid,$3,$4,$5::numeric,$6::numeric,$7) RETURNING id`,
                    [order.id,item.productId,item.productName,item.quantity,catalogDecimal(BigInt(item.unitAmountCents)),catalogDecimal(BigInt(item.totalAmountCents)),stockDeducted]);
                if (!line[0]?.id) throw new Error('catalog_line_insert_failed');
                if (!stockDeducted) continue;
                const previous = Number(byId.get(item.productId).stock), next = previous - item.quantity;
                await query('UPDATE products SET stock=$2,updated_at=NOW() WHERE id=$1::uuid', [item.productId,next]);
                await query(`INSERT INTO stock_movements(id,product_id,type,quantity,previous_stock,new_stock,reason,order_id,order_item_id)
                    VALUES(gen_random_uuid(),$1::uuid,'out',$2,$3,$4,'catalog_order',$5::uuid,$6::uuid)`, [item.productId,item.quantity,previous,next,order.id,line[0].id]);
            }
            return this.result(query, order);
        });
    }
    private async result(query: TenantQuery, row: any): Promise<any> {
        const lines = await query<any[]>('SELECT * FROM order_items WHERE order_id=$1::uuid ORDER BY product_id,id', [row.id]);
        return { id:row.id,version:row.version,status:row.status,paymentStatus:row.payment_status || 'unknown',
            totalAmount:Number(row.total_amount),totalAmountCents:String(catalogCents(row.total_amount)),currency:row.currency,
            contactId:row.contact_id,conversationId:row.conversation_id,notes:row.notes || '',createdAt:row.created_at,updatedAt:row.updated_at,
            items:lines.map(line=>({id:line.id,productId:line.product_id,productName:line.product_name,quantity:line.quantity,
                unitPrice:Number(line.unit_price),totalPrice:Number(line.total_price),stockDeducted:line.stock_deducted ?? null})),
            fulfillmentStatus:'not_recorded' };
    }
    async listOwned(schema: string, contact: string, limit = 20): Promise<any[]> {
        const contactId = this.contact(contact, true);
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new BadRequestException('catalog_limit_invalid');
        return this.transaction(schema, async query => {
            await this.identity(query,schema,contactId);
            const rows = await query<any[]>('SELECT * FROM orders WHERE contact_id=$1::uuid ORDER BY created_at DESC,id DESC LIMIT $2', [contactId,limit]);
            const results = []; for (const row of rows) results.push(await this.result(query,row));
            return results;
        });
    }
    private async ownedRow(query: TenantQuery, id: string, contactId: string | null): Promise<any> {
        if (!CATALOG_UUID.test(id)) throw new NotFoundException('catalog_order_not_found');
        const rows = await query<any[]>('SELECT * FROM orders WHERE id=$1::uuid AND ($2::uuid IS NULL OR contact_id=$2::uuid) FOR UPDATE', [id,contactId]);
        if (!rows[0]) throw new NotFoundException('catalog_order_not_found');
        return rows[0];
    }
    async getOwned(schema: string, id: string, contact: string): Promise<any> {
        const contactId = this.contact(contact,true);
        return this.transaction(schema, async query => {
            await this.identity(query,schema,contactId);
            return this.result(query,await this.ownedRow(query,id,contactId));
        });
    }
    private termsForCancel(row: any): CatalogCancelTerms {
        return {version:1,action:'cancel',orderId:row.id,orderVersion:row.version,status:row.status,paymentStatus:row.payment_status || 'unknown',
            currency:catalogCurrency(row.currency),totalAmountCents:String(catalogCents(row.total_amount))};
    }
    private async checkCancellation(query: TenantQuery, schema: string, row: any): Promise<void> {
        if (!['pending','confirmed'].includes(row.status) || !['pending','failed'].includes(row.payment_status || 'unknown')) throw new ConflictException('catalog_cancellation_review_required');
        const tables = await query<any[]>('SELECT to_regclass($1)::text AS name',[`${schema}.tenant_payment_intents`]);
        // reserve() takes the same order row lock before it can create a payment intent.
        if (tables[0]?.name) {
            const intents = await query<any[]>(`SELECT id FROM tenant_payment_intents WHERE canonical_reference=$1
                AND (status IN ('pending','paid','refunded','requires_review','ambiguous') OR provider_transaction_id IS NOT NULL) LIMIT 1`, [`order:${row.id}`]);
            if (intents.length) throw new ConflictException('catalog_cancellation_review_required');
        }
    }
    async cancellationTerms(schema: string, id: string, contact: string): Promise<CatalogCancelTerms> {
        const contactId=this.contact(contact,true);
        return this.transaction(schema,async query=>{
            await this.identity(query,schema,contactId); const row=await this.ownedRow(query,id,contactId);
            if(row.status==='cancelled' && row.metadata?.catalogCancellation?.terms) return row.metadata.catalogCancellation.terms;
            await this.checkCancellation(query,schema,row); return this.termsForCancel(row);
        });
    }
    async cancel(schema: string,id: string,contact: string | null,options: {source:'agent'|'tenant_user';expectedVersion?:number;expectedTermsHash?:string;reason?:string;actorId?:string|null;operationalScope?:ServedAgentAuthority}): Promise<any> {
        const contactId=this.contact(contact,options.source==='agent'), reason=catalogText(options.reason,1000);
        if (options.source==='agent' && (!Number.isInteger(options.expectedVersion)||!options.expectedTermsHash)) throw new ConflictException('catalog_terms_required');
        return this.transaction(schema,async query=>{
            await assertServedAgentAuthority(query, schema, options.operationalScope);
            if(contactId) await this.identity(query,schema,contactId);
            const row=await this.ownedRow(query,id,contactId);
            if(!contactId && row.contact_id) await this.identity(query,schema,row.contact_id);
            const prior=row.metadata?.catalogCancellation;
            if(row.status==='cancelled' && prior && (!options.expectedTermsHash || prior.termsHash===options.expectedTermsHash)) return {...await this.result(query,row),idempotentReplay:true};
            const terms=this.termsForCancel(row);
            if(options.expectedTermsHash && catalogHash(terms)!==options.expectedTermsHash) throw new CatalogTermsChangedError(terms);
            if(options.expectedVersion!==undefined && options.expectedVersion!==row.version) throw new ConflictException('catalog_version_changed');
            await this.checkCancellation(query,schema,row);
            const lines=await query<any[]>('SELECT * FROM order_items WHERE order_id=$1::uuid ORDER BY product_id,id FOR UPDATE',[id]);
            if(!lines.length || lines.some(line=>line.stock_deducted===null || line.stock_deducted===undefined)) throw new ConflictException('catalog_stock_reconciliation_required');
            const products=await query<any[]>('SELECT id,stock FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[lines.filter(line=>line.stock_deducted>0).map(line=>line.product_id)]);
            const byId=new Map(products.map(product=>[product.id,product]));
            for(const line of lines){
                if(line.stock_deducted===0) continue;
                const product=byId.get(line.product_id),quantity=Number(line.stock_deducted);
                if(!product || product.stock===null || !Number.isInteger(quantity) || quantity<1 || quantity!==line.quantity) throw new ConflictException('catalog_stock_reconciliation_required');
                const previous=Number(product.stock),next=previous+quantity;
                if(!Number.isInteger(previous)||previous<0||next>2147483647) throw new ConflictException('catalog_stock_reconciliation_required');
                await query('UPDATE products SET stock=$2,updated_at=NOW() WHERE id=$1::uuid',[line.product_id,next]);
                // Historical orders can contain repeated product lines. The next
                // line must continue from this locked balance, not its first read.
                product.stock=next;
                await query(`INSERT INTO stock_movements(id,product_id,type,quantity,previous_stock,new_stock,reason,order_id,order_item_id)
                    VALUES(gen_random_uuid(),$1::uuid,'in',$2,$3,$4,'catalog_cancellation',$5::uuid,$6::uuid)`,[line.product_id,quantity,previous,next,id,line.id]);
            }
            const updated=await query<any[]>(`UPDATE orders SET status='cancelled',version=version+1,updated_at=NOW(),metadata=COALESCE(metadata,'{}'::jsonb)||$2::jsonb WHERE id=$1::uuid RETURNING *`,
                [id,JSON.stringify({catalogCancellation:{terms,termsHash:catalogHash(terms),reason,source:options.source,actorId:options.actorId||null}})]);
            return this.result(query,updated[0]);
        });
    }
    async advance(schema: string,id: string,next: string,expectedVersion?: number): Promise<void> {
        if(!['confirmed','paid'].includes(next)) throw new BadRequestException('catalog_status_invalid');
        await this.transaction(schema,async query=>{
            const row=await this.ownedRow(query,id,null);
            if(row.contact_id) await this.identity(query,schema,row.contact_id);
            if(row.status===next) return;
            if(expectedVersion!==undefined && expectedVersion!==row.version) throw new ConflictException('catalog_version_changed');
            if(!({pending:['confirmed'],confirmed:['paid']} as Record<string,string[]>)[row.status]?.includes(next)) throw new ConflictException('catalog_status_invalid');
            // This is an operator's commercial status. Provider settlement remains payment_status.
            await query('UPDATE orders SET status=$1,version=version+1,updated_at=NOW() WHERE id=$2::uuid',[next,id]);
        });
    }
    /** Human-only repair of missing historical evidence; this does not adjust stock. */
    async recordStockEvidence(schema:string,id:string,input:{expectedVersion:number;source:string;reason:string;lines:{lineId:string;stockDeducted:number}[]},actorId:string):Promise<any>{
        if(!CATALOG_UUID.test(actorId||'')||!Number.isInteger(input?.expectedVersion)||input.expectedVersion<1) throw new BadRequestException('catalog_stock_evidence_invalid');
        const source=catalogText(input.source,500),reason=catalogText(input.reason,1000);
        if(!source||!reason||!Array.isArray(input.lines)||!input.lines.length||input.lines.length>100) throw new BadRequestException('catalog_stock_evidence_invalid');
        const lines=input.lines.map(line=>({lineId:line?.lineId,stockDeducted:line?.stockDeducted})).sort((a,b)=>String(a.lineId).localeCompare(String(b.lineId)));
        if(lines.some(line=>!CATALOG_UUID.test(line.lineId||'')||!Number.isInteger(line.stockDeducted)||line.stockDeducted<0)||new Set(lines.map(line=>line.lineId)).size!==lines.length) throw new BadRequestException('catalog_stock_evidence_invalid');
        const hash=catalogHash({expectedVersion:input.expectedVersion,source,reason,lines,actorId});
        return this.transaction(schema,async query=>{
            const row=await this.ownedRow(query,id,null);if(row.contact_id)await this.identity(query,schema,row.contact_id);
            if(row.metadata?.catalogStockEvidence?.hash===hash) return {...await this.result(query,row),idempotentReplay:true};
            if(row.version!==input.expectedVersion)throw new ConflictException('catalog_version_changed');
            if(!['pending','confirmed'].includes(row.status)) throw new ConflictException('catalog_cancellation_review_required');
            const missing=await query<any[]>('SELECT id,quantity FROM order_items WHERE order_id=$1::uuid AND stock_deducted IS NULL ORDER BY id FOR UPDATE',[id]);
            if(missing.length!==lines.length||missing.some(line=>!lines.some(evidence=>evidence.lineId===line.id&&(evidence.stockDeducted===0||evidence.stockDeducted===line.quantity)))) throw new ConflictException('catalog_stock_evidence_invalid');
            for(const line of lines)await query('UPDATE order_items SET stock_deducted=$2 WHERE id=$1::uuid',[line.lineId,line.stockDeducted]);
            const rows=await query<any[]>(`UPDATE orders SET version=version+1,updated_at=NOW(),metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('catalogStockEvidence',$2::jsonb||jsonb_build_object('reviewedAt',NOW())) WHERE id=$1::uuid RETURNING *`,
                [id,JSON.stringify({hash,actorId,source,reason,lines,reviewedVersion:input.expectedVersion})]);
            return this.result(query,rows[0]);
        });
    }
}
