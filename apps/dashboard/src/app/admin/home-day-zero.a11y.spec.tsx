import { act } from "react";
import { GUIDED_TOUR_START_EVENT, type GuidedTourStartDetail } from "@parallext/shared";
import { renderScreen, findAccessibilityViolations, interact } from "@/test/a11y";
import { api } from "@/lib/api";
import TrialCountdownBanner from "@/components/TrialCountdownBanner";
import type { RestrictionInfo } from "@/app/admin/layout";
import AdminDashboard from "./page";

/**
 * Home during day 0: one guide, and it is the setup card.
 *
 * The 14-sep recording opened Home without a channel under six surfaces at
 * once — the trial notice, an indigo "Retomar" banner, the setup card, an
 * empty "Actividad reciente", "Uso de modelos" with "El router ahorra ~42% en
 * costos usando Tier 3-4", and the mascot. The channel guidance appeared twice
 * with two different destinations. What is pinned here is the screen as the
 * design asks for it: the card alone (plus a restriction the account is really
 * under), with the channel left for later said on the card's own channel step,
 * in the owner's words when she answered the WhatsApp question — and naming
 * the channel the server's setup step carries (the first of the order the
 * wizard saved), because its "Listo" promised "{Instagram} queda pendiente y
 * te lo recordamos en Inicio" and "Salud de agentes" names that same one.
 */

let mockUser: Record<string, unknown> | null = null;
let mockRole = "tenant_admin";
/** `AuthContext.planFeatures`: `null` = not known, which excludes no channel. */
let mockPlanFeatures: Record<string, unknown> | null = null;
// Stable across renders, as the real context is: a fresh object per render
// would re-create every callback that depends on it and reload forever.
const mockVertical = { industry: "otro" };

jest.mock("@/contexts/AuthContext", () => ({
    useAuth: () => ({ user: mockUser, verticalConfig: mockVertical, planFeatures: mockPlanFeatures }),
}));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "tenant-1" }) }));
jest.mock("@/hooks/useRole", () => ({
    useRole: () => ({ role: mockRole, canAccess: () => true, isSuperAdmin: false, impersonating: false }),
}));
jest.mock("@/lib/api", () => ({
    api: {
        getSetupStatus: jest.fn(),
        getCommercialOverview: jest.fn(),
        getOverviewStats: jest.fn(),
        getAgentAssessment: jest.fn(),
        getBillingSubscription: jest.fn(),
        getTenants: jest.fn(),
        fetch: jest.fn(),
    },
}));
// Its own spec covers it; here it only has to be countable.
jest.mock("@/components/quality/AgentHealthCard", () => ({
    __esModule: true,
    default: () => <section aria-labelledby="mock-agent-health"><h2 id="mock-agent-health">Salud de agentes</h2></section>,
}));
jest.mock("./_components/OnboardingMetricsCard", () => ({ __esModule: true, default: () => null }));
// The real access table, unless a test opens every route on purpose.
let mockOpenEveryRoute = false;
jest.mock("@/lib/navigation-access", () => {
    const actual = jest.requireActual("@/lib/navigation-access");
    return {
        ...actual,
        canAccessDashboardNavigationPath: (...args: unknown[]) =>
            mockOpenEveryRoute || actual.canAccessDashboardNavigationPath(...args),
    };
});

const JUST_CREATED = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();
const RECORDED = "2026-09-17T15:00:00.000Z";

function owner(facts: { stage?: string; firstReplyAt?: string | null; role?: string } = {}): Record<string, unknown> {
    return {
        id: "user-1",
        firstName: "Laura",
        role: facts.role ?? "tenant_admin",
        tenantId: "tenant-1",
        onboardingStage: facts.stage ?? "channel_deferred",
        firstReplyAt: facts.firstReplyAt ?? null,
        tenantCreatedAt: JUST_CREATED(),
    };
}

function setupStatus(overrides: Record<string, unknown> = {}) {
    return {
        success: true,
        data: {
            hasAnyChannel: false,
            connectedChannelTypes: [],
            setupWizardCompleted: true,
            setupWizardSkipped: false,
            onboardingStage: "channel_deferred",
            channelConnectSkippedAt: "2026-09-17T14:58:00.000Z",
            defaultAgent: { id: "agent-1", name: "Sofía", greeting: "Hola" },
            whatsappTriage: { answerId: "other_provider", recordedAt: RECORDED },
            ...overrides,
        },
    };
}

/**
 * Four essentials; the channel one still pending unless told otherwise.
 *
 * The channel task is the one the server really sends. With nothing
 * connected, `connectFirstChannelTask` names the channel to connect first in
 * `channelType` — the first of the order the wizard saved, else WhatsApp —
 * with WhatsApp's own screen and tour, or the channel list and
 * `connect_channel` for any other. `channelType: null` is the step the server
 * did NOT shape (it could not count the connections): the only case where
 * Home falls back to its own reading of the recipe.
 */
function assessment(
    channel: "fail" | "pass" = "fail",
    rest: "fail" | "pass" = "fail",
    channelType: "whatsapp" | "instagram" | "messenger" | "telegram" | null = "whatsapp",
) {
    const shape = channelType === null
        ? { href: "/admin/channels", tourId: "connect_channel" }
        : channelType === "whatsapp"
            ? { href: "/admin/channels/whatsapp", tourId: "first_channel_whatsapp", channelType }
            : { href: "/admin/channels", tourId: "connect_channel", channelType };
    return {
        success: true,
        data: {
            agent: { id: "agent-1" },
            tasks: [
                {
                    key: "channel", status: channel, pendingCheckCode: channel === "pass" ? undefined : "channel_connection",
                    ...shape,
                    checks: [{ code: "channel_connection", status: channel, evidence: {} }],
                },
                { key: "agent", status: "pass", href: "/admin/agent/agent-1", tourId: null, checks: [] },
                { key: "business", status: rest, href: "/admin/settings/business-info", tourId: null, checks: [] },
                { key: "team", status: rest, href: "/admin/users", tourId: null, checks: [] },
            ],
        },
    };
}

/** `GET /verticals/:tenantId/recipe`, leading with the channels given, in order. */
function recipe(...channels: string[]) {
    return {
        success: true,
        data: { recipe: { recommendedChannels: channels.map((channel) => ({ channel, why: { es: "Ahí te escriben." } })) } },
    };
}

/** The recipe read answers `body`; nothing else Home fetches is under test here. */
function answerRecipeWith(body: unknown) {
    jest.mocked(api.fetch).mockImplementation(async (path: string) => (path.includes("/recipe") ? body : undefined));
}

/** The card's channel step: the one row that mentions connecting. */
function channelStep(container: HTMLElement): HTMLElement {
    const step = Array.from(container.querySelectorAll('[aria-labelledby="initial-setup-card-title"] li'))
        .find((li) => /Conecta/.test(li.textContent ?? ""));
    expect(step).toBeDefined();
    return step as HTMLElement;
}

const NO_RESTRICTION: RestrictionInfo = { level: "none", daysElapsed: 0, daysRemaining: 7, status: "active" };
const SOFT_LOCK: RestrictionInfo = { level: "soft_lock", daysElapsed: 5, daysRemaining: 3, status: "past_due" };

/** The page's own root: the element that holds the header and every surface under it. */
function pageRoot(container: HTMLElement): HTMLElement {
    const heading = container.querySelector("h1");
    expect(heading).not.toBeNull();
    let node: HTMLElement | null = heading!.parentElement;
    while (node && node.parentElement && !node.parentElement.classList.contains("animate-in")) node = node.parentElement;
    return node!.parentElement!;
}

/**
 * Everything Home draws besides its title: each direct child of the page root
 * that is not the header is one thing competing for the owner's attention.
 */
function homeSurfaces(container: HTMLElement): HTMLElement[] {
    return Array.from(pageRoot(container).children).filter((child) => !child.querySelector("h1")) as HTMLElement[];
}

/** Layout-level notices rendered next to the page in these specs. */
function notices(container: HTMLElement): Element[] {
    return Array.from(container.querySelectorAll('[role="alert"], [role="status"]'))
        .filter((el) => !pageRoot(container).contains(el));
}

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mockRole = "tenant_admin";
    mockOpenEveryRoute = false;
    mockPlanFeatures = null;
    mockUser = owner();
    // No recipe unless a test gives one: the wizard's default order, WhatsApp first.
    answerRecipeWith(undefined);
    jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus() as any);
    jest.mocked(api.getCommercialOverview).mockResolvedValue({
        success: true, data: { leadsToday: 0, leadsHot: 0, messagesProcessed: 0, llmCostToday: 0 },
    } as any);
    jest.mocked(api.getOverviewStats).mockResolvedValue({
        success: true, data: { recentActivity: [], modelUsage: [{ model: "gpt-4o-mini", count: 12 }] },
    } as any);
    jest.mocked(api.getAgentAssessment).mockResolvedValue(assessment() as any);
    jest.mocked(api.getBillingSubscription).mockResolvedValue({
        success: true,
        data: { status: "trialing", trialEndsAt: new Date(Date.now() + 13.5 * 86_400_000).toISOString() },
    } as any);
});

async function renderHome(restriction: RestrictionInfo = NO_RESTRICTION) {
    const screen = await renderScreen(
        <>
            <TrialCountdownBanner restriction={restriction} />
            <AdminDashboard />
        </>,
    );
    // Four reads chain here (setup status, then the recipe; assessment,
    // overview): let them land.
    for (let i = 0; i < 4; i++) {
        await act(async () => { await Promise.resolve(); });
    }
    return screen;
}

describe("Home in day 0 without a channel", () => {
    it("is the setup card and nothing else", async () => {
        const screen = await renderHome();
        try {
            const surfaces = homeSurfaces(screen.container);
            expect(surfaces).toHaveLength(1);
            expect(surfaces[0].getAttribute("aria-labelledby")).toBe("initial-setup-card-title");
            expect(notices(screen.container)).toEqual([]);

            const text = screen.container.textContent ?? "";
            for (const gone of ["Retoma la configuración", "Actividad reciente", "Uso de IA", "Uso de modelos",
                "router", "Tier", "Salud de agentes"]) {
                expect(text).not.toContain(gone);
            }
            // Not merely hidden with a class: the KPI grid is not in the page at all.
            expect(text).not.toContain("Mensajes Procesados");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("keeps the promise of the WhatsApp question on the card's channel step", async () => {
        const screen = await renderHome();
        try {
            const card = homeSurfaces(screen.container)[0];
            expect(card.textContent).toContain("Dejaste anotado que tu número está con otro proveedor.");
            const resume = Array.from(card.querySelectorAll("a")).find((a) => a.textContent?.includes("Continuar donde quedaste"));
            expect(resume?.getAttribute("href")).toBe("/admin/channels/whatsapp");
            // The re-entry the "Retomar" banner used to carry sits in the card's
            // next step, which is where "retomar la configuración" starts.
            const next = card.querySelector("#tour-target-setup-next");
            expect(next?.contains(resume!)).toBe(true);
            // One way back, not two.
            expect(Array.from(card.querySelectorAll("a")).filter((a) => a.textContent?.includes("Continuar donde quedaste"))).toHaveLength(1);
        } finally { screen.unmount(); }
    });

    it("says the other reason in her words too", async () => {
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus({
            whatsappTriage: { answerId: "not_at_hand", recordedAt: RECORDED },
        }) as any);
        const screen = await renderHome();
        try {
            expect(screen.container.textContent).toContain("Dejaste anotado que no tenías el número a mano.");
        } finally { screen.unmount(); }
    });

    it("resumes a plain 'Conectar después' on the step's own channel, the one the wizard saved first", async () => {
        // Not the WhatsApp screen the triage answers go back to: she never
        // answered that question, and the wizard offered Instagram first.
        jest.mocked(api.getAgentAssessment).mockResolvedValue(assessment("fail", "fail", "instagram") as any);
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus({ whatsappTriage: null }) as any);
        const screen = await renderHome();
        try {
            const card = homeSurfaces(screen.container)[0];
            expect(card.textContent).toContain("Lo dejaste para después.");
            const resume = Array.from(card.querySelectorAll("a")).find((a) => a.textContent?.includes("Continuar donde quedaste"));
            expect(resume?.getAttribute("href")).toBe("/admin/channels/instagram");
        } finally { screen.unmount(); }
    });

    it("names the channel the server's step carries — the one 'Listo' promised to remind her of", async () => {
        // F2: the server says Instagram (the wizard saved it first). This
        // card used to rename only a WhatsApp step, so it read "Conecta tu
        // primer canal" and sent her to the channel list. No recipe here: the
        // server's word needs none.
        jest.mocked(api.getAgentAssessment).mockResolvedValue(assessment("fail", "fail", "instagram") as any);
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus({ whatsappTriage: null }) as any);
        const screen = await renderHome();
        const started: GuidedTourStartDetail[] = [];
        const listen = (event: Event) => started.push((event as CustomEvent<GuidedTourStartDetail>).detail);
        window.addEventListener(GUIDED_TOUR_START_EVENT, listen);
        try {
            const step = channelStep(screen.container);
            expect(step.textContent).toContain("Conecta Instagram");
            expect(step.textContent).not.toContain("WhatsApp");
            expect(step.querySelector("a")?.getAttribute("href")).toBe("/admin/channels/instagram");

            // "Mostrarme dónde" walks to Instagram's card, not WhatsApp's screen.
            const showMe = Array.from(step.querySelectorAll("button")).find((b) => b.textContent?.includes("Mostrarme dónde"));
            await interact(() => showMe!.click());
            expect(started).toEqual([expect.objectContaining({ tourId: "connect_channel", channelType: "instagram" })]);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            window.removeEventListener(GUIDED_TOUR_START_EVENT, listen);
            screen.unmount();
        }
    });

    it("says the channel the wizard saved, not Home's own reading of the recipe", async () => {
        // F4: she chose WhatsApp in the wizard and it saved WhatsApp first;
        // the recipe still leads with Instagram. Two readings, one answer: the
        // server's, which "Salud de agentes" and Assist show too.
        answerRecipeWith(recipe("instagram", "whatsapp"));
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus({ whatsappTriage: null }) as any);
        const screen = await renderHome();
        try {
            const step = channelStep(screen.container);
            expect(step.textContent).toContain("Conecta WhatsApp");
            expect(step.textContent).not.toContain("Instagram");
            expect(step.querySelector("a")?.getAttribute("href")).toBe("/admin/channels/whatsapp");
        } finally { screen.unmount(); }
    });

    it("falls back to the wizard's own reading only when the server named no channel — plan included", async () => {
        jest.mocked(api.getAgentAssessment).mockResolvedValue(assessment("fail", "fail", null) as any);
        answerRecipeWith(recipe("instagram", "messenger"));
        mockPlanFeatures = { channels: ["whatsapp", "messenger"] };
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus({ whatsappTriage: null }) as any);
        const screen = await renderHome();
        try {
            expect(api.fetch).toHaveBeenCalledWith("/verticals/tenant-1/recipe?lang=es");
            const step = channelStep(screen.container);
            expect(step.textContent).toContain("Conecta Messenger");
            expect(step.textContent).not.toContain("Instagram");
            expect(step.querySelector("a")?.getAttribute("href")).toBe("/admin/channels/messenger");
        } finally { screen.unmount(); }
    });

    it("says WhatsApp when her reason is about WhatsApp, whatever the recipe prefers", async () => {
        // She answered the WhatsApp question; the reason and "Continuar donde
        // quedaste" both lead to that screen, so the step cannot say Instagram.
        answerRecipeWith(recipe("instagram"));
        const screen = await renderHome();
        try {
            const step = channelStep(screen.container);
            expect(step.textContent).toContain("Conecta WhatsApp");
            expect(step.textContent).toContain("Dejaste anotado que tu número está con otro proveedor.");
            expect(step.textContent).not.toContain("Instagram");
            expect(step.querySelector("a")?.getAttribute("href")).toBe("/admin/channels/whatsapp");
        } finally { screen.unmount(); }
    });

    it("does not put a WhatsApp answer under another channel's step", async () => {
        // She answered the WhatsApp question on its own screen, after the
        // wizard had saved Instagram first. The step names the server's
        // channel; her reason — and a "Continuar donde quedaste" that opens
        // WhatsApp — would make one step say two channels. The answer stays on
        // the WhatsApp screen, where it was given.
        jest.mocked(api.getAgentAssessment).mockResolvedValue(assessment("fail", "fail", "instagram") as any);
        const screen = await renderHome();
        try {
            const step = channelStep(screen.container);
            expect(step.textContent).toContain("Conecta Instagram");
            expect(step.textContent).not.toContain("Dejaste anotado");
            expect(step.textContent).not.toContain("WhatsApp");
            expect(step.querySelector("a")?.getAttribute("href")).toBe("/admin/channels/instagram");
        } finally { screen.unmount(); }
    });

    it("keeps the wizard's default when neither the server nor a recipe names a channel: WhatsApp first", async () => {
        jest.mocked(api.getAgentAssessment).mockResolvedValue(assessment("fail", "fail", null) as any);
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus({ whatsappTriage: null }) as any);
        const screen = await renderHome();
        try {
            const step = channelStep(screen.container);
            expect(step.textContent).toContain("Conecta WhatsApp");
            expect(step.querySelector("a")?.getAttribute("href")).toBe("/admin/channels/whatsapp");
        } finally { screen.unmount(); }
    });

    it("never tells the supervisor she deferred something", async () => {
        mockRole = "tenant_supervisor";
        mockUser = owner({ role: "tenant_supervisor" });
        // Today a supervisor may open none of the four essentials, so the card
        // would not even be drawn; open the routes so the channel step is on
        // screen and the rule itself is what is being checked.
        mockOpenEveryRoute = true;
        const screen = await renderHome();
        try {
            const card = screen.container.querySelector('[aria-labelledby="initial-setup-card-title"]');
            expect(card).not.toBeNull();
            expect(card!.textContent).toContain("Continuar");
            expect(card!.textContent).not.toContain("Dejaste anotado");
            expect(card!.textContent).not.toContain("Continuar donde quedaste");
            // Nor does Home read the recipe for her: the channel step is the admin's.
            expect(card!.textContent).toContain("Conecta tu primer canal");
            expect(api.fetch).not.toHaveBeenCalledWith(expect.stringContaining("/recipe"));
        } finally { screen.unmount(); }
    });

    it("does not leave a blank page when the card has no step this person may open", async () => {
        // A supervisor cannot open Canales, Equipo or the business settings, so
        // the card filters every pending step out and draws nothing. Hiding the
        // rest of Home too left a greeting over an empty page.
        mockRole = "tenant_supervisor";
        mockUser = owner({ role: "tenant_supervisor" });
        const screen = await renderHome();
        try {
            expect(screen.container.querySelector('[aria-labelledby="initial-setup-card-title"]')).toBeNull();
            expect(homeSurfaces(screen.container).length).toBeGreaterThan(0);
            expect(screen.container.textContent).toContain("Comprueba la primera respuesta");
            expect(screen.container.textContent).toContain("Abrir Inbox");
        } finally { screen.unmount(); }
    });

    it("adds only a restriction the account is really under", async () => {
        const screen = await renderHome(SOFT_LOCK);
        try {
            expect(homeSurfaces(screen.container)).toHaveLength(1);
            const alerts = notices(screen.container);
            expect(alerts).toHaveLength(1);
            expect(alerts[0].textContent).toContain("Tu cuenta está en modo solo lectura");
        } finally { screen.unmount(); }
    });
});

describe("Home in day 0 with a channel", () => {
    beforeEach(() => {
        mockUser = owner({ stage: "channel_connected" });
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus({
            hasAnyChannel: true, connectedChannelTypes: ["whatsapp"], onboardingStage: "channel_connected",
        }) as any);
        jest.mocked(api.getAgentAssessment).mockResolvedValue(assessment("pass", "fail") as any);
    });

    it("stays the card alone while it has something left — no agent health beside it", async () => {
        const screen = await renderHome();
        try {
            const surfaces = homeSurfaces(screen.container);
            expect(surfaces).toHaveLength(1);
            expect(surfaces[0].getAttribute("aria-labelledby")).toBe("initial-setup-card-title");
            expect(screen.container.textContent).not.toContain("Dejaste anotado");
            // "Retomar la configuración" starts on the next step, and without a
            // deferral that step is still on screen (F3).
            expect(surfaces[0].querySelector("#tour-target-setup-next")).not.toBeNull();
            // A first channel is only asked for while there is none.
            expect(api.fetch).not.toHaveBeenCalledWith(expect.stringContaining("/recipe"));
        } finally { screen.unmount(); }
    });

    it("keeps the first-reply proof as the only guide after setup is complete", async () => {
        jest.mocked(api.getAgentAssessment).mockResolvedValue(assessment("pass", "pass") as any);
        const screen = await renderHome();
        try {
            const text = screen.container.textContent ?? "";
            expect(text).toContain("Comprueba la primera respuesta");
            expect(text).toContain("WhatsApp");
            expect(text).not.toContain("Actividad reciente");
            expect(text).not.toContain("Uso de IA hoy");
        } finally { screen.unmount(); }
    });
});

describe("Home when the setup status cannot be read", () => {
    it("falls back to the ordinary Home instead of a blank page", async () => {
        jest.mocked(api.getSetupStatus).mockResolvedValue({ success: false } as any);
        const screen = await renderHome();
        try {
            expect(screen.container.textContent).toContain("Actividad reciente");
        } finally { screen.unmount(); }
    });
});

describe("Home after the first real reply", () => {
    beforeEach(() => {
        mockUser = owner({ stage: "channel_connected", firstReplyAt: new Date().toISOString() });
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus({
            hasAnyChannel: true, connectedChannelTypes: ["whatsapp"], onboardingStage: "live", whatsappTriage: null,
        }) as any);
        jest.mocked(api.getAgentAssessment).mockResolvedValue(assessment("pass", "fail") as any);
    });

    it("brings the board back, with AI usage in plain words", async () => {
        const screen = await renderHome();
        try {
            const text = screen.container.textContent ?? "";
            expect(text).toContain("Salud de agentes");
            expect(text).toContain("Actividad reciente");
            expect(text).toContain("Uso de IA hoy");
            expect(text).toContain("12 usos · 100%");
            expect(text).toContain("Tu agente usa modelos más económicos para las conversaciones simples");
            // The old card: a "(Tier N)" that was only the row's position, and a
            // 42% nobody measured.
            expect(text).not.toMatch(/Tier|router|42|req\b/);
            // Still no second guide for the setup: the card is the only one.
            expect(text).not.toContain("Retoma la configuración");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("leaves AI usage out when there is nothing to count, instead of saying the agent did not use it", async () => {
        // F9: its counts come from the `model_used` analytics event, which no
        // turn emits today, so the card always said "Tu agente todavía no usó
        // la IA hoy" — on accounts whose agent answered all day.
        jest.mocked(api.getOverviewStats).mockResolvedValue({
            success: true, data: { recentActivity: [], modelUsage: [] },
        } as any);
        const screen = await renderHome();
        try {
            const text = screen.container.textContent ?? "";
            expect(text).not.toContain("Uso de IA hoy");
            expect(text).not.toMatch(/todavía no usó la IA/);
            // The activity card takes the whole row instead of half of it.
            const activity = Array.from(screen.container.querySelectorAll("h3, div"))
                .find((node) => node.textContent?.trim() === "Actividad reciente");
            expect(activity).toBeDefined();
            let grid: Element | null = activity!;
            while (grid && !(grid as HTMLElement).className?.toString().includes("grid-cols-1")) grid = grid.parentElement;
            expect(grid?.className).not.toContain("lg:grid-cols-2");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });
});
