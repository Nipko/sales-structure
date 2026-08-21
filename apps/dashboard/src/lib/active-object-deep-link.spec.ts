import fs from "node:fs";
import path from "node:path";
import {
    ACTIVE_OBJECT_DEEP_LINKS,
    ACTIVE_OBJECT_KINDS,
    LINKED_ACTIVE_OBJECT_KINDS,
    deepLinkForActiveObject,
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
            const href = ACTIVE_OBJECT_DEEP_LINKS[kind]!;
            expect(`${kind} -> ${href}`).toBe(
                known.has(href as `/admin${string}`) ? `${kind} -> ${href}` : `${kind} -> UNKNOWN ROUTE`,
            );
        }
    });

    it("sends each operational object to the register where it is worked", () => {
        expect(deepLinkForActiveObject("property_booking")).toBe("/admin/stays");
        expect(deepLinkForActiveObject("tour_booking")).toBe("/admin/tour-bookings");
        expect(deepLinkForActiveObject("service_request")).toBe("/admin/service-requests");
        expect(deepLinkForActiveObject("photo_session")).toBe("/admin/photo-sessions");
    });

    /** `null` es una decisión declarada, no un olvido. */
    it("returns nothing for an object with no screen of its own", () => {
        expect(deepLinkForActiveObject("professional_case")).toBeNull();
        expect(deepLinkForActiveObject("no_existe")).toBeNull();
        expect(deepLinkForActiveObject(undefined)).toBeNull();
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
