import { describeTimeWindow, extractTimeWindow, parseTimeWindow, resolveTimeWindow, sameTimeWindow } from './time-window';

/**
 * PR8 — part-of-day availability window. Production (salon 09:00-19:00):
 * "¿tienen disponibilidad mañana en la tarde para un corte?" offered six MORNING
 * slots because only an hour could be read. These pin the typed window and the
 * multilingual reading that replace that.
 */
const salon = { openMin: 9 * 60, closeMin: 19 * 60 };

describe('resolveTimeWindow — part-of-day boundaries from the business hours', () => {
    it('afternoon is 12:00 until the business closing time', () => {
        expect(resolveTimeWindow({ partOfDay: 'afternoon' }, salon)).toEqual({ fromMin: 720, toMin: 1140 });
    });

    it('morning is the opening time until 12:00, evening 18:00 until closing', () => {
        expect(resolveTimeWindow({ partOfDay: 'morning' }, salon)).toEqual({ fromMin: 540, toMin: 720 });
        expect(resolveTimeWindow({ partOfDay: 'evening' }, salon)).toEqual({ fromMin: 1080, toMin: 1140 });
    });

    it('without known hours the boundaries run to the ends of the day', () => {
        expect(resolveTimeWindow({ partOfDay: 'afternoon' }, null)).toEqual({ fromMin: 720, toMin: 1440 });
        expect(resolveTimeWindow({ partOfDay: 'morning' }, null)).toEqual({ fromMin: 0, toMin: 720 });
    });

    it('a business that closes at 18:00 has an empty evening (answered with the nearest slots, not "closed")', () => {
        const window = resolveTimeWindow({ partOfDay: 'evening' }, { openMin: 540, closeMin: 1080 });
        expect(window.fromMin).toBeGreaterThanOrEqual(window.toMin);
    });

    it('from/to intersect with the part of the day', () => {
        expect(resolveTimeWindow({ partOfDay: 'afternoon', from: '15:00' }, salon)).toEqual({ fromMin: 900, toMin: 1140 });
        expect(resolveTimeWindow({ from: '13:00' }, salon)).toEqual({ fromMin: 780, toMin: 1140 });
        expect(resolveTimeWindow({ to: '11:00' }, salon)).toEqual({ fromMin: 540, toMin: 660 });
        expect(resolveTimeWindow({ from: '14:00', to: '17:00' }, salon)).toEqual({ fromMin: 840, toMin: 1020 });
    });
});

describe('parseTimeWindow — model/state input is validated', () => {
    it('keeps only well-formed fields', () => {
        expect(parseTimeWindow({ partOfDay: 'afternoon', from: '9:30', to: 'later', extra: 1 })).toEqual({ partOfDay: 'afternoon', from: '09:30' });
        expect(parseTimeWindow({ partOfDay: 'tarde' })).toBeNull();
        expect(parseTimeWindow('afternoon')).toBeNull();
        expect(parseTimeWindow(null)).toBeNull();
    });

    it('compares windows by value', () => {
        expect(sameTimeWindow({ partOfDay: 'afternoon' }, { partOfDay: 'afternoon' })).toBe(true);
        expect(sameTimeWindow({ partOfDay: 'afternoon' }, { from: '12:00' })).toBe(false);
        expect(sameTimeWindow(undefined, null)).toBe(true);
    });
});

describe('extractTimeWindow — es/en/pt/fr without requiring an hour', () => {
    it.each([
        ['¿tienen disponibilidad mañana en la tarde para un corte?', 'afternoon'],
        ['¿tienen algo mañana por la tarde para manicure?', 'afternoon'],
        ['el viernes a la tarde', 'afternoon'],
        ['mañana por la mañana', 'morning'],
        ['hoy en la noche', 'evening'],
        ['esta noche', 'evening'],
        ['do you have anything tomorrow afternoon for a haircut?', 'afternoon'],
        ['tomorrow morning please', 'morning'],
        ['this evening?', 'evening'],
        ['tem horário amanhã à tarde para corte?', 'afternoon'],
        ['amanhã de manhã', 'morning'],
        ['hoje à noite', 'evening'],
        ['vous avez quelque chose demain après-midi pour une coupe ?', 'afternoon'],
        ['demain matin', 'morning'],
        ['ce soir', 'evening'],
    ])('%s → %s', (text, partOfDay) => {
        expect(extractTimeWindow(text, salon)).toEqual({ window: { partOfDay }, fromRange: false });
    });

    it.each([
        'Buenas tardes, ¿tienen cita mañana?',
        'buenas noches',
        'Boa tarde, tem horário amanhã?',
        'Good morning, anything tomorrow?',
        'Bonsoir, vous avez un créneau demain ?',
        'quiero una cita para mañana',
        'amanhã',
        'llego más tarde',
    ])('a greeting or "mañana" = tomorrow is not a window: %s', text => {
        expect(extractTimeWindow(text, salon)).toBeNull();
    });

    it.each([
        ['después de las 13:00', { from: '13:00' }],
        ['¿hay algo después de la 1?', { from: '13:00' }],
        ['el sábado después de las 3 pm', { from: '15:00' }],
        ['a partir de las 4', { from: '16:00' }],
        ['antes de las 11', { to: '11:00' }],
        ['entre las 2 y las 5', { from: '14:00', to: '17:00' }],
        ['after 3 pm', { from: '15:00' }],
        ['before 11am', { to: '11:00' }],
        ['between 2 and 5 pm', { from: '14:00', to: '17:00' }],
        ['depois das 15h', { from: '15:00' }],
        ['antes das 11h', { to: '11:00' }],
        ['entre 14h e 17h', { from: '14:00', to: '17:00' }],
        ['après 15h', { from: '15:00' }],
        ['avant 11h', { to: '11:00' }],
        ['entre 14h et 17h', { from: '14:00', to: '17:00' }],
        ['à partir de 16h30', { from: '16:30' }],
    ])('range %s', (text, window) => {
        expect(extractTimeWindow(text, salon)).toEqual({ window, fromRange: true });
    });

    it('combines the part of the day with a range and reads a bare hour as the afternoon', () => {
        expect(extractTimeWindow('mañana en la tarde después de las 3', null)).toEqual({ window: { partOfDay: 'afternoon', from: '15:00' }, fromRange: true });
    });

    it('a duration or a date after the preposition is not an hour', () => {
        expect(extractTimeWindow('después de 2 días', salon)).toBeNull();
        expect(extractTimeWindow('antes del 15 de octubre', salon)).toBeNull();
        expect(extractTimeWindow('after 2 hours', salon)).toBeNull();
    });

    it('an explicit hour alone is not a window (the hour keeps its own rules)', () => {
        expect(extractTimeWindow('el sábado a las 15:00', salon)).toBeNull();
    });

    it('two parts of the day are no window', () => {
        expect(extractTimeWindow('en la mañana o en la tarde', salon)).toBeNull();
    });

    it('"a cualquier hora" / "any time" lifts an earlier window', () => {
        expect(extractTimeWindow('a cualquier hora', salon)).toEqual({ cleared: true });
        expect(extractTimeWindow('any time works', salon)).toEqual({ cleared: true });
        expect(extractTimeWindow('qualquer horário', salon)).toEqual({ cleared: true });
        expect(extractTimeWindow("n'importe quelle heure", salon)).toEqual({ cleared: true });
    });
});

describe('describeTimeWindow', () => {
    it('words the window in the customer language', () => {
        expect(describeTimeWindow({ partOfDay: 'afternoon' }, 'es')).toBe('en la tarde');
        expect(describeTimeWindow({ from: '13:00' }, 'es')).toBe('después de las 13:00');
        expect(describeTimeWindow({ partOfDay: 'afternoon', from: '15:00' }, 'en')).toBe('in the afternoon after 15:00');
        expect(describeTimeWindow({ from: '14:00', to: '17:00' }, 'pt')).toBe('entre 14:00 e 17:00');
        expect(describeTimeWindow({ partOfDay: 'afternoon' }, 'fr')).toBe("l'après-midi");
    });
});
