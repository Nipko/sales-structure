import {
    describePaymentPolicy,
    resolvePaymentPolicy,
    validatePaymentPolicyInput,
} from './payment-policy.util';

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
        for (const texto of [anticipo, total, ambas]) {
            // Lo que nunca puede faltar: la instrucción de no dar por confirmado…
            expect(texto).toContain('No lo des por confirmado');
            // …y la retención, que es la única promesa concreta que el sistema
            // sí cumple. Sin decirla, el cliente no sabe que tiene 15 minutos ni
            // por qué apurarse, y la retención no le sirve de nada.
            expect(texto).toContain('15 minutos');
            expect(texto).toContain('vuelve a quedar disponible');
        }
    });
});
describe('lo que el panel manda se valida antes de guardarlo', () => {
    it('acepta los cuatro modos', () => {
        for (const mode of ['none', 'full', 'deposit', 'any']) {
            const input: any = { paymentPolicy: mode };
            if (mode === 'deposit' || mode === 'any') input.depositPercent = 30;
            expect(validatePaymentPolicyInput(input).error).toBeUndefined();
        }
    });

    it('rechaza un modo inventado en vez de guardarlo', () => {
        // Si entrara a la base, el resolvedor lo trataria como 'none' y el dueno
        // creeria que exige pago cuando el agente confirma gratis.
        expect(validatePaymentPolicyInput({ paymentPolicy: 'obligatorio' }).error).toBeTruthy();
    });

    it('rechaza pedir anticipo sin decir cuanto', () => {
        // Es el error caro: sin monto se le cobraria el TOTAL al cliente.
        expect(validatePaymentPolicyInput({ paymentPolicy: 'deposit' }).error).toMatch(/anticipo/i);
        expect(validatePaymentPolicyInput({ paymentPolicy: 'any' }).error).toMatch(/anticipo/i);
    });

    it('rechaza porcentajes imposibles y montos en cero', () => {
        expect(validatePaymentPolicyInput({ paymentPolicy: 'deposit', depositPercent: 0 }).error).toBeTruthy();
        expect(validatePaymentPolicyInput({ paymentPolicy: 'deposit', depositPercent: 101 }).error).toBeTruthy();
        expect(validatePaymentPolicyInput({ paymentPolicy: 'deposit', depositAmount: 0 }).error).toBeTruthy();
        expect(validatePaymentPolicyInput({ paymentPolicy: 'deposit', depositPercent: 'mucho' }).error).toBeTruthy();
    });

    it('deja limpiar el anticipo mandando vacio', () => {
        const out = validatePaymentPolicyInput({ paymentPolicy: 'full', depositPercent: '', depositAmount: null });
        expect(out.error).toBeUndefined();
        expect(out.values).toEqual({ payment_policy: 'full', deposit_percent: null, deposit_amount: null });
    });

    it('no toca nada cuando el formulario no mando la politica', () => {
        // Un guardado que solo cambia el nombre no puede resetear el cobro.
        expect(validatePaymentPolicyInput({})).toEqual({ values: {} });
    });
});
