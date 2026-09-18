import { act } from "react";
import { renderScreen, findAccessibilityViolations } from "@/test/a11y";
import { api } from "@/lib/api";
import SetupWizardPage from "./page";

/**
 * One guide per screen, and every channel treated honestly.
 *
 * The 14-sep recording: an owner under six guidance surfaces at once, a step
 * titled "Conecta WhatsApp" for a business whose customers write on Instagram,
 * an Instagram connection that left the WhatsApp question on screen and never
 * said "Instagram conectado", and a last screen that listed the same three
 * chores for everybody. These pin the wizard's side of each.
 */

type MockAuth = { user: Record<string, unknown>; planFeatures: Record<string, unknown> | null };
let mockAuth: MockAuth;

jest.mock("@/contexts/AuthContext", () => ({
    useAuth: () => mockAuth,
}));
jest.mock("@/lib/api", () => ({
    api: {
        getSetupStatus: jest.fn(),
        getPersonaTemplates: jest.fn(),
        getAgentConfiguration: jest.fn(),
        applySetupTemplate: jest.fn(),
        saveAgentDraft: jest.fn(),
        fetch: jest.fn(),
        getWhatsappFundingReadiness: jest.fn(),
    },
}));

// Hands the page what the real panel hands it when the owner answers the
// WhatsApp question with a reason to leave it for later.
jest.mock("@/app/admin/channels/whatsapp/WhatsAppConnectPanel", () => ({
    __esModule: true,
    default: ({ onPostponed }: { onPostponed?: (reason: "other_provider" | "not_at_hand") => void }) => (
        <div data-testid="whatsapp-panel">
            Panel de WhatsApp
            <button type="button" onClick={() => onPostponed?.("not_at_hand")}>Simular no lo tengo a mano</button>
        </div>
    ),
}));
jest.mock("@/app/admin/channels/whatsapp/WhatsAppConnectedState", () => ({
    __esModule: true,
    default: () => <div data-testid="connected-state" />,
}));
// The list has its own spec; here it only has to report what it was handed,
// and hand back a connection the way the real one does.
jest.mock("./_components/SecondaryChannels", () => ({
    __esModule: true,
    default: ({ channels, recommended, planChannels, emailBlocked, onConnected }: {
        channels: string[];
        recommended?: string | null;
        planChannels: string[] | null;
        emailBlocked?: boolean;
        onConnected?: (details: { channel: string; label: string | null; href: string | null }) => void;
    }) => (
        <div
            data-testid="secondary"
            data-order={channels.join(",")}
            data-recommended={recommended ?? ""}
            data-plan={JSON.stringify(planChannels)}
            data-email-blocked={String(Boolean(emailBlocked))}
        >
            <button type="button" onClick={() => onConnected?.({ channel: "instagram", label: null, href: null })}>
                Simular Instagram
            </button>
        </div>
    ),
}));
jest.mock("./_components/AgentTestChat", () => ({ __esModule: true, default: () => null }));
jest.mock("./_components/DemoLinkCard", () => ({ __esModule: true, default: () => <p>Enlace del agente</p> }));
jest.mock("@/components/AnimatedLogo", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/ui/help-panel", () => ({
    HelpPanel: ({ title }: { title: string }) => <div data-testid="help-panel">{title}</div>,
}));

const CREATED = new Date(Date.now() - 60 * 60 * 1000).toISOString();

function user(overrides: Record<string, unknown> = {}) {
    return {
        id: "user-1", role: "tenant_admin", tenantId: "tenant-1", tenantName: "Café Luna",
        email: "ana@cafe.co", emailVerified: true,
        onboardingStage: "agent_reviewed", firstReplyAt: null, tenantCreatedAt: CREATED,
        ...overrides,
    };
}

function setupStatus(overrides: Record<string, unknown> = {}) {
    return {
        success: true,
        data: {
            hasAnyChannel: false,
            connectedChannelTypes: [],
            onboardingStage: "agent_reviewed",
            channelConnectSkippedAt: null,
            firstReplyAt: null,
            tenantCreatedAt: CREATED,
            defaultAgent: { id: "agent-1", name: "Sofía", greeting: "Hola, soy Sofía." },
            demoLink: { widgetId: "widget-1", path: "/w/widget-1", agentName: "Sofía" },
            ...overrides,
        },
    };
}

const workspace = {
    agentId: "agent-1",
    directCommit: true,
    evaluationRevisionId: "revision-1",
    draft: null,
    operational: {
        version: 3,
        body: { name: "Sofía", configJson: { persona: { name: "Sofía", greeting: "Hola, soy Sofía." } } },
    },
};

const BEAUTY_RECIPE = {
    success: true,
    data: {
        industry: "moda_belleza",
        source: "registry",
        recipe: {
            recommendedChannels: [
                { channel: "instagram", why: { es: "En belleza casi todo empieza por Instagram." } },
                { channel: "whatsapp", why: { es: "WhatsApp es donde se cierra la cita." } },
            ],
        },
    },
};

/** Answers the recipe (when given) and refuses anything else, like an absent endpoint. */
function reads(recipe: unknown = null): void {
    jest.mocked(api.fetch).mockImplementation(async (endpoint: string) => {
        if (endpoint.startsWith("/verticals/tenant-1/recipe")) {
            if (recipe) return recipe;
            throw new Error("HTTP error! status: 404");
        }
        throw new Error(`unexpected ${endpoint}`);
    });
}

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
    const found = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
    if (!found) throw new Error(`no button named ${name}`);
    return found as HTMLButtonElement;
}

function hasButton(container: HTMLElement, name: string): boolean {
    return [...container.querySelectorAll("button")].some((b) => b.textContent?.trim() === name);
}

async function click(target: HTMLElement): Promise<void> {
    await act(async () => { target.click(); });
    await settle();
}

function byTestId(container: HTMLElement, id: string): HTMLElement | null {
    return container.querySelector(`[data-testid="${id}"]`);
}

/** True when `first` comes before `second` in the document. */
function precedes(first: Element | null, second: Element | null): boolean {
    if (!first || !second) return false;
    return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

async function openConnectStep(container: HTMLElement): Promise<void> {
    await settle();
    await click(button(container, "Siguiente"));
}

describe("the setup wizard: one guide, and every channel treated honestly", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        mockAuth = { user: user(), planFeatures: null };
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus() as any);
        jest.mocked(api.getPersonaTemplates).mockResolvedValue({ success: true, data: [] } as any);
        jest.mocked(api.getAgentConfiguration).mockResolvedValue({ success: true, data: workspace } as any);
        jest.mocked(api.applySetupTemplate).mockResolvedValue({ success: true } as any);
        reads();
    });

    describe("day 0: the step is the only guide", () => {
        it("draws no help strip, no link to the expert editor and no tour", async () => {
            const screen = await renderScreen(<SetupWizardPage />);
            try {
                await settle();
                expect(byTestId(screen.container, "help-panel")).toBeNull();
                expect(screen.container.textContent).not.toContain("Cambiar plantilla");

                await click(button(screen.container, "Siguiente"));
                expect(hasButton(screen.container, "Mostrarme dónde")).toBe(false);
                // The way out that is not a second guide stays.
                expect(hasButton(screen.container, "Conectar después")).toBe(true);
                expect(await findAccessibilityViolations(screen.container)).toEqual([]);
            } finally { screen.unmount(); }
        });

        it("after the first real reply the wizard is a tool again and gets them back", async () => {
            jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus({
                onboardingStage: "completed", firstReplyAt: "2026-09-17T12:00:00.000Z",
            }) as any);
            const screen = await renderScreen(<SetupWizardPage />);
            try {
                await settle();
                expect(byTestId(screen.container, "help-panel")).not.toBeNull();
                expect(screen.container.textContent).toContain("Cambiar plantilla");
                await click(button(screen.container, "Siguiente"));
                expect(hasButton(screen.container, "Mostrarme dónde")).toBe(true);
            } finally { screen.unmount(); }
        });

        it("a first reply the session already knows about is never undone by a stale read", async () => {
            mockAuth = { user: user({ firstReplyAt: "2026-09-17T12:00:00.000Z" }), planFeatures: null };
            const screen = await renderScreen(<SetupWizardPage />);
            try {
                await settle();
                expect(byTestId(screen.container, "help-panel")).not.toBeNull();
            } finally { screen.unmount(); }
        });
    });

    describe("the recipe orders the channels", () => {
        it("without a recipe, WhatsApp leads and nothing is recommended", async () => {
            const screen = await renderScreen(<SetupWizardPage />);
            try {
                await openConnectStep(screen.container);
                expect(screen.container.querySelector("h2")?.textContent).toBe("¿Por dónde te escriben tus clientes?");
                expect(screen.container.querySelector("[data-recommended-channel]")).toBeNull();
                expect(precedes(byTestId(screen.container, "whatsapp-panel"), byTestId(screen.container, "secondary"))).toBe(true);
                expect(byTestId(screen.container, "secondary")?.getAttribute("data-order")).toBe("instagram,messenger,telegram");
                expect(api.fetch).toHaveBeenCalledWith("/verticals/tenant-1/recipe?lang=es");
            } finally { screen.unmount(); }
        });

        it("a beauty salon starts on Instagram, with the recipe's reason, and WhatsApp comes after", async () => {
            reads(BEAUTY_RECIPE);
            const screen = await renderScreen(<SetupWizardPage />);
            try {
                await openConnectStep(screen.container);
                const hint = screen.container.querySelector("[data-recommended-channel]");
                expect(hint?.getAttribute("data-recommended-channel")).toBe("instagram");
                expect(hint?.textContent).toContain("Para tu negocio, empieza por Instagram");
                expect(hint?.textContent).toContain("En belleza casi todo empieza por Instagram.");
                expect(precedes(byTestId(screen.container, "secondary"), byTestId(screen.container, "whatsapp-panel"))).toBe(true);
                expect(screen.container.textContent).toContain("O conecta WhatsApp");
                expect(byTestId(screen.container, "secondary")?.getAttribute("data-recommended")).toBe("instagram");
                expect(await findAccessibilityViolations(screen.container)).toEqual([]);
            } finally { screen.unmount(); }
        });

        it("on the WhatsApp-only trial, says the recommendation is outside the plan and leads with what she can connect", async () => {
            reads(BEAUTY_RECIPE);
            mockAuth = { user: user(), planFeatures: { channels: ["whatsapp"], widget: false } };
            const screen = await renderScreen(<SetupWizardPage />);
            try {
                await openConnectStep(screen.container);
                const hint = screen.container.querySelector("[data-recommended-channel]");
                expect(hint?.textContent).toContain("A tu negocio le conviene Instagram");
                expect(hint?.textContent).toContain("No está incluido en tu plan: mientras tanto, empieza por WhatsApp.");
                expect(precedes(byTestId(screen.container, "whatsapp-panel"), byTestId(screen.container, "secondary"))).toBe(true);
                const secondary = byTestId(screen.container, "secondary");
                // The list gets the plan, so it can show the lock before any window.
                expect(secondary?.getAttribute("data-plan")).toBe(JSON.stringify(["whatsapp"]));
                expect(secondary?.getAttribute("data-recommended")).toBe("");
            } finally { screen.unmount(); }
        });

        it("hands the email state to the list, so it can say it before a window opens", async () => {
            mockAuth = { user: user({ emailVerified: false }), planFeatures: null };
            const screen = await renderScreen(<SetupWizardPage />);
            try {
                await openConnectStep(screen.container);
                expect(byTestId(screen.container, "secondary")?.getAttribute("data-email-blocked")).toBe("true");
            } finally { screen.unmount(); }
        });
    });

    describe("a channel that is not WhatsApp gets its own victory", () => {
        it("connected here: 'Instagram conectado' replaces the WhatsApp question, and 'Listo' names it", async () => {
            const screen = await renderScreen(<SetupWizardPage />);
            try {
                await openConnectStep(screen.container);
                await click(button(screen.container, "Simular Instagram"));

                const success = screen.container.querySelector("[data-connected-channel]");
                expect(success?.getAttribute("data-connected-channel")).toBe("instagram");
                expect(success?.textContent).toContain("Instagram conectado");
                expect(byTestId(screen.container, "whatsapp-panel")).toBeNull();
                expect(byTestId(screen.container, "secondary")).toBeNull();
                expect(await findAccessibilityViolations(screen.container)).toEqual([]);

                await click(button(screen.container, "Continuar"));
                expect(screen.container.querySelector("h2")?.textContent).toBe("Configuración inicial guardada");
                const text = screen.container.textContent ?? "";
                expect(text).toContain("Tu agente ya responde por el canal conectado.");
                expect(screen.container.querySelector('[data-essential="channel"]')?.textContent).toContain("Instagram conectado");
                // Not a "conectar después": a channel is connected.
                const deferrals = jest.mocked(api.applySetupTemplate).mock.calls
                    .filter(([, payload]) => (payload as Record<string, unknown>).stage === "channel_deferred");
                expect(deferrals).toEqual([]);
            } finally { screen.unmount(); }
        });

        it("connected before the wizard opened: the step shows it instead of the WhatsApp question", async () => {
            jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus({
                hasAnyChannel: true, connectedChannelTypes: ["instagram"], onboardingStage: "channel_connected",
            }) as any);
            const screen = await renderScreen(<SetupWizardPage />);
            try {
                await openConnectStep(screen.container);
                expect(screen.container.querySelector("[data-connected-channel]")?.textContent).toContain("Instagram conectado");
                expect(byTestId(screen.container, "whatsapp-panel")).toBeNull();
            } finally { screen.unmount(); }
        });
    });

    describe("the order she was offered is the order the server keeps", () => {
        /**
         * "Salud de agentes" and Assist pick the first channel to connect from
         * `settings.setupWizardChannels`, which stayed empty because no save
         * carried it — so they said WhatsApp while this step and Inicio led a
         * beauty salon to Instagram. Every progress save now carries the list
         * the step renders: the recipe's order, only what the plan includes.
         */
        const progressSaves = () => jest.mocked(api.applySetupTemplate).mock.calls
            .map(([, payload]) => payload as Record<string, unknown>)
            .filter((payload) => payload.stageOnly === true);
        /** A plan whose channels were read: all four. */
        const EVERY_CHANNEL = { channels: ["whatsapp", "instagram", "messenger", "telegram"], widget: false };

        beforeEach(() => {
            mockAuth = { user: user(), planFeatures: EVERY_CHANNEL };
        });

        it("'Conectar después' carries the recipe's order, Instagram first, with no request of its own", async () => {
            reads(BEAUTY_RECIPE);
            const screen = await renderScreen(<SetupWizardPage />);
            try {
                await openConnectStep(screen.container);
                const before = jest.mocked(api.applySetupTemplate).mock.calls.length;
                await click(button(screen.container, "Conectar después"));
                const saves = progressSaves();
                const deferral = saves.find((payload) => payload.stage === "channel_deferred");
                expect(deferral?.selectedChannels).toEqual(["instagram", "whatsapp", "messenger", "telegram"]);
                // The same save as before, not a second one for the list.
                expect(jest.mocked(api.applySetupTemplate).mock.calls.length - before).toBe(1);
            } finally { screen.unmount(); }
        });

        it("finishing carries it too", async () => {
            reads(BEAUTY_RECIPE);
            const screen = await renderScreen(<SetupWizardPage />);
            try {
                await settle();
                await click(button(screen.container, "3"));
                await click(button(screen.container, "Ir al panel"));
                const completion = progressSaves().find((payload) => payload.markCompleted === true);
                expect(completion?.selectedChannels).toEqual(["instagram", "whatsapp", "messenger", "telegram"]);
            } finally { screen.unmount(); }
        });

        it("leaves out what the plan does not include, so the first one is the channel the step leads with", async () => {
            reads(BEAUTY_RECIPE);
            mockAuth = { user: user(), planFeatures: { channels: ["whatsapp"], widget: false } };
            const screen = await renderScreen(<SetupWizardPage />);
            try {
                await openConnectStep(screen.container);
                await click(button(screen.container, "Conectar después"));
                const deferral = progressSaves().find((payload) => payload.stage === "channel_deferred");
                expect(deferral?.selectedChannels).toEqual(["whatsapp"]);
            } finally { screen.unmount(); }
        });

        it("without a recipe, keeps the default order the step shows", async () => {
            const screen = await renderScreen(<SetupWizardPage />);
            try {
                await openConnectStep(screen.container);
                await click(button(screen.container, "Conectar después"));
                const deferral = progressSaves().find((payload) => payload.stage === "channel_deferred");
                expect(deferral?.selectedChannels).toEqual(["whatsapp", "instagram", "messenger", "telegram"]);
            } finally { screen.unmount(); }
        });

        it("with the plan not read, saves no order at all — never the full recipe as if everything were included", async () => {
            // F8: `planFeatures` null (a read pending or failed) excludes
            // nothing on screen, but the recipe's Instagram saved first on a
            // WhatsApp-only trial made every other screen ask for a channel
            // the plan does not include.
            reads(BEAUTY_RECIPE);
            mockAuth = { user: user(), planFeatures: null };
            const screen = await renderScreen(<SetupWizardPage />);
            try {
                await openConnectStep(screen.container);
                await click(button(screen.container, "Conectar después"));
                await click(button(screen.container, "Ir al panel"));
                const saves = progressSaves();
                expect(saves.map((payload) => payload.stage)).toEqual(expect.arrayContaining(["channel_deferred", "completed"]));
                for (const payload of saves) expect(payload).not.toHaveProperty("selectedChannels");
            } finally { screen.unmount(); }
        });

        describe("she chose WhatsApp and left it for later, on a business whose recipe leads with Instagram", () => {
            /**
             * F7: answering the WhatsApp question with "no lo tengo a mano"
             * postpones WHATSAPP. "Listo", the server's setup step and Inicio's
             * reminder (which repeats that answer) all have to say WhatsApp,
             * and the server says what this page saves first.
             */
            it("answered here: the saved order puts WhatsApp first, and 'Listo' names WhatsApp", async () => {
                reads(BEAUTY_RECIPE);
                const screen = await renderScreen(<SetupWizardPage />);
                try {
                    await openConnectStep(screen.container);
                    await click(button(screen.container, "Simular no lo tengo a mano"));

                    expect(screen.container.querySelector("h2")?.textContent).toBe("Configuración inicial guardada");
                    const deferral = progressSaves().find((payload) => payload.stage === "channel_deferred");
                    expect(deferral?.selectedChannels).toEqual(["whatsapp", "instagram", "messenger", "telegram"]);
                    const text = screen.container.textContent ?? "";
                    expect(text).toContain("WhatsApp queda pendiente");
                    expect(text).not.toContain("Instagram queda pendiente");
                    expect(screen.container.querySelector('[data-essential="channel"]')?.textContent).toContain("Conectar WhatsApp");

                    // Finishing keeps saying it.
                    await click(button(screen.container, "Ir al panel"));
                    const completion = progressSaves().find((payload) => payload.markCompleted === true);
                    expect((completion?.selectedChannels as string[] | undefined)?.[0]).toBe("whatsapp");
                } finally { screen.unmount(); }
            });

            it("answered before, on the WhatsApp screen: the account's answer counts the same", async () => {
                reads(BEAUTY_RECIPE);
                jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus({
                    whatsappTriage: { answerId: "other_provider", recordedAt: "2026-09-17T15:00:00.000Z" },
                }) as any);
                const screen = await renderScreen(<SetupWizardPage />);
                try {
                    await settle();
                    await click(button(screen.container, "3"));
                    const deferral = progressSaves().find((payload) => payload.stage === "channel_deferred");
                    expect((deferral?.selectedChannels as string[] | undefined)?.[0]).toBe("whatsapp");
                    expect(screen.container.textContent).toContain("WhatsApp queda pendiente");
                } finally { screen.unmount(); }
            });

            it("with the plan not read, saves WhatsApp alone — the one channel no plan leaves out", async () => {
                reads(BEAUTY_RECIPE);
                mockAuth = { user: user(), planFeatures: null };
                const screen = await renderScreen(<SetupWizardPage />);
                try {
                    await openConnectStep(screen.container);
                    await click(button(screen.container, "Simular no lo tengo a mano"));
                    const deferral = progressSaves().find((payload) => payload.stage === "channel_deferred");
                    expect(deferral?.selectedChannels).toEqual(["whatsapp"]);
                } finally { screen.unmount(); }
            });
        });
    });

    describe("'Listo' lists the real state", () => {
        it("says done what is done and pending what is pending", async () => {
            jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus({ hasKnowledge: true, hasTeam: false }) as any);
            const screen = await renderScreen(<SetupWizardPage />);
            try {
                await settle();
                await click(button(screen.container, "3"));
                const knowledge = screen.container.querySelector('[data-essential="knowledge"]');
                const team = screen.container.querySelector('[data-essential="team"]');
                expect(knowledge?.getAttribute("data-done")).toBe("true");
                expect(knowledge?.textContent).toContain("Hecho");
                expect(knowledge?.textContent).toContain("Tu agente ya tiene de dónde responder");
                expect(knowledge?.textContent).not.toContain("Cargar lo que tu agente debe saber");
                expect(team?.getAttribute("data-done")).toBe("false");
                expect(team?.textContent).toContain("Pendiente");
                expect(team?.textContent).toContain("Invitar a una persona");
                expect(await findAccessibilityViolations(screen.container)).toEqual([]);
            } finally { screen.unmount(); }
        });

        it("leaves out what nobody could count", async () => {
            // setup-status omits a flag whose count failed.
            jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus({ hasTeam: true }) as any);
            const screen = await renderScreen(<SetupWizardPage />);
            try {
                await settle();
                await click(button(screen.container, "3"));
                expect(screen.container.querySelector('[data-essential="knowledge"]')).toBeNull();
                expect(screen.container.querySelector('[data-essential="team"]')?.getAttribute("data-done")).toBe("true");
            } finally { screen.unmount(); }
        });

        it("the pending channel is the one this business should start with", async () => {
            reads(BEAUTY_RECIPE);
            const screen = await renderScreen(<SetupWizardPage />);
            try {
                await settle();
                await click(button(screen.container, "3"));
                const text = screen.container.textContent ?? "";
                expect(text).toContain("Instagram queda pendiente");
                expect(screen.container.querySelector('[data-essential="channel"]')?.textContent).toContain("Conectar Instagram");
                expect(text).not.toContain("Conectar WhatsApp");
            } finally { screen.unmount(); }
        });
    });
});
