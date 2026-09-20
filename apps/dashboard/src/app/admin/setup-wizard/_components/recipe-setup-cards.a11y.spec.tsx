import { findAccessibilityViolations, renderScreen } from "@/test/a11y";
import RecipeSetupCards from "./RecipeSetupCards";
import type { SetupRecipe } from "../setup-recipe";
import { resolveVerticalCapabilityManifest } from "@parallext/shared";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a> }));

const recipe: SetupRecipe = {
    source: "registry",
    mainInstructions: "Ayuda a elegir y reservar.",
    whenUnsure: ["Confirma con una persona."],
    handoffReasons: [],
    purchaseModes: ["appointment"],
    questions: [
        { question: "¿Dónde?", answer: "En el centro.", blanks: [], complete: true },
        { question: "¿Cuánto?", answer: "Desde [precio].", blanks: ["precio"], complete: false },
    ],
    testQuestions: ["¿Cómo reservo?"],
    services: [{ name: "Consulta", durationMinutes: 45, priceState: "example" }],
    businessHours: { monday: "09:00-18:00" },
};

function verticalConfig(industry: string, subType?: string) {
    const manifest = resolveVerticalCapabilityManifest(industry, subType);
    return { industry, subType, manifestVersion: manifest.manifestVersion, effectiveCapabilities: manifest.capabilities };
}

describe("prepared setup cards", () => {
    it("shows the four owner decisions and marks sample prices and incomplete answers honestly", async () => {
        const onApply = jest.fn();
        const screen = await renderScreen(<RecipeSetupCards recipe={recipe} agentId="agent-123" verticalConfig={verticalConfig("salud")} applied={false} applying={false} onApply={onApply} />);
        try {
            const text = screen.container.textContent ?? "";
            expect(text).toContain("Qué ofreces");
            expect(text).toContain("Dónde y cuándo atiendes");
            expect(text).toContain("Cómo compran o reservan");
            expect(text).toContain("Preguntas frecuentes");
            expect(text).toContain("Los precios de ejemplo no se publican como precios reales");
            expect(text).toContain("1 de 2 respuestas están listas");
            expect(text).toContain("Completa 1 respuestas");
            expect(screen.container.querySelector('a[href="/admin/appointments?tab=services"]')).not.toBeNull();
            expect(screen.container.querySelector('a[href="/admin/settings/business-hours"]')).not.toBeNull();
            expect(screen.container.querySelector('a[href="/admin/settings/business-info"]')).not.toBeNull();
            expect(screen.container.querySelector('a[href="/admin/knowledge/faqs"]')).not.toBeNull();
            expect(screen.container.querySelector('a[href="/admin/agent/agent-123?tab=tools&tool=appointments"]')).not.toBeNull();
            const apply = Array.from(screen.container.querySelectorAll("button")).find((button) => button.textContent?.includes("Usar esta base"))!;
            apply.click();
            expect(onApply).toHaveBeenCalledTimes(1);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("opens restaurant controls for a recipe with orders and table reservations", async () => {
        const screen = await renderScreen(<RecipeSetupCards recipe={{ ...recipe, purchaseModes: ["order", "table"] }} agentId="agent-123" verticalConfig={verticalConfig("restaurantes")} applied={false} applying={false} onApply={jest.fn()} />);
        try {
            expect(screen.container.querySelector('a[href="/admin/agent/agent-123?tab=tools&tool=restaurants"]')).not.toBeNull();
        } finally { screen.unmount(); }
    });

    it("opens product offerings and commerce controls for retail instead of an empty calendar", async () => {
        const screen = await renderScreen(<RecipeSetupCards recipe={{ ...recipe, services: [], purchaseModes: ["order", "inform"] }} agentId="agent-123" verticalConfig={verticalConfig("retail")} applied={false} applying={false} onApply={jest.fn()} />);
        try {
            expect(screen.container.querySelector('a[href="/admin/inventory"]')).not.toBeNull();
            expect(screen.container.querySelector('a[href="/admin/appointments?tab=services"]')).toBeNull();
            expect(screen.container.querySelector('a[href="/admin/agent/agent-123?tab=tools&tool=ecommerce"]')).not.toBeNull();
        } finally { screen.unmount(); }
    });

    it("opens agent instructions when the journey only informs customers", async () => {
        const screen = await renderScreen(<RecipeSetupCards recipe={{ ...recipe, services: [], purchaseModes: ["inform"] }} agentId="agent-123" verticalConfig={verticalConfig("servicios_profesionales")} applied={false} applying={false} onApply={jest.fn()} />);
        try {
            expect(screen.container.querySelector('a[href="/admin/agent/agent-123?tab=instructions"]')).not.toBeNull();
        } finally { screen.unmount(); }
    });
});
