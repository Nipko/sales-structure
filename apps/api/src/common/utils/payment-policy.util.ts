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
 * Una retención que nadie pagó y ya venció.
 *
 * Es sólo higiene de estado: las fechas ya estaban libres por reloj antes de que
 * nadie escribiera esto. Lo que aporta es dejar de mostrar como "esperando el
 * pago" algo que dejó de esperar hace horas.
 */
export const EXPIRED_HOLD_STATUS = 'expired';

/**
 * Lo que se le publica a las OTAs: sólo lo pagado y firme.
 *
 * Una retención de 20 minutos NO sale al feed. Publicarla sería ruido —Airbnb y
 * Booking releen cada varios minutos, así que el bloqueo llegaría cuando ya
 * venció— y ensuciaría el calendario del dueño con huecos que aparecen y
 * desaparecen. La retención protege contra nuestras propias reservas
 * simultáneas; la carrera contra una OTA es inherente al polling del iCal y ya
 * existía.
 *
 * Y una retención VENCIDA tampoco, por una razón más cara: publicarla le diría a
 * Airbnb y a Booking que esas fechas están ocupadas cuando en realidad volvieron
 * a estar libres. Perder reservas por publicar bloqueos fantasma es peor que
 * cualquier eco.
 */
export const EXPORT_EXCLUDED_SQL = `'${PENDING_PAYMENT_STATUS}', '${EXPIRED_HOLD_STATUS}'`;

/**
 * Cuánto se le guardan las fechas al cliente mientras paga.
 *
 * 20 y no 15 por PSE: la transferencia bancaria saca al cliente al sitio del
 * banco, le pide autenticarse y recién después lo devuelve. Quince minutos le
 * quedaban justos, y una retención que vence MIENTRAS el cliente paga es el peor
 * de los mundos — termina en "cobrado sin lugar", que es plata real sin nada que
 * entregar. Con tarjeta sobra de todos modos.
 */
export const PAYMENT_HOLD_MS = 20 * 60 * 1000;

/**
 * Una operación impaga ocupa cupo SOLO mientras la retención sigue viva.
 *
 * Reemplaza a la lista de "estados que no ocupan": el estado ya no alcanza,
 * porque un `pending_payment` de hace treinta segundos y uno de hace dos horas
 * significan cosas opuestas. El primero es una promesa vigente —le dijimos al
 * cliente que le guardábamos las fechas— y el segundo es basura.
 *
 * La caducidad es **por tiempo, no por estado**: nadie tiene que correr un cron
 * para liberar el cupo. Si el barrido muere, las fechas se liberan igual. Un
 * `hold_expires_at` en NULL nunca ocupa, que es lo que mantiene compatibles a
 * las filas anteriores a la retención.
 *
 * Es una constante de compilación: `alias` sólo lo escribe el llamador, nunca
 * el usuario.
 */
export function holdStillAliveSql(alias = ''): string {
    const a = alias ? `${alias}.` : '';
    // `expired` NUNCA ocupa, mire el reloj o no. El barrido marca así las
    // retenciones que nadie pagó, y sin esta condición hacía justo lo contrario
    // de lo que promete: una fila vencida dejaba de ser `pending_payment`, se
    // escapaba de la comparación del reloj, y las fechas que acababa de liberar
    // volvían a contar como ocupadas.
    return `(${a}status <> '${EXPIRED_HOLD_STATUS}'`
        + ` AND (${a}status <> '${PENDING_PAYMENT_STATUS}' OR ${a}hold_expires_at > NOW()))`;
}

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
    const minutes = Math.round(PAYMENT_HOLD_MS / 60000);
    // La retención es una promesa concreta que el sistema SÍ cumple, así que hay
    // que decirla: es lo que convierte "pagá y ojalá quede" en "te lo guardo".
    // Y es lo que justifica la urgencia sin inventar presión de venta.
    const hold = ` Decile que le guardamos el cupo ${minutes} minutos mientras paga, y que pasado ese rato `
        + `vuelve a quedar disponible para otros.`;
    const notYet = ' No lo des por confirmado hasta que el pago esté acreditado.';

    if (policy.customerChooses) {
        return `Para confirmar hace falta pagar: el cliente puede abonar ${policy.dueAmount} como anticipo `
            + `o ${policy.totalAmount} completo.${notYet}${hold}`;
    }
    if (policy.dueAmount != null && policy.dueAmount < policy.totalAmount) {
        return `Para confirmar hace falta un anticipo de ${policy.dueAmount} (de un total de ${policy.totalAmount}).`
            + `${notYet}${hold}`;
    }
    return `Para confirmar hace falta pagar ${policy.totalAmount}.${notYet}${hold}`;
}
