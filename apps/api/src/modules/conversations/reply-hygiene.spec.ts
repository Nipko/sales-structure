import { auditTurnClaim, claimsCompletedAction } from '../../common/utils/outcome-claim.util';
import { isBusinessWriteTool } from './tool-policy-registry';
import { sanitizeRewrittenReply } from './rewrite-validation';
import { correctRelativeWeekdays } from './relative-weekday';

/**
 * Production 2026-10-09, «¿qué pedidos tengo?»: the model listed the orders («… un Audífono QA Aurora, cuyo estado es cancelado»),
 * the claim audit read the status as an unbacked action, the corrective LLM rewrite came back as the message between quotes
 * followed by a comment about itself in English, and that was sent to the customer.
 */
const isBackingTool = (name: string) => isBusinessWriteTool(name);

describe('stating a record\'s status is not claiming an action', () => {
    const listing = [
        'Usted tiene dos pedidos: el C03EBDD7 está pendiente y el otro, un Audífono QA Aurora, cuyo estado es cancelado.',
        'El otro pedido (Ref. D1D0D14A) está cancelado.',
        'Su pedido, cuyo estado es cancelado, no se entregará.',
    ];

    // what the turn read: the pending order C03EBDD7 and the cancelled one D1D0D14A (an Audífono QA Aurora)
    const read = [{ status: 'pending', tokens: ['C03EBDD7', 'Audífono QA Aurora'] }, { status: 'cancelled', tokens: ['D1D0D14A', 'Audífono QA Aurora'] }];

    it.each(listing)('with the orders read this turn: "%s"', text => {
        const audit = auditTurnClaim(text, [], { isBackingTool, recordFacts: read });
        expect(audit.falseClaim).toBe(false);
    });

    it('naming «el estado» excuses nothing by itself: without a record read, «está cancelado» is still a claim', () => {
        expect(claimsCompletedAction('Su pedido, cuyo estado es cancelado, no se entregará.')).toBe(false);
        expect(claimsCompletedAction('El estado de su pedido está cancelado.')).toBe(true);
        expect(claimsCompletedAction('El estado de su pedido D1D0D14A está cancelado.', { recordFacts: read })).toBe(false);
    });

    it.each([
        'El estado de su reserva está confirmada.', 'Su cita de Corte y estilo está agendada para el viernes.', 'El estado de su pago está pagado.',
        'El estado de su cita está confirmada.', 'The status of your booking is confirmed.',
    ])('a booking or payment status worded as a status is still the claim it is: "%s"', text => {
        const facts = [{ status: 'confirmed', tokens: ['AE3D0C86', 'Corte y estilo'] }, { status: 'paid', tokens: ['C03EBDD7'] }, { status: 'scheduled', tokens: ['reserva', 'cita'] }];
        expect(claimsCompletedAction(text)).toBe(true);
        expect(claimsCompletedAction(text, { recordFacts: facts })).toBe(true);
    });

    it('«está cancelado» repeats the status of a record that was READ; about nothing that was read it is still a claim', () => {
        expect(claimsCompletedAction('El pedido D1D0D14A está cancelado.', { recordFacts: read })).toBe(false);
        expect(claimsCompletedAction('El audífono qa aurora está cancelado.', { recordFacts: read })).toBe(false);
        // the record read was PENDING, or another one: the sentence says something the turn did not read
        expect(claimsCompletedAction('El pedido C03EBDD7 está cancelado.', { recordFacts: read })).toBe(true);
        expect(claimsCompletedAction('Su pedido de la camisa roja está cancelado.', { recordFacts: read })).toBe(true);
        expect(claimsCompletedAction('Su pedido está cancelado.')).toBe(true);
    });

    it('a booking or a payment status is never excused by a record that merely exists: it is how a fake booking is announced', () => {
        const facts = [{ status: 'confirmed', tokens: ['AE3D0C86', 'Corte y estilo'] }, { status: 'paid', tokens: ['C03EBDD7'] }];
        expect(claimsCompletedAction('Su cita de Corte y estilo está confirmada.', { recordFacts: facts })).toBe(true);
        expect(claimsCompletedAction('Su pedido C03EBDD7 está pagado.', { recordFacts: facts })).toBe(true);
    });

    it('a DEED stays a claim whatever was read: past, passive and first-person forms', () => {
        for (const text of ['El pedido D1D0D14A quedó cancelado.', 'La cita fue cancelada.', 'Ya cancelé su pedido.', 'Su cita quedó reservada.']) {
            expect(claimsCompletedAction(text, { recordFacts: read })).toBe(true);
        }
        // and a claim with no backing write in the turn is still false
        expect(auditTurnClaim('El pedido D1D0D14A quedó cancelado.', [], { isBackingTool, recordFacts: read }).falseClaim).toBe(true);
    });
});

describe('a rewrite is validated before it replaces a reply', () => {
    const MESSAGE = 'Para cancelar su pedido necesito su confirmación: ¿desea anular el pedido C03EBDD7?';

    it('the message wrapped in quotes with a comment about itself in English comes out as the message only', () => {
        const raw = `"${MESSAGE}"\n\nThis seems to address the concern about claiming an action. It reports the *`;
        expect(sanitizeRewrittenReply(raw, { lang: 'es' })).toBe(MESSAGE);
    });

    it.each([
        [`"${MESSAGE}" This seems to address the concern about claiming an action.`],
        [`Mensaje corregido: ${MESSAGE}`],
        [`${MESSAGE}\n\nThe corrected message avoids claiming that the action is done.`],
        [`${MESSAGE}\n\nI have rewritten the message so that it no longer says the order was cancelled.`],
        [`«${MESSAGE}»`],
        [`Here is the corrected message: ${MESSAGE}`],
    ])('wrappers, labels and commentary are removed: %#', raw => {
        expect(sanitizeRewrittenReply(raw, { lang: 'es' })).toBe(MESSAGE);
    });

    it('a rewrite that is not in the customer\'s language, holds tool markup or is only commentary is rejected (the caller uses its fixed text)', () => {
        expect(sanitizeRewrittenReply('Your order is pending confirmation, please tell us whether you want to cancel it and we will do it for you.', { lang: 'es' })).toBeNull();
        expect(sanitizeRewrittenReply('<cancel_catalog_order>{"orderId":"x"}</cancel_catalog_order> Listo', { lang: 'es' })).toBeNull();
        expect(sanitizeRewrittenReply('This seems to address the concern about claiming an action.', { lang: 'es' })).toBeNull();
        expect(sanitizeRewrittenReply('   ', { lang: 'es' })).toBeNull();
        expect(sanitizeRewrittenReply(undefined, { lang: 'es' })).toBeNull();
    });

    it('a clean rewrite passes unchanged, and an English customer\'s reply is not mistaken for commentary', () => {
        expect(sanitizeRewrittenReply(MESSAGE, { lang: 'es' })).toBe(MESSAGE);
        const english = 'This appointment is not confirmed yet. It will be confirmed once you reply yes to the question above, and then it will be booked for Friday at 3 pm.';
        expect(sanitizeRewrittenReply(english, { lang: 'en' })).toBe(english);
        expect(sanitizeRewrittenReply('Nota: llegue 10 minutos antes de su cita del viernes a las 15:00, por favor.', { lang: 'es' }))
            .toBe('Nota: llegue 10 minutos antes de su cita del viernes a las 15:00, por favor.');
    });

    it.each([
        'It only takes a minute to book, and you can pick any free slot on Friday afternoon.',
        'Note that the clinic opens at 9 and closes at 6, so please arrive a few minutes early.',
        'Let me know if you need anything else, and we will gladly help you with your appointment.',
        'This message confirms nothing yet: your appointment is still waiting for your answer to the question above.',
    ])('an English customer\'s ordinary sentence is not self-commentary: "%s"', text => {
        expect(sanitizeRewrittenReply(text, { lang: 'en' })).toBe(text);
    });

    it('a legitimate English paragraph inside a Spanish tenant\'s reply stays (only META is cut, not a language)', () => {
        const text = 'Tenemos disponible el servicio de corte y estilo el viernes a las 15:00.\n\nSignature Cut & Style Package, includes wash, blow dry and finishing products for all hair types.\n\n¿Desea que se lo reserve?';
        expect(sanitizeRewrittenReply(text, { lang: 'es' })).toBe(text);
    });

    it('the commentary about the reply, the claim or the action is cut, wherever it sits', () => {
        const message = 'Su cita queda pendiente de su confirmación. ¿Desea que la agende para el viernes a las 15:00?';
        for (const comment of ['It reports the appointment as pending and avoids claiming that it was booked.', 'I will rewrite the message so that it does not claim the booking is done.',
            'The response above no longer says the appointment is confirmed.', 'This seems to address the concern about claiming an action.']) {
            expect(sanitizeRewrittenReply(`${message}\n\n${comment}`, { lang: 'es' })).toBe(message);
            expect(sanitizeRewrittenReply(`"${message}" ${comment}`, { lang: 'es' })).toBe(message);
        }
    });

    it('quotes that belong to the message stay', () => {
        const text = 'Tenemos el servicio "Corte y estilo" disponible el viernes a las 15:00 y también el sábado por la mañana.';
        expect(sanitizeRewrittenReply(text, { lang: 'es' })).toBe(text);
    });
});

describe('«mañana» as the morning, ranges, conditionals and opening claims are not the statement being corrected', () => {
    const days = [
        { date: '2026-10-09', weekday: 'Friday', label: 'today' }, { date: '2026-10-10', weekday: 'Saturday', label: 'tomorrow' },
        { date: '2026-10-11', weekday: 'Sunday' }, { date: '2026-10-12', weekday: 'Monday' },
    ];
    it.each([
        // the morning (es / pt / fr / en)
        'Su cita de la mañana es el lunes.', 'El turno de la mañana es el lunes y el de la tarde el martes.', 'Por la mañana es martes y jueves.',
        'Cada mañana es lunes a viernes.', 'Esta mañana es lunes festivo.', 'This morning is Monday.', 'Every morning is Monday to Friday.',
        'De manhã é segunda a sexta.', 'Le matin c’est lundi et mardi.',
        // a weekday range or list after the stated day
        'La clase de mañana es lunes a viernes.', 'Mañana es martes y jueves.', 'Tomorrow is Monday to Friday.', 'Amanhã é segunda a sexta.',
        // conditionals
        'Si mañana es lunes festivo, abrimos a las 10.', 'If tomorrow is Monday we change the schedule.', 'Se amanhã é segunda, avisamos.', 'Si demain c’est lundi, appelez-nous.',
        // the sentence also says the business is open or closed
        'Mañana es domingo y está cerrado.', 'Tomorrow is Sunday and we are closed.', 'Amanhã é domingo e estamos fechados.', 'Demain c’est dimanche, nous sommes fermés.',
    ])('left as the model wrote it: "%s"', text => {
        expect(correctRelativeWeekdays(text, days)).toBe(text);
    });

    it('the plain statement is still corrected next to a sentence that is skipped', () => {
        expect(correctRelativeWeekdays('Por la mañana es martes y jueves. Mañana es domingo.', days)).toBe('Por la mañana es martes y jueves. Mañana es sábado.');
    });
});

describe('«mañana es domingo» on a Friday', () => {
    // Friday 2026-10-09 in the tenant's timezone, as computeUpcomingDays gives it
    const days = [
        { date: '2026-10-09', weekday: 'Friday', label: 'today' }, { date: '2026-10-10', weekday: 'Saturday', label: 'tomorrow' },
        { date: '2026-10-11', weekday: 'Sunday' }, { date: '2026-10-12', weekday: 'Monday' },
    ];

    it('corrects the weekday the calendar contradicts', () => {
        expect(correctRelativeWeekdays('Mañana es domingo, planee su visita.', days)).toBe('Mañana es sábado, planee su visita.');
        expect(correctRelativeWeekdays('Hoy es sábado, llegue temprano.', days)).toBe('Hoy es viernes, llegue temprano.');
        expect(correctRelativeWeekdays('Pasado mañana es lunes.', days)).toBe('Pasado mañana es domingo.');
        expect(correctRelativeWeekdays('Tomorrow is Sunday.', days)).toBe('Tomorrow is Saturday.');
        expect(correctRelativeWeekdays('Amanhã é domingo.', days)).toBe('Amanhã é sábado.');
        expect(correctRelativeWeekdays('Demain c’est dimanche.', days)).toBe('Demain c’est samedi.');
    });

    it('leaves a correct statement, and anything that is not that frame, alone', () => {
        for (const text of ['Mañana es sábado.', 'Hoy es viernes.', 'Mañana abrimos a las 9.', 'El domingo estamos cerrados.', 'Mañana es el mejor momento para venir.',
            'Su cita es mañana, domingo.']) {
            expect(correctRelativeWeekdays(text, days)).toBe(text);
        }
        expect(correctRelativeWeekdays('Mañana es domingo.', undefined)).toBe('Mañana es domingo.');
        expect(correctRelativeWeekdays('Mañana es domingo.', days)).toBe('Mañana es sábado.');
        expect(correctRelativeWeekdays('Mañana es domingo.', [])).toBe('Mañana es domingo.');
    });
});
