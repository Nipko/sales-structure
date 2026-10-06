import { randomUUID } from 'crypto';
import { AgentConsoleService } from '../agent-console/agent-console.service';
import { LeadsRepository } from '../crm/repositories/leads.repository';
import { OpportunitiesRepository } from '../crm/repositories/opportunities.repository';
import { TasksService } from '../crm/services/tasks/tasks.service';
import { IdentityService } from '../identity/identity.service';
import { DEFAULT_PIPELINE_STAGES, PipelineService } from '../pipeline/pipeline.service';
import { CRM_BASE_TABLES, N3_DATABASE_URL, openLive, seedCustomer } from './__fixtures__/n3-live-harness';

/**
 * N3 · CRM and leads on real PostgreSQL: identity merge, stage auto-advance,
 * conversation assignment, and the three additive CRM tools.
 *
 * Real: IdentityService, PipelineService, LeadsRepository, OpportunitiesRepository,
 * TasksService, AgentConsoleService (assignment), executor, central control.
 * Simulated: Redis (no cache), event emitter, phone region resolver, outbound channels.
 */
(N3_DATABASE_URL ? describe : describe.skip)('N3 CRM: identity, pipeline, assignment, additive tools', () => {
    jest.setTimeout(180_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let scope: any, pipeline: PipelineService, identity: IdentityService, pipelineWithAutoOff: PipelineService, leadsRepo: LeadsRepository;
    const noCache = { get: async () => null, set: async () => undefined, del: async () => undefined };
    const events = { emit: jest.fn() };

    beforeAll(async () => {
        const holder: { prisma?: any } = {};
        const proxy = new Proxy({}, { get: (_t, key) => holder.prisma[key as any] });
        const regional = { phoneRegionFor: async () => 'CO' };
        pipeline = new PipelineService(proxy as any, noCache as any, events as any, {} as any, {} as any);
        pipelineWithAutoOff = new PipelineService(proxy as any, { ...noCache, get: async (k: string) => (k.startsWith('pipeline:autoprogress') ? '0' : null) } as any,
            events as any, {} as any, {} as any);
        identity = new IdentityService(proxy as any, noCache as any, regional as any);
        const leads = leadsRepo = new LeadsRepository(proxy as any, noCache as any, pipeline, regional as any);
        const opportunities = new OpportunitiesRepository(proxy as any, noCache as any, pipeline);
        const tasks = new TasksService(proxy as any, noCache as any);
        h = await openLive({
            prefix: 'n3crm', workarounds: { commitmentDdl: true },
            executorDeps: { leadsRepository: leads, opportunitiesRepository: opportunities, tasksService: tasks },
            tables: [...CRM_BASE_TABLES, 'deals', 'stage_history', 'stage_transitions', 'notes', 'tags', 'lead_tags', 'tasks',
                'merge_suggestions', 'conversation_assignments', 'tool_execution_ledger', 'tool_approval_tickets',
                'tool_approval_outbox', 'commitment_proposals', 'operational_notice_outbox'],
        });
        holder.prisma = h.prisma;
        scope = await h.seedAgent();
    });
    afterAll(async () => { if (h) await h.close(); });

    const seedStages = async () => {
        await h.q('TRUNCATE pipeline_stages,pipelines CASCADE');
        const pipelineId = randomUUID();
        await h.q(`INSERT INTO pipelines(id,tenant_id,name,is_default,is_active) VALUES($1::uuid,$2::uuid,'Ventas',true,true)`, [pipelineId, h.tenantId]);
        for (const s of DEFAULT_PIPELINE_STAGES) {
            await h.q(`INSERT INTO pipeline_stages(tenant_id,pipeline_id,name,slug,position,sla_hours,is_terminal,terminal_outcome,default_probability)
                VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9)`,
            [h.tenantId, pipelineId, s.name, s.slug, s.position, s.sla_hours, s.is_terminal, s.terminal_outcome, s.default_probability]);
        }
    };
    const contact = async (channel: string, ext: string, extra: { phone?: string | null; email?: string | null; name?: string } = {}) => {
        const id = randomUUID();
        await h.q(`INSERT INTO contacts(id,external_id,channel_type,name,phone,email) VALUES($1::uuid,$2,$3,$4,$5,$6)`,
            [id, ext, channel, extra.name ?? ext, extra.phone ?? null, extra.email ?? null]);
        return id;
    };
    const resolve = (id: string, channel: string, ext: string, extra: { phone?: string; email?: string; name?: string; allowPhoneAutoLink?: boolean } = {}) =>
        identity.resolveOrCreateProfile(h.tenantId, { id, channelType: channel, externalId: ext, ...extra });
    const count = async (table: string) => Number((await h.q<any[]>(`SELECT COUNT(*)::int AS n FROM ${table}`))[0].n);

    // ── Identity merge ─────────────────────────────────────────────────────
    describe('contact identity: two channels, one person', () => {
        beforeEach(async () => {
            await h.q('TRUNCATE merge_suggestions,contact_identities,customer_profiles,contacts CASCADE');
        });

        it('ID-01: the same phone typed two ways on two channels resolves to ONE profile with two identities', async () => {
            const wa = await contact('whatsapp', '573001234567', { phone: '+573001234567' });
            const tg = await contact('telegram', 'tg-1', { phone: '300 123 4567' });
            await resolve(wa, 'whatsapp', '573001234567', { phone: '+573001234567', name: 'Ana' });
            await resolve(tg, 'telegram', 'tg-1', { phone: '300 123 4567', name: 'Ana T' });
            expect(await count('customer_profiles')).toBe(1);
            const rows = await h.q<any[]>('SELECT contact_id::text AS c, customer_profile_id::text AS p, is_primary FROM contact_identities ORDER BY is_primary DESC');
            expect(rows).toHaveLength(2);
            expect(new Set(rows.map(r => r.p)).size).toBe(1);
            expect(rows.filter(r => r.is_primary)).toHaveLength(1);
            expect(await count('merge_suggestions')).toBe(0);
        });

        it('ID-02: two different people (different phone, no e-mail) are never joined', async () => {
            const a = await contact('whatsapp', '1', { phone: '+573001111111' });
            const b = await contact('telegram', '2', { phone: '+573002222222' });
            await resolve(a, 'whatsapp', '1', { phone: '+573001111111' });
            await resolve(b, 'telegram', '2', { phone: '+573002222222' });
            expect(await count('customer_profiles')).toBe(2);
            expect(await count('merge_suggestions')).toBe(0);
        });

        it('ID-03: an e-mail-only match is not merged silently: it becomes a pending suggestion, and approving it merges once', async () => {
            const a = await contact('whatsapp', '1', { phone: '+573001111111', email: 'Ana@Example.Invalid' });
            const b = await contact('telegram', '2', { phone: '+573002222222', email: 'ana@example.invalid' });
            await resolve(a, 'whatsapp', '1', { phone: '+573001111111', email: 'Ana@Example.Invalid' });
            await resolve(b, 'telegram', '2', { phone: '+573002222222', email: 'ana@example.invalid' });
            expect(await count('customer_profiles')).toBe(2);
            const suggestions = await h.q<any[]>(`SELECT id::text AS id, match_type, status FROM merge_suggestions`);
            expect(suggestions).toEqual([expect.objectContaining({ match_type: 'email_match', status: 'pending' })]);
            const reviewer = randomUUID();
            await identity.approveMerge(h.tenantId, suggestions[0].id, reviewer);
            expect(await count('customer_profiles')).toBe(1);
            expect(new Set((await h.q<any[]>('SELECT customer_profile_id::text AS p FROM contact_identities')).map(r => r.p)).size).toBe(1);
            expect((await h.q<any[]>('SELECT status FROM merge_suggestions'))[0].status).toBe('approved');
            await expect(identity.approveMerge(h.tenantId, suggestions[0].id, reviewer)).rejects.toThrow(/not found|already/i);
            expect(await count('customer_profiles')).toBe(1);
        });

        it('ID-04: a phone shared by two existing profiles is ambiguous: no auto-link', async () => {
            const a = await contact('whatsapp', '1', { phone: '+573003333333' });
            const b = await contact('web', '2', { phone: '+573003333333' });
            await h.q(`INSERT INTO customer_profiles(display_name,phone) VALUES('P1','+573003333333'),('P2','+573003333333')`);
            await resolve(a, 'whatsapp', '1', { phone: '+573003333333' });
            expect(await count('contact_identities')).toBe(1);
            expect(await count('customer_profiles')).toBe(3);
            expect((await h.q<any[]>('SELECT is_primary FROM contact_identities'))[0].is_primary).toBe(true);
            void b;
        });

        it('ID-05: a caller that cannot prove the phone is shared (allowPhoneAutoLink=false) never links by phone', async () => {
            const a = await contact('whatsapp', '1', { phone: '+573004444444' });
            const b = await contact('web', '2', { phone: '+573004444444' });
            await resolve(a, 'whatsapp', '1', { phone: '+573004444444' });
            await resolve(b, 'web', '2', { phone: '+573004444444', allowPhoneAutoLink: false });
            expect(await count('customer_profiles')).toBe(2);
            expect(await h.q('SELECT match_type,status FROM merge_suggestions')).toEqual([{ match_type: 'ambiguous_phone_match', status: 'pending' }]);
        });

        it('ID-06: a contact erased by the right to be forgotten cannot be merged', async () => {
            const a = await contact('whatsapp', '1', { phone: '+573001111111', email: 'x@example.invalid' });
            const b = await contact('telegram', '2', { phone: '+573002222222', email: 'x@example.invalid' });
            await resolve(a, 'whatsapp', '1', { phone: '+573001111111', email: 'x@example.invalid' });
            await resolve(b, 'telegram', '2', { phone: '+573002222222', email: 'x@example.invalid' });
            await h.q('INSERT INTO customer_memory_erasure(contact_id) VALUES($1::uuid)', [b]);
            const [suggestion] = await h.q<any[]>('SELECT id::text AS id FROM merge_suggestions');
            await expect(identity.approveMerge(h.tenantId, suggestion.id, randomUUID())).rejects.toThrow(/erased/i);
            expect(await count('customer_profiles')).toBe(2);
        });

    });

    // ── Pipeline auto-advance ──────────────────────────────────────────────
    describe('pipeline auto-advance from the conversation', () => {
        let C: { contactId: string; conversationId: string };
        let leadId: string, oppId: string;
        beforeEach(async () => {
            await h.q('TRUNCATE opportunities,leads,stage_history,deals,conversations,contacts CASCADE');
            await seedStages();
            C = await seedCustomer(h.q, 'Prospecto', { phone: '+573005550000' });
        });
        const seedOpportunity = async (stage: string) => {
            leadId = randomUUID(); oppId = randomUUID();
            await h.q(`INSERT INTO leads(id,contact_id,phone,stage) VALUES($1::uuid,$2::uuid,'+573005550000',$3)`, [leadId, C.contactId, stage]);
            await h.q(`INSERT INTO opportunities(id,lead_id,conversation_id,stage) VALUES($1::uuid,$2::uuid,$3::uuid,$4)`, [oppId, leadId, C.conversationId, stage]);
        };
        const stages = async () => ({
            opp: (await h.q<any[]>('SELECT stage FROM opportunities WHERE id=$1::uuid', [oppId]))[0].stage,
            lead: (await h.q<any[]>('SELECT stage FROM leads WHERE id=$1::uuid', [leadId]))[0].stage,
        });
        const signal = (text: string, extra: Record<string, any> = {}, service = pipeline) =>
            service.autoProgressFromConversation(h.tenantId, C.conversationId, { messageText: text, lang: 'es', ...extra });

        it.each([
            ['an explicit purchase', 'quiero comprar el plan anual', {}, 'listo_para_cierre'],
            ['a price question', 'cuanto cuesta el servicio?', {}, 'calificado'],
            ['the first AI answer', 'hola', { isFirstAiResponse: true }, 'contactado'],
        ])('PIPE-01: %s moves the opportunity and its lead together', async (_label, text, extra, expected) => {
            await seedOpportunity('nuevo');
            await signal(text, extra);
            expect(await stages()).toEqual({ opp: expected, lead: expected });
        });

        it('PIPE-02: it never moves a deal backwards', async () => {
            await seedOpportunity('caliente');
            await signal('hola', { isFirstAiResponse: true });
            await signal('cuanto cuesta?');
            expect(await stages()).toEqual({ opp: 'caliente', lead: 'caliente' });
        });

        it('PIPE-03: it leaves a closed deal alone, even when the purchase target sits further along the board', async () => {
            // A custom board where the closed stage sits BEFORE the purchase target: only the terminal guard can stop the move.
            await h.q(`UPDATE pipeline_stages SET position = -1 WHERE slug = 'ganado'`);
            await seedOpportunity('ganado');
            await signal('quiero comprar otra vez');
            expect((await stages()).opp).toBe('ganado');
        });

        it('PIPE-04: the per-tenant switch turns advancement off', async () => {
            await seedOpportunity('nuevo');
            await signal('quiero comprar el plan anual', {}, pipelineWithAutoOff);
            expect(await stages()).toEqual({ opp: 'nuevo', lead: 'nuevo' });
        });

        it.each([
            ['no quiero comprar nada, solo estaba mirando'],
            ['todavia no voy a pagar, no confirmo'],
        ])('PIPE-05: a refusal (%s) does not move the deal to "ready to close"', async text => {
            await seedOpportunity('nuevo');
            await signal(text);
            const after = await stages();
            // eslint-disable-next-line no-console
            console.log(`[PIPE-05] message=${JSON.stringify(text)} -> stage=${after.opp}`);
            expect(after.opp).not.toBe('listo_para_cierre');
        });
    });

    // ── Conversation assignment ────────────────────────────────────────────
    describe('conversation assignment', () => {
        let console_: AgentConsoleService;
        beforeAll(() => {
            const prismaWithUsers = new Proxy(h.prisma, { get: (t, key) => (key === 'user' ? (h.client as any).user : (t as any)[key]) });
            console_ = new (AgentConsoleService as any)(prismaWithUsers, { ...noCache, get: async () => h.schema }, {}, {}, {}, events, {});
        });
        beforeEach(async () => { await h.q('TRUNCATE conversation_assignments,conversations,contacts CASCADE'); });
        const openAssignments = async (conversationId: string) =>
            h.q<any[]>('SELECT agent_id::text AS agent FROM conversation_assignments WHERE conversation_id=$1::uuid AND resolved_at IS NULL', [conversationId]);

        it('ASG-01: assigning moves the conversation to a human and leaves exactly one open assignment; reassigning closes the old one', async () => {
            const C = await seedCustomer(h.q, 'Cliente');
            const first = await h.seedStaff('Uno'), second = await h.seedStaff('Dos');
            await console_.assignConversation(h.tenantId, C.conversationId, first);
            await console_.assignConversation(h.tenantId, C.conversationId, second);
            const conv = (await h.q<any[]>('SELECT assigned_to, status FROM conversations WHERE id=$1::uuid', [C.conversationId]))[0];
            expect(conv).toEqual({ assigned_to: second, status: 'with_human' });
            expect(await openAssignments(C.conversationId)).toEqual([{ agent: second }]);
            expect(await count('conversation_assignments')).toBe(2);
        });

        it('ASG-02: an inactive user, a customer-role user, a foreign-tenant user and a non-UUID are refused and nothing changes', async () => {
            const C = await seedCustomer(h.q, 'Cliente');
            const inactive = await h.seedStaff('Baja');
            await h.client.$executeRawUnsafe('UPDATE public.users SET is_active=false WHERE id=$1::uuid', inactive);
            const wrongRole = await h.seedStaff('Rol', 'tenant_viewer');
            const foreign = randomUUID();
            await h.client.$executeRawUnsafe(
                `INSERT INTO public.users(id,tenant_id,email,is_active,role,first_name,last_name) VALUES($1::uuid,$2::uuid,$3,true,'tenant_agent','Ajeno','X')`,
                foreign, randomUUID(), `ajeno-${foreign}@example.invalid`);
            for (const target of [inactive, wrongRole, foreign, 'not-a-uuid']) {
                await expect(console_.assignConversation(h.tenantId, C.conversationId, target)).rejects.toThrow(/not an active member/i);
            }
            expect((await h.q<any[]>('SELECT assigned_to, status FROM conversations WHERE id=$1::uuid', [C.conversationId]))[0].assigned_to).toBeNull();
            expect(await count('conversation_assignments')).toBe(0);
        });

        it('ASG-03: two agents claiming the same unassigned conversation: only the first wins', async () => {
            const C = await seedCustomer(h.q, 'Cliente');
            const a = await h.seedStaff('A'), b = await h.seedStaff('B');
            const results = await Promise.allSettled([
                console_.claimConversation(h.tenantId, C.conversationId, a),
                console_.claimConversation(h.tenantId, C.conversationId, b),
            ]);
            expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
            const owner = (await h.q<any[]>('SELECT assigned_to FROM conversations WHERE id=$1::uuid', [C.conversationId]))[0].assigned_to;
            expect([a, b]).toContain(owner);
            expect(await openAssignments(C.conversationId)).toEqual([{ agent: owner }]);
        });
    });

    // ── Additive CRM tools ─────────────────────────────────────────────────
    describe('agent CRM tools are additive and never cross customers', () => {
        beforeEach(async () => {
            await h.q('TRUNCATE tasks,notes,lead_tags,tags,opportunities,leads,tool_execution_ledger,messages,conversations,contacts CASCADE');
            await seedStages();
        });
        const lead = async (C: { contactId: string }, extra: { primary?: string | null; secondary?: string | null } = {}) => {
            const id = randomUUID();
            await h.q(`INSERT INTO leads(id,contact_id,phone,stage,primary_intent,secondary_intent) VALUES($1::uuid,$2::uuid,'+573005550000','nuevo',$3,$4)`,
                [id, C.contactId, extra.primary ?? null, extra.secondary ?? null]);
            return id;
        };
        // Each call is its own turn: a fresh inbound message, so the central ledger never replays a previous answer.
        const call = async (C: { contactId: string; conversationId: string }, tool: string, args: any) => {
            await h.inbound(C.conversationId, 'mensaje del cliente');
            return h.call(C.contactId, C.conversationId, tool, args, scope);
        };

        it('CRM-02: a note on a customer with no lead is refused and creates no lead', async () => {
            const C = await seedCustomer(h.q, 'Sin lead');
            expect(await call(C, 'add_contact_note', { note: 'Pidio cotizacion' })).toMatchObject({ error: 'no_lead' });
            expect(await count('leads')).toBe(0);
            expect(await count('notes')).toBe(0);
        });

        it('CRM-02: a note lands on the customer\'s own lead only, authored by the agent, with the text bounded', async () => {
            const A = await seedCustomer(h.q, 'A'), B = await seedCustomer(h.q, 'B');
            const leadA = await lead(A), leadB = await lead(B);
            expect(await call(A, 'add_contact_note', { note: 'Prefiere llamadas por la tarde' })).toMatchObject({ success: true });
            expect(await call(A, 'add_contact_note', { note: 'ab' })).toMatchObject({ error: 'invalid_note' });
            expect(await call(A, 'add_contact_note', { note: 'x'.repeat(1001) })).toMatchObject({ error: 'invalid_note' });
            expect(await h.q('SELECT lead_id::text AS lead_id, created_by, content FROM notes')).toEqual([
                { lead_id: leadA, created_by: 'agent', content: 'Prefiere llamadas por la tarde' }]);
            expect(await h.q('SELECT id FROM notes WHERE lead_id=$1::uuid', [leadB])).toEqual([]);
        });

        it('CRM-02: a tag the business never created is refused and not invented; a known one is attached once, case-insensitively', async () => {
            const C = await seedCustomer(h.q, 'A'); const leadId = await lead(C);
            await h.q(`INSERT INTO tags(name) VALUES('VIP')`);
            expect(await call(C, 'tag_contact', { tag: 'Mayorista' })).toMatchObject({ error: 'unknown_tag' });
            expect(await count('tags')).toBe(1);
            expect(await call(C, 'tag_contact', { tag: 'vip' })).toMatchObject({ success: true });
            expect(await call(C, 'tag_contact', { tag: 'VIP' })).toMatchObject({ success: true });
            expect(await h.q('SELECT lead_id::text AS lead_id FROM lead_tags')).toEqual([{ lead_id: leadId }]);
        });

        it('CRM-02: an interest fills the empty primary slot, then the secondary, and never overwrites what a person classified', async () => {
            const C = await seedCustomer(h.q, 'A'); const leadId = await lead(C);
            const read = async () => (await h.q<any[]>('SELECT primary_intent,secondary_intent FROM leads WHERE id=$1::uuid', [leadId]))[0];
            await call(C, 'record_contact_interest', { interest: 'precio' });
            expect(await read()).toEqual({ primary_intent: 'precio', secondary_intent: null });
            await call(C, 'record_contact_interest', { interest: 'PRECIO' });
            expect(await read()).toEqual({ primary_intent: 'precio', secondary_intent: null });
            await call(C, 'record_contact_interest', { interest: 'fecha' });
            expect(await read()).toEqual({ primary_intent: 'precio', secondary_intent: 'fecha' });
            await call(C, 'record_contact_interest', { interest: 'modalidad' });
            expect(await read()).toEqual({ primary_intent: 'precio', secondary_intent: 'fecha' });
        });

        it('CRM-03: ensure_crm_lead creates one lead per customer however many times it is asked', async () => {
            const C = await seedCustomer(h.q, 'A', { phone: '+573006660000' });
            // The second reason differs on purpose: a different argument hash skips the central ledger replay,
            // so it is the CRM writer itself that has to refuse to create a second lead.
            const first = await call(C, 'ensure_crm_lead', { reason: 'Pidio una cotizacion' });
            const second = await call(C, 'ensure_crm_lead', { reason: 'Volvio a escribir por el mismo tema' });
            expect(first).toMatchObject({ success: true, created: true });
            expect(second).toMatchObject({ success: true, created: false, leadId: first.leadId });
            expect(await count('leads')).toBe(1);
        });

        it('CRM-03b: the lead writer itself serialises two simultaneous requests for one customer into ONE lead', async () => {
            const C = await seedCustomer(h.q, 'A', { phone: '+573006660000' });
            const lead = { contact_id: C.contactId, phone: '+573006660000', first_name: 'A', metadata: { source: 'conversational_agent', creation_reason: 'carrera' } } as any;
            const [one, two] = await Promise.all([
                leadsRepo.ensureActiveLeadForContact(h.tenantId, C.contactId, lead),
                leadsRepo.ensureActiveLeadForContact(h.tenantId, C.contactId, lead),
            ]);
            expect(one.lead?.id).toBe(two.lead?.id);
            expect([one.created, two.created].filter(Boolean)).toHaveLength(1);
            expect(await count('leads')).toBe(1);
        });

        it('CRM-03: a customer without a verifiable phone does not get a lead', async () => {
            const C = await seedCustomer(h.q, 'Sin telefono');
            const result = await call(C, 'ensure_crm_lead', { reason: 'Pidio una cotizacion' });
            expect(result).toMatchObject({ error: 'lead_phone_required' });
            expect(await count('leads')).toBe(0);
        });

        it('CRM-03: create_crm_opportunity is idempotent per conversation and title, and refuses to start without a lead', async () => {
            const C = await seedCustomer(h.q, 'A', { phone: '+573006660000' });
            expect(await call(C, 'create_crm_opportunity', { title: 'Plan anual' })).toMatchObject({ error: 'no_lead' });
            await call(C, 'ensure_crm_lead', { reason: 'Pidio una cotizacion' });
            const first = await call(C, 'create_crm_opportunity', { title: 'Plan anual', summary: 'Quiere el anual' });
            const again = await call(C, 'create_crm_opportunity', { title: 'PLAN ANUAL' });
            expect(first).toMatchObject({ success: true, created: true });
            expect(again).toMatchObject({ success: true, created: false, opportunityId: first.opportunityId });
            expect(await count('opportunities')).toBe(1);
        });

        it('CRM-03: create_follow_up_task does not duplicate, needs a future dated time zone, and will not attach to another customer\'s opportunity', async () => {
            const A = await seedCustomer(h.q, 'A', { phone: '+573006660000' }), B = await seedCustomer(h.q, 'B', { phone: '+573007770000' });
            await call(A, 'ensure_crm_lead', { reason: 'Pidio una cotizacion' });
            await call(B, 'ensure_crm_lead', { reason: 'Pidio una cotizacion' });
            const opB = await call(B, 'create_crm_opportunity', { title: 'Plan B' });
            const first = await call(A, 'create_follow_up_task', { title: 'Llamar a A' });
            const again = await call(A, 'create_follow_up_task', { title: 'llamar a a', description: 'Otra redaccion del mismo pendiente' });
            expect(first).toMatchObject({ success: true, created: true });
            expect(again).toMatchObject({ success: true, created: false, taskId: first.taskId });
            expect(await count('tasks')).toBe(1);
            expect(await call(A, 'create_follow_up_task', { title: 'Sin zona', dueAt: '2099-01-01T10:00:00' })).toMatchObject({ error: 'due_timezone_required' });
            expect(await call(A, 'create_follow_up_task', { title: 'En el pasado', dueAt: '2020-01-01T10:00:00Z' })).toMatchObject({ error: 'invalid_due_at' });
            expect(await call(A, 'create_follow_up_task', { title: 'Cruzada', opportunityId: opB.opportunityId })).toMatchObject({ error: 'opportunity_not_owned' });
            expect(await count('tasks')).toBe(1);
        });
    });
});
