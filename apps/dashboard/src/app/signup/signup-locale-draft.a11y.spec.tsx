import { interact, renderScreen, setValue } from "@/test/a11y";
import SignupPage from "./page";

jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ googleLogin: jest.fn() }) }));
jest.mock("@/components/AnimatedLogo", () => ({ __esModule: true, default: () => <span>Parallly</span> }));

function typeInto(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("signup language reload draft", () => {
    it("restores non-secret fields once and requires password re-entry without signup POST", async () => {
        sessionStorage.clear();
        window.history.replaceState({}, "", "/signup");
        const previousFetch = globalThis.fetch;
        const fetchSpy = jest.fn(() => {
            throw new Error("unexpected signup request");
        });
        globalThis.fetch = fetchSpy as unknown as typeof fetch;
        const first = await renderScreen(<SignupPage />);
        try {
            await interact(() => {
                typeInto(first.container.querySelector("#signup-first-name")!, "Ana");
                typeInto(first.container.querySelector("#signup-last-name")!, "Prueba");
                typeInto(first.container.querySelector("#signup-email")!, "ana@example.test");
                typeInto(first.container.querySelector("#signup-password")!, "Prueba2026!Segura");
            });
            await interact(() => setValue(first.container.querySelector("select") as HTMLSelectElement, "en"));
            expect(document.cookie).toContain("locale=en");
            const stored = JSON.parse(sessionStorage.getItem("signupLocaleDraft") || "{}");
            expect(stored).toMatchObject({ firstName: "Ana", lastName: "Prueba", email: "ana@example.test", hadPassword: true });
            expect(JSON.stringify(stored)).not.toContain("Prueba2026!Segura");
        } finally {
            first.unmount();
        }

        const second = await renderScreen(<SignupPage />);
        try {
            expect((second.container.querySelector("#signup-first-name") as HTMLInputElement).value).toBe("Ana");
            expect((second.container.querySelector("#signup-last-name") as HTMLInputElement).value).toBe("Prueba");
            expect((second.container.querySelector("#signup-email") as HTMLInputElement).value).toBe("ana@example.test");
            expect((second.container.querySelector("#signup-password") as HTMLInputElement).value).toBe("");
            expect(second.container.querySelector('[role="status"]')?.textContent).toBeTruthy();
            expect(sessionStorage.getItem("signupLocaleDraft")).toBeNull();
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            second.unmount();
            if (previousFetch) globalThis.fetch = previousFetch;
            else delete (globalThis as { fetch?: typeof fetch }).fetch;
            sessionStorage.clear();
        }
    });

    it("clears a stale weak-password error as soon as the password becomes valid", async () => {
        sessionStorage.clear();
        window.history.replaceState({}, "", "/signup");
        const previousFetch = globalThis.fetch;
        const fetchSpy = jest.fn(() => { throw new Error("unexpected signup request"); });
        globalThis.fetch = fetchSpy as unknown as typeof fetch;
        const screen = await renderScreen(<SignupPage />);
        try {
            await interact(() => {
                typeInto(screen.container.querySelector("#signup-first-name")!, "Ana");
                typeInto(screen.container.querySelector("#signup-last-name")!, "Prueba");
                typeInto(screen.container.querySelector("#signup-email")!, "ana@example.test");
                typeInto(screen.container.querySelector("#signup-password")!, "abc");
            });
            await interact(() => screen.container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
            expect(screen.container.querySelector('[role="alert"]')?.textContent).toBeTruthy();
            await interact(() => typeInto(screen.container.querySelector("#signup-password")!, "Prueba2026!Segura"));
            expect(screen.container.querySelector('[role="alert"]')).toBeNull();
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            screen.unmount();
            if (previousFetch) globalThis.fetch = previousFetch;
            else delete (globalThis as { fetch?: typeof fetch }).fetch;
            sessionStorage.clear();
        }
    });
});
