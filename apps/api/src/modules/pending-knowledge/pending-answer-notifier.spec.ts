import { AGENT_TEST_SANDBOX_CONTACT_ID, EVAL_SANDBOX_CONTACT_ID } from '../conversations/agent-test-tool-policy';
import { PendingAnswerNotifier, decideWaiterNotice, type WaiterNoticeInput } from './pending-answer-notifier.service';
import { pendingAnswerText, renderStoredValue } from './pending-answer-text';

const CONTACT = '33333333-3333-4333-8333-333333333333';
const base: WaiterNoticeInput = {
    contactId: CONTACT, questionStatus: 'answered', answerText: 'Sí, gratis.', conversationStatus: 'active',
    channelType: 'whatsapp', channelAccountId: 'phone-1', recipient: '573001112233', windowOpen: true,
};

describe('decideWaiterNotice: a quién se avisa y por qué no', () => {
    it('dentro de la ventana de 24 h, con respuesta: se envía', () => {
        expect(decideWaiterNotice(base)).toEqual({ kind: 'send' });
        // los canales sin ventana de Meta no la piden
        expect(decideWaiterNotice({ ...base, channelType: 'web_widget', windowOpen: undefined })).toEqual({ kind: 'send' });
    });

    it('los contactos de Agent Test y de la evaluación nunca reciben nada', () => {
        for (const contactId of [AGENT_TEST_SANDBOX_CONTACT_ID, EVAL_SANDBOX_CONTACT_ID]) {
            expect(decideWaiterNotice({ ...base, contactId })).toMatchObject({ kind: 'skip', status: 'sandbox' });
        }
    });

    it('fuera de la ventana en WhatsApp/Instagram/Messenger: hace falta la plantilla, no se envía texto libre', () => {
        for (const channelType of ['whatsapp', 'instagram', 'messenger']) {
            expect(decideWaiterNotice({ ...base, channelType, windowOpen: false })).toMatchObject({ kind: 'skip', status: 'template_required' });
        }
    });

    it('conversación con una persona, cerrada o inexistente; sin conexión; sin respuesta todavía', () => {
        expect(decideWaiterNotice({ ...base, conversationStatus: 'with_human' })).toMatchObject({ status: 'skipped_human' });
        expect(decideWaiterNotice({ ...base, conversationStatus: 'resolved' })).toMatchObject({ status: 'skipped_closed' });
        expect(decideWaiterNotice({ ...base, channelType: null })).toMatchObject({ status: 'skipped_closed' });
        expect(decideWaiterNotice({ ...base, recipient: '' })).toMatchObject({ status: 'no_channel' });
        expect(decideWaiterNotice({ ...base, questionStatus: 'open' })).toMatchObject({ kind: 'wait' });
        expect(decideWaiterNotice({ ...base, answerText: '  ' })).toMatchObject({ kind: 'wait' });
    });
});

describe('texto del aviso', () => {
    it('marco fijo en el idioma del cliente con la respuesta del dueño tal cual', () => {
        expect(pendingAnswerText('es', { question: '¿Tienen parqueadero?', answer: 'Sí, gratis.' }))
            .toBe('Hola, ya tenemos la respuesta a tu consulta «¿Tienen parqueadero?»: Sí, gratis.');
        expect(pendingAnswerText('en', { question: 'Parking?', answer: 'Yes.' })).toMatch(/^Hi, we have the answer/);
        expect(pendingAnswerText('pt-BR', { question: 'x', answer: 'y' })).toMatch(/^Olá/);
        expect(pendingAnswerText('fr', { question: 'x', answer: 'y' })).toMatch(/^Bonjour/);
        expect(pendingAnswerText('de', { question: 'x', answer: 'y' })).toMatch(/^Hola/);
    });

    it('un valor guardado se lee como texto, nunca JSON crudo', () => {
        expect(renderStoredValue({ available: true, spots: 12, notes: 'en el sótano' })).toBe('available: true; spots: 12; notes: en el sótano');
        expect(renderStoredValue(['efectivo', 'tarjeta'])).toBe('efectivo, tarjeta');
    });
});

describe('PendingAnswerNotifier: la salida durable y nada más', () => {
    function build(rows: Record<string, any>[], options: { optedOut?: boolean; windowOpen?: boolean } = {}) {
        const updates: any[][] = [];
        const query = jest.fn(async (sql: string, params: any[] = []) => {
            if (sql.includes('FROM pending_question_waiters w')) return rows;
            if (sql.includes('AS open')) return [{ open: options.windowOpen ?? true }];
            if (sql.includes('AS blocked')) return [{ blocked: options.optedOut === true }];
            if (sql.includes('UPDATE pending_question_waiters')) { updates.push(params); return []; }
            throw new Error(`sentencia no prevista: ${sql.slice(0, 60)}`);
        });
        const prisma = { getTenantSchemaName: jest.fn(async () => 'tenant_x'), executeInTenantSchema: jest.fn((_s: string, sql: string, p?: any[]) => query(sql, p)) };
        const proactive = {
            policyAuthority: jest.fn(async () => ({ kind: 'proactive_policy' })),
            send: jest.fn(async () => ({ kind: 'prepared', originId: 'o' })),
        };
        return { notifier: new PendingAnswerNotifier(prisma as any, proactive as any), proactive, updates };
    }
    const row = (over: Record<string, any> = {}) => ({
        id: 'w1', conversation_id: '44444444-4444-4444-8444-444444444444', contact_id: CONTACT, language: 'en',
        sample_question: 'Parking?', answer_text: 'Yes, free.', question_status: 'stored', conversation_status: 'active',
        channel_type: 'whatsapp', channel_account_id: 'phone-1', recipient: '573001112233', ...over,
    });

    it('envía en el idioma del cliente por ProactiveDispatchService con la autoridad pending_answer_ready', async () => {
        const t = build([row()]);
        expect(await t.notifier.notifyQuestions('tenant', ['q1'])).toEqual({ sent: 1 });
        expect(t.proactive.policyAuthority).toHaveBeenCalledWith('tenant_x', expect.objectContaining({ producer: 'pending_answer_ready', entityId: 'w1' }));
        expect(t.proactive.send).toHaveBeenCalledWith('tenant', expect.objectContaining({
            originKey: 'pending_answer_ready:w1', recipient: '573001112233',
            items: [{ kind: 'text', payload: { text: 'Hi, we have the answer to your question "Parking?": Yes, free.' } }],
        }));
        expect(t.updates).toEqual([['w1', 'sent', 'prepared']]);
    });

    it('una espera de Agent Test nunca llega a la salida', async () => {
        const t = build([row({ contact_id: AGENT_TEST_SANDBOX_CONTACT_ID })]);
        expect(await t.notifier.notifyQuestions('tenant', ['q1'])).toEqual({ sandbox: 1 });
        expect(t.proactive.send).not.toHaveBeenCalled();
        expect(t.proactive.policyAuthority).not.toHaveBeenCalled();
    });

    it('fuera de la ventana registra template_required; con baja registra opted_out; ninguno envía', async () => {
        const closed = build([row()], { windowOpen: false });
        expect(await closed.notifier.notifyQuestions('tenant', ['q1'])).toEqual({ template_required: 1 });
        const opted = build([row()], { optedOut: true });
        expect(await opted.notifier.notifyQuestions('tenant', ['q1'])).toEqual({ opted_out: 1 });
        expect(closed.proactive.send).not.toHaveBeenCalled();
        expect(opted.proactive.send).not.toHaveBeenCalled();
    });

    it('un fallo transitorio deja la espera en waiting para reintentar', async () => {
        const t = build([row()]);
        t.proactive.send.mockResolvedValueOnce({ kind: 'deferred', reason: 'db hiccup' } as any);
        expect(await t.notifier.notifyQuestions('tenant', ['q1'])).toEqual({ waiting: 1 });
        expect(t.updates).toEqual([]);
    });
});
