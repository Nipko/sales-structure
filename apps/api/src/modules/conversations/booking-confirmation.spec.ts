import { BookingEngineService, type BookingState } from './booking-engine.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

describe('booking proposals and pauses', () => {
    function fixture() {
        const services = [{ id: 'service', name: 'Consulta', durationMinutes: 30, price: 100, currency: 'COP' }];
        const executor = { execute: jest.fn().mockResolvedValue({ success: true, appointment: { id: 'appointment', status: 'confirmed' } }) };
        const engine: any = new BookingEngineService({ $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any,
            { get: jest.fn(async () => JSON.stringify(services)), set: jest.fn().mockResolvedValue(undefined) } as any, executor as any);
        const state: BookingState = { step: 'confirm', services, serviceId: 'service', serviceName: 'Consulta', date: '2027-01-01', time: '10:00', customerName: 'Ana', customerEmail: 'ana@example.test' };
        const proposal = engine.collectMissingInfo(state, 'es');
        const turn = (text: string, next = state) => engine.process('schema', 'tenant', 'contact',
            { intent: 'confirm', isConfirmation: true }, text, next, {}, '2026-09-06', 'es', { authority: authorityFor('list_services', 'check_availability', 'create_appointment') });
        return { state, proposal, engine, executor, turn, services };
    }
    it('a button from an earlier proposal never creates the changed appointment', async () => {
        const h = fixture();
        const previousButton = h.proposal.buttonMessage.buttons[0].id;
        h.state.time = '11:00';
        h.engine.collectMissingInfo(h.state, 'es');
        expect(await h.turn(previousButton)).toMatchObject({ state: { step: 'confirm', time: '11:00' } });
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
    it('new prices require a fresh proposal before a typed confirmation can commit', async () => {
        const h = fixture(); const original = h.state.confirmationId;
        h.services[0].price = 200;
        const result = await h.turn('sí');
        expect(result.state.step).toBe('confirm');
        expect(result.text).toContain('200 COP');
        expect(result.state.confirmationId).not.toBe(original);
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
    it('expired and legacy buttons request a current proposal without executing', async () => {
        const h = fixture();
        h.state.confirmationIssuedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
        expect((await h.turn(h.proposal.buttonMessage.buttons[0].id)).state.step).toBe('confirm');
        expect((await h.turn('confirm_yes')).state.step).toBe('confirm');
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
    it('pauses without effects and permits another question without consuming it as booking data', async () => {
        const h = fixture();
        const paused = await h.turn('lo hago después');
        expect(paused.state.pausedAt).toBeTruthy();
        expect(await h.turn('¿Aceptan mascotas?', paused.state)).toMatchObject({ handled: false, state: { pausedAt: paused.state.pausedAt, customerName: 'Ana' } });
        const resumed = await h.turn('continuemos', paused.state);
        expect(resumed.state.pausedAt).toBeNull();
        expect(h.executor.execute).not.toHaveBeenCalled();
    });
});
