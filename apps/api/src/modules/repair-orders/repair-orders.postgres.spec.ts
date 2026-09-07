import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RepairOrdersService } from './repair-orders.service';
import { ToolExecutionControlService } from '../conversations/tool-execution-control.service';
import { AIToolExecutorService } from '../conversations/ai-tool-executor.service';
import { authorityFor } from '../conversations/__fixtures__/tool-authority.fixture';
import { EVAL_SANDBOX_CONTACT_ID } from '../conversations/agent-test-tool-policy';
import { isolatedEvalNamespaceForPrisma } from '../simulation/isolated-eval-namespace';
import { prepareRepairEvalFixtures, REPAIR_EVAL_IDS } from './repair-order-eval-fixtures';
import { repairRequestHash } from './repair-order-terms';

const databaseUrl = process.env.REPAIR_ORDERS_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

/** Real Prisma transactions and the production workshop DDL; no external services. */
integration('Canonical workshop commands on PostgreSQL', () => {
    const schema = `tenant_repair_${randomUUID().replace(/-/g, '')}`;
    const contactId = randomUUID(), otherContactId = randomUUID(), actorId = randomUUID();
    const conversationId = randomUUID(), appointmentId = randomUUID();
    const tenantId = randomUUID();
    let client: PrismaClient, prisma: PrismaService, service: RepairOrdersService;
    let createdTenants = false, createdUuid = false;
    const execute = (sql: string, params: any[] = []) => prisma.executeInTenantSchema<any[]>(schema, sql, params);
    const intake = (overrides: any = {}) => ({ contactId, vehicle: { make: 'Mazda', model: '3', licensePlate: 'EVAL123' },
        customerConcern: 'Vibra al frenar', idempotencyKey: randomUUID(), ...overrides });
    const create = (input = intake()) => service.create(schema, input, { type: 'agent' });
    const estimate = (id: string, expectedVersion = 1, amountCents = 12000) => service.updateEstimate(schema, id,
        { expectedVersion, amountCents, currency: 'COP', notes: 'Revisión de frenos' }, actorId);

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        const globalTables: any[] = await client.$queryRawUnsafe("SELECT to_regclass('public.tenants')::text AS tenants,(SELECT COUNT(*)::int FROM pg_extension WHERE extname='uuid-ossp') AS uuid");
        if (!globalTables[0].tenants) { await client.$executeRawUnsafe('CREATE TABLE public.tenants(id UUID PRIMARY KEY,schema_name TEXT)'); createdTenants = true; }
        if (!globalTables[0].uuid) { await client.$executeRawUnsafe('CREATE EXTENSION "uuid-ossp" WITH SCHEMA public'); createdUuid = true; }
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)', tenantId, schema);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
        prisma.getTenantSchemaName = async id => { if (id !== tenantId) throw new Error('test_scope_violation'); return schema; };
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        for (const sql of [
            'CREATE TABLE contacts(id UUID PRIMARY KEY,external_id TEXT NOT NULL,channel_type TEXT NOT NULL,name TEXT,phone TEXT)',
            'CREATE TABLE staff_members(id UUID PRIMARY KEY,name TEXT,is_active BOOLEAN DEFAULT true)',
            'CREATE TABLE conversations(id UUID PRIMARY KEY,contact_id UUID REFERENCES contacts(id))',
            'CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id UUID REFERENCES conversations(id),direction TEXT,content_text TEXT,created_at TIMESTAMPTZ DEFAULT NOW())',
            'CREATE TABLE appointments(id UUID PRIMARY KEY,contact_id UUID REFERENCES contacts(id),status TEXT)',
            'CREATE TABLE contact_identities(contact_id UUID,customer_profile_id UUID)',
            'CREATE TABLE leads(id UUID PRIMARY KEY,contact_id UUID)',
            'CREATE TABLE opportunities(id UUID PRIMARY KEY,lead_id UUID,conversation_id UUID,won_at TIMESTAMPTZ,lost_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW())',
            'CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY,erased_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
            'CREATE TABLE agent_personas(id UUID PRIMARY KEY,version INT,is_active BOOLEAN,config_json JSONB)',
        ]) await execute(sql);
        await execute('CREATE FUNCTION uuid_generate_v4() RETURNS UUID LANGUAGE SQL AS $$ SELECT pg_catalog.gen_random_uuid() $$');
        const ddl = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        const start = ddl.indexOf('CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."customer_vehicles"');
        const end = ddl.indexOf('ON "{{SCHEMA_NAME}}"."repair_order_events" ("repair_order_id", "created_at" DESC);', start);
        if (start < 0 || end < 0) throw new Error('production_workshop_ddl_missing');
        const section = ddl.slice(start, ddl.indexOf(';', end) + 1).replaceAll('{{SCHEMA_NAME}}', schema);
        for (const sql of section.split(';').filter(value => value.trim())) await client.$executeRawUnsafe(sql);
        service = new RepairOrdersService(prisma);
    });
    beforeEach(async () => {
        await execute('TRUNCATE repair_order_events,repair_orders,customer_vehicles,contacts,staff_members,conversations,appointments,customer_memory_erasure CASCADE');
        await execute("INSERT INTO contacts(id,external_id,channel_type,name) VALUES($1::uuid,'eval-alex','web_widget','Alex'),($2::uuid,'eval-other','web_widget','Other')", [contactId, otherContactId]);
        await execute('INSERT INTO conversations(id,contact_id) VALUES($1::uuid,$2::uuid)', [conversationId, contactId]);
        await execute("INSERT INTO appointments(id,contact_id,status) VALUES($1::uuid,$2::uuid,'confirmed')", [appointmentId, contactId]);
    });
    afterAll(async () => {
        if (client) {
            if (!/^tenant_repair_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            try { await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
                await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2', tenantId, schema);
                if (createdTenants) await client.$executeRawUnsafe('DROP TABLE public.tenants');
                if (createdUuid) await client.$executeRawUnsafe('DROP EXTENSION "uuid-ossp"');
            } finally { await client.$disconnect(); }
        }
    });

    it('creates one intake, vehicle and event under concurrent identical retries', async () => {
        const input = intake();
        const results = await Promise.all(Array.from({ length: 6 }, () => create(input)));
        expect(new Set(results.map(row => row.id)).size).toBe(1);
        expect(results.filter(row => !row.idempotentReplay)).toHaveLength(1);
        expect(await execute('SELECT (SELECT COUNT(*)::int FROM customer_vehicles) AS vehicles,(SELECT COUNT(*)::int FROM repair_orders) AS orders,(SELECT COUNT(*)::int FROM repair_order_events) AS events'))
            .toEqual([{ vehicles: 1, orders: 1, events: 1 }]);
    });
    it('rejects a reused request key with changed intake instead of returning false success', async () => {
        const input = intake(); await create(input);
        await expect(create({ ...input, customerConcern: 'Ahora pierde aceite' })).rejects.toThrow(/idempotency/i);
        expect((await execute('SELECT customer_concern FROM repair_orders'))[0].customer_concern).toBe(input.customerConcern);
    });
    it('allows a genuinely new intake for the same vehicle while serializing vehicle reuse', async () => {
        const results = await Promise.all([create(),create()]);
        expect(new Set(results.map(row=>row.id)).size).toBe(2);
        expect(new Set(results.map(row=>row.vehicle_id)).size).toBe(1);
    });
    it('records one approval event for simultaneous identical decisions and rejects the opposite decision', async () => {
        const order=await create(); await estimate(order.id);
        const terms=await service.getActionTerms(schema,order.id,contactId,'estimate_decision');
        const options={expectedVersion:terms.orderVersion,expectedTermsHash:repairRequestHash(terms)};
        const approve=()=>service.decideEstimate(schema,order.id,contactId,true,'agent',null,undefined,options);
        const results=await Promise.all([approve(),approve(),approve()]);
        expect(results.filter(row=>!row.idempotentReplay)).toHaveLength(1);
        await expect(service.decideEstimate(schema,order.id,contactId,false,'agent',null,undefined,options)).rejects.toThrow();
        expect(await execute("SELECT COUNT(*)::int AS count FROM repair_order_events WHERE event_type='estimate_approved'")).toEqual([{count:1}]);
    });
    it('never lets cancellation and starting work both succeed against the same version', async () => {
        const order=await create(intake({appointmentId})); await estimate(order.id);
        const quote=await service.getActionTerms(schema,order.id,contactId,'estimate_decision');
        await service.decideEstimate(schema,order.id,contactId,true,'agent',null,undefined,{expectedVersion:quote.orderVersion,expectedTermsHash:repairRequestHash(quote)});
        const terms=await service.getActionTerms(schema,order.id,contactId,'cancel');
        const results=await Promise.allSettled([
            service.cancelOwned(schema,order.id,contactId,'Changed plans',{expectedVersion:terms.orderVersion,expectedTermsHash:repairRequestHash(terms)}),
            service.transition(schema,order.id,{expectedVersion:terms.orderVersion,status:'in_progress'},actorId),
        ]);
        expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
        expect(['cancelled','in_progress']).toContain((await service.get(schema,order.id,contactId)).status);
        expect((await execute('SELECT status FROM appointments'))[0].status).toBe('confirmed');
    });
    it('preserves full technician lifecycle and evidence without treating delivery as payment', async () => {
        const order=await create(); const published=await estimate(order.id);
        let row=await service.decideEstimate(schema,order.id,null,true,'tenant_user',actorId,'Customer explicitly approved the reviewed quote',{expectedVersion:published.version});
        row=await service.transition(schema,order.id,{status:'in_progress',expectedVersion:row.version},actorId);
        row=await service.updateOperationalDetails(schema,order.id,{expectedVersion:row.version,diagnosisSummary:'Technician inspected brakes',finalAmountCents:12000},actorId);
        row=await service.transition(schema,order.id,{status:'ready',expectedVersion:row.version},actorId);
        row=await service.transition(schema,order.id,{status:'delivered',expectedVersion:row.version},actorId);
        expect(row).toMatchObject({status:'delivered',final_amount_cents:BigInt(12000)});
        await expect(service.transition(schema,order.id,{status:'in_progress',expectedVersion:row.version},actorId)).rejects.toThrow();
        const events=await execute('SELECT actor_id,payload FROM repair_order_events WHERE event_type=$1',['estimate_approved']);
        expect(events[0]).toMatchObject({actor_id:actorId,payload:{evidence:'Customer explicitly approved the reviewed quote',terms:{estimateAmountCents:'12000'}}});
    });
    it('allows the workshop to withdraw a stale promised date instead of retaining it through COALESCE', async () => {
        const order=await create();
        const first=await service.updateOperationalDetails(schema,order.id,{expectedVersion:1,promisedAt:'2026-10-01T12:00:00Z',diagnosisSummary:'Provisional inspection'},actorId);
        const second=await service.updateOperationalDetails(schema,order.id,{expectedVersion:first.version,promisedAt:null,diagnosisSummary:null},actorId);
        expect(second).toMatchObject({promised_at:null,diagnosis_summary:null});
    });
    it('rejects an appointment or conversation belonging to another contact', async () => {
        await execute('UPDATE appointments SET contact_id=$1::uuid', [otherContactId]);
        await expect(create(intake({ appointmentId }))).rejects.toThrow(/appointment/i);
        await execute('UPDATE conversations SET contact_id=$1::uuid', [otherContactId]);
        await expect(create(intake({ conversationId }))).rejects.toThrow(/conversation/i);
        expect(await execute('SELECT id FROM repair_orders')).toEqual([]);
        expect(await execute('SELECT id FROM customer_vehicles')).toEqual([]);
    });
    it('does not attach intake to a cancelled appointment or claim booking capacity', async () => {
        await execute("UPDATE appointments SET status='cancelled'");
        await expect(create(intake({ appointmentId }))).rejects.toThrow(/appointment/i);
        const row = await create();
        expect(row).toMatchObject({ status: 'intake', promised_at: null, assigned_technician_id: null, appointment_id: null });
    });
    it('blocks an obsolete estimate decision after the workshop publishes a new amount', async () => {
        const order = await create(); const quoted = await estimate(order.id);
        await estimate(order.id, quoted.version, 24000);
        await expect((service.decideEstimate as any)(schema, order.id, contactId, true, 'agent', null, undefined,
            { expectedVersion: quoted.version })).rejects.toThrow(/terms|version/i);
        expect((await service.get(schema, order.id, contactId)).approval_status).toBe('pending');
    });
    it('does not write for an erased contact', async () => {
        await execute('INSERT INTO customer_memory_erasure(contact_id) VALUES($1::uuid)', [contactId]);
        await expect(create()).rejects.toThrow(/erased/i);
        expect(await execute('SELECT id FROM customer_vehicles')).toEqual([]);
    });
    it('waits for an in-flight erasure transaction and cannot publish after its tombstone', async () => {
        let locked!:()=>void, release!:()=>void;
        const entered=new Promise<void>(resolve=>{locked=resolve;}), resume=new Promise<void>(resolve=>{release=resolve;});
        const erasing=prisma.transactionInTenantSchema(schema,async query=>{
            await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',[`agent-privacy:${schema}`]);
            locked(); await resume;
            await query('INSERT INTO customer_memory_erasure(contact_id) VALUES($1::uuid)',[contactId]);
        });
        await entered;
        const writing=create().then(value=>({value,error:null}),error=>({error}));
        let waiting=0;
        try {
            for(let attempt=0;attempt<100&&!waiting;attempt++) {
                const rows:any[]=await client.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted
                    AND objid=(hashtextextended($1,0)&4294967295)::oid
                    AND classid=((hashtextextended($1,0)>>32)&4294967295)::oid`, `agent-privacy:${schema}`);
                waiting=rows[0].count;
            }
            expect(waiting).toBeGreaterThan(0);
        } finally { release(); await erasing; }
        expect((await writing).error?.message).toBe('contact_erased');
        expect(await execute('SELECT id FROM repair_orders')).toEqual([]);
    });
    it('blocks customer-scoped reads and existing-order updates after erasure', async () => {
        const order=await create();
        await execute('INSERT INTO customer_memory_erasure(contact_id) VALUES($1::uuid)',[contactId]);
        await expect(service.get(schema,order.id,contactId)).rejects.toThrow('contact_erased');
        await expect(service.list(schema,{contactId})).rejects.toThrow('contact_erased');
        await expect(service.updateOperationalDetails(schema,order.id,{expectedVersion:1,diagnosisSummary:'No publication'},actorId)).rejects.toThrow('contact_erased');
        expect((await execute('SELECT diagnosis_summary FROM repair_orders'))[0].diagnosis_summary).toBeNull();
    });
    it('rejects a conflicting VIN and plate instead of overwriting another identity', async () => {
        await create(intake({ vehicle: { make: 'Mazda', model: '3', vin: 'VIN-A', licensePlate: 'AAA123' } }));
        await expect(create(intake({ vehicle: { make: 'Mazda', model: '3', vin: 'VIN-B', licensePlate: 'AAA123' } }))).rejects.toThrow(/identity/i);
        expect((await execute('SELECT vin FROM customer_vehicles'))[0].vin).toBe('VIN-A');
    });
    it('rolls back the vehicle and order if the immutable event insert fails, then recovers on retry', async () => {
        await execute("CREATE FUNCTION reject_repair_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_event_failure'; END $$");
        await execute('CREATE TRIGGER fail_repair_event BEFORE INSERT ON repair_order_events FOR EACH ROW EXECUTE FUNCTION reject_repair_event()');
        const input = intake();
        try { await expect(create(input)).rejects.toThrow('synthetic_event_failure'); } finally {
            await execute('DROP TRIGGER fail_repair_event ON repair_order_events'); await execute('DROP FUNCTION reject_repair_event()');
        }
        expect(await execute('SELECT id FROM customer_vehicles')).toEqual([]);
        expect(await execute('SELECT id FROM repair_orders')).toEqual([]);
        expect((await create(input)).status).toBe('intake');
    });
    it('runs the real consent ledger through Prisma without serializing unsupported lock results', async () => {
        const control = new ToolExecutionControlService(prisma, { get: () => 'repair-test-signing-secret-at-least-32-bytes' } as any,
            { isVerified: async () => true } as any, { get: async () => null } as any);
        await execute("INSERT INTO messages(conversation_id,direction,content_text) VALUES($1::uuid,'inbound','Quiero abrir la orden')", [conversationId]);
        const request = { schemaName: schema, tenantId, contactId, conversationId, toolName: 'create_repair_order', args: intake() };
        await expect(control.preflight(request)).resolves.toMatchObject({ allowed: false, result: { error: 'confirmation_required' } });
        await execute("INSERT INTO messages(conversation_id,direction,content_text) VALUES($1::uuid,'inbound','Sí, confirmo')", [conversationId]);
        await expect(control.preflight(request)).resolves.toMatchObject({ allowed: true });
    });

    it.each([
        ['es', 'Quiero registrar mi Mazda 3, placa NEW123, vibra al frenar', 'Sí, confirmo', 'No', '¿Cuánto cuesta?', 'Quiero aprobar el presupuesto', 'Quiero rechazar el presupuesto', 'Quiero cancelar esa orden'],
        ['en', 'Register my Mazda 3, plate NEW123, it vibrates when braking', 'Yes, I confirm', 'No', 'How much does it cost?', 'I want to approve the estimate', 'I want to reject the estimate', 'I want to cancel that order'],
        ['pt', 'Quero registrar meu Mazda 3, placa NEW123, vibra ao frear', 'Sim, confirmo', 'Não', 'Quanto custa?', 'Quero aprovar o orçamento', 'Quero rejeitar o orçamento', 'Quero cancelar essa ordem'],
        ['fr', 'Enregistrez ma Mazda 3, plaque NEW123, elle vibre au freinage', 'Oui, je confirme', 'Non', 'Combien cela coûte-t-il ?', 'Je veux approuver le devis', 'Je veux refuser le devis', 'Je veux annuler cet ordre'],
    ])('executes the canonical owned sandbox cycle with real consent and negative cases in %s', async (_language, opening, yes, no, question, approve, reject, cancel) => {
        const namespaces = isolatedEvalNamespaceForPrisma(prisma);
        const lease = await namespaces.provision(tenantId, schema, ['contacts','conversations','messages','appointments','contact_identities','leads','opportunities',
            'staff_members','customer_vehicles','repair_orders','repair_order_events','customer_memory_erasure','agent_personas']);
        const sql = (query: string, params: any[] = []) => prisma.executeInTenantSchema<any[]>(lease.schemaName, query, params);
        const convo = randomUUID();
        try {
            await sql("INSERT INTO contacts(id,external_id,channel_type,name) VALUES($1::uuid,'eval-alex','web_widget','Alex')", [EVAL_SANDBOX_CONTACT_ID]);
            await sql('INSERT INTO conversations(id,contact_id) VALUES($1::uuid,$2::uuid)', [convo,EVAL_SANDBOX_CONTACT_ID]);
            await prepareRepairEvalFixtures((query,params) => sql(query,params),lease.schemaName);
            const control = new ToolExecutionControlService(prisma, { get: () => 'repair-test-signing-secret-at-least-32-bytes' } as any,
                { isVerified: async () => true, startVerification: () => { throw new Error('provider_must_not_run'); } } as any, { get: async () => null } as any);
            const stub = () => ({}) as any;
            const executor = new AIToolExecutorService(prisma,stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),
                stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),stub(),control,{ preparePaymentLink: jest.fn() } as any,stub());
            for(const logger of [(executor as any).logger,(control as any).logger]) for(const level of ['log','warn','error']) jest.spyOn(logger,level).mockImplementation(()=>undefined);
            (executor as any).repairOrders = service;
            const inbound = async (text: string) => sql("INSERT INTO messages(conversation_id,direction,content_text) VALUES($1::uuid,'inbound',$2)",[convo,text]);
            const call = (tool: string, args: any, override: any = {}) => executor.execute(lease.schemaName,tenantId,EVAL_SANDBOX_CONTACT_ID,tool,args,convo,
                { authority: authorityFor(tool),evalMode:true,sandboxNamespace:lease,executionContext:{mode:'evaluation',persistence:'disabled',operationalUsageAccounting:'disabled'},...override } as any) as Promise<any>;
            const state = async (id: string) => (await sql('SELECT status,approval_status,estimate_amount_cents,version FROM repair_orders WHERE id=$1::uuid',[id]))[0];
            const args = {make:'Mazda',model:'3',licensePlate:'NEW123',customerConcern:opening};
            await inbound(opening);
            expect(await call('create_repair_order',args,{sandboxNamespace:undefined})).toMatchObject({error:expect.any(String)});
            expect(await call('create_repair_order',args,{authority:undefined})).toMatchObject({error:expect.any(String)});
            expect(await call('create_repair_order',args)).toMatchObject({error:'confirmation_required'});
            await inbound(question); expect(await call('create_repair_order',args)).toMatchObject({error:'confirmation_required'});
            expect(await sql('SELECT id FROM repair_orders WHERE external_id IS NULL')).toEqual([]);
            await inbound(yes); const created = await call('create_repair_order',args);
            expect(created).toMatchObject({success:true,status:'intake'});
            expect(await call('create_repair_order',args)).toMatchObject({success:true,repairOrderId:created.repairOrderId});
            expect(await sql('SELECT COUNT(*)::int AS count FROM repair_orders WHERE external_id IS NULL')).toEqual([{count:1}]);
            const existing = {repairOrderId:REPAIR_EVAL_IDS.repairOrder,accepted:true};
            await inbound(approve);
            expect(await call('approve_repair',existing)).toMatchObject({error:'confirmation_required',repairTerms:{estimateAmountCents:'12000'}});
            await inbound(no); expect(await call('approve_repair',existing)).toMatchObject({error:'action_rejected'});
            expect(await state(existing.repairOrderId)).toMatchObject({approval_status:'pending'});
            await inbound(approve); expect(await call('approve_repair',existing)).toMatchObject({error:'confirmation_required'});
            await service.updateEstimate(lease.schemaName,existing.repairOrderId,{expectedVersion:2,amountCents:24000,currency:'COP'},actorId);
            await inbound(yes);
            expect(await call('approve_repair',existing)).toMatchObject({error:'confirmation_required',repairTerms:{estimateAmountCents:'24000'}});
            expect(await state(existing.repairOrderId)).toMatchObject({approval_status:'pending'});
            await inbound(yes); expect(await call('approve_repair',existing)).toMatchObject({success:true,status:'approved',estimateAmountCents:24000});
            expect(await call('approve_repair',existing)).toMatchObject({success:true,status:'approved'});
            const own = await service.get(lease.schemaName,existing.repairOrderId,EVAL_SANDBOX_CONTACT_ID);
            await service.transition(lease.schemaName,existing.repairOrderId,{expectedVersion:own.version,status:'in_progress'},actorId);
            await inbound(cancel); expect(await call('cancel_repair_order',{repairOrderId:existing.repairOrderId})).toMatchObject({error:expect.any(String)});
            await inbound(yes); expect(await call('cancel_repair_order',{repairOrderId:existing.repairOrderId})).toMatchObject({error:expect.any(String)});
            expect(await state(existing.repairOrderId)).toMatchObject({status:'in_progress'});
            await inbound(approve); expect(await call('approve_repair',{repairOrderId:REPAIR_EVAL_IDS.otherRepairOrder,accepted:true})).toMatchObject({error:expect.any(String)});
            expect(await state(REPAIR_EVAL_IDS.otherRepairOrder)).toMatchObject({approval_status:'pending'});
            // A rejection is a separate proposed action, followed by explicit
            // confirmation; saying no to approval can never become approval.
            await service.updateEstimate(lease.schemaName,created.repairOrderId,{expectedVersion:1,amountCents:1000,currency:'COP'},actorId);
            await inbound(reject); expect(await call('approve_repair',{repairOrderId:created.repairOrderId,accepted:false})).toMatchObject({error:'confirmation_required'});
            await inbound(yes); expect(await call('approve_repair',{repairOrderId:created.repairOrderId,accepted:false})).toMatchObject({success:true,status:'rejected'});
            await inbound(cancel); expect(await call('cancel_repair_order',{repairOrderId:created.repairOrderId})).toMatchObject({error:'confirmation_required'});
            await inbound(yes); expect(await call('cancel_repair_order',{repairOrderId:created.repairOrderId})).toMatchObject({success:true,status:'cancelled'});
            expect(await call('cancel_repair_order',{repairOrderId:created.repairOrderId})).toMatchObject({success:true,status:'cancelled'});
            expect(await sql("SELECT COUNT(*)::int AS count FROM repair_order_events WHERE repair_order_id=$1::uuid AND event_type='cancelled_by_customer'",[created.repairOrderId])).toEqual([{count:1}]);
            expect(await execute('SELECT id FROM repair_orders')).toEqual([]);
        } finally { await namespaces.dispose(lease); }
        const remaining: any[] = await client.$queryRawUnsafe('SELECT to_regclass($1)::text AS name',`"${lease.schemaName}".repair_orders`);
        expect(remaining).toEqual([{name:null}]);
    },30_000);
});
