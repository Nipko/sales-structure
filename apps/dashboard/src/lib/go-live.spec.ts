import * as fs from "node:fs";
import * as path from "node:path";
import { ackComplete, goLiveAction } from "./go-live";

/** R4 (ADR 0010): qué acción muestra el panel; la regla (409, reconocimiento de «limitado») vive en la API. */
describe("goLiveAction", () => {
    const intents = [{ id: "C12", title: "Medios de pago" }, { id: "C20", title: "Festivos" }];

    it("sin permiso de escritura solo se ve", () => {
        expect(goLiveAction({ state: "off" }, "listo", [], false)).toEqual({ kind: "read_only" });
    });
    it("publicado → despublicar, con cualquier veredicto", () => {
        expect(goLiveAction({ state: "on" }, "no_listo", [], true)).toEqual({ kind: "unpublish" });
    });
    it("no_listo no se puede publicar; listo publica directo; limitado pide reconocer cada tema", () => {
        expect(goLiveAction({ state: "off" }, "no_listo", [], true)).toEqual({ kind: "blocked" });
        expect(goLiveAction({ state: "off" }, "listo", [], true)).toEqual({ kind: "publish" });
        expect(goLiveAction({ state: "off" }, "limitado", intents, true)).toEqual({ kind: "publish_limited", intents });
    });
    it("el reconocimiento está completo solo con todas las intenciones marcadas", () => {
        expect(ackComplete(intents, new Set(["C12"]))).toBe(false);
        expect(ackComplete(intents, new Set(["C12", "C20"]))).toBe(true);
    });
    it("los textos de la tarjeta existen en es/en/pt/fr con las mismas claves", () => {
        const keys = (o: unknown, p = ""): string[] => (o && typeof o === "object"
            ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keys(v, p ? `${p}.${k}` : k)) : [p]);
        const read = (l: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../messages/${l}.json`), "utf8")).readinessPanel.goLive;
        const es = keys(read("es")).sort();
        expect(es).toEqual(expect.arrayContaining(["reason.no_listo", "reason.published_regressed", "mode.shadow", "mode.enforce", "ackTitle"]));
        for (const l of ["en", "pt", "fr"]) expect(keys(read(l)).sort()).toEqual(es);
    });
});
