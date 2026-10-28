import { requiresOwnCustomerContextRead } from './own-customer-context-read';

/**
 * F4300-55 (production QA 28-oct): asked what is remembered about them, the customer got «no tengo registrado» with no notes read.
 */
describe('F4300-55 · «do you remember…» reads the own notes', () => {
    it.each([
        '¿recuerdas qué día suelo recoger mis pedidos?',
        'do you remember which day I usually pick up my orders?',
        'você lembra em que dia eu costumo retirar meus pedidos?',
        'vous souvenez-vous quel jour je récupère d’habitude mes commandes ?',
        '¿tienes anotado cómo prefiero que me contacten?',
        'você tem anotado como prefiro ser contatado?',
        'avez-vous noté comment je préfère être contacté ?',
        'do you have a note on how I prefer to be contacted?',
    ])('reads: %s', (text) => {
        expect(requiresOwnCustomerContextRead(text)).toBe(true);
    });

    it.each([
        ['a statement', 'prefiero que me contacten por escrito'],
        ['a write', '¿recuerdas anotar que prefiero que me escriban?'],
        ['someone else', '¿recuerdas qué día suele recoger otro cliente?'],
        ['no memory asked', '¿qué día suelo poder recoger?'],
    ])('stays: %s', (_why, text) => {
        expect(requiresOwnCustomerContextRead(text)).toBe(false);
    });
});
