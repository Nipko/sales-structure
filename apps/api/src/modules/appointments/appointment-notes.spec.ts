import {
    buildAppointmentNotes,
    classifyContactPhone,
    isPlatformIdChannel,
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

describe('a platform id is never labelled as a phone, and a typed phone is never taken for an id', () => {
    it('labels the contact\'s own Telegram user id as that id', () => {
        const text = buildAppointmentNotes({
            ...base, language: 'es', customerPhone: '1234567890', channelType: 'telegram', ownExternalId: '1234567890',
        });
        expect(text).toContain('ID de Telegram: 1234567890');
        expect(text).not.toContain('Teléfono:');
        expect(text).not.toContain('Phone:');
    });

    it.each([
        ['webchat', '3001234567'],
        ['telegram', '3001234567'],
        ['instagram', '300 123 4567'],
        ['web', '(601) 555 1234'],
        ['messenger', '+57 300 123 4567'],
    ])('keeps a phone typed on %s without a country code: %s', (channelType, typed) => {
        // The contact's own id is some other value, so this is what the customer typed.
        const text = buildAppointmentNotes({
            ...base, language: 'es', customerPhone: typed, channelType, ownExternalId: '987654321',
        });
        expect(text).toContain(`Teléfono: ${typed}`);
        expect(text).not.toMatch(/ID de /);
        expect(classifyContactPhone(typed, channelType, '987654321')).toEqual({ phone: typed });
        // Even when the lookup of the own id found nothing.
        expect(classifyContactPhone(typed, channelType, null)).toEqual({ phone: typed });
    });

    it('never labels or stores an e-mail or free text as an id or a phone', () => {
        expect(classifyContactPhone('juan@x.com', 'telegram', '1234567890')).toEqual({});
        expect(classifyContactPhone('juan@x.com', 'telegram', null)).toEqual({});
        const text = buildAppointmentNotes({
            ...base, language: 'es', customerPhone: 'juan@x.com', channelType: 'telegram', ownExternalId: '1234567890',
        });
        expect(text).not.toMatch(/ID de|Teléfono:/);
    });

    it('keeps a real phone on a phone channel', () => {
        expect(buildAppointmentNotes({ ...base, language: 'en', customerPhone: '+573001112233', channelType: 'whatsapp' }))
            .toContain('Phone: +573001112233');
    });

    it('classifies what may be stored as the booking phone', () => {
        expect(classifyContactPhone('1234567890', 'telegram', '1234567890')).toEqual({
            channelId: { channel: 'Telegram', value: '1234567890' },
        });
        expect(classifyContactPhone('@juan', 'telegram', 'juan')).toEqual({
            channelId: { channel: 'Telegram', value: '@juan' },
        });
        expect(classifyContactPhone('3001112233', 'whatsapp')).toEqual({ phone: '3001112233' });
        expect(classifyContactPhone('abc', 'whatsapp')).toEqual({});
        expect(classifyContactPhone('12', undefined)).toEqual({});
        expect(classifyContactPhone('', 'telegram')).toEqual({});
        expect(classifyContactPhone(undefined, 'telegram')).toEqual({});
    });

    it('only asks for the contact\'s own id on channels where it can be mistaken for a phone', () => {
        expect(isPlatformIdChannel('telegram')).toBe(true);
        expect(isPlatformIdChannel('WebChat')).toBe(true);
        expect(isPlatformIdChannel('whatsapp')).toBe(false);
        expect(isPlatformIdChannel(undefined)).toBe(false);
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
