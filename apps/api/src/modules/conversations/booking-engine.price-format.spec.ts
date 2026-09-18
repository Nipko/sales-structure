import { formatPriceAmount, formatPriceWithCurrency } from './booking-engine.service';

/**
 * D17 (sep-2026) — los separadores de miles no son colombianos por decreto.
 *
 * El listado de servicios formateaba TODO precio con `toLocaleString('es-CO')`,
 * mientras el código de moneda salía de la fila. Un precio confirmado en MXN se
 * leía "1.500 MXN": agrupación colombiana sobre una cifra mexicana, en la misma
 * línea. La agrupación sigue ahora al idioma de la conversación, que es el dato
 * de locale que este motor tiene en la mano.
 *
 * Lo segundo que fija esto: sin moneda no se inventa ninguna. Una fila sembrada
 * antes de que el negocio declarara su país nace con `currency` en NULL, y la
 * salida vieja habría escrito "1.500 null" al cliente.
 */
describe('booking prices follow the conversation language', () => {
    it('groups thousands per language instead of always Colombian', () => {
        expect(formatPriceAmount('es', 80000)).toBe('80.000');
        expect(formatPriceAmount('pt', 80000)).toBe('80.000');
        expect(formatPriceAmount('en', 80000)).toBe('80,000');
        // Francés agrupa con espacio estrecho: importa que NO sea un punto.
        expect(formatPriceAmount('fr', 80000)).not.toContain('.');
        expect(formatPriceAmount('fr', 80000).replace(/\D/g, '')).toBe('80000');
    });

    it('groups four-digit prices too, which generic Spanish would not', () => {
        // Sin `useGrouping: 'always'`, el CLDR del `es` genérico imprime "1500"
        // y un precio se lee como un código de producto.
        expect(formatPriceAmount('es', 1500)).toBe('1.500');
        expect(formatPriceAmount('en', 1500)).toBe('1,500');
    });

    it('accepts the full locale tag the pipeline may carry, not just the two letters', () => {
        expect(formatPriceAmount('es-MX', 80000)).toBe(formatPriceAmount('es', 80000));
        expect(formatPriceAmount('', 80000)).toBe(formatPriceAmount('es', 80000));
        // Un idioma que el motor no habla cae al español, igual que `msg()`.
        expect(formatPriceAmount('de', 80000)).toBe(formatPriceAmount('es', 80000));
    });

    it('states the row currency and never substitutes one', () => {
        expect(formatPriceWithCurrency('es', 80000, 'MXN')).toBe('80.000 MXN');
        expect(formatPriceWithCurrency('es', 80000, ' mxn ')).toBe('80.000 MXN');
        expect(formatPriceWithCurrency('en', 2500, 'USD')).toBe('2,500 USD');
    });

    it('says the bare number when the row has no currency', () => {
        expect(formatPriceWithCurrency('es', 80000, null)).toBe('80.000');
        expect(formatPriceWithCurrency('es', 80000, undefined)).toBe('80.000');
        expect(formatPriceWithCurrency('es', 80000, '')).toBe('80.000');
        // Basura en la columna tampoco se imprime: "80.000 peso" no es un precio.
        expect(formatPriceWithCurrency('es', 80000, 'peso')).toBe('80.000');
    });

    it('says nothing at all when there is no number', () => {
        expect(formatPriceWithCurrency('es', null, 'COP')).toBe('');
        expect(formatPriceWithCurrency('es', undefined, 'COP')).toBe('');
        expect(formatPriceAmount('es', 'abc')).toBe('');
    });
});
