import { IntentInterpreterService } from './intent-interpreter.service';
import { BookingEngineService, type BookingState } from './booking-engine.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { dayOfMonthOnly, readDateReference, relativeDayIso } from './date-reference';
import { appointmentCandidates, localizeStatusWords, readTarget, runTransition, transitionDoneText, transitionTexts, type TransitionIO } from './transition-engine';
import { pastDepartureIn } from './catalog-first';
import { groundPolicyReply, hasPolicyEvidence, isUngroundedPolicyAnswer } from './policy-grounding';
import { toUsted } from './register-adapt';
import { stripInternalMarkers } from '../../common/utils/internal-markers.util';
import { normalizeForIntent } from '@parallext/shared';

/**
 * PR #82 review (Opus): the follow-up fixes. Cases are the reviewer's probes plus the production phrases they generalise.
 * «Today» is Friday 2026-10-09 unless a test says otherwise.
 */
const TODAY = '2026-10-09';
const fold = (text: string) => normalizeForIntent(text).replace(/[^\p{L}\p{N}\s:]/gu, ' ').replace(/\s+/g, ' ').trim();
const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const upcomingFrom = (year: number, month: number, day: number) => Array.from({ length: 8 }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1, day + i));
    return { date: d.toISOString().slice(0, 10), weekday: WEEKDAY_EN[d.getUTCDay()] };
});
const appt = (id: string, date: string, time: string) => ({ id, serviceId: 'svc-1', service: 'Corte y estilo', date, time, status: 'confirmed' });
const C3BD5A53 = 'c3bd5a53-2222-4222-8222-222222222222';

// ── 1. past trips are not departures ─────────────────────────────────────────────────────────────────────────────────────────────
describe('catalog-first: only a request for the offer on that date is a past departure', () => {
    it.each([
        'Tengo una reserva del 3 de julio, necesito la factura',
        'Me cobraron dos veces el paquete del 3 de septiembre',
        'Les escribo por el tour del 15 de agosto, quiero dejar una reseña',
        'Viajé el 3 de julio con ustedes',
        'mi viaje del 3 de julio fue genial, quiero otro para diciembre',
        'Quiero un reembolso del paquete del 3 de julio de 2026',
        'Mi reserva del 3 de julio de 2026 estuvo bien',
        // the cue of an offer AND the context of an existing trip: the context wins
        'Quiero dejar una reseña del tour del 15 de agosto; ¿hay disponibilidad para repetirlo?',
        'Tengo una reserva del 3 de julio, ¿hay disponibilidad para cambiarla?',
        'Me cobraron dos veces: ¿qué paquetes tienen para el 3 de septiembre? quiero la factura',
        // a date with no request for the offer at all
        'Llámenme el 3 de julio de 2026',
        'Mi cumpleaños es el 3 de julio',
    ])('"%s" is about a trip that exists or happened: nothing is flagged', text => {
        expect(pastDepartureIn(text, TODAY)).toBeNull();
    });

    it.each([
        ['¿Qué paquetes tienen para el 3 de julio de 2026?', { iso: '2026-07-03', yearStated: true }],
        ['¿Hay disponibilidad para el 3 de julio?', { iso: '2026-07-03', yearStated: false, nextYearIso: '2027-07-03' }],
        ['Somos 40 personas y queremos salir el 15 de agosto de 2026', { iso: '2026-08-15', yearStated: true }],
        ['Quiero viajar el 3 de julio de 2026 a Cartagena', { iso: '2026-07-03', yearStated: true }],
    ])('"%s" asks for the offer: flagged', (text, expected) => {
        expect(pastDepartureIn(text, TODAY)).toEqual(expected);
    });

    it('a year-less day that went by but is close to next year (20 December asking for 5 January) is next January\'s, not «past»', () => {
        expect(pastDepartureIn('¿Qué paquetes tienen para el 5 de enero?', '2026-12-20')).toBeNull();
    });
});

// ── 2. status words: labelled statuses only, never links or quoted names ───────────────────────────────────────────────────────────
describe('localizeStatusWords translates a status where it is named as one', () => {
    it.each([
        ['Su pedido está pending y el pago está paid.', 'Su pedido está pendiente y el pago está pagado.'],
        ['El estado: completed.', 'El estado: completado.'],
        ['El estado del pago: Paid', 'El estado del pago: Pagado'],
        ['El estado es pending, el monto es 119.900 COP.', 'El estado es pendiente, el monto es 119.900 COP.'],
        ['El pedido sigue shipped hasta mañana.', 'El pedido sigue enviado hasta mañana.'],
    ])('"%s"', (input, expected) => {
        expect(localizeStatusWords(input, 'es')).toBe(expected);
    });

    it.each([
        'Pague aquí: https://pay.co/l/x?status=pending&r=1',
        'Ver pay.example.com/order?status=paid',
        'Producto "Delivered Box" disponible',
        'Fast shipping, delivered in 2 days (texto del fabricante)',
        'Pague aquí: https://pay.co/l/x?status=pending&r=1 y su pedido está en camino',
        'El estado del pedido en el enlace https://x.co/o/1?estado=pending',
        'Compre el kit "Estado: pending" hoy',
        'La caja pending llegó, el pago pending también',
    ])('leaves "%s" as it is', text => {
        expect(localizeStatusWords(text, 'es')).toBe(text);
    });

    it('does not double the «en» of the connector («sigue en processing»)', () => {
        expect(localizeStatusWords('El pedido sigue en processing.', 'es')).toBe('El pedido sigue en preparación.');
        expect(localizeStatusWords('El pedido está in_transit.', 'es')).toBe('El pedido está en camino.');
        expect(localizeStatusWords('El pedido está en processing y el pago sigue en pending.', 'es')).toBe('El pedido está en preparación y el pago sigue en pendiente.');
    });

    it('translates the status next to a link without touching the link', () => {
        expect(localizeStatusWords('Su pedido está pending. Pague en https://pay.co/l/x?status=pending', 'es'))
            .toBe('Su pedido está pendiente. Pague en https://pay.co/l/x?status=pending');
    });
});

// ── 3. the booking interpreter uses the same reader ───────────────────────────────────────────────────────────────────────────────
describe('IntentInterpreter (booking) reads the date by the shared rules', () => {
    const interpreter = new IntentInterpreterService({ execute: jest.fn() } as any);
    const read = (text: string, today = TODAY, step = 'idle') => {
        const [y, m, d] = today.split('-').map(Number);
        return interpreter.interpret(text, step, [], today, upcomingFrom(y, m, d), 't');
    };

    it('«el viernes 16 de octubre por la mañana» is the 16th, not tomorrow (the «mañana» of «por la mañana»)', async () => {
        expect((await read('quiero una cita el viernes 16 de octubre por la mañana')).dateMentioned).toBe('2026-10-16');
        expect((await read('quiero una cita el 16 de octubre en la mañana')).dateMentioned).toBe('2026-10-16');
    });

    it('«por la mañana» alone names no day; «mañana» does; «mañana por la mañana» is tomorrow', async () => {
        expect((await read('quiero una cita por la mañana')).dateMentioned).toBeNull();
        expect((await read('quiero una cita mañana')).dateMentioned).toBe('2026-10-10');
        expect((await read('quiero una cita mañana por la mañana')).dateMentioned).toBe('2026-10-10');
        expect((await read('quiero una cita pasado mañana')).dateMentioned).toBe('2026-10-11');
    });

    it('an explicit day beats a «hoy / mañana» said in the same message', async () => {
        expect((await read('quiero cita el 20 de octubre, mañana no puedo')).dateMentioned).toBe('2026-10-20');
        expect((await read('quiero cita el viernes 16 de octubre, hoy no puedo')).dateMentioned).toBe('2026-10-16');
    });

    it('a weekday said on that weekday is the NEXT one; «hoy» keeps today', async () => {
        expect((await read('quiero una cita el viernes')).dateMentioned).toBe('2026-10-16');
        expect((await read('quiero una cita hoy viernes')).dateMentioned).toBe(TODAY);
        expect((await read('quiero una cita hoy')).dateMentioned).toBe(TODAY);
        expect((await read('quiero una cita el martes')).dateMentioned).toBe('2026-10-13');
    });

    it('«el viernes 17» (the 17th is a Saturday) is asked about, not booked today', async () => {
        const intent = await read('quiero una cita para el viernes 17');
        expect(intent.dateMentioned).toBeNull();
        expect(intent.dateWeekdayConflict).toBe(true);
        expect(intent.dateConflictDetail).toEqual({ date: '2026-10-17', weekday: 5 });
    });

    it('a bare day of the month is read: «el 16», «el día 16», «el viernes 16»', async () => {
        for (const text of ['quiero cita el 16', 'quiero cita el dia 16', 'quiero cita el viernes 16']) expect((await read(text)).dateMentioned).toBe('2026-10-16');
    });

    it('two different dates are asked about', async () => {
        const intent = await read('quiero cita el 16 de octubre o el 17 de octubre');
        expect(intent.dateMentioned).toBeNull();
        expect(intent.dateAmbiguous).toBe(true);
    });

    it('a day with no year that already passed this year (far from next year) is a question; a close one is next year\'s', async () => {
        const far = await read('quiero cita el 3 de octubre');
        expect(far.dateMentioned).toBeNull();
        expect(far.dateYearQuestion).toEqual({ thisYear: '2026-10-03', nextYear: '2027-10-03' });
        expect((await read('quiero cita el 5 de enero', '2026-12-20')).dateMentioned).toBe('2027-01-05');
        expect((await read('quiero cita el 5 de enero', '2026-12-20')).dateYearQuestion).toBeUndefined();
    });
});

describe('IntentInterpreter: «el N» of an option is not a date', () => {
    const interpreter = new IntentInterpreterService({ execute: jest.fn() } as any);
    const upcoming = upcomingFrom(2026, 10, 9);

    it.each([
        'quiero el 2 por favor', 'el 2 porfa', 'me interesa el 3', 'quiero el 1 de la lista', 'el 2 de los paquetes', 'mi número es el 5', 'el 9 está bien',
    ])('"%s" at idle: no date is taken', async text => {
        expect((await interpreter.interpret(text, 'idle', ['Consulta'], TODAY, upcoming, 't')).dateMentioned).toBeNull();
    });

    it.each(['show_services', 'show_slots'])('at %s (an option is awaited) «para el 16» is not a date either; «el viernes 16 de octubre» is', async step => {
        expect((await interpreter.interpret('para el 16', step, ['Consulta'], TODAY, upcoming, 't')).dateMentioned).toBeNull();
        expect((await interpreter.interpret('el viernes 16 de octubre', step, ['Consulta'], TODAY, upcoming, 't')).dateMentioned).toBe('2026-10-16');
    });

    it('with date context it is one: «para el 16», «quiero cita el 16»', async () => {
        expect((await interpreter.interpret('para el 16', 'ask_date', ['Consulta'], TODAY, upcoming, 't')).dateMentioned).toBe('2026-10-16');
        expect((await interpreter.interpret('quiero cita el 16', 'idle', [], TODAY, upcoming, 't')).dateMentioned).toBe('2026-10-16');
    });
});

describe('BookingEngine: what cannot be resolved is asked, and the year is said', () => {
    const interpreter = new IntentInterpreterService({ execute: jest.fn() } as any);
    const serviceId = '44444444-4444-4444-8444-444444444444';
    const run = async (texts: string[], today = TODAY) => {
        const state: BookingState = {
            step: 'ask_date', services: [{ id: serviceId, name: 'Consulta', durationMinutes: 30, price: 2500, currency: 'USD' }], serviceId, serviceName: 'Consulta',
        };
        const redis = { get: jest.fn().mockResolvedValue(JSON.stringify(state.services)), set: jest.fn() };
        const toolExecutor = { execute: jest.fn().mockResolvedValue({ available: true, slots: [{ time: '09:00', endTime: '09:30' }] }) };
        const engine = new BookingEngineService({ $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any, redis as any, toolExecutor as any);
        const [y, m, d] = today.split('-').map(Number);
        let current = state;
        const replies: string[] = [];
        for (const text of texts) {
            const intent = await interpreter.interpret(text, current.step, ['Consulta'], today, upcomingFrom(y, m, d), 't');
            const result = await engine.process('tenant_x', 't', 'c', intent, text, current, {}, today, 'es',
                { authority: authorityFor('list_services', 'check_availability', 'create_appointment'), conversationId: 'conv' });
            current = result.state;
            replies.push(result.text ?? '');
        }
        return { replies, state: current, toolExecutor };
    };
    const availabilityDates = (toolExecutor: { execute: jest.Mock }) =>
        toolExecutor.execute.mock.calls.filter(call => call[3] === 'check_availability').map(call => call[4].date);

    it('a weekday that contradicts the date: the question names both, nothing is looked up', async () => {
        const { replies, toolExecutor } = await run(['quiero una cita el viernes 17']);
        expect(replies[0]).toBe('El sábado 17 de octubre no es viernes. ¿Para qué día exactamente?');
        expect(availabilityDates(toolExecutor)).toEqual([]);
    });

    it('a year-less day that already passed: «¿Se refiere al … de 2027?», and a yes takes THAT date', async () => {
        const { replies, state, toolExecutor } = await run(['quiero una cita el 3 de octubre', 'sí']);
        expect(replies[0]).toBe('El 3 de octubre de este año ya pasó. ¿Se refiere al domingo 3 de octubre de 2027?');
        expect(availabilityDates(toolExecutor)).toEqual(['2027-10-03']);
        expect(state.pendingYearDate).toBeUndefined();
    });

    it('anything but a yes drops the question: no date is assumed', async () => {
        const { state, toolExecutor } = await run(['quiero una cita el 3 de octubre', 'mejor el 20 de octubre']);
        expect(availabilityDates(toolExecutor)).toEqual(['2026-10-20']);
        expect(state.pendingYearDate).toBeUndefined();
    });

    it('two dates: asked', async () => {
        const { replies, toolExecutor } = await run(['quiero una cita el 16 de octubre o el 17 de octubre']);
        expect(replies[0]).toBe('Veo más de una fecha en el mensaje. ¿Para cuál día exactamente?');
        expect(availabilityDates(toolExecutor)).toEqual([]);
    });

    it('the year is written whenever it is not the current one (the next January)', async () => {
        const { toolExecutor } = await run(['quiero una cita el 5 de enero'], '2026-12-20');
        expect(availabilityDates(toolExecutor)).toEqual(['2027-01-05']);
    });
});

// ── 4/6. the shared reader ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('date-reference: days of the month, two dates, the year boundary', () => {
    it('«el viernes 17» / «el 16 a las 11» / «para el 16» read the day of the month and check the weekday', () => {
        expect(readDateReference(fold('el viernes 17'), TODAY)).toEqual({ kind: 'conflict', date: '2026-10-17', saidWeekday: 5 });
        expect(readDateReference(fold('el viernes 16'), TODAY)).toEqual({ kind: 'date', date: '2026-10-16', via: 'explicit' });
        expect(readDateReference(fold('el 16 a las 11'), TODAY)).toEqual({ kind: 'date', date: '2026-10-16', via: 'explicit' });
        expect(readDateReference(fold('para el 16'), TODAY)).toEqual({ kind: 'date', date: '2026-10-16', via: 'explicit' });
    });

    it('«el día 31 a las 10» resolves like «el día 31»', () => {
        expect(dayOfMonthOnly(fold('el dia 31 a las 10'), '2026-11-10')).toBe(dayOfMonthOnly(fold('el dia 31'), '2026-11-10'));
        expect(dayOfMonthOnly(fold('el dia 31'), '2026-11-10')).toBe('2026-12-31');
        expect(dayOfMonthOnly(fold('el dia 31'), '2026-10-10')).toBe('2026-10-31');
    });

    it('a number that is an hour, a quantity or the whole message is not a day', () => {
        expect(dayOfMonthOnly(fold('a las 11'), TODAY)).toBeNull();
        expect(dayOfMonthOnly(fold('el 2'), TODAY)).toBeNull();
        expect(dayOfMonthOnly(fold('somos el 15% de descuento'), TODAY)).toBeNull();
        expect(dayOfMonthOnly(fold('el 3 personas'), TODAY)).toBeNull();
        expect(dayOfMonthOnly(fold('el 11:30'), TODAY)).toBeNull();
    });

    it('a number that goes with a selector weekday is not the destination', () => {
        expect(dayOfMonthOnly(fold('la del jueves 15 para el viernes 16'), TODAY)).toBe('2026-10-16');
        expect(readDateReference(fold('la del jueves 15 para el viernes 16'), TODAY, { referenceDate: '2026-10-15' }))
            .toEqual({ kind: 'date', date: '2026-10-16', via: 'explicit' });
    });

    it('two different explicit dates are asked about; the record\'s own date is not a second destination', () => {
        expect(readDateReference(fold('el 16 de octubre o el 17 de octubre'), TODAY)).toEqual({ kind: 'ambiguous', of: 'dates' });
        expect(readDateReference(fold('del 15 de octubre al 16 de octubre'), TODAY, { referenceDate: '2026-10-15' }))
            .toEqual({ kind: 'date', date: '2026-10-16', via: 'explicit' });
    });

    it('20 December: «el 5 de enero» is next January (the year to be stated); a far year-less past day is a question', () => {
        expect(readDateReference(fold('el 5 de enero'), '2026-12-20')).toEqual({ kind: 'date', date: '2027-01-05', via: 'explicit', yearAssumed: true });
        expect(readDateReference(fold('el 3 de octubre'), TODAY)).toEqual({ kind: 'past', date: '2026-10-03', thisYear: true, nextYearDate: '2027-10-03' });
    });

    it('«los domingos», «todos los martes», «cada lunes» are habits, not dates', () => {
        expect(readDateReference(fold('¿Está disponible los domingos?'), TODAY)).toEqual({ kind: 'none' });
        expect(readDateReference(fold('atienden todos los martes'), TODAY)).toEqual({ kind: 'none' });
        expect(readDateReference(fold('cada lunes a las 10'), TODAY)).toEqual({ kind: 'none' });
        expect(readDateReference(fold('el domingo'), TODAY)).toEqual({ kind: 'date', date: '2026-10-11', via: 'weekday' });
    });

    // PR #82 final check: a bare «el N» overwrote the date of a booking («el 9 está bien» became TODAY).
    it.each([
        'quiero el 2 por favor', 'el 2 porfa', 'me interesa el 3', 'quiero el 1 de la lista', 'el 2 de los paquetes', 'mi número es el 5', 'el 9 está bien',
        'quiero el 2', 'me gusta el 4', 'dame el 3', 'el 15 de cada mes', 'atienden el 15 de cada mes', 'el día 15 de cada mes',
    ])('"%s" names no date', text => {
        expect(readDateReference(fold(text), TODAY)).toEqual({ kind: 'none' });
        expect(dayOfMonthOnly(fold(text), TODAY)).toBeNull();
    });

    it.each([
        ['para el 16', '2026-10-16'], ['hasta el 20', '2026-10-20'], ['desde el 12', '2026-10-12'], ['el 16 a las 11', '2026-10-16'],
        ['quiero cita el 16', '2026-10-16'], ['quiero reservar el 16', '2026-10-16'], ['muévela el 16', '2026-10-16'], ['el 16 a la 1', '2026-10-16'],
    ])('"%s" is a day of the month (it has date context)', (text, date) => {
        expect(readDateReference(fold(text), TODAY)).toEqual({ kind: 'date', date, via: 'explicit' });
    });

    it('while the customer is choosing among options that were shown, a bare «el N» is the option', () => {
        expect(readDateReference(fold('para el 16'), TODAY, { allowBareDay: false })).toEqual({ kind: 'none' });
        // the other forms still name a date
        expect(readDateReference(fold('el viernes 16'), TODAY, { allowBareDay: false })).toEqual({ kind: 'date', date: '2026-10-16', via: 'explicit' });
        expect(readDateReference(fold('el dia 16'), TODAY, { allowBareDay: false })).toEqual({ kind: 'date', date: '2026-10-16', via: 'explicit' });
    });

    it('a discount or an amount after a number is not a day', () => {
        expect(dayOfMonthOnly(fold('somos el 15 de descuento'), TODAY)).toBeNull();
        expect(dayOfMonthOnly(fold('el 20 pesos'), TODAY)).toBeNull();
    });

    it('relative days: the morning is not tomorrow', () => {
        expect(relativeDayIso(fold('el viernes por la mañana'), TODAY)).toBeNull();
        expect(relativeDayIso(fold('mañana por la mañana'), TODAY)).toBe('2026-10-10');
        expect(relativeDayIso(fold('esta mañana'), TODAY)).toBeNull();
    });
});

describe('reschedule: the proposal states the year, and a day that cannot be read is asked', () => {
    const wed = appointmentCandidates({ appointments: [appt(C3BD5A53, '2026-12-23', '10:00')] })[0];

    it('20 December → «el 5 de enero» is proposed with its year', async () => {
        const io: TransitionIO = {
            execute: async (name: string) => (name === 'list_customer_appointments' ? { appointments: [appt(C3BD5A53, '2026-12-23', '10:00')] }
                : name === 'check_availability' ? { slots: [{ time: '10:00' }] } : { error: 'confirmation_required' }),
            interpretTarget: async () => null, todayIso: '2026-12-20', nowTime: '09:00', language: 'es', form: 'usted',
        };
        const out = await runTransition({ verb: 'reschedule', domain: 'appointment' }, 'muévela para el 5 de enero', io);
        expect(out.awaitsConsent).toBe(true);
        expect(out.text).toContain('al martes 5 de enero de 2027 a las 10:00');
        // the year of the current year is not repeated
        expect(out.text).toContain('del miércoles 23 de diciembre a las 10:00');
    });

    it('what the server reports after the yes carries the year too', () => {
        const done = transitionDoneText('reschedule_appointment', { appointmentId: C3BD5A53, newDate: '2027-01-05', newTime: '10:00' },
            { success: true, appointment: { id: C3BD5A53, date: '2027-01-05', time: '10:00' } }, 'es', 'usted', '2026-12-20');
        expect(done).toBe('Su cita (Ref. C3BD5A53) quedó reprogramada para el martes 5 de enero de 2027 a las 10:00.');
        expect(transitionDoneText('reschedule_appointment', { appointmentId: C3BD5A53, newDate: '2026-12-28', newTime: '10:00' },
            { success: true, appointment: { id: C3BD5A53, date: '2026-12-28', time: '10:00' } }, 'es', 'usted', '2026-12-20'))
            .toBe('Su cita (Ref. C3BD5A53) quedó reprogramada para el lunes 28 de diciembre a las 10:00.');
    });

    it('two dates and a day of the month that contradicts the weekday are asked', () => {
        expect(readTarget('muévela para el 16 de octubre o el 17 de octubre', wed, null, TODAY)).toEqual({ kind: 'ask' });
        expect(readTarget('muévela para el viernes 17', wed, null, TODAY)).toEqual({ kind: 'conflict', date: '2026-10-17', weekday: 5 });
        expect(readTarget('muévela para el 16 a las 11', wed, null, TODAY)).toMatchObject({ kind: 'target', date: '2026-10-16', time: '10:00' });
    });
});

// ── 5. the register never touches names ─────────────────────────────────────────────────────────────────────────────────────────────
describe('toUsted leaves names and nouns alone', () => {
    it.each([
        ['Bienvenido a Tu Look, soy Luna, tu asistente. ¿Te gustaría agendar?', ['Tu Look', 'Luna'], 'Bienvenido a Tu Look, soy Luna, su asistente. ¿Le gustaría agendar?'],
        ['Bienvenida a Tus Uñas Spa 💅 Dime qué necesitas', ['Tus Uñas Spa'], 'Bienvenida a Tus Uñas Spa 💅 Dígame qué necesita'],
        ['Hola! Soy Ana de Estudio Contraparte. ¿En qué puedo ayudarte?', ['Ana'], 'Hola! Soy Ana de Estudio Contraparte. ¿En qué puedo ayudarle?'],
        ['Somos Baluarte Barbería, cuéntame', [], 'Somos Baluarte Barbería, cuénteme'],
        ['Hola, soy Marco, te espero en la parte norte del corte de pelo', [], 'Hola, soy Marco, le espero en la parte norte del corte de pelo'],
        ['Para ti tenemos lo mejor. ¿Qué buscas? Té de cortesía incluido.', [], 'Para ti tenemos lo mejor. ¿Qué busca? Té de cortesía incluido.'],
    ])('"%s"', (input, names, expected) => {
        expect(toUsted(input, names)).toBe(expected);
    });

    it('a declared name is kept even where it opens a sentence or is written in lower case', () => {
        expect(toUsted('Tu Look te da la bienvenida', ['Tu Look'])).toBe('Tu Look le da la bienvenida');
        expect(toUsted('Bienvenido a tu estilo studio, te ayudo', ['tu estilo studio'])).toBe('Bienvenido a tu estilo studio, le ayudo');
        expect(toUsted('Tu Look te da la bienvenida')).toBe('Su Look le da la bienvenida');
    });

    it('a capitalised Tu / Tus / Te in the middle of a sentence is a name even when it was not declared; at the start of one it is the pronoun', () => {
        expect(toUsted('Visite Tu Look y Tus Ideas Spa')).toBe('Visite Tu Look y Tus Ideas Spa');
        expect(toUsted('Hola. Tu cita está lista. ¡Te esperamos!')).toBe('Hola. Su cita está lista. ¡Le esperamos!');
    });

    it('the «-arte / -erte / -irte» rule is a closed list of verbs', () => {
        expect(toUsted('Estoy aquí para ayudarte, atenderte y verte.')).toBe('Estoy aquí para ayudarle, atenderle y verle.');
        for (const noun of ['Contraparte', 'Baluarte', 'la parte de arriba', 'el corte', 'un deporte', 'mi suerte', 'el Norte']) expect(toUsted(noun)).toBe(noun);
    });
});

// ── 7. policy grounding: owner sources, only the unsupported sentences ────────────────────────────────────────────────────────────
describe('policy grounding: owner-written text is a source, and only the unsupported sentences go', () => {
    it('<business><about> (and the other owner blocks) count; the contract does not', () => {
        const about = '<contract>never invent policies</contract><business><about>Cancelaciones sin costo hasta 24 horas antes de la cita.</about></business><persona>Soy Luna</persona>';
        expect(hasPolicyEvidence({ systemPrompt: about })).toBe(true);
        expect(hasPolicyEvidence({ systemPrompt: '<main_instructions>Cancelar con 12 horas de antelación, sin cargo.</main_instructions>' })).toBe(true);
        expect(hasPolicyEvidence({ systemPrompt: '<contract>Cancelaciones sin costo hasta 24 horas.</contract><persona>Soy Luna</persona>' })).toBe(false);
        expect(isUngroundedPolicyAnswer({ userText: '¿Se puede cancelar sin costo?', reply: 'Sí, puede cancelar sin costo hasta 24 horas antes.', systemPrompt: about })).toBe(false);
    });

    it('«El corte cuesta 30.000 COP. Normalmente puede cancelar cuando quiera.» keeps the price and drops the invented policy', () => {
        const out = groundPolicyReply({
            userText: '¿Cuánto cuesta el corte? y si cancelo?', reply: 'El corte cuesta 30.000 COP. Normalmente puede cancelar cuando quiera.', lang: 'es', canOfferPerson: true,
        });
        expect(out).toEqual({
            whole: false,
            text: 'El corte cuesta 30.000 COP. No tengo información sobre la política de cancelación de este negocio, así que no puedo confirmarle si tiene costo. ¿Quiere que le pida a una persona del equipo que lo confirme?',
        });
    });

    it('a trailing question about the policy is dropped (the offer is the one question), and a fully invented reply is replaced whole', () => {
        const partial = groundPolicyReply({
            userText: '¿Se puede cancelar sin costo?', reply: 'Su cita es el jueves 15 a las 10:00. Por lo general se cancela sin costo. ¿Quiere que le confirme la política?', lang: 'es', canOfferPerson: false,
        });
        expect(partial).toEqual({ whole: false, text: 'Su cita es el jueves 15 a las 10:00. No tengo información sobre la política de cancelación de este negocio, así que no puedo confirmarle si tiene costo.' });
        expect(groundPolicyReply({ userText: '¿Se puede cancelar sin costo?', reply: 'Por lo general sí, sin costo.', lang: 'es', canOfferPerson: true })?.whole).toBe(true);
        expect(groundPolicyReply({ userText: '¿Se puede cancelar sin costo?', reply: 'Por lo general sí, sin costo.', lang: 'es', canOfferPerson: true, retrievedKnowledge: [{ title: 'Cancelaciones', content: 'Sin costo.' }] })).toBeNull();
    });
});

// ── 8. markers: a product is never stripped ───────────────────────────────────────────────────────────────────────────────────────────
describe('internal markers: a localised label is stripped for a question or a retrieved title only', () => {
    it('products and codes stay', () => {
        for (const text of ['Disponible: [Artículo: Camiseta Azul Talla M] a 50.000', 'Ref [Artículo: 4512] disponible', 'Ver [Articles: Summer Collection Dress]', 'Tenemos [Artigo: Tênis Corrida Pro Azul]'])
            expect(stripInternalMarkers(text)).toBe(text);
    });

    it('a question is a citation; so is the exact title of a source the turn retrieved', () => {
        expect(stripInternalMarkers('Cancelación gratuita [Artículo: ¿Cuál es la política de cancelación?]')).toBe('Cancelación gratuita');
        expect(stripInternalMarkers('Aceptamos tarjeta [Artículo: Medios de pago]', ['Medios de pago'])).toBe('Aceptamos tarjeta');
        expect(stripInternalMarkers('Aceptamos tarjeta [Artículo: Medios de pago]')).toBe('Aceptamos tarjeta [Artículo: Medios de pago]');
        expect(stripInternalMarkers('Disponible: [Artículo: Camiseta Azul Talla M] a 50.000', ['Medios de pago'])).toBe('Disponible: [Artículo: Camiseta Azul Talla M] a 50.000');
        expect(stripInternalMarkers('Hola [Article: Envíos]')).toBe('Hola');
    });
});

// ── DECISION: an appointment that already started is shown, not cancelled or moved by chat ───────────────────────────────────────────────
describe('an appointment whose start time has passed is listed, but cancelling / moving it by chat is refused with an offer of a person', () => {
    const TODAY_NOON = { todayIso: TODAY, nowTime: '12:00' };
    function build(appointments: any[]) {
        const calls: Array<{ name: string; args: any }> = [];
        const io: TransitionIO = {
            execute: async (name: string, args: any) => {
                calls.push({ name, args });
                if (name === 'list_customer_appointments') return { appointments };
                if (name === 'check_availability') return { slots: [{ time: '15:00' }, { time: '10:00' }] };
                return { error: 'confirmation_required' };
            },
            interpretTarget: async () => ({ date: '2026-10-16', time: '15:00' }), language: 'es', form: 'usted', ...TODAY_NOON,
        };
        return { io, calls };
    }
    const writers = (calls: Array<{ name: string }>) => calls.filter(call => ['cancel_appointment', 'reschedule_appointment'].includes(call.name));

    it('the list still shows it (visibility)', async () => {
        const { io } = build([appt(C3BD5A53, TODAY, '09:00'), appt('d5959ea9-3333-4333-8333-333333333333', '2026-10-13', '09:00')]);
        const out = await runTransition({ verb: 'list', domain: 'appointment' }, '¿qué citas tengo?', io);
        expect(out.text).toContain('viernes 9 de octubre a las 09:00 (Ref. C3BD5A53)');
    });

    it.each([
        ['cancel', 'quiero cancelar la cita C3BD5A53', /no puedo cancelarla desde este chat/],
        ['reschedule', 'muevo la cita C3BD5A53 para el viernes 16 a las 15:00', /no puedo moverla desde este chat/],
    ] as const)('%s: refused, nothing proposed, a person is offered', async (verb, text, refusal) => {
        const { io, calls } = build([appt(C3BD5A53, TODAY, '09:00')]);
        const out = await runTransition({ verb, domain: 'appointment' }, text, io);
        expect(out.text).toMatch(refusal);
        expect(out.text).toContain('(Ref. C3BD5A53)');
        expect(out.text).toContain('¿Desea que le pida a una persona del equipo');
        expect(out.offersPerson).toBe(true);
        expect(out.awaitsConsent).toBeUndefined();
        expect(writers(calls)).toEqual([]);
    });

    it('a day before today counts as started; later today does not', async () => {
        const yesterday = build([appt(C3BD5A53, '2026-10-08', '15:00')]);
        expect((await runTransition({ verb: 'cancel', domain: 'appointment' }, 'cancela la cita C3BD5A53', yesterday.io)).offersPerson).toBe(true);
        const later = build([appt(C3BD5A53, TODAY, '15:00')]);
        const proposal = await runTransition({ verb: 'cancel', domain: 'appointment' }, 'cancela la cita C3BD5A53', later.io);
        expect(proposal.awaitsConsent).toBe(true);
        expect(writers(later.calls)).toHaveLength(1);
    });

    it('the refusal exists in four languages', () => {
        const cand = appointmentCandidates({ appointments: [appt(C3BD5A53, TODAY, '09:00')] })[0];
        for (const lang of ['es', 'en', 'pt', 'fr']) {
            expect(transitionTexts(lang, 'usted').alreadyStarted('cancel', cand)).toContain('C3BD5A53');
        }
    });
});
