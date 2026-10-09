import {
    extractIdentityCode, failedTransitionOf, handleIdentityReply, identityGate, requestIdentityForTool, runTransition, transitionFailureText,
    type TransitionIO,
} from './transition-engine';
import { containsHumanOffer } from './human-offer';
import { newMissionFocus, readMissionFocus } from './mission-focus';

/**
 * Where a code IS required (a clinic, an insurer…), the engine drives the verification itself: it asks for the code ONCE,
 * says where it went, keeps the request while the code is awaited and resumes it when the code is right. It never falls back
 * to the model and never opens a handoff by itself. (The guard that decides WHO needs a code is covered by
 * identity-policy.coherence.spec.ts and the N3 suite.)
 */
const APPT = 'ae3d0c86-1111-4111-8111-111111111111';
const appointment = { id: APPT, reference: 'AE3D0C86', serviceId: 'svc-1', staffId: 'staff-1', service: 'Consulta general', date: '2026-10-12', time: '09:00', status: 'confirmed' };

function world(script: { verified?: boolean; sent?: any; verify?: any[]; appointments?: any[] } = {}) {
    const calls: Array<{ name: string; args: any }> = [];
    let verified = script.verified === true;
    const verifyAnswers = [...(script.verify ?? [])];
    let clock = Date.parse('2026-10-09T10:00:00Z');
    const io: TransitionIO = {
        execute: async (name, args) => {
            calls.push({ name, args });
            if (name === 'list_customer_appointments') {
                return verified ? { appointments: script.appointments ?? [appointment] }
                    : { error: 'identity_verification_required', needsVerification: true, challengeSent: false };
            }
            if (name === 'request_identity_code') return script.sent ?? { sent: true, via: 'email', sentTo: 'j***@example.com' };
            if (name === 'verify_identity_code') {
                const answer = verifyAnswers.shift() ?? { verified: true };
                if (answer.verified === true) verified = true;
                return answer;
            }
            if (name === 'cancel_appointment') {
                return verified ? { error: 'confirmation_required', confirmationId: 'conf-1' } : { error: 'identity_verification_required' };
            }
            return { error: 'unexpected_tool' };
        },
        interpretTarget: async () => null, todayIso: '2026-10-09', language: 'es', form: 'usted', now: () => clock,
    };
    return { io, calls, ran: (name: string) => calls.filter(call => call.name === name), advance: (ms: number) => { clock += ms; } };
}

describe('the guard answers that a code is needed → the server drives the verification', () => {
    it('identityGate classifies the guard answers', () => {
        expect(identityGate({ error: 'identity_verification_required' })).toBe('verify');
        expect(identityGate({ error: 'identity_locked', shouldHandoff: true })).toBe('blocked');
        expect(identityGate({ error: 'identity_unverifiable' })).toBe('blocked');
        expect(identityGate({ appointments: [] })).toBeNull();
        expect(identityGate(null)).toBeNull();
    });

    it('«quiero cancelar mi cita» with an unverified chat: ONE code is requested, the server says where it went, the request is kept', async () => {
        const w = world();
        const out = await runTransition({ verb: 'cancel', domain: 'appointment' }, 'quiero cancelar mi cita', w.io);
        expect(out.handled).toBe(true);
        expect(out.text).toBe('Para ver o cambiar sus citas necesito verificar su identidad. Le envié un código a j***@example.com; escríbalo aquí para continuar.');
        expect(w.ran('request_identity_code')).toHaveLength(1);
        expect(out.awaitingIdentity).toMatchObject({ verb: 'cancel', domain: 'appointment', text: 'quiero cancelar mi cita', stage: 'awaiting_code', hint: 'j***@example.com' });
        // no writer was reached, no handoff was opened
        expect(w.ran('cancel_appointment')).toHaveLength(0);
        expect(out.offersPerson).toBeUndefined();
    });

    it('the same request again while the code is live does not send a second code', async () => {
        const w = world();
        const first = await runTransition({ verb: 'cancel', domain: 'appointment' }, 'quiero cancelar mi cita', w.io);
        w.advance(60_000);
        const again = await runTransition({ verb: 'cancel', domain: 'appointment' }, 'quiero cancelar mi cita', w.io, { pendingIdentity: first.awaitingIdentity });
        expect(again.text).toBe('Ya le envié un código de verificación a j***@example.com; escríbalo aquí para continuar.');
        expect(w.ran('request_identity_code')).toHaveLength(1);
        // a lapsed code is a new request: a new code may be sent (the guard still bounds how many per hour)
        w.advance(10 * 60_000);
        await runTransition({ verb: 'cancel', domain: 'appointment' }, 'quiero cancelar mi cita', w.io, { pendingIdentity: first.awaitingIdentity });
        expect(w.ran('request_identity_code')).toHaveLength(2);
    });

    it('the right code verifies and the SAME request resumes: the proposal is made, nothing is asked again', async () => {
        const w = world();
        const first = await runTransition({ verb: 'cancel', domain: 'appointment' }, 'quiero cancelar mi cita', w.io);
        const resumed = await handleIdentityReply(first.awaitingIdentity!, 'el código es 123456', w.io);
        expect(w.ran('verify_identity_code')[0].args).toEqual({ code: '123456' });
        expect(resumed.handled).toBe(true);
        expect(resumed.awaitsConsent).toBe(true);
        expect(resumed.text).toContain('¿Confirma que desea cancelar su cita de Consulta general');
        expect(resumed.text).toContain('(Ref. AE3D0C86)');
        expect(resumed.awaitingIdentity).toBeNull();
        expect(w.ran('request_identity_code')).toHaveLength(1);
        expect(w.ran('cancel_appointment')).toHaveLength(1);
    });

    it('a wrong code is answered by the server and the wait goes on', async () => {
        const w = world({ verify: [{ verified: false, reason: 'wrong' }] });
        const first = await runTransition({ verb: 'cancel', domain: 'appointment' }, 'quiero cancelar mi cita', w.io);
        const wrong = await handleIdentityReply(first.awaitingIdentity!, '000000', w.io);
        expect(wrong).toMatchObject({ handled: true, text: 'Ese código no coincide. Revíselo y escríbalo de nuevo.' });
        expect(wrong.awaitingIdentity).toEqual(first.awaitingIdentity);
    });

    it('a lapsed code only OFFERS a new one: a new code is sent after the customer says yes', async () => {
        const w = world({ verify: [{ verified: false, reason: 'expired' }] });
        const first = await runTransition({ verb: 'cancel', domain: 'appointment' }, 'quiero cancelar mi cita', w.io);
        const expired = await handleIdentityReply(first.awaitingIdentity!, '123456', w.io);
        expect(expired.text).toBe('El código venció. ¿Desea que le envíe uno nuevo?');
        expect(w.ran('request_identity_code')).toHaveLength(1);
        expect(expired.awaitingIdentity).toMatchObject({ stage: 'offer_new_code' });
        const declined = await handleIdentityReply(expired.awaitingIdentity!, 'no, gracias', w.io);
        expect(declined).toMatchObject({ handled: false, awaitingIdentity: null });
        expect(w.ran('request_identity_code')).toHaveLength(1);
        const accepted = await handleIdentityReply(expired.awaitingIdentity!, 'sí', w.io);
        expect(w.ran('request_identity_code')).toHaveLength(2);
        expect(accepted.text).toContain('Le envié un código a');
    });

    it('too many wrong codes OFFERS a person (a question the customer answers); no handoff is opened', async () => {
        const w = world({ verify: [{ verified: false, reason: 'too_many', shouldHandoff: true }] });
        const first = await runTransition({ verb: 'cancel', domain: 'appointment' }, 'quiero cancelar mi cita', w.io);
        const out = await handleIdentityReply(first.awaitingIdentity!, '111111', w.io);
        expect(out.offersPerson).toBe(true);
        expect(out.awaitingIdentity).toBeNull();
        expect(out.text).toContain('Por seguridad no puedo verificar su identidad');
        expect(containsHumanOffer(out.text)).toBe(true);
        expect(out.text).toMatch(/¿Desea que le pida a una persona del equipo que se encargue de su caso\?$/);
    });

    it('a lockout or no channel at the first read offers a person instead of opening a handoff', async () => {
        for (const sent of [{ error: 'identity_locked', shouldHandoff: true }, { error: 'identity_unverifiable', shouldHandoff: true }]) {
            const w = world({ sent });
            const out = await runTransition({ verb: 'reschedule', domain: 'appointment' }, 'quiero reprogramar mi cita', w.io);
            expect(out.handled).toBe(true);
            expect(out.offersPerson).toBe(true);
            expect(containsHumanOffer(out.text)).toBe(true);
        }
        const blockedRead = world();
        const original = blockedRead.io.execute;
        blockedRead.io.execute = async (name, args) => name === 'list_customer_appointments' ? { error: 'identity_locked', shouldHandoff: true } : original(name, args);
        const out = await runTransition({ verb: 'cancel', domain: 'appointment' }, 'quiero cancelar mi cita', blockedRead.io);
        expect(out).toMatchObject({ handled: true, offersPerson: true });
        expect(blockedRead.ran('request_identity_code')).toHaveLength(0);
    });

    it('a message that is not the code ends the wait and goes on as a normal turn; the same request again reminds, without sending', async () => {
        const w = world();
        const first = await runTransition({ verb: 'cancel', domain: 'appointment' }, 'quiero cancelar mi cita', w.io);
        const other = await handleIdentityReply(first.awaitingIdentity!, '¿a qué hora abren mañana?', w.io);
        expect(other).toMatchObject({ handled: false, awaitingIdentity: null });
        const repeated = await handleIdentityReply(first.awaitingIdentity!, 'quiero cancelar mi cita', w.io);
        expect(repeated.text).toContain('Ya le envié un código de verificación');
        expect(w.ran('request_identity_code')).toHaveLength(1);
    });

    it('extractIdentityCode takes one six-digit group and nothing else', () => {
        expect(extractIdentityCode('123456')).toBe('123456');
        expect(extractIdentityCode('123 456')).toBe('123456');
        expect(extractIdentityCode('mi código es 654321, gracias')).toBe('654321');
        expect(extractIdentityCode('quiero la cita 12345678')).toBeNull();
        expect(extractIdentityCode('el 12 de octubre a las 123456 y 654321')).toBeNull();
        expect(extractIdentityCode('hola')).toBeNull();
    });

    it('when the verification lapses between the proposal and the yes, the code is asked for once and the request is rebuilt from the proposal', async () => {
        const w = world();
        const out = await requestIdentityForTool('reschedule_appointment', { appointmentId: APPT, newDate: '2026-10-16', newTime: '11:00' }, w.io);
        expect(out?.awaitingIdentity).toMatchObject({ verb: 'reschedule', domain: 'appointment', stage: 'awaiting_code' });
        expect(out?.awaitingIdentity?.text).toContain('AE3D0C86');
        expect(out?.awaitingIdentity?.text).toContain('2026-10-16 11:00');
        expect(w.ran('request_identity_code')).toHaveLength(1);
    });
});

describe('the request that waits for a code lives in the mission focus, for a while', () => {
    const waiting = (askedAt: string, over: Record<string, unknown> = {}) => ({ verb: 'cancel', domain: 'appointment', text: 'quiero cancelar mi cita', stage: 'awaiting_code', askedAt, ...over });
    const stored = (pendingIdentity: unknown) => readMissionFocus({ ...newMissionFocus(), pendingIdentity });

    it('a fresh one is kept (the code is checked on a later message) and a stale or malformed one is dropped', () => {
        const fresh = waiting(new Date().toISOString(), { hint: 'j***@example.com', codeSentAt: new Date().toISOString() });
        expect(stored(fresh).pendingIdentity).toEqual(fresh);
        expect(stored(waiting(new Date(Date.now() - 31 * 60_000).toISOString())).pendingIdentity).toBeUndefined();
        expect(stored(waiting(new Date().toISOString(), { stage: 'whatever' })).pendingIdentity).toBeUndefined();
        expect(stored(waiting(new Date().toISOString(), { verb: 'refund' })).pendingIdentity).toBeUndefined();
        expect(stored(waiting('not a date')).pendingIdentity).toBeUndefined();
        expect(stored('cancel').pendingIdentity).toBeUndefined();
    });
});

describe('which tool results of a turn are a write that failed', () => {
    const ran = (name: string, args: any, result: any) => ({ name, args, result });
    it('the last attempt on a record decides; a proposal, a refusal or a missing code is not a failed write', () => {
        expect(failedTransitionOf([ran('cancel_appointment', { appointmentId: 'a' }, { error: 'tool_failed' })])).toEqual({ name: 'cancel_appointment', args: { appointmentId: 'a' } });
        for (const error of ['confirmation_required', 'reschedule_must_be_atomic', 'identity_verification_required', 'action_rejected', 'mission_selection_required', 'tool_not_authorised']) {
            expect(failedTransitionOf([ran('cancel_appointment', { appointmentId: 'a' }, { error })])).toBeNull();
        }
        // a later success on the same record clears it; another record does not
        expect(failedTransitionOf([ran('cancel_appointment', { appointmentId: 'a' }, { error: 'tool_failed' }), ran('cancel_appointment', { appointmentId: 'a' }, { success: true })])).toBeNull();
        expect(failedTransitionOf([ran('cancel_appointment', { appointmentId: 'a' }, { error: 'tool_failed' }), ran('cancel_appointment', { appointmentId: 'b' }, { success: true })]))
            .toEqual({ name: 'cancel_appointment', args: { appointmentId: 'a' } });
        // not a transition tool, or no target to re-read
        expect(failedTransitionOf([ran('create_appointment', { serviceId: 's' }, { error: 'tool_failed' }), ran('cancel_appointment', {}, { error: 'tool_failed' })])).toBeNull();
    });
});

describe('after a write fails, the reply says what the records say NOW', () => {
    const failure = (appointments: any[] | { error: string }) => {
        const io: TransitionIO = {
            execute: async name => name === 'list_customer_appointments' ? (Array.isArray(appointments) ? { appointments } : appointments) : { error: 'unexpected' },
            interpretTarget: async () => null, todayIso: '2026-10-09', language: 'es', form: 'usted',
        };
        return io;
    };

    it('a cancellation that failed while the appointment is still there says so, with its date, and offers a person', async () => {
        const text = await transitionFailureText('cancel_appointment', { appointmentId: APPT }, failure([appointment]));
        expect(text).toContain('No pude cancelar su cita de Consulta general (Ref. AE3D0C86): sigue programada para el lunes 12 de octubre a las 09:00.');
        expect(containsHumanOffer(text)).toBe(true);
    });

    it('a reschedule that failed: «sigue programada» only when it is verifiably at the OLD time; at the NEW time it succeeded', async () => {
        const args = { appointmentId: APPT, newDate: '2026-10-16', newTime: '11:00' };
        expect(await transitionFailureText('reschedule_appointment', args, failure([appointment]))).toContain('sigue programada para el lunes 12 de octubre');
        expect(await transitionFailureText('reschedule_appointment', args, failure([{ ...appointment, date: '2026-10-16', time: '11:00' }])))
            .toBe('Su cita (Ref. AE3D0C86) quedó reprogramada para el viernes 16 de octubre a las 11:00.');
    });

    it('an appointment that is gone is never described as «sigue tal como está»: the reply says it no longer appears and that the change is unconfirmed', async () => {
        const text = await transitionFailureText('reschedule_appointment', { appointmentId: APPT, newDate: '2026-10-16', newTime: '11:00' }, failure([]));
        expect(text).toContain('ya no aparece entre sus citas próximas, pero no pude confirmar que el cambio se hiciera');
        expect(text).not.toMatch(/sigue (?:tal|programada)/);
    });

    it('when the records cannot be read, no change is assumed', async () => {
        const text = await transitionFailureText('cancel_appointment', { appointmentId: APPT }, failure({ error: 'tool_failed' }));
        expect(text).toContain('no doy por hecho ningún cambio');
    });

    it('an order: cancelled after all → the done text; still active → it says so', async () => {
        const order = { id: 'c03ebdd7-226a-40b0-afc1-cba45b5a0073', status: 'pending', totalAmount: 1000, currency: 'COP', items: [{ productName: 'Audífono', quantity: 1 }] };
        const io = (status: string): TransitionIO => ({
            execute: async () => ({ success: true, orders: [{ ...order, status }] }),
            interpretTarget: async () => null, todayIso: '2026-10-09', language: 'es', form: 'usted',
        });
        expect(await transitionFailureText('cancel_catalog_order', { orderId: order.id }, io('cancelled'))).toBe('Su pedido (Ref. C03EBDD7) quedó anulado.');
        expect(await transitionFailureText('cancel_catalog_order', { orderId: order.id }, io('pending'))).toContain('No pude anular su pedido (Ref. C03EBDD7): sigue vigente.');
    });
});
