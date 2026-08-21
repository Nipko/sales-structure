import fs from "node:fs";
import path from "node:path";
import {
    listVerticalCapabilityConfigurations,
    resolveVerticalCapabilityManifest,
} from "@parallext/shared";

/**
 * El tablero de Inicio muestra los KPIs de ESTE negocio.
 *
 * Las claves salían de la definición de la industria: el promedio de hasta
 * cinco negocios distintos. Una farmacia dejó de heredar el tablero de una
 * clínica cuando su contrato ganó override propio, y el Home seguía leyendo la
 * lista vieja.
 */
describe("home KPI contract", () => {
    const home = fs.readFileSync(
        path.resolve(__dirname, "../app/admin/page.tsx"),
        "utf8",
    );

    it("reads the KPI keys from the versioned manifest contract", () => {
        expect(home).toContain("resolveVerticalCapabilityManifest");
        expect(home).toContain("kpiContract.dashboard");
    });

    /**
     * Tailwind sólo genera las clases que encuentra ESCRITAS en el código. Un
     * `text-[${color}]` armado en tiempo de ejecución no existe en el CSS, así
     * que todos los KPIs verticales salían sin color mientras los por defecto
     * —clases literales— sí lo tenían.
     */
    it("never builds a Tailwind class from a runtime value", () => {
        expect(home).not.toMatch(/text-\[\$\{/);
        expect(home).not.toMatch(/bg-\[\$\{/);
    });

    it("resolves a dashboard contract for every canonical profile", () => {
        for (const manifest of listVerticalCapabilityConfigurations()) {
            const contract = resolveVerticalCapabilityManifest(
                manifest.industry, manifest.subtype,
            ).kpiContract.dashboard;
            expect(`${manifest.industry}/${manifest.subtype}:${contract.length > 0}`)
                .toBe(`${manifest.industry}/${manifest.subtype}:true`);
        }
    });

    /** El caso que originó el override: la farmacia sin agenda ni tratamientos. */
    it("gives the pharmacy a dashboard that is not a clinic's", () => {
        const pharmacy = resolveVerticalCapabilityManifest("salud", "farmacia").kpiContract.dashboard;
        const dental = resolveVerticalCapabilityManifest("salud", "dental").kpiContract.dashboard;
        expect(pharmacy).not.toEqual(dental);
        expect(pharmacy).not.toContain("appointmentsToday");
    });

    /** "Hoy" estaba escrito en español dentro de una app de cuatro idiomas. */
    it("does not hardcode a Spanish word in a KPI label", () => {
        expect(home).not.toContain("} Hoy`");
        expect(home).toContain("leadsTodayNoun");
    });
});
