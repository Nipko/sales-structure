import fs from "node:fs";
import path from "node:path";
import {
    CLASSIFIED_SURFACE_ITEMS,
    NAVIGATION_SURFACE_KIND,
    capabilityForSurface,
    navigationSurfaceKind,
} from "@parallext/shared";
import { VERTICAL_DASHBOARD_ITEMS } from "./vertical-dashboard-resolver";
import { PAGE_RULES } from "./roles";

/**
 * Operar no es administrar el catálogo.
 *
 * Sin un registro compartido, la asignación se decidía pantalla por pantalla:
 * así se llegó a tener las sesiones fotográficas —el registro de un estudio—
 * detrás del permiso de catálogo, y las pólizas y el padrón de socios detrás
 * del mismo permiso, con su mitad operativa inalcanzable para quien atiende.
 */
describe("navigation surface kind", () => {
    const sidebar = fs.readFileSync(
        path.resolve(__dirname, "../components/layout/AppSidebar.tsx"),
        "utf8",
    );

    /** Un ítem sin clasificar es una decisión que nadie tomó. */
    it("classifies every vertical dashboard item", () => {
        for (const item of VERTICAL_DASHBOARD_ITEMS) {
            expect(`${item}=${navigationSurfaceKind(item) || "UNCLASSIFIED"}`)
                .not.toContain("UNCLASSIFIED");
        }
    });

    it("does not classify an item the dashboard does not have", () => {
        const known = new Set<string>(VERTICAL_DASHBOARD_ITEMS);
        for (const item of CLASSIFIED_SURFACE_ITEMS) {
            expect(known.has(item)).toBe(true);
        }
    });

    /**
     * La prueba que hace durable el arreglo: la capacidad del menú sale de la
     * clasificación y no del criterio de quien escribió la línea.
     */
    it("gives every sidebar item the capability its kind demands", () => {
        const entries = [...sidebar.matchAll(
            /verticalItem: "(\w+)", capability: "(\w+)"/g,
        )];
        expect(entries.length).toBeGreaterThan(15);
        for (const [, item, capability] of entries) {
            expect(`${item}:${capability}`).toBe(`${item}:${capabilityForSurface(item)}`);
        }
    });

    /**
     * Y la otra mitad: una capacidad de menú que el guardia de rutas contradice
     * deja la opción visible y la pantalla cerrada.
     */
    it("lets the operator role open every register and mixed surface", () => {
        const ROUTE_BY_ITEM: Readonly<Record<string, string>> = {
            appointments: "/admin/appointments",
            stays: "/admin/stays",
            tourBookings: "/admin/tour-bookings",
            foodOrders: "/admin/food-orders",
            orders: "/admin/orders",
            serviceRequests: "/admin/service-requests",
            resourceRentals: "/admin/resource-rentals",
            classes: "/admin/classes",
            pets: "/admin/pets",
            photoSessions: "/admin/photo-sessions",
            insurance: "/admin/insurance",
            memberships: "/admin/memberships",
        };
        for (const [item, route] of Object.entries(ROUTE_BY_ITEM)) {
            const kind = navigationSurfaceKind(item);
            expect(`${item}=${kind}`).not.toBe(`${item}=catalogue`);
            const rule = PAGE_RULES.find((r) => r.prefix === route);
            expect(`${route} rule`).toBe(rule ? `${route} rule` : `${route} MISSING`);
            expect(`${route}:${rule?.roles.includes("tenant_agent")}`).toBe(`${route}:true`);
        }
    });

    /** Y el catálogo sigue cerrado: abrirlo de más es el error opuesto. */
    it("keeps catalogue surfaces above the operator role", () => {
        const CATALOGUE_ROUTES: Readonly<Record<string, string>> = {
            properties: "/admin/properties",
            tours: "/admin/tours",
            listings: "/admin/listings",
            vehicles: "/admin/vehicles",
            menu: "/admin/menu",
            courses: "/admin/courses",
            treatmentPlans: "/admin/treatment-plans",
            inventory: "/admin/inventory",
            serviceCatalog: "/admin/service-catalog",
        };
        for (const [item, route] of Object.entries(CATALOGUE_ROUTES)) {
            expect(navigationSurfaceKind(item)).toBe("catalogue");
            const rule = PAGE_RULES.find((r) => r.prefix === route);
            expect(`${route}:${rule?.roles.includes("tenant_agent")}`).toBe(`${route}:false`);
        }
    });

    /**
     * Registros y catálogos estaban mezclados en una sola sección, así que
     * quien atiende recorría fichas de producto para llegar a su propia
     * agenda. El corte de secciones tiene que seguir la clasificación, no el
     * criterio de quien agregue la próxima línea.
     */
    it("puts every register in daily work and every catalogue in its own section", () => {
        const section = (titleKey: string) => {
            const start = sidebar.indexOf(`titleKey: "${titleKey}"`);
            expect(`${titleKey} section`).toBe(start >= 0 ? `${titleKey} section` : `${titleKey} MISSING`);
            const end = sidebar.indexOf('\n  },', start);
            return sidebar.slice(start, end);
        };
        const itemsOf = (body: string) =>
            [...body.matchAll(/verticalItem: "(\w+)"/g)].map((match) => match[1]);

        const daily = itemsOf(section("dailyWork"));
        const catalogue = itemsOf(section("catalogAndResources"));
        expect(daily.length).toBeGreaterThan(5);
        expect(catalogue.length).toBeGreaterThan(5);

        for (const item of daily) {
            expect(`${item}=${navigationSurfaceKind(item)}`).not.toBe(`${item}=catalogue`);
        }
        for (const item of catalogue) {
            expect(`${item}=${navigationSurfaceKind(item)}`).toBe(`${item}=catalogue`);
        }
        // Y ninguno aparece en las dos.
        expect(daily.filter((item) => catalogue.includes(item))).toEqual([]);
    });

    /** El trabajo diario va antes que IA y crecimiento, no después. */
    it("puts daily work above the growth tooling", () => {
        expect(sidebar.indexOf('titleKey: "dailyWork"'))
            .toBeLessThan(sidebar.indexOf('titleKey: "aiGrowth"'));
    });

    it("maps each kind to exactly one capability", () => {
        expect(capabilityForSurface("stays")).toBe("canHandleConversations");
        expect(capabilityForSurface("properties")).toBe("canEditPipeline");
        // Mixta se abre operando: el catálogo se cierra adentro.
        expect(capabilityForSurface("insurance")).toBe("canHandleConversations");
        expect(NAVIGATION_SURFACE_KIND.insurance).toBe("mixed");
        expect(capabilityForSurface("no_existe")).toBeNull();
        expect(navigationSurfaceKind(undefined)).toBeNull();
    });
});
