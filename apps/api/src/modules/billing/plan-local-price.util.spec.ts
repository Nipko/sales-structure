import { resolveLocalPlanPrice } from './plan-local-price.util';

describe('resolveLocalPlanPrice', () => {
    const overrides = {
        CO: {
            currency: 'COP',
            amountCents: 27_690_000,
            // Así lo deja el seed: la moneda vive arriba, la fila anual sólo trae
            // el importe.
            annual: { amountCents: 282_438_000 },
        },
    };

    it('resuelve el mensual del país', () => {
        expect(resolveLocalPlanPrice(overrides, 'CO', 'monthly'))
            .toEqual({ amountCents: 27_690_000, currency: 'COP' });
    });

    it('el anual hereda la moneda del país', () => {
        // Exigirla dentro de `annual` ataba el ciclo anual al sync de
        // MercadoPago, el único que la escribía ahí: bajo un operador sin
        // catálogo remoto el anual quedaba bloqueado para siempre.
        expect(resolveLocalPlanPrice(overrides, 'CO', 'annual'))
            .toEqual({ amountCents: 282_438_000, currency: 'COP' });
    });

    it('sin país cae en Colombia, igual que el alta y el catálogo', () => {
        expect(resolveLocalPlanPrice(overrides, null, 'monthly')?.amountCents).toBe(27_690_000);
    });

    it('normaliza el país para no perder un precio por el formato de la clave', () => {
        expect(resolveLocalPlanPrice({ ' co ': overrides.CO }, 'CO', 'monthly')?.amountCents)
            .toBe(27_690_000);
    });

    it.each([
        ['país sin precio configurado', overrides, 'AR', 'monthly'],
        ['ciclo sin precio', { CO: { currency: 'COP', amountCents: 100 } }, 'CO', 'annual'],
        ['importe cero', { CO: { currency: 'COP', amountCents: 0 } }, 'CO', 'monthly'],
        ['importe negativo', { CO: { currency: 'COP', amountCents: -5 } }, 'CO', 'monthly'],
        ['sin moneda por ningún lado', { CO: { amountCents: 100 } }, 'CO', 'monthly'],
        ['overrides vacíos', {}, 'CO', 'monthly'],
        ['overrides nulos', null, 'CO', 'monthly'],
    ])('devuelve null: %s', (_label, ovr, country, cycle) => {
        // Fail-closed: sin precio válido no se cobra. Devolver un default acá
        // sería inventar plata.
        expect(resolveLocalPlanPrice(ovr, country, cycle as any)).toBeNull();
    });
});
