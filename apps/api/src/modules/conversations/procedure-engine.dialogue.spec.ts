import type { ProcedureDefinition, ProcedureFieldType, ProcedureRunState, ProcedureStep } from '@parallext/shared';
import { ProcedureEngineService } from './procedure-engine.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

function harness(config: ProcedureStep['config'] = { field: 'email', question: '¿Cuál es tu correo?' }) {
    const definition: ProcedureDefinition = {
        id: '44444444-4444-4444-8444-444444444444', name: 'Contact data', status: 'active', version: 1,
        trigger: { keywords: ['devolucion'] }, steps: [
            { id: 'ask', type: 'ask', config },
            { id: 'second', type: 'ask', config: { field: 'reason', question: '¿Cuál es el motivo?' } },
        ],
    };
    let state: ProcedureRunState | null = {
        procedureId: definition.id, version: 1, currentStepId: 'ask', collected: {}, awaitingField: config.field, startedAt: new Date().toISOString(),
    };
    const redis = {
        getJson: jest.fn(async () => state && structuredClone(state)),
        setJson: jest.fn(async (_: string, next: ProcedureRunState) => { state = structuredClone(next); }),
        del: jest.fn(async () => { state = null; }),
    };
    const prisma = { executeInTenantSchema: jest.fn(async () => [definition]) };
    const executor = { execute: jest.fn().mockResolvedValue({ found: true }) };
    const engine = new ProcedureEngineService(prisma as any, redis as any, executor as any);
    return {
        engine, executor, redis, definition, state: () => state,
        turn: (text: string, language = 'es') => engine.process('schema', 'tenant', 'conversation', 'contact', text, { language, authority: authorityFor('get_order_status') }),
    };
}

describe('procedure collection is a dialogue, not raw message capture', () => {
    it.each([
        ['¿Por qué necesitan mi correo?', 'es'], ['Why do you need my email?', 'en'],
        ['Por que vocês precisam do meu email?', 'pt'], ['Pourquoi avez-vous besoin de mon courriel ?', 'fr'],
    ])('keeps a question out of the collected value: %s', async (text, language) => {
        const h = harness();
        expect(await h.turn(text, language)).toMatchObject({ handled: true, completed: false, dialogueAct: 'question' });
        expect(h.state()).toMatchObject({ currentStepId: 'ask', awaitingField: 'email', collected: {} });
        expect(h.executor.execute).not.toHaveBeenCalled();
        await h.turn('customer@example.test', language);
        expect(h.state()).toMatchObject({ currentStepId: 'second', collected: { email: 'customer@example.test' } });
    });

    it('answers a collection-purpose question using the authored explanation', async () => {
        const h = harness({ field: 'email', explanation: 'Enviamos el recibo a este correo.', question: '¿Cuál es tu correo?' });
        expect(await h.turn('¿Para qué?')).toMatchObject({ dialogueAct: 'question', text: 'Enviamos el recibo a este correo.' });
    });

    it.each([
        ['Ya no quiero continuar', 'es'], ["I don't want to continue", 'en'],
        ['Não quero continuar', 'pt'], ['Je ne veux plus continuer', 'fr'],
    ])('cancels the collection without completing or executing anything: %s', async (text, language) => {
        const h = harness();
        expect(await h.turn(text, language)).toMatchObject({ completed: false, dialogueAct: 'cancel' });
        expect(h.state()).toBeNull();
        expect(h.executor.execute).not.toHaveBeenCalled();
    });

    it.each([
        ['prefiero hacerlo después', 'continuemos', 'es'], ['do this later', 'continue', 'en'],
        ['mais tarde', 'vamos continuar', 'pt'], ['plus tard', 'continuons', 'fr'],
    ])('requires a resume turn after an explicit pause: %s', async (pause, resume, language) => {
        const h = harness();
        expect(await h.turn(pause, language)).toMatchObject({ completed: false, dialogueAct: 'pause' });
        expect(h.state()?.pausedAt).toBeTruthy();
        expect(await h.turn('customer@example.test', language)).toMatchObject({ dialogueAct: 'pause' });
        expect(h.state()?.collected).toEqual({});
        expect(await h.turn(resume, language)).toMatchObject({ dialogueAct: 'resume' });
        expect(h.state()).toMatchObject({ awaitingField: 'email', collected: {}, pausedAt: null });
        await h.turn('customer@example.test', language);
        expect(h.state()?.collected).toEqual({ email: 'customer@example.test' });
    });

    it.each([
        ['email', 'email', 'nobody@', 'person@example.test', 'person@example.test'],
        ['phone', 'phone', 'call me tomorrow', '+57 (300) 123-4567', '+573001234567'],
        ['name', 'name', 'no se', 'María José O’Neill', 'María José O’Neill'],
        ['quantity', 'integer', '2.5', '3', 3],
        ['date', 'date', '2026-02-31', '2026-09-11', '2026-09-11'],
        ['object', 'uuid', '123', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'],
    ])('validates and coerces %s before advancing', async (field, type, bad, good, expected) => {
        const h = harness({ field: String(field), fieldType: type as ProcedureFieldType, question: 'Dato?' });
        expect(await h.turn(String(bad))).toMatchObject({ dialogueAct: 'invalid', completed: false });
        expect(h.state()?.collected).toEqual({});
        await h.turn(String(good));
        expect(h.state()?.collected).toEqual({ [String(field)]: expected });
    });

    it('preserves a negative boolean answer as false instead of cancelling the procedure', async () => {
        const h = harness({ field: 'returning', fieldType: 'boolean', question: '¿Ya eres cliente?' });
        await h.turn('no');
        expect(h.state()?.collected).toEqual({ returning: false });
    });

    it('allows an optional field to be declined without inventing a value', async () => {
        const h = harness({ field: 'email', required: false, question: 'Correo opcional?' });
        await h.turn('no gracias');
        expect(h.state()).toMatchObject({ currentStepId: 'second', collected: {}, awaitingField: 'reason' });
    });

    it('retains meaningful negative answers in free-text fields', async () => {
        const h = harness({ field: 'complaint', required: false, fieldType: 'string', question: 'Motivo?' });
        await h.turn('No entregaron el producto');
        expect(h.state()?.collected).toEqual({ complaint: 'No entregaron el producto' });
    });

    it('validates legacy inferred contact fields and accepts a simple natural prefix', async () => {
        const h = harness({ field: 'customerEmail', question: 'Correo?' });
        expect(await h.turn('gracias')).toMatchObject({ dialogueAct: 'invalid' });
        await h.turn('Mi correo es customer@example.test');
        expect(h.state()?.collected).toEqual({ customerEmail: 'customer@example.test' });
    });

    it('inherits downstream required tool argument types and executes only the valid value', async () => {
        const h = harness({ field: 'order', question: 'Orden?' });
        h.definition.steps[1] = { id: 'second', type: 'tool', config: { tool: 'get_order_status', args: { orderId: '{{ order }}' }, slots: { orderId: { type: 'uuid', required: true } } } };
        expect(await h.turn('wrong-id')).toMatchObject({ dialogueAct: 'invalid' });
        expect(h.executor.execute).not.toHaveBeenCalled();
        await h.turn('11111111-1111-4111-8111-111111111111');
        expect(h.executor.execute).toHaveBeenCalledWith('schema', 'tenant', 'contact', 'get_order_status', { orderId: '11111111-1111-4111-8111-111111111111' }, 'conversation', expect.anything());
    });

    it('rejects undeclared choice values and retains the pending question', async () => {
        const h = harness({ field: 'size', choices: ['S', 'M', 'L'], question: 'Talla?' });
        expect(await h.turn('XXXL')).toMatchObject({ dialogueAct: 'invalid' });
        await h.turn('M');
        expect(h.state()?.collected).toEqual({ size: 'M' });
    });
});
