import * as fs from "fs";
import * as path from "path";
import { formatMoney } from "./format-money";

/**
 * `currency: "COP"` era una decisión comercial escrita en el código.
 *
 * Quince pantallas ponían pesos colombianos como valor inicial del campo de
 * moneda. Un negocio mexicano cargando su primer plato, su primer plan o su
 * primera propiedad guardaba el precio **en COP** sin verlo — y esa moneda
 * queda con el registro, así que el agente después se la dice al cliente. Dos
 * pantallas eran peores: ignoraban la moneda que el registro **sí traía** y lo
 * pintaban todo en COP, que es convertir un importe sin tipo de cambio: lo
 * mismo que el contrato del agente prohíbe hacer.
 *
 * Esta prueba barre el fuente porque el literal es fácil de volver a escribir y
 * nadie lo nota: la pantalla se ve bien en Colombia, que es donde se prueba.
 */

const SRC = path.join(__dirname, "..");

/**
 * Dónde `COP` sí es la respuesta correcta y no una suposición.
 *
 * Facturación electrónica DIAN es Colombia por definición; el catálogo de
 * paquetes de SMS y el tipo de cambio de la plataforma se cobran en el riel
 * local (Wompi, COP). Excluirlos por ruta y no por heurística: una lista
 * explícita se puede discutir, un `includes("fiscal")` se olvida.
 */
const ALLOWED = [
    "app/admin/fiscal/page.tsx",
    "app/admin/settings/fiscal/page.tsx",
    "app/admin/sms-packages/page.tsx",
    "app/admin/financials/_components/SettingsTab.tsx",
    "lib/format-money.ts",
    "lib/no-hardcoded-currency.spec.ts",
    "hooks/useOperatingCurrency.ts",
];

function sourceFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (/\.(ts|tsx)$/.test(entry.name)) found.push(full);
        }
    };
    walk(SRC);
    return found;
}

/** `currency: "COP"` / `currency = "COP"` / `|| "COP"` — la forma que decide. */
const DECIDING = /currency\s*[:=]\s*"COP"|\|\|\s*"COP"/;

describe("ninguna pantalla decide la moneda por el negocio", () => {
    it("no queda ningún literal COP que decida", () => {
        const offenders: string[] = [];
        for (const file of sourceFiles()) {
            const relative = path.relative(SRC, file).split(path.sep).join("/");
            if (ALLOWED.includes(relative)) continue;
            const source = fs.readFileSync(file, "utf8");
            for (const line of source.split("\n")) {
                // Los comentarios que explican el defecto lo nombran a propósito.
                if (/^\s*(\/\/|\*)/.test(line)) continue;
                if (DECIDING.test(line)) offenders.push(`${relative}: ${line.trim()}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it("la lista de excepciones no se vació por accidente", () => {
        // Si alguien la borra, el barrido de arriba pasaría a fallar por las
        // pantallas fiscales y la tentación sería relajar el patrón.
        expect(ALLOWED.length).toBeGreaterThanOrEqual(4);
    });
});

describe("formatMoney no inventa una moneda", () => {
    it("sin moneda, número sin símbolo", () => {
        // Un número desnudo es incómodo; uno con el símbolo equivocado es una
        // cifra falsa que alguien puede cobrar.
        const shown = formatMoney(1500, null);
        expect(shown).not.toMatch(/[$€£]/);
        expect(shown).toMatch(/1.?500/);
    });

    it("con moneda, la que le pasaron y no otra", () => {
        expect(formatMoney(1500, "MXN", { locale: "es-MX" })).toContain("1,500");
        expect(formatMoney(1500, "COP", { locale: "es-CO" })).toContain("1.500");
    });

    it("una moneda malformada se trata como ausente, no como error", () => {
        expect(formatMoney(1500, "pesos")).not.toMatch(/[$€£]/);
        expect(formatMoney(1500, "")).not.toMatch(/[$€£]/);
    });

    it("un importe ausente no se dibuja como cero", () => {
        // Mostrar `$0` donde no hay dato es afirmar un precio que nadie puso.
        expect(formatMoney(null, "COP")).toBe("—");
        expect(formatMoney(undefined, "COP")).toBe("—");
        expect(formatMoney("no-es-un-numero", "COP")).toBe("—");
    });

    it("acepta el string que llega de la base sin convertirlo mal", () => {
        expect(formatMoney("1500", "MXN", { locale: "es-MX" })).toContain("1,500");
    });
});
