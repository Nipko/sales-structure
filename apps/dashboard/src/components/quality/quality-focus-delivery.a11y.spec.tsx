import { act } from "react";
import { findAccessibilityViolations, renderScreen } from "@/test/a11y";
import { api } from "@/lib/api";
import QualityFocusBanner, {
    unansweredCause,
    unansweredChannelTypes,
    whatsappDeliveryReasons,
} from "./QualityFocusBanner";

/**
 * The focus bar explains the two checks that mean "your channel does not work".
 *
 * `whatsapp_delivery` and `channel_unanswered` sent the owner to the WhatsApp
 * screen or the agent editor with the generic "esta acción quedó abierta" line:
 * nothing said that Meta wants a payment method, that the billing time zone is
 * missing, or which connected channel nobody answers. The sentence now comes
 * from the check's own evidence — one per reason the number cannot deliver.
 */

const AGENT_ID = "8a9b0c1d-2e3f-4a5b-8c7d-9e0f1a2b3c4d";
let mockSignalId = "";

jest.mock("next/navigation", () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    usePathname: () => "/admin/channels/whatsapp",
    useSearchParams: () => new URLSearchParams({ qa: mockSignalId, qagent: AGENT_ID }),
}));
jest.mock("@/lib/api", () => ({
    __esModule: true,
    api: { getAgentQualitySignal: jest.fn(), getAgentQualityOverview: jest.fn() },
}));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "tenant-1" }) }));
jest.mock("@/contexts/QualityHealthContext", () => ({ useQualityHealth: () => ({ snoozeSignal: jest.fn() }) }));
jest.mock("@/hooks/useRole", () => ({
    useRole: () => ({ role: "tenant_admin", isSuperAdmin: false, impersonating: false, canAccess: () => true }),
}));

function arrange(
    signalId: string,
    code: "whatsapp_delivery" | "channel_unanswered",
    status: "fail" | "warning",
    evidence: Record<string, string | number | null>,
) {
    mockSignalId = signalId;
    const agent = { id: AGENT_ID, name: "Sofía", version: 1 };
    const href = code === "whatsapp_delivery" ? "/admin/channels/whatsapp" : `/admin/agent/${AGENT_ID}?tab=persona&focus=channels`;
    jest.mocked(api.getAgentQualitySignal).mockResolvedValue({
        success: true,
        data: {
            id: signalId, agent, code: `fix_${code}`, severity: status === "fail" ? "critical" : "high", pillar: "preparation",
            dimension: "actions_outcomes", state: "open", href, evidenceCount: 1,
            firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), occurrenceCount: 1,
        },
    } as any);
    jest.mocked(api.getAgentQualityOverview).mockResolvedValue({
        success: true,
        data: {
            agent: { ...agent, isActive: true, updatedAt: new Date().toISOString() },
            preparation: {
                criticalBlockers: [],
                dimensions: [{ checks: [{ code, status, critical: true, weight: 5, href, evidence }] }],
            },
        },
    } as any);
}

async function render() {
    const screen = await renderScreen(<QualityFocusBanner />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    return screen;
}

describe("reading the delivery evidence", () => {
    it("names one reason, every reason of a `multiple`, and nothing outside the contract", () => {
        expect(whatsappDeliveryReasons({ reason: "timezone_missing" })).toEqual(["timezone_missing"]);
        expect(whatsappDeliveryReasons({ reason: "multiple", reasons: "timezone_missing,funding_restricted" }))
            .toEqual(["funding_restricted", "timezone_missing"]);
        expect(whatsappDeliveryReasons({ reason: "multiple", reasons: "timezone_missing,made_up" })).toEqual(["timezone_missing"]);
        expect(whatsappDeliveryReasons({ reason: "multiple" })).toEqual([]);
        expect(whatsappDeliveryReasons({ reason: null })).toEqual([]);
    });

    it("lists the channels nobody answers and why", () => {
        expect(unansweredChannelTypes({ unansweredChannels: "instagram,web_widget,instagram" })).toEqual(["instagram", "web_widget"]);
        expect(unansweredChannelTypes({ unansweredChannels: "" })).toEqual([]);
        expect(unansweredCause({ unanswered: 1, conflicted: 0 })).toBe("none");
        expect(unansweredCause({ unanswered: 0, conflicted: 1 })).toBe("conflict");
        expect(unansweredCause({ unanswered: 1, conflicted: 1 })).toBe("mixed");
    });
});

describe("the focus bar for a WhatsApp number that cannot deliver", () => {
    it("says the billing time zone is missing and where to pick it", async () => {
        arrange("6a0c1f7e-2b1a-4c8e-9f3d-1a2b3c4d5e71", "whatsapp_delivery", "fail", { reason: "timezone_missing", reasons: "timezone_missing" });
        const screen = await render();
        try {
            const text = screen.container.textContent ?? "";
            expect(text).toContain("Sofía no puede responder por WhatsApp porque falta confirmar la zona horaria de facturación de tu número");
            expect(text).not.toContain("Esta acción quedó abierta");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("says Meta charges the payment method, not us, and the date it stops delivering", async () => {
        arrange("6a0c1f7e-2b1a-4c8e-9f3d-1a2b3c4d5e72", "whatsapp_delivery", "warning", { reason: "funding_absent", reasons: "funding_absent", fundingRequiredFrom: "2026-10-01" });
        const screen = await render();
        try {
            const text = screen.container.textContent ?? "";
            expect(text).toContain("Tu cuenta de WhatsApp no tiene un método de pago en Meta");
            expect(text).toContain("los mensajes los cobra Meta, no nosotros");
            expect(text).toContain("desde el 1 de octubre de 2026");
        } finally { screen.unmount(); }
    });

    it("explains every reason when there is more than one", async () => {
        arrange("6a0c1f7e-2b1a-4c8e-9f3d-1a2b3c4d5e73", "whatsapp_delivery", "fail", { reason: "multiple", reasons: "currency_unknown,funding_restricted" });
        const screen = await render();
        try {
            const text = screen.container.textContent ?? "";
            expect(text).toContain("Meta restringió los cobros de tu cuenta de WhatsApp");
            expect(text).toContain("Todavía no sabemos en qué moneda te cobra Meta");
        } finally { screen.unmount(); }
    });

    it("still says it is WhatsApp holding the replies when the reason is not one it knows", async () => {
        arrange("6a0c1f7e-2b1a-4c8e-9f3d-1a2b3c4d5e74", "whatsapp_delivery", "fail", { reason: null });
        const screen = await render();
        try {
            expect(screen.container.textContent).toContain("Tu cuenta de WhatsApp está frenando las respuestas de Sofía");
        } finally { screen.unmount(); }
    });
});

describe("the focus bar for a connected channel nobody answers", () => {
    it("names the channels in the owner's words", async () => {
        arrange("6a0c1f7e-2b1a-4c8e-9f3d-1a2b3c4d5e75", "channel_unanswered", "fail", { unanswered: 2, conflicted: 0, unansweredChannels: "instagram,web_widget" });
        const screen = await render();
        try {
            const text = screen.container.textContent ?? "";
            expect(text).toContain("Ningún agente contesta en Instagram, Chat web");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("tells two agents claiming one channel apart from no agent at all", async () => {
        arrange("6a0c1f7e-2b1a-4c8e-9f3d-1a2b3c4d5e76", "channel_unanswered", "fail", { unanswered: 0, conflicted: 1, unansweredChannels: "whatsapp" });
        const screen = await render();
        try {
            expect(screen.container.textContent).toContain("Hay dos agentes asignados a WhatsApp");
        } finally { screen.unmount(); }
    });
});
