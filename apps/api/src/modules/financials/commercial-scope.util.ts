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
 * Prisma lo traduce a un JOIN indexado sobre `tenants_is_internal_idx`.
 */

/** Para consultas sobre `billingSubscription`. */
export const COMMERCIAL_SUBSCRIPTIONS = { tenant: { isInternal: false } };

/** Para consultas sobre `billingPayment`. */
export const COMMERCIAL_PAYMENTS = { tenant: { isInternal: false } };
