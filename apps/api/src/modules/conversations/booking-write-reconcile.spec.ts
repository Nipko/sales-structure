import { BookingEngineService, type BookingState } from './booking-engine.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * Production 2026-10-09 (campaign after PR #82, Salón QA Citas): «sí, agéndala» was answered «No pude agendar la cita en este
 * momento; necesito que alguien del equipo lo confirme y la cierre», and the appointment (Ref. D0ADBD49, lun 19-oct 09:30) WAS in the
 * agenda a minute later. A write whose answer failed is not a write that did not happen: after ANY writer failure the engine reads the
 * records again and the reply is what the database says. If the appointment exists it is booked, with its reference.
 */
const AUTHORITY = authorityFor('list_services', 'check_availability', 'create_appointment');
const schemaName = 'tenant_booking_reconcile';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const serviceId = '44444444-4444-4444-8444-444444444444';
const appointmentId = 'd0adbd49-1111-4111-8111-111111111111';

function confirmState(): BookingState {
    const state: BookingState = {
        step: 'confirm',
        services: [{ id: serviceId, name: 'Corte y estilo', durationMinutes: 45, price: null, currency: 'COP', priceStatus: 'example' }],
        serviceId, serviceName: 'Corte y estilo', date: '2026-10-19', time: '09:30',
        slots: [{ time: '09:30', endTime: '10:15' }],
        customerName: 'Joaquin Sosa', customerEmail: 'qa.cliente@example.com',
    };
    return state;
}

/** A database that has no such appointment until the writer has run — and has it afterwards, whatever the writer answered. */
function world(writerAnswer: () => any | Promise<any>, options: { rowAfterWrite?: boolean } = {}) {
    let written = false;
    const row = { id: appointmentId, status: 'confirmed', payment_status: null, amount_due: null, hold_expires_at: null, price: null, currency: 'COP' };
    const prisma = {
        $queryRawUnsafe: jest.fn(async (sql: string) => (/FROM "[^"]+"\.appointments a/.test(sql) && written && options.rowAfterWrite !== false ? [row] : [])),
    };
    const toolExecutor = {
        execute: jest.fn(async (_s: string, _t: string, _c: string, name: string) => {
            if (name !== 'create_appointment') throw new Error(`unexpected ${name}`);
            written = true; // the INSERT committed
            return writerAnswer();
        }),
    };
    const state = confirmState();
    const redis = { get: jest.fn().mockResolvedValue(JSON.stringify(state.services)), set: jest.fn(), del: jest.fn() };
    const engine = new BookingEngineService(prisma as any, redis as any, toolExecutor as any);
    (engine as any).collectMissingInfo(state, 'es'); // issues the confirmation the customer is shown
    const say = (text: string) => engine.process(
        schemaName, tenantId, contactId, { intent: 'confirm', isConfirmation: true } as any, text, state, {}, '2026-10-09', 'es',
        { authority: AUTHORITY, conversationId },
    );
    return { say, prisma, toolExecutor, state };
}

describe('the booking reply is what the database says, not what the writer answered', () => {
    it.each([
        ['the ledger could not acknowledge the commit', { error: 'reconciliation_required', shouldHandoff: true, message: 'No pude verificar el resultado de la acción; requiere revisión antes de repetirla.' }],
        ['an internal failure after the INSERT', { error: 'tool_failed', message: 'No se pudo completar esta acción en este momento.' }],
        ['a retry of the same request found it in progress', { error: 'operation_in_progress', controlBlocked: true, message: 'La operación ya está siendo procesada. No la repitas.' }],
    ])('%s: the appointment exists → «¡Cita confirmada!» with its reference, no handoff, no «try another time»', async (_label, answer) => {
        const h = world(() => answer);
        const result = await h.say('sí, agéndala');
        expect(result.handled).toBe(true);
        expect(result.state.step).toBe('booked');
        expect(result.state.appointmentId).toBe(appointmentId);
        expect(result.handoff).toBeFalsy();
        expect(result.text).toContain('D0ADBD49');
        expect(result.text).toMatch(/Cita confirmada|solicitud de cita/);
        expect(result.text).not.toMatch(/No pude|Error al crear|otro horario|reconciliation|tool_failed/);
    });

    it('a writer that THROWS after the INSERT is the same: the reply comes from the records', async () => {
        const h = world(() => { throw new Error('redis timeout'); });
        const result = await h.say('sí, agéndala');
        expect(result.state.step).toBe('booked');
        expect(result.text).toContain('D0ADBD49');
    });

    it('the records are read AFTER the failure (the customer had no such appointment before it)', async () => {
        const h = world(() => ({ error: 'tool_failed' }));
        await h.say('sí, agéndala');
        const reads = h.prisma.$queryRawUnsafe.mock.calls.filter(([sql]) => /appointments a/.test(String(sql)));
        expect(reads.length).toBeGreaterThanOrEqual(2);
    });

    it('nothing was written: the failure is told as a failure (a person is arranged for a reconciliation), never as a booking', async () => {
        const h = world(() => ({ error: 'reconciliation_required', shouldHandoff: true }), { rowAfterWrite: false });
        const result = await h.say('sí, agéndala');
        expect(result.state.step).not.toBe('booked');
        expect(result.text).not.toMatch(/Cita confirmada|D0ADBD49/);
        expect(result.text).not.toMatch(/reconciliation_required/);
        expect(result.handoff).toBe(true);
    });
});
