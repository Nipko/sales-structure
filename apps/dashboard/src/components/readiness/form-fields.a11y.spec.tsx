import fs from "fs";
import path from "path";
import { NextIntlClientProvider } from "next-intl";
import { formFor } from "../../../../../packages/business-spec/src/forms/descriptor";
import { loadSpec } from "../../../../../packages/business-spec/src/load";
import { renderScreen, findAccessibilityViolations } from "@/test/a11y";
import { initialFormValue, type FormDescriptor } from "@/lib/readiness-forms";
import { ObjectFields } from "./FormFields";

/**
 * El cajón de preparación (R3) pinta los formularios de la especificación real con los componentes por tipo: cada
 * control tiene nombre accesible en los cuatro idiomas y axe no encuentra violaciones.
 */
const spec = loadSpec();
const IDS = [
    "CORE.IDENTITY.PROFILE", "CORE.LOCATIONS.LIST", "CORE.HOURS.REGULAR", "CORE.POLICY.CANCELLATION_CHANGES",
    "CORE.HANDOFF.HOURS_SLA", "OBJ.APPOINTMENT.WRITE_MODE", "OBJ.APPOINTMENT.CHANGE_RULES",
];
const messagesOf = (locale: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../messages", `${locale}.json`), "utf-8"));

describe("cajón de preparación: componentes por tipo", () => {
    it.each(["es", "en", "pt", "fr"])("cada control tiene nombre y no hay violaciones de accesibilidad (%s)", async locale => {
        const messages = messagesOf(locale);
        for (const id of IDS) {
            const form = formFor(spec.requirements[id], spec) as unknown as FormDescriptor;
            // con un ejemplo cargado se ven los campos condicionales y las listas con elementos
            const value = initialFormValue(form, { ...(spec.requirements[id].data.example as object), mode: "request_to_business", locations: [{ name: "Sede" }] }) as Record<string, unknown>;
            const screen = await renderScreen(
                <NextIntlClientProvider locale={locale} messages={messages}>
                    <ObjectFields fields={form.fields} value={value} onChange={jest.fn()} path="" ctx={{ disabled: false, issues: new Map() }} />
                </NextIntlClientProvider>,
            );
            try {
                const controls = [...screen.container.querySelectorAll<HTMLElement>("input,select,textarea")];
                expect(controls.length).toBeGreaterThan(0);
                for (const c of controls) {
                    const named = (c as HTMLInputElement).labels?.length || c.getAttribute("aria-label") || c.closest("label");
                    expect({ id, control: c.outerHTML.slice(0, 80), named: Boolean(named) }).toEqual({ id, control: c.outerHTML.slice(0, 80), named: true });
                }
                expect({ id, violations: await findAccessibilityViolations(screen.container) }).toEqual({ id, violations: [] });
            } finally {
                screen.unmount();
            }
        }
    });

    it("las etiquetas de los campos del núcleo están traducidas (no caen al nombre técnico)", async () => {
        const messages = messagesOf("en");
        const form = formFor(spec.requirements["CORE.HOURS.REGULAR"], spec) as unknown as FormDescriptor;
        const screen = await renderScreen(
            <NextIntlClientProvider locale="en" messages={messages}>
                <ObjectFields fields={form.fields} value={initialFormValue(form, null) as Record<string, unknown>} onChange={jest.fn()} path="" ctx={{ disabled: false, issues: new Map() }} />
            </NextIntlClientProvider>,
        );
        try {
            expect(screen.container.textContent).toContain(messages.readinessForms.fields.always_open);
            expect(screen.container.textContent).toContain(messages.readinessForms.days.mon);
        } finally {
            screen.unmount();
        }
    });
});
