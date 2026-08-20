import { describePaymentPolicy, resolvePaymentPolicy } from './payment-policy.util';

describe('la política de confirmación que configura el dueño', () => {
    it('sin configurar, se confirma como siempre', () => {
        expect(resolvePaymentPolicy(null, 1080000)).toMatchObject({ mode: 'none', requiresPayment: false });
        expect(resolvePaymentPolicy({}, 1080000)).toMatchObject({ mode: 'none', requiresPayment: false });
        expect(resolvePaymentPolicy({ payment_policy: 'none' }, 1080000).requiresPayment).toBe(false);
    });

    it('un valor desconocido no bloquea la venta', () => {
        // Es configuración, no seguridad: ante un typo del dueño el negocio
        // sigue vendiendo como antes en vez de quedarse mudo.
        const p = resolvePaymentPolicy({ payment_policy: 'obligatorio' }, 1080000);
        expect(p).toMatchObject({ mode: 'none', requiresPayment: false });
    });

    it('pago total', () => {
        const p = resolvePaymentPolicy({ payment_policy: 'full' }, 1080000);
        expect(p).toMatchObject({ mode: 'full', requiresPayment: true, dueAmount: 1080000, customerChooses: false });
    });

    it('anticipo por porcentaje', () => {
        const p = resolvePaymentPolicy({ payment_policy: 'deposit', deposit_percent: 30 }, 1000000);
        expect(p).toMatchObject({ mode: 'deposit', requiresPayment: true, dueAmount: 300000 });
    });

    it('el monto fijo le gana al porcentaje', () => {
        // El dueño quiere poder decir "cincuenta mil y listo" sin pensar en proporciones.
        const p = resolvePaymentPolicy(
            { payment_policy: 'deposit', deposit_percent: 30, deposit_amount: 50000 }, 1000000,
        );
        expect(p.dueAmount).toBe(50000);
    });

    it('el anticipo nunca supera el total', () => {
        const p = resolvePaymentPolicy({ payment_policy: 'deposit', deposit_amount: 9999999 }, 200000);
        expect(p.dueAmount).toBe(200000);
    });

    it("en 'ambas' el cliente elige, y sólo si el anticipo es menor que el total", () => {
        const elige = resolvePaymentPolicy({ payment_policy: 'any', deposit_percent: 40 }, 1000000);
        expect(elige).toMatchObject({ mode: 'any', dueAmount: 400000, customerChooses: true });

        const noElige = resolvePaymentPolicy({ payment_policy: 'any', deposit_percent: 100 }, 1000000);
        expect(noElige.customerChooses).toBe(false);
    });

    it('pidió anticipo y no lo configuró: se cobra el total, no cero', () => {
        // Su intención fue "no confirmar sin plata". Cobrar cero la traiciona;
        // inventar un importe también. Queda marcado para poder avisarle.
        const p = resolvePaymentPolicy({ payment_policy: 'deposit' }, 800000);
        expect(p).toMatchObject({ requiresPayment: true, dueAmount: 800000, degradedFromDeposit: true });
    });

    it('sin precio no se exige pago, diga lo que diga la política', () => {
        // Un cobro de cero dejaría la operación colgada para siempre.
        for (const total of [0, null, undefined, 'gratis']) {
            expect(resolvePaymentPolicy({ payment_policy: 'full' }, total).requiresPayment).toBe(false);
        }
    });

    it('acepta el DECIMAL que devuelve Postgres como string', () => {
        const p = resolvePaymentPolicy({ payment_policy: 'deposit', deposit_amount: '75000.00' }, '1000000.00');
        expect(p).toMatchObject({ dueAmount: 75000, totalAmount: 1000000 });
    });

    it('lo que se le cuenta al agente distingue anticipo de total', () => {
        expect(describePaymentPolicy(resolvePaymentPolicy({}, 100))).toBeUndefined();

        const anticipo = describePaymentPolicy(
            resolvePaymentPolicy({ payment_policy: 'deposit', deposit_percent: 30 }, 1000),
        );
        expect(anticipo).toContain('anticipo');
        expect(anticipo).toContain('300');

        const total = describePaymentPolicy(resolvePaymentPolicy({ payment_policy: 'full' }, 1000));
        expect(total).not.toContain('anticipo');

        const ambas = describePaymentPolicy(
            resolvePaymentPolicy({ payment_policy: 'any', deposit_percent: 30 }, 1000),
        );
        expect(ambas).toContain('puede abonar');
        // Lo que nunca puede faltar: la instrucción de no dar por confirmado.
        for (const texto of [anticipo, total, ambas]) {
            expect(texto).toContain('No la des por confirmada');
        }
    });
});
