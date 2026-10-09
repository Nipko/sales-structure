import { interact, renderScreen } from "@/test/a11y";
import VerifyEmailPage from "./page";

const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), replace: mockReplace }) }));
jest.mock("@/contexts/AuthContext", () => ({
    useAuth: () => ({ logout: jest.fn(), syncSessionFacts: jest.fn() }),
}));
jest.mock("@/components/AnimatedLogo", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/LocaleSwitcher", () => ({ __esModule: true, default: () => null }));
jest.mock("@/lib/api", () => ({
    api: { verifyEmail: jest.fn(), me: jest.fn(), sendVerification: jest.fn() },
}));
const { api } = jest.requireMock("@/lib/api") as {
    api: { verifyEmail: jest.Mock; me: jest.Mock; sendVerification: jest.Mock };
};

const owner = { id: "owner", email: "owner@example.com", role: "tenant_admin", emailVerified: false };

const digitInputs = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"]'));

function enterCode(container: HTMLElement, code = "123456") {
    const input = digitInputs(container)[0];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, code);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("verification code rejected", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem("accessToken", "test-token");
        localStorage.setItem("user", JSON.stringify(owner));
        api.sendVerification.mockResolvedValue({ success: true });
    });

    it("clears the six boxes and puts the cursor back on the first one after a wrong code", async () => {
        api.verifyEmail.mockResolvedValue({ success: false, errorCode: "invalid_verification_code" });
        const screen = await renderScreen(<VerifyEmailPage />);
        try {
            await interact(() => enterCode(screen.container));
            expect(api.verifyEmail).toHaveBeenCalledWith("123456");
            const inputs = digitInputs(screen.container);
            expect(inputs.map((input) => input.value)).toEqual(["", "", "", "", "", ""]);
            expect(document.activeElement).toBe(inputs[0]);
            expect(screen.container.textContent).toContain("Código incorrecto");
            // A typo is retyped, not re-requested.
            expect(screen.container.textContent).not.toContain("venció");
        } finally { screen.unmount(); }
    });

    it("says the code expired, and offers a new one right in the notice", async () => {
        api.verifyEmail.mockResolvedValue({ success: false, errorCode: "verification_code_expired" });
        const screen = await renderScreen(<VerifyEmailPage />);
        try {
            await interact(() => enterCode(screen.container));
            const text = screen.container.textContent || "";
            expect(text).toContain("El código venció");
            expect(text).not.toContain("Código incorrecto");
            expect(digitInputs(screen.container).every((input) => input.value === "")).toBe(true);

            const resend = Array.from(screen.container.querySelectorAll("button"))
                .find((button) => button.closest('[class*="text-red"]'));
            expect(resend?.textContent).toBe("Reenviar código");
            await interact(() => resend!.click());
            expect(api.sendVerification).toHaveBeenCalledTimes(1);
            // The stale notice goes away once a new code is on its way.
            expect(screen.container.textContent).not.toContain("El código venció");
        } finally { screen.unmount(); }
    });

    it("keeps the digits when the failure is only the connection", async () => {
        api.verifyEmail.mockRejectedValue(new Error("network"));
        const screen = await renderScreen(<VerifyEmailPage />);
        try {
            await interact(() => enterCode(screen.container));
            expect(digitInputs(screen.container).map((input) => input.value).join("")).toBe("123456");
        } finally { screen.unmount(); }
    });
});
