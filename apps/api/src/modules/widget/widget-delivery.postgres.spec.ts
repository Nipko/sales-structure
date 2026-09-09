import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { WidgetService } from './widget.service';
import { WidgetMessageStore } from './widget-message-store.service';
import { WidgetGateway } from './widget.gateway';
import { widgetPublicMessage } from './widget-message-protocol';
import { ToolExecutionControlService } from '../conversations/tool-execution-control.service';
import { ToolApprovalEffectsService } from '../conversations/tool-approval-effects.service';
import { APPROVAL_EFFECTS_STATE_MIGRATION } from '../conversations/tool-approval-effects.contracts';
import { AgentConsoleService } from '../agent-console/agent-console.service';
import { AiResolutionService } from '../analytics/ai-resolution.service';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { eraseWidgetContactSessions } from './widget-session-erasure';
import { ChannelGatewayService } from '../channels/channel-gateway.service';
import { WidgetChannelAdapter } from '../channels/widget.adapter';
import { operationalConfigurationHash } from '../persona/agent-configuration-revision';
import { isDisposableDatabaseUrl } from '../../common/__fixtures__/disposable-database';

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
(connection ? describe : describe.skip)('persisted Web Chat against disposable PostgreSQL', () => {
    const tenantId = randomUUID(), schema = `tenant_widget_${randomUUID().replace(/-/g, '')}`;
    const servedAgentId = randomUUID();
    const origin = 'https://shop.example.test', secret = 'disposable-widget-secret-32-characters';
    let pool: any, prisma: any, service: WidgetService, store: WidgetMessageStore, controls: ToolExecutionControlService;
    let widget: any, session: any, binding: any;
    const redis: any = { get: async () => null, set: async () => {}, del: async () => {}, acquireLock: async () => false };
    const throttle: any = { getPlanFeatures: async () => ({ widget: true }) };
    const config: any = { get: () => secret, getOrThrow: () => secret };
    const relay: any = { publish: jest.fn(), subscribe: jest.fn() };
    const q = async (sql: string, params: any[] = []) => (await pool.query(sql, params)).rows;
    const tx = async (target: string, work: any) => {
        if (target !== schema) throw new Error('unexpected_schema');
        const client = await pool.connect();
        try {
            await client.query('BEGIN'); await client.query(`SET LOCAL search_path TO "${schema}",public`);
            const result = await work(async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows);
            await client.query('COMMIT'); return result;
        } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    };
    const scoped = (sql: string, params: any[] = []) => tx(schema, (query: any) => query(sql, params));
    const credentials = () => ({ token: session.token, origin });
    const history = () => store.withSessionMessages(credentials(), { history: true }, async (_session, rows) => rows);
    const input = (dedupeId = 'reply') => ({ conversationId: binding.conversation_id, contactId: binding.contact_id,
        content: { type: 'text' as const, text: 'Synthetic reply' }, dedupeId, source: 'ai' as const });

    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !isDisposableDatabaseUrl(url)) throw new Error('disposable_eval_database_required');
        pool = new (require('pg').Pool)({ connectionString: connection });
        await q(`CREATE SCHEMA "${schema}"`);
        await q('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)', [tenantId, schema]);
        // Use the real tenant table definitions and indexes, including UUID defaults and contact/message FKs.
        const tenantDDL = readFileSync(join(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        const initialTables = tenantDDL.slice(tenantDDL.indexOf('-- ---- Contacts ----'), tenantDDL.indexOf('-- ---- Central AI Tool Authority'));
        for (const statement of (PrismaService.prototype as any).splitSqlStatements(initialTables.replace(/\{\{SCHEMA_NAME\}\}/g, schema))) await q(statement);
        prisma = {
            transactionInTenantSchema: tx, executeInTenantSchema: (target: string, sql: string, params: any[]) => tx(target, (query: any) => query(sql, params)),
            getTenantSchemaName: async () => schema, $queryRawUnsafe: (sql: string, ...params: any[]) => q(sql, params),
            tenant: { findUnique: async ({ where }: any) => {
                const row = (await q('SELECT id,schema_name,is_active FROM public.tenants WHERE id=$1::uuid', [where.id]))[0];
                return row ? { id: row.id, schemaName: row.schema_name, isActive: row.is_active, onboardingCompletedAt: new Date(), isInternal: true } : null;
            } },
        };
        service = new WidgetService(prisma, redis, config, throttle);
        // Only create the public widget tables needed by this suite, using their production DDL.
        const publicDDL = readFileSync(join(__dirname, 'widget.service.ts'), 'utf8');
        for (const table of ['widget_configs', 'widget_sessions']) {
            const start = publicDDL.indexOf(`CREATE TABLE IF NOT EXISTS public.${table}`);
            const end = publicDDL.indexOf('`', start);
            await q(publicDDL.slice(start, end));
        }
        widget = (await q("INSERT INTO public.widget_configs(tenant_id,widget_id,allowed_domains,locale) VALUES($1::uuid,$2,$3::text[],'es') RETURNING *", [tenantId, `wgt_${randomUUID()}`, ['example.test']]))[0];
        store = new WidgetMessageStore(prisma, redis, relay, throttle, config);
        controls = new ToolExecutionControlService(prisma, config, {} as any, {} as any);
        await (controls as any).ensureControlTables(schema);
        await new AiResolutionService(prisma, redis).ensureResolutionColumns(schema);
        await scoped('CREATE TABLE conversation_assignments(conversation_id UUID,agent_id UUID,first_response_at TIMESTAMPTZ,resolved_at TIMESTAMPTZ)');
        await scoped('CREATE TABLE payment_operation_ledger(id UUID PRIMARY KEY,execution_ledger_id UUID,operation_kind TEXT,status TEXT,response_payload JSONB)');
        await scoped(`CREATE TABLE agent_personas(id UUID PRIMARY KEY,name TEXT,config_json JSONB,channels TEXT[],channel_bindings TEXT[],
            schedule_mode TEXT,is_active BOOLEAN,is_default BOOLEAN,version INTEGER)`);
        await scoped('CREATE TABLE persona_config(config_json JSONB,is_active BOOLEAN,version INTEGER)');
        await scoped('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agent_persona_id UUID');
        await scoped('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agent_config_version INTEGER');
        await scoped('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agent_attribution_conflicted BOOLEAN DEFAULT false');
    });
    beforeEach(async () => {
        relay.publish.mockReset();
        session = await service.createSession(widget, { visitorId: `visitor_${randomUUID()}` });
        binding = await store.ensureConversation(credentials());
        await scoped('DELETE FROM agent_personas WHERE id<>$1::uuid',[servedAgentId]);
        await scoped(`INSERT INTO agent_personas VALUES($1::uuid,'Alex','{"persona":{"name":"Alex"}}'::jsonb,ARRAY['web_widget'],
            ARRAY['web_widget:owned'],'24_7',true,true,1) ON CONFLICT(id) DO UPDATE SET version=1,is_active=true,config_json=EXCLUDED.config_json,
            channels=EXCLUDED.channels,channel_bindings=EXCLUDED.channel_bindings,is_default=EXCLUDED.is_default`,[servedAgentId]);
    });
    afterAll(async () => {
        if (!pool) return;
        if ((await q("SELECT to_regclass('public.widget_sessions') AS name"))[0].name) await q('DELETE FROM public.widget_sessions WHERE tenant_id=$1::uuid', [tenantId]);
        if ((await q("SELECT to_regclass('public.widget_configs') AS name"))[0].name) await q('DELETE FROM public.widget_configs WHERE tenant_id=$1::uuid', [tenantId]);
        const tables = await q('SELECT tablename FROM pg_tables WHERE schemaname=$1', [schema]);
        if (tables.length) await q(`DROP TABLE ${tables.map((row: any) => `"${schema}"."${row.tablename}"`).join(',')} RESTRICT`);
        await q(`DROP SCHEMA "${schema}" RESTRICT`);
        await q('DELETE FROM public.users WHERE tenant_id=$1::uuid', [tenantId]);
        await q('DELETE FROM public.tenants WHERE id=$1::uuid', [tenantId]); await pool.end();
    });

    it('does not restore identity by visitor ID and rotates a resumed credential with compare-and-swap', async () => {
        const visitorId = binding.visitor_id;
        const anonymous = await service.createSession(widget, { visitorId });
        expect(anonymous.sessionId).not.toBe(session.sessionId);
        expect((await service.getSessionByToken(anonymous.token)).conversation_id).toBeNull();
        const resumed = await service.createSession(widget, { visitorId, resumeToken: session.token });
        expect(resumed.sessionId).toBe(session.sessionId); expect(resumed.token).not.toBe(session.token);
        expect(await service.getSessionByToken(session.token)).toBeNull();
        await expect(history()).rejects.toThrow('widget_session_invalid');
        session = resumed;
        expect((await service.getSessionByToken(resumed.token)).conversation_id).toBe(binding.conversation_id);
    });
    it('serializes first-contact creation across simultaneous browser tabs', async () => {
        session = await service.createSession(widget, { visitorId: 'simultaneous-tabs' });
        const results = await Promise.all([store.ensureConversation(credentials()), store.ensureConversation(credentials())]);
        expect(results[0].conversation_id).toBe(results[1].conversation_id);
        expect(await scoped('SELECT id FROM contacts WHERE external_id=$1', [`widget_${session.sessionId}`])).toHaveLength(1);
    });
    it('persists before publishing, deduplicates concurrent work and waits for a bound browser receipt', async () => {
        const [first, replay] = await Promise.all([store.persist(tenantId, input()), store.persist(tenantId, input())]);
        expect(first.id).toBe(replay.id); expect(first.status).toBe('pending');
        expect(relay.publish).toHaveBeenCalledWith('widget', { room: null, event: 'widget:persisted', payload: { tenantId, conversationId: binding.conversation_id, messageId: first.id } });
        expect((await history()).map(row => row.id)).toEqual([first.id]);
        expect(widgetPublicMessage(first)).toMatchObject({ receiptRequired: true });
        expect(await store.acknowledge(credentials(), first.id)).toBe(true);
        expect(await store.acknowledge(credentials(), first.id)).toBe(false);
        expect((await history())[0].status).toBe('delivered');
    });
    it('rejects cross-session reads and acknowledgements and never exposes internal notes', async () => {
        const reply = await store.persist(tenantId, input());
        await scoped("INSERT INTO messages(conversation_id,direction,content_type,content_text) VALUES($1::uuid,'internal','text','private note')", [binding.conversation_id]);
        expect(await history()).toHaveLength(1);
        const other = await service.createSession(widget, { visitorId: binding.visitor_id });
        await store.ensureConversation({ token: other.token, origin });
        expect(await store.acknowledge({ token: other.token, origin }, reply.id)).toBe(false);
        expect(await store.withSessionMessages({ token: other.token, origin }, { messageId: reply.id }, async (_s, rows) => rows)).toEqual([]);
        expect((await history())[0].status).toBe('pending');
    });
    it('revalidates origins, active configuration, contact erasure and session binding before replay', async () => {
        const reply = await store.persist(tenantId, input());
        await expect(store.withSessionMessages({ token: session.token, origin: 'https://attacker.test' }, {}, async () => null)).rejects.toThrow('widget_session_invalid');
        await q('UPDATE public.widget_configs SET is_active=false WHERE id=$1::uuid', [widget.id]);
        await expect(history()).rejects.toThrow();
        await q('UPDATE public.widget_configs SET is_active=true WHERE id=$1::uuid', [widget.id]);
        await scoped('INSERT INTO customer_memory_erasure(contact_id) VALUES($1::uuid)', [binding.contact_id]);
        await expect(history()).rejects.toThrow('widget_contact_erased');
        await expect(store.persist(tenantId, input('after-erasure'))).rejects.toThrow('widget_contact_erased');
        await expect(store.acknowledge(credentials(), reply.id)).rejects.toThrow('widget_contact_erased');
    });
    it('holds the privacy fence until the authenticated emission callback ends', async () => {
        await store.persist(tenantId, input());
        const tryErase = () => tx(schema, async (query: any) => (await query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired', [`agent-privacy:${schema}`]))[0].acquired);
        await store.withSessionMessages(credentials(), {}, async () => { expect(await tryErase()).toBe(false); });
        expect(await tryErase()).toBe(true);
    });
    it('requires the outbound channel and recipient to match the stored conversation binding', async () => {
        const outbound: any = { tenantId, channelType: 'web_widget', channelAccountId: widget.widget_id,
            to: `widget_${binding.id}`, content: input().content, dedupeId: 'adapter', metadata: { conversationId: binding.conversation_id } };
        const gateway = new ChannelGatewayService(); gateway.registerAdapter(new WidgetChannelAdapter(store));
        const first = await gateway.sendMessage(outbound, '');
        expect(first).toMatch(/^widget:stored:/);
        await expect(store.sendOutbound({ ...outbound, to: 'different-recipient' })).rejects.toThrow('widget_delivery_binding_changed');
        await expect(store.sendOutbound({ ...outbound, channelAccountId: 'other-widget' })).rejects.toThrow('widget_delivery_binding_changed');
        expect(await history()).toHaveLength(1);
    });
    it('upgrades the legacy effect constraint atomically when multiple processes prepare delivery', async () => {
        await scoped('ALTER TABLE tool_approval_effects DROP CONSTRAINT tool_approval_effects_state_check');
        await scoped("ALTER TABLE tool_approval_effects ADD CONSTRAINT tool_approval_effects_state_check CHECK(state IN ('pending','queued','processing','sent','completed','failed','suppressed','reconciliation_required'))");
        await Promise.all([scoped(APPROVAL_EFFECTS_STATE_MIGRATION[0]), scoped(APPROVAL_EFFECTS_STATE_MIGRATION[0])]);
        const result = await scoped("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='tool_approval_effects'::regclass AND conname='tool_approval_effects_state_check'");
        expect(result).toHaveLength(1); expect(result[0].definition).toContain('stored');
    });
    it('erases pre-chat PII and credentials for linked contacts without affecting another tenant or an unrelated visitor', async () => {
        const foreignTenant = randomUUID();
        const linked = await service.createSession(widget, { visitorId: 'linked-visitor', name: 'Synthetic Name', email: 'synthetic@example.test' });
        const linkedBinding = await store.ensureConversation({ token: linked.token, origin });
        const unrelated = await service.createSession(widget, { visitorId: 'unrelated-visitor' });
        await store.ensureConversation({ token: unrelated.token, origin });
        await q('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)', [foreignTenant, `tenant_foreign_${foreignTenant.replace(/-/g, '')}`]);
        try {
            const foreignWidget = (await q('INSERT INTO public.widget_configs(tenant_id,widget_id) VALUES($1::uuid,$2) RETURNING id', [foreignTenant, `wgt_${randomUUID()}`]))[0];
            const foreignSession = (await q("INSERT INTO public.widget_sessions(widget_config_id,tenant_id,visitor_id,contact_id) VALUES($1::uuid,$2::uuid,'foreign-visitor',$3::uuid) RETURNING id", [foreignWidget.id, foreignTenant, binding.contact_id]))[0];
            expect(await tx(schema, (query: any) => eraseWidgetContactSessions(query, schema, [binding.contact_id, linkedBinding.contact_id]))).toBe(2);
            expect(await service.getSessionByToken(session.token)).toBeNull();
            expect(await service.getSessionByToken(linked.token)).toBeNull();
            expect(await service.getSessionByToken(unrelated.token)).toBeTruthy();
            expect(await q('SELECT id FROM public.widget_sessions WHERE id=$1::uuid', [foreignSession.id])).toHaveLength(1);
        } finally { await q('DELETE FROM public.tenants WHERE id=$1::uuid', [foreignTenant]); }
    });

    async function currentScope(id=servedAgentId) {
        const agent=(await scoped('SELECT * FROM agent_personas WHERE id=$1::uuid',[id]))[0];
        return {kind:'agent',tenantId,schemaName:schema,agentId:id,version:agent.version,operationalHash:operationalConfigurationHash(agent)};
    }
    async function complete(tool: string, result: any, requestPayload?: any) {
        const ledger = randomUUID(), ticket = randomUUID(), lease = randomUUID();
        const scope=await currentScope();
        await scoped('UPDATE conversations SET agent_persona_id=COALESCE(agent_persona_id,$2::uuid),agent_config_version=COALESCE(agent_config_version,1) WHERE id=$1::uuid',[binding.conversation_id,servedAgentId]);
        const payload=requestPayload ?? {operationalScope:scope,draftReview:{agentId:scope.agentId,agentVersion:scope.version}};
        await scoped(`INSERT INTO tool_execution_ledger(id,idempotency_key,tool_name,args_hash,assurance_level,status,contact_id,conversation_id,channel_type,response_payload,request_payload)
            VALUES($1::uuid,$2,$3,$4,'A4','succeeded',$5::uuid,$6::uuid,'web_widget',$7::jsonb,$8::jsonb)`, [ledger, randomUUID(), tool, 'a'.repeat(64), binding.contact_id, binding.conversation_id, JSON.stringify(result),JSON.stringify(payload)]);
        await scoped(`INSERT INTO tool_approval_tickets(id,execution_ledger_id,tool_name,contact_id,conversation_id,status,expires_at,resume_state,resume_lease_token)
            VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,'approved',NOW()+INTERVAL '1 day','processing',$6::uuid)`, [ticket, ledger, tool, binding.contact_id, binding.conversation_id, lease]);
        await controls.finishApprovalResume({ tenantId, schemaName: schema, ticketId: ticket, leaseToken: lease, toolName: tool, contactId: binding.contact_id, conversationId: binding.conversation_id, args: {} }, {});
        const effect = (await scoped('SELECT id FROM tool_approval_effects WHERE ticket_id=$1::uuid', [ticket]))[0];
        return { reference: { tenantId, ticketId: ticket, effectId: effect.id }, ledger };
    }
    it.each(['media', 'payment_link', 'handoff'])('stores approved %s in the same transaction as its effect, with no external transport call', async kind => {
        const operationId = randomUUID();
        const result = kind === 'media' ? { success: true, _mediaToSend: [{ url: 'https://media.example.test/image.png', caption: 'Synthetic image' }] }
            : kind === 'payment_link' ? { linkCreated: true, operationId, paymentLink: 'https://pay.example.test/canonical', paid: false, paymentStatus: 'pending' }
                : { success: true, shouldHandoff: true };
        const { reference, ledger } = await complete(kind === 'media' ? 'send_product_image' : kind === 'payment_link' ? 'create_payment_link' : 'create_insurance_claim', result);
        if (kind === 'payment_link') await scoped("INSERT INTO payment_operation_ledger VALUES($1::uuid,$2::uuid,'payment_link','succeeded',$3::jsonb)", [operationId, ledger, JSON.stringify(result)]);
        const handoff = { prepareDelivery: jest.fn(), executeHandoff: jest.fn(async () => { await scoped("UPDATE conversations SET status='waiting_human' WHERE id=$1::uuid", [binding.conversation_id]); }) };
        const effects = new ToolApprovalEffectsService(prisma, {} as any, handoff as any, store);
        const transport = { prepare: jest.fn() };
        expect(await effects.deliver(reference, transport)).toBe('effect:stored');
        expect(await effects.deliver(reference, transport)).toBe('effect:stored');
        expect(transport.prepare).not.toHaveBeenCalled();
        const rows = await history(); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ status: 'pending', metadata: { approvalEffectId: reference.effectId } });
        if (kind === 'handoff') { expect(handoff.executeHandoff).toHaveBeenCalledTimes(1); expect(rows[0].content_text).toContain('bandeja de atención'); }
        if (kind === 'payment_link') expect(rows[0].content_text).toBe(result.paymentLink);
        if (kind === 'media') expect(rows[0].media_url).toBe('https://media.example.test/image.png');
        expect((await controls.listApprovalTickets({ tenantId, conversationId: binding.conversation_id }))[0]).toMatchObject({ executionStatus: 'succeeded', deliveryState: 'completed', deliveryEffects: [{ state: 'stored' }] });
    });
    it('keeps a crashed local media job retryable instead of completing its queue job without storing the message', async () => {
        const { reference } = await complete('send_product_image', { success: true, _mediaToSend: [{ url: 'https://media.example.test/recovered.png' }] });
        await scoped("UPDATE tool_approval_effects SET state='processing',lease_expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1::uuid", [reference.effectId]);
        const effects = new ToolApprovalEffectsService(prisma, {} as any, {} as any, store);
        const transport = { prepare: jest.fn() };
        await expect(effects.deliver(reference, transport)).rejects.toThrow('approval_effect_preflight_failed');
        expect(await history()).toHaveLength(0);
        expect(await effects.deliver(reference, transport)).toBe('effect:stored');
        expect(await history()).toHaveLength(1); expect(transport.prepare).not.toHaveBeenCalled();
    });

    const approvedMedia = {success:true,_mediaToSend:[{url:'https://media.example.test/authority.png'}]};
    const effectState = async (id:string) => (await scoped('SELECT state,attempts,error_code FROM tool_approval_effects WHERE id=$1::uuid',[id]))[0];
    const localEffects = () => new ToolApprovalEffectsService(prisma,{} as any,{} as any,store);

    it.each(['missing','argument_forgery','foreign_tenant','bad_hash','wrong_draft_version','other_active_agent'])(
        'rejects %s scope without a widget message or provider preparation',async fault=>{
        const scope=await currentScope();
        const payload:any={operationalScope:scope,draftReview:{agentId:servedAgentId,agentVersion:1}};
        if(fault==='missing')delete payload.operationalScope;
        if(fault==='argument_forgery'){delete payload.operationalScope;payload.args={operationalScope:scope};}
        if(fault==='foreign_tenant')payload.operationalScope={...scope,tenantId:randomUUID()};
        if(fault==='bad_hash')payload.operationalScope={...scope,operationalHash:'f'.repeat(64)};
        if(fault==='wrong_draft_version')payload.draftReview.agentVersion=2;
        if(fault==='other_active_agent'){
            const other=randomUUID();
            await scoped('INSERT INTO agent_personas SELECT $1::uuid,name,config_json,channels,channel_bindings,schedule_mode,is_active,is_default,version FROM agent_personas WHERE id=$2::uuid',[other,servedAgentId]);
            payload.operationalScope=await currentScope(other);
        }
        const {reference}=await complete('send_product_image',approvedMedia,payload);
        const transport={prepare:jest.fn()};
        expect(await localEffects().deliver(reference,transport)).toBe('effect:suppressed');
        expect(await effectState(reference.effectId)).toMatchObject({state:'suppressed',attempts:0});
        expect(await history()).toHaveLength(0);expect(transport.prepare).not.toHaveBeenCalled();
    });

    it.each(['version','config','inactive'])('suppresses a pending delivery when the served %s changed',async change=>{
        const {reference}=await complete('send_product_image',approvedMedia);
        if(change==='version')await scoped('UPDATE agent_personas SET version=2 WHERE id=$1::uuid',[servedAgentId]);
        if(change==='config')await scoped(`UPDATE agent_personas SET config_json='{"persona":{"name":"Changed"}}'::jsonb WHERE id=$1::uuid`,[servedAgentId]);
        if(change==='inactive')await scoped('UPDATE agent_personas SET is_active=false WHERE id=$1::uuid',[servedAgentId]);
        expect(await localEffects().deliver(reference,{prepare:jest.fn()})).toBe('effect:suppressed');
        expect(await effectState(reference.effectId)).toMatchObject({error_code:'agent_operational_revision_changed'});
        expect(await history()).toHaveLength(0);
    });

    it.each(['draft','policy'])('accepts a new %s approval after publication while the conversation retains its first version',async mode=>{
        await scoped('UPDATE conversations SET agent_persona_id=$2::uuid,agent_config_version=1,agent_attribution_conflicted=true WHERE id=$1::uuid',[binding.conversation_id,servedAgentId]);
        await scoped('UPDATE agent_personas SET version=2 WHERE id=$1::uuid',[servedAgentId]);
        const scope=await currentScope();
        const payload:any={operationalScope:scope,...(mode==='draft'?{draftReview:{agentId:servedAgentId,agentVersion:2}}:{})};
        const {reference}=await complete('send_product_image',approvedMedia,payload);
        expect(await localEffects().deliver(reference,{prepare:jest.fn()})).toBe('effect:stored');
        expect(await history()).toHaveLength(1);
        expect((await scoped('SELECT agent_config_version FROM conversations WHERE id=$1::uuid',[binding.conversation_id]))[0].agent_config_version).toBe(1);
    });

    const connectionAgentSql=`INSERT INTO agent_personas VALUES($1::uuid,'Bea','{"persona":{"name":"Bea"}}'::jsonb,
        '{}'::text[],$2::text[],'24_7',true,false,1)`;
    it.each(['draft','policy'])('stores a new %s approval from the connection owner while preserving another historical agent',async mode=>{
        const currentId=randomUUID();
        await scoped(connectionAgentSql,[currentId,[`web_widget:${widget.widget_id}`]]);
        const scope=await currentScope(currentId);
        const payload={operationalScope:scope,...(mode==='draft'?{draftReview:{agentId:currentId,agentVersion:1}}:{})};
        const {reference}=await complete('send_product_image',approvedMedia,payload);
        const transport={prepare:jest.fn()};
        expect(await localEffects().deliver(reference,transport)).toBe('effect:stored');
        expect(await history()).toHaveLength(1);
        expect((await scoped('SELECT agent_persona_id FROM conversations WHERE id=$1::uuid',[binding.conversation_id]))[0].agent_persona_id).toBe(servedAgentId);
        await scoped('UPDATE agent_personas SET version=2 WHERE id=$1::uuid',[currentId]);
        expect(await localEffects().deliver(reference,transport)).toBe('effect:stored');
        expect(await history()).toHaveLength(1);expect(transport.prepare).not.toHaveBeenCalled();
    });

    it('suppresses a pending generic-agent delivery after an exact connection owner supersedes it without changing the original revision',async()=>{
        const scope=await currentScope();
        const {reference}=await complete('send_product_image',approvedMedia,{operationalScope:scope});
        await scoped(connectionAgentSql,[randomUUID(),[`web_widget:${widget.widget_id}`]]);
        expect(await currentScope()).toEqual(scope);
        expect(await localEffects().deliver(reference,{prepare:jest.fn()})).toBe('effect:suppressed');
        expect(await history()).toHaveLength(0);
        expect(await effectState(reference.effectId)).toMatchObject({error_code:'agent_operational_revision_changed'});
    });

    it('serializes a new higher-priority owner inserted without a tenant lock behind local delivery',async()=>{
        const {reference}=await complete('send_product_image',approvedMedia);
        const creator=await pool.connect(),newId=randomUUID();
        let creation:Promise<any>|undefined,blocked=false;
        const original=store.persistWithQuery.bind(store);
        const persist=jest.spyOn(store,'persistWithQuery').mockImplementation(async(query,s,tenant,input)=>{
            const ownerPid=(await query<any[]>('SELECT pg_backend_pid() AS pid'))[0].pid;
            await creator.query('BEGIN');await creator.query(`SET LOCAL search_path TO "${schema}",public`);
            await creator.query("SET LOCAL lock_timeout='4s'");
            const waitingPid=(await creator.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
            creation=(async()=>{await creator.query(connectionAgentSql,[newId,[`web_widget:${widget.widget_id}`]]);await creator.query('COMMIT');})();
            void creation.catch(()=>undefined);
            const deadline=Date.now()+2000;
            while(Date.now()<deadline){
                if((await q('SELECT pg_blocking_pids($1::int) AS blockers',[waitingPid]))[0].blockers.includes(ownerPid)){blocked=true;break;}
                await new Promise(resolve=>setTimeout(resolve,10));
            }
            return original(query,s,tenant,input);
        });
        try{
            expect(await localEffects().deliver(reference,{prepare:jest.fn()})).toBe('effect:stored');
            await creation;expect(blocked).toBe(true);
            expect(await localEffects().deliver(reference,{prepare:jest.fn()})).toBe('effect:stored');
            expect(await history()).toHaveLength(1);
        }finally{persist.mockRestore();await creation?.catch(()=>undefined);await creator.query('ROLLBACK');creator.release();}
    });

    it('preserves a canonical payment operation when a new link delivery is suppressed, and keeps accepted receipts after publication',async()=>{
        const operationId=randomUUID();
        const result={linkCreated:true,operationId,paymentLink:'https://pay.example.test/authority',paid:false,paymentStatus:'pending'};
        const {reference,ledger}=await complete('create_payment_link',result);
        await scoped("INSERT INTO payment_operation_ledger VALUES($1::uuid,$2::uuid,'payment_link','succeeded',$3::jsonb)",[operationId,ledger,JSON.stringify(result)]);
        const original=await scoped('SELECT * FROM payment_operation_ledger WHERE id=$1::uuid',[operationId]);
        await scoped('UPDATE agent_personas SET version=2 WHERE id=$1::uuid',[servedAgentId]);
        expect(await localEffects().deliver(reference,{prepare:jest.fn()})).toBe('effect:suppressed');
        expect(await history()).toHaveLength(0);
        expect(await scoped('SELECT * FROM payment_operation_ledger WHERE id=$1::uuid',[operationId])).toEqual(original);
        const next=await complete('send_product_image',approvedMedia);
        const effects=localEffects();await effects.deliver(next.reference,{prepare:jest.fn()});
        const stored=(await history())[0];
        await scoped('UPDATE agent_personas SET version=3,is_active=false WHERE id=$1::uuid',[servedAgentId]);
        relay.publish.mockClear();
        expect(await effects.deliver(next.reference,{prepare:jest.fn()})).toBe('effect:stored');
        expect(await history()).toHaveLength(1);expect((await history())[0].id).toBe(stored.id);
        expect(relay.publish).not.toHaveBeenCalled();
    });

    it('serializes publication behind the guarded local commit and then replays its existing receipt',async()=>{
        const {reference}=await complete('send_product_image',approvedMedia);
        const publisher=await pool.connect();
        let publication:Promise<any>|undefined,observedBlock=false;
        const original=store.persistWithQuery.bind(store);
        const persist=jest.spyOn(store,'persistWithQuery').mockImplementation(async(query,s,tenant,input)=>{
            const sourcePid=(await query<any[]>('SELECT pg_backend_pid() AS pid'))[0].pid;
            await publisher.query('BEGIN');await publisher.query("SET LOCAL lock_timeout='4s'");
            await publisher.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text',[`agent-privacy:${schema}`]);
            const publisherPid=(await publisher.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
            publication=(async()=>{
                await publisher.query('SELECT id FROM public.tenants WHERE id=$1::uuid FOR UPDATE',[tenantId]);
                await publisher.query(`UPDATE "${schema}".agent_personas SET version=2 WHERE id=$1::uuid`,[servedAgentId]);
                await publisher.query('COMMIT');
            })();
            void publication.catch(()=>undefined);
            const deadline=Date.now()+2000;
            while(Date.now()<deadline){
                if((await q('SELECT pg_blocking_pids($1::int) AS blockers',[publisherPid]))[0].blockers.includes(sourcePid)){observedBlock=true;break;}
                await new Promise(resolve=>setTimeout(resolve,10));
            }
            return original(query,s,tenant,input);
        });
        try{
            const effects=localEffects();
            expect(await effects.deliver(reference,{prepare:jest.fn()})).toBe('effect:stored');
            await publication;
            expect(observedBlock).toBe(true);
            expect(await effects.deliver(reference,{prepare:jest.fn()})).toBe('effect:stored');
            expect(await history()).toHaveLength(1);
        }finally{persist.mockRestore();await publication?.catch(()=>undefined);await publisher.query('ROLLBACK');publisher.release();}
    });

    it('rolls back message plus receipt on SQL failure and stops retrying after five failed attempts',async()=>{
        const {reference}=await complete('send_product_image',approvedMedia);
        const original=store.persistWithQuery.bind(store);
        const persist=jest.spyOn(store,'persistWithQuery').mockImplementation(async(query,s,tenant,input)=>{
            await original(query,s,tenant,input);
            await query('SELECT 1/0 AS synthetic_failure');
            throw new Error('unreachable');
        });
        try{
            const effects=localEffects();
            for(let attempt=1;attempt<=5;attempt++){
                await expect(effects.deliver(reference,{prepare:jest.fn()})).rejects.toThrow();
                expect(await history()).toHaveLength(0);
                expect(await effectState(reference.effectId)).toMatchObject({state:'failed',attempts:attempt});
            }
            expect(await effects.deliver(reference,{prepare:jest.fn()})).toBe('effect:failed');
            expect(persist).toHaveBeenCalledTimes(5);expect(relay.publish).not.toHaveBeenCalled();
        }finally{persist.mockRestore();}
    });

    it('does not turn a stored message into a failed attempt after its COMMIT acknowledgement is lost',async()=>{
        const {reference}=await complete('send_product_image',approvedMedia);
        let loseAck=true;
        const intercepted={...prisma,transactionInTenantSchema:async(s:string,work:any)=>{
            const result=await tx(s,work);
            if(result?.value==='effect:stored'&&loseAck){loseAck=false;throw new Error('commit_ACK_lost');}
            return result;
        }};
        const effects=new ToolApprovalEffectsService(intercepted,{} as any,{} as any,store);
        await expect(effects.deliver(reference,{prepare:jest.fn()})).rejects.toThrow('commit_ACK_lost');
        expect(await effectState(reference.effectId)).toMatchObject({state:'stored',attempts:1});
        expect(await effects.deliver(reference,{prepare:jest.fn()})).toBe('effect:stored');
        expect(await history()).toHaveLength(1);
    });

    it.each(['unavailable_plan','missing_widget_port'])('bounds repeated %s failures without invoking persistence',async fault=>{
        const {reference}=await complete('send_product_image',approvedMedia);
        const available=fault==='unavailable_plan'?jest.spyOn(store,'assertAvailable').mockRejectedValue(new Error('widget_delivery_unavailable')):undefined;
        const persist=jest.spyOn(store,'persistWithQuery');
        const effects=new ToolApprovalEffectsService(prisma,{} as any,{} as any,fault==='missing_widget_port'?undefined:store);
        try{
            for(let attempt=1;attempt<=5;attempt++){
                await expect(effects.deliver(reference,{prepare:jest.fn()})).rejects.toThrow('widget_delivery_unavailable');
                expect(await effectState(reference.effectId)).toMatchObject({state:'failed',attempts:attempt});
            }
            expect(await effects.deliver(reference,{prepare:jest.fn()})).toBe('effect:failed');
            expect(persist).not.toHaveBeenCalled();
            expect(await scoped('SELECT id FROM messages WHERE conversation_id=$1::uuid',[binding.conversation_id])).toHaveLength(0);
        }finally{available?.mockRestore();persist.mockRestore();}
    });

    it.each(['web_widget','whatsapp'])('rejects a channel change after initial %s classification without a local or external dispatch',async initial=>{
        const {reference,ledger}=await complete('send_product_image',approvedMedia);
        await scoped('UPDATE tool_execution_ledger SET channel_type=$2 WHERE id=$1::uuid',[ledger,initial]);
        let changed=false;
        const intercepted={...prisma,executeInTenantSchema:async(s:string,sql:string,params:any[])=>{
            const result=await prisma.executeInTenantSchema(s,sql,params);
            if(!changed&&sql.includes('SELECT e.kind,e.state,l.channel_type')){
                changed=true;
                await scoped('UPDATE tool_execution_ledger SET channel_type=$2 WHERE id=$1::uuid',[ledger,initial==='web_widget'?'whatsapp':'web_widget']);
            }
            return result;
        }};
        const transport={prepare:jest.fn()};
        expect(await new ToolApprovalEffectsService(intercepted,{} as any,{} as any,store).deliver(reference,transport)).toBe('effect:suppressed');
        expect(changed).toBe(true);expect(transport.prepare).not.toHaveBeenCalled();expect(await history()).toHaveLength(0);
    });

    it('rechecks the ledger scope under its lock after the agent guard has read the original authority',async()=>{
        const {reference,ledger}=await complete('send_product_image',approvedMedia);
        let changed=false;
        const intercepted={...prisma,transactionInTenantSchema:async(s:string,work:any)=>tx(s,(query:any)=>work(async(sql:string,params:any[])=>{
            const result=await query(sql,params);
            if(!changed&&sql.includes('SELECT * FROM agent_personas WHERE id=')){
                changed=true;
                await scoped(`UPDATE tool_execution_ledger SET request_payload=jsonb_set(request_payload,'{operationalScope,version}','2'::jsonb) WHERE id=$1::uuid`,[ledger]);
            }
            return result;
        }))};
        expect(await new ToolApprovalEffectsService(intercepted,{} as any,{} as any,store).deliver(reference,{prepare:jest.fn()})).toBe('effect:suppressed');
        expect(changed).toBe(true);
        expect(await effectState(reference.effectId)).toMatchObject({error_code:'approval_effect_authority_changed'});
        expect(await history()).toHaveLength(0);
    });
    it('uses the same persisted transport for a human reply and preserves handoff response metrics', async () => {
        const actor = randomUUID();
        await q('INSERT INTO public.users(id,tenant_id,is_active) VALUES($1::uuid,$2::uuid,true)', [actor, tenantId]);
        await scoped("UPDATE conversations SET metadata=metadata||'{\"pendingDraft\":\"draft\"}'::jsonb WHERE id=$1::uuid", [binding.conversation_id]);
        await scoped('INSERT INTO conversation_assignments(conversation_id,agent_id) VALUES($1::uuid,$2::uuid)', [binding.conversation_id, actor]);
        const consoleService: any = Object.create(AgentConsoleService.prototype);
        Object.assign(consoleService, { prisma, widgetMessages: store, aiResolutionService: new AiResolutionService(prisma, redis), getTenantSchema: async () => schema });
        const reply = await consoleService.sendAgentMessage(tenantId, binding.conversation_id, actor, 'Human reply');
        expect(reply).toMatchObject({ sender: 'agent', metadata: { deliveryState: 'stored' } });
        expect((await history())[0]).toMatchObject({ id: reply.id, status: 'pending' });
        const conversation = (await scoped('SELECT was_handed_off,metadata FROM conversations WHERE id=$1::uuid', [binding.conversation_id]))[0];
        expect(conversation.was_handed_off).toBe(true); expect(conversation.metadata.pendingDraft).toBeUndefined();
        expect((await scoped('SELECT first_response_at FROM conversation_assignments WHERE conversation_id=$1::uuid', [binding.conversation_id]))[0].first_response_at).toBeTruthy();
    });
    it('recovers a missed relay signal through a fresh socket session and stops the old socket after rotation', async () => {
        const gateway = new WidgetGateway(service, prisma, redis, {} as any, {} as any, store, relay);
        const events: any[] = [];
        const client: any = { id: randomUUID(), handshake: { auth: { token: session.token }, headers: { origin } },
            emit: (event: string, data: any) => events.push({ event, data }), join: jest.fn(), use: jest.fn(), disconnect: jest.fn() };
        (gateway as any).server = {};
        await gateway.handleConnection(client);
        const message = await store.persist(tenantId, input());
        expect(events.filter(e => e.event === 'widget:message')).toHaveLength(0);
        await gateway.replayPending();
        expect(events.filter(e => e.event === 'widget:message')[0].data).toMatchObject({ id: message.id, receiptRequired: true });
        await gateway.handleReceipt(client, { messageId: message.id });
        expect((await history())[0].status).toBe('delivered');
        await service.createSession(widget, { visitorId: binding.visitor_id, resumeToken: session.token });
        await gateway.replayPending(); expect(client.disconnect).toHaveBeenCalled();
    });
    it('replays to a real Socket.IO browser connection after offline persistence and records only its authenticated receipt', async () => {
        const http = createServer(), server = new Server(http);
        const namespace = server.of('/widget');
        const gateway = new WidgetGateway(service, prisma, redis, {} as any, {} as any, store, relay);
        (gateway as any).server = namespace;
        namespace.on('connection', client => {
            client.on('widget:received', data => void gateway.handleReceipt(client, data));
            client.on('disconnect', () => gateway.handleDisconnect(client));
            void gateway.handleConnection(client);
        });
        await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
        const endpoint = `http://127.0.0.1:${(http.address() as any).port}/widget`;
        let browser: any;
        const receiveHistory = () => new Promise<any>((resolve, reject) => {
            browser = connect(endpoint, { auth: { token: session.token }, extraHeaders: { origin }, transports: ['websocket'], reconnection: false });
            const timeout = setTimeout(() => reject(new Error('widget_socket_history_timeout')), 5000);
            browser.once('widget:history', (data: any) => { clearTimeout(timeout); resolve(data); });
            browser.once('connect_error', reject);
        });
        try {
            const reply = await store.persist(tenantId, input());
            expect((await receiveHistory()).messages).toEqual([expect.objectContaining({ id: reply.id, receiptRequired: true })]);
            expect((await history())[0].status).toBe('pending');
            browser.disconnect();
            const media = await store.persist(tenantId, { ...input('offline-media'), content: { type: 'image', mediaUrl: 'https://media.example.test/offline.png' } });
            const replay = await receiveHistory();
            expect(replay.messages.map((row: any) => row.id)).toEqual([reply.id, media.id]);
            browser.emit('widget:received', { messageId: media.id });
            // Poll the persisted receipt; socket emission itself was not evidence of receipt.
            const deadline = Date.now() + 3000;
            while (Date.now() < deadline && (await history()).find(row => row.id === media.id)?.status !== 'delivered') await new Promise(resolve => setTimeout(resolve, 10));
            expect((await history()).find(row => row.id === media.id)?.status).toBe('delivered');
            expect((await history()).find(row => row.id === reply.id)?.status).toBe('pending');
        } finally { browser?.disconnect(); await new Promise<void>(resolve => server.close(() => resolve())); }
    }, 15000);
});
