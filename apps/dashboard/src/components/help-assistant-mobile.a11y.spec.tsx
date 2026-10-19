import { NextIntlClientProvider } from "next-intl";
import * as fs from "fs";
import * as path from "path";
import { findAccessibilityViolations, interact, renderScreen, type RenderedScreen } from "@/test/a11y";
import { QUALITY_ASSIST_EVENT } from "@/lib/quality-assistant-contract";
import { HelpAssistant } from "./HelpAssistant";

/**
 * Assist during day 0: no mascot, but never out of reach.
 *
 * D7-A — nothing greets the owner over the guided setup until her agent has
 * answered somebody. The launcher used to stay drawn on every screen but the
 * wizard, only without its bubble; and on the wizard the whole component
 * returned nothing, so the sidebar's "Ayuda" opened a sheet that was never
 * drawn — and that popped open later, on the next screen. Now only the
 * launcher goes, everywhere, and every explicit way in still opens Assist.
 *
 * "Dime qué cambiar" used to leave the owner's words typed in the chat and
 * wait for a second Enter. They are her words: Assist sends them, through the
 * same `sendMessage` (and so the same trim, cap and one-at-a-time guard) as a
 * message typed in the chat.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const HOUR = 60 * 60 * 1000;
const ES = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "messages", "es.json"), "utf8"));

let mockUser: Record<string, unknown> = {};
let mockPath = "/admin";

jest.mock("@/lib/api", () => ({ __esModule: true, api: { copilotChat: jest.fn(), getAgentReviewMode: jest.fn() } }));
jest.mock("@/contexts/AuthContext", () => ({ __esModule: true, useAuth: () => ({ user: mockUser }) }));
jest.mock("@/contexts/TenantContext", () => ({ __esModule: true, useTenant: () => ({ activeTenantId: "11111111-1111-4111-8111-111111111111" }) }));
jest.mock("@/hooks/useRole", () => ({
    __esModule: true,
    useRole: () => ({
        role: "tenant_admin", canEditAgent: true, canEditKnowledge: true, canEditPipeline: true,
        canManageChannels: true, canManageSettings: true,
    }),
}));
jest.mock("next/navigation", () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), forward: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => mockPath,
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
}));

const { api } = jest.requireMock("@/lib/api") as { api: { copilotChat: jest.Mock } };

const dayZeroOwner = () => ({
    id: "u1", role: "tenant_admin", tenantId: TENANT, onboardingStage: "agent_reviewed",
    firstReplyAt: null, tenantCreatedAt: new Date(Date.now() - HOUR).toISOString(),
});
const liveOwner = () => ({ ...dayZeroOwner(), onboardingStage: "live", firstReplyAt: new Date(Date.now() - HOUR / 2).toISOString() });

const launcher = (screen: RenderedScreen) => screen.container.querySelector("#tour-target-assistant");
const sheet = () => document.querySelector<HTMLElement>('[role="dialog"]');
const chatInput = () => sheet()?.querySelector<HTMLInputElement>('input[type="text"]') ?? null;

async function settle(): Promise<void> {
    await interact(() => {});
    await interact(() => {});
}

describe("Mobile Assist in reserved header space", () => {
    let originalMedia: typeof window.matchMedia;
    let mobile: boolean;
    let notify: (() => void) | undefined;
    beforeEach(() => {
        originalMedia = window.matchMedia;
        mobile = true;
        window.matchMedia = ((query: string) => ({ media: query, get matches() { return mobile; }, onchange: null,
            addEventListener: (_: string, fn: () => void) => { notify = fn; },
            removeEventListener: () => { notify = undefined; },
            addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true,
        })) as unknown as typeof window.matchMedia;
        mockUser = liveOwner(); mockPath = "/admin/listings";
        localStorage.clear(); sessionStorage.clear();
    });
    afterEach(() => { window.matchMedia = originalMedia; });
    const view = () => <><header><div id="parallly-mobile-assistant-slot" /></header><main><input aria-label="Area" /></main><HelpAssistant /></>;
    it("places the live mobile trigger inside the header, outside the form", async () => {
        const screen = await renderScreen(view());
        try {
            const button = launcher(screen)!;
            expect(button?.parentElement?.id).toBe("parallly-mobile-assistant-slot");
            expect(button.classList.contains("fixed")).toBe(false);
            expect(screen.container.querySelector("main button")).toBeNull();
            expect(button.getAttribute("aria-label")).toBe(ES.helpAssistant.launcherTooltip);
            await interact(() => (button as HTMLButtonElement).click());
            expect(sheet()?.textContent).toContain(ES.helpAssistant.drawerTitle);
        } finally { screen.unmount(); }
    });
    it.each(["es", "en", "pt", "fr"])("retains the translated mobile entry in %s", async (locale) => {
        const messages = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "messages", locale + ".json"), "utf8"));
        const screen = await renderScreen(<NextIntlClientProvider locale={locale} messages={messages}>{view()}</NextIntlClientProvider>);
        try {
            expect(launcher(screen)?.getAttribute("aria-label")).toBe(messages.helpAssistant.launcherTooltip);
            expect(launcher(screen)?.parentElement?.id).toBe("parallly-mobile-assistant-slot");
        } finally { screen.unmount(); }
    });
    it("retains the desktop floating entry", async () => {
        mobile = false;
        const screen = await renderScreen(view());
        try { expect(launcher(screen)?.classList.contains("fixed")).toBe(true); }
        finally { screen.unmount(); }
    });
    it.each([
        [844, 390, true], [1024, 390, true], [1280, 500, true],
        [844, 501, false], [1440, 900, false], [390, 844, true],
    ])("keeps the entry outside fields at %sx%s (header=%s)", async (width, height, inHeader) => {
        window.matchMedia = ((query: string) => ({
            media: query,
            matches: query.split(",").some((part) => {
                const limit = part.match(/max-(width|height):\s*(\d+)px/);
                return limit ? (limit[1] === "width" ? width : height) <= Number(limit[2]) : false;
            }),
            addEventListener: () => {}, removeEventListener: () => {},
        })) as unknown as typeof window.matchMedia;
        const screen = await renderScreen(view());
        try {
            const button = launcher(screen)!;
            expect(button.parentElement?.id === "parallly-mobile-assistant-slot").toBe(inHeader);
            expect(button.classList.contains("fixed")).toBe(!inHeader);
            await interact(() => (button as HTMLButtonElement).click());
            expect(sheet()?.getAttribute("aria-modal")).toBe("true");
            expect(sheet()?.textContent).toContain(ES.helpAssistant.drawerTitle);
            expect(api.copilotChat).not.toHaveBeenCalled();
        } finally { screen.unmount(); }
    });
    it("keeps the existing entry if an embedding has no header slot", async () => {
        const screen = await renderScreen(<HelpAssistant />);
        try { expect(launcher(screen)?.classList.contains("fixed")).toBe(true); }
        finally { screen.unmount(); }
    });
    it.each(["day-zero", "composer", "viewer"])("preserves the %s access gate", async (gate) => {
        if (gate === "day-zero") mockUser = dayZeroOwner();
        if (gate === "composer") mockPath = "/admin/inbox";
        if (gate === "viewer") mockUser = { ...liveOwner(), role: "tenant_viewer" };
        const screen = await renderScreen(view());
        try { expect(launcher(screen)).toBeNull(); }
        finally { screen.unmount(); }
    });
    it("moves the entry on resize without losing the open drawer", async () => {
        const screen = await renderScreen(view());
        try {
            await interact(() => (launcher(screen) as HTMLButtonElement).click());
            mobile = false;
            await interact(() => notify?.());
            expect(launcher(screen)?.classList.contains("fixed")).toBe(true);
            expect(sheet()?.textContent).toContain(ES.helpAssistant.drawerTitle);
        } finally { screen.unmount(); }
    });
});
