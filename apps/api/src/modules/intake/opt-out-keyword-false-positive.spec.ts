import { isOptOutMessage } from './intake-i18n';

/**
 * QA Telegram campaign 2026-10-05, case V14 (twice): the customer wrote
 * "Somos 3 personas y queremos salir el 20 de diciembre" and the bot never
 * answered. `suppressDetectedOptOut` (conversations.service.ts) returns before
 * any reply, and `salir` is registered as a bare opt-out word, so a travel
 * request ("salir de viaje") was recorded as consent withdrawal.
 */
describe('opt-out keywords do not swallow ordinary requests', () => {
    it.each([
        'Somos 3 personas y queremos salir el 20 de diciembre',
        'Queremos salir el sabado hacia Cartagena',
        'A que hora sale el vuelo?',
        'Quiero quitar el color y dejar solo el corte',
    ])('is not an opt-out: %s', text => {
        expect(isOptOutMessage(text)).toBe(false);
    });

    it.each([
        'STOP',
        'quiero salir de la lista',
        'darme de baja por favor',
        'no me escriban mas',
    ])('still detects a real opt-out: %s', text => {
        expect(isOptOutMessage(text)).toBe(true);
    });
});

describe('opt-out detection across languages and message length', () => {
    it.each([
        // en
        'Can I stop by tomorrow at 5pm?',
        'Where is the exit of the parking lot?',
        // pt
        'Quero sair às 10h e voltar no domingo',
        'A que horas sai o ônibus?',
        // fr
        'Je dois arrêter de travailler à 17h, puis-je passer demain ?',
        'Nous voulons partir le 20 décembre, à quelle heure sortir ?',
        // es
        'El precio de la baja temporada es menor?',
        'Podemos parar en el hotel antes de la cita?',
    ])('long ordinary message is not an opt-out: %s', text => {
        expect(isOptOutMessage(text)).toBe(false);
    });

    it.each([
        'stop', 'Stop.', 'baja', 'salir', 'parar', 'por favor stop', 'sair', 'arrêter', 'exit',
        'unsubscribe', 'Please unsubscribe me from everything', 'não me contate mais',
        'Je voudrais me désabonner, merci', 'quero me descadastrar da lista',
        'Hola, por favor quiero darme de baja de sus mensajes',
        'stop sending me messages about the apartment please',
        'ne plus recevoir vos messages',
    ])('real opt-out is detected: %s', text => {
        expect(isOptOutMessage(text)).toBe(true);
    });

    it('bare keyword only counts up to 3 tokens', () => {
        expect(isOptOutMessage('por favor stop')).toBe(true);
        expect(isOptOutMessage('stop ahora')).toBe(true);
        expect(isOptOutMessage('por favor stop ya')).toBe(false);
        expect(isOptOutMessage('salir el sabado')).toBe(false);
    });
});
