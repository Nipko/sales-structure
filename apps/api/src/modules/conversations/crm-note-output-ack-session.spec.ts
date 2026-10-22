import { agentTurnFixture } from './__fixtures__/agent-turn.fixture';
import { auditTurnClaim } from '../../common/utils/outcome-claim.util';
import { isBusinessWriteTool } from './tool-policy-registry';

const MESSAGE = 'Anota en mi ficha que prefiero recibir los detalles por escrito, sin llamadas.';
const LUCA = 'He tomado nota de su preferencia para retirar los pedidos de prueba los martes.';
const MAYA = 'He tomado nota de su preferencia por escrito y la he registrado en su ficha.';
type ToolOutcome = { name: string; result: unknown };

async function guarded(reply: string, executed: ToolOutcome[] = []) {
    const f = agentTurnFixture();
    const session = { trace: { steps: [] as Array<{ signal: string }> } };
    // The corrective model insists on the same sentence; the backend must fail closed.
    f.llmRouter.execute.mockResolvedValue({ content: reply, model: 'synthetic', usage: {}, cost: 0 });
    const output = await (f.runtime as any).applyOutputGuardrails(
        reply, '<persona>Atiende con claridad.</persona>', [{ role: 'user', content: MESSAGE }],
        ['tier_1'], 'tenant', 'conversation', executed, 'es', [], {}, session, f.llmRouter,
    );
    expect(f.toolExecutor.execute).not.toHaveBeenCalled();
    expect(f.eventEmitter.emit).not.toHaveBeenCalled();
    expect(f.outboundQueue.enqueue).not.toHaveBeenCalled();
    return { output, f, signals: session.trace.steps.map(step => step.signal) };
}

describe('CRM note output acknowledgement uses the current note outcome', () => {
    it('NOTEACK_A_01 corrects actual Luca acknowledgement when no note tool ran', async () => {
        const { output, f, signals } = await guarded(LUCA);
        expect(signals).toContain('claim_unbacked');
        expect(output).not.toBe(LUCA);
        expect(output).not.toMatch(/he tomado nota/i);
        expect(f.llmRouter.execute).toHaveBeenCalledTimes(1);
    });
    it('NOTEACK_A_02 does not let a successful profile read back a Maya saved-note claim', async () => {
        const { output, f, signals } = await guarded(MAYA, [{ name: 'get_customer_context', result: { status: 'ok', lead: { stage: 'confirmado' } } }]);
        expect(signals).toContain('claim_unbacked');
        expect(output).not.toBe(MAYA);
        expect(output).not.toMatch(/he registrado en su ficha/i);
        expect(f.llmRouter.execute).toHaveBeenCalledTimes(1);
    });
    it('NOTEACK_A_03 does not acknowledge a failed note write even if the rewrite insists', async () => {
        const { output, f, signals } = await guarded(MAYA, [{ name: 'add_contact_note', result: { error: 'note_failed' } }]);
        expect(signals).toContain('claim_unbacked');
        expect(output).not.toBe(MAYA);
        expect(f.llmRouter.execute).toHaveBeenCalledTimes(1);
    });
    it('NOTEACK_B_01 preserves a successful current note with its recorded content', async () => {
        const { output, f, signals } = await guarded(MAYA, [{ name: 'add_contact_note', result: { success: true, recorded: 'Detalles por escrito, sin llamadas.' } }]);
        expect(output).toBe(MAYA);
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
    });
    it('NOTEACK_B_02 does not let an unrelated successful writer back a saved-note claim', async () => {
        const { output, f, signals } = await guarded(MAYA, [{ name: 'create_appointment', result: { success: true, appointmentId: 'synthetic' } }]);
        expect(signals).toContain('claim_unbacked');
        expect(output).not.toBe(MAYA);
        expect(f.llmRouter.execute).toHaveBeenCalledTimes(1);
    });
    it('NOTEACK_B_03 preserves a truthful negated acknowledgement without a rewrite', async () => {
        const reply = 'No he guardado ninguna nota en su ficha.';
        const { output, f } = await guarded(reply);
        expect(output).toBe(reply);
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
    });
});

describe('CRM note claim boundaries', () => {
    const options = { crmNoteRequested: true, isBackingTool: isBusinessWriteTool };
    it('NOTEACK_G_01 does not treat conversational acknowledgement as persistence without a note request', () => {
        expect(auditTurnClaim(LUCA, [], { isBackingTool: isBusinessWriteTool }).claimed).toBe(false);
    });
    it('NOTEACK_G_02 detects an explicit scoped first-person note save without request context', () => {
        expect(auditTurnClaim('He guardado su nota en su ficha.', [], {}).falseClaim).toBe(true);
    });
    it('NOTEACK_G_03 does not reinterpret a genuine order statement as a note', () => {
        expect(auditTurnClaim('He registrado su pedido en su ficha.', [{ name: 'place_order', result: { success: true } }], options).falseClaim).toBe(false);
    });
    it('NOTEACK_G_04 requires successful current recorded note content', () => {
        for (const result of [{ success: true }, { success: true, recorded: '' }, { success: true, recorded: 'x', error: 'note_failed' }]) {
            expect(auditTurnClaim(MAYA, [{ name: 'add_contact_note', result }], options).falseClaim).toBe(true);
        }
    });
    it('NOTEACK_G_05 requires separate backing for a mixed note and appointment claim', () => {
        const text = `${MAYA} Su cita está confirmada.`;
        const note = { name: 'add_contact_note', result: { success: true, recorded: 'Por escrito.' } };
        expect(auditTurnClaim(text, [note], options).falseClaim).toBe(true);
        expect(auditTurnClaim(text, [note, { name: 'create_appointment', result: { success: true } }], options).falseClaim).toBe(false);
    });
    it('NOTEACK_G_06 preserves present record facts and a negated first-person save', () => {
        for (const text of ['Su preferencia figura registrada en su ficha.', 'No la he registrado en su ficha.', '¿He guardado su nota en su ficha?']) {
            expect(auditTurnClaim(text, [], options).falseClaim).toBe(false);
        }
    });
});
