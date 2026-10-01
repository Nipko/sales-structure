import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import VerifyEmailPage from "./page";

const mockReplace = jest.fn();
const mockSync = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), replace: mockReplace }) }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ logout: jest.fn(), syncSessionFacts: mockSync }) }));
jest.mock("@/components/AnimatedLogo", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/LocaleSwitcher", () => ({ __esModule: true, default: () => null }));
jest.mock("@/lib/api", () => ({ api: { verifyEmail: jest.fn(), me: jest.fn() } }));
const { api } = jest.requireMock("@/lib/api") as { api: { verifyEmail: jest.Mock; me: jest.Mock } };

const owner = {
    id: "owner", email: "owner@example.com", role: "tenant_admin", tenantId: "tenant",
    onboardingCompleted: true, onboardingStage: "account_created", emailVerified: false,
};

function enterCode(container: HTMLElement) {
    const input = container.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "123456");
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("email verification resumes setup", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem("accessToken", "test-token");
        localStorage.setItem("user", JSON.stringify(owner));
        api.verifyEmail.mockResolvedValue({ success: true });
        api.me.mockResolvedValue({ success: true, data: owner });
    });

    afterEach(() => { localStorage.clear(); sessionStorage.clear(); });

    it("returns an existing tenant to setup and synchronizes the current tab", async () => {
        const screen = await renderScreen(<VerifyEmailPage />);
        try {
            await interact(() => enterCode(screen.container));
            expect(api.verifyEmail).toHaveBeenCalledWith("123456");
            expect(mockReplace).toHaveBeenCalledWith("/admin/setup-wizard");
            expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ id: owner.id, emailVerified: true }));
            expect(JSON.parse(localStorage.getItem("user")!).emailVerified).toBe(true);
        } finally { screen.unmount(); }
    });

    it("uses the current server stage when setup has already finished", async () => {
        api.me.mockResolvedValue({ success: true, data: { ...owner, onboardingStage: "completed" } });
        const screen = await renderScreen(<VerifyEmailPage />);
        try {
            await interact(() => enterCode(screen.container));
            expect(mockReplace).toHaveBeenCalledWith("/admin");
        } finally { screen.unmount(); }
    });

    it("keeps a new owner in company onboarding", async () => {
        const fresh = { ...owner, tenantId: undefined, onboardingStage: undefined, onboardingCompleted: false };
        localStorage.setItem("user", JSON.stringify(fresh));
        api.me.mockResolvedValue({ success: true, data: fresh });
        const screen = await renderScreen(<VerifyEmailPage />);
        try {
            await interact(() => enterCode(screen.container));
            expect(mockReplace).toHaveBeenCalledWith("/onboarding");
        } finally { screen.unmount(); }
    });

    it("still resumes the saved stage if the session refresh fails", async () => {
        api.me.mockRejectedValue(new Error("network unavailable"));
        const screen = await renderScreen(<VerifyEmailPage />);
        try {
            await interact(() => enterCode(screen.container));
            expect(mockReplace).toHaveBeenCalledWith("/admin/setup-wizard");
        } finally { screen.unmount(); }
    });

    it("does not mark an invalid code as verified or navigate away", async () => {
        api.verifyEmail.mockResolvedValue({ success: false, errorCode: "invalid_verification_code" });
        const screen = await renderScreen(<VerifyEmailPage />);
        try {
            await interact(() => enterCode(screen.container));
            expect(mockReplace).not.toHaveBeenCalled();
            expect(mockSync).not.toHaveBeenCalled();
            expect(api.me).not.toHaveBeenCalled();
            expect(JSON.parse(localStorage.getItem("user")!).emailVerified).toBe(false);
        } finally { screen.unmount(); }
    });

    it("names each digit and supports one-time-code autofill", async () => {
        const screen = await renderScreen(<VerifyEmailPage />);
        try {
            const inputs = Array.from(screen.container.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"]'));
            expect(inputs).toHaveLength(6);
            expect(new Set(inputs.map(input => input.getAttribute("aria-label"))).size).toBe(6);
            expect(inputs[0].autocomplete).toBe("one-time-code");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });
});
