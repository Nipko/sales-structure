import { act } from "react";
import {
    AGENT_QUALITY_DELIVERY_FAILURE_CODES,
    type AgentQualityAttentionAction,
    type AgentQualityAttentionSummary,
} from "@parallext/shared";
import { renderScreen, findAccessibilityViolations } from "@/test/a11y";
import { publishOnboardingLanding, type OnboardingLandingSignal } from "@/lib/onboarding-guide-signal";
import QualityAttentionBanner, {
    dayZeroDeliveryAction,
    deliveryReasonKey,
    isChannelProvenForDayZero,
    isDayZeroDeliveryFailure,
    qualityBannerContent,
} from "./QualityAttentionBanner";

/**
 * The red quality bar during day 0: quiet for setup, loud for a silent agent.
 *
 * Before the first real reply almost every "critical" is unfinished setup, and
 * the setup card already asks for it step by step — so the bar stays out. But
 * hiding it wholesale also hid the one alert that explains why an owner with
 * WhatsApp "connected" gets no answer: the connection she already made cannot
 * deliver. These specs pin the line between the two.
 */

const SIGNAL_ID = "5f0c1f7e-2b1a-4c8e-9f3d-1a2b3c4d5e6f";
const AGENT_ID = "8a9b0c1d-2e3f-4a5b-8c7d-9e0f1a2b3c4d";

let mockPath = "/admin/inbox";
let mockUser: Record<string, unknown> | null = null;
let mockSummary: AgentQualityAttentionSummary | null = null;
const mockSnooze = jest.fn();

jest.mock("next/navigation", () => ({ usePathname: () => mockPath }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("@/contexts/QualityHealthContext", () => ({
    useQualityHealth: () => ({ summary: mockSummary, snoozeSignal: mockSnooze }),
}));
jest.mock("@/hooks/useRole", () => ({
    useRole: () => ({ canAccess: () => true, canEditAgent: true, canManageChannels: true }),
}));

function summary(code: string, severity: "critical" | "high" = "critical"): AgentQualityAttentionSummary {
    return {
        generatedAt: new Date().toISOString(),
        worstStatus: "configuration_incomplete",
        agentsTotal: 1,
        evaluatedAgents: 1,
        agentsNeedingAttention: 1,
        openCritical: severity === "critical" ? 1 : 0,
        openHigh: severity === "high" ? 1 : 0,
        attentionCount: 1,
        topAction: {
            signalId: SIGNAL_ID,
            agentId: AGENT_ID,
            agentName: "Sofía",
            code,
            severity,
            href: "/admin/channels",
            evidenceCount: 1,
        },
        agents: [],
    };
}

function owner(stage: string, firstReplyAt: string | null = null, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: "user-1",
        role: "tenant_admin",
        tenantId: "tenant-1",
        onboardingStage: stage,
        firstReplyAt,
        tenantCreatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        ...extra,
    };
}

const DELIVERY_SIGNAL_ID = "0d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6";

function action(code: string, extra: Partial<AgentQualityAttentionAction> = {}): AgentQualityAttentionAction {
    return {
        signalId: DELIVERY_SIGNAL_ID,
        agentId: AGENT_ID,
        agentName: "Sofía",
        code,
        severity: "critical",
        href: "/admin/channels/whatsapp",
        evidenceCount: 1,
        ...extra,
    };
}

/** An unrelated critical on top — what day 0 hides — and the delivery failure behind it. */
function behindUnrelated(delivery: AgentQualityAttentionAction): AgentQualityAttentionSummary {
    return { ...summary("fix_rag_knowledge"), openCritical: 2, attentionCount: 2, deliveryAction: delivery };
}

async function banner(): Promise<{ container: HTMLElement; unmount: () => void }> {
    return renderScreen(<QualityAttentionBanner />);
}

function landing(signal: OnboardingLandingSignal): void {
    publishOnboardingLanding(signal);
}

describe("the quality bar during day 0", () => {
    beforeEach(() => {
        localStorage.clear();
        mockPath = "/admin/inbox";
        landing("unknown");
    });

    it("stays out while the channel is still unfinished setup", async () => {
        // No channel yet: "connect a channel" is the setup card's job.
        mockUser = owner("agent_reviewed");
        mockSummary = summary("fix_channel_connection");
        const screen = await banner();
        try {
            expect(screen.container.textContent).toBe("");
        } finally { screen.unmount(); }
    });

    it("comes through when the channel the account connected cannot deliver", async () => {
        mockUser = owner("channel_connected");
        mockSummary = summary("fix_channel_connection");
        const screen = await banner();
        try {
            const alert = screen.container.querySelector('[role="alert"]');
            expect(alert).not.toBeNull();
            // It says why the agent is silent, not "a critical action".
            expect(alert?.textContent).toContain("Tu agente no puede contestar por el canal que conectaste.");
            expect(alert?.textContent).toContain("Sofía");
            expect(screen.container.querySelector('a[href^="/admin/channels"]')).not.toBeNull();
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("comes through after the wizard's last button, when Home has proven the channel", async () => {
        // "Ir al panel" writes `completed`, which outranks `channel_connected`:
        // the stage alone no longer says a channel exists. Home's landing does.
        mockUser = owner("completed");
        mockSummary = summary("fix_channel_connection");
        landing("setup_card_and_health");
        const screen = await banner();
        try {
            expect(screen.container.querySelector('[role="alert"]')).not.toBeNull();
        } finally { screen.unmount(); }
    });

    it("does not treat a finished wizard as proof of a channel", async () => {
        mockUser = owner("completed");
        mockSummary = summary("fix_channel_connection");
        landing("setup_card_only");
        const screen = await banner();
        try {
            expect(screen.container.textContent).toBe("");
        } finally { screen.unmount(); }
    });

    it.each([
        ["an ordinary setup critical", summary("fix_rag_knowledge")],
        ["a connection that is only about to expire", summary("fix_channel_connection", "high")],
    ])("keeps %s out even with a channel", async (_label, value) => {
        mockUser = owner("channel_connected");
        mockSummary = { ...value, worstStatus: "at_risk" };
        const screen = await banner();
        try {
            expect(screen.container.textContent).toBe("");
        } finally { screen.unmount(); }
    });

    it("leaves Home and the wizard to their own guidance", async () => {
        mockUser = owner("channel_connected");
        mockSummary = summary("fix_channel_connection");
        landing("setup_card_and_health");
        for (const path of ["/admin", "/admin/setup-wizard"]) {
            mockPath = path;
            const screen = await banner();
            try {
                expect({ path, text: screen.container.textContent }).toEqual({ path, text: "" });
            } finally { screen.unmount(); }
        }
    });

    it("proves the channel with the session's own fact, after the wizard's last button and before Home said anything", async () => {
        mockUser = owner("completed", null, { hasAnyChannel: true });
        mockSummary = summary("fix_channel_connection");
        landing("unknown");
        const screen = await banner();
        try {
            expect(screen.container.querySelector('[role="alert"]')).not.toBeNull();
        } finally { screen.unmount(); }
    });

    it("a session that says there is no channel proves nothing on its own", async () => {
        mockUser = owner("completed", null, { hasAnyChannel: false });
        mockSummary = summary("fix_channel_connection");
        landing("unknown");
        const screen = await banner();
        try {
            expect(screen.container.textContent).toBe("");
        } finally { screen.unmount(); }
    });

    it("WhatsApp refusing every reply comes through from behind an unrelated critical, and says why", async () => {
        mockUser = owner("completed", null, { hasAnyChannel: true });
        mockSummary = behindUnrelated(action("fix_whatsapp_delivery", { checkStatus: "fail", deliveryIssue: "timezone_missing" }));
        const screen = await banner();
        try {
            const alert = screen.container.querySelector('[role="alert"]');
            expect(alert?.textContent).toContain("Tu agente no puede contestar por el canal que conectaste.");
            expect(alert?.textContent).toContain("Falta confirmar la zona horaria de facturación de tu número de WhatsApp.");
            // The delivery signal's own destination, carrying THAT signal.
            const link = screen.container.querySelector("a");
            expect(link?.getAttribute("href")).toContain("/admin/channels/whatsapp");
            expect(link?.getAttribute("href")).toContain(DELIVERY_SIGNAL_ID);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("a connected channel nobody answers comes through with its own sentence", async () => {
        mockUser = owner("channel_connected");
        mockSummary = behindUnrelated(action("fix_channel_unanswered", {
            checkStatus: "fail",
            href: `/admin/agent/${AGENT_ID}?tab=persona&focus=channels`,
        }));
        const screen = await banner();
        try {
            const alert = screen.container.querySelector('[role="alert"]');
            expect(alert?.textContent).toContain("Un canal que conectaste no tiene ningún agente que le conteste.");
            expect(alert?.textContent).not.toContain("Tu agente no puede contestar");
        } finally { screen.unmount(); }
    });

    it.each([
        ["behind an unrelated critical", () => behindUnrelated(action("fix_channel_connection", { checkStatus: "unknown" }))],
        ["as the top action itself", () => ({ ...summary("fix_channel_connection"), topAction: action("fix_channel_connection", { checkStatus: "unknown" }) })],
    ])("keeps a check that could not be RUN out of the red on day 0 (%s)", async (_label, value) => {
        // A lookup that failed is not evidence that the channel is broken.
        mockUser = owner("completed", null, { hasAnyChannel: true });
        mockSummary = value();
        const screen = await banner();
        try {
            expect(screen.container.textContent).toBe("");
        } finally { screen.unmount(); }
    });

    it("keeps the payment-method warning before 1 October (high, not critical) out of day 0", async () => {
        mockUser = owner("completed", null, { hasAnyChannel: true });
        mockSummary = behindUnrelated(action("fix_whatsapp_delivery", { severity: "high", checkStatus: "warning", deliveryIssue: "funding_absent" }));
        const screen = await banner();
        try {
            expect(screen.container.textContent).toBe("");
        } finally { screen.unmount(); }
    });

    it("snoozes the alert it shows, and hides it while the snooze is in flight", async () => {
        mockUser = owner("completed", null, { hasAnyChannel: true });
        mockSummary = behindUnrelated(action("fix_whatsapp_delivery", { checkStatus: "fail" }));
        let settle: (ok: boolean) => void = () => {};
        mockSnooze.mockReset();
        mockSnooze.mockImplementation(() => new Promise<boolean>((resolve) => { settle = resolve; }));
        const screen = await banner();
        try {
            const snooze = [...screen.container.querySelectorAll("button")].find((b) => b.textContent?.includes("Posponer 24 h"));
            await act(async () => { snooze?.click(); });
            expect(mockSnooze).toHaveBeenCalledWith(DELIVERY_SIGNAL_ID, 24);
            // The context is mocked here and clears nothing: the bar hides the
            // `deliveryAction` it showed on its own.
            expect(screen.container.textContent).toBe("");
            // Refused: the summary still carries it, so it comes back.
            await act(async () => { settle(false); });
            expect(screen.container.querySelector('[role="alert"]')).not.toBeNull();
        } finally { screen.unmount(); }
    });

    it.each([
        ["as the top action", () => summary("fix_channel_assignment")],
        ["as the delivery action the panel was handed", () => behindUnrelated(action("fix_channel_assignment", { checkStatus: "fail" }))],
    ])("does not call a default agent that IS answering silent: an agent assigned nowhere stays out of day 0 (%s)", async (_label, value) => {
        // Two active agents and a signup that (correctly) bound neither:
        // `channel_assignment` fails for both, while the pipeline delivers every
        // WhatsApp message to the default agent. Whether anybody answers a
        // connected channel is `channel_unanswered`'s call, made with the
        // pipeline's own resolution.
        mockUser = owner("completed", null, { hasAnyChannel: true });
        mockSummary = value();
        const screen = await banner();
        try {
            expect(screen.container.textContent).toBe("");
        } finally { screen.unmount(); }
    });

    it("returns to every critical once the agent has answered somebody", async () => {
        mockUser = owner("completed", new Date().toISOString());
        mockSummary = summary("fix_rag_knowledge");
        const screen = await banner();
        try {
            const alert = screen.container.querySelector('[role="alert"]');
            expect(alert?.textContent).toContain("Hay algo importante que resolver en tus agentes.");
            // The generic headline is in the owner's words: "acción crítica" was
            // Appendix A jargon on every screen, not only on day 0.
            expect(alert?.textContent).not.toMatch(/acci[oó]n cr[ií]tica/i);
        } finally { screen.unmount(); }
    });
});

describe("the quality bar after day 0", () => {
    const FOUR_DAYS_AGO = () => new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();

    beforeEach(() => {
        localStorage.clear();
        mockPath = "/admin/inbox";
        landing("unknown");
    });

    it.each([
        ["by the 3-day cap, for an agent that never answered anyone", () => owner("completed", null, { hasAnyChannel: true, tenantCreatedAt: FOUR_DAYS_AGO() })],
        ["by the first reply", () => owner("live", new Date().toISOString(), { hasAnyChannel: true })],
    ])("ended %s: the delivery failure still leads over an unrelated critical, and says why", async (_label, user) => {
        mockUser = user();
        mockSummary = behindUnrelated(action("fix_whatsapp_delivery", { checkStatus: "fail", deliveryIssue: "timezone_missing" }));
        const screen = await banner();
        try {
            const alert = screen.container.querySelector('[role="alert"]');
            expect(alert?.textContent).toContain("Tu agente no puede contestar por el canal que conectaste.");
            expect(alert?.textContent).toContain("Falta confirmar la zona horaria de facturación de tu número de WhatsApp.");
            expect(alert?.textContent).not.toContain("Hay algo importante que resolver en tus agentes.");
            const link = screen.container.querySelector("a");
            expect(link?.getAttribute("href")).toContain("/admin/channels/whatsapp");
            expect(link?.getAttribute("href")).toContain(DELIVERY_SIGNAL_ID);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("a connected channel nobody answers keeps its own sentence after day 0", async () => {
        mockUser = owner("live", new Date().toISOString(), { hasAnyChannel: true });
        mockSummary = behindUnrelated(action("fix_channel_unanswered", { checkStatus: "fail" }));
        const screen = await banner();
        try {
            expect(screen.container.querySelector('[role="alert"]')?.textContent)
                .toContain("Un canal que conectaste no tiene ningún agente que le conteste.");
        } finally { screen.unmount(); }
    });

    it("without a proven channel it still leads, but does not claim a channel was connected", async () => {
        mockUser = owner("completed", null, { hasAnyChannel: false, tenantCreatedAt: FOUR_DAYS_AGO() });
        mockSummary = behindUnrelated(action("fix_channel_connection", { checkStatus: "fail", href: "/admin/channels" }));
        const screen = await banner();
        try {
            const alert = screen.container.querySelector('[role="alert"]');
            expect(alert?.textContent).toContain("Hay algo importante que resolver en tus agentes.");
            expect(alert?.textContent).not.toContain("el canal que conectaste");
            expect(screen.container.querySelector("a")?.getAttribute("href")).toContain(DELIVERY_SIGNAL_ID);
        } finally { screen.unmount(); }
    });

    it("a delivery check that could not be RUN does not jump ahead of the top action", async () => {
        mockUser = owner("live", new Date().toISOString(), { hasAnyChannel: true });
        mockSummary = behindUnrelated(action("fix_whatsapp_delivery", { checkStatus: "unknown", deliveryIssue: "timezone_missing" }));
        const screen = await banner();
        try {
            const alert = screen.container.querySelector('[role="alert"]');
            expect(alert?.textContent).toContain("Hay algo importante que resolver en tus agentes.");
            expect(alert?.textContent).not.toContain("Falta confirmar la zona horaria");
            expect(screen.container.querySelector("a")?.getAttribute("href")).toContain(SIGNAL_ID);
        } finally { screen.unmount(); }
    });
});

describe("the day-0 rules, as functions", () => {
    it("any positive channel fact proves a channel; a negative one vetoes nothing", () => {
        expect(isChannelProvenForDayZero({ hasAnyChannel: true, onboardingStage: "completed" }, "unknown")).toBe(true);
        expect(isChannelProvenForDayZero({ onboardingStage: "channel_connected" }, "unknown")).toBe(true);
        expect(isChannelProvenForDayZero({ hasAnyChannel: false }, "setup_card_and_health")).toBe(true);
        expect(isChannelProvenForDayZero({ hasAnyChannel: false, onboardingStage: "completed" }, "setup_card_only")).toBe(false);
        expect(isChannelProvenForDayZero({ onboardingStage: "completed" }, "unknown")).toBe(false);
        expect(isChannelProvenForDayZero(null, "normal")).toBe(true);
        expect(isChannelProvenForDayZero(undefined, "unknown")).toBe(false);
    });

    it("counts an agent assigned nowhere as setup, never as a channel nobody answers", () => {
        // With two active agents `channel_assignment` fails for both while the
        // default agent answers: it cannot be what says "your agent is silent".
        expect(AGENT_QUALITY_DELIVERY_FAILURE_CODES).not.toContain("fix_channel_assignment");
        expect(isDayZeroDeliveryFailure(action("fix_channel_assignment", { checkStatus: "fail" }), true)).toBe(false);
        expect([...AGENT_QUALITY_DELIVERY_FAILURE_CODES].sort())
            .toEqual(["fix_channel_connection", "fix_channel_unanswered", "fix_whatsapp_delivery"]);
    });

    it("lets through every shared delivery code, critical and failed or from before the status travelled", () => {
        for (const code of AGENT_QUALITY_DELIVERY_FAILURE_CODES) {
            expect({ code, pass: isDayZeroDeliveryFailure(action(code, { checkStatus: "fail" }), true) }).toEqual({ code, pass: true });
            expect({ code, pass: isDayZeroDeliveryFailure(action(code), true) }).toEqual({ code, pass: true });
            expect({ code, pass: isDayZeroDeliveryFailure(action(code, { checkStatus: "unknown" }), true) }).toEqual({ code, pass: false });
            expect({ code, pass: isDayZeroDeliveryFailure(action(code), false) }).toEqual({ code, pass: false });
            expect({ code, pass: isDayZeroDeliveryFailure(action(code, { severity: "high" }), true) }).toEqual({ code, pass: false });
        }
        expect(isDayZeroDeliveryFailure(action("fix_rag_knowledge", { checkStatus: "fail" }), true)).toBe(false);
        expect(isDayZeroDeliveryFailure(undefined, true)).toBe(false);
    });

    it("prefers deliveryAction, and still reads a topAction from before deliveryAction existed", () => {
        const delivery = action("fix_whatsapp_delivery", { checkStatus: "fail" });
        expect(dayZeroDeliveryAction(behindUnrelated(delivery), true)).toBe(delivery);
        const legacy = summary("fix_channel_connection");
        expect(dayZeroDeliveryAction(legacy, true)).toBe(legacy.topAction);
        expect(dayZeroDeliveryAction(summary("fix_rag_knowledge"), true)).toBeUndefined();
        expect(dayZeroDeliveryAction(null, true)).toBeUndefined();
    });

    it("picks the delivery failure first whether or not day 0 is over, and says it plainly only over a proven channel", () => {
        const delivery = action("fix_whatsapp_delivery", { checkStatus: "fail", deliveryIssue: "funding_restricted" });
        const value = behindUnrelated(delivery);
        for (const dayZero of [true, false]) {
            expect(qualityBannerContent(value, { dayZero, channelProven: true })).toEqual({
                action: delivery,
                headline: "bannerDeliveryFailure",
                reasonKey: "bannerDeliveryReason.funding_restricted",
            });
        }
        // Day 0 without a channel: unfinished setup, the card's job.
        expect(qualityBannerContent(value, { dayZero: true, channelProven: false })).toBeNull();
        // After day 0 without a channel: still first, in the generic words.
        expect(qualityBannerContent(value, { dayZero: false, channelProven: false })).toMatchObject({
            action: delivery,
            headline: "bannerCritical",
        });
        // No delivery failure: day 0 says nothing, after it the top action as before.
        const plain = summary("fix_rag_knowledge");
        expect(qualityBannerContent(plain, { dayZero: true, channelProven: true })).toBeNull();
        expect(qualityBannerContent(plain, { dayZero: false, channelProven: true }))
            .toEqual({ action: plain.topAction, headline: "bannerCritical", reasonKey: null });
        expect(qualityBannerContent({ ...plain, worstStatus: "at_risk" }, { dayZero: false, channelProven: true })?.headline)
            .toBe("bannerAtRisk");
        expect(qualityBannerContent(summary("refresh_eval", "high"), { dayZero: false, channelProven: true })).toBeNull();
        expect(qualityBannerContent(null, { dayZero: false, channelProven: true })).toBeNull();
    });

    it("names a reason only for a WhatsApp delivery failure that carries a known one", () => {
        expect(deliveryReasonKey(action("fix_whatsapp_delivery", { deliveryIssue: "funding_restricted" })))
            .toBe("bannerDeliveryReason.funding_restricted");
        expect(deliveryReasonKey(action("fix_whatsapp_delivery", { deliveryIssue: "multiple" }))).toBeNull();
        expect(deliveryReasonKey(action("fix_whatsapp_delivery"))).toBeNull();
        expect(deliveryReasonKey(action("fix_channel_connection", { deliveryIssue: "timezone_missing" }))).toBeNull();
    });
});
