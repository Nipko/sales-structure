import { auditTurnClaim } from '../../common/utils/outcome-claim.util';
import { agentTurnFixture } from './__fixtures__/agent-turn.fixture';
const TAG = 'He agregado la etiqueta QA2510_MESA a su ficha.';
const INTEREST = 'He registrado su interés en su ficha.';
async function guarded(user: string, reply: string, executed: any[]) {
    const f = agentTurnFixture();
    const session = { trace: { steps: [] as Array<{ signal: string }> } };
    f.llmRouter.execute.mockResolvedValue({ content: reply, model: 'synthetic', usage: {}, cost: 0 });
    const output = await (f.runtime as any).applyOutputGuardrails(reply, '<persona>Atiende con claridad.</persona>',
        [{ role: 'user', content: user }], ['tier_1'], 'tenant', 'conversation', executed, 'es', [], {}, session, f.llmRouter);
    expect(f.toolExecutor.execute).not.toHaveBeenCalled();
    expect(f.eventEmitter.emit).not.toHaveBeenCalled();
    expect(f.outboundQueue.enqueue).not.toHaveBeenCalled();
    return { output, f, signals: session.trace.steps.map(s => s.signal) };
}
describe('Other configured CRM writer completion evidence', () => {
    const tagUser = 'Agrega la etiqueta QA2510_MESA en mi ficha.';
    const interestUser = 'Registra en mi ficha que me interesan las opciones por escrito.';
    it('CRMACK_A_01 a tag acknowledgement without any writer must be corrected', async () => {
        const { output } = await guarded(tagUser, TAG, []);
        expect(output).not.toBe(TAG);
    });
    it('CRMACK_A_02 a successful context read cannot back a completed tag change', async () => {
        const { output } = await guarded(tagUser, TAG, [{ name: 'get_customer_context', result: { status: 'ok', lead: { tags: [] } } }]);
        expect(output).not.toBe(TAG);
    });

    it('CRMACK_B_01 a refused full interest field must not be acknowledged as saved', async () => {
        const { output } = await guarded(interestUser, INTEREST, [{ name: 'record_contact_interest', result: { error: 'interest_not_recorded' } }]);
        expect(output).not.toBe(INTEREST);
    });
    it('CRMACK_B_02 a successful note does not prove an interest field was recorded', async () => {
        const { output } = await guarded(interestUser, INTEREST, [{ name: 'add_contact_note', result: { success: true, recorded: 'Por escrito.' } }]);
        expect(output).not.toBe(INTEREST);
    });

});

describe('CRM writer receipt boundaries', () => {
    it('CRMACK_G_01 a mixed tag and interest claim requires both exact receipts', () => {
        const tag = { name: 'tag_contact', result: { success: true, tag: 'QA2510_MESA' } };
        const interest = { name: 'record_contact_interest', result: { success: true, interest: 'Por escrito' } };
        expect(auditTurnClaim(`${TAG} ${INTEREST}`, [tag], {}).falseClaim).toBe(true);
        expect(auditTurnClaim(`${TAG} ${INTEREST}`, [tag, interest], {}).falseClaim).toBe(false);
    });
    it('CRMACK_G_02 present facts negation and questions do not claim new tag or interest writes', () => {
        for (const text of ['Su interés figura registrado en su ficha.', 'No he agregado la etiqueta QA2510_MESA a su ficha.', '¿He registrado su interés en su ficha?']) {
            expect(auditTurnClaim(text, [], {}).claimed).toBe(false);
        }
    });
});
