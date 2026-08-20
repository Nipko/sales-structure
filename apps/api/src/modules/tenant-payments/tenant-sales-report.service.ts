import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EXPIRED_HOLD_STATUS, PENDING_PAYMENT_STATUS } from '../../common/utils/payment-policy.util';

/**
 * Cómo va el negocio, en plata de verdad.
 *
 * Integramos el cobro y nadie lo contaba: la analítica del tenant medía
 * conversaciones, tiempos de respuesta y métricas de IA, pero no había una sola
 * cifra de dinero. El dueño no tenía forma de saber cuánto entró.
 *
 * La distinción que hace útil a este reporte —y la razón de que no alcance con
 * sumar pagos— es que un anticipo NO es una venta cobrada. Son tres números
 * distintos y mezclarlos da una foto falsa en las dos direcciones:
 *
 *   · COBRADO      — plata acreditada, que ya está en la cuenta.
 *   · POR COBRAR   — el saldo de lo que se confirmó con anticipo. Es dinero
 *                    comprometido, no dinero que entró.
 *   · EN PROCESO   — operaciones con la retención viva, esperando el pago. No es
 *                    venta todavía: puede vencer.
 *
 * Y una cuarta que casi nadie muestra pero es la que enseña: PERDIDO, las
 * retenciones que vencieron sin pagar. Es la venta que el negocio no cerró.
 *
 * Todo sale de las operaciones reales, no de estimaciones: `total_price` y
 * `amount_due` viven en la fila, así que el saldo es exacto y no una proyección.
 */

export interface SalesMoneySummary {
    currency: string;
    /** Acreditado de verdad en el período. */
    collectedCents: number;
    /** Devuelto en el período; resta del cobrado. */
    refundedCents: number;
    /** collected - refunded. */
    netCents: number;
    /** Del cobrado: cuánto vino como anticipo (hay saldo detrás). */
    fromDepositsCents: number;
    /** Del cobrado: pagos completos. */
    fromFullPaymentsCents: number;
    /** Saldo de las operaciones confirmadas con anticipo. */
    outstandingCents: number;
    /** Operaciones con la retención viva, esperando pago. */
    inProgressCents: number;
    /** Retenciones que vencieron sin pagar: la venta que no se cerró. */
    lostCents: number;
    /** Conteos, para que el dueño sepa cuántas operaciones hay detrás. */
    counts: {
        paid: number;
        withDeposit: number;
        inProgress: number;
        lost: number;
    };
}

/**
 * Las verticales que hoy pueden exigir pago para confirmar.
 *
 * Sólo estas tres tienen `amount_due` y `hold_expires_at`, que es lo que permite
 * distinguir un anticipo de un pago completo. Pedidos, comida y cursos todavía no
 * tienen política de pago: incluirlos aquí mostraría ceros y le haría creer al
 * dueño que no vendió nada por esos canales.
 */
const VENTAS_SQL = `
    SELECT 'property' AS kind, id, currency,
           ROUND(total_price * 100)::bigint AS total_cents,
           CASE WHEN amount_due IS NULL THEN NULL ELSE ROUND(amount_due * 100)::bigint END AS due_cents,
           status, hold_expires_at, created_at
      FROM property_bookings
    UNION ALL
    SELECT 'tour' AS kind, id, currency,
           ROUND(total_price * 100)::bigint AS total_cents,
           CASE WHEN amount_due IS NULL THEN NULL ELSE ROUND(amount_due * 100)::bigint END AS due_cents,
           status, hold_expires_at, created_at
      FROM tour_bookings
    UNION ALL
    SELECT 'appointment' AS kind, a.id, COALESCE(s.currency, 'COP') AS currency,
           ROUND(COALESCE(s.price, 0) * 100)::bigint AS total_cents,
           CASE WHEN a.amount_due IS NULL THEN NULL ELSE ROUND(a.amount_due * 100)::bigint END AS due_cents,
           a.status, a.hold_expires_at, a.created_at
      FROM appointments a
      LEFT JOIN services s ON s.id = a.service_id
`;

@Injectable()
export class TenantSalesReportService {
    private readonly logger = new Logger(TenantSalesReportService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * @param start / @param end  ISO date (inclusive), sobre la fecha de la operación.
     */
    async getMoneySummary(tenantId: string, start: string, end: string): Promise<SalesMoneySummary[]> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) return [];

        // Lo cobrado sale de los pagos, no de las operaciones: es la única
        // fuente que sabe que la plata entró de verdad. Y `paid_at` manda sobre
        // `created_at` porque un enlace creado en enero y pagado en febrero es
        // ingreso de febrero.
        const pagos = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT currency,
                    SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END)::bigint AS collected,
                    SUM(CASE WHEN status = 'refunded' THEN amount_cents ELSE 0 END)::bigint AS refunded,
                    COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_count
               FROM tenant_payment_intents
              WHERE status IN ('paid', 'refunded')
                AND COALESCE(paid_at, updated_at)::date BETWEEN $1::date AND $2::date
              GROUP BY currency`,
            [start, end],
        ).catch((e: any) => {
            this.logger.warn(`[Ventas] no se pudieron leer los pagos: ${e.message}`);
            return [] as any[];
        });

        // El estado de las operaciones dice qué parte de eso fue anticipo y
        // cuánto queda vivo. Un anticipo es, por definición, una fila con
        // `amount_due` menor que el total.
        const ops = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `WITH ventas AS (${VENTAS_SQL})
             SELECT currency,
                    -- Confirmadas con anticipo: lo cobrado y lo que falta.
                    SUM(CASE WHEN status NOT IN ($3, $4, 'cancelled') AND due_cents IS NOT NULL
                             THEN due_cents ELSE 0 END)::bigint AS deposits_taken,
                    SUM(CASE WHEN status NOT IN ($3, $4, 'cancelled') AND due_cents IS NOT NULL
                             THEN GREATEST(total_cents - due_cents, 0) ELSE 0 END)::bigint AS outstanding,
                    COUNT(*) FILTER (
                        WHERE status NOT IN ($3, $4, 'cancelled') AND due_cents IS NOT NULL
                    )::int AS with_deposit_count,
                    -- Esperando el pago, con la retención todavía viva.
                    SUM(CASE WHEN status = $3 AND hold_expires_at > NOW()
                             THEN COALESCE(due_cents, total_cents) ELSE 0 END)::bigint AS in_progress,
                    COUNT(*) FILTER (WHERE status = $3 AND hold_expires_at > NOW())::int AS in_progress_count,
                    -- Vencidas sin pagar: la venta que no se cerró.
                    SUM(CASE WHEN status = $4 THEN total_cents ELSE 0 END)::bigint AS lost,
                    COUNT(*) FILTER (WHERE status = $4)::int AS lost_count
               FROM ventas
              WHERE created_at::date BETWEEN $1::date AND $2::date
              GROUP BY currency`,
            [start, end, PENDING_PAYMENT_STATUS, EXPIRED_HOLD_STATUS],
        ).catch((e: any) => {
            this.logger.warn(`[Ventas] no se pudieron leer las operaciones: ${e.message}`);
            return [] as any[];
        });

        const porMoneda = new Map<string, SalesMoneySummary>();
        const vacio = (currency: string): SalesMoneySummary => ({
            currency,
            collectedCents: 0, refundedCents: 0, netCents: 0,
            fromDepositsCents: 0, fromFullPaymentsCents: 0,
            outstandingCents: 0, inProgressCents: 0, lostCents: 0,
            counts: { paid: 0, withDeposit: 0, inProgress: 0, lost: 0 },
        });

        for (const p of pagos || []) {
            const cur = String(p.currency || 'COP');
            const row = porMoneda.get(cur) || vacio(cur);
            row.collectedCents = Number(p.collected || 0);
            row.refundedCents = Number(p.refunded || 0);
            row.netCents = row.collectedCents - row.refundedCents;
            row.counts.paid = Number(p.paid_count || 0);
            porMoneda.set(cur, row);
        }

        for (const o of ops || []) {
            const cur = String(o.currency || 'COP');
            const row = porMoneda.get(cur) || vacio(cur);
            row.fromDepositsCents = Number(o.deposits_taken || 0);
            row.outstandingCents = Number(o.outstanding || 0);
            row.inProgressCents = Number(o.in_progress || 0);
            row.lostCents = Number(o.lost || 0);
            row.counts.withDeposit = Number(o.with_deposit_count || 0);
            row.counts.inProgress = Number(o.in_progress_count || 0);
            row.counts.lost = Number(o.lost_count || 0);
            porMoneda.set(cur, row);
        }

        // El resto del cobrado son pagos completos. Se deriva en vez de contarse
        // aparte para que las dos partes SIEMPRE sumen el total: un desglose que
        // no cuadra con su propio total es peor que no tenerlo.
        for (const row of porMoneda.values()) {
            row.fromFullPaymentsCents = Math.max(row.collectedCents - row.fromDepositsCents, 0);
        }

        return [...porMoneda.values()].sort((a, b) => b.netCents - a.netCents);
    }
}
