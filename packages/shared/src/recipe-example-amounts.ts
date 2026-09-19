/**
 * D17 (sep-2026) — montos de ejemplo por país.
 *
 * El registro de verticales guarda cada precio sembrado como una REFERENCIA en
 * pesos colombianos. Ese número nunca fue un precio de mercado: es el orden de
 * magnitud que hace que la tarjeta del día 0 se vea llena en vez de vacía. Lo
 * que estaba mal es que un dueño mexicano abría "Consulta general" y leía
 * `80.000 COP`, un número que no significa nada en su país y que tenía que
 * borrar a mano antes de escribir el suyo.
 *
 * Seis países tienen monto de ejemplo en su propia moneda. En cualquier otro,
 * la tarjeta muestra el espacio en blanco `[precio]` y la fila se siembra sin
 * monto: un número en la moneda equivocada es peor que ningún número.
 *
 * TRES COSAS QUE ESTO NO ES:
 *
 * 1. **No es una tasa de cambio.** Los factores de abajo son proporciones
 *    redondas elegidas a mano para que el ejemplo caiga en un orden de
 *    magnitud creíble en cada país. No se actualizan con el mercado y no deben
 *    usarse jamás para convertir dinero que alguien paga: para eso está
 *    `OperatingCurrencyService`, que exige una foto de FX con fecha y deja
 *    linaje de cada conversión.
 * 2. **No es un precio que el agente pueda decir.** D10 siembra cada fila con
 *    `price_status = 'example'`, y ningún camino hacia el cliente o hacia el
 *    modelo entrega un monto que no esté confirmado. Estos números los ve el
 *    dueño en su panel, nadie más, hasta que los confirma.
 * 3. **No es una promesa de cobertura.** Que un país no esté acá no lo saca de
 *    `ONBOARDING_COUNTRIES`: significa que su receta nace con el espacio en
 *    blanco, que es exactamente lo que el diseño pide.
 *
 * Argentina se recalibra a mano cuando la inflación mueve el orden de
 * magnitud; por eso el factor vive en una sola tabla y no repartido por el
 * registro.
 */

import { COUNTRY_DEFAULT_CURRENCY } from './tenant-regional-profile';

/** La moneda en la que están escritas TODAS las referencias del registro. */
export const RECIPE_REFERENCE_CURRENCY = 'COP';

/**
 * Los seis países con monto de ejemplo real (decisión D17-A del dueño).
 * El resto de los países del alta muestra `[precio]`.
 */
export const RECIPE_EXAMPLE_AMOUNT_COUNTRIES = ['CO', 'MX', 'AR', 'CL', 'PE', 'BR'] as const;

export type RecipeExampleAmountCountry = typeof RECIPE_EXAMPLE_AMOUNT_COUNTRIES[number];

/** El espacio en blanco que reemplaza al monto donde no hay ejemplo. */
export const RECIPE_PRICE_BLANK = '[precio]';

/**
 * Cuántas unidades de la moneda local vale una unidad de la referencia.
 *
 * Elegidos para que un servicio de gama media caiga donde un dueño de ese país
 * lo esperaría, no para reproducir una cotización. Redondeo aparte (ver
 * `roundToPlausibleStep`), son proporciones fijas: el orden relativo de los
 * servicios de una receta se conserva en los seis países.
 */
const UNITS_PER_REFERENCE: Readonly<Record<RecipeExampleAmountCountry, number>> = {
    CO: 1,
    MX: 1 / 160,
    AR: 2.7,
    CL: 0.24,
    PE: 1 / 1080,
    BR: 1 / 740,
};

const COUNTRY_SET: ReadonlySet<string> = new Set<string>(RECIPE_EXAMPLE_AMOUNT_COUNTRIES);

/** Un país con monto de ejemplo, o no. Acepta minúsculas y espacios del alta. */
export function countryHasExampleAmounts(country?: string | null): country is RecipeExampleAmountCountry {
    return COUNTRY_SET.has(normaliseCountry(country));
}

function normaliseCountry(country?: string | null): string {
    return typeof country === 'string' ? country.trim().toUpperCase() : '';
}

/**
 * Redondea a un número que una persona escribiría.
 *
 * Un ejemplo con cifras significativas hasta la unidad (`216.216`) se lee como
 * un precio calculado, y el dueño lo trata como un dato nuestro en vez de como
 * un lugar para poner el suyo. El escalón crece con la magnitud para que el
 * resultado siga siendo redondo en monedas tan distintas como el peso chileno
 * y el sol peruano.
 */
export function roundToPlausibleStep(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    const step = value >= 100_000 ? 10_000
        : value >= 10_000 ? 1_000
            : value >= 1_000 ? 100
                : value >= 100 ? 10
                    : value >= 10 ? 5
                        : 1;
    // Nunca redondear hacia abajo hasta cero: un ejemplo de cero se leería como
    // "gratis", que es una afirmación sobre el negocio y no un espacio vacío.
    return Math.max(step, Math.round(value / step) * step);
}

export interface RecipeExampleAmount {
    /**
     * El monto en la moneda del país, o `null` cuando el país no tiene ejemplo.
     * `0` significa exactamente cero (la referencia era cero), no "sin dato".
     */
    amount: number | null;
    /** ISO 4217 del país, o `null` junto con el monto. */
    currency: string | null;
}

/**
 * Traduce una referencia del registro al ejemplo que ve el dueño.
 *
 * Una referencia de cero pasa tal cual: significa "sin monto" y la receta debe
 * declarar aparte si eso es "se cotiza" o "todavía no lo sé".
 */
export function recipeExampleAmount(referenceCop: number, country?: string | null): RecipeExampleAmount {
    const code = normaliseCountry(country);
    if (!countryHasExampleAmounts(code)) return { amount: null, currency: null };
    const currency = COUNTRY_DEFAULT_CURRENCY[code] ?? null;
    if (!currency) return { amount: null, currency: null };
    if (!Number.isFinite(referenceCop) || referenceCop <= 0) return { amount: 0, currency };
    return { amount: roundToPlausibleStep(referenceCop * UNITS_PER_REFERENCE[code]), currency };
}

/**
 * Lo que se escribe en la fila de `services` al sembrar.
 *
 * Fuera de los seis países la fila nace **sin monto pero con la moneda del
 * negocio**: el dueño escribe su número y la fila ya sabe en qué moneda está.
 * Sembrar `0` sería peor que sembrar nada, porque un cero se lee como "gratis"
 * y porque volvería a mezclar "se cotiza" con "todavía no lo sé", que es justo
 * lo que D10 separó.
 *
 * Si tampoco sabemos el país, la fila nace sin moneda: la columna tiene
 * `DEFAULT 'COP'`, así que pasar `null` explícito es lo único que impide que
 * el peso colombiano vuelva a entrar por la puerta de atrás.
 */
export function recipeSeedPrice(referenceCop: number, country?: string | null): { price: number | null; currency: string | null } {
    const code = normaliseCountry(country);
    if (!code) return { price: null, currency: null };
    const currency = COUNTRY_DEFAULT_CURRENCY[code] ?? null;
    if (!countryHasExampleAmounts(code)) return { price: null, currency };
    const { amount } = recipeExampleAmount(referenceCop, code);
    return { price: amount, currency };
}
