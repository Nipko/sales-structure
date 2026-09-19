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

describe("Assist during day 0", () => {
    beforeEach(() => {
        api.copilotChat.mockReset().mockResolvedValue({ success: true, data: { reply: "Listo, te lo preparo." } });
        try { sessionStorage.clear(); localStorage.clear(); } catch { /* storage-less jsdom */ }
    });

    it.each(["/admin", "/admin/agent", "/admin/setup-wizard"])("draws no mascot on %s until the account is live", async (route) => {
        mockPath = route;
        mockUser = dayZeroOwner();
        const screen = await renderScreen(<HelpAssistant />);
        try {
            expect(launcher(screen)).toBeNull();
            expect(screen.container.querySelector("button")).toBeNull();
        } finally { screen.unmount(); }
    });

    it.each(["/admin", "/admin/setup-wizard"])("still opens Assist from the sidebar's Ayuda on %s", async (route) => {
        mockPath = route;
        mockUser = dayZeroOwner();
        const screen = await renderScreen(<HelpAssistant />);
        try {
            expect(sheet()).toBeNull();
            await interact(() => window.dispatchEvent(new CustomEvent("parallly:open-copilot")));
            await settle();
            expect(sheet()?.textContent).toContain(ES.helpAssistant.drawerTitle);
            expect(await findAccessibilityViolations(sheet()!)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("draws the launcher once the agent has answered a real customer", async () => {
        mockPath = "/admin";
        mockUser = liveOwner();
        const screen = await renderScreen(<HelpAssistant />);
        try {
            expect(launcher(screen)).not.toBeNull();
            expect(launcher(screen)?.getAttribute("aria-label")).toBe(ES.helpAssistant.launcherTooltip);
        } finally { screen.unmount(); }
    });
});

describe("\"Dime qué cambiar\" in Assist", () => {
    beforeEach(() => {
        api.copilotChat.mockReset().mockResolvedValue({ success: true, data: { reply: "Listo, te lo preparo." } });
        mockPath = `/admin/agent/${AGENT}`;
        mockUser = dayZeroOwner();
    });

    it("sends the owner's words as her message, on this agent, without a second Enter", async () => {
        const screen = await renderScreen(<HelpAssistant />);
        try {
            await interact(() => window.dispatchEvent(new CustomEvent(QUALITY_ASSIST_EVENT, {
                detail: { agentId: AGENT, agentName: "Valentina", prompt: "  que salude más corto  ", send: true },
            })));
            await settle();
            expect(api.copilotChat).toHaveBeenCalledTimes(1);
            const [request] = api.copilotChat.mock.calls[0];
            // Trimmed like a typed message, aimed at this agent, with the fresh
            // conversation as its history — not the one it replaced.
            expect(request).toMatchObject({
                message: "que salude más corto",
                page: `/admin/agent/${AGENT}`,
                target: { kind: "agent_quality", agentId: AGENT },
                history: [{ role: "assistant", content: ES.helpAssistant.announce.body }],
            });
            expect(sheet()?.textContent).toContain("que salude más corto");
            expect(sheet()?.textContent).toContain("Listo, te lo preparo.");
            // Nothing left typed to send again.
            expect(chatInput()?.value).toBe("");
            // Her request is not a health signal: no amber "Contexto de salud
            // del agente" over it.
            expect(sheet()?.textContent).not.toContain(ES.helpAssistant.chat.quality.contextTitle);
            expect(sheet()?.textContent).not.toContain(ES.helpAssistant.chat.quality.contextDescription);
        } finally { screen.unmount(); }
    });

    it("leaves a prompt the panel suggests typed, for her to send or change", async () => {
        const screen = await renderScreen(<HelpAssistant />);
        try {
            await interact(() => window.dispatchEvent(new CustomEvent(QUALITY_ASSIST_EVENT, {
                detail: { agentId: AGENT, prompt: "¿Por qué no contesta?" },
            })));
            await settle();
            expect(api.copilotChat).not.toHaveBeenCalled();
            expect(chatInput()?.value).toBe("¿Por qué no contesta?");
            // A quality surface opening Assist still explains what it receives.
            expect(sheet()?.textContent).toContain(ES.helpAssistant.chat.quality.contextTitle);
        } finally { screen.unmount(); }
    });

    it("does not send a request that is only spaces", async () => {
        const screen = await renderScreen(<HelpAssistant />);
        try {
            await interact(() => window.dispatchEvent(new CustomEvent(QUALITY_ASSIST_EVENT, {
                detail: { agentId: AGENT, prompt: "   ", send: true },
            })));
            await settle();
            expect(api.copilotChat).not.toHaveBeenCalled();
        } finally { screen.unmount(); }
    });

    it("sends once, and not again when the chat re-renders", async () => {
        const screen = await renderScreen(<HelpAssistant />);
        try {
            await interact(() => window.dispatchEvent(new CustomEvent(QUALITY_ASSIST_EVENT, {
                detail: { agentId: AGENT, prompt: "ofrece agendar", send: true },
            })));
            await settle();
            await settle();
            expect(api.copilotChat).toHaveBeenCalledTimes(1);
        } finally { screen.unmount(); }
    });
});
