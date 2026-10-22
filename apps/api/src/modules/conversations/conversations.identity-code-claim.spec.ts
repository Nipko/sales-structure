import { pinClock } from './__fixtures__/pinned-clock';
import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
// The evaluation session blocks the identity tools (it never sends or accepts a real code); this spec exercises the production
// glue, whose executor is a double, so they are let through here (as conversations.transition-identity.spec.ts does).
jest.mock('./agent-test-tool-policy', () => {
    const actual = jest.requireActual('./agent-test-tool-policy');
    return { ...actual, isAgentTestSafeToolName: (name: unknown) => actual.isAgentTestSafeToolName(name) || name === 'request_identity_code' || name === 'verify_identity_code' };
});
import { randomUUID } from 'crypto';
import { ToolRetrievalService } from './tool-retrieval.service';
import { claimsIdentityCodeSent } from '../../common/utils/outcome-claim.util';
import { containsHumanOffer } from './human-offer';

/**
 * F4300-02 through ConversationsService (the model's own tool loop). Production, dental QA tenant on Telegram: the customer
 * asked about their own appointments, list_customer_appointments answered identity_verification_required, and the model
 * asked for «el código de 6 dígitos que le fue enviado a su correo o teléfono» — no code had left. The reply now mentions
 * a sent code only when a provider accepted one in this turn; otherwise the customer reads what is true.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLAIM_ES = 'Para revisar su próxima cita necesito verificar su identidad. Por favor, ¿puede proporcionarme el código de 6 dígitos que le fue enviado a su correo o teléfono?';
const CLAIM_EN = 'For security, I need to verify your identity before checking your appointments. Please provide the 6-digit code sent to your email or phone to continue.';
const SENT_ES = 'Para revisar sus citas necesito verificar su identidad. Le envié un código a j***@example.com; escríbalo aquí para continuar.';
const answer = (content: string, toolCalls?: any[]) => ({ content, ...(toolCalls ? { toolCalls } : {}), model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });
const call = (name: string, args: Record<string, unknown> = {}) => ({ id: `call-${name}`, function: { name, arguments: JSON.stringify(args) } });

interface Script {
    language: 'es' | 'en';
    /** What the guarded read answers for this unverified chat. */
    gated: Record<string, unknown>;
    /** The model asks for a code itself before answering. */
    requestsCode?: boolean;
    requestResult?: Record<string, unknown>;
    /** What the model finally writes. */
    reply: string;
}

function world(script: Script) {
    const f = agentTurnFixture({ toolRetrieval: new ToolRetrievalService() });
    const namespace = { schemaName: 'tenant_eval_11111111_aaaaaaaaaaaaaaaaaaaaaaaa', sourceSchema: 'tenant_test', tenantId: 'tenant',
        token: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 60_000).toISOString(), tables: [] };
    (f.service as any).namespaces = { assertOwned: jest.fn() };
    f.prisma.tenant.findUnique.mockResolvedValue({ industry: 'salud', settings: { verticalConfig: { industry: 'salud', subType: 'odontologia' } } });
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: script.language, industry: 'salud', tools: { appointments: { enabled: true } }, rag: { enabled: false }, llm: {},
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'salud', subType: 'odontologia' });
    publishTools(f, ['list_services', 'check_availability', 'create_appointment', 'cancel_appointment', 'reschedule_appointment', 'list_customer_appointments', 'request_identity_code', 'verify_identity_code']);
    const executed: Array<{ name: string; result: any }> = [];
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) => {
        const result = name === 'list_customer_appointments' ? script.gated
            : name === 'request_identity_code' ? (script.requestResult ?? { sent: true, codeSent: true, via: 'email', channel: 'email', sentTo: 'j***@example.com', maskedDestination: 'j***@example.com' })
                : { results: [] };
        executed.push({ name, result });
        return result;
    });
    f.llmRouter.execute.mockImplementation(async (request: any) => {
        if (!['conversation', 'tool_calling'].includes(request.task)) return answer('{}');
        const messages: any[] = request.messages ?? [];
        const toolResults = messages.filter(m => m?.role === 'tool').map(m => String(m.content));
        const hasTools = (request.tools?.length ?? 0) > 0;
        if (hasTools && !toolResults.some(text => /identity_/.test(text))) return answer('', [call('list_customer_appointments')]);
        if (hasTools && script.requestsCode && !toolResults.some(text => /"sent"|"pending"|codeSent/.test(text) && !/identity_verification_required/.test(text))) {
            return answer('', [call('request_identity_code')]);
        }
        return answer(script.reply);
    });
    const turn = (message: string) => f.service.test('tenant', AGENT, { message, channelType: 'telegram' }, {
        evalMode: true, sandboxContactId: '00000000-0000-4000-8000-00000000eba1', sandboxConversationId: randomUUID(),
        sandboxNamespace: namespace, sandboxInboundMessageId: randomUUID(),
    });
    const ran = (name: string) => executed.filter(item => item.name === name);
    return { f, turn, ran };
}

pinClock();
describe('F4300-02: a reply never asks for a verification code that was never sent', () => {
    it('«cuándo es mi próxima cita?» — the read sent nothing and the model claims a code: the customer reads the truth', async () => {
        const h = world({ language: 'es', reply: CLAIM_ES,
            gated: { error: 'identity_verification_required', needsVerification: true, challengeSent: false, codeSent: false, nextStep: 'request_identity_code' } });
        const result = await h.turn('cuándo es mi próxima cita?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.ran('list_customer_appointments')).toHaveLength(1);
        expect(h.ran('request_identity_code')).toHaveLength(0);
        expect(claimsIdentityCodeSent(result.reply)).toBe(false);
        expect(result.reply).toContain('todavía no le he enviado ningún código');
    });

    it('«do I have any appointment booked?» — delivery not confirmed: no «code sent to your email or phone»', async () => {
        const h = world({ language: 'en', reply: CLAIM_EN,
            gated: { error: 'identity_verification_required', needsVerification: true, challengeSent: false, codeSent: false, codeDeliveryPending: true } });
        const result = await h.turn('do I have any appointment booked?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(claimsIdentityCodeSent(result.reply)).toBe(false);
        expect(result.reply).toContain('cannot confirm yet that the verification code went out');
    });

    it('the code WAS requested and accepted this turn: the reply saying where it went stands', async () => {
        const h = world({ language: 'es', reply: SENT_ES, requestsCode: true,
            gated: { error: 'identity_verification_required', needsVerification: true, challengeSent: false, codeSent: false, nextStep: 'request_identity_code' } });
        const result = await h.turn('cuándo es mi próxima cita?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.ran('request_identity_code')).toHaveLength(1);
        expect(result.reply).toBe(SENT_ES);
    });

    it('no deliverable channel (Telegram contact, no e-mail, SMS retired): it says it cannot verify here, never a code', async () => {
        const h = world({ language: 'es', reply: CLAIM_ES,
            gated: { error: 'identity_unverifiable', codeSent: false, shouldHandoff: true, message: 'No hay un canal independiente para verificar la identidad y NO se envió ningún código.' } });
        const result = await h.turn('cuándo es mi próxima cita?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(claimsIdentityCodeSent(result.reply)).toBe(false);
        expect(result.reply).toContain('por este chat no puedo hacerlo');
        // (an evaluation turn has no person to offer; the live turn offers one — identity-code-claim.f4300.spec.ts)
        expect(containsHumanOffer(result.reply)).toBe(false);
    });
});
