import { BookingEngineService } from './booking-engine.service';

/**
 * The deterministic booking engine collects no listing, pet or vehicle, so it cannot repair an
 * `appointment_subject_*` refusal, and it must not repair `outside_business_hours` by replaying the same
 * time. Both end in the human hand-off text instead of "Error al crear la cita: <internal code>".
 */
describe('booking engine: create_appointment refusals it cannot repair', () => {
    const engine = Object.create(BookingEngineService.prototype) as any;
    const fatal = (error: unknown) => engine.unrecoverableToolError({ error });

    it.each([
        'appointment_subject_required', 'appointment_subject_invalid', 'appointment_subject_not_found',
        'appointment_subject_unavailable', 'outside_business_hours', 'appointments_not_configured', 'tool_failed',
    ])('%s hands off to a person', code => {
        expect(fatal(code)).toBe(code);
    });

    it.each(['That time slot was just taken. Check availability again.', 'Service not found', undefined, 42])(
        'a recoverable answer (%p) keeps the normal flow', error => {
            expect(fatal(error)).toBeNull();
        });
});
