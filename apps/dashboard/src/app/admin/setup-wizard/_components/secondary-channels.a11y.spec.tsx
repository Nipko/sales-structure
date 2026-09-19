import { act } from "react";
import { renderScreen, findAccessibilityViolations } from "@/test/a11y";
import { api } from "@/lib/api";
import SecondaryChannels from "./SecondaryChannels";
import type { ConnectedChannelDetails, SecondaryChannel } from "../connect-channels";

/**
 * Instagram, Messenger and Telegram inside the wizard, honestly.
 *
 * Before: a fixed order for every business; a trial owner could open Meta's
 * window for a channel her plan was going to refuse; the Instagram window's
 * code was read as `event.data.message` (it never is) so every failure said
 * "Error de conexión"; Messenger printed the service's fallback sentence; and
 * the Telegram hint said "Pegá el token de tu bot (lo obtenés de @BotFather)".
 */

jest.mock("@/lib/api", () => ({
    api: {
        fetch: jest.fn(),
        connectTelegram: jest.fn(),
        getBillingPlans: jest.fn(),
        messengerOAuthConnect: jest.fn(),
        sendVerification: jest.fn(),
    },
}));

/** A BroadcastChannel jsdom does not have, that the test can post into. */
class FakeBroadcastChannel {
    static open: FakeBroadcastChannel[] = [];
    onmessage: ((event: { data: unknown }) => void) | null = null;
    constructor(public name: string) { FakeBroadcastChannel.open.push(this); }
    postMessage() {}
    close() { FakeBroadcastChannel.open = FakeBroadcastChannel.open.filter((c) => c !== this); }
    static deliver(data: unknown) {
        for (const channel of FakeBroadcastChannel.open) channel.onmessage?.({ data });
    }
}

const NAMES: Record<SecondaryChannel, string> = { instagram: "Instagram", messenger: "Messenger", telegram: "Telegram" };
const ALL: SecondaryChannel[] = ["instagram", "messenger", "telegram"];

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
    const found = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(name));
    if (!found) throw new Error(`no button named ${name}`);
    return found as HTMLButtonElement;
}

async function click(target: HTMLElement): Promise<void> {
    await act(async () => { target.click(); });
    await settle();
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

function render(props: Partial<React.ComponentProps<typeof SecondaryChannels>> = {}) {
    return renderScreen(
        <SecondaryChannels
            tenantId="tenant-1"
            channels={ALL}
            planChannels={null}
            channelName={(channel) => NAMES[channel]}
            {...props}
        />,
    );
}

describe("SecondaryChannels", () => {
    const originalOpen = window.open;

    beforeEach(() => {
        jest.clearAllMocks();
        FakeBroadcastChannel.open = [];
        (globalThis as any).BroadcastChannel = FakeBroadcastChannel;
        if (!(globalThis.crypto as any)?.randomUUID) {
            Object.defineProperty(globalThis, "crypto", { value: { ...globalThis.crypto, randomUUID: () => "state-1" }, configurable: true });
        }
        window.open = jest.fn(() => ({ closed: false }) as unknown as Window);
        jest.mocked(api.getBillingPlans).mockResolvedValue({ success: true, data: [
            { slug: "emprendedor", name: "Emprendedor", features: { channels: ["whatsapp"] } },
            { slug: "starter", name: "Starter", features: { channels: ["whatsapp", "instagram", "messenger"] } },
            { slug: "pro", name: "Pro", features: { channels: ["whatsapp", "instagram", "messenger", "telegram"] } },
        ] } as any);
    });

    afterEach(() => {
        window.open = originalOpen;
        delete (window as any).FB;
    });

    it("lists the channels in the order it is given, marks the recommended one, and locks nothing when the plan is unknown", async () => {
        const screen = await render({ channels: ["messenger", "instagram", "telegram"], recommended: "messenger" });
        try {
            await settle();
            const labels = [...screen.container.querySelectorAll("li button")].map((b) => b.textContent?.trim());
            expect(labels).toEqual(["MessengerRecomendado", "Instagram", "Telegram"]);
            expect(screen.container.querySelector("[data-channel-locked]")).toBeNull();
            expect(api.getBillingPlans).not.toHaveBeenCalled();
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("on the WhatsApp-only trial, shows each channel as 'incluido desde {plan}' with no button to start it", async () => {
        const screen = await render({ planChannels: ["whatsapp"], emailBlocked: true, email: "ana@cafe.co" });
        try {
            await settle();
            const locked = [...screen.container.querySelectorAll("[data-channel-locked]")];
            expect(locked.map((row) => row.textContent)).toEqual([
                "InstagramIncluido desde Starter",
                "MessengerIncluido desde Starter",
                "TelegramIncluido desde Pro",
            ]);
            // Nothing to press that would open a window the plan refuses.
            expect(screen.container.querySelectorAll("li button")).toHaveLength(0);
            const note = screen.container.querySelector("[data-plan-note]");
            expect(note?.textContent).toContain("Revisa tu plan para habilitarlo");
            expect(note?.querySelector("a")?.getAttribute("href")).toBe("/admin/settings/billing");
            // An email notice for channels that are locked anyway would be noise.
            expect(screen.container.querySelector("[data-email-gate]")).toBeNull();
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("maps the Instagram window's code to its card, never 'Error de conexión'", async () => {
        const screen = await render();
        try {
            await settle();
            await click(button(screen.container, "Instagram"));
            expect(window.open).toHaveBeenCalledTimes(1);
            await act(async () => {
                FakeBroadcastChannel.deliver({ type: "ig_oauth_error", code: "meta_connect_account_not_professional" });
            });
            await settle();
            const alert = screen.container.querySelector('[role="alert"]');
            expect(alert?.textContent).toContain("Tu cuenta de Instagram todavía es personal");
            expect(screen.container.textContent).not.toContain("Error de conexión");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("says which channel connected when the Instagram window reports success", async () => {
        const onConnected = jest.fn();
        const screen = await render({ onConnected });
        try {
            await settle();
            await act(async () => { FakeBroadcastChannel.deliver({ type: "ig_oauth_success" }); });
            expect(onConnected).toHaveBeenCalledWith({ channel: "instagram", label: null, href: null });
        } finally { screen.unmount(); }
    });

    it("maps Messenger's typed refusal to its card instead of the service's sentence", async () => {
        (window as any).FB = { login: (cb: (r: unknown) => void) => cb({ authResponse: { accessToken: "user-token" } }) };
        jest.mocked(api.messengerOAuthConnect).mockResolvedValue({
            success: false, httpStatus: 403, errorCode: "meta_connect_not_page_admin", error: "Página sin permisos (prose)",
        } as any);
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const screen = await render();
        try {
            await settle();
            await click(button(screen.container, "Messenger"));
            const alert = screen.container.querySelector('[role="alert"]');
            expect(alert?.textContent).toContain("No eres administrador de esa página");
            expect(screen.container.textContent).not.toContain("prose");
        } finally { screen.unmount(); warn.mockRestore(); }
    });

    it("hands over the page that Messenger connected", async () => {
        (window as any).FB = { login: (cb: (r: unknown) => void) => cb({ authResponse: { accessToken: "user-token" } }) };
        jest.mocked(api.messengerOAuthConnect).mockResolvedValue({ success: true, data: { connected: [{ id: "p1", name: "Café Luna" }] } } as any);
        const onConnected = jest.fn();
        const screen = await render({ onConnected });
        try {
            await settle();
            await click(button(screen.container, "Messenger"));
            expect(onConnected).toHaveBeenCalledWith<[ConnectedChannelDetails]>({ channel: "messenger", label: "Café Luna", href: null });
        } finally { screen.unmount(); }
    });

    it("with the email unconfirmed, says so before any window and opens none", async () => {
        const screen = await render({ emailBlocked: true, email: "ana@cafe.co", planChannels: ["whatsapp", "instagram", "messenger"] });
        try {
            await settle();
            const gate = screen.container.querySelector("[data-email-gate]");
            // Only the channels the plan includes: Telegram is locked, not blocked.
            expect(gate?.textContent).toContain("Antes de conectar Instagram y Messenger, confirma tu correo");
            expect(gate?.textContent).toContain("ana@cafe.co");
            expect(gate?.querySelector('a[href="/verify-email"]')?.textContent).toBe("Ya lo tengo");
            expect(button(gate as HTMLElement, "Reenviar código")).toBeTruthy();

            await click(button(screen.container, "Instagram"));
            expect(window.open).not.toHaveBeenCalled();
            const alert = screen.container.querySelector('[role="alert"]');
            expect(alert?.textContent).toContain("Falta confirmar tu correo");
            expect(alert?.querySelector("a")?.getAttribute("href")).toBe("/verify-email");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("resends the code from the notice, like the banner does", async () => {
        jest.mocked(api.sendVerification).mockResolvedValue({ success: true } as any);
        const screen = await render({ emailBlocked: true, email: "ana@cafe.co" });
        try {
            await settle();
            await click(button(screen.container, "Reenviar código"));
            expect(api.sendVerification).toHaveBeenCalledTimes(1);
            expect(screen.container.querySelector("[data-email-gate]")?.textContent).toContain("Código enviado");
        } finally { screen.unmount(); }
    });

    it("asks for Telegram's key in plain words, and says what connected", async () => {
        jest.mocked(api.connectTelegram).mockResolvedValue({ success: true, data: { botUsername: "cafe_luna_bot" } });
        const onConnected = jest.fn();
        const screen = await render({ onConnected });
        try {
            await settle();
            await click(button(screen.container, "Telegram"));
            const input = screen.container.querySelector<HTMLInputElement>("#setup-telegram-key")!;
            const label = screen.container.querySelector('label[for="setup-telegram-key"]')?.textContent ?? "";
            expect(label).toContain("@BotFather");
            expect(label).not.toMatch(/token|Pegá|obtenés/i);
            expect(input.placeholder).not.toMatch(/token/i);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);

            await type(input, "123:abc");
            await click(button(screen.container, "Conectar"));
            // The envelope method, so a refusal keeps its code.
            expect(api.connectTelegram).toHaveBeenCalledWith("123:abc");
            expect(api.fetch).not.toHaveBeenCalled();
            expect(onConnected).toHaveBeenCalledWith({ channel: "telegram", label: "@cafe_luna_bot", href: "https://t.me/cafe_luna_bot" });
        } finally { screen.unmount(); }
    });

    it("a key Telegram refuses is its own card, pointing back to @BotFather, never the server's sentence", async () => {
        jest.mocked(api.connectTelegram).mockResolvedValue({
            success: false, httpStatus: 400, errorCode: "invalid_bot_key",
            error: "Telegram no reconoce esa clave. Copia de nuevo la clave completa que te dio @BotFather y vuelve a intentarlo.",
        });
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const screen = await render();
        try {
            await settle();
            await click(button(screen.container, "Telegram"));
            await type(screen.container.querySelector<HTMLInputElement>("#setup-telegram-key")!, "123:abc");
            await click(button(screen.container, "Conectar"));
            const alert = screen.container.querySelector('[role="alert"]');
            expect(screen.container.querySelector("[data-connect-failure]")?.getAttribute("data-connect-failure")).toBe("telegram:invalidBotKey");
            expect(alert?.textContent).toContain("Telegram no reconoce esa clave");
            expect(alert?.textContent).toContain("@BotFather");
            // The card is ours; the server's sentence does not reach the screen.
            expect(alert?.textContent).not.toContain("vuelve a intentarlo");
            // One action: the key form stays right there, no second button.
            expect(screen.container.querySelector("#setup-telegram-key")).not.toBeNull();
            expect(alert?.querySelector("button, a")).toBeNull();
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); warn.mockRestore(); }
    });

    it("Telegram out of reach is not about the key: one Reintentar that sends the same key again", async () => {
        jest.mocked(api.connectTelegram).mockResolvedValue({
            success: false, httpStatus: 503, errorCode: "telegram_unavailable",
            error: "Error al configurar webhook: Bad Request: bad webhook",
        });
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const screen = await render();
        try {
            await settle();
            await click(button(screen.container, "Telegram"));
            await type(screen.container.querySelector<HTMLInputElement>("#setup-telegram-key")!, "123:abc");
            await click(button(screen.container, "Conectar"));
            const alert = screen.container.querySelector('[role="alert"]');
            expect(alert?.textContent).toContain("Telegram no terminó de conectar tu bot");
            expect(alert?.textContent).toContain("no algo que hiciste");
            expect(alert?.textContent).not.toContain("Revisa que pegaste");
            expect(screen.container.textContent).not.toContain("webhook");
            const retry = alert?.querySelectorAll("button") ?? [];
            expect(retry).toHaveLength(1);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
            jest.mocked(api.connectTelegram).mockClear();
            await click(retry[0] as HTMLButtonElement);
            expect(api.connectTelegram).toHaveBeenCalledWith("123:abc");
        } finally { screen.unmount(); warn.mockRestore(); }
    });

    it("any other Telegram refusal is the generic card about the key, never the server's sentence", async () => {
        jest.mocked(api.connectTelegram).mockResolvedValue({
            success: false, httpStatus: 500, errorCode: "something_nobody_mapped",
            error: "Error al configurar webhook: Bad Request: bad webhook",
        });
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const screen = await render();
        try {
            await settle();
            await click(button(screen.container, "Telegram"));
            await type(screen.container.querySelector<HTMLInputElement>("#setup-telegram-key")!, "123:abc");
            await click(button(screen.container, "Conectar"));
            const alert = screen.container.querySelector('[role="alert"]');
            expect(alert?.textContent).toContain("No pudimos conectar tu bot de Telegram");
            expect(screen.container.textContent).not.toContain("webhook");
            // The key stays there to be fixed; no "Reintentar" beside it.
            expect(screen.container.querySelector("#setup-telegram-key")).not.toBeNull();
            expect(alert?.querySelector("button")).toBeNull();
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); warn.mockRestore(); }
    });
});
