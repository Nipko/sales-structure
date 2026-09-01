import { sumInUsdCents, toUsdCents, usdRateMap } from './fx.util';

/**
 * La convención de dirección importa: el catálogo de planes guarda USD→X
 * ("X por USD", p. ej. USD→COP = 4100), así que convertir X→USD divide.
 * Estos tests fijan esa aritmética y los fallbacks de resolución.
 */
describe('fx.util', () => {
    const prismaWithRates = (rows: Array<{ fromCurrency: string; toCurrency: string; rate: number; rateDate: Date }>) => ({
        exchangeRate: {
            findFirst: jest.fn(async ({ where, orderBy }: any) => {
                const candidates = rows
                    .filter((r) => r.fromCurrency === where.fromCurrency && r.toCurrency === where.toCurrency)
                    .filter((r) => (where.rateDate?.lte ? r.rateDate <= where.rateDate.lte : true))
                    .sort((a, b) => b.rateDate.getTime() - a.rateDate.getTime());
                void orderBy;
                return candidates[0] ?? null;
            }),
        },
    }) as any;

    it('USD es identidad y no consulta la base', async () => {
        const prisma = prismaWithRates([]);
        const rates = await usdRateMap(prisma, ['USD', 'usd', null as any], new Date('2026-08-31'));
        expect(rates.get('USD')).toBe(1);
        expect(prisma.exchangeRate.findFirst).not.toHaveBeenCalled();
    });

    it('convierte COP→USD dividiendo por la tasa USD→COP (la dirección del catálogo)', async () => {
        const prisma = prismaWithRates([
            { fromCurrency: 'USD', toCurrency: 'COP', rate: 4000, rateDate: new Date('2026-08-01') },
        ]);
        const rates = await usdRateMap(prisma, ['COP'], new Date('2026-08-31'));
        // 8.200.000 centavos COP (= 82.000 COP) a 4000 COP/USD → 2.050 centavos USD
        expect(toUsdCents(8_200_000, 'COP', rates)).toBe(2050);
    });

    it('acepta la dirección inversa (COP→USD multiplicando) si es la única cargada', async () => {
        const prisma = prismaWithRates([
            { fromCurrency: 'COP', toCurrency: 'USD', rate: 0.00025, rateDate: new Date('2026-08-01') },
        ]);
        const rates = await usdRateMap(prisma, ['COP'], new Date('2026-08-31'));
        expect(toUsdCents(8_000_000, 'COP', rates)).toBe(2000);
    });

    it('prefiere la última tasa ≤ fecha de referencia y cae a la última disponible', async () => {
        const prisma = prismaWithRates([
            { fromCurrency: 'USD', toCurrency: 'COP', rate: 4000, rateDate: new Date('2026-07-01') },
            { fromCurrency: 'USD', toCurrency: 'COP', rate: 5000, rateDate: new Date('2026-09-15') },
        ]);
        const augustRates = await usdRateMap(prisma, ['COP'], new Date('2026-08-31'));
        expect(toUsdCents(4_000_00, 'COP', augustRates)).toBe(100); // usa 4000, no 5000

        const juneRates = await usdRateMap(prisma, ['COP'], new Date('2026-06-01'));
        // Sin tasa ≤ junio: cae a la más reciente en absoluto (5000).
        expect(toUsdCents(5_000_00, 'COP', juneRates)).toBe(100);
    });

    it('una moneda sin tasa queda fuera del total y declarada en missingRates', async () => {
        const prisma = prismaWithRates([
            { fromCurrency: 'USD', toCurrency: 'COP', rate: 4000, rateDate: new Date('2026-08-01') },
        ]);
        const rates = await usdRateMap(prisma, ['COP', 'BRL', 'USD'], new Date('2026-08-31'));
        const sum = sumInUsdCents(
            [
                { amountCents: 8_000_000, currency: 'COP' }, // 2.000 USD cents
                { amountCents: 1_234, currency: 'BRL' }, // sin tasa
                { amountCents: 500, currency: 'USD' },
                { amountCents: 4_000_000, currency: 'COP' }, // 1.000 USD cents
            ],
            rates,
        );
        expect(sum.usdCents).toBe(2000 + 500 + 1000);
        expect(sum.missingRates).toEqual(['BRL']);
        expect(sum.byCurrency.COP.amountCents).toBe(12_000_000);
        expect(sum.byCurrency.COP.usdCents).toBe(3000);
        expect(sum.byCurrency.BRL.usdCents).toBeNull();
        expect(toUsdCents(1_234, 'BRL', rates)).toBeNull();
    });
});
