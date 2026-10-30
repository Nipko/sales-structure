import { formFor, formRequirementIds, type FormField as SpecFormField } from "../../../../packages/business-spec/src/forms/descriptor";
import { loadSpec } from "../../../../packages/business-spec/src/load";
import { validateRequirementValue } from "../../../../packages/business-spec/src/validate-value";
import {
    formIssues, initialFormValue, isVisible, refValue, setAt, submitValue,
    type FormDescriptor, type FormField,
} from "./readiness-forms";

/**
 * El cajón valida con el descriptor que sirve la API (`formFor`). Estas pruebas cruzan la validación del cliente con
 * la del servidor (`validateRequirementValue`) sobre TODOS los formularios de la especificación, sin copiar reglas:
 * lo que el cliente deja guardar, el servidor lo acepta; lo que el servidor rechaza por forma, el cliente también.
 */
const spec = loadSpec();
const ids = formRequirementIds(spec);
const descriptor = (id: string) => formFor(spec.requirements[id], spec) as unknown as FormDescriptor;
const server = (id: string, value: unknown) => validateRequirementValue(spec, id, { value, status: "confirmed", origin: "owner_form" });

const TEXT: Record<string, string> = { operating_country: "CO", timezone: "America/Bogota", currency: "USD", default_locale: "es-CO", country: "CO" };
function sample(f: FormField | SpecFormField): unknown {
    switch (f.kind) {
        case "readonly": case "json": return undefined;
        case "fixed": return f.fixed;
        case "bool": return true;
        case "number": return 2;
        case "enum": return f.options?.[0]?.value;
        case "enum_list": return f.options?.length ? [f.options[0].value] : ["x"];
        case "string_list": return ["recepcion@negocio.co"];
        case "duration": return { min: 2, unit: "h" };
        case "money": return { amount: 50000, currency: "USD" };
        case "day_spans": return { mon: [{ open: "08:00", close: "12:00" }, { open: "14:00", close: "18:00" }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
        case "url": return "https://negocio.co";
        case "email": return "hola@negocio.co";
        case "object": case "address": return fill(f.fields ?? []);
        case "list": return [fill(f.fields ?? [])];
        case "ref_or_own": return refValue(String(f.ref));
        default: return TEXT[f.key] ?? "Consultorio odontológico en Chapinero con limpiezas, ortodoncia e implantes.";
    }
}
function fill(fields: (FormField | SpecFormField)[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of fields) { const v = sample(f); if (v !== undefined) out[f.key] = v; }
    return out;
}
const filled = (d: FormDescriptor) => (d.root === "list" ? [fill(d.fields)] : d.root === "json" ? {} : fill(d.fields));

describe("validación del cajón frente a la API", () => {
    it("hay formularios para la mayoría de los valores del negocio", () => {
        expect(ids.length).toBeGreaterThan(100);
    });

    it.each(ids)("%s: lo que el formulario deja guardar lo acepta la API", id => {
        const d = descriptor(id);
        const value = submitValue(d, initialFormValue(d, filled(d)));
        expect(formIssues(d, value)).toEqual([]);
        expect(server(id, value)).toEqual([]);
    });

    it("lo que la API rechaza por requerido o enum cerrado, el cliente también lo rechaza", () => {
        const misses: string[] = [];
        for (const id of ids) {
            const d = descriptor(id);
            if (d.root !== "object") continue;
            const ok = submitValue(d, filled(d)) as Record<string, unknown>;
            for (const f of d.fields) {
                if (!isVisible(f, ok) || f.kind === "readonly" || f.kind === "fixed") continue;
                const mutations: unknown[] = [undefined];
                if (f.kind === "enum") mutations.push("fuera_de_la_lista");
                if (f.kind === "bool") mutations.push("sí");
                for (const m of mutations) {
                    const value = { ...ok, [f.key]: m };
                    if (m === undefined) delete value[f.key];
                    const serverRejects = server(id, value).length > 0;
                    const clientRejects = formIssues(d, value).length > 0;
                    if (serverRejects && !clientRejects) misses.push(`${id}.${f.key}=${String(m)}`);
                }
            }
        }
        expect(misses).toEqual([]);
    });
});

describe("formularios de R3", () => {
    it("el horario: tramos válidos, solapes y cierre antes de apertura", () => {
        const d = descriptor("CORE.HOURS.REGULAR");
        const days = (mon: unknown[]) => ({ days: { mon, tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } });
        expect(formIssues(d, days([{ open: "08:00", close: "12:00" }]))).toEqual([]);
        expect(formIssues(d, days([{ open: "08:00", close: "12:00" }, { open: "11:00", close: "13:00" }])).map(i => i.code)).toEqual(["hours"]);
        expect(formIssues(d, days([{ open: "18:00", close: "08:00" }])).map(i => i.code)).toEqual(["hours"]);
        // 24/7 oculta los días y no los exige
        expect(formIssues(d, { always_open: true })).toEqual([]);
        expect(submitValue(d, { always_open: true, days: { mon: [] } })).toEqual({ always_open: true });
    });

    it("WRITE_MODE: el SLA y el mensaje solo se piden si el negocio confirma la solicitud", () => {
        const d = descriptor("OBJ.APPOINTMENT.WRITE_MODE");
        expect(formIssues(d, { mode: "none" })).toEqual([]);
        const request = formIssues(d, { mode: "request_to_business", required_fields: ["nombre"], confirmation_terms: ["total"] }).map(i => i.path);
        expect(request).toEqual(["business_confirm_sla", "request_message"]);
    });

    it("CHANGE_RULES: usar la política general o declarar plazo y cargo propios", () => {
        const d = descriptor("OBJ.APPOINTMENT.CHANGE_RULES");
        const base = { agent_can_modify: "solicitud", agent_can_cancel: "solicitud" };
        expect(formIssues(d, { ...base, terms: refValue("CORE.POLICY.CANCELLATION_CHANGES") })).toEqual([]);
        expect(formIssues(d, { ...base, terms: { deadline: { min: 24, unit: "h" } } }).map(i => i.path)).toEqual(["terms.charge"]);
        const food = descriptor("OBJ.FOOD_ORDER.CHANGE_RULES");
        expect(food.fields.find(f => f.key === "terms")?.kind).toBe("object");
    });

    it("precarga un valor heredado quedándose con los campos que conoce el formulario", () => {
        const d = descriptor("CORE.IDENTITY.NAME");
        expect(initialFormValue(d, { display_name: "Sonrisa", legacy_extra: 1 })).toEqual({ display_name: "Sonrisa" });
        const hours = descriptor("CORE.HOURS.REGULAR");
        const legacy = initialFormValue(hours, { days: { mon: [["08:00", "12:00"]] } }) as { days: Record<string, unknown[]> };
        expect(legacy.days.mon).toEqual([{ open: "08:00", close: "12:00" }]);
        expect(Object.keys(legacy.days)).toHaveLength(7);
    });

    it("la descripción pide lo que el evaluador necesita para cumplir (40–300 caracteres)", () => {
        const d = descriptor("CORE.IDENTITY.DESCRIPTION");
        expect(formIssues(d, { short: "Muy corta", audience: ["B2C"] }).map(i => i.code)).toEqual(["length"]);
    });

    it("setAt escribe por ruta sin mutar el original", () => {
        const before = { cancel: { charge: "ninguno" }, list: [{ a: 1 }] };
        const after = setAt(before, ["list", 0, "a"], 2) as typeof before;
        expect(after.list[0].a).toBe(2);
        expect(before.list[0].a).toBe(1);
        expect(setAt(after, ["cancel", "deadline"], { min: 1, unit: "h" })).toMatchObject({ cancel: { charge: "ninguno", deadline: { min: 1, unit: "h" } } });
    });
});
