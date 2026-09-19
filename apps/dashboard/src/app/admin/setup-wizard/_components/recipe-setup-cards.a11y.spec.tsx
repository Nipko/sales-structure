import { findAccessibilityViolations, renderScreen } from "@/test/a11y";
import RecipeSetupCards from "./RecipeSetupCards";
import type { SetupRecipe } from "../setup-recipe";

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

describe("prepared setup cards", () => {
    it("shows the four owner decisions and marks sample prices and incomplete answers honestly", async () => {
        const onApply = jest.fn();
        const screen = await renderScreen(<RecipeSetupCards recipe={recipe} applied={false} applying={false} onApply={onApply} />);
        try {
            const text = screen.container.textContent ?? "";
            expect(text).toContain("Qué ofreces");
            expect(text).toContain("Dónde y cuándo atiendes");
            expect(text).toContain("Cómo compran o reservan");
            expect(text).toContain("Preguntas frecuentes");
            expect(text).toContain("Los precios de ejemplo no se publican como precios reales");
            expect(text).toContain("1 de 2 respuestas están listas");
            expect(text).toContain("Completa 1 respuestas");
            const apply = Array.from(screen.container.querySelectorAll("button")).find((button) => button.textContent?.includes("Usar esta base"))!;
            apply.click();
            expect(onApply).toHaveBeenCalledTimes(1);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });
});
