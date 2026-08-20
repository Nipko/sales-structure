/**
 * Qué opción del menú termina en 403 y cuál no.
 *
 * La navegación decidía por rol y por vertical, y nunca por **plan**. El
 * backend sí gatea: `@RequireFeature` y `isFeatureEnabled` devuelven
 * `feature_not_available` con 403. El resultado era una opción visible que al
 * hacer clic no llevaba a ningún lado — y el dueño no aprendía que existe un
 * plan que la incluye: aprendía que la aplicación falla.
 *
 * Sólo entran acá las rutas cuyo backend gatea la pantalla **entera**. Una
 * página donde el plan apaga una pestaña o un botón no va: ahí la pantalla
 * sirve igual y esconderla sería peor.
 */

/** Ruta del panel → la clave de `billing_plans.features` que la habilita. */
export const NAVIGATION_PLAN_FEATURE: Readonly<Record<string, string>> = Object.freeze({
    // `@RequireFeature('vehicleInventory')` en el controller de vehículos.
    '/admin/vehicles': 'vehicleInventory',
    // `@RequireFeature('widget')` en el controller de widgets.
    '/admin/settings/integrations/web-chat': 'widget',
    // `isFeatureEnabled(tenantId, 'recall')` en el controller de recall.
    '/admin/settings/recall': 'recall',
});

export type NavigationPlanDecision = 'enabled' | 'locked' | 'unknown';

/**
 * Decide qué mostrar para una ruta, dado lo que se sabe del plan.
 *
 * `unknown` es deliberado y no es lo mismo que `locked`: si la consulta del
 * plan falló o todavía no volvió, esconder medio menú es un fallo peor que un
 * clic que rebota — y el backend sigue enforzando igual, así que no se abre
 * ningún permiso. Sólo un `false` **conocido** bloquea.
 */
export function navigationPlanDecision(
    pathname: string,
    planFeatures: Record<string, unknown> | null | undefined,
): NavigationPlanDecision {
    const feature = NAVIGATION_PLAN_FEATURE[normalizePath(pathname)];
    if (!feature) return 'enabled';
    if (!planFeatures || typeof planFeatures !== 'object') return 'unknown';
    if (!(feature in planFeatures)) return 'unknown';
    const value = (planFeatures as Record<string, unknown>)[feature];
    if (value === undefined || value === null) return 'unknown';
    // Las claves numéricas (cupos) usan -1 para "ilimitado" y 0 para "no lo
    // tenés". Un booleano se lee tal cual.
    if (typeof value === 'number') return value === 0 ? 'locked' : 'enabled';
    return value === true ? 'enabled' : 'locked';
}

/** La clave de plan que una ruta necesita, si necesita alguna. */
export function planFeatureForPath(pathname: string): string | null {
    return NAVIGATION_PLAN_FEATURE[normalizePath(pathname)] || null;
}

function normalizePath(pathname: unknown): string {
    if (typeof pathname !== 'string') return '';
    const withoutQuery = pathname.split('?')[0].split('#')[0];
    if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
        return withoutQuery.slice(0, -1);
    }
    return withoutQuery;
}

/** Las rutas gateadas por plan, para las pruebas de contrato y la UI. */
export const PLAN_GATED_NAVIGATION_PATHS: readonly string[] = Object.freeze(
    Object.keys(NAVIGATION_PLAN_FEATURE),
);
