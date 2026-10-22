import { auditTurnClaim } from '../../common/utils/outcome-claim.util';
import { agentTurnFixture } from './__fixtures__/agent-turn.fixture';
async function guarded(user: string, reply: string, executed: any[], prior: any[] = []) {
    const f = agentTurnFixture();
    const session = { trace: { steps: [] as Array<{ signal: string }> } };
    f.llmRouter.execute.mockResolvedValue({ content: reply, model: 'synthetic', usage: {}, cost: 0 });
    const output = await (f.runtime as any).applyOutputGuardrails(reply, '<persona>Atiende con claridad.</persona>',
        [{ role: 'user', content: user }], ['tier_1'], 'tenant', 'conversation', executed, 'es', prior, {}, session, f.llmRouter);
    expect(f.toolExecutor.execute).not.toHaveBeenCalled();
    expect(f.eventEmitter.emit).not.toHaveBeenCalled();
    expect(f.outboundQueue.enqueue).not.toHaveBeenCalled();
    return { output, f };
}
describe('Configured CRM operation completion and creation semantics', () => {
    it('CRMOPS_A_01 a failed follow-up cannot be acknowledged as a created task', async () => {
        const reply = 'He creado la tarea de seguimiento en su ficha.';
        const { output } = await guarded('Crea una tarea interna para revisar mi solicitud mañana.', reply,
            [{ name: 'create_follow_up_task', result: { error: 'follow_up_create_failed' } }]);
        expect(output).not.toBe(reply);
    });
    it('CRMOPS_A_02 an unsuccessful opportunity write cannot be acknowledged as created', async () => {
        const reply = 'He creado la oportunidad comercial en su ficha.';
        const { output } = await guarded('Registra una oportunidad para mi solicitud de cotización.', reply,
            [{ name: 'create_crm_opportunity', result: { error: 'opportunity_create_failed' } }]);
        expect(output).not.toBe(reply);
    });
    it('CRMOPS_A_03 an existing lead success does not prove creation of a new lead', async () => {
        const reply = 'He creado un nuevo lead en el CRM.';
        const { output } = await guarded('Revisa si ya tengo ficha comercial y créala si falta.', reply,
            [{ name: 'ensure_crm_lead', result: { success: true, leadId: '11111111-1111-4111-8111-111111111111', created: false } }]);
        expect(output).not.toBe(reply);
    });
    it('CRMOPS_B_01 an A4 approval request cannot be acknowledged as a completed stage transition', async () => {
        const reply = 'He movido la oportunidad a la etapa propuesta en su ficha.';
        const { output } = await guarded('Solicita mover mi oportunidad a propuesta para revisión del equipo.', reply,
            [{ name: 'move_crm_opportunity_stage', result: { error: 'approval_required', shouldHandoff: true } }]);
        expect(output).not.toBe(reply);
    });
    it('CRMOPS_B_02 pending A3 confirmation cannot be acknowledged as recorded consent', async () => {
        const reply = 'He registrado su consentimiento en el CRM.';
        const { output } = await guarded('Revisa el consentimiento pendiente de confirmación en mi ficha.', reply,
            [{ name: 'record_contact_consent', result: { error: 'confirmation_required' } }]);
        expect(output).not.toBe(reply);
    });

});

describe('CRM operation receipt provenance and shape', () => {
    it('CRMOPS_G_01 a historical successful task without current task receipt cannot prove a new task', async () => {
        const reply = 'He creado la tarea de seguimiento en su ficha.';
        const { output } = await guarded('Crea una nueva tarea para esta solicitud.', reply, [], [{ tool: 'create_follow_up_task', ok: true }]);
        expect(output).not.toBe(reply);
    });
    it('CRMOPS_G_02 only complete operation-specific receipts justify each scoped completion', () => {
        const id = '11111111-1111-4111-8111-111111111111';
        const cases = [
            { name: 'ensure_crm_lead', reply: 'He creado un nuevo lead en el CRM.', result: { success: true, leadId: id, created: true } },
            { name: 'create_crm_opportunity', reply: 'He creado la oportunidad comercial en su ficha.', result: { success: true, opportunityId: id, created: true } },
            { name: 'create_follow_up_task', reply: 'He creado la tarea de seguimiento en su ficha.', result: { success: true, taskId: id, created: true } },
            { name: 'move_crm_opportunity_stage', reply: 'He movido la oportunidad a propuesta en su ficha.', result: { success: true, opportunityId: id, stage: 'propuesta' } },
            { name: 'record_contact_consent', reply: 'He registrado su consentimiento en el CRM.', result: { success: true, consentId: id, recorded: true } },
        ];
        for (const row of cases) {
            expect(auditTurnClaim(row.reply, [{ name: row.name, result: row.result }], {}).falseClaim).toBe(false);
            expect(auditTurnClaim(row.reply, [{ name: row.name, result: { success: true } }], {}).falseClaim).toBe(true);
            expect(auditTurnClaim(row.reply, [{ name: row.name, result: { ...row.result, created: false, recorded: false, error: 'not_completed' } }], {}).falseClaim).toBe(true);
        }
    });
});
