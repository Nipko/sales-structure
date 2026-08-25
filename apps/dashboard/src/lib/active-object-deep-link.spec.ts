import fs from "node:fs";
import path from "node:path";
import {
    ACTIVE_OBJECT_DEEP_LINKS,
    ACTIVE_OBJECT_KINDS,
    LINKED_ACTIVE_OBJECT_KINDS,
    deepLinkForActiveObject,
    deepLinkRouteForActiveObject,
} from "@parallext/shared";
import { NAVIGATION_ROUTES } from "./navigation-contract";

/**
 * El panel del Inbox muestra el objeto del que se está hablando, y dice dónde
 * está.
 *
 * Mostrar una reserva sin decir dónde abrirla la deja tan lejos como antes: el
 * plan exige deep link humano para todo objeto que el agente toca.
 */
describe("active object deep links", () => {
    it("decides for every object kind, with no silent gaps", () => {
        for (const kind of ACTIVE_OBJECT_KINDS) {
            expect(`${kind} in map`).toBe(kind in ACTIVE_OBJECT_DEEP_LINKS ? `${kind} in map` : `${kind} MISSING`);
        }
    });

    /** Una ruta inventada termina en 404, que es peor que no ofrecer enlace. */
    it("only points at routes the dashboard really has", () => {
        const known = new Set(NAVIGATION_ROUTES.map((route) => route.pattern));
        for (const kind of LINKED_ACTIVE_OBJECT_KINDS) {
            // El `?tab=` es parte del enlace pero no de la ruta.
            const route = deepLinkRouteForActiveObject(kind)!;
            expect(`${kind} -> ${route}`).toBe(
                known.has(route as `/admin${string}`) ? `${kind} -> ${route}` : `${kind} -> UNKNOWN ROUTE`,
            );
        }
    });

    it("sends each operational object to the register where it is worked", () => {
        expect(deepLinkForActiveObject("property_booking")).toBe("/admin/stays");
        expect(deepLinkForActiveObject("tour_booking")).toBe("/admin/tour-bookings");
        expect(deepLinkForActiveObject("service_request")).toBe("/admin/service-requests");
        expect(deepLinkForActiveObject("photo_session")).toBe("/admin/photo-sessions");
        expect(deepLinkForActiveObject("repair_order")).toBe("/admin/repair-orders");
    });

    /**
     * Llegar a la pantalla no es llegar al objeto: sin el `?tab=`, quien viene
     * del Inbox por un siniestro aterriza en la pestaña de planes y tiene que
     * buscarlo de nuevo.
     */
    it("opens the tab where the object lives on a shared screen", () => {
        expect(deepLinkForActiveObject("insurance_claim")).toBe("/admin/insurance?tab=claims");
        expect(deepLinkForActiveObject("insurance_policy")).toBe("/admin/insurance?tab=policies");
        expect(deepLinkForActiveObject("insurance_quote")).toBe("/admin/insurance?tab=quotes");
        expect(deepLinkRouteForActiveObject("insurance_claim")).toBe("/admin/insurance");
    });

    /** El `?tab=` que se emite tiene que ser uno que la pantalla acepte. */
    it("only emits tab values the screen knows", () => {
        const page = fs.readFileSync(
            path.resolve(__dirname, "../app/admin/insurance/page.tsx"),
            "utf8",
        );
        for (const kind of ["insurance_claim", "insurance_policy", "insurance_quote"] as const) {
            const tab = deepLinkForActiveObject(kind)!.split("tab=")[1];
            expect(`${kind}:${page.includes(`"${tab}"`)}`).toBe(`${kind}:true`);
        }
    });

    /** `null` es una decisión declarada, no un olvido. */
    it("returns nothing for an object with no screen of its own", () => {
        // `professional_case` ya NO está acá: era el objeto primario de
        // `servicios_profesionales` y no tenía pantalla, así que el equipo
        // abría el embudo de ventas para mirar un expediente. Ahora tiene la
        // suya y el enlace lleva a ella.
        expect(deepLinkForActiveObject("no_existe")).toBeNull();
        expect(deepLinkForActiveObject(undefined)).toBeNull();
        expect(deepLinkForActiveObject(null)).toBeNull();
    });

    it("el objeto primario de un estudio ya tiene a dónde llevar", () => {
        expect(deepLinkForActiveObject("professional_case")).toBe("/admin/cases");
    });

    /**
     * El panel sólo puede mostrar lo que el contrato acotado trae. Si alguien
     * agrega un campo suelto acá, este panel deja de ser una lista de campos
     * revisada y pasa a ser una ventana a la base.
     */
    it("renders only fields the bounded contract carries", () => {
        const card = fs.readFileSync(
            path.resolve(__dirname, "../components/inbox/ActiveObjectsCard.tsx"),
            "utf8",
        );
        const ALLOWED = new Set([
            "kind", "id", "status", "statusClass", "reference", "label",
            "startsAt", "endsAt", "amount", "currency", "subject",
        ]);
        const used = [...card.matchAll(/item\.(\w+)/g)].map((match) => match[1]);
        expect(used.length).toBeGreaterThan(5);
        for (const field of used) {
            expect(`item.${field}`).toBe(ALLOWED.has(field) ? `item.${field}` : `item.${field} NOT ALLOWED`);
        }
    });
});
