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

    it('bare keyword only counts up to 5 tokens', () => {
        expect(isOptOutMessage('stop ahora')).toBe(true);
        expect(isOptOutMessage('por favor stop ya gracias')).toBe(true);
        expect(isOptOutMessage('stop por favor ya ahora gracias bye')).toBe(false);
        expect(isOptOutMessage('salir el sabado')).toBe(false);
    });
});

/**
 * Review of 56e5de08: everything origin/main already detected as an opt-out must
 * still be one. Policy while the owner decides: when in doubt, opt out (the
 * record is "pending" and an admin can reject it). Only demonstrated false
 * positives — an ambiguous verb inside a sentence with other content — stop
 * counting.
 */
describe('opt-out: nothing main detected is lost', () => {
    it.each([
        'Stop promotions', 'BAJA por favor gracias', 'STOP por favor ya', 'dame de baja',
        'denme de baja', 'me quiero dar de baja', 'quiero la baja', 'STOP ALL', 'stop it',
        'pls stop thanks bye', 'baja, gracias por todo', 'quiero salir', 'Quitar',
    ])('still an opt-out: %s', text => {
        expect(isOptOutMessage(text)).toBe(true);
    });

    it.each([
        'basta', 'deja de escribirme', 'dejen de escribirme', 'no me manden más',
        'no quiero más mensajes', 'quítenme de la lista', 'quitarme de la lista',
        'detener promociones', 'parem', 'desuscríbanme', '🛑',
    ])('opt-out phrase main missed is now detected: %s', text => {
        expect(isOptOutMessage(text)).toBe(true);
    });

    it.each([
        'queremos salir el 20 de diciembre', 'parar en Medellín', 'stop by the office',
        'exit 5', 'sair amanhã', 'Quitar el color', 'baja de precio',
    ])('ordinary use of the verb is not an opt-out: %s', text => {
        expect(isOptOutMessage(text)).toBe(false);
    });
});
