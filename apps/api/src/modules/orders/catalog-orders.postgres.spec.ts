import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';
import { InventoryService } from '../inventory/inventory.service';
import { catalogHash, ordersWithoutAgreedTermsSql } from './catalog-order-contract';
import { PAYMENT_REFERENCE_TARGETS } from '../tenant-payments/tenant-payment-reference';
import { TenantPaymentStoreService } from '../tenant-payments/tenant-payment-store.service';
import { AIToolExecutorService } from '../conversations/ai-tool-executor.service';
import { ToolExecutionControlService } from '../conversations/tool-execution-control.service';
import { authorityFor } from '../conversations/__fixtures__/tool-authority.fixture';
import { isolatedEvalNamespaceForPrisma } from '../simulation/isolated-eval-namespace';
import { EVAL_SANDBOX_CONTACT_ID } from '../conversations/agent-test-tool-policy';
import { CATALOG_EVAL_IDS, prepareCatalogEvalFixtures } from './catalog-order-eval-fixtures';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

const databaseUrl = process.env.CATALOG_ORDERS_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('Catalog integrity through real PostgreSQL and Prisma', () => {
    const schema = `tenant_catalog_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID(), contactId = randomUUID(), otherId = randomUUID();
    const productId = randomUUID(), conversationId = randomUUID();
    let client: PrismaClient, prisma: PrismaService, orders: OrdersService, inventory: InventoryService, payments: TenantPaymentStoreService;
    const query = (sql: string, params: any[] = []) => prisma.executeInTenantSchema<any[]>(schema, sql, params);
    const input = (extra: any = {}) => ({ contactId, items: [{ productId, quantity: 2, productName: 'Forged', unitPrice: 1 }], ...extra });
    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation')) throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(sql => client.$executeRawUnsafe(sql));
        await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public');
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)',tenantId,schema);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
        prisma.getTenantSchemaName = async id => { if(id!==tenantId) throw new Error('test_scope_violation'); return schema; };
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await query('CREATE FUNCTION uuid_generate_v4() RETURNS UUID LANGUAGE SQL AS $$ SELECT pg_catalog.gen_random_uuid() $$');
        for (const sql of [
            'CREATE TABLE contacts(id UUID PRIMARY KEY,external_id TEXT NOT NULL,channel_type TEXT NOT NULL,name TEXT,phone TEXT,email TEXT)',
            'CREATE TABLE conversations(id UUID PRIMARY KEY,contact_id UUID REFERENCES contacts(id))',
            'CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id UUID REFERENCES conversations(id),direction TEXT,content_text TEXT,created_at TIMESTAMPTZ DEFAULT NOW())',
            'CREATE TABLE agent_personas(id UUID PRIMARY KEY,version INT,is_active BOOLEAN,config_json JSONB)',
            'CREATE TABLE contact_identities(contact_id UUID,customer_profile_id UUID)',
            'CREATE TABLE leads(id UUID PRIMARY KEY,contact_id UUID)',
            'CREATE TABLE opportunities(id UUID PRIMARY KEY,lead_id UUID,conversation_id UUID,won_at TIMESTAMPTZ,lost_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW())',
            'CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY,erased_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
        ]) await query(sql);
        const ddl = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        for (const table of ['products', 'stock_movements', 'orders', 'order_items']) {
            const start = ddl.indexOf(`CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."${table}" (`);
            if (start < 0) throw new Error('production_catalog_ddl_missing');
            await query(ddl.slice(start, ddl.indexOf('\n);', start) + 3).replaceAll('{{SCHEMA_NAME}}', schema).replaceAll('uuid_generate_v4()','pg_catalog.gen_random_uuid()'));
        }
        await query('ALTER TABLE products ADD COLUMN requires_prescription BOOLEAN NOT NULL DEFAULT false');
        const block = ddl.split('-- BEGIN CATALOG ORDER INTEGRITY')[1]?.split('-- END CATALOG ORDER INTEGRITY')[0];
        if (!block) throw new Error('catalog_integrity_ddl_missing');
        for (const sql of block.replace(/^\s*--.*$/gm, '').split(';').filter(value=>value.trim())) await query(sql.replaceAll('{{SCHEMA_NAME}}',schema));
        const redis = { get: async (key: string) => key === `tenant:${tenantId}:schema` ? schema : 'ready', set: async () => undefined };
        orders = new OrdersService(prisma, redis as any);
        inventory = new InventoryService(prisma, redis as any);
        payments = new TenantPaymentStoreService(prisma); await payments.ensureForTenant(tenantId);
    });
    beforeEach(async () => {
        await query('TRUNCATE order_items,orders,stock_movements,products,contacts,conversations,customer_memory_erasure,tenant_payment_intents,tenant_payment_attempts CASCADE');
        await query("INSERT INTO contacts(id,external_id,channel_type,name) VALUES($1::uuid,'eval-alex','web_widget','Alex'),($2::uuid,'eval-other','web_widget','Other')", [contactId, otherId]);
        await query('INSERT INTO conversations(id,contact_id) VALUES($1::uuid,$2::uuid)', [conversationId, contactId]);
        await query("INSERT INTO products(id,name,price,currency,stock,is_available) VALUES($1::uuid,'Real product',12.35,'COP',10,true)", [productId]);
    });
    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_catalog_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            // Se borra el esquema propio y la fila propia, nunca la tabla ni la
            // extensión: son andamiaje COMPARTIDO por todas las suites
            // PostgreSQL de la misma base desechable. Soltarlas mataba a la
            // suite que estuviera usándolas en el otro worker.
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',tenantId,schema);
        } finally { await client.$disconnect(); }
    });
    it('does not invent stock when cancelling an untracked product', async () => {
        await query('UPDATE products SET stock=NULL');
        const order = await orders.createOrder(tenantId, input());
        await orders.updateOrderStatus(tenantId, order.id, 'cancelled', 'tenant_supervisor');
        expect(await query('SELECT stock FROM products')).toEqual([{ stock: null }]);
        expect(await query('SELECT id FROM stock_movements')).toEqual([]);
    });
    it('replays concurrent requests exactly once at the domain boundary', async () => {
        const data = input({ idempotencyKey: randomUUID() });
        const results = await Promise.all([orders.createOrder(tenantId, data), orders.createOrder(tenantId, data)]);
        expect(new Set(results.map(row => row.id)).size).toBe(1);
        expect(await query('SELECT stock FROM products')).toEqual([{ stock: 8 }]);
    });
    it('does not publish orders for an erased customer', async () => {
        await query('INSERT INTO customer_memory_erasure(contact_id) VALUES($1::uuid)', [contactId]);
        await expect(orders.createOrder(tenantId, input())).rejects.toThrow(/erased/i);
        expect(await query('SELECT id FROM orders')).toEqual([]);
    });
    it('rejects attaching an order to a different customer conversation', async () => {
        await query('UPDATE conversations SET contact_id=$1::uuid', [otherId]);
        await expect(orders.createOrder(tenantId, input({ conversationId }))).rejects.toThrow(/conversation/i);
        expect(await query('SELECT id FROM orders')).toEqual([]);
    });
    it('rolls back an adjustment when its audit movement cannot be recorded', async () => {
        await query("CREATE FUNCTION reject_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_audit_failure'; END $$");
        await query('CREATE TRIGGER movement_failure BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION reject_movement()');
        try {
            await expect(inventory.adjustStock(tenantId, productId, { type: 'in', quantity: 3, reason: 'Synthetic delivery' })).rejects.toThrow();
            expect(await query('SELECT stock FROM products')).toEqual([{ stock: 10 }]);
        } finally { await query('DROP TRIGGER movement_failure ON stock_movements'); await query('DROP FUNCTION reject_movement()'); }
    });
    const quoted = async (extra: any = {}) => {
        const data=input({idempotencyKey:randomUUID(),...extra});
        const terms=await orders.catalogCommands().quote(schema,data);
        return {data,terms,options:{source:'agent' as const,expectedTermsHash:catalogHash(terms)}};
    };
    it('binds exact decimal prices and quantities to consent and returns only committed totals',async()=>{
        const {data,terms,options}=await quoted();
        expect(terms.totalAmountCents).toBe('2470');
        await query('UPDATE products SET price=13.65');
        await expect(orders.catalogCommands().create(schema,data,options)).rejects.toThrow('catalog_terms_changed');
        expect(await query('SELECT id FROM orders')).toEqual([]);
        const renewed=await orders.catalogCommands().quote(schema,data);
        const row=await orders.catalogCommands().create(schema,data,{...options,expectedTermsHash:catalogHash(renewed)});
        expect(row).toMatchObject({totalAmount:27.3,totalAmountCents:'2730',status:'pending',paymentStatus:'pending'});
        expect(String((await query('SELECT total_amount FROM orders'))[0].total_amount)).toBe('27.3');
    });
    it('rechecks prescription restrictions inside the locked writer',async()=>{
        const {data,options}=await quoted(); await query('UPDATE products SET requires_prescription=true');
        await expect(orders.catalogCommands().create(schema,data,options)).rejects.toThrow('catalog_prescription_review_required');
        expect(await query('SELECT id FROM orders')).toEqual([]);
    });
    it('never truncates a fractional quantity or accepts a reused request with changed items',async()=>{
        await expect(orders.createOrder(tenantId,input({items:[{productId,quantity:1.9}]}))).rejects.toThrow('catalog_items_invalid');
        const data=input({idempotencyKey:randomUUID()}); await orders.createOrder(tenantId,data);
        await expect(orders.createOrder(tenantId,{...data,items:[{productId,quantity:1}]})).rejects.toThrow('catalog_request_changed');
        expect(await query('SELECT stock FROM products')).toEqual([{stock:8}]);
    });
    it('allows only one buyer to consume the last two units',async()=>{
        await query('UPDATE products SET stock=2');
        const results=await Promise.allSettled(Array.from({length:6},()=>orders.createOrder(tenantId,input({idempotencyKey:randomUUID()}))));
        expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1);
        expect(await query('SELECT stock FROM products')).toEqual([{stock:0}]);
        expect(await query('SELECT COUNT(*)::int AS count FROM orders')).toEqual([{count:1}]);
    });
    it('restores exactly the original tracked units once under repeated concurrent cancellations',async()=>{
        const row=await orders.createOrder(tenantId,input()),commands=orders.catalogCommands();
        const terms=await commands.cancellationTerms(schema,row.id,contactId);
        const options={source:'agent' as const,expectedVersion:terms.orderVersion,expectedTermsHash:catalogHash(terms)};
        const results=await Promise.all([commands.cancel(schema,row.id,contactId,options),commands.cancel(schema,row.id,contactId,options)]);
        expect(results.filter(row=>row.idempotentReplay)).toHaveLength(1);
        expect(await query('SELECT stock FROM products')).toEqual([{stock:10}]);
        expect(await query("SELECT COUNT(*)::int AS count FROM stock_movements WHERE type='in'")).toEqual([{count:1}]);
    });
    it('does not compensate an untracked sale after the operator starts tracking inventory',async()=>{
        await query('UPDATE products SET stock=NULL'); const row=await orders.createOrder(tenantId,input());
        await inventory.adjustStock(tenantId,productId,{type:'adjustment',quantity:20,reason:'Initial physical count'});
        await orders.updateOrderStatus(tenantId,row.id,'cancelled','tenant_admin');
        expect(await query('SELECT stock FROM products')).toEqual([{stock:20}]);
    });
    it('requires stock reconciliation when legacy evidence or the deducted product is missing',async()=>{
        const row=await orders.createOrder(tenantId,input()); await query('UPDATE order_items SET stock_deducted=NULL');
        await expect(orders.updateOrderStatus(tenantId,row.id,'cancelled','tenant_admin')).rejects.toThrow('catalog_stock_reconciliation_required');
        expect(await query('SELECT stock FROM products')).toEqual([{stock:8}]);
        expect(await query('SELECT status FROM orders')).toEqual([{status:'pending'}]);
    });
    it('records explicit historical evidence with actor, source and version before compensating once',async()=>{
        const row=await orders.createOrder(tenantId,input()); await query('UPDATE order_items SET stock_deducted=NULL');
        const line=(await query('SELECT id FROM order_items WHERE order_id=$1::uuid',[row.id]))[0],actorId=randomUUID();
        const evidence={expectedVersion:1,source:'Synthetic warehouse log line 15',reason:'Manager compared the original stock movement',lines:[{lineId:line.id,stockDeducted:2}]};
        await expect(orders.recordStockEvidence(tenantId,row.id,evidence,{id:actorId,role:'tenant_agent'})).rejects.toThrow('catalog_stock_review_role_required');
        const result=await orders.recordStockEvidence(tenantId,row.id,evidence,{id:actorId,role:'tenant_supervisor'});
        expect(result.version).toBe(2);expect(await query('SELECT stock FROM products')).toEqual([{stock:8}]);
        expect(await query('SELECT COUNT(*)::int AS count FROM stock_movements')).toEqual([{count:1}]);
        expect((await query('SELECT metadata FROM orders'))[0].metadata.catalogStockEvidence).toMatchObject({actorId,source:evidence.source,reviewedVersion:1,reviewedAt:expect.any(String)});
        expect(await orders.recordStockEvidence(tenantId,row.id,evidence,{id:actorId,role:'tenant_supervisor'})).toMatchObject({version:2,idempotentReplay:true});
        await expect(orders.recordStockEvidence(tenantId,row.id,{...evidence,lines:[{lineId:line.id,stockDeducted:0}]},{id:actorId,role:'tenant_supervisor'})).rejects.toThrow('catalog_version_changed');
        await orders.updateOrderStatus(tenantId,row.id,'cancelled','tenant_supervisor',2);
        await orders.updateOrderStatus(tenantId,row.id,'cancelled','tenant_supervisor',2);
        expect(await query('SELECT stock FROM products')).toEqual([{stock:10}]);
    });
    it('keeps an explicitly reviewed zero distinct from unknown legacy stock',async()=>{
        await query('UPDATE products SET stock=NULL');const row=await orders.createOrder(tenantId,input());
        await query('UPDATE order_items SET stock_deducted=NULL');const line=(await query('SELECT id FROM order_items'))[0];
        await orders.recordStockEvidence(tenantId,row.id,{expectedVersion:1,source:'Synthetic original receipt',reason:'No stock was tracked',lines:[{lineId:line.id,stockDeducted:0}]},{id:randomUUID(),role:'tenant_admin'});
        await orders.updateOrderStatus(tenantId,row.id,'cancelled','tenant_admin',2);
        expect(await query('SELECT stock FROM products')).toEqual([{stock:null}]);expect(await query('SELECT id FROM stock_movements')).toEqual([]);
    });
    it('restores every reviewed legacy line when one product appears twice',async()=>{
        const row=await orders.createOrder(tenantId,input());
        const extraId=randomUUID();
        await query('UPDATE products SET stock=stock-1 WHERE id=$1::uuid',[productId]);
        await query("INSERT INTO order_items(id,order_id,product_id,product_name,quantity,unit_price,total_price,stock_deducted) VALUES($1::uuid,$2::uuid,$3::uuid,'Legacy duplicate line',1,12.35,12.35,NULL)",[extraId,row.id,productId]);
        await query('UPDATE order_items SET stock_deducted=NULL WHERE order_id=$1::uuid',[row.id]);
        const lines=await query('SELECT id,quantity FROM order_items WHERE order_id=$1::uuid',[row.id]);
        await orders.recordStockEvidence(tenantId,row.id,{expectedVersion:1,source:'Synthetic original line receipts',reason:'Both recorded lines originally deducted stock',lines:lines.map((line:any)=>({lineId:line.id,stockDeducted:line.quantity}))},{id:randomUUID(),role:'tenant_supervisor'});
        expect(await query('SELECT stock FROM products')).toEqual([{stock:7}]);
        await orders.updateOrderStatus(tenantId,row.id,'cancelled','tenant_supervisor',2);
        expect(await query('SELECT stock FROM products')).toEqual([{stock:10}]);
        expect(await query("SELECT SUM(quantity)::int AS quantity FROM stock_movements WHERE type='in'")).toEqual([{quantity:3}]);
    });
    it('recovers create and cancellation after a movement failure without partial inventory or duplicate rows',async()=>{
        await query("CREATE FUNCTION reject_catalog_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic movement unavailable'; END $$");
        const fail=()=>query('CREATE TRIGGER reject_catalog_movement BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION reject_catalog_movement()');
        const recover=()=>query('DROP TRIGGER reject_catalog_movement ON stock_movements');
        const request=input({idempotencyKey:randomUUID()});
        try{
            await fail();await expect(orders.createOrder(tenantId,request)).rejects.toThrow('synthetic movement unavailable');
            expect(await query('SELECT id FROM orders')).toEqual([]);expect(await query('SELECT stock FROM products')).toEqual([{stock:10}]);
            await recover();const row=await orders.createOrder(tenantId,request);
            const terms=await orders.catalogCommands().cancellationTerms(schema,row.id,contactId);
            const options={source:'agent' as const,expectedVersion:terms.orderVersion,expectedTermsHash:catalogHash(terms)};
            await fail();await expect(orders.catalogCommands().cancel(schema,row.id,contactId,options)).rejects.toThrow('synthetic movement unavailable');
            expect(await query('SELECT status FROM orders')).toEqual([{status:'pending'}]);expect(await query('SELECT stock FROM products')).toEqual([{stock:8}]);
            await recover();await orders.catalogCommands().cancel(schema,row.id,contactId,options);await orders.catalogCommands().cancel(schema,row.id,contactId,options);
            expect(await query('SELECT stock FROM products')).toEqual([{stock:10}]);expect(await query("SELECT COUNT(*)::int AS count FROM stock_movements WHERE type='in'")).toEqual([{count:1}]);
        }finally{
            await query('DROP TRIGGER IF EXISTS reject_catalog_movement ON stock_movements');await query('DROP FUNCTION reject_catalog_movement()');
        }
    });
    it('keeps own order reads scoped and denies cancellation of another customer order',async()=>{
        const row=await orders.createOrder(tenantId,input());
        expect(await orders.catalogCommands().listOwned(schema,otherId)).toEqual([]);
        await expect(orders.catalogCommands().getOwned(schema,row.id,otherId)).rejects.toThrow('catalog_order_not_found');
        await expect(orders.catalogCommands().cancellationTerms(schema,row.id,otherId)).rejects.toThrow('catalog_order_not_found');
    });
    it('keeps an operator commercial paid status separate from provider settlement',async()=>{
        const row=await orders.createOrder(tenantId,input({status:'paid'}));
        expect(row).toMatchObject({status:'paid',paymentStatus:'pending'});
        await expect(orders.catalogCommands().cancellationTerms(schema,row.id,contactId)).rejects.toThrow('catalog_cancellation_review_required');
    });
    it('charges the total the customer agreed to, and refuses a row that agreed to none',async()=>{
        const target=PAYMENT_REFERENCE_TARGETS.order;
        const payable=async(id:string)=>(await query(
            `SELECT ${target.amountExpression} AS amount, ${target.currencyExpression} AS currency
               FROM orders target WHERE target.id=$1::uuid`,[id]))[0];

        // Positive: the till reads the snapshot the writer stored, not the live
        // column beside it. Two units at 12,35 each.
        const row=await orders.createOrder(tenantId,input());
        const stored=(await query('SELECT catalog_terms FROM orders WHERE id=$1::uuid',[row.id]))[0].catalog_terms;
        expect(stored.totalAmountCents).toBe('2470');
        expect(await payable(row.id)).toEqual({amount:expect.anything(),currency:'COP'});
        expect(Number((await payable(row.id)).amount)).toBe(24.70);

        // Negative, and the point of the change: the live column moves and the
        // charge does not follow it. Nobody agreed to the new number.
        await query('UPDATE orders SET total_amount=999999 WHERE id=$1::uuid',[row.id]);
        expect(Number((await payable(row.id)).amount)).toBe(24.70);

        // Negative: a row with no accepted terms — a legacy order, or one
        // inserted around the writer — is not payable at all. Charging it at
        // whatever `total_amount` says would be charging a number the customer
        // never saw, and refusing is the direction to err in.
        const legacy=randomUUID();
        await query(`INSERT INTO orders(id,contact_id,status,total_amount,currency,version)
            VALUES($1::uuid,$2::uuid,'pending',50,'COP',1)`,[legacy,contactId]);
        expect(await payable(legacy)).toEqual({amount:null,currency:null});

        // And a cancellation snapshot is not a sale: charging from one would be
        // taking the amount quoted for undoing the order.
        const cancelled=randomUUID();
        await query(`INSERT INTO orders(id,contact_id,status,total_amount,currency,version,catalog_terms)
            VALUES($1::uuid,$2::uuid,'pending',50,'COP',1,$3::jsonb)`,
        [cancelled,contactId,JSON.stringify({version:1,action:'cancel',orderId:cancelled,orderVersion:1,
            status:'pending',paymentStatus:'pending',currency:'COP',totalAmountCents:'5000'})]);
        expect(await payable(cancelled)).toEqual({amount:null,currency:null});

        // How many live rows that refusal would bite, as a number rather than a
        // worry: the two just inserted.
        expect((await query(ordersWithoutAgreedTermsSql()))[0]).toEqual({orphans:2});
        await query('DELETE FROM orders WHERE id=ANY($1::uuid[])',[[legacy,cancelled,row.id]]);
    });
    it('serializes concurrent stock adjustments without losing audit movements',async()=>{
        await Promise.all(Array.from({length:8},()=>inventory.adjustStock(tenantId,productId,{type:'in',quantity:1,reason:'Synthetic intake'})));
        expect(await query('SELECT stock FROM products')).toEqual([{stock:18}]);
        expect(await query('SELECT COUNT(*)::int AS count FROM stock_movements')).toEqual([{count:8}]);
        await expect(inventory.adjustStock(tenantId,productId,{type:'out',quantity:30,reason:'Too many'})).rejects.toThrow('inventory_stock_insufficient');
        expect(await query('SELECT stock FROM products')).toEqual([{stock:18}]);
    });
    it('lets either payment reservation or cancellation win, never both',async()=>{
        for(let attempt=0;attempt<4;attempt++) {
            const row=await orders.createOrder(tenantId,input({items:[{productId,quantity:1}]}));
            const terms=await orders.catalogCommands().cancellationTerms(schema,row.id,contactId);
            const results=await Promise.allSettled([
                payments.createOrGetIntent({tenantId,provider:'wompi',idempotencyKey:randomUUID(),canonicalReference:`order:${row.id}`,contactId,amountCents:1235,currency:'COP',description:'Synthetic order',resourceSnapshot:{}}),
                orders.catalogCommands().cancel(schema,row.id,contactId,{source:'agent',expectedVersion:terms.orderVersion,expectedTermsHash:catalogHash(terms)}),
            ]);
            expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1);
            const actual=await query('SELECT status,(SELECT COUNT(*)::int FROM tenant_payment_intents WHERE canonical_reference=$2) AS intents FROM orders WHERE id=$1::uuid',[row.id,`order:${row.id}`]);
            expect(actual[0].status==='cancelled'?actual[0].intents===0:actual[0].intents===1).toBe(true);
        }
    });
    it.each([
        ['es','Quiero comprar dos unidades','Sí, confirmo','No','¿Cuál es el precio?','Quiero cancelar ese pedido'],
        ['en','I want to buy two units','Yes, I confirm','No','What is the price?','I want to cancel that order'],
        ['pt','Quero comprar duas unidades','Sim, confirmo','Não','Qual é o preço?','Quero cancelar esse pedido'],
        ['fr','Je veux acheter deux unités','Oui, je confirme','Non','Quel est le prix ?','Je veux annuler cette commande'],
    ])('runs the real isolated catalog and consent cycle with positive and negative cases in %s',async(_lang,open,yes,no,question,cancel)=>{
        const namespaces=isolatedEvalNamespaceForPrisma(prisma),lease=await namespaces.provision(tenantId,schema,
            ['contacts','conversations','messages','contact_identities','leads','opportunities','products','orders','order_items','stock_movements','customer_memory_erasure','agent_personas']);
        const sql=(text:string,params:any[]=[])=>prisma.executeInTenantSchema<any[]>(lease.schemaName,text,params),cid=randomUUID();
        try{
            await sql("INSERT INTO contacts(id,external_id,channel_type,name) VALUES($1::uuid,'eval-buyer','web_widget','Alex')",[EVAL_SANDBOX_CONTACT_ID]);
            await sql('INSERT INTO conversations(id,contact_id) VALUES($1::uuid,$2::uuid)',[cid,EVAL_SANDBOX_CONTACT_ID]);
            await sql("INSERT INTO products(id,name,price,currency,stock,is_available) VALUES($1::uuid,'[EVAL] Sandbox Product',10,'COP',100,true)",[productId]);
            await prepareCatalogEvalFixtures((text,params)=>sql(text,params),lease.schemaName,productId);
            const control=new ToolExecutionControlService(prisma,{get:()=> 'catalog-test-signing-secret-at-least-32-bytes'} as any,
                {isVerified:async()=>true,startVerification:()=>{throw new Error('provider_forbidden');}} as any,{get:async()=>null} as any);
            const stub=()=>({}) as any;
            const executor=new AIToolExecutorService(prisma,stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),control,stub(),stub());
            (executor as any).ordersService=orders;
            for(const logger of [(executor as any).logger,(control as any).logger])for(const level of ['log','warn','error'])jest.spyOn(logger,level).mockImplementation(()=>undefined);
            const inbound=(text:string)=>sql("INSERT INTO messages(conversation_id,direction,content_text) VALUES($1::uuid,'inbound',$2)",[cid,text]);
            const call=(tool:string,args:any,override:any={})=>executor.execute(lease.schemaName,tenantId,EVAL_SANDBOX_CONTACT_ID,tool,args,cid,
                {authority:authorityFor(tool),evalMode:true,sandboxNamespace:lease,executionContext:{mode:'evaluation',persistence:'disabled',operationalUsageAccounting:'disabled'},...override} as any) as Promise<any>;
            const args={items:[{productId,quantity:2}],notes:'[EVAL] new order'};
            await inbound(open);
            expect(await call('place_catalog_order',args,{sandboxNamespace:undefined})).toMatchObject({error:expect.any(String)});
            expect(await call('place_catalog_order',args,{authority:undefined})).toMatchObject({error:expect.any(String)});
            expect(await call('place_catalog_order',args)).toMatchObject({error:'confirmation_required',catalogTerms:{totalAmountCents:'2000'}});
            await inbound(question);expect(await call('place_catalog_order',args)).toMatchObject({error:'confirmation_required'});
            await sql('UPDATE products SET price=12 WHERE id=$1::uuid',[productId]);
            await inbound(yes);expect(await call('place_catalog_order',args)).toMatchObject({error:'confirmation_required',catalogTerms:{totalAmountCents:'2400'}});
            expect(await sql("SELECT id FROM orders WHERE notes='[EVAL] new order'")).toEqual([]);
            await inbound(yes);const placed=await call('place_catalog_order',args);
            expect(placed).toMatchObject({success:true,order:{total:24,paymentStatus:'pending',status:'pending'}});
            expect(await call('place_catalog_order',args)).toMatchObject({success:true,order:{id:placed.order.id}});
            expect(await sql("SELECT COUNT(*)::int AS count FROM orders WHERE notes='[EVAL] new order'")).toEqual([{count:1}]);
            expect(await call('get_catalog_order',{orderId:placed.order.id})).toMatchObject({success:true,order:{id:placed.order.id,totalAmount:24}});
            expect((await call('list_my_catalog_orders',{})).orders.some((row:any)=>row.id===placed.order.id)).toBe(true);
            expect(await call('get_catalog_order',{orderId:CATALOG_EVAL_IDS.otherCatalogOrder})).toMatchObject({error:'catalog_order_not_found'});
            await inbound(cancel);expect(await call('cancel_catalog_order',{orderId:placed.order.id})).toMatchObject({error:'confirmation_required'});
            await inbound(no);expect(await call('cancel_catalog_order',{orderId:placed.order.id})).toMatchObject({error:'action_rejected'});
            expect((await sql('SELECT status FROM orders WHERE id=$1::uuid',[placed.order.id]))[0].status).toBe('pending');
            await inbound(cancel);expect(await call('cancel_catalog_order',{orderId:placed.order.id})).toMatchObject({error:'confirmation_required'});
            await inbound(yes);expect(await call('cancel_catalog_order',{orderId:placed.order.id})).toMatchObject({success:true,order:{status:'cancelled'},refundPerformed:false});
            expect(await call('cancel_catalog_order',{orderId:placed.order.id})).toMatchObject({success:true,order:{status:'cancelled'}});
            expect(await sql('SELECT stock FROM products WHERE id=$1::uuid',[productId])).toEqual([{stock:100}]);
            await inbound(cancel);expect(await call('cancel_catalog_order',{orderId:CATALOG_EVAL_IDS.paidCatalogOrder})).toMatchObject({error:'catalog_cancellation_review_required'});
            await inbound(open);expect(await call('place_catalog_order',{items:[{productId:CATALOG_EVAL_IDS.prescriptionProduct,quantity:1}]})).toMatchObject({error:'catalog_prescription_review_required'});
            expect(await query('SELECT id FROM orders')).toEqual([]);
        }finally{await namespaces.dispose(lease);}
        const remaining:any[]=await client.$queryRawUnsafe('SELECT to_regclass($1)::text AS name',`${lease.schemaName}.orders`);
        expect(remaining).toEqual([{name:null}]);
    },30000);
});
