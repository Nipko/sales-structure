import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ConversationsService } from './conversations.service';
import { promisesLaterDelivery } from '../../common/utils/outcome-claim.util';

/**
 * El enlace de pago lo entrega el backend, no el modelo.
 *
 * El 19-ago el enlace se creó bien (`succeeded`, checkout.wompi.co/l/S9YKxi) y el
 * modelo igual contestó "Voy a generar el enlace de pago ahora. Un momento…".
 * Nunca llegó. Se le puede pedir mejor —y se le pidió— pero pedir no es
 * garantizar, y una URL transcrita por un modelo también puede salir cortada.
 */

const describe_ = (result: any): string =>
    (ConversationsService.prototype as any).describeOperationResult.call({}, result);

const LINK_RESULT = {
    linkCreated: true,
    paymentLink: 'https://checkout.wompi.co/l/S9YKxi',
    amountCents: 72000000,
    currency: 'COP',
    description: 'Pago de reserva',
    paymentStatus: 'pending',
};

describe('el enlace no viaja por el modelo', () => {
    it('no aparece entre los datos que se le pasan', () => {
        // Si estuviera acá además de la burbuja, el cliente lo recibiría dos veces.
        expect(describe_(LINK_RESULT)).not.toContain('checkout.wompi.co');
    });

    it('el importe sigue estando, en unidades reales', () => {
        // El modelo tiene que poder decir cuánto es; lo que no maneja es la URL.
        const facts = describe_(LINK_RESULT);
        expect(facts).toContain('720.000 COP');
        expect(facts).not.toContain('72000000');
    });
});

describe('los dos guardrails no se pisan', () => {
    const SRC = readFileSync(resolve(__dirname, 'conversations.service.ts'), 'utf8');

    it('anunciar el enlace deja de ser una promesa vacía cuando el backend lo manda', () => {
        // Un arreglo le PIDE al modelo que anuncie el envío; el otro castiga los
        // anuncios. Sin esta salvedad se reescribían entre ellos.
        expect(promisesLaterDelivery('Ahora te paso el enlace')).toBe(true);
        expect(SRC).toContain('const backendWillDeliver = (executedTools || []).some');
        expect(SRC).toContain('outcomeAlreadyKnown && !backendWillDeliver && promisesLaterDelivery(response)');
    });

    it('la directiva le avisa al modelo que el enlace sale aparte', () => {
        expect(SRC).toContain('El enlace de pago se le envía en un mensaje aparte');
    });
});

describe('el envío', () => {
    const SRC = readFileSync(resolve(__dirname, 'conversations.service.ts'), 'utf8');

    it('sólo acepta https', () => {
        // Un `paymentLink` que no sea https no se le manda a nadie.
        expect(SRC).toContain(String.raw`/^https:\/\//i.test(u)`);
    });

    it('deduplica: dos herramientas pueden devolver el mismo enlace', () => {
        expect(SRC).toContain('for (const url of new Set(paymentLinks))');
    });

    it('el dedupeId va atado al enlace, no al turno', () => {
        // Si el turno se reprocesa tras un reinicio, el cliente no puede recibir
        // el mismo enlace dos veces.
        expect(SRC).toContain('dedupeId: `paylink-${url.slice(-64)}`');
    });
});
