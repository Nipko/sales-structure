import { fixesWithData, groupByIntent, isRunActive, percent, runErrorKey, type RehearsalResult } from "./rehearsal";

const result = (over: Partial<RehearsalResult>): RehearsalResult => ({
    caseKey: "k", intentId: "C14", intentTitle: "Medios de pago", requirementIds: ["CORE.PAYMENT.METHODS"], requirementTitle: null, uiTarget: null,
    itemId: null, itemName: null, language: "es", expected: "NC+AV", valueState: "ausente", behavior: null, outcome: "answered", missClass: null,
    decidedBy: "deterministic", reason: null, turns: [], checks: [], model: null, latencyMs: null, ...over,
});

describe("ensayo antes de salir (R7)", () => {
    it("agrupa por intención, con los temas que fallan primero y los fallos primero dentro de cada tema", () => {
        const groups = groupByIntent([
            result({ caseKey: "a", intentId: "C03", intentTitle: "Horario", outcome: "answered" }),
            result({ caseKey: "b", intentId: "C14", outcome: "answered" }),
            result({ caseKey: "c", intentId: "C14", outcome: "wrong", missClass: "producto" }),
            result({ caseKey: "d", intentId: "C09", intentTitle: "Precio", outcome: "missing_data", missClass: "dato" }),
        ]);
        expect(groups.map(g => g.intentId)).toEqual(["C14", "C09", "C03"]);
        expect(groups[0].results.map(r => r.caseKey)).toEqual(["c", "b"]);
        expect(groups[0].counts).toMatchObject({ wrong: 1, answered: 1 });
    });

    it("solo «falta un dato» abre el cajón; «respondió mal» no se le carga al dueño", () => {
        expect(fixesWithData(result({ outcome: "missing_data", missClass: "dato" }))).toBe(true);
        expect(fixesWithData(result({ outcome: "wrong", missClass: "producto" }))).toBe(false);
        expect(fixesWithData(result({ outcome: "missing_data", missClass: "dato", requirementIds: [] }))).toBe(false);
    });

    it("estado, porcentaje y errores conocidos", () => {
        expect(isRunActive({ status: "running" })).toBe(true);
        expect(isRunActive({ status: "completed" })).toBe(false);
        expect(percent(0.6667)).toBe(67);
        expect(percent(null)).toBeNull();
        expect(runErrorKey("rehearsal_quota_exceeded")).toBe("rehearsal_quota_exceeded");
        expect(runErrorKey("algo raro")).toBeNull();
    });
});
