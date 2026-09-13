import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';
import { CatalogOrderCommands } from './catalog-order-commands';
import { catalogHash } from './catalog-order-contract';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { ensureOperationalNoticeOutbox } from '../operational-notices/operational-notice-outbox';
import { OperationalNoticeService } from '../operational-notices/operational-notice.service';

const databaseUrl=process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl?describe:describe.skip)('durable catalog-order confirmations on PostgreSQL',()=>{
    jest.setTimeout(180_000);
    const schema=`tenant_orderconfirm_${randomUUID().replace(/-/g,'')}`,tenantId=randomUUID(),productId=randomUUID();
    const accountOn='15550001111',accountOff='15559990000';
    const contactOn=randomUUID(),contactOff=randomUUID(),threadOn=randomUUID(),threadOff=randomUUID();
    let client:PrismaClient,prisma:any,orders:OrdersService;
    const redis:any={get:async(key:string)=>key===`tenant:${tenantId}:schema`?schema:'ready',set:async()=>undefined};
    const query=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(schema,sql,params);
    const items=[{productId,quantity:2}];

    async function saveAgent(account:string,emailConfirmations:boolean) {
        await query(`INSERT INTO agent_personas(id,name,config_json,version,channels,channel_bindings,schedule_mode,is_active,is_default)
            VALUES(gen_random_uuid(),$1,$2::jsonb,1,ARRAY['whatsapp'],ARRAY[$3],'24_7',true,false)`,[
            `Agent ${account}`,JSON.stringify({persona:{name:`Agent ${account}`},tools:{catalog:{enabled:true},orders:{enabled:true,emailConfirmations}}}),
            `whatsapp:${account}`]);
    }
    async function place(contactId:string,conversationId:string) {
        const commands=orders.catalogCommands(),data={contactId,conversationId,items,idempotencyKey:randomUUID()};
        const terms=await commands.quote(schema,data);
        return commands.create(schema,data,{source:'agent',expectedTermsHash:catalogHash(terms)});
    }
    const notices=()=>query('SELECT * FROM operational_notice_outbox ORDER BY created_at,id');
    async function hydrate(row:any) {
        const runtime:any={prisma:{tenant:{findUnique:async()=>({language:'es'})}},widget:{}};
        return (OperationalNoticeService.prototype as any).hydrate.call(runtime,query,schema,tenantId,row);
    }

    beforeAll(async()=>{
        const parsed=new URL(databaseUrl!);
        if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||!parsed.pathname.endsWith('_eval_isolation'))throw new Error('disposable_loopback_database_required');
        client=new PrismaClient({datasourceUrl:databaseUrl});
        await ensureSyntheticGlobalTables(sql=>client.$executeRawUnsafe(sql));
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name,is_active,language) VALUES($1::uuid,$2,true,$3)',tenantId,schema,'es');
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma=Object.create(PrismaService.prototype);
        prisma.$transaction=client.$transaction.bind(client);prisma.$queryRaw=client.$queryRaw.bind(client);prisma.$queryRawUnsafe=client.$queryRawUnsafe.bind(client);
        prisma.getTenantSchemaName=async()=>schema;
        prisma.tenant={findUnique:async()=>({id:tenantId,schemaName:schema,isActive:true,language:'es'}),findMany:async()=>[{id:tenantId,schemaName:schema}]};
        for(const sql of [
            'CREATE TABLE contacts(id UUID PRIMARY KEY,external_id TEXT NOT NULL,channel_type TEXT NOT NULL,name TEXT,phone TEXT,email TEXT)',
            `CREATE TABLE conversations(id UUID PRIMARY KEY,contact_id UUID REFERENCES contacts(id),channel_type TEXT,channel_account_id TEXT,status TEXT DEFAULT 'active')`,
            `CREATE TABLE agent_personas(id UUID PRIMARY KEY,name TEXT,config_json JSONB NOT NULL,version INT NOT NULL,channels TEXT[] DEFAULT '{}',channel_bindings TEXT[] DEFAULT '{}',schedule_mode TEXT,is_active BOOLEAN DEFAULT true,is_default BOOLEAN DEFAULT false,updated_at TIMESTAMPTZ DEFAULT NOW())`,
            'CREATE TABLE persona_config(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),config_json JSONB,is_active BOOLEAN DEFAULT true,version INT DEFAULT 1)',
            'CREATE TABLE contact_identities(contact_id UUID,customer_profile_id UUID)',
            'CREATE TABLE leads(id UUID PRIMARY KEY,contact_id UUID)',
            'CREATE TABLE opportunities(id UUID PRIMARY KEY,lead_id UUID,conversation_id UUID,won_at TIMESTAMPTZ,lost_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW())',
            'CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY,erased_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
        ]) await query(sql);
        const ddl=readFileSync(resolve(__dirname,'../../../prisma/tenant-schema.sql'),'utf8');
        for(const table of ['products','stock_movements','orders','order_items']) {
            const start=ddl.indexOf(`CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."${table}" (`);
            await query(ddl.slice(start,ddl.indexOf('\n);',start)+3).replaceAll('{{SCHEMA_NAME}}',schema).replaceAll('uuid_generate_v4()','gen_random_uuid()'));
        }
        await query('ALTER TABLE products ADD COLUMN IF NOT EXISTS requires_prescription BOOLEAN NOT NULL DEFAULT false');
        const integrity=ddl.split('-- BEGIN CATALOG ORDER INTEGRITY')[1]?.split('-- END CATALOG ORDER INTEGRITY')[0];
        for(const sql of String(integrity).replace(/^\s*--.*$/gm,'').split(';').filter(value=>value.trim()))await query(sql.replaceAll('{{SCHEMA_NAME}}',schema));
        await ensureOperationalNoticeOutbox(prisma,schema);
        orders=new OrdersService(prisma,redis);
    });
    afterAll(async()=>{
        if(!client)return;
        try{
            if(!/^tenant_orderconfirm_[a-f0-9]{32}$/.test(schema))throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid',tenantId);
        }finally{await client.$disconnect();}
    });
    beforeEach(async()=>{
        await query('TRUNCATE operational_notice_outbox,order_items,orders,stock_movements,products,conversations,contacts,agent_personas,opportunities,leads,contact_identities,customer_memory_erasure CASCADE');
        await query(`INSERT INTO contacts(id,external_id,channel_type,name,email) VALUES
            ($1::uuid,'on','whatsapp','Ana','ana@example.com'),($2::uuid,'off','whatsapp','Beto','beto@example.com')`,[contactOn,contactOff]);
        await query(`INSERT INTO conversations(id,contact_id,channel_type,channel_account_id) VALUES
            ($1::uuid,$2::uuid,'whatsapp',$3),($4::uuid,$5::uuid,'whatsapp',$6)`,[threadOn,contactOn,accountOn,threadOff,contactOff,accountOff]);
        await query("INSERT INTO products(id,name,price,currency,stock,is_available) VALUES($1::uuid,'Real <product>',12.35,'COP',100,true)",[productId]);
        await saveAgent(accountOn,true);await saveAgent(accountOff,false);
    });

    it('does not announce an order before the business accepts it',async()=>{
        expect((await place(contactOn,threadOn)).status).toBe('pending');
        expect(await notices()).toHaveLength(0);
    });
    it('commits one intent on confirmation and rehydrates the frozen receipt',async()=>{
        const order=await place(contactOn,threadOn);
        await orders.updateOrderStatus(tenantId,order.id,'confirmed','tenant_admin');
        const [notice]=await notices();
        expect(notice).toMatchObject({kind:'order.confirmed',entity_id:order.id,contact_id:contactOn,conversation_id:threadOn,state:'pending'});
        const prepared=await hydrate(notice);
        expect(prepared).toMatchObject({route:'email',email:'ana@example.com',emailTemplate:{slug:'order_confirmation',language:'es'}});
        expect(prepared.emailTemplate.variables.order_total).toContain('24,70');
        expect(prepared.emailTemplate.variables.order_items_html).toContain('Real &lt;product&gt;');
        await orders.updateOrderStatus(tenantId,order.id,'confirmed','tenant_admin');
        await orders.updateOrderStatus(tenantId,order.id,'paid','tenant_admin');
        expect(await notices()).toHaveLength(1);
    });
    it('records the intent but delivery honors the serving agent switch',async()=>{
        const order=await place(contactOff,threadOff);
        await orders.updateOrderStatus(tenantId,order.id,'confirmed','tenant_admin');
        await expect(hydrate((await notices())[0])).rejects.toMatchObject({code:'notice_confirmation_switched_off'});
    });
    it('creates an already-confirmed dashboard order and its intent together',async()=>{
        const order=await orders.createOrder(tenantId,{contactId:contactOn,items,status:'confirmed'} as any);
        expect(order.status).toBe('confirmed');expect(await notices()).toHaveLength(1);
    });
    it('rolls the status back if its durable intent cannot be stored',async()=>{
        const order=await place(contactOn,threadOn);
        const faulty={...prisma,transactionInTenantSchema:(s:string,work:any)=>prisma.transactionInTenantSchema(s,(run:any)=>work((sql:string,p:any[])=>{
            if(sql.startsWith('INSERT INTO operational_notice_outbox'))throw new Error('notice_storage_failed');return run(sql,p);
        }))};
        await expect(new CatalogOrderCommands(faulty).advance(schema,order.id,'confirmed')).rejects.toThrow('notice_storage_failed');
        expect(await query('SELECT status FROM orders WHERE id=$1::uuid',[order.id])).toEqual([{status:'pending'}]);
        expect(await notices()).toHaveLength(0);
    });
    it('suppresses a stale intent after the order is cancelled',async()=>{
        const order=await orders.createOrder(tenantId,{contactId:contactOn,items,status:'confirmed'} as any);
        await query("UPDATE orders SET status='cancelled' WHERE id=$1::uuid",[order.id]);
        await expect(hydrate((await notices())[0])).rejects.toMatchObject({code:'notice_domain_state_changed'});
    });
});
