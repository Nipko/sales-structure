import { NAVIGATION_ROUTES } from "./navigation-contract";
import { navigationSurfaceKind } from "@parallext/shared";
import { VERTICAL_DASHBOARD_ITEMS } from "./vertical-dashboard-resolver";

/**
 * Si esta ruta es una pantalla donde se OPERA.
 *
 * Sale de la clasificación que ya existe (`register` / `catalogue` / `mixed`),
 * no de una lista aparte: una segunda lista se desincroniza el día que alguien
 * agrega una pantalla, y el síntoma sería una métrica que empeora sin que nada
 * haya empeorado.
 */
const OPERATIONAL_ROUTES: ReadonlySet<string> = new Set(
    NAVIGATION_ROUTES
        .filter((route) => {
            const item = VERTICAL_DASHBOARD_ITEMS.find(
                (candidate) => route.id === candidate,
            );
            if (!item) return false;
            const kind = navigationSurfaceKind(item);
            return kind === "register" || kind === "mixed";
        })
        .map((route) => route.pattern),
);

/** El Inbox no es un ítem vertical y es LA pantalla operativa de todos. */
const ALWAYS_OPERATIONAL: readonly string[] = ["/admin/inbox"];

export function isOperationalRoute(route: string): boolean {
    return OPERATIONAL_ROUTES.has(route) || ALWAYS_OPERATIONAL.includes(route);
}
