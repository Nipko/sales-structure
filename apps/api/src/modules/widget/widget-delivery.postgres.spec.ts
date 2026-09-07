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

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
(connection ? describe : describe.skip)('persisted Web Chat against disposable PostgreSQL', () => {
    const tenantId = randomUUID(), schema = `tenant_widget_${randomUUID().replace(/-/g, '')}`;
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
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/parallly_eval_isolation')) throw new Error('disposable_eval_database_required');
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
    });
    beforeEach(async () => {
        relay.publish.mockReset();
        session = await service.createSession(widget, { visitorId: `visitor_${randomUUID()}` });
        binding = await store.ensureConversation(credentials());
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

    async function complete(tool: string, result: any) {
        const ledger = randomUUID(), ticket = randomUUID(), lease = randomUUID();
        await scoped(`INSERT INTO tool_execution_ledger(id,idempotency_key,tool_name,args_hash,assurance_level,status,contact_id,conversation_id,channel_type,response_payload)
            VALUES($1::uuid,$2,$3,$4,'A4','succeeded',$5::uuid,$6::uuid,'web_widget',$7::jsonb)`, [ledger, randomUUID(), tool, 'a'.repeat(64), binding.contact_id, binding.conversation_id, JSON.stringify(result)]);
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
