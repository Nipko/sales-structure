import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import { act } from "react";
import { GUIDED_TOUR_START_EVENT } from "@parallext/shared";
import { renderScreen, type RenderedScreen } from "@/test/a11y";
import { GuidedTourRunner } from "./ProductTour";

/**
 * The agent tours run in the tenant's change mode, whoever launched them.
 *
 * The runner built each run's context from `agentId`, `channelType` and
 * `verticalCatalogRoute` and dropped `GuidedTourStartDetail.reviewMode`, so a
 * tenant in reviewed mode was walked to the switch ("turn it on") and told a
 * save goes live at once — the immediate mode's tour, on a screen where it is
 * not true. The mode now travels into the step context; when the launcher
 * does not know it (every launcher but the editor), the runner reads it once.
 *
 * The real runner and card with the real copy; the network, session and
 * Onborda's overlay (ESM, and not what is under test) are faked.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const ES = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "messages", "es.json"), "utf8"));
const TITLES = ES.guidedTours.publish_agent_revision.steps;

jest.mock("onborda", () => ({
    __esModule: true,
    useOnborda: () => ({
        startOnborda: () => {}, closeOnborda: () => {}, setCurrentStep: () => {},
        currentStep: 0, currentTour: null, isOnbordaVisible: false,
    }),
    OnbordaProvider: ({ children }: { children: React.ReactNode }) => children,
    Onborda: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/lib/api", () => ({ __esModule: true, api: { getAgentReviewMode: jest.fn() } }));
jest.mock("@/contexts/AuthContext", () => ({
    __esModule: true,
    useAuth: () => ({ user: { id: "u1", role: "tenant_admin", tenantId: "11111111-1111-4111-8111-111111111111" } }),
}));
let mockCanOpenAgents = true;
jest.mock("@/hooks/useRole", () => ({
    __esModule: true,
    useRole: () => ({
        role: "tenant_admin", canEditAgent: true, canManageChannels: true, canEditKnowledge: true,
        canManageSettings: true, canManageUsers: true, canHandleConversations: true,
        canAccess: (route: string) => mockCanOpenAgents || !route.startsWith("/admin/agent"),
    }),
}));
jest.mock("next/navigation", () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), forward: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => "/admin/agent/22222222-2222-4222-8222-222222222222",
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ agentId: "22222222-2222-4222-8222-222222222222" }),
}));

const { api } = jest.requireMock("@/lib/api") as { api: { getAgentReviewMode: jest.Mock } };

/** The editor's anchors both variants of the tour point at, on the screen the run starts on. */
function editorAnchors(): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = [
        '<div id="tour-target-agent-active"><button role="switch" aria-checked="false">Activo</button></div>',
        '<div id="tour-target-agent-channels"><button aria-pressed="false">Web</button></div>',
        '<div id="tour-target-agent-save"><button>Guardar</button></div>',
    ].join("");
    document.body.appendChild(root);
    return root;
}

async function start(detail: Record<string, unknown>): Promise<void> {
    await act(async () => {
        window.dispatchEvent(new CustomEvent(GUIDED_TOUR_START_EVENT, { detail: { tourId: "publish_agent_revision", agentId: AGENT, ...detail } }));
    });
    // The runner waits for the screen's anchors to hold still before planning.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1_000)); });
}

const cardTitle = (screen: RenderedScreen) =>
    screen.container.querySelector('[role="dialog"][aria-modal="false"]')?.getAttribute("aria-label") ?? null;

describe("the agent tours follow the tenant's change mode", () => {
    let anchors: HTMLElement;
    let rects: jest.SpyInstance;

    beforeEach(() => {
        api.getAgentReviewMode.mockReset();
        mockCanOpenAgents = true;
        try { sessionStorage.clear(); } catch { /* storage-less jsdom */ }
        window.history.pushState({}, "", `/admin/agent/${AGENT}`);
        anchors = editorAnchors();
        // jsdom lays nothing out; a connected element is "on screen" here.
        rects = jest.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
            return (this.isConnected ? [{}] : []) as unknown as DOMRectList;
        });
    });
    afterEach(() => {
        rects.mockRestore();
        anchors.remove();
    });

    it("walks a reviewed-mode tenant through the draft, reading the mode when the launcher did not know it", async () => {
        api.getAgentReviewMode.mockResolvedValue({ success: true, data: { mode: "reviewed" } });
        const screen = await renderScreen(<GuidedTourRunner tours={[]} />);
        try {
            await start({});
            expect(api.getAgentReviewMode).toHaveBeenCalledWith(TENANT);
            expect(cardTitle(screen)).toBe(TITLES.draft.title);
        } finally { screen.unmount(); }
    });

    it("shows the switch in immediate mode, the default", async () => {
        api.getAgentReviewMode.mockResolvedValue({ success: true, data: { mode: "immediate" } });
        const screen = await renderScreen(<GuidedTourRunner tours={[]} />);
        try {
            await start({});
            expect(cardTitle(screen)).toBe(TITLES.switch.title);
        } finally { screen.unmount(); }
    });

    it("uses the launcher's mode when it has one, without asking", async () => {
        const screen = await renderScreen(<GuidedTourRunner tours={[]} />);
        try {
            await start({ reviewMode: "reviewed" });
            expect(api.getAgentReviewMode).not.toHaveBeenCalled();
            expect(cardTitle(screen)).toBe(TITLES.draft.title);
        } finally { screen.unmount(); }
    });

    it("falls back to the default mode's tour when the mode cannot be read, and never asks without access", async () => {
        mockCanOpenAgents = false;
        const screen = await renderScreen(<GuidedTourRunner tours={[]} />);
        try {
            await start({});
            expect(api.getAgentReviewMode).not.toHaveBeenCalled();
            expect(cardTitle(screen)).toBe(TITLES.switch.title);
        } finally { screen.unmount(); }
    });
});
