import { copilotActions, copilotBadgeCount, formatProposalValue } from "./onboarding-copilot";

describe("propuestas del copiloto (R6)", () => {
    it("las acciones siguen el tipo y el estado de la propuesta", () => {
        const value = { kind: "value" as const, status: "proposed" as const, value: { methods: ["efectivo"] }, alternatives: [], question: null };
        expect(copilotActions(value)).toEqual({ approve: true, edit: true, choose: false, reject: true, answer: false, openFaqs: false });
        // contradicción entre fuentes: no hay un valor único que aprobar, se elige una versión
        const between = { ...value, kind: "contradiction" as const, value: null, alternatives: [{ value: { methods: ["Nequi"] }, evidence: [] }] };
        expect(copilotActions(between)).toMatchObject({ approve: false, choose: true, edit: true, reject: true });
        const question = { kind: "question" as const, status: "proposed" as const, value: null, alternatives: [], question: { code: "owner_question" as const, text: "¿Abren festivos?" } };
        expect(copilotActions(question)).toEqual({ approve: false, edit: false, choose: false, reject: true, answer: true, openFaqs: false });
        expect(copilotActions({ ...question, question: { code: "generic_faq" as const } })).toMatchObject({ answer: false, openFaqs: true });
        for (const status of ["applied", "rejected", "superseded", "expired"] as const) {
            expect(Object.values(copilotActions({ ...value, status })).some(Boolean)).toBe(false);
        }
    });

    it("el contador del panel cuenta solo las abiertas", () => {
        expect(copilotBadgeCount({ proposed: 3, applied: 9 })).toBe(3);
        expect(copilotBadgeCount(undefined)).toBe(0);
    });

    it("muestra el valor completo, legible", () => {
        expect(formatProposalValue({ methods: ["efectivo", "Nequi"], notes: "sin recargo", by_appointment_only: true })).toEqual([
            "methods: efectivo, Nequi", "notes: sin recargo", "by_appointment_only: ✓",
        ]);
        expect(formatProposalValue({ days: { mon: [{ from: "08:00", to: "18:00" }] } })).toEqual(['days: {"mon":[{"from":"08:00","to":"18:00"}]}']);
        expect(formatProposalValue([{ topic: "competencia" }])).toEqual(['{"topic":"competencia"}']);
        expect(formatProposalValue(null)).toEqual([]);
    });
});
