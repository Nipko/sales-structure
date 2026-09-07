import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import type { AgentTurnSession } from './agent-turn-session';
import type { ProcedureDefinition } from '@parallext/shared';

const definitions: ProcedureDefinition[] = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Return', version: 1, status: 'active',
    trigger: { keywords: ['devolucion', 'return', 'devolucao', 'retour'] }, steps: [
        { id: 'email', type: 'ask', config: { field: 'email', fieldType: 'email', question: 'Email?' } },
        { id: 'reason', type: 'ask', config: { field: 'reason', question: 'Reason?' } },
        { id: 'details', type: 'ask', config: { field: 'details', question: 'Details?' } },
    ] }];
const cases = [
    ['es', 'Quiero una devolucion', 'Ahora quiero agendar una cita', 'más tarde', 'Continuemos', 'Retoma la cita', 'Retomar la devolucion', 'Cambia mi correo a nuevo@example.test', 'Quiero cancelar mi pedido'],
    ['en', 'I want a return', 'Now I want to book an appointment', 'do this later', 'Continue', 'Resume the appointment', 'Resume the return', 'Change my email to new@example.test', 'I want to cancel my order'],
    ['pt', 'Quero uma devolucao', 'Agora quero agendar uma consulta', 'mais tarde', 'Vamos continuar', 'Retomar a consulta', 'Retomar a devolucao', 'Altere meu email para novo@example.test', 'Quero cancelar meu pedido'],
    ['fr', 'Je veux un retour', 'Maintenant je veux prendre rendez-vous', 'plus tard', 'Continuons', 'Reprenez le rendez-vous', 'Reprendre le retour', 'Modifiez mon courriel: nouveau@example.test', 'Je veux annuler ma commande'],
];

async function fixture(language: string) {
    const f = agentTurnFixture();
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: { language, industry: 'retail',
        tools: { appointments: { enabled: true } }, rag: { enabled: false }, llm: {} } });
    f.revisions.captureProcedures.mockResolvedValue(definitions);
    publishTools(f, ['list_services', 'check_availability', 'create_appointment', 'get_order_status']);
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) => {
        if (name === 'list_services') return { services: [{ id: 'service', name: 'Consultation', durationMinutes: 30, price: 100, currency: 'COP' }] };
        if (name === 'check_availability') return { available: true, slots: [{ time: '10:00', endTime: '10:30' }] };
        throw new Error(`Unexpected business command: ${name}`);
    });
    const snapshot = await f.service.captureSnapshot('tenant', 'agent');
    let id: string | undefined;
    const turn = async (message: string) => {
        const result = await f.service.test('tenant', 'agent', { message, channelType: 'telegram', runtimeSessionId: id }, { agentSnapshot: snapshot });
        id = result.debug.runtimeSessionId;
        expect(result.debug.runtimeError).toBeUndefined();
        return result;
    };
    const session = (): AgentTurnSession => (f.service as any).sessions.sessions.get(id).session;
    const procedure = () => session().state.getJson<any>(`procedure:${session().conversationId}`);
    const booking = () => structuredClone(session().metadata.bookingState);
    return { f, turn, session, procedure, booking };
}

describe('operational core mission continuity in four languages', () => {
    it.each(cases)('%s pauses, chooses and corrects across engines without using task text as a slot', async (language, start, switchTask, pause, generic, resumeBooking, resumeProcedure, correction) => {
        const h = await fixture(language);
        await h.turn(start); await h.turn('customer@example.test');
        const original = await h.procedure(); expect(original.awaitingField).toBe('reason');
        await h.turn(switchTask);
        expect(await h.procedure()).toMatchObject({ collected: { email: 'customer@example.test' }, awaitingField: 'reason', pausedAt: expect.any(String) });
        expect((await h.procedure()).collected.reason).toBeUndefined();
        expect(h.booking().step).not.toBe('idle');
        await h.turn(pause);
        const before = { booking: h.booking(), procedure: await h.procedure() };
        const ambiguous = await h.turn(generic);
        expect(ambiguous.debug.toolCalls).toHaveLength(0);
        expect(h.session().metadata.missionFocus.expectedReply).toBeNull();
        expect((await h.procedure()).collected).toEqual(before.procedure.collected);
        expect(h.booking().serviceId).toEqual(before.booking.serviceId);
        await h.turn(resumeBooking);
        expect(h.booking().pausedAt).toBeNull(); expect((await h.procedure()).pausedAt).toBeTruthy();
        await h.turn(resumeProcedure);
        expect((await h.procedure()).pausedAt).toBeNull(); expect(h.booking().pausedAt).toBeTruthy();
        await h.turn(correction);
        expect((await h.procedure()).collected.email).toMatch(/^(nuevo|new|novo|nouveau)@example\.test$/);
        expect((await h.procedure()).collected.reason).toBeUndefined();
        expect((await h.procedure()).awaitingField).toBe('reason');
        expect(h.f.toolExecutor.execute.mock.calls.some((call: any[]) => call[3] === 'create_appointment')).toBe(false);
        expect(h.f.prisma.executeInTenantSchema.mock.calls.every((call: any[]) => /^\s*(SELECT|WITH)/i.test(call[1]))).toBe(true);
    });
    it.each(cases)('%s keeps the booking while routing cancellation of another object', async (language, _start, switchTask, _pause, _generic, _rb, _rp, _correction, cancel) => {
        const h = await fixture(language); await h.turn(switchTask);
        const id = h.booking().missionId;
        await h.turn(cancel);
        expect(h.booking()).toMatchObject({ missionId: id, pausedAt: expect.any(String) });
        expect(h.booking().step).not.toBe('idle');
        expect(h.session().metadata.missionFocus.selected).toMatchObject({ kind: 'tool', domain: 'order' });
        expect(h.f.toolExecutor.execute.mock.calls.some((call: any[]) => call[3] === 'create_appointment')).toBe(false);
    });
});
