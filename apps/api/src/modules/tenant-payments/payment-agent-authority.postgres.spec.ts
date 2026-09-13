import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentOperationService } from '../conversations/payment-operation.service';
import { TenantPaymentStoreService } from './tenant-payment-store.service';
import { TenantPaymentsService } from './tenant-payments.service';
import { TenantMercadoPagoOperationProvider } from './tenant-mercadopago-operation.provider';
import { WompiProviderError } from './tenant-wompi.client';
import { operationalConfigurationHash } from '../persona/agent-configuration-revision';
import { ServedAgentAuthorityError, type ServedAgentAuthority } from '../persona/served-agent-authority';

const url=process.env.PARALLLY_ISOLATION_TEST_URL;
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return {promise,resolve};};
(url?describe:describe.skip)('agent payment admission on real PostgreSQL and Prisma',()=>{
    const schema=`tenant_payment_authority_${randomUUID().replace(/-/g,'')}`;
    const tenantId=randomUUID(),agentId=randomUUID(),contactId=randomUUID(),orderId=randomUUID();
    let client:PrismaClient,prisma:PrismaService,store:TenantPaymentStoreService,payments:TenantPaymentsService,provider:TenantMercadoPagoOperationProvider,operations:PaymentOperationService;
    let scope:ServedAgentAuthority,rail:'wompi'|'mercadopago',wompi:any;
    let afterQuery:((sql:string,query:any)=>Promise<void>)|undefined;
    let loseAdmissionCommitAck=false;
    let originalFetch:typeof fetch;
    const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema<any[]>(schema,sql,params);
    const reference=`order:${orderId}`;
    const reserveInput=(key=randomUUID())=>({tenantId,provider:rail,idempotencyKey:key,canonicalReference:reference,contactId,amountCents:10000,currency:'COP',description:'Synthetic payable',resourceSnapshot:{providerConfigRevision:1},expiresAt:new Date(Date.now()+3600000)});
    const liveScope=async():Promise<ServedAgentAuthority>=>{const [row]=await q('SELECT * FROM agent_personas WHERE id=$1::uuid',[agentId]);return {kind:'agent',tenantId,schemaName:schema,agentId,version:Number(row.version),operationalHash:operationalConfigurationHash(row)};};
    const change=async(kind='version')=>prisma.transactionInTenantSchema(schema,async query=>{
        await query('SET LOCAL lock_timeout=\'1500ms\'');
        await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text',[`agent-privacy:${schema}`]);
        await query('SELECT id FROM public.tenants WHERE id=$1::uuid FOR UPDATE',[tenantId]);
        await query(`UPDATE agent_personas SET ${kind==='inactive'?'is_active=false,version=version+1':kind==='hash'?"config_json='{\"name\":\"changed\"}'::jsonb":'version=version+1'} WHERE id=$1::uuid`,[agentId]);
    });
    const create=async(key=randomUUID())=>payments.createPaymentLink({tenantId,contactId,canonicalReference:reference,idempotencyKey:key},{operationalScope:scope});
    const full=async()=>{
        const ledgerId=randomUUID();await q('INSERT INTO tool_execution_ledger(id) VALUES($1::uuid)',[ledgerId]);
        const prepared=await operations.preparePaymentLink(tenantId,contactId,{payableReference:reference});
        if(!prepared.ok)throw new Error('fixture_payable_required');
        return {ledgerId,run:()=>operations.createPaymentLink(schema,tenantId,contactId,ledgerId,prepared.payable,scope)};
    };
    beforeAll(async()=>{
        const parsed=new URL(url!);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||!parsed.pathname.endsWith('_eval_isolation'))throw new Error('disposable_loopback_database_required');
        client=new PrismaClient({datasourceUrl:url});prisma=Object.create(PrismaService.prototype);
        prisma.$transaction=client.$transaction.bind(client);
        prisma.getTenantSchemaName=async(id:string)=>{if(id!==tenantId)throw new Error('fixture_tenant_mismatch');return schema;};
        const native=PrismaService.prototype.transactionInTenantSchema.bind(prisma);
        prisma.transactionInTenantSchema=(async(name:string,work:any,options:any)=>{
            let admissionWritten=false;
            const result=await native(name,query=>work(async(sql:string,params:any[]=[])=>{
                const rows=await query(sql,params);
                if(sql.includes("jsonb_set(resource_snapshot,'{dispatchAdmission}'"))admissionWritten=true;
                await afterQuery?.(sql,query);return rows;
            }),options);
            // Lose only the acknowledgement: the real Prisma transaction already committed.
            if(admissionWritten&&loseAdmissionCommitAck){loseAdmissionCommitAck=false;throw new Error('synthetic_commit_ack_lost');}
            return result;
        }) as any;
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',tenantId,schema);
        await q('CREATE TABLE agent_personas(id UUID PRIMARY KEY,name TEXT,config_json JSONB,channels TEXT[],channel_bindings TEXT[],schedule_mode TEXT,is_active BOOLEAN,is_default BOOLEAN,version INT,updated_at TIMESTAMPTZ)');
        await q('CREATE TABLE orders(id UUID PRIMARY KEY,contact_id UUID,status TEXT,payment_status TEXT,total_amount NUMERIC,currency TEXT,catalog_terms JSONB,updated_at TIMESTAMPTZ)');
        await q('CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY)');
        await q('CREATE TABLE tool_execution_ledger(id UUID PRIMARY KEY)');
        store=new TenantPaymentStoreService(prisma);await store.ensureForTenant(tenantId);
        originalFetch=global.fetch;
    },30000);
    beforeEach(async()=>{
        afterQuery=undefined;loseAdmissionCommitAck=false;rail='wompi';
        await q('TRUNCATE tenant_payment_attempts,tenant_payment_intents,orders,agent_personas,tool_execution_ledger CASCADE');
        await q("INSERT INTO agent_personas VALUES($1::uuid,'Agent','{}','{}','{}','always',true,false,1,NOW())",[agentId]);
        // The order carries the terms the customer accepted, because the charge
        // reads those and not the live column. A fixture without them is a row
        // nobody agreed to, and the resolver is right to refuse it.
        await q("INSERT INTO orders VALUES($1::uuid,$2::uuid,'pending','pending',100,'COP',$3::jsonb,NOW())",
            [orderId,contactId,JSON.stringify({version:1,action:'create',currency:'COP',totalAmountCents:'10000',items:[],notes:''})]);
        scope=await liveScope();
        wompi={createAndVerifyPaymentLink:jest.fn(async(input:any)=>({id:'provider-'+input.intentId,url:'https://example.test/checkout',expiresAt:input.expiresAt})),
            getAndValidatePaymentLink:jest.fn(async(input:any)=>({url:'https://example.test/checkout',active:true,expiresAt:input.expectedExpiresAt}))};
        payments=new TenantPaymentsService(prisma,{releaseLockToken:async()=>true,set:async()=>undefined} as any,{} as any,store,wompi);
        Object.assign(payments,{
            assertCustomerPaymentsEntitled:async()=>undefined,
            getConfig:async()=>({activeProvider:rail,ready:true,providers:{[rail]:{configRevision:1}}}),
            readStoredConfig:async()=>({activeProvider:rail}),
            getWompiCredentials:async()=>({publicKey:'synthetic-public',privateKey:'synthetic-private',environment:'sandbox'}),
            getMercadoPagoAccessToken:async()=>'synthetic-token',getWebhookSecret:async()=>'synthetic-secret',
            apiPublicBase:()=>'https://example.test',
            acquireProviderMutationLock:async()=>randomUUID(),
        });
        provider=new TenantMercadoPagoOperationProvider(payments);
        operations=new PaymentOperationService(prisma,provider,{isFeatureEnabled:async()=>true} as any);
        global.fetch=jest.fn(async(_url:any,options:any)=>new Response(JSON.stringify(options?.method==='POST'
            ?{id:'mp-synthetic',init_point:'https://example.test/checkout'}:{id:'mp-synthetic',init_point:'https://example.test/checkout'}),{status:200})) as any;
    });
    afterEach(()=>{afterQuery=undefined;global.fetch=originalFetch;});
    afterAll(async()=>{
        if(!client)return;
        try{
            if(!/^tenant_payment_authority_[a-f\d]{32}$/.test(schema))throw new Error('unsafe_cleanup');
            const tables=await client.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname=$1`,schema) as any[];
            if(tables.length)await client.$executeRawUnsafe('DROP TABLE '+tables.map(row=>`"${schema}"."${row.tablename}"`).join(',')+' RESTRICT');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" RESTRICT`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',tenantId,schema);
        }finally{await client.$disconnect();}
    });

    it.each(['wompi','mercadopago'] as const)('carries exact private provenance through the real %s pipeline',async selected=>{
        rail=selected;const command=await full();const result=await command.run();
        expect(result).toMatchObject({linkCreated:true,paymentStatus:'pending',paid:false});
        const [operation]=await q('SELECT * FROM payment_operation_ledger WHERE execution_ledger_id=$1::uuid',[command.ledgerId]);
        const [intent]=await q('SELECT * FROM tenant_payment_intents');
        expect(operation.request_payload.operationalAuthority).toEqual(scope);
        expect(intent.resource_snapshot.operationalAuthority).toEqual(scope);
        expect(intent.resource_snapshot.dispatchAdmission).toMatchObject({version:1,operationalAuthority:scope,admissionId:expect.any(String),admittedAt:expect.any(String)});
        expect(intent.idempotency_key).toBe(operation.id);
        expect(JSON.stringify(selected==='wompi'?wompi.createAndVerifyPaymentLink.mock.calls:(global.fetch as jest.Mock).mock.calls)).not.toContain('operationalHash');
    });
    it.each(['version','inactive','hash'])('refuses a reservation after %s changes without inserting an intent',async kind=>{
        await change(kind);await expect(store.createOrGetIntent(reserveInput(),scope)).rejects.toBeInstanceOf(ServedAgentAuthorityError);
        expect(await q('SELECT id FROM tenant_payment_intents')).toHaveLength(0);
    });
    it('replays the same money operation when trusted JSONB hydration changes only provenance key order',async()=>{
        const command=await full();expect(await command.run()).toMatchObject({linkCreated:true});
        scope=Object.fromEntries(Object.entries(scope).reverse()) as ServedAgentAuthority;
        expect(await command.run()).toMatchObject({linkCreated:true});
        expect(await q('SELECT id FROM payment_operation_ledger')).toHaveLength(1);
        expect(wompi.createAndVerifyPaymentLink).toHaveBeenCalledTimes(1);
    });
    it('revalidates markProcessing after the first money intent was recorded',async()=>{
        const command=await full(),resolve=provider.resolveOwnership.bind(provider);
        jest.spyOn(provider,'resolveOwnership').mockImplementation(async input=>{const owned=await resolve(input);await change();return owned;});
        expect(await command.run()).toMatchObject({error:'agent_operational_revision_changed',requiresNewConfirmation:true});
        expect(wompi.createAndVerifyPaymentLink).not.toHaveBeenCalled();
        expect((await q('SELECT status FROM payment_operation_ledger'))[0].status).toBe('failed');
        expect(await q('SELECT id FROM tenant_payment_intents')).toHaveLength(0);
    });
    it.each(['wompi','mercadopago'] as const)('rejects %s after preparation when publication wins the final admission',async selected=>{
        rail=selected;
        const method=selected==='wompi'?'getWompiCredentials':'getMercadoPagoAccessToken';
        const original=(payments as any)[method].bind(payments);
        (payments as any)[method]=async(...args:any[])=>{const value=await original(...args);await change('inactive');return value;};
        await expect(create()).rejects.toBeInstanceOf(ServedAgentAuthorityError);
        expect(wompi.createAndVerifyPaymentLink).not.toHaveBeenCalled();expect(global.fetch).not.toHaveBeenCalled();
        expect((await q('SELECT status,resource_snapshot FROM tenant_payment_intents'))[0]).toMatchObject({status:'failed',resource_snapshot:{dispatchAdmission:null}});
    });
    it('keeps publication waiting until the admission transaction commits, without a network lock',async()=>{
        const {intent}=await store.createOrGetIntent(reserveInput(),scope);
        const entered=deferred(),release=deferred();let ownerPid=0;
        afterQuery=async(sql,query)=>{if(sql.includes("jsonb_set(resource_snapshot,'{dispatchAdmission}'")){
            afterQuery=undefined;ownerPid=(await query('SELECT pg_backend_pid() AS pid'))[0].pid;entered.resolve();await release.promise;
        }};
        const admission=store.admitAgentCreation(tenantId,intent.id,scope);await entered.promise;
        let changed=false;const publish=change().then(()=>{changed=true;});
        try{
            let queued=false;for(let i=0;i<100&&!queued;i++){
                queued=(await client.$queryRawUnsafe('SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE $1::int=ANY(pg_blocking_pids(a.pid))) AS waiting',ownerPid) as any[])[0].waiting;
                if(!queued)await new Promise(done=>setTimeout(done,5));
            }
            expect(queued).toBe(true);expect(changed).toBe(false);
        }finally{release.resolve();}
        const token=await admission;await publish;
        expect((await store.findByIdempotencyKey(tenantId,intent.idempotencyKey))?.resourceSnapshot.dispatchAdmission).toMatchObject({admissionId:token,operationalAuthority:scope});
    });
    it('allows an admitted provider receipt and settlement after deactivation, and never creates again',async()=>{
        wompi.createAndVerifyPaymentLink.mockImplementation(async(input:any)=>{await change('inactive');return {id:'accepted',url:'https://example.test/checkout',expiresAt:input.expiresAt};});
        const command=await full();expect(await command.run()).toMatchObject({linkCreated:true,paymentStatus:'pending'});
        const [intent]=await q('SELECT * FROM tenant_payment_intents');
        expect((await payments.reconcilePaymentLinkCreation(tenantId,'accepted')).status).toBe('confirmed');
        const settled=await store.settleWompiTransaction({tenantId,eventKey:'a'.repeat(64),source:'webhook',transaction:{id:'tx-accepted',status:'APPROVED',amountCents:10000,currency:'COP',paymentLinkId:'accepted',environment:'sandbox'}});
        expect(settled.status).toBe('paid');
        expect((await q('SELECT payment_status FROM orders'))[0].payment_status).toBe('paid');
        expect((await store.findByIdempotencyKey(tenantId,intent.idempotency_key))?.resourceSnapshot.operationalAuthority).toEqual(scope);
        expect(wompi.createAndVerifyPaymentLink).toHaveBeenCalledTimes(1);
    });
    it('grants one token to exactly one concurrent admission caller',async()=>{
        const {intent}=await store.createOrGetIntent(reserveInput(),scope);
        const outcomes=await Promise.allSettled([store.admitAgentCreation(tenantId,intent.id,scope),store.admitAgentCreation(tenantId,intent.id,scope)]);
        expect(outcomes.filter(result=>result.status==='fulfilled')).toHaveLength(1);
        expect(outcomes.filter(result=>result.status==='rejected')).toHaveLength(1);
    });
    it('keeps an admission with no provider ACK explicit and never recreates it on restart',async()=>{
        const input=reserveInput(),{intent}=await store.createOrGetIntent(input,scope);
        const token=await store.admitAgentCreation(tenantId,intent.id,scope);
        await expect(create(input.idempotencyKey)).rejects.toMatchObject({response:{error:'payment_link_reconciliation_required'}});
        const stored=await store.findByIdempotencyKey(tenantId,input.idempotencyKey);
        expect(stored?.lastError).toBe('payment_dispatch_admitted_awaiting_receipt');
        expect(stored?.resourceSnapshot.dispatchAdmission).toMatchObject({admissionId:token});
        expect(wompi.createAndVerifyPaymentLink).not.toHaveBeenCalled();
    });
    it.each(['wompi','mercadopago'] as const)('retains an uncertain %s admission COMMIT and never converts a missing ACK into permission to POST',async selected=>{
        rail=selected;const command=await full();loseAdmissionCommitAck=true;
        expect(await command.run()).toMatchObject({error:'payment_reconciliation_required'});
        const [intent]=await q('SELECT * FROM tenant_payment_intents');
        expect(intent.status).toBe('ambiguous');
        expect(intent.resource_snapshot.dispatchAdmission).toMatchObject({admissionId:expect.any(String),operationalAuthority:scope});
        expect(await command.run()).toMatchObject({error:'payment_reconciliation_required'});
        await expect(create(intent.idempotency_key)).rejects.toMatchObject({response:{error:'payment_link_reconciliation_required'}});
        expect((await q('SELECT resource_snapshot FROM tenant_payment_intents'))[0].resource_snapshot.dispatchAdmission).toEqual(intent.resource_snapshot.dispatchAdmission);
        expect(wompi.createAndVerifyPaymentLink).not.toHaveBeenCalled();expect(global.fetch).not.toHaveBeenCalled();
    });
    it('does not let a new revision or an unscoped caller adopt a reserved agent intent',async()=>{
        const input=reserveInput();await store.createOrGetIntent(input,scope);
        await expect(store.createOrGetIntent(input)).rejects.toBeInstanceOf(ServedAgentAuthorityError);
        await change();await expect(store.createOrGetIntent(input,await liveScope())).rejects.toBeInstanceOf(ServedAgentAuthorityError);
        expect(await q('SELECT id FROM tenant_payment_intents')).toHaveLength(1);
    });
    it.each(['wompi','mercadopago'] as const)('never repeats %s after an unknown provider response',async selected=>{
        rail=selected;const key=randomUUID();
        if(selected==='wompi')wompi.createAndVerifyPaymentLink.mockRejectedValue(new WompiProviderError('timeout',true));
        else global.fetch=jest.fn(async()=>({ok:true,json:async()=>{throw new Error('truncated JSON');}})) as any;
        await expect(create(key)).rejects.toThrow();await expect(create(key)).rejects.toMatchObject({response:{error:'payment_link_reconciliation_required'}});
        expect((await q('SELECT status FROM tenant_payment_intents'))[0].status).toBe('ambiguous');
        expect(selected==='wompi'?wompi.createAndVerifyPaymentLink:global.fetch).toHaveBeenCalledTimes(1);
    });
    it('only re-admits a proven no-effect failure with the same current authority',async()=>{
        const key=randomUUID();wompi.createAndVerifyPaymentLink.mockRejectedValueOnce(new WompiProviderError('known_rejected',false));
        await expect(create(key)).rejects.toThrow();const [first]=await q('SELECT * FROM tenant_payment_intents');
        expect(first.status).toBe('failed');await create(key);
        const [second]=await q('SELECT * FROM tenant_payment_intents');
        expect(second.id).toBe(first.id);expect(second.resource_snapshot.dispatchAdmission.admissionId).not.toBe(first.resource_snapshot.dispatchAdmission.admissionId);
        expect(wompi.createAndVerifyPaymentLink).toHaveBeenCalledTimes(2);
    });
    it('preserves human creation without accepting authority hidden in input or resource snapshots',async()=>{
        const input=reserveInput();input.resourceSnapshot={operationalAuthority:scope,dispatchAdmission:{admissionId:'forged'}} as any;
        const {intent}=await store.createOrGetIntent(input);expect(intent.resourceSnapshot.operationalAuthority).toBeUndefined();
        expect(intent.resourceSnapshot.dispatchAdmission).toBeUndefined();
        await q('DELETE FROM tenant_payment_intents');
        await payments.createPaymentLink({tenantId,contactId,canonicalReference:reference,idempotencyKey:randomUUID(),operationalScope:scope} as any);
        expect(wompi.createAndVerifyPaymentLink).toHaveBeenCalledTimes(1);
        expect((await q('SELECT resource_snapshot FROM tenant_payment_intents'))[0].resource_snapshot.operationalAuthority).toBeUndefined();
    });
});
