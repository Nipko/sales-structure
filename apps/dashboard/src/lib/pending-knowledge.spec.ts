import { hoursToSla, pendingActions, pendingBadgeCount } from "./pending-knowledge";

describe("bandeja de conocimiento pendiente (R5)", () => {
    it("las acciones siguen la máquina de estados de la API", () => {
        expect(pendingActions({ status: "open", requirementId: "CORE.LOCATION.PARKING" })).toEqual({ answer: true, store: true, dismiss: true, close: false, renotify: false });
        expect(pendingActions({ status: "gap", requirementId: null })).toEqual({ answer: true, store: false, dismiss: true, close: false, renotify: false });
        // una respuesta puntual se puede guardar después como dato
        expect(pendingActions({ status: "answered", requirementId: "CORE.LOCATION.PARKING" })).toEqual({ answer: false, store: true, dismiss: false, close: true, renotify: true });
        expect(pendingActions({ status: "stored", requirementId: "CORE.LOCATION.PARKING" })).toEqual({ answer: false, store: false, dismiss: false, close: true, renotify: true });
        for (const status of ["closed", "dismissed"] as const) {
            expect(Object.values(pendingActions({ status, requirementId: "X.Y" })).some(Boolean)).toBe(false);
        }
    });

    it("el contador de la navegación suma lo abierto y lo que solo es demanda", () => {
        expect(pendingBadgeCount({ open: 2, gap: 5, answered: 9 })).toBe(7);
        expect(pendingBadgeCount(null)).toBe(0);
    });

    it("el plazo se redondea hacia el lado que no engaña", () => {
        const now = new Date("2026-10-30T10:00:00Z");
        expect(hoursToSla("2026-10-30T13:10:00Z", now)).toBe(4);
        expect(hoursToSla("2026-10-30T09:30:00Z", now)).toBe(-1);
        expect(hoursToSla(null, now)).toBeNull();
    });
});
