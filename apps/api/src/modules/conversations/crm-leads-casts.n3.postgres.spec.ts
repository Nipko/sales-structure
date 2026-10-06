import { randomUUID } from 'crypto';
import { LeadsRepository } from '../crm/repositories/leads.repository';
import { OpportunitiesRepository } from '../crm/repositories/opportunities.repository';
import { TasksService } from '../crm/services/tasks/tasks.service';
import { IdentityService } from '../identity/identity.service';
import { DEFAULT_PIPELINE_STAGES, PipelineService } from '../pipeline/pipeline.service';
import { CRM_BASE_TABLES, N3_DATABASE_URL, openLive, seedCustomer } from './__fixtures__/n3-live-harness';

/**
 * N3 — CRM writers that PostgreSQL used to refuse (fixed with explicit casts; this spec
 * was red until then). Do not relax the assertions.
 *
 *   CRM-03-due  create_follow_up_task with a valid future `dueAt` always fails
 *               (`tasks.due_at` is TIMESTAMP and the INSERT binds `$6` untyped, so Prisma
 *               sends text: 42804). Only a task WITHOUT a due date can be created.
 *   ID-07       IdentityService.manualMerge always fails (`merge_suggestions.reviewed_by` is
 *               UUID and the INSERT binds `$5` untyped: 42804), so "merge these two contacts"
 *               from the dashboard cannot succeed.
 */
(N3_DATABASE_URL ? describe : describe.skip)('N3 DEFECT: CRM writers refused by PostgreSQL', () => {
    jest.setTimeout(120_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let scope: any, identity: IdentityService;
    const noCache = { get: async () => null, set: async () => undefined, del: async () => undefined };

    beforeAll(async () => {
        const holder: { prisma?: any } = {};
        const proxy = new Proxy({}, { get: (_t, key) => holder.prisma[key as any] });
        const regional = { phoneRegionFor: async () => 'CO' };
        const pipeline = new PipelineService(proxy as any, noCache as any, { emit: jest.fn() } as any, {} as any, {} as any);
        identity = new IdentityService(proxy as any, noCache as any, regional as any);
        h = await openLive({
            prefix: 'n3crmd', workarounds: { commitmentDdl: true },
            executorDeps: {
                leadsRepository: new LeadsRepository(proxy as any, noCache as any, pipeline, regional as any),
                opportunitiesRepository: new OpportunitiesRepository(proxy as any, noCache as any, pipeline),
                tasksService: new TasksService(proxy as any, noCache as any),
            },
            tables: [...CRM_BASE_TABLES, 'deals', 'stage_history', 'stage_transitions', 'notes', 'tags', 'lead_tags', 'tasks',
                'merge_suggestions', 'tool_execution_ledger', 'tool_approval_tickets', 'tool_approval_outbox',
                'commitment_proposals', 'operational_notice_outbox'],
        });
        holder.prisma = h.prisma;
        scope = await h.seedAgent();
        const pipelineId = randomUUID();
        await h.q(`INSERT INTO pipelines(id,tenant_id,name,is_default,is_active) VALUES($1::uuid,$2::uuid,'Ventas',true,true)`, [pipelineId, h.tenantId]);
        for (const s of DEFAULT_PIPELINE_STAGES) {
            await h.q(`INSERT INTO pipeline_stages(tenant_id,pipeline_id,name,slug,position,sla_hours,is_terminal,terminal_outcome,default_probability)
                VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9)`,
            [h.tenantId, pipelineId, s.name, s.slug, s.position, s.sla_hours, s.is_terminal, s.terminal_outcome, s.default_probability]);
        }
    });
    afterAll(async () => { if (h) await h.close(); });
    beforeEach(async () => {
        await h.q('TRUNCATE tasks,opportunities,leads,merge_suggestions,contact_identities,customer_profiles,tool_execution_ledger,messages,conversations,contacts CASCADE');
    });

    it('CRM-03-due: create_follow_up_task with a valid future due date creates the task', async () => {
        const A = await seedCustomer(h.q, 'A', { phone: '+573006660000' });
        await h.inbound(A.conversationId, 'llamame manana');
        await h.call(A.contactId, A.conversationId, 'ensure_crm_lead', { reason: 'Pidio una cotizacion' }, scope);
        await h.inbound(A.conversationId, 'llamame pasado manana');
        const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
        const result = await h.call(A.contactId, A.conversationId, 'create_follow_up_task', { title: 'Llamar a A', dueAt: due }, scope);
        // eslint-disable-next-line no-console
        console.log(`[DEFECT-EVIDENCE CRM-03-due] create_follow_up_task(dueAt=${due}) -> ${JSON.stringify(result)} | product log: ${h.logs.filter(l => /follow_up/.test(l)).slice(-1)[0]?.replace(/\s+/g, ' ')} | tasks=${JSON.stringify(await h.q('SELECT title,due_at FROM tasks'))}`);
        expect(result).toMatchObject({ success: true, created: true });
        expect(await h.q('SELECT title FROM tasks')).toEqual([{ title: 'Llamar a A' }]);
    });

    it('ID-07: manualMerge joins two contacts once and a repeat changes nothing', async () => {
        const mk = async (channel: string, ext: string, phone: string) => {
            const id = randomUUID();
            await h.q(`INSERT INTO contacts(id,external_id,channel_type,name,phone) VALUES($1::uuid,$2,$3,$2,$4)`, [id, ext, channel, phone]);
            return id;
        };
        const a = await mk('whatsapp', '1', '+573001111111'), b = await mk('telegram', '2', '+573002222222');
        const user = randomUUID();
        let failure = '';
        try { await identity.manualMerge(h.tenantId, a, b, user); } catch (error: any) { failure = String(error?.message || error).replace(/\s+/g, ' ').slice(0, 260); }
        const profiles = Number((await h.q<any[]>('SELECT COUNT(*)::int AS n FROM customer_profiles'))[0].n);
        // eslint-disable-next-line no-console
        console.log(`[DEFECT-EVIDENCE ID-07] manualMerge(contactA, contactB, userId=uuid) -> ${failure || 'ok'}; customer_profiles=${profiles}`);
        expect(failure).toBe('');
        expect(profiles).toBe(1);
        await identity.manualMerge(h.tenantId, a, b, user);
        expect(Number((await h.q<any[]>('SELECT COUNT(*)::int AS n FROM contact_identities'))[0].n)).toBe(2);
    });
});
