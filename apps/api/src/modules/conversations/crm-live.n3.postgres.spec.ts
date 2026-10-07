import { createHash, randomUUID } from 'crypto';
import { OpportunitiesRepository } from '../crm/repositories/opportunities.repository';
import { PipelineService } from '../pipeline/pipeline.service';
import { PoliciesService } from '../policies/policies.service';
import { CRM_BASE_TABLES, N3_DATABASE_URL, openLive, seedCustomer } from './__fixtures__/n3-live-harness';

/**
 * N3 · CRM — through the live executor and the central control.
 *
 *   CORE-CRM-04  move_crm_opportunity_stage needs a human approval ticket AND
 *                ownership; a stale approval does not move anything.
 *   CORE-CRM-05  record_contact_consent binds the consent to the policy the
 *                SERVER holds (version, text hash), once.
 *
 * Oracles: opportunities.stage / won_at, stage_history, tool_approval_tickets,
 * tool_execution_ledger, consent_records.
 */
(N3_DATABASE_URL ? describe : describe.skip)('N3 CRM: human approval, ownership, policy-bound consent', () => {
    jest.setTimeout(120_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let scope: any, approver: string;

    beforeAll(async () => {
        const holder: { h?: any } = {};
        const pipeline = new PipelineService(new Proxy({}, { get: (_t, k) => holder.h.prisma[k as any] }) as any,
            new Proxy({}, { get: (_t, k) => holder.h.redis[k as any] }) as any, { emit: () => undefined } as any, {} as any, {} as any);
        const opportunities = new OpportunitiesRepository(new Proxy({}, { get: (_t, k) => holder.h.prisma[k as any] }) as any,
            new Proxy({}, { get: (_t, k) => holder.h.redis[k as any] }) as any, pipeline);
        const policies = new PoliciesService(new Proxy({}, { get: (_t, k) => holder.h.prisma[k as any] }) as any,
            new Proxy({}, { get: (_t, k) => holder.h.redis[k as any] }) as any,
            { getSchemaName: async () => holder.h.schema } as any, undefined);
        h = await openLive({
            prefix: 'n3crm',
            tables: [...CRM_BASE_TABLES, 'deals', 'stage_history', 'stage_transitions', 'consent_records', 'policies',
                'opt_out_records', 'tasks', 'tool_execution_ledger', 'tool_approval_tickets', 'tool_approval_outbox',
                'commitment_proposals', 'operational_notice_outbox'],
            executorDeps: { opportunitiesRepository: opportunities, policiesService: policies },
        });
        holder.h = h;
        scope = await h.seedAgent();
        approver = await h.seedStaff('Supervisora', 'tenant_supervisor');
        const stages: Array<[string, string, number, boolean, string | null]> = [
            ['Nuevo', 'nuevo', 0, false, null], ['Negociación', 'negociacion', 1, false, null],
            ['Ganado', 'ganado', 2, true, 'won'], ['Perdido', 'perdido', 3, true, 'lost'],
        ];
        for (const [name, slug, position, terminal, outcome] of stages) {
            await h.q(`INSERT INTO pipeline_stages(tenant_id,name,slug,position,is_terminal,terminal_outcome)
                VALUES($1::uuid,$2,$3,$4,$5,$6)`, [h.tenantId, name, slug, position, terminal, outcome]);
        }
    });
    afterAll(async () => { if (h) await h.close(); });
    beforeEach(async () => {
        await h.q('TRUNCATE tool_execution_ledger,tool_approval_tickets,tool_approval_outbox,messages,consent_records,stage_history,policies CASCADE');
    });

    const withOpportunity = async (name: string) => {
        const C = await seedCustomer(h.q, name);
        const leadId = randomUUID(), opportunityId = randomUUID();
        await h.q(`INSERT INTO leads(id,contact_id,phone,first_name,stage) VALUES($1::uuid,$2::uuid,$3,$4,'nuevo')`,
            [leadId, C.contactId, `+57300${Math.floor(1000000 + Math.random() * 8999999)}`, name]);
        await h.q(`INSERT INTO opportunities(id,lead_id,stage) VALUES($1::uuid,$2::uuid,'nuevo')`, [opportunityId, leadId]);
        return { ...C, leadId, opportunityId };
    };
    const stageOf = async (id: string) =>
        (await h.q<any[]>('SELECT stage,won_at IS NOT NULL AS won FROM opportunities WHERE id=$1::uuid', [id]))[0];
    const tickets = () => h.q<any[]>('SELECT id,status,contact_id FROM tool_approval_tickets ORDER BY created_at');
    const move = (C: any, opportunityId: string, targetStage = 'won') => h.call(C.contactId, C.conversationId,
        'move_crm_opportunity_stage', { opportunityId, targetStage, reason: 'El cliente aceptó la propuesta' }, scope);
    const decide = (ticketId: string, decision: 'approved' | 'rejected' = 'approved') => h.control.decideApprovalTicket(
        { tenantId: h.tenantId, ticketId, actorId: approver, decision });

    // ── CORE-CRM-04 ──────────────────────────────────────────────────────────
    it('CORE-CRM-04: nothing moves without a human approval; one approval moves it exactly once', async () => {
        const A = await withOpportunity('Alicia');
        await h.inbound(A.conversationId, 'ya quedamos de acuerdo, ciérrenlo por favor');

        const first = await move(A, A.opportunityId);
        expect(first).toMatchObject({ error: 'approval_required' });
        expect(await stageOf(A.opportunityId)).toEqual({ stage: 'nuevo', won: false });
        const pending = await tickets();
        expect(pending).toHaveLength(1);
        expect(pending[0]).toMatchObject({ status: 'pending', contact_id: A.contactId });

        // Asking again changes nothing and does not open a second ticket.
        expect(await move(A, A.opportunityId)).toMatchObject({ error: 'approval_required' });
        expect(await tickets()).toHaveLength(1);
        expect(await stageOf(A.opportunityId)).toEqual({ stage: 'nuevo', won: false });

        // A person approves; the next call executes, once.
        await decide(pending[0].id);
        const moved = await move(A, A.opportunityId);
        expect(moved).toMatchObject({ success: true, opportunityId: A.opportunityId, stage: 'ganado' });
        expect(await stageOf(A.opportunityId)).toEqual({ stage: 'ganado', won: true });
        const history = await h.q<any[]>('SELECT from_stage,to_stage,triggered_by FROM stage_history WHERE opportunity_id=$1::uuid', [A.opportunityId]);
        expect(history).toEqual([{ from_stage: 'nuevo', to_stage: 'ganado', triggered_by: 'agent' }]);

        const replay = await move(A, A.opportunityId);
        expect(replay).toMatchObject({ success: true });
        expect((await h.q<any[]>('SELECT COUNT(*)::int AS n FROM stage_history WHERE opportunity_id=$1::uuid', [A.opportunityId]))[0].n).toBe(1);
    });

    it('CORE-CRM-04: a rejected ticket never moves the stage', async () => {
        const A = await withOpportunity('Beto');
        await h.inbound(A.conversationId, 'ciérrenlo');
        expect(await move(A, A.opportunityId)).toMatchObject({ error: 'approval_required' });
        const [ticket] = await tickets();
        await decide(ticket.id, 'rejected');
        expect(await move(A, A.opportunityId)).toMatchObject({ error: expect.stringMatching(/rejected/) });
        expect(await stageOf(A.opportunityId)).toEqual({ stage: 'nuevo', won: false });
    });

    it('CORE-CRM-04: an approval is void if the customer wrote again before the person decided', async () => {
        const A = await withOpportunity('Carla');
        await h.inbound(A.conversationId, 'ciérrenlo');
        expect(await move(A, A.opportunityId)).toMatchObject({ error: 'approval_required' });
        const [ticket] = await tickets();
        await h.inbound(A.conversationId, 'espera, mejor no lo cierres todavía');
        await decide(ticket.id).catch(() => undefined);
        const result = await move(A, A.opportunityId);
        expect(result.success).not.toBe(true);
        expect(await stageOf(A.opportunityId)).toEqual({ stage: 'nuevo', won: false });
        expect((await tickets())[0].status).not.toBe('approved');
    });

    it('CORE-CRM-04: another customer\'s opportunity is never moved, even with an approved ticket', async () => {
        const A = await withOpportunity('Alicia');
        const B = await withOpportunity('Intruso');
        await h.inbound(B.conversationId, 'cierren la oportunidad de mi vecina');
        const attempt = await move(B, A.opportunityId);
        expect(attempt.success).not.toBe(true);
        for (const ticket of await tickets()) if (ticket.status === 'pending') await decide(ticket.id);
        const afterApproval = await move(B, A.opportunityId);
        expect(afterApproval).toMatchObject({ error: 'opportunity_not_owned' });
        expect(await stageOf(A.opportunityId)).toEqual({ stage: 'nuevo', won: false });
        expect((await h.q<any[]>('SELECT COUNT(*)::int AS n FROM stage_history'))[0].n).toBe(0);
    });

    // ── CORE-CRM-05 ──────────────────────────────────────────────────────────
    const consentArgs = { policyType: 'privacy', scope: 'marketing', policyVersion: 99, legalTextHash: 'forged-hash' };
    const publish = async (version: number, content: string) => {
        await h.q("UPDATE policies SET is_active=false WHERE type='privacy'");
        await h.q(`INSERT INTO policies(type,title,content,version,is_active) VALUES('privacy','Política de privacidad',$1,$2,true)`, [content, version]);
    };
    const consents = () => h.q<any[]>(`SELECT policy_version,legal_text_hash,consent_scope,execution_ledger_id,capture_mode,contact_id
        FROM consent_records ORDER BY created_at`);
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    const consent = (C: any, args: any = consentArgs) => h.call(C.contactId, C.conversationId, 'record_contact_consent', args, scope);

    it('CORE-CRM-05: without an active policy there is nothing to accept', async () => {
        const C = await withOpportunity('Dora');
        await h.inbound(C.conversationId, 'acepto la política');
        expect(await consent(C)).toMatchObject({ error: 'policy_not_configured' });
        expect(await consents()).toEqual([]);
    });

    it('CORE-CRM-05: the consent is bound to the server policy, recorded once, and ignores what the model sent', async () => {
        await publish(3, 'Texto legal de la política v3');
        const C = await withOpportunity('Dora');
        await h.inbound(C.conversationId, 'acepto la política de privacidad');

        const challenge = await consent(C);
        expect(challenge).toMatchObject({ error: 'confirmation_required', policy: { type: 'privacy', version: 3 } });
        expect(challenge.policy.version).not.toBe(99);
        expect(await consents()).toEqual([]);

        await h.inbound(C.conversationId, 'sí, confirmo');
        const done = await consent(C);
        expect(done).toMatchObject({ success: true, recorded: true });
        const rows = await consents();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            policy_version: 3, legal_text_hash: sha('Texto legal de la política v3'), consent_scope: 'marketing',
            capture_mode: 'signed_conversation_confirmation', contact_id: C.contactId,
        });
        expect(rows[0].execution_ledger_id).toEqual(expect.any(String));
        expect(rows[0].legal_text_hash).not.toBe('forged-hash');

        const replay = await consent(C);
        expect(replay).toMatchObject({ success: true, consentId: done.consentId });
        expect(await consents()).toHaveLength(1);
    });

    it('CORE-CRM-05: a policy republished between the question and the yes needs a new yes', async () => {
        await publish(3, 'Texto legal de la política v3');
        const C = await withOpportunity('Elena');
        await h.inbound(C.conversationId, 'acepto la política');
        expect(await consent(C)).toMatchObject({ error: 'confirmation_required', policy: { version: 3 } });

        await publish(4, 'Texto legal de la política v4, con cambios');
        await h.inbound(C.conversationId, 'sí, confirmo');
        const reviewed = await consent(C);
        expect(reviewed).toMatchObject({ error: 'confirmation_required', policy: { version: 4 } });
        expect(await consents()).toEqual([]);

        await h.inbound(C.conversationId, 'sí, confirmo');
        expect(await consent(C)).toMatchObject({ success: true, recorded: true });
        const rows = await consents();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ policy_version: 4, legal_text_hash: sha('Texto legal de la política v4, con cambios') });
    });

    it('CORE-CRM-05: a "no" records nothing', async () => {
        await publish(3, 'Texto legal de la política v3');
        const C = await withOpportunity('Fabio');
        await h.inbound(C.conversationId, 'acepto la política');
        expect(await consent(C)).toMatchObject({ error: 'confirmation_required' });
        await h.inbound(C.conversationId, 'no');
        expect(await consent(C)).toMatchObject({ error: 'action_rejected' });
        expect(await consents()).toEqual([]);
    });
});
