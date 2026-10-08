import {
    buildAppointmentNotes,
    classifyContactPhone,
    normaliseNotesLanguage,
    truncateAtWord,
} from './appointment-notes';

/**
 * Review of 2026-10-08: the notes of an appointment booked by the assistant were
 * in English for a Spanish-speaking owner, printed a Telegram user id as
 * "Phone", and copied customer messages cut in the middle of a word.
 */
const base = {
    customerName: 'Joaquin Sosa',
    serviceName: 'Corte y estilo',
    priceStatus: 'example',
    durationMinutes: 45,
};

describe('appointment notes language', () => {
    it('writes the notes in the tenant language, Spanish by default', () => {
        const es = buildAppointmentNotes({ ...base, language: 'es-CO', customerEmail: 'j@example.com' });
        expect(es).toContain('Cliente: Joaquin Sosa');
        expect(es).toContain('Correo: j@example.com');
        expect(es).toContain('Servicio: Corte y estilo (precio por confirmar)');
        expect(es).toContain('Duración: 45 min');
        expect(es).not.toMatch(/Customer:|Phone:|Service:|Duration:|Conversation context/);
        expect(buildAppointmentNotes({ ...base, language: null })).toContain('Cliente: Joaquin Sosa');
    });

    it.each([
        ['en', 'Customer: Joaquin Sosa', 'Duration: 45 min'],
        ['pt-BR', 'Cliente: Joaquin Sosa', 'Duração: 45 min'],
        ['fr', 'Client: Joaquin Sosa', 'Durée: 45 min'],
    ])('supports %s', (language, customerLine, durationLine) => {
        const text = buildAppointmentNotes({ ...base, language });
        expect(text).toContain(customerLine);
        expect(text).toContain(durationLine);
    });

    it('falls back to Spanish for an unknown language', () => {
        expect(normaliseNotesLanguage('de-DE')).toBe('es');
        expect(normaliseNotesLanguage(undefined)).toBe('es');
        expect(normaliseNotesLanguage('EN')).toBe('en');
    });

    it('says how a price is known instead of printing a number that was never confirmed', () => {
        expect(buildAppointmentNotes({ ...base, language: 'es', priceStatus: 'quote' })).toContain('(se cotiza según el caso)');
        expect(buildAppointmentNotes({ ...base, language: 'es', priceStatus: 'confirmed', priceText: '40,000 COP' }))
            .toContain('Servicio: Corte y estilo (40,000 COP)');
    });

    it('translates the roles in the conversation context and keeps order', () => {
        const text = buildAppointmentNotes({
            ...base,
            language: 'es',
            conversation: [
                { direction: 'inbound', text: 'Quiero un corte' },
                { direction: 'outbound', text: '¿Para cuándo?' },
            ],
        });
        expect(text).toContain('Contexto de la conversación:');
        expect(text.indexOf('- Cliente: "Quiero un corte"')).toBeLessThan(text.indexOf('- Asistente: "¿Para cuándo?"'));
        expect(text).not.toContain('Agent');
    });

    it('translates the notes label', () => {
        expect(buildAppointmentNotes({ ...base, language: 'es', notes: 'Alergia al tinte' })).toContain('Notas: Alergia al tinte');
        expect(buildAppointmentNotes({ ...base, language: 'en', notes: 'Dye allergy' })).toContain('Notes: Dye allergy');
    });
});

describe('a platform id is never labelled as a phone', () => {
    it('labels a bare Telegram user id as that id', () => {
        const text = buildAppointmentNotes({ ...base, language: 'es', customerPhone: '1234567890', channelType: 'telegram' });
        expect(text).toContain('ID de Telegram: 1234567890');
        expect(text).not.toContain('Teléfono:');
        expect(text).not.toContain('Phone:');
    });

    it('keeps a real phone, on any channel', () => {
        expect(buildAppointmentNotes({ ...base, language: 'es', customerPhone: '+57 300 111 2233', channelType: 'telegram' }))
            .toContain('Teléfono: +57 300 111 2233');
        expect(buildAppointmentNotes({ ...base, language: 'en', customerPhone: '+573001112233', channelType: 'whatsapp' }))
            .toContain('Phone: +573001112233');
    });

    it('classifies what may be stored as the booking phone', () => {
        expect(classifyContactPhone('1234567890', 'telegram')).toEqual({
            channelId: { channel: 'Telegram', value: '1234567890' },
        });
        expect(classifyContactPhone('3001112233', 'whatsapp')).toEqual({ phone: '3001112233' });
        expect(classifyContactPhone('+57 300 111 2233', 'instagram')).toEqual({ phone: '+57 300 111 2233' });
        expect(classifyContactPhone('abc', 'whatsapp')).toEqual({});
        expect(classifyContactPhone('12', undefined)).toEqual({});
        expect(classifyContactPhone('', 'telegram')).toEqual({});
        expect(classifyContactPhone(undefined, 'telegram')).toEqual({});
    });
});

describe('truncation', () => {
    it('cuts at a word boundary and marks the cut', () => {
        const text = truncateAtWord('Hola, quisiera agendar un corte de cabello para el lunes por la mañana si es posible gracias', 40);
        expect(text.endsWith('…')).toBe(true);
        expect(text.length).toBeLessThanOrEqual(41);
        expect(text).not.toMatch(/\s…$/);
        expect('Hola, quisiera agendar un corte de cabello para el lunes por la mañana si es posible gracias').toContain(text.slice(0, -1));
        expect(text.slice(0, -1).split(' ').every((word) => word.length > 0)).toBe(true);
    });

    it('leaves short text alone', () => {
        expect(truncateAtWord('  Hola   mundo ', 200)).toBe('Hola mundo');
    });
});
