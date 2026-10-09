import { interact, renderScreen } from "@/test/a11y";
import LoginPage from "./page";

const mockLogin = jest.fn();
jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));
jest.mock("next/link", () => ({
    __esModule: true,
    default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}));
jest.mock("@/contexts/AuthContext", () => ({
    useAuth: () => ({
        login: mockLogin,
        googleLogin: jest.fn(),
        complete2FALogin: jest.fn(),
        send2FAEmailFallback: jest.fn(),
        send2FASmsFallback: jest.fn(),
    }),
}));
jest.mock("@/lib/api", () => ({ api: { checkSso: jest.fn().mockResolvedValue({ success: false }) } }));
jest.mock("@/components/AnimatedLogo", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/LocaleSwitcher", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/TwoFactorVerification", () => ({ __esModule: true, default: () => null }));

function setInput(container: HTMLElement, id: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submitWith(result: Record<string, unknown>) {
    mockLogin.mockResolvedValue(result);
    const screen = await renderScreen(<LoginPage />);
    await interact(() => {
        setInput(screen.container, "login-email", "owner@example.com");
        setInput(screen.container, "login-password", "clave-equivocada-1");
    });
    await interact(() => {
        screen.container.querySelector("form")!.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    return screen;
}

describe("login failure is shown in the dashboard language", () => {
    beforeEach(() => jest.clearAllMocks());

    it("localizes a wrong password instead of printing the backend's English text", async () => {
        const screen = await submitWith({
            success: false, error: "Invalid credentials", errorCode: "invalid_credentials",
        });
        try {
            const text = screen.container.textContent || "";
            expect(text).toContain("Correo o contraseña incorrectos.");
            expect(text).not.toContain("Invalid credentials");
        } finally { screen.unmount(); }
    });

    it("localizes a Google-only account", async () => {
        const screen = await submitWith({
            success: false, error: "This account uses Google sign-in.", errorCode: "google_account_only",
        });
        try {
            const text = screen.container.textContent || "";
            expect(text).toContain("Esta cuenta usa Google");
            expect(text).not.toContain("This account uses Google sign-in.");
        } finally { screen.unmount(); }
    });

    it("still shows a backend message that has no code", async () => {
        const screen = await submitWith({ success: false, error: "Cuenta suspendida" });
        try {
            expect(screen.container.textContent).toContain("Cuenta suspendida");
        } finally { screen.unmount(); }
    });
});
