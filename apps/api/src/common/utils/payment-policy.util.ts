/**
 * ¿Este ítem se puede confirmar sin que el cliente pague?
 *
 * Lo decide el dueño por producto o servicio, y el agente tiene que saberlo
 * ANTES de confirmar. Sin esto la agente decía "tu reserva quedó confirmada" y
 * recién después salía a buscar el enlace de pago — al revés de como se vende.
 *
 * El cupo NO se reserva mientras no se pague (decisión del dueño): la operación
 * queda en `pending_payment` y no ocupa la fecha. Gana el que pague primero, así
 * que el listener del cobro tiene que revalidar disponibilidad antes de
 * confirmar.
 */

export type PaymentPolicyMode = 'none' | 'full' | 'deposit' | 'any';

/**
 * Una operación creada y todavía no pagada. **No ocupa el cupo.**
 *
 * Es lo que la distingue de 'confirmed': existe para poder cobrarla y para que
 * el dueño la vea, pero la fecha sigue a la venta hasta que entre la plata.
 */
export const PENDING_PAYMENT_STATUS = 'pending_payment';

/**
 * Estados que NO cuentan como cupo ocupado, listos para intercalar en un `NOT IN`.
 *
 * Es una constante de compilación —nunca entra nada del usuario acá— y vive al
 * lado del estado para que la consulta y la lógica no se separen: si mañana se
 * agrega otro estado que no ocupa, se agrega en un solo lugar.
 */
export const OCCUPANCY_EXCLUDED_SQL = `'${PENDING_PAYMENT_STATUS}'`;

const MODES: ReadonlySet<string> = new Set(['none', 'full', 'deposit', 'any']);

export interface SellablePaymentConfig {
    payment_policy?: unknown;
    deposit_percent?: unknown;
    deposit_amount?: unknown;
}

export interface ResolvedPaymentPolicy {
    mode: PaymentPolicyMode;
    requiresPayment: boolean;
    /** Lo mínimo a cobrar para confirmar. null cuando no hay que cobrar nada. */
    dueAmount: number | null;
    /** El precio completo del ítem, para poder decir cuánto queda pendiente. */
    totalAmount: number;
    /** El cliente elige entre anticipo y total (modo 'any'). */
    customerChooses: boolean;
    /** El dueño pidió pago pero no configuró el anticipo: se cobra el total. */
    degradedFromDeposit: boolean;
}

function toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = typeof value === 'number' ? value : Number(String(value));
    return Number.isFinite(n) ? n : null;
}

export function resolvePaymentPolicy(
    item: SellablePaymentConfig | null | undefined,
    totalAmount: unknown,
): ResolvedPaymentPolicy {
    const total = Math.max(0, toNumber(totalAmount) ?? 0);
    const raw = String((item as any)?.payment_policy ?? 'none').trim().toLowerCase();
    // Un valor desconocido se comporta como antes en vez de bloquear ventas:
    // es un dato de configuración, no una decisión de seguridad.
    const declared: PaymentPolicyMode = MODES.has(raw) ? (raw as PaymentPolicyMode) : 'none';

    const none: ResolvedPaymentPolicy = {
        mode: 'none', requiresPayment: false, dueAmount: null,
        totalAmount: total, customerChooses: false, degradedFromDeposit: false,
    };

    // Sin precio no hay nada que cobrar, diga lo que diga la política: exigir un
    // pago de cero dejaría la operación colgada para siempre.
    if (declared === 'none' || total <= 0) return none;

    const fixed = toNumber((item as any)?.deposit_amount);
    const percent = toNumber((item as any)?.deposit_percent);
    // El monto fijo gana sobre el porcentaje: es lo que el dueño escribió último
    // y le permite decir "cincuenta mil y listo" sin pensar en proporciones.
    const deposit = fixed && fixed > 0
        ? Math.min(fixed, total)
        : (percent && percent > 0 ? Math.round(total * Math.min(percent, 100) / 100) : null);

    if (declared === 'full') {
        return { ...none, mode: 'full', requiresPayment: true, dueAmount: total };
    }

    // Pidió anticipo y no lo configuró. Su intención fue "no confirmar sin
    // plata", así que se cobra el total: es lo que respeta la intención sin
    // inventar un importe. Queda marcado para poder avisarle.
    if (!deposit || deposit <= 0) {
        return {
            ...none, mode: declared, requiresPayment: true,
            dueAmount: total, customerChooses: false, degradedFromDeposit: true,
        };
    }

    return {
        ...none,
        mode: declared,
        requiresPayment: true,
        dueAmount: deposit,
        customerChooses: declared === 'any' && deposit < total,
    };
}

/**
 * Valida lo que el dueño mandó desde el panel y lo normaliza a columnas.
 *
 * La validación vive acá y no en un CHECK de la base porque `ADD CONSTRAINT` no
 * admite `IF NOT EXISTS` y un deploy que corre dos veces fallaría — y porque un
 * mensaje explicando qué falta vale más que un 23514.
 *
 * Devuelve `error` en vez de tirar para que cada servicio lance la excepción de
 * su framework sin que este archivo dependa de ninguno.
 */
export function validatePaymentPolicyInput(data: {
    paymentPolicy?: unknown;
    depositPercent?: unknown;
    depositAmount?: unknown;
}): { error?: string; values: { payment_policy?: string; deposit_percent?: number | null; deposit_amount?: number | null } } {
    const values: { payment_policy?: string; deposit_percent?: number | null; deposit_amount?: number | null } = {};

    if (data.paymentPolicy !== undefined) {
        const mode = String(data.paymentPolicy ?? '').trim().toLowerCase();
        if (!MODES.has(mode)) {
            return { error: `La política de pago debe ser una de: ${[...MODES].join(', ')}.`, values };
        }
        values.payment_policy = mode;
    }

    const readOptionalNumber = (raw: unknown): number | null | undefined => {
        if (raw === undefined) return undefined;
        if (raw === null || raw === '') return null;
        const n = toNumber(raw);
        return n === null ? NaN : n;
    };

    const percent = readOptionalNumber(data.depositPercent);
    if (percent !== undefined) {
        if (percent !== null && (Number.isNaN(percent) || percent <= 0 || percent > 100)) {
            return { error: 'El anticipo por porcentaje debe estar entre 1 y 100.', values };
        }
        values.deposit_percent = percent;
    }

    const amount = readOptionalNumber(data.depositAmount);
    if (amount !== undefined) {
        if (amount !== null && (Number.isNaN(amount) || amount <= 0)) {
            return { error: 'El anticipo de monto fijo debe ser mayor que cero.', values };
        }
        values.deposit_amount = amount;
    }

    // Pedir anticipo sin decir cuánto se acepta en la base (una fila vieja
    // degrada a cobrar el total), pero desde el panel se rechaza: el dueño cree
    // que configuró un anticipo y le estaríamos cobrando todo al cliente.
    const needsDeposit = values.payment_policy === 'deposit' || values.payment_policy === 'any';
    if (needsDeposit && !values.deposit_percent && !values.deposit_amount) {
        return { error: 'Para pedir un anticipo hay que indicar el porcentaje o el monto.', values };
    }

    return { values };
}

/** Lo que se le cuenta al agente para que sepa cómo proceder antes de confirmar. */
export function describePaymentPolicy(policy: ResolvedPaymentPolicy): string | undefined {
    if (!policy.requiresPayment) return undefined;
    if (policy.customerChooses) {
        return `Para confirmar hace falta pagar: el cliente puede abonar ${policy.dueAmount} como anticipo `
            + `o ${policy.totalAmount} completo. No la des por confirmada hasta que el pago esté acreditado.`;
    }
    if (policy.dueAmount != null && policy.dueAmount < policy.totalAmount) {
        return `Para confirmar hace falta un anticipo de ${policy.dueAmount} (de un total de ${policy.totalAmount}). `
            + `No la des por confirmada hasta que el pago esté acreditado.`;
    }
    return `Para confirmar hace falta pagar ${policy.totalAmount}. `
        + `No la des por confirmada hasta que el pago esté acreditado.`;
}
