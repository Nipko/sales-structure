import { optionalCurrencyCode } from './commercial-units.util';

/**
 * Lo único que un escritor comercial necesita saber del perfil regional.
 *
 * Structural a propósito: los fixtures que construyen estos servicios a mano
 * pasan `{ operatingCurrencyFor }` y no el servicio entero, y ningún módulo de
 * vertical tiene que importar `tenants/` para escribir una fila con su moneda.
 */
export interface OperatingCurrencySource {
    operatingCurrencyFor(tenantId: string): Promise<string | null>;
}

/**
 * La moneda con la que se escribe una fila comercial (D17).
 *
 * Orden, y no hay un cuarto escalón:
 *
 *  1. lo que el llamador mandó explícito;
 *  2. la moneda operativa del negocio (perfil regional, que ya distingue lo
 *     declarado de lo deducido y contesta `null` cuando sólo sabría el
 *     fallback);
 *  3. NULL.
 *
 * `normalizeCurrencyCode(data.currency)` tiene `fallback = 'COP'`, así que todo
 * escritor que lo llamara sin moneda le estampaba pesos colombianos a la fila
 * estuviera donde estuviera el negocio — y esa moneda viaja al agente, que se
 * la dice al cliente sin conversión y sin que nadie la haya elegido.
 *
 * NULL es deliberado y **no** es lo mismo que omitir la columna: todas estas
 * columnas son `VARCHAR(10) DEFAULT 'COP'`, así que dejar de pasar el parámetro
 * reabre exactamente la misma puerta. Hay que pasar el NULL explícito.
 */
export async function resolveWriteCurrency(
    requested: unknown,
    tenantId?: string,
    regional?: OperatingCurrencySource,
): Promise<string | null> {
    const explicit = optionalCurrencyCode(requested);
    if (explicit) return explicit;
    if (!tenantId || !regional) return null;
    return regional.operatingCurrencyFor(tenantId);
}
