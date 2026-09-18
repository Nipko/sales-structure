import { act, createElement } from "react";
import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import DemoAllowancePage from "./page";

/**
 * The platform owner's screen for what every account's public link costs
 * (audit #47): three numbers that could only be changed by SQL.
 *
 * Read the way a screen reader hands it over: every control named, every hint
 * tied to its field, a wrong number said next to the number, and the save
 * announced. And the one behaviour that matters for money: nothing is sent
 * that the API would refuse, and nothing is sent when nothing changed.
 */

const mockFetch = jest.fn();
jest.mock("@/lib/api", () => ({ api: { fetch: (...args: unknown[]) => mockFetch(...args) } }));

const SNAPSHOT = {
    success: true,
    data: {
        allowance: { enabled: true, messagesPerTenant: 200, dailyCapPerPage: 60 },
        source: "stored",
        defaults: { enabled: true, messagesPerTenant: 200, dailyCapPerPage: 60 },
        limits: { messagesPerTenant: { min: 0, max: 10000 }, dailyCapPerPage: { min: 1, max: 1000 } },
    },
};

/** What the API answers when it could not read the stored row: the defaults, standing in. */
const FALLBACK = { ...SNAPSHOT, data: { ...SNAPSHOT.data, source: "fallback" } };

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
}

async function render() {
    const screen = await renderScreen(createElement(DemoAllowancePage));
    await settle();
    return screen;
}

function field(container: HTMLElement, label: string): HTMLInputElement {
    const node = [...container.querySelectorAll("label")].find((candidate) => candidate.textContent?.trim() === label);
    const input = node ? document.getElementById(node.getAttribute("for") ?? "") : null;
    if (!input) throw new Error(`no field labelled "${label}"`);
    return input as HTMLInputElement;
}

/**
 * Types into a controlled number field. Assigning `.value` directly updates
 * React's own value tracker, so React would see no change; the prototype's
 * setter is what a person's keystroke goes through.
 */
function setValue(input: HTMLInputElement, value: string): void {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

function saveButton(container: HTMLElement): HTMLButtonElement {
    const found = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Guardar cambios");
    if (!found) throw new Error("no save button");
    return found as HTMLButtonElement;
}

beforeEach(() => {
    mockFetch.mockReset();
});

describe("the platform-paid allowance screen", () => {
    it("names every control and ties each hint to its field", async () => {
        mockFetch.mockResolvedValue(SNAPSHOT);
        const screen = await render();
        try {
            expect(mockFetch).toHaveBeenCalledWith("/platform/demo-allowance");
            const total = field(screen.container, "Respuestas por cuenta, en total");
            const daily = field(screen.container, "Respuestas por enlace, por día");
            const enabled = field(screen.container, "La plataforma paga las respuestas del enlace de prueba");
            expect(total.value).toBe("200");
            expect(daily.value).toBe("60");
            expect(enabled.checked).toBe(true);
            expect(document.getElementById(total.getAttribute("aria-describedby") ?? "")?.textContent)
                .toContain("Valor por defecto: 200.");
            // Saving the same numbers again is not a change.
            expect(saveButton(screen.container).disabled).toBe(true);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("says what is wrong with a number next to it, and sends nothing", async () => {
        mockFetch.mockResolvedValue(SNAPSHOT);
        const screen = await render();
        try {
            const total = field(screen.container, "Respuestas por cuenta, en total");
            await interact(() => setValue(total, "20000"));
            expect(total.getAttribute("aria-invalid")).toBe("true");
            const described = (total.getAttribute("aria-describedby") ?? "").split(" ")
                .map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
            expect(described).toContain("El máximo es 10000.");
            expect(saveButton(screen.container).disabled).toBe(true);

            const daily = field(screen.container, "Respuestas por enlace, por día");
            await interact(() => setValue(daily, "0"));
            expect(screen.container.textContent).toContain("El mínimo es 1.");
            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("saves the three values as numbers and announces it", async () => {
        mockFetch.mockResolvedValueOnce(SNAPSHOT).mockResolvedValueOnce({
            ...SNAPSHOT,
            data: { ...SNAPSHOT.data, allowance: { enabled: false, messagesPerTenant: 300, dailyCapPerPage: 60 } },
        });
        const screen = await render();
        try {
            await interact(() => setValue(field(screen.container, "Respuestas por cuenta, en total"), "300"));
            await interact(() => field(screen.container, "La plataforma paga las respuestas del enlace de prueba").click());
            await interact(() => saveButton(screen.container).click());
            await settle();
            expect(mockFetch).toHaveBeenLastCalledWith("/platform/demo-allowance", {
                method: "PUT",
                body: JSON.stringify({ enabled: false, messagesPerTenant: 300, dailyCapPerPage: 60 }),
            });
            expect(screen.container.querySelector("[role=status][aria-live=polite]")?.textContent).toBe("Guardado.");
            // What the server kept is what the screen shows, and it is no longer a change.
            expect(field(screen.container, "Respuestas por cuenta, en total").value).toBe("300");
            expect(saveButton(screen.container).disabled).toBe(true);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("says a refused save out loud and keeps what was typed", async () => {
        mockFetch.mockResolvedValueOnce(SNAPSHOT).mockRejectedValueOnce(new Error("The demo allowance edit is not valid"));
        const screen = await render();
        try {
            await interact(() => setValue(field(screen.container, "Respuestas por enlace, por día"), "90"));
            await interact(() => saveButton(screen.container).click());
            await settle();
            expect(screen.container.querySelector("[role=status][aria-live=polite]")?.textContent)
                .toBe("No se guardó. Revisa los valores e inténtalo de nuevo.");
            expect(field(screen.container, "Respuestas por enlace, por día").value).toBe("90");
        } finally {
            screen.unmount();
        }
    });

    it("says the numbers are stand-in defaults when the stored ones could not be read, and does not let them be saved", async () => {
        // F0: these used to render as the live values, and a save wrote
        // `enabled: true` and the default caps back over what was stored.
        mockFetch.mockResolvedValueOnce(FALLBACK).mockResolvedValueOnce(SNAPSHOT);
        const screen = await render();
        try {
            const alert = screen.container.querySelector("[role=alert]");
            expect(alert?.textContent).toContain("No pudimos leer los valores guardados");
            expect(alert?.textContent).toContain("Guardar queda desactivado hasta que se puedan leer");
            const total = field(screen.container, "Respuestas por cuenta, en total");
            const enabled = field(screen.container, "La plataforma paga las respuestas del enlace de prueba");
            expect(total.disabled).toBe(true);
            expect(enabled.disabled).toBe(true);
            expect(saveButton(screen.container).disabled).toBe(true);
            // A submit that gets through anyway sends nothing.
            await interact(() => (screen.container.querySelector("form") as HTMLFormElement)
                .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
            await settle();
            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);

            // Once the row can be read again, the screen is editable again.
            await interact(() => (alert!.querySelector("button") as HTMLButtonElement).click());
            await settle();
            expect(screen.container.querySelector("[role=alert]")).toBeNull();
            expect(field(screen.container, "Respuestas por cuenta, en total").disabled).toBe(false);
        } finally {
            screen.unmount();
        }
    });

    it("does not invent numbers when the settings cannot be read, and offers to retry", async () => {
        mockFetch.mockRejectedValueOnce(new Error("HTTP error! status: 403")).mockResolvedValueOnce(SNAPSHOT);
        const screen = await render();
        try {
            const alert = screen.container.querySelector("[role=alert]");
            expect(alert?.textContent).toContain("No pudimos leer la configuración. No se cambió nada.");
            expect(screen.container.querySelector("input")).toBeNull();
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
            await interact(() => (alert!.querySelector("button") as HTMLButtonElement).click());
            await settle();
            expect(field(screen.container, "Respuestas por cuenta, en total").value).toBe("200");
        } finally {
            screen.unmount();
        }
    });
});
