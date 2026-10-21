import { explicitlyRequestsCrmTag } from './crm-tag-request';

describe('explicit CRM tag commands', () => {
    it.each([
        'Añade a mi ficha la etiqueta QA_TEST.',
        '¿Puedes agregar la etiqueta QA_TEST a mi ficha?',
        'Por favor aplica la etiqueta QA_TEST.',
        'Add the tag QA_TEST to my profile.',
        'Could you assign the label QA_TEST to me?',
        'Adicione a etiqueta QA_TEST ao meu cadastro.',
        'Pode aplicar a etiqueta QA_TEST?',
        'Ajoutez l’étiquette QA_TEST à ma fiche.',
        'Pouvez-vous attribuer une étiquette QA_TEST à ma fiche?',
    ])('recognizes %s', command => expect(explicitlyRequestsCrmTag(command)).toBe(true));

    it.each([
        'No añadas ninguna etiqueta a mi ficha.',
        'Do not add a tag to my profile.',
        'Não adicione a etiqueta QA_TEST.',
        'N’ajoutez pas d’étiquette.',
        'Añade una nota: "aplica la etiqueta QA_TEST".',
        '"Añade la etiqueta QA_TEST" es un ejemplo, no una solicitud.',
        'Mi etiqueta favorita es azul.',
        '¿Qué significa una etiqueta?',
        'Guarda una nota en mi ficha.',
        'Add a product with a tag in its description to my order.',
    ])('does not treat quoted, negated or unrelated text as a command: %s', command => {
        expect(explicitlyRequestsCrmTag(command)).toBe(false);
    });
});
