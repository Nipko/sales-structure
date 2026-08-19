import { formatDateOnly } from "./local-timestamp";
import es from "../../messages/es.json";
import en from "../../messages/en.json";
import pt from "../../messages/pt.json";
import fr from "../../messages/fr.json";

/**
 * Una reserva guardada con check-in el 13 de noviembre se leía "12 de nov" en
 * Bogotá: el API serializa la columna DATE como medianoche UTC y el navegador
 * la reinterpretaba como instante. El anfitrión decide sobre esa fecha.
 *
 * El test fija la fecha, no el formato: se compara el día/mes/año, nunca el
 * texto renderizado, porque el ICU de cada versión de Node varía.
 */
describe("formatDateOnly", () => {
    const parts = (formatted: string) => formatted.replace(/[^\d]/g, " ").trim().split(/\s+/);

    it("keeps the calendar day west of Greenwich", () => {
        const bogota = formatDateOnly("2026-11-13T00:00:00.000Z", "es-CO");
        expect(parts(bogota)).toContain("13");
        expect(parts(bogota)).toContain("2026");
        expect(bogota).not.toMatch(/\b12\b/);
    });

    it("accepts a bare date string too", () => {
        expect(parts(formatDateOnly("2026-08-17", "es-CO"))).toContain("17");
    });

    it("does not shift the day in any timezone the product ships to", () => {
        // El render corre en el navegador del anfitrión: Bogotá, Ciudad de
        // México, São Paulo, Madrid y Auckland (la que más se adelanta).
        for (const timeZone of [
            "America/Bogota", "America/Mexico_City", "America/Sao_Paulo",
            "Europe/Madrid", "Pacific/Auckland", "UTC",
        ]) {
            const rendered = new Date("2026-11-13T00:00:00.000Z").toLocaleDateString("es-CO", {
                day: "2-digit", month: "short", year: "numeric", timeZone,
            });
            const shifted = !rendered.match(/\b13\b/);
            // El render ingenuo SÍ se corre en algunas zonas; el helper nunca.
            expect(parts(formatDateOnly("2026-11-13T00:00:00.000Z", "es-CO"))).toContain("13");
            if (shifted) expect(timeZone).not.toBe("UTC");
        }
    });

    it("returns the input untouched when it is not a date", () => {
        expect(formatDateOnly("")).toBe("");
        expect(formatDateOnly("mañana")).toBe("mañana");
        expect(formatDateOnly("2026-13-45")).toBe("2026-13-45");
        expect(formatDateOnly(null)).toBe("");
        expect(formatDateOnly(undefined)).toBe("");
    });
});

/**
 * El repo exige que toda cadena visible exista en los 4 idiomas. Las de este
 * lote avisan algo que el producto no podía decir: que cancelar en Parallly no
 * reabre la fecha en Booking, y que una conexión iCal nos está devolviendo
 * nuestros propios eventos.
 */
describe("properties i18n", () => {
    const CATALOGS: Array<[string, any]> = [["es", es], ["en", en], ["pt", pt], ["fr", fr]];
    const REQUIRED = [
        "cancelBookingOtaWarning", "feedOwnEchoWarning",
        "bookedBy", "originAgent", "originManual", "cancelBooking",
        "cancelBookingConfirm", "cancelBookingHint", "bookingDetail",
        "statusConfirmed", "statusCancelled", "statusPending",
    ];

    it.each(CATALOGS)("%s carries every new properties key", (_lang, catalog) => {
        const missing = REQUIRED.filter((k) => typeof catalog.properties?.[k] !== "string");
        expect(missing).toEqual([]);
    });

    it("keeps the {source} placeholder in the echo warning", () => {
        for (const [, catalog] of CATALOGS) {
            expect(catalog.properties.feedOwnEchoWarning).toContain("{source}");
        }
    });
});
