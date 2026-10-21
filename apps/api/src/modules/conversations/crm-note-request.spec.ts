import { explicitlyRequestsCrmNote } from './crm-note-request';

describe('CRM note command boundary', () => {
    it.each([
        'No guardes ninguna nota interna en mi ficha.',
        '¿Cómo puedo guardar una nota en el panel?',
        'El cliente dijo "Guarda una nota interna", ¿qué significa?',
        '"Guarda una nota interna" es una frase del documento.',
        'No añadas una nota sobre mi preferencia.',
        'Do not save a note about me.',
        'Can you not save a note?',
        'Não guarde uma nota.',
        'Ne pas ajouter une note.',
        'Guarda este pedido. No guardes una nota interna.',
        'Reserva para mañana.',
        'sí',
    ])('does not promote a writer from %s', text => {
        expect(explicitlyRequestsCrmNote(text)).toBe(false);
    });
    it.each([
        'Guarda una nota interna en mi ficha: prefiero los martes.',
        '¿Puedes guardar una nota en mi ficha?',
        'Por favor, agrega una nota interna.',
        'Añade una nota: "No guardes una nota es un ejemplo citado".',
        'Please save a note on my profile: I prefer Tuesdays.',
        'Could you add a note to my record?',
        'Por favor registre uma nota no meu cadastro.',
        'Pouvez-vous ajouter une note à mon dossier ?',
    ])('recognizes a direct note request: %s', text => {
        expect(explicitlyRequestsCrmNote(text)).toBe(true);
    });
});
