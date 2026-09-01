import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Alcance comercial de las métricas financieras.
 *
 * Un tenant propio (demo, pruebas, uso interno) tiene suscripción y puede tener
 * pagos, pero no es un cliente: contarlo infla MRR, ARPU y el denominador de
 * churn con plata que nunca entró de afuera. `tenants.is_internal` lo marca y
 * estas dos constantes son la ÚNICA forma de excluirlo, para que no haya
 * consultas que se olviden del filtro y reporten números distintos entre sí.
 *
 * Se declara como filtro de relación (y no leyendo un flag en JSON) porque
 * Prisma lo traduce a JOINs indexados sobre `tenants_is_internal_idx`.
 *
 * `billing_payments` no tiene relación directa con `tenants` (solo la columna
 * tenant_id), así que su filtro entra por `subscription → tenant`. El
 * `satisfies` valida la forma contra el schema en compilación: un spread de
 * constante sin tipar esquiva el excess-property-check de TS, y así fue como
 * un filtro inválido llegó a producción y tumbó el snapshot mensual.
 */

/** Para consultas sobre `billingSubscription`. */
export const COMMERCIAL_SUBSCRIPTIONS = {
    tenant: { isInternal: false },
} satisfies Prisma.BillingSubscriptionWhereInput;

/** Para consultas sobre `billingPayment`. */
export const COMMERCIAL_PAYMENTS = {
    subscription: { tenant: { isInternal: false } },
} satisfies Prisma.BillingPaymentWhereInput;

/**
 * Para modelos sin relación con `tenants` (p. ej. tenantFinancialSnapshot),
 * donde el filtro solo puede ser escalar: `tenantId: { notIn: ids }`.
 * También cubre filas históricas escritas antes del alcance comercial y
 * tenants marcados internos después de tener snapshots.
 */
export async function internalTenantIds(prisma: PrismaService): Promise<string[]> {
    const rows = await prisma.tenant.findMany({
        where: { isInternal: true },
        select: { id: true },
    });
    return rows.map((r) => r.id);
}
