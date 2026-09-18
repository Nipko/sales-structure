import { act } from "react";
import { renderScreen, findAccessibilityViolations } from "@/test/a11y";
import { api } from "@/lib/api";
import { BILLING_READINESS_ENDPOINT } from "@/app/admin/channels/whatsapp/billing-time-zone";
import type { ConnectedReadiness, WhatsAppConnectedPayload } from "@/app/admin/channels/whatsapp/connected-readiness";
import SetupWizardPage from "./page";

/**
 * "Listo" only after the channel question has an answer, and "Listo" says
 * what is true.
 *
 * The 14-sep recording ended like this: "Siguiente" on the connect step
 * skipped WhatsApp without recording anything, and the last screen said "Tu
 * agente ya responde por el canal conectado" with no channel connected — no
 * reminder on Home, and a closing sentence claiming the opposite. Here the
 * skip is a recorded "conectar después", and the last screen says the agent
 * answers through its link while the channel is pending.
 */

jest.mock("@/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: "user-1", role: "tenant_admin", tenantId: "tenant-1", tenantName: "Café Luna" } }),
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

/** What the connected state hands over on "Continuar" in the next test. */
let mockAck: ConnectedReadiness = { headline: "ready", answering: true, pending: [] };
/** What the signup answers when "Simular alta" is pressed. */
let mockSignup: WhatsAppConnectedPayload = { displayPhoneNumber: "+57 300 000 0000", phoneNumberId: "111" };

// The children have their own specs; here they only need to exist — and to
// hand the page what the real ones hand it: the number that was connected, and
// on "Continuar" whether the agent can answer yet.
jest.mock("@/app/admin/channels/whatsapp/WhatsAppConnectPanel", () => ({
    __esModule: true,
    default: ({ onConnected, onAcknowledged }: {
        onConnected?: (data: WhatsAppConnectedPayload) => void;
        onAcknowledged?: (readiness: ConnectedReadiness) => void;
    }) => (
        <div data-testid="whatsapp-panel">
            <button type="button" onClick={() => onConnected?.(mockSignup)}>
                Simular alta
            </button>
            <button type="button" onClick={() => onAcknowledged?.(mockAck)}>Continuar del alta</button>
        </div>
    ),
}));
jest.mock("@/app/admin/channels/whatsapp/WhatsAppConnectedState", () => ({
    __esModule: true,
    default: ({ connected, onAcknowledged }: {
        connected: WhatsAppConnectedPayload;
        onAcknowledged?: (readiness: ConnectedReadiness) => void;
    }) => (
        <div data-testid="connected-state" data-number={connected.phoneNumberId ?? ""} data-phone={connected.displayPhoneNumber ?? ""}>
            <button type="button" onClick={() => onAcknowledged?.(mockAck)}>Continuar del estado</button>
        </div>
    ),
}));
jest.mock("./_components/SecondaryChannels", () => ({ __esModule: true, default: () => null }));
jest.mock("./_components/AgentTestChat", () => ({ __esModule: true, default: () => null }));
jest.mock("./_components/DemoLinkCard", () => ({
    __esModule: true,
    default: ({ agentName }: { agentName: string }) => <p>Enlace de {agentName}</p>,
}));
jest.mock("@/components/AnimatedLogo", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/ui/help-panel", () => ({ HelpPanel: () => null }));

const DRAFT_KEY = "parallly:setupwizard:tenant-1";

function setupStatus(overrides: Record<string, unknown> = {}) {
    return {
        success: true,
        data: {
            hasAnyChannel: false,
            connectedChannelTypes: [],
            onboardingStage: "agent_reviewed",
            channelConnectSkippedAt: null,
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

/** The page loads in a chain of awaits; let every link of it land. */
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

async function click(target: HTMLElement): Promise<void> {
    await act(async () => { target.click(); });
    await settle();
}

function heading(container: HTMLElement): string {
    return container.querySelector("h2")?.textContent ?? "";
}

const READY: ConnectedReadiness = { headline: "ready", answering: true, pending: [] };
const READY_NO_CARD_YET: ConnectedReadiness = { headline: "ready", answering: true, pending: ["payment_method"] };
const NEEDS_ZONE: ConnectedReadiness = { headline: "needs_zone", answering: false, pending: ["billing_zone", "payment_method"] };
const CHECKING: ConnectedReadiness = { headline: "checking", answering: false, pending: [] };

const WHATSAPP_CONNECTED = {
    hasAnyChannel: true,
    connectedChannelTypes: ["whatsapp"],
    onboardingStage: "channel_connected",
};

const STATUS_BODY = {
    success: true,
    data: {
        channels: [
            { phone_number_id: "old", display_phone_number: "+57 300 999 9999", channel_status: "disconnected" },
            { phone_number_id: "111", display_phone_number: "+57 300 000 0000", channel_status: "connected" },
        ],
    },
};

function zonesBody(zone: string | null) {
    return {
        success: true,
        data: {
            numbers: [{
                channelAccountId: "111",
                zone,
                resolution: { kind: zone ? "known" : "unmapped" },
                metadata: { displayPhoneNumber: "+57 300 000 0000" },
            }],
            contradictions: [],
        },
    };
}

/** The WhatsApp reads the page makes, answered as a tenant with one number. */
function whatsappReads({ zone = "America/Bogota" as string | null, zonesFail = false, funding = "attached" } = {}): void {
    jest.mocked(api.fetch).mockImplementation(async (endpoint: string) => {
        if (endpoint === "/channels/whatsapp/status") return STATUS_BODY;
        if (endpoint === BILLING_READINESS_ENDPOINT) {
            if (zonesFail) throw new Error("HTTP error! status: 500");
            return zonesBody(zone);
        }
        throw new Error(`unexpected ${endpoint}`);
    });
    jest.mocked(api.getWhatsappFundingReadiness).mockResolvedValue({
        success: true,
        data: { numbers: [{ channelAccountId: "111", state: funding, checkedAt: "2026-09-17T12:00:00.000Z" }] },
    } as any);
}

function readinessReads(): number {
    return jest.mocked(api.fetch).mock.calls.filter(([endpoint]) => endpoint === BILLING_READINESS_ENDPOINT).length;
}

function byTestId(container: HTMLElement, id: string): HTMLElement | null {
    return container.querySelector(`[data-testid="${id}"]`);
}

const ANSWERS = "Tu agente ya responde por el canal conectado.";
const PENDING = "Tu WhatsApp quedó conectado, pero tu agente todavía no puede responder ahí.";
const ZONE_LINE = "Confirma la zona horaria de facturación de tu número";
const PAYMENT_LINE = "Revisa el método de pago de tu cuenta de WhatsApp";
const UNCONFIRMED = "no pudimos comprobar si tu agente ya puede responder ahí";
const WEBHOOK_LINE = "Meta no confirmó que los mensajes de tus clientes lleguen a tu agente";
const REGISTRATION_LINE = "Meta todavía no terminó de registrar tu número";

function deferralWrites(): unknown[] {
    return jest.mocked(api.applySetupTemplate).mock.calls
        .map(([, payload]) => payload as Record<string, unknown>)
        .filter((payload) => payload.stage === "channel_deferred");
}

describe("the setup wizard's channel decision", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        mockSignup = { displayPhoneNumber: "+57 300 000 0000", phoneNumberId: "111" };
        jest.mocked(api.getPersonaTemplates).mockResolvedValue({ success: true, data: [] } as any);
        jest.mocked(api.getAgentConfiguration).mockResolvedValue({ success: true, data: workspace } as any);
        jest.mocked(api.applySetupTemplate).mockResolvedValue({ success: true } as any);
        mockAck = READY;
        whatsappReads();
    });

    it("records 'conectar después' when Siguiente skips WhatsApp, and says the agent answers through its link", async () => {
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus() as any);
        const screen = await renderScreen(<SetupWizardPage />);
        try {
            await settle();
            expect(heading(screen.container)).toBe("Tu agente");
            await click(button(screen.container, "Siguiente"));
            expect(heading(screen.container)).toBe("Conecta WhatsApp");

            await click(button(screen.container, "Siguiente"));

            expect(deferralWrites()).toEqual([expect.objectContaining({
                stageOnly: true,
                stage: "channel_deferred",
                channelConnectSkippedAt: expect.any(String),
            })]);
            expect(heading(screen.container)).toBe("Configuración inicial guardada");
            const text = screen.container.textContent ?? "";
            expect(text).toContain("Sofía ya responde por su enlace");
            expect(text).toContain("WhatsApp queda pendiente");
            expect(text).not.toContain("ya responde por el canal conectado");
            // "Sin un canal no recibe mensajes de nadie" is false with a link.
            expect(text).toContain("Por ahora solo le escriben por su enlace");
            expect(text).not.toContain("no recibe mensajes de nadie");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("records the same decision when the last step's circle is used to skip", async () => {
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus() as any);
        const screen = await renderScreen(<SetupWizardPage />);
        try {
            await settle();
            await click(button(screen.container, "3"));
            expect(deferralWrites()).toHaveLength(1);
            expect(heading(screen.container)).toBe("Configuración inicial guardada");
        } finally { screen.unmount(); }
    });

    it("stays on the connect step when the decision could not be saved", async () => {
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus() as any);
        jest.mocked(api.applySetupTemplate).mockResolvedValue({ success: false, error: "No se pudo guardar." } as any);
        // The page logs the rejection on purpose; this test only needs the screen.
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const screen = await renderScreen(<SetupWizardPage />);
        try {
            await settle();
            await click(button(screen.container, "Siguiente"));
            await click(button(screen.container, "Siguiente"));
            expect(heading(screen.container)).toBe("Conecta WhatsApp");
            expect(screen.container.querySelector('[role="alert"]')?.textContent).toContain("No se pudo guardar.");
        } finally { screen.unmount(); warn.mockRestore(); }
    });

    it("without a link to offer, still says the channel is pending instead of connected", async () => {
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus({ demoLink: null }) as any);
        const screen = await renderScreen(<SetupWizardPage />);
        try {
            await settle();
            await click(button(screen.container, "3"));
            const text = screen.container.textContent ?? "";
            expect(text).toContain("Te esperamos en Inicio para conectar WhatsApp");
            expect(text).not.toContain("ya responde por el canal conectado");
        } finally { screen.unmount(); }
    });

    it("WhatsApp connected before the wizard: the connect step is the connected state of THAT number", async () => {
        // A bare "¡Conectado!" said nothing about the billing time zone or the
        // payment method — the two things that decide whether replies go out.
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus(WHATSAPP_CONNECTED) as any);
        const screen = await renderScreen(<SetupWizardPage />);
        try {
            await settle();
            await click(button(screen.container, "Siguiente"));
            expect(heading(screen.container)).toBe("Conecta WhatsApp");
            const state = byTestId(screen.container, "connected-state");
            // The connected row, not the leftover of a replaced number.
            expect(state?.getAttribute("data-number")).toBe("111");
            expect(state?.getAttribute("data-phone")).toBe("+57 300 000 0000");
            // Never the signup again over a live number.
            expect(byTestId(screen.container, "whatsapp-panel")).toBeNull();
            expect(screen.container.textContent).not.toContain("¡Conectado!");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("'Continuar' with nothing pending: 'Listo' says the agent answers there, from the reading it was handed", async () => {
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus(WHATSAPP_CONNECTED) as any);
        mockAck = READY;
        const screen = await renderScreen(<SetupWizardPage />);
        try {
            await settle();
            await click(button(screen.container, "Siguiente"));
            await click(button(screen.container, "Continuar del estado"));

            expect(heading(screen.container)).toBe("Configuración inicial guardada");
            expect(deferralWrites()).toEqual([]);
            const text = screen.container.textContent ?? "";
            expect(text).toContain(ANSWERS);
            expect(text).toContain("Canal conectado");
            expect(text).not.toContain("WhatsApp queda pendiente");
            expect(readinessReads()).toBe(0);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("'Continuar' with the zone pending: 'Listo' says what is missing instead of 'ya responde'", async () => {
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus(WHATSAPP_CONNECTED) as any);
        mockAck = NEEDS_ZONE;
        const screen = await renderScreen(<SetupWizardPage />);
        try {
            await settle();
            await click(button(screen.container, "Siguiente"));
            await click(button(screen.container, "Continuar del estado"));

            const text = screen.container.textContent ?? "";
            expect(text).not.toContain(ANSWERS);
            expect(text).not.toContain("Canal conectado");
            expect(text).toContain(PENDING);
            expect(text).toContain("Terminar de activar WhatsApp");
            // In the order the owner should clear them: the zone stops everything.
            expect(text.indexOf(ZONE_LINE)).toBeGreaterThan(-1);
            expect(text.indexOf(PAYMENT_LINE)).toBeGreaterThan(text.indexOf(ZONE_LINE));
            expect(button(screen.container, "Terminar en Canales → WhatsApp")).toBeTruthy();
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("'Continuar' after a signup Meta left open: 'Listo' says what is pending and where, never 'ya responde'", async () => {
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus(WHATSAPP_CONNECTED) as any);
        mockAck = { headline: "signup_pending", answering: false, pending: ["phone_registration", "webhook_subscription"] };
        const screen = await renderScreen(<SetupWizardPage />);
        try {
            await settle();
            await click(button(screen.container, "Siguiente"));
            await click(button(screen.container, "Continuar del estado"));

            const text = screen.container.textContent ?? "";
            expect(text).not.toContain(ANSWERS);
            expect(text).not.toContain("Canal conectado");
            expect(text).toContain(PENDING);
            expect(text).toContain(REGISTRATION_LINE);
            expect(text).toContain(WEBHOOK_LINE);
            // Where to fix it is support and Meta, said in the line itself —
            // not a button to a screen that has nothing to fix it with.
            expect(text).toContain("escríbenos a soporte");
            expect(text).not.toContain(PAYMENT_LINE);
            expect([...screen.container.querySelectorAll("button")].some((b) => b.textContent?.includes("Terminar en Canales → WhatsApp"))).toBe(false);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("connected here with a webhook warning, then 'Siguiente': 'Listo' reads it again and still says it is pending", async () => {
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus() as any);
        whatsappReads({ zone: "America/Bogota", funding: "attached" });
        mockSignup = { displayPhoneNumber: "+57 300 000 0000", phoneNumberId: "111", warnings: ["webhook_subscription_failed"] };
        const screen = await renderScreen(<SetupWizardPage />);
        try {
            await settle();
            await click(button(screen.container, "Siguiente"));
            await click(button(screen.container, "Simular alta"));
            await click(button(screen.container, "Siguiente"));

            expect(heading(screen.container)).toBe("Configuración inicial guardada");
            expect(readinessReads()).toBe(1);
            const text = screen.container.textContent ?? "";
            expect(text).not.toContain(ANSWERS);
            expect(text).toContain(PENDING);
            expect(text).toContain(WEBHOOK_LINE);
        } finally { screen.unmount(); }
    });

    it("before 1 October, a payment method nobody confirmed: it answers, and says to add one before the 30th", async () => {
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus(WHATSAPP_CONNECTED) as any);
        mockAck = READY_NO_CARD_YET;
        const screen = await renderScreen(<SetupWizardPage />);
        try {
            await settle();
            await click(button(screen.container, "Siguiente"));
            await click(button(screen.container, "Continuar del estado"));
            const text = screen.container.textContent ?? "";
            expect(text).toContain(ANSWERS);
            expect(text).toContain("agrégalo antes del 30 de septiembre de 2026");
        } finally { screen.unmount(); }
    });

    it("'Siguiente' instead of 'Continuar': 'Listo' reads the zone and the payment method itself", async () => {
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus(WHATSAPP_CONNECTED) as any);
        whatsappReads({ zone: null });
        const screen = await renderScreen(<SetupWizardPage />);
        try {
            await settle();
            await click(button(screen.container, "Siguiente"));
            await click(button(screen.container, "Siguiente"));

            expect(heading(screen.container)).toBe("Configuración inicial guardada");
            expect(readinessReads()).toBe(1);
            const text = screen.container.textContent ?? "";
            expect(text).not.toContain(ANSWERS);
            expect(text).toContain(PENDING);
            expect(text).toContain(ZONE_LINE);
        } finally { screen.unmount(); }
    });

    it("'Siguiente' with everything in place still says the agent answers", async () => {
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus(WHATSAPP_CONNECTED) as any);
        whatsappReads({ zone: "America/Bogota", funding: "attached" });
        const screen = await renderScreen(<SetupWizardPage />);
        try {
            await settle();
            await click(button(screen.container, "Siguiente"));
            await click(button(screen.container, "Siguiente"));
            expect(screen.container.textContent).toContain(ANSWERS);
        } finally { screen.unmount(); }
    });

    it("a reading that fails is said as 'could not check', never as 'ya responde'", async () => {
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus(WHATSAPP_CONNECTED) as any);
        whatsappReads({ zonesFail: true });
        const screen = await renderScreen(<SetupWizardPage />);
        try {
            await settle();
            await click(button(screen.container, "Siguiente"));
            await click(button(screen.container, "Siguiente"));
            const text = screen.container.textContent ?? "";
            expect(text).not.toContain(ANSWERS);
            expect(text).toContain(UNCONFIRMED);
            expect(text).toContain("Comprobar WhatsApp");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("a 'Continuar' pressed while still checking is read again on 'Listo'", async () => {
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus(WHATSAPP_CONNECTED) as any);
        mockAck = CHECKING;
        whatsappReads({ zone: null });
        const screen = await renderScreen(<SetupWizardPage />);
        try {
            await settle();
            await click(button(screen.container, "Siguiente"));
            await click(button(screen.container, "Continuar del estado"));
            expect(readinessReads()).toBe(1);
            expect(screen.container.textContent).toContain(ZONE_LINE);
        } finally { screen.unmount(); }
    });

    it("connected in this session: 'Continuar' hands the reading over, and going back never offers the signup again", async () => {
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus() as any);
        mockAck = NEEDS_ZONE;
        const screen = await renderScreen(<SetupWizardPage />);
        try {
            await settle();
            await click(button(screen.container, "Siguiente"));
            await click(button(screen.container, "Simular alta"));
            await click(button(screen.container, "Continuar del alta"));

            expect(deferralWrites()).toEqual([]);
            expect(screen.container.textContent).toContain(PENDING);
            expect(readinessReads()).toBe(0);

            // Back to confirm the zone: the connected state of the same number,
            // not the route picker (a second Meta signup over it).
            await click(button(screen.container, "Anterior"));
            expect(heading(screen.container)).toBe("Conecta WhatsApp");
            expect(byTestId(screen.container, "whatsapp-panel")).toBeNull();
            expect(byTestId(screen.container, "connected-state")?.getAttribute("data-number")).toBe("111");

            // Confirmed there: the next "Continuar" carries the new reading.
            mockAck = READY;
            await click(button(screen.container, "Continuar del estado"));
            const text = screen.container.textContent ?? "";
            expect(text).toContain(ANSWERS);
            expect(text).not.toContain(PENDING);
        } finally { screen.unmount(); }
    });

    it("does not reopen on 'Listo' a draft that got there without answering the channel question", async () => {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 2, agentName: "Sofía", greeting: "Hola, soy Sofía.", operationalVersion: 3, revisionId: null }));
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus() as any);
        const screen = await renderScreen(<SetupWizardPage />);
        try {
            await settle();
            expect(heading(screen.container)).toBe("Conecta WhatsApp");
        } finally { screen.unmount(); }
    });

    it("reopens on 'Listo' a draft whose 'conectar después' is on record", async () => {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 2, agentName: "Sofía", greeting: "Hola, soy Sofía.", operationalVersion: 3, revisionId: null }));
        jest.mocked(api.getSetupStatus).mockResolvedValue(setupStatus({
            onboardingStage: "channel_deferred",
            channelConnectSkippedAt: "2026-09-17T10:00:00.000Z",
        }) as any);
        const screen = await renderScreen(<SetupWizardPage />);
        try {
            await settle();
            expect(heading(screen.container)).toBe("Configuración inicial guardada");
        } finally { screen.unmount(); }
    });
});
