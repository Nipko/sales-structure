import type { PrismaService } from '../prisma/prisma.service';

/**
 * Conversión a USD para métricas financieras.
 *
 * Los pagos se registran en la moneda en que se cobraron (el motor Wompi en
 * COP; Stripe en USD) mientras el MRR y los costos LLM/infra viven en centavos
 * USD. Sumar `amount_cents` crudos mezcla monedas, así que todo agregado de
 * revenue pasa por acá.
 *
 * Las tasas viven en `exchange_rates` (se cargan desde /admin/financials →
 * Settings) y se aceptan en cualquiera de las dos direcciones: USD→X ("X por
 * USD", la dirección que ya usa el catálogo de planes) o X→USD. Se toma la más
 * reciente con `rate_date` ≤ la fecha de referencia; si no hay ninguna
 * anterior, la más reciente disponible. Si no existe tasa para una moneda, el
 * monto queda SIN convertir y se reporta aparte — inventar una tasa sería peor
 * que declarar el hueco.
 */

/** moneda → USD por unidad (multiplicador); null = sin tasa cargada. */
export type FxRateMap = Map<string, number | null>;

export async function usdRateMap(
    prisma: PrismaService,
    currencies: Array<string | null | undefined>,
    referenceDate: Date,
): Promise<FxRateMap> {
    const map: FxRateMap = new Map();
    const unique = [...new Set(currencies.map((c) => (c || 'USD').toUpperCase()))];
    for (const currency of unique) {
        if (currency === 'USD') {
            map.set(currency, 1);
            continue;
        }
        map.set(currency, await resolveUsdRate(prisma, currency, referenceDate));
    }
    return map;
}

async function resolveUsdRate(
    prisma: PrismaService,
    currency: string,
    referenceDate: Date,
): Promise<number | null> {
    // USD→X guarda "X por unidad de USD": convertir X→USD es dividir.
    const direct = await latestRate(prisma, 'USD', currency, referenceDate);
    if (direct != null && direct > 0) return 1 / direct;
    const inverse = await latestRate(prisma, currency, 'USD', referenceDate);
    if (inverse != null && inverse > 0) return inverse;
    return null;
}

async function latestRate(
    prisma: PrismaService,
    from: string,
    to: string,
    referenceDate: Date,
): Promise<number | null> {
    const bounded = await prisma.exchangeRate.findFirst({
        where: { fromCurrency: from, toCurrency: to, rateDate: { lte: referenceDate } },
        orderBy: { rateDate: 'desc' },
    });
    if (bounded) return Number(bounded.rate);
    const any = await prisma.exchangeRate.findFirst({
        where: { fromCurrency: from, toCurrency: to },
        orderBy: { rateDate: 'desc' },
    });
    return any ? Number(any.rate) : null;
}

export interface UsdSum {
    /** Total convertido; excluye las monedas sin tasa (ver missingRates). */
    usdCents: number;
    byCurrency: Record<string, { amountCents: number; usdCents: number | null; usdPerUnit: number | null }>;
    missingRates: string[];
}

export function sumInUsdCents(
    rows: Array<{ amountCents: number; currency: string | null }>,
    rates: FxRateMap,
): UsdSum {
    const byCurrency: UsdSum['byCurrency'] = {};
    for (const row of rows) {
        const currency = (row.currency || 'USD').toUpperCase();
        byCurrency[currency] ??= {
            amountCents: 0,
            usdCents: null,
            usdPerUnit: rates.get(currency) ?? null,
        };
        byCurrency[currency].amountCents += row.amountCents;
    }
    let usdCents = 0;
    const missingRates: string[] = [];
    for (const [currency, bucket] of Object.entries(byCurrency)) {
        if (bucket.usdPerUnit == null) {
            missingRates.push(currency);
            continue;
        }
        bucket.usdCents = Math.round(bucket.amountCents * bucket.usdPerUnit);
        usdCents += bucket.usdCents;
    }
    return { usdCents, byCurrency, missingRates };
}

/** Convierte un monto individual; null si no hay tasa para esa moneda. */
export function toUsdCents(
    amountCents: number,
    currency: string | null,
    rates: FxRateMap,
): number | null {
    const rate = rates.get((currency || 'USD').toUpperCase());
    return rate == null ? null : Math.round(amountCents * rate);
}
