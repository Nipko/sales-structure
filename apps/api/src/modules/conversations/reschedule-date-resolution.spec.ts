import { IntentInterpreterService } from './intent-interpreter.service';
import { explicitDates, readDateReference, weekdayMentions } from './date-reference';
import { appointmentCandidates, readTarget, resolveTarget, runTransition, transitionTexts, type TransitionIO } from './transition-engine';
import { normalizeForIntent } from '@parallext/shared';

/**
 * Production 2026-10-09 (a Friday), «Salón QA Citas» on Telegram, after PR #78/#80/#81.
 *
 *   «reprograma la cita F0080B9A para el viernes 16 de octubre a las 11:00»
 *      → «¿Confirma que movamos … al viernes 9 de octubre a las 11:00?» → «sí» → «quedó reprogramada para el viernes 9 de octubre»
 *      (the weekday won over the day of the month, and it fell on TODAY; the moved appointment then vanished from the list);
 *   «la del miércoles, C3BD5A53, para el viernes 16 de octubre a las 11:00»
 *      → «… del miércoles 14 a las 10:00 al miércoles 14 a las 11:00» (only the hour moved: the first weekday of a dictionary won).
 *   Without the weekday («el 16 de octubre a las 11:00») it worked.
 */
const TODAY = '2026-10-09'; // Friday
const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const UPCOMING = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 9 + i));
    return { date: d.toISOString().slice(0, 10), weekday: WEEKDAY_EN[d.getUTCDay()] };
});

const fold = (text: string) => normalizeForIntent(text).replace(/[^\p{L}\p{N}\s:]/gu, ' ').replace(/\s+/g, ' ').trim();
const F0080B9A = 'f0080b9a-1111-4111-8111-111111111111';
const C3BD5A53 = 'c3bd5a53-2222-4222-8222-222222222222';
const D5959EA9 = 'd5959ea9-3333-4333-8333-333333333333';
const AE3D0C86 = 'ae3d0c86-4444-4444-8444-444444444444';
const appt = (id: string, date: string, time: string) => ({ id, serviceId: 'svc-1', service: 'Corte y estilo', date, time, status: 'confirmed' });

describe('date-reference: the calendar words of a message', () => {
    it('reads the day + month, with the year when it is said', () => {
        expect(explicitDates(fold('el viernes 16 de octubre a las 11:00'), TODAY).map(d => d.date)).toEqual(['2026-10-16']);
        expect(explicitDates(fold('15 de agosto de 2026'), TODAY)).toMatchObject([{ date: '2026-08-15', yearStated: true, rolledForward: false }]);
        // a stated year is kept whatever it is: a past day of this year is NOT moved to next year, and another year is not replaced by this one
        expect(explicitDates(fold('15 de agosto de 2027'), TODAY)).toMatchObject([{ date: '2027-08-15', yearStated: true, rolledForward: false }]);
        expect(explicitDates(fold('3 de julio del 2025'), TODAY)).toMatchObject([{ date: '2025-07-03', yearStated: true, rolledForward: false }]);
        // no year and already gone this year: rolled forward, and SAID so (the caller decides what to do with it)
        expect(explicitDates(fold('el 3 de julio'), TODAY)).toMatchObject([{ date: '2027-07-03', thisYearDate: '2026-07-03', yearStated: false, rolledForward: true }]);
        expect(explicitDates(fold('october 16'), TODAY).map(d => d.date)).toEqual(['2026-10-16']);
        expect(explicitDates(fold('31 de febrero'), TODAY)).toEqual([]);
    });

    it('lists the weekdays in the order they were said, flagging the one that names the record', () => {
        expect(weekdayMentions(fold('la del miércoles, C3BD5A53, para el viernes 16 de octubre')))
            .toMatchObject([{ weekday: 3, selector: true }, { weekday: 5, selector: false }]);
        expect(weekdayMentions(fold('muévela de jueves a viernes'))).toMatchObject([{ weekday: 4, selector: true }, { weekday: 5, selector: false }]);
        // Portuguese «segunda… sexta» are also Spanish ordinals: only with «feira»
        expect(weekdayMentions(fold('quiero la segunda opción'))).toEqual([]);
        expect(weekdayMentions(fold('na segunda-feira'))).toMatchObject([{ weekday: 1 }]);
    });

    it('an explicit date beats the weekday; a bare weekday said on that weekday is the NEXT one', () => {
        expect(readDateReference(fold('para el viernes 16 de octubre a las 11:00'), TODAY)).toEqual({ kind: 'date', date: '2026-10-16', via: 'explicit' });
        expect(readDateReference(fold('para el viernes'), TODAY)).toEqual({ kind: 'date', date: '2026-10-16', via: 'weekday' });
        expect(readDateReference(fold('para el martes'), TODAY)).toEqual({ kind: 'date', date: '2026-10-13', via: 'weekday' });
        expect(readDateReference(fold('hoy viernes'), TODAY)).toEqual({ kind: 'date', date: TODAY, via: 'weekday' });
    });

    it('a weekday that disagrees with the day of the month is a conflict, never a guess', () => {
        expect(readDateReference(fold('para el viernes 17 de octubre'), TODAY)).toEqual({ kind: 'conflict', date: '2026-10-17', saidWeekday: 5 });
        expect(readDateReference(fold('el martes o el miércoles'), TODAY)).toEqual({ kind: 'ambiguous' });
    });

    it('a date that already passed is reported as past (and a day with no year is NOT rolled into next year in silence)', () => {
        expect(readDateReference(fold('el 3 de julio'), TODAY)).toEqual({ kind: 'past', date: '2026-07-03', thisYear: true });
        expect(readDateReference(fold('el 3 de julio de 2026'), TODAY)).toEqual({ kind: 'past', date: '2026-07-03', thisYear: false });
        // the booking interpreter keeps rolling a bare «10 de enero» forward
        expect(readDateReference(fold('el 10 de enero'), TODAY, { rolledIsPast: false })).toEqual({ kind: 'date', date: '2027-01-10', via: 'explicit' });
    });
});

describe('IntentInterpreter: the explicit date is not overwritten by the weekday', () => {
    const interpreter = new IntentInterpreterService({ execute: jest.fn() } as any);
    const read = (text: string) => interpreter.interpret(text, 'idle', [], TODAY, UPCOMING, 'tenant');

    it.each([
        ['reprograma la cita F0080B9A para el viernes 16 de octubre a las 11:00', '2026-10-16', '11:00'],
        ['la del miércoles, C3BD5A53, para el viernes 16 de octubre a las 11:00', '2026-10-16', '11:00'],
        ['quiero mover la cita C3BD5A53 para el viernes 16 de octubre a las 11:00', '2026-10-16', '11:00'],
        ['quiero mover la cita C3BD5A53 para el 16 de octubre a las 11:00', '2026-10-16', '11:00'],
    ])('"%s" → %s %s', async (text, date, time) => {
        const intent = await read(text);
        expect(intent.dateMentioned).toBe(date);
        expect(intent.timeMentioned).toBe(time);
        expect(intent.dateWeekdayConflict).toBeUndefined();
    });

    it('reports a weekday that disagrees with the date instead of choosing one', async () => {
        const intent = await read('quiero la cita el viernes 17 de octubre a las 11:00');
        expect(intent.dateMentioned).toBeNull();
        expect(intent.dateWeekdayConflict).toBe(true);
    });

    it('honours a stated year (15 de agosto de 2026 is not 2027) and keeps rolling a year-less past day forward', async () => {
        expect((await read('Somos 40 personas y queremos salir el 15 de agosto de 2026')).dateMentioned).toBe('2026-08-15');
        expect((await read('quiero una cita el 10 de enero')).dateMentioned).toBe('2027-01-10');
    });

    it('a bare weekday is the first matching day of the calendar it was given, in the order the customer wrote them', async () => {
        expect((await read('quiero una cita el martes')).dateMentioned).toBe('2026-10-13');
        expect((await read('el jueves o el martes')).dateMentioned).toBe('2026-10-15');
        expect((await read('pasado mañana a las 10')).dateMentioned).toBe('2026-10-11');
    });
});

describe('reschedule target: explicit date > weekday, selector weekdays are not destinations', () => {
    const base = appointmentCandidates({ appointments: [appt(F0080B9A, '2026-10-15', '10:00')] })[0];
    const wednesday = appointmentCandidates({ appointments: [appt(C3BD5A53, '2026-10-14', '10:00')] })[0];
    // what the interpreter used to hand over: the weekday of TODAY / the selector weekday, ignoring the date
    const buggyToday = { date: TODAY, time: '11:00' };
    const buggySelector = { date: '2026-10-14', time: '11:00' };

    it('«reprograma la cita F0080B9A para el viernes 16 de octubre a las 11:00» goes to the 16th, not to today', () => {
        expect(resolveTarget('reprograma la cita F0080B9A para el viernes 16 de octubre a las 11:00', base, buggyToday, TODAY))
            .toEqual({ date: '2026-10-16', time: '11:00' });
    });

    it('«la del miércoles, C3BD5A53, para el viernes 16 de octubre a las 11:00» moves the DAY, not only the hour', () => {
        expect(resolveTarget('la del miércoles, C3BD5A53, para el viernes 16 de octubre a las 11:00', wednesday, buggySelector, TODAY))
            .toEqual({ date: '2026-10-16', time: '11:00' });
    });

    it('without the weekday it still works', () => {
        expect(resolveTarget('quiero mover la cita C3BD5A53 para el 16 de octubre a las 11:00', wednesday, buggySelector, TODAY))
            .toEqual({ date: '2026-10-16', time: '11:00' });
    });

    it('«el viernes» said on a Friday is NEXT Friday, never today', () => {
        expect(resolveTarget('quiero mover la cita para el viernes', wednesday, { date: TODAY, time: null }, TODAY)).toEqual({ date: '2026-10-16', time: '10:00' });
        // «hoy» is today
        expect(resolveTarget('mejor hoy a las 15:00', wednesday, { date: 'today', time: '15:00' }, TODAY)).toEqual({ date: TODAY, time: '15:00' });
    });

    it('a weekday that is only the SELECTOR of the record is not where it goes (only the hour changes: no day was given)', () => {
        const thursday22 = appointmentCandidates({ appointments: [appt(AE3D0C86, '2026-10-22', '09:00')] })[0];
        expect(resolveTarget('la del jueves, mejor a las 11:00', thursday22, { date: '2026-10-15', time: '11:00' }, TODAY))
            .toEqual({ date: '2026-10-22', time: '11:00' });
    });

    it('a day named in a way that cannot be read is asked, never turned into «only the hour changes»', () => {
        expect(readTarget('muévela para la próxima semana a las 11:00', wednesday, { date: null, time: '11:00' }, TODAY)).toEqual({ kind: 'ask' });
        expect(readTarget('el martes o el miércoles a las 11', wednesday, { date: null, time: '11:00' }, TODAY)).toEqual({ kind: 'ask' });
    });

    it('a weekday that contradicts the date is a conflict; a past or year-less past date is reported as past', () => {
        expect(readTarget('para el viernes 17 de octubre a las 11:00', wednesday, buggyToday, TODAY)).toEqual({ kind: 'conflict', date: '2026-10-17', weekday: 5 });
        expect(readTarget('para el 3 de julio a las 11:00', wednesday, null, TODAY)).toEqual({ kind: 'past', date: '2026-07-03' });
        expect(readTarget('para el 8 de octubre a las 11:00', wednesday, null, TODAY)).toEqual({ kind: 'past', date: '2026-10-08' });
    });

    it('«pasado mañana» is two days away (the interpreter reads the «mañana» inside it as tomorrow)', () => {
        expect(resolveTarget('pasado mañana a las 11', wednesday, { date: 'tomorrow', time: '11:00' }, TODAY)).toEqual({ date: '2026-10-11', time: '11:00' });
    });
});

describe('runTransition: the moved appointment is proposed on the date the customer said, or the customer is asked', () => {
    function build(appointments: any[], interpreted: { date: string | null; time: string | null }, over: Partial<TransitionIO> = {}) {
        const calls: Array<{ name: string; args: any }> = [];
        const io: TransitionIO = {
            execute: async (name, args) => {
                calls.push({ name, args });
                if (name === 'list_customer_appointments') return { appointments };
                if (name === 'check_availability') return { slots: ['09:00', '09:30', '10:00', '10:30', '11:00', '12:00'].map(time => ({ time })) };
                return { error: 'confirmation_required', confirmationId: 'conf-1' };
            },
            interpretTarget: async () => interpreted, todayIso: TODAY, nowTime: '08:42', language: 'es', form: 'usted', ...over,
        };
        return { io, calls };
    }
    const writerCalls = (calls: Array<{ name: string; args: any }>) => calls.filter(call => call.name === 'reschedule_appointment');

    it('F0080B9A → viernes 16 de octubre a las 11:00 (the interpreter said today)', async () => {
        const { io, calls } = build([appt(F0080B9A, '2026-10-15', '10:00')], { date: TODAY, time: '11:00' });
        const out = await runTransition({ verb: 'reschedule', domain: 'appointment' },
            'reprograma la cita F0080B9A para el viernes 16 de octubre a las 11:00', io);
        expect(out.awaitsConsent).toBe(true);
        expect(out.text).toContain('del jueves 15 de octubre a las 10:00 al viernes 16 de octubre a las 11:00');
        expect(out.text).not.toContain('9 de octubre');
        expect(writerCalls(calls)).toEqual([{ name: 'reschedule_appointment', args: { appointmentId: F0080B9A, newDate: '2026-10-16', newTime: '11:00' } }]);
    });

    it('C3BD5A53 → viernes 16 de octubre a las 11:00 (the interpreter said the miércoles)', async () => {
        const { io, calls } = build([appt(C3BD5A53, '2026-10-14', '10:00'), appt(D5959EA9, '2026-10-13', '09:00')], { date: '2026-10-14', time: '11:00' });
        const out = await runTransition({ verb: 'reschedule', domain: 'appointment' },
            'la del miércoles, C3BD5A53, para el viernes 16 de octubre a las 11:00', io, { continuation: true });
        expect(out.text).toContain('del miércoles 14 de octubre a las 10:00 al viernes 16 de octubre a las 11:00');
        expect(writerCalls(calls)[0].args).toEqual({ appointmentId: C3BD5A53, newDate: '2026-10-16', newTime: '11:00' });
    });

    it('«para el viernes» on a Friday proposes next Friday, with the date written out for the customer to confirm', async () => {
        const { io, calls } = build([appt(D5959EA9, '2026-10-13', '09:00')], { date: TODAY, time: null });
        const out = await runTransition({ verb: 'reschedule', domain: 'appointment' }, 'quiero mover la cita D5959EA9 para el viernes', io);
        expect(out.text).toContain('al viernes 16 de octubre a las 09:00');
        expect(writerCalls(calls)[0].args.newDate).toBe('2026-10-16');
    });

    it('never proposes a move to a past moment: yesterday, or today at a time that has gone by', async () => {
        const first = build([appt(C3BD5A53, '2026-10-14', '10:00')], { date: '2026-10-08', time: '11:00' });
        const yesterday = await runTransition({ verb: 'reschedule', domain: 'appointment' }, 'muévela para el 8 de octubre a las 11:00', first.io);
        expect(yesterday.text).toContain('Esa fecha ya pasó');
        expect(writerCalls(first.calls)).toEqual([]);

        const second = build([appt(C3BD5A53, '2026-10-14', '10:00')], { date: 'today', time: '08:00' });
        const earlierToday = await runTransition({ verb: 'reschedule', domain: 'appointment' }, 'muévela para hoy a las 08:00', second.io);
        expect(earlierToday.text).toContain('Esa fecha ya pasó');
        expect(writerCalls(second.calls)).toEqual([]);

        // later today is fine
        const third = build([appt(C3BD5A53, '2026-10-14', '10:00')], { date: 'today', time: '11:00' });
        const laterToday = await runTransition({ verb: 'reschedule', domain: 'appointment' }, 'muévela para hoy a las 11:00', third.io);
        expect(laterToday.awaitsConsent).toBe(true);
        expect(writerCalls(third.calls)[0].args).toEqual({ appointmentId: C3BD5A53, newDate: TODAY, newTime: '11:00' });
    });

    it('a weekday that contradicts the date is asked about, and nothing is proposed', async () => {
        const { io, calls } = build([appt(C3BD5A53, '2026-10-14', '10:00')], { date: TODAY, time: '11:00' });
        const out = await runTransition({ verb: 'reschedule', domain: 'appointment' }, 'muévela para el viernes 17 de octubre a las 11:00', io);
        expect(out.text).toContain('El sábado 17 de octubre no es viernes');
        expect(out.awaitsConsent).toBeUndefined();
        expect(writerCalls(calls)).toEqual([]);
    });

    it('the conflict text exists in the four languages', () => {
        const cand = appointmentCandidates({ appointments: [appt(C3BD5A53, '2026-10-14', '10:00')] })[0];
        for (const [lang, expected] of [['es', 'no es viernes'], ['en', 'is not a Friday'], ['pt', 'não é sexta-feira'], ['fr', 'n’est pas un vendredi']] as const) {
            expect(transitionTexts(lang, 'usted').dateConflict(cand, '2026-10-17', 5)).toContain(expected);
        }
    });
});

describe('A4 pivot: «quiero cancelar la D5959EA9» → «no, mejor reprográmala para el viernes»', () => {
    const appointments = [appt(AE3D0C86, '2026-10-12', '09:00'), appt(D5959EA9, '2026-10-13', '09:00')];
    function build() {
        const calls: Array<{ name: string; args: any }> = [];
        const io: TransitionIO = {
            execute: async (name, args) => {
                calls.push({ name, args });
                if (name === 'list_customer_appointments') return { appointments };
                if (name === 'check_availability') return { slots: [{ time: '09:00' }] };
                return { error: 'confirmation_required' };
            },
            interpretTarget: async () => ({ date: TODAY, time: null }), todayIso: TODAY, nowTime: '08:42', language: 'es', form: 'usted',
        };
        return { io, calls };
    }

    it('without the pending target the customer is asked «¿cuál desea mover?» (the defect)', async () => {
        const { io } = build();
        const out = await runTransition({ verb: 'reschedule', domain: 'appointment' }, 'no, mejor reprográmala para el viernes', io);
        expect(out.text).toContain('¿Cuál desea mover?');
    });

    it('with the cancellation proposal\'s record carried over, the move of THAT appointment is proposed', async () => {
        const { io, calls } = build();
        const out = await runTransition({ verb: 'reschedule', domain: 'appointment' }, 'no, mejor reprográmala para el viernes', io, { pivotTargetId: D5959EA9 });
        expect(out.awaitsConsent).toBe(true);
        expect(out.text).toContain('(Ref. D5959EA9) del martes 13 de octubre a las 09:00 al viernes 16 de octubre a las 09:00');
        expect(calls.filter(call => call.name === 'reschedule_appointment')[0].args).toEqual({ appointmentId: D5959EA9, newDate: '2026-10-16', newTime: '09:00' });
    });

    it('a record the new words name wins over the carried one', async () => {
        const { io, calls } = build();
        await runTransition({ verb: 'reschedule', domain: 'appointment' }, 'mejor la AE3D0C86 para el viernes', io, { pivotTargetId: D5959EA9 });
        expect(calls.filter(call => call.name === 'reschedule_appointment')[0].args.appointmentId).toBe(AE3D0C86);
    });
});
