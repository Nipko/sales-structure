import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { readServingPersona } from '../persona/serving-persona';
import { servedAgentAuthority, type ServedAgentAuthority } from '../persona/served-agent-authority';
import { ToolApprovalWorkflowService } from './tool-approval-workflow.service';
import { ToolExecutionControlService } from './tool-execution-control.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

const url = process.env.PARALLLY_ISOLATION_TEST_URL;
(url ? describe : describe.skip)('approval proposal origin with real Prisma/PostgreSQL connection routing', () => {
    const schema = `tenant_approval_origin_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID(), historicalAgent = randomUUID(), contactId = randomUUID(), conversationId = randomUUID();
    let client: PrismaClient, prisma: PrismaService;
    let beforeGlobalLookupReturn: (() => Promise<void>) | undefined;
    const contextStatements: string[] = [];
    const query = (sql: string, params: any[] = []) => prisma.executeInTenantSchema<any[]>(schema, sql, params);
    const resolvePersonaForChannel = async (id: string, channel: string, account?: string) => {
        if (id !== tenantId) throw new Error('foreign_tenant');
        return readServingPersona(<T>(sql: string, params: any[] = []) => prisma.executeInTenantSchema<T>(schema, sql, params), channel, account);
    };
    const agent = async (data: { id?: string; bindings?: string[]; channels?: string[]; default?: boolean; active?: boolean } = {}) => {
        const id = data.id || randomUUID();
        await query(`INSERT INTO agent_personas(id,name,config_json,version,is_active,is_default,channels,channel_bindings,schedule_mode)
            VALUES($1::uuid,'Agent',$2::jsonb,1,$3,$4,$5::text[],$6::text[],'24_7')`,
        [id, JSON.stringify({ industry: 'retail', tools: { appointments: { enabled: true } } }), data.active ?? true,
            data.default ?? false, data.channels || [], data.bindings || []]);
        return id;
    };
    const origin = async (account = 'widget-one') => servedAgentAuthority(tenantId, schema,
        await resolvePersonaForChannel(tenantId, 'web_widget', account))!;
    function harness(scope: ServedAgentAuthority, draft = false) {
        const claim = { tenantId, schemaName: schema, ticketId: randomUUID(), leaseToken: randomUUID(),
            toolName: 'cancel_appointment', contactId, conversationId, channelType: 'web_widget', args: { appointmentId: randomUUID() },
            operationalScope: scope, ...(draft && scope.kind === 'agent' ? { draftReview: { agentId: scope.agentId, agentVersion: scope.version } } : {}) };
        const controls = { finishApprovalResume: jest.fn(async (_claim: any, result: any) => result),
            claimApprovalResume: jest.fn().mockResolvedValue({ state: 'claimed', claim }) };
        const executor = { execute: jest.fn().mockResolvedValue({ success: true }) };
        const resolver = jest.fn(resolvePersonaForChannel);
        const workflow = new ToolApprovalWorkflowService(prisma, controls as any, executor as any, new EventEmitter2(), {} as any,
            { resolve: async () => ({ status: { status: 'ok' }, authority: authorityFor('cancel_appointment') }) } as any,
            { resolvePersonaForChannel: resolver } as any);
        return { executor, controls, resolver, run: () => workflow.resumeApprovedTicket(tenantId, claim.ticketId) };
    }
    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: url });
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        const native = PrismaService.prototype.transactionInTenantSchema.bind(prisma);
        prisma.transactionInTenantSchema = ((name: string, work: any, options: any) => native(name, async (q: any) => work(async (sql: string, params?: any[]) => {
            contextStatements.push(sql); return q(sql, params);
        }), options)) as any;
        // The fast global precheck is deliberately stale in the remap test;
        // the short transaction must verify the real registry before local SQL.
        Object.defineProperty(prisma, 'tenant', { value: { findUnique: async ({ where }: any) => {
            await beforeGlobalLookupReturn?.();
            return where.id === tenantId ? { schemaName: schema, isActive: true, industry: 'retail', settings: {} } : null;
        } } });
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)', tenantId, schema);
        await query(`CREATE TABLE agent_personas(id UUID PRIMARY KEY,name TEXT,config_json JSONB,version INTEGER,
            is_active BOOLEAN,is_default BOOLEAN,channels TEXT[],channel_bindings TEXT[],schedule_mode TEXT)`);
        await query('CREATE TABLE persona_config(config_json JSONB,version INTEGER,is_active BOOLEAN)');
        await query(`CREATE TABLE conversations(id UUID PRIMARY KEY,contact_id UUID,channel_type TEXT,channel_account_id TEXT,
            agent_persona_id UUID,agent_config_version INTEGER,agent_attribution_conflicted BOOLEAN)`);
    });
    beforeEach(async () => {
        beforeGlobalLookupReturn = undefined;
        await client.$executeRawUnsafe('UPDATE public.tenants SET schema_name=$2,is_active=true WHERE id=$1::uuid', tenantId, schema);
        await query('TRUNCATE conversations,agent_personas,persona_config');
        await query(`INSERT INTO conversations VALUES($1::uuid,$2::uuid,'web_widget','widget-one',$3::uuid,1,true)`,
            [conversationId, contactId, historicalAgent]);
    });
    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_approval_origin_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            for (const table of ['conversations', 'persona_config', 'agent_personas'])
                await client.$executeRawUnsafe(`DROP TABLE IF EXISTS "${schema}"."${table}" RESTRICT`);
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" RESTRICT`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });
    it.each(['connection', 'channel', 'default'])('resumes current B selected by %s despite the first attribution A', async priority => {
        if (priority !== 'default') await agent({ id: historicalAgent, default: true });
        if (priority === 'connection') await agent({ channels: ['web_widget'] });
        const id = await agent(priority === 'connection' ? { bindings: ['web_widget:widget-one'] }
            : priority === 'channel' ? { channels: ['web_widget'] } : { default: true });
        const scope = await origin();
        expect(scope).toMatchObject({ kind: 'agent', agentId: id });
        const h = harness(scope, true);
        expect(await h.run()).toEqual({ success: true });
        expect(h.executor.execute).toHaveBeenCalledTimes(1);
        expect(h.resolver).not.toHaveBeenCalled(); // the pure production selector shares the context transaction
        expect((await query('SELECT agent_persona_id FROM conversations'))[0].agent_persona_id).toBe(historicalAgent);
    });
    it('allows a new policy proposal from B and rejects an old A proposal after connection reassignment', async () => {
        await agent({ id: historicalAgent, default: true });
        const old = await origin();
        const b = await agent({ bindings: ['web_widget:widget-one'] });
        const outdated = harness(old);
        expect(await outdated.run()).toMatchObject({ error: 'agent_operational_revision_changed' });
        expect(outdated.executor.execute).not.toHaveBeenCalled();
        const scope = await origin();
        expect(scope).toMatchObject({ agentId: b });
        expect(await harness(scope).run()).toEqual({ success: true });
    });
    it('rejects B when another exact connection binding displaces B default without changing B itself', async () => {
        await agent({ default: true });
        const old = await origin();
        await agent({ bindings: ['web_widget:widget-one'] });
        const h = harness(old);
        expect(await h.run()).toMatchObject({ error: 'agent_operational_revision_changed' });
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
    it('allows a new version proposal in the old conversation while rejecting the previous revision', async () => {
        const id = await agent({ id: historicalAgent, default: true });
        const old = await origin();
        await query('UPDATE agent_personas SET version=2 WHERE id=$1::uuid', [id]);
        expect(await harness(old, true).run()).toMatchObject({ error: 'agent_operational_revision_changed' });
        expect(await harness(await origin(), true).run()).toEqual({ success: true });
    });
    it('rejects ambiguous routing instead of executing whichever agent the ticket names', async () => {
        await agent({ default: true });
        const scope = await origin();
        await agent({ default: true });
        const h = harness(scope);
        expect(await h.run()).toMatchObject({ error: 'approval_resume_failed' });
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
    it('preserves explicit legacy only until any durable agent exists, including inactive ones', async () => {
        await query(`INSERT INTO persona_config VALUES('{"industry":"retail"}',1,true)`);
        const scope = await origin();
        expect(scope.kind).toBe('legacy');
        expect(await harness(scope).run()).toEqual({ success: true });
        await agent({ active: false });
        const h = harness(scope);
        expect(await h.run()).toMatchObject({ error: 'approval_agent_unavailable' });
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
    it('returns a previously completed receipt without resolving or executing after routing changes', async () => {
        await agent({ default: true });
        const h = harness(await origin());
        const receipt = { state: 'completed', result: { success: true, operationId: randomUUID() } };
        h.controls.claimApprovalResume.mockResolvedValue(receipt);
        await agent({ bindings: ['web_widget:widget-one'] });
        expect(await h.run()).toEqual(receipt);
        expect(h.resolver).not.toHaveBeenCalled();
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
    it('reads no local context or selector when remapping wins after the global precheck', async () => {
        await agent({ default: true });
        const h = harness(await origin());
        beforeGlobalLookupReturn = async () => {
            await client.$executeRawUnsafe('UPDATE public.tenants SET schema_name=$2 WHERE id=$1::uuid', tenantId, `${schema}_remapped`);
        };
        contextStatements.length = 0;
        expect(await h.run()).toMatchObject({ state: 'in_progress', result: { error: 'approval_tenant_unavailable', persisted: false } });
        expect(contextStatements.some(sql => sql.includes('FROM conversations') || sql.includes('WITH ranked AS'))).toBe(false);
        expect(h.controls.finishApprovalResume).not.toHaveBeenCalled();
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
});

(url ? describe : describe.skip)('approval finalization retains tenant mapping until its PostgreSQL commit', () => {
    const schema = `tenant_approval_finish_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID(), contactId = randomUUID(), conversationId = randomUUID();
    const ticketId = randomUUID(), ledgerId = randomUUID(), leaseToken = randomUUID();
    const ownerSql = 'SELECT id FROM public.tenants WHERE id=$1::uuid AND schema_name=$2 FOR SHARE';
    let client: PrismaClient, prisma: PrismaService, controls: ToolExecutionControlService;
    let onOwnerQuery: ((phase: 'before' | 'after', query: any) => Promise<void>) | undefined;
    const statements: string[] = [];
    const query = (sql: string, params: any[] = []) => prisma.executeInTenantSchema<any[]>(schema, sql, params);
    const claim = { tenantId, schemaName: schema, ticketId, leaseToken, toolName: 'apply_discount', contactId,
        conversationId, args: {} };
    const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
    const waitBlocked = async (pid: number) => {
        for (let attempt = 0; attempt < 100; attempt++) {
            const rows = await client.$queryRawUnsafe('SELECT cardinality(pg_blocking_pids($1::int)) AS count', pid) as any[];
            if (rows[0].count > 0) return;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error('expected_mapping_lock_wait');
    };
    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: url });
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        const native = PrismaService.prototype.transactionInTenantSchema.bind(prisma);
        prisma.transactionInTenantSchema = ((name: string, work: any, options: any) => native(name, async (q: any) => work(async (sql: string, params?: any[]) => {
            statements.push(sql);
            if (sql === ownerSql) await onOwnerQuery?.('before', q);
            const result = await q(sql, params);
            if (sql === ownerSql) await onOwnerQuery?.('after', q);
            return result;
        }), options)) as any;
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)', tenantId, schema);
        await query('CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY)');
        await query('CREATE TABLE tool_execution_ledger(id UUID PRIMARY KEY,status TEXT,response_payload JSONB,tool_name TEXT)');
        await query(`CREATE TABLE tool_approval_tickets(id UUID PRIMARY KEY,execution_ledger_id UUID,resume_attempts INTEGER,
            resume_state TEXT,resume_lease_token UUID,resume_lease_expires_at TIMESTAMPTZ,resume_result JSONB,resume_error TEXT,
            next_resume_at TIMESTAMPTZ,updated_at TIMESTAMPTZ)`);
        controls = new ToolExecutionControlService(prisma, {} as any, {} as any, {} as any);
    });
    beforeEach(async () => {
        onOwnerQuery = undefined;
        await client.$executeRawUnsafe('UPDATE public.tenants SET schema_name=$2,is_active=true WHERE id=$1::uuid', tenantId, schema);
        await query('TRUNCATE customer_memory_erasure,tool_execution_ledger,tool_approval_tickets');
        await query(`INSERT INTO tool_execution_ledger VALUES($1::uuid,'awaiting_approval','{}','apply_discount')`, [ledgerId]);
        await query(`INSERT INTO tool_approval_tickets(id,execution_ledger_id,resume_attempts,resume_state,resume_lease_token,resume_lease_expires_at)
            VALUES($1::uuid,$2::uuid,1,'processing',$3::uuid,NOW()+INTERVAL '90 seconds')`, [ticketId, ledgerId, leaseToken]);
        statements.length = 0;
    });
    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_approval_finish_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            for (const table of ['tool_approval_tickets', 'tool_execution_ledger', 'customer_memory_erasure'])
                await client.$executeRawUnsafe(`DROP TABLE IF EXISTS "${schema}"."${table}" RESTRICT`);
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" RESTRICT`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });
    it('does not read tenant tables or finalize when the registered schema differs', async () => {
        await client.$executeRawUnsafe('UPDATE public.tenants SET schema_name=$2 WHERE id=$1::uuid', tenantId, `${schema}_remapped`);
        expect(await controls.finishApprovalResume(claim, { error: 'late_result' })).toEqual({ state: 'in_progress',
            result: { error: 'approval_tenant_unavailable', persisted: false, controlBlocked: true } });
        expect(statements).toHaveLength(2); // privacy lock, global mapping lock only
        expect(statements[1]).toBe(ownerSql);
        expect((await query('SELECT resume_state,resume_lease_token FROM tool_approval_tickets'))[0])
            .toEqual({ resume_state: 'processing', resume_lease_token: leaseToken });
    });
    it('does not read tenant tables for a missing global owner', async () => {
        expect(await controls.finishApprovalResume({ ...claim, tenantId: randomUUID() }, {}))
            .toMatchObject({ state: 'in_progress', result: { error: 'approval_tenant_unavailable' } });
        expect(statements).toHaveLength(2);
    });
    it('observes a concurrent remap committed before its owner lock and leaves the old lease intact', async () => {
        const remapped = deferred(), release = deferred(), reading = deferred();
        let pid = 0;
        const remapping = client.$transaction(async tx => {
            await tx.$executeRawUnsafe('UPDATE public.tenants SET schema_name=$2 WHERE id=$1::uuid', tenantId, `${schema}_remapped`);
            remapped.resolve(); await release.promise;
        }, { timeout: 15000 });
        await remapped.promise;
        onOwnerQuery = async (phase, q) => {
            if (phase === 'before') { pid = (await q('SELECT pg_backend_pid() AS pid'))[0].pid; reading.resolve(); }
        };
        const finalizing = controls.finishApprovalResume(claim, { error: 'late_result' });
        try { await reading.promise; await waitBlocked(pid); } finally { release.resolve(); }
        await remapping;
        expect(await finalizing).toMatchObject({ state: 'in_progress', result: { error: 'approval_tenant_unavailable' } });
        onOwnerQuery = undefined;
        expect(statements.some(sql => sql.includes('FROM customer_memory_erasure'))).toBe(false);
        expect((await query('SELECT resume_state,resume_lease_token FROM tool_approval_tickets'))[0])
            .toEqual({ resume_state: 'processing', resume_lease_token: leaseToken });
    }, 20000);
    it('holds the verified mapping through finalization so a concurrent remap waits for commit', async () => {
        const guarded = deferred(), release = deferred(), writing = deferred();
        let pid = 0;
        onOwnerQuery = async phase => { if (phase === 'after') { guarded.resolve(); await release.promise; } };
        const finalizing = controls.finishApprovalResume(claim, { error: 'owned_failure' });
        await guarded.promise;
        const remapping = client.$transaction(async tx => {
            pid = ((await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid')) as any[])[0].pid;
            writing.resolve();
            await tx.$executeRawUnsafe('UPDATE public.tenants SET schema_name=$2 WHERE id=$1::uuid', tenantId, `${schema}_remapped`);
        }, { timeout: 15000 });
        try { await writing.promise; await waitBlocked(pid); } finally { release.resolve(); }
        expect(await finalizing).toMatchObject({ state: 'pending', result: { error: 'owned_failure' } });
        await remapping;
        onOwnerQuery = undefined;
        expect((await query('SELECT resume_state,resume_lease_token,resume_error FROM tool_approval_tickets'))[0])
            .toEqual({ resume_state: 'failed', resume_lease_token: null, resume_error: 'owned_failure' });
    }, 20000);
    it('permits cleanup of an inactive owner whose tenant/schema mapping remains exact', async () => {
        await client.$executeRawUnsafe('UPDATE public.tenants SET is_active=false WHERE id=$1::uuid', tenantId);
        expect(await controls.finishApprovalResume(claim, { error: 'approval_tenant_unavailable' }))
            .toMatchObject({ state: 'pending', result: { error: 'approval_tenant_unavailable' } });
        expect((await query('SELECT resume_state,resume_lease_token FROM tool_approval_tickets'))[0])
            .toEqual({ resume_state: 'failed', resume_lease_token: null });
    });
});
