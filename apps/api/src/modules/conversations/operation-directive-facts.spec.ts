import { ConversationsService } from './conversations.service';

/**
 * Lo que el modelo ve cuando el servidor ya ejecutó una operación.
 *
 * El 19-ago el enlace de pago se creó bien (`succeeded`,
 * https://checkout.wompi.co/l/S9YKxi) y el agente igual contestó "Voy a generar
 * el enlace de pago ahora. Un momento...". La directiva llevaba el enlace, pero
 * sepultado en un volcado de depuración de diez líneas: `linkCreated`,
 * `operationId`, `payableReference`, `linkStatus`… y `amountCents: 72000000`.
 *
 * Ese último es el peligroso: son 720.000 COP. Voceado tal cual, al huésped se
 * le cobran setenta y dos millones.
 */

// El método es privado por diseño; se prueba su salida, que es lo que ve el modelo.
const describe_ = (result: any): string =>
    (ConversationsService.prototype as any).describeOperationResult.call({}, result);

const LINK_RESULT = {
    linkCreated: true,
    operationId: '4b84da2b-704a-4eaf-8f7d-8b5c2dc8b285',
    paymentLink: 'https://checkout.wompi.co/l/S9YKxi',
    payableReference: 'property:185444f2-98a3-4db3-b3a3-7d9da6ab5230',
    amountCents: 72000000,
    currency: 'COP',
    description: 'Pago de reserva de alojamiento 185444f2',
    provider: 'wompi',
    linkStatus: 'active',
    paymentStatus: 'pending',
    paid: false,
    message: 'El enlace fue creado, pero el pago sigue pendiente.',
};

describe('los datos que acompañan a la directiva', () => {
    const facts = describe_(LINK_RESULT);

    it('nunca deja pasar un importe en centavos', () => {
        // El fallo caro: 72000000 leído como pesos son 72 millones.
        expect(facts).not.toContain('72000000');
        expect(facts).toContain('720.000 COP');
    });

    it('conserva el único dato que el huésped necesita', () => {
        expect(facts).toContain('https://checkout.wompi.co/l/S9YKxi');
    });

    it('no le muestra al modelo nuestra fontanería', () => {
        for (const interno of [
            '4b84da2b-704a-4eaf-8f7d-8b5c2dc8b285',
            'property:185444f2-98a3-4db3-b3a3-7d9da6ab5230',
            'linkCreated',
            'linkStatus',
        ]) {
            expect(facts).not.toContain(interno);
        }
    });

    it('queda corto y legible en vez de un volcado', () => {
        // Diez líneas de identificadores fueron la razón de que la directiva se
        // perdiera. Menos líneas, todas útiles.
        expect(facts.split('\n').length).toBeLessThanOrEqual(5);
    });

    it('sigue mostrando el estado del pago, que cambia lo que puede afirmar', () => {
        expect(facts).toContain('paymentStatus: pending');
    });
});
