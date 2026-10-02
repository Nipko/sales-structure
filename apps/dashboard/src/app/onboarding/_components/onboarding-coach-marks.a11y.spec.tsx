import { useState } from "react";
import { renderScreen, interact, findAccessibilityViolations, type RenderedScreen } from "@/test/a11y";
import OnboardingCoachMarks from "./OnboardingCoachMarks";

const STORAGE_KEY = "onboarding-coach-marks-test";

function Fixture({ includeSubtype = true }: { includeSubtype?: boolean }) {
    const [enabled, setEnabled] = useState(true);
    const fields = ["name", "industry", ...(includeSubtype ? ["subtype"] : []), "about", "orgsize", "timezone"];
    return (
        <main>
            <h1 id="onboarding-step-heading" tabIndex={-1}>Tu empresa</h1>
            <button type="button" onClick={() => setEnabled((value) => !value)}>
                {enabled ? "Otra pantalla" : "Volver al formulario"}
            </button>
            {enabled && (
                <>
                    {fields.map((field) => (
                        <div key={field} id={`onboarding-${field}-field`}>
                            <label htmlFor={`control-${field}`}>{field}</label>
                            <input id={`control-${field}`} />
                            <div id={`onboarding-${field}-field-guide-slot`} />
                        </div>
                    ))}
                    <button type="button" disabled id="onboarding-next-button">Siguiente</button>
                    <div id="onboarding-next-button-guide-slot" />
                </>
            )}
            <OnboardingCoachMarks storageKey={STORAGE_KEY} enabled={enabled} includeSubtype={includeSubtype} />
        </main>
    );
}

function guide(screen: RenderedScreen): HTMLElement | null {
    return screen.container.querySelector("[data-onboarding-coach-mark]");
}

function button(screen: RenderedScreen, name: string): HTMLButtonElement {
    const found = [...screen.container.querySelectorAll("button")].find((candidate) =>
        candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name);
    if (!found) throw new Error(`Missing button: ${name}`);
    return found;
}

describe("signup help follows the form without covering or replacing its controls", () => {
    let screen: RenderedScreen;
    let scrolled: string[];
    let scrollSpy: jest.SpyInstance;

    beforeEach(() => {
        localStorage.removeItem(STORAGE_KEY);
        scrolled = [];
        scrollSpy = jest.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: HTMLElement) {
            scrolled.push(this.id);
        });
    });

    afterEach(() => {
        screen?.unmount();
        scrollSpy.mockRestore();
        localStorage.removeItem(STORAGE_KEY);
    });

    it("places one named help region after the field, with accessible and distinct controls", async () => {
        screen = await renderScreen(<Fixture />);
        expect(guide(screen)?.parentElement?.id).toBe("onboarding-name-field-guide-slot");
        expect(screen.container.querySelectorAll("[data-onboarding-coach-mark]")).toHaveLength(1);
        expect(guide(screen)?.getAttribute("aria-label")).toBe("Ayuda para completar tus datos");
        expect(button(screen, "Siguiente consejo")).not.toBe(button(screen, "Siguiente"));
        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
    });

    it("follows a focused answer without replacing the control or stealing typing focus", async () => {
        screen = await renderScreen(<Fixture />);
        const about = screen.container.querySelector<HTMLInputElement>("#control-about")!;
        await interact(() => {
            about.focus();
            about.value = "Vendemos viviendas";
            about.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(guide(screen)?.dataset.onboardingCoachMark).toBe("about");
        expect(guide(screen)?.parentElement?.id).toBe("onboarding-about-field-guide-slot");
        expect(document.activeElement).toBe(about);
        expect(screen.container.querySelector("#control-about")).toBe(about);
        expect(about.value).toBe("Vendemos viviendas");
        expect(scrolled).toEqual([]);
    });

    it("visits a required subtype and scrolls the next or previous field into view", async () => {
        screen = await renderScreen(<Fixture />);
        await interact(() => button(screen, "Siguiente consejo").click());
        expect(guide(screen)?.dataset.onboardingCoachMark).toBe("industry");
        expect(document.activeElement?.id).toBe("control-industry");
        await interact(() => button(screen, "Siguiente consejo").click());
        expect(guide(screen)?.dataset.onboardingCoachMark).toBe("subtype");
        await interact(() => button(screen, "Consejo anterior").click());
        expect(guide(screen)?.dataset.onboardingCoachMark).toBe("industry");
        expect(scrolled).toEqual(["onboarding-industry-field", "onboarding-subtype-field", "onboarding-industry-field"]);
    });

    it("skips an unavailable subtype while still explaining required company size", async () => {
        screen = await renderScreen(<Fixture includeSubtype={false} />);
        for (let index = 0; index < 3; index++) {
            await interact(() => button(screen, "Siguiente consejo").click());
        }
        expect(guide(screen)?.dataset.onboardingCoachMark).toBe("orgSize");
        expect(guide(screen)?.textContent).toContain("obligatorio para continuar");
        expect(guide(screen)?.textContent).toContain("Consejo 4 de 6");
        expect(scrolled).not.toContain("onboarding-subtype-field");
    });

    it("keeps the current tip when returning from a different wizard screen", async () => {
        screen = await renderScreen(<Fixture />);
        await interact(() => screen.container.querySelector<HTMLInputElement>("#control-about")!.focus());
        await interact(() => button(screen, "Otra pantalla").click());
        expect(guide(screen)).toBeNull();
        await interact(() => button(screen, "Volver al formulario").click());
        expect(guide(screen)?.dataset.onboardingCoachMark).toBe("about");
        expect(guide(screen)?.parentElement?.id).toBe("onboarding-about-field-guide-slot");
    });

    it("can finish on a disabled form button and dismiss without losing keyboard focus", async () => {
        screen = await renderScreen(<Fixture />);
        for (let index = 0; index < 6; index++) {
            await interact(() => button(screen, "Siguiente consejo").click());
        }
        expect(guide(screen)?.dataset.onboardingCoachMark).toBe("submit");
        expect(document.activeElement).toBe(guide(screen));
        await interact(() => button(screen, "Entendido").click());
        expect(guide(screen)).toBeNull();
        expect(document.activeElement?.id).toBe("onboarding-step-heading");
        expect(localStorage.getItem(STORAGE_KEY)).toBe("1");
    });

    it("returns focus to the answer when help is closed and remembers dismissal", async () => {
        screen = await renderScreen(<Fixture />);
        await interact(() => screen.container.querySelector<HTMLInputElement>("#control-about")!.focus());
        await interact(() => button(screen, "Cerrar ayuda").click());
        expect(guide(screen)).toBeNull();
        expect(document.activeElement?.id).toBe("control-about");
        screen.unmount();
        screen = await renderScreen(<Fixture />);
        expect(guide(screen)).toBeNull();
    });
});
