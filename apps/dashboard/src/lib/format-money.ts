/**
 * Formatear un importe sin inventarle una moneda.
 *
 * Las pantallas escribían `currency: "COP"` fijo, o `record.currency || "COP"`.
 * Lo primero **pisa** la moneda que el registro trae —un pedido en MXN se
 * mostraba como pesos colombianos, que es convertir un importe sin tipo de
 * cambio, justo lo que el contrato del agente prohíbe hacer—. Lo segundo
 * inventa una cuando no se sabe.
 *
 * Sin moneda no se pone símbolo. Un número desnudo es incómodo; un número con
 * el símbolo equivocado es una cifra falsa que alguien puede cobrar.
 */
export function formatMoney(
    amount: number | string | null | undefined,
    currency?: string | null,
    options: { locale?: string; maximumFractionDigits?: number } = {},
): string {
    const value = typeof amount === "string" ? Number(amount) : amount;
    if (value === null || value === undefined || Number.isNaN(value)) return "—";

    const locale = options.locale;
    const maximumFractionDigits = options.maximumFractionDigits ?? 0;

    if (!currency || !/^[A-Za-z]{3}$/.test(currency)) {
        return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
    }
    return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: currency.toUpperCase(),
        minimumFractionDigits: 0,
        maximumFractionDigits,
    }).format(value);
}
