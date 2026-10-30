import { AIToolExecutorService } from './ai-tool-executor.service';
import { RULE_20_KNOWLEDGE_STATUS } from './prompt-assembler.service';
import { TOOL_POLICY_REGISTRY, isBusinessWriteTool, isNonCommittalTool } from './tool-policy-registry';
import { AGENT_TEST_SAFE_TOOL_NAMES } from './agent-test-tool-policy';
import { REGISTER_PENDING_QUESTION_TOOL } from './tools/pending-question-tools';

/**
 * «Lo averiguo» como herramienta real (R5, ADR 0011): el agente la llama después del «sí» del cliente; en producción
 * deja la consulta con la espera de esta conversación; en Agent Test, la evaluación o un borrador corre en seco y
 * contesta lo mismo sin escribir ni avisar.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const CONTACT = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';

function executor(port?: { acceptWait: jest.Mock }) {
    const service = Object.create(AIToolExecutorService.prototype) as any;
    service.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn(), debug: jest.fn() };
    service.pendingQuestions = port;
    return service as { registerPendingQuestion: (...a: any[]) => Promise<Record<string, unknown>> };
}

describe('register_pending_question', () => {
    it('política: no compromete al negocio, corre en Agent Test (en seco) y no es un writer de negocio', () => {
        const policy = TOOL_POLICY_REGISTRY.register_pending_question;
        expect(policy).toMatchObject({ commitsBusiness: false, agentTestAllowed: true, confirmation: 'not_required', origin: 'core' });
        expect(isNonCommittalTool('register_pending_question')).toBe(true);
        expect(isBusinessWriteTool('register_pending_question')).toBe(false);
        expect(AGENT_TEST_SAFE_TOOL_NAMES).toContain('register_pending_question');
        expect(REGISTER_PENDING_QUESTION_TOOL.parameters.required).toEqual(['question']);
    });

    it('la regla del contrato dice cuándo llamarla: solo después de que el cliente acepta', () => {
        expect(RULE_20_KNOWLEDGE_STATUS).toMatch(/only once the customer accepts call register_pending_question/);
        expect(RULE_20_KNOWLEDGE_STATUS).toMatch(/never say it was recorded unless that tool succeeded/);
    });

    it('en producción registra la espera con la conversación, el contacto, el requisito y el idioma', async () => {
        const port = { acceptWait: jest.fn().mockResolvedValue({ id: 'q1', status: 'open', slaDueAt: new Date(Date.now() + 3.5 * 3_600_000).toISOString(), waitersCount: 3, alreadyWaiting: false }) };
        const out = await executor(port).registerPendingQuestion(TENANT, CONTACT, CONVERSATION,
            { question: '  ¿Tienen   parqueadero? ', requirementId: 'CORE.LOCATION.PARKING', language: 'es' }, false);
        expect(port.acceptWait).toHaveBeenCalledWith(TENANT, {
            question: '¿Tienen parqueadero?', requirementId: 'CORE.LOCATION.PARKING', conversationId: CONVERSATION, contactId: CONTACT, language: 'es',
        });
        expect(out).toMatchObject({ success: true, recorded: true, persisted: true, status: 'open', expectedWithinHours: 4 });
    });

    it('en seco (Agent Test, evaluación, borrador) no llama a la cola y contesta lo mismo', async () => {
        const port = { acceptWait: jest.fn() };
        const out = await executor(port).registerPendingQuestion(TENANT, CONTACT, CONVERSATION, { question: '¿Parqueadero?' }, true);
        expect(port.acceptWait).not.toHaveBeenCalled();
        expect(out).toMatchObject({ success: true, recorded: true, simulated: true, persisted: false });
    });

    it('sin pregunta, sin conversación, sin cola o con un fallo: nunca dice que quedó registrada', async () => {
        const port = { acceptWait: jest.fn().mockRejectedValue(new Error('db down')) };
        expect(await executor(port).registerPendingQuestion(TENANT, CONTACT, CONVERSATION, { question: ' ' }, false)).toMatchObject({ success: false, error: 'question_required' });
        expect(await executor(port).registerPendingQuestion(TENANT, CONTACT, undefined, { question: 'x' }, false)).toMatchObject({ success: false, error: 'conversation_required' });
        expect(await executor(undefined).registerPendingQuestion(TENANT, CONTACT, CONVERSATION, { question: 'x' }, false)).toMatchObject({ success: false, error: 'pending_questions_unavailable' });
        expect(await executor(port).registerPendingQuestion(TENANT, CONTACT, CONVERSATION, { question: 'x' }, false)).toMatchObject({ success: false, error: 'pending_question_not_recorded' });
    });
});
