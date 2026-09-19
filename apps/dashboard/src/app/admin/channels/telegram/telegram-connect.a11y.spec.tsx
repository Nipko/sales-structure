import * as fs from "fs";
import * as path from "path";
import { findAccessibilityViolations, interact, renderScreen, type RenderedScreen } from "@/test/a11y";
import { api } from "@/lib/api";
import TelegramSetupPage from "./page";

/**
 * The Telegram page, from "Ya tengo la clave" to a refusal.
 *
 * It used to post through `api.fetch` and print whatever the server wrote, so
 * a key Telegram did not accept put Telegram's own words on the screen. Now it
 * posts through `api.connectTelegram`, whose envelope keeps the code, and the
 * card is chosen from the code: what happened, what to do, at most one control.
 */

jest.mock("@/lib/api", () => ({ api: { fetch: jest.fn(), connectTelegram: jest.fn() } }));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "tenant-1" }) }));
jest.mock("@/hooks/usePlanLimits", () => ({ usePlanLimits: () => ({ canAddChannelAccount: () => true }) }));
jest.mock("@/components/ui/help-panel", () => ({ HelpPanel: () => null }));

const ES = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "..", "messages", "es.json"), "utf8"));
const CARDS = ES.channels.telegram.errors;
const SERVER_PROSE = "Unauthorized: el servidor dijo esto";

function type(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonNamed(container: HTMLElement, text: string): HTMLButtonElement {
    const found = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === text);
    if (!found) throw new Error(`no button named ${text}`);
    return found as HTMLButtonElement;
}

/** Opens the key step and presses "Conectar bot" with a key. */
async function submitKey(screen: RenderedScreen, key = "123:abc"): Promise<void> {
    await interact(() => buttonNamed(screen.container, ES.channels.telegram.alreadyHaveToken).click());
    const input = screen.container.querySelector("input") as HTMLInputElement;
    await interact(() => type(input, key));
    await interact(() => buttonNamed(screen.container, ES.channels.telegram.connectBtn).click());
    await interact(() => {});
}

/**
 * The words on the page, as a day-0 owner reads them.
 *
 * Home sends her here ("Conecta Telegram") while the wizard calls the thing
 * she pastes "la clave del bot". This page said "token" — in its copy, and in
 * a field label and placeholder written straight into the page, where the
 * locale checks in `i18n-parity.spec.ts` cannot see them. So this reads the
 * rendered screen, attributes included.
 */
describe("the Telegram page speaks the wizard's words", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(api.fetch).mockResolvedValue({ success: true, data: { connected: false } } as any);
    });

    /** Everything a person can read or hear on the screen: text, labels, placeholders, titles. */
    function readable(container: HTMLElement): string {
        const attributes = [...container.querySelectorAll("[placeholder], [aria-label], [title], [alt]")]
            .flatMap((element) => ["placeholder", "aria-label", "title", "alt"].map((name) => element.getAttribute(name) ?? ""));
        return [container.textContent ?? "", ...attributes].join(" ");
    }

    it("never says token, and names the field in the wizard's word", async () => {
        const screen = await renderScreen(<TelegramSetupPage />);
        try {
            expect(readable(screen.container)).not.toMatch(/token/i);
            await interact(() => buttonNamed(screen.container, ES.channels.telegram.alreadyHaveToken).click());
            expect(readable(screen.container)).not.toMatch(/token|webhook/i);

            // The field is labelled by its visible words, which are "Clave del bot".
            const input = screen.container.querySelector("input") as HTMLInputElement;
            const label = screen.container.querySelector(`label[for="${input.id}"]`);
            expect(label?.textContent?.trim()).toBe(ES.channels.telegram.keyLabel);
            expect(input.placeholder).toBe(ES.channels.telegram.keyPlaceholder);
            expect(ES.channels.telegram.keyLabel).toMatch(/clave/i);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("says what disconnecting does without naming the plumbing", async () => {
        jest.mocked(api.fetch).mockResolvedValue({
            success: true,
            data: { connected: true, account: { accountId: "mitienda_bot", displayName: "Mi Tienda", metadata: { botName: "Mi Tienda" } } },
        } as any);
        const screen = await renderScreen(<TelegramSetupPage />);
        try {
            expect(screen.container.textContent).toContain(ES.channels.telegram.disconnectDesc);
            expect(readable(screen.container)).not.toMatch(/token|webhook/i);
        } finally { screen.unmount(); }
    });
});

describe("the Telegram page turns a refused connection into one card", () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(api.fetch).mockResolvedValue({ success: true, data: { connected: false } } as any);
        // The page logs the refusal for support; the screen is what is asserted.
        warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    it("says Telegram did not recognise the key, without the server's words, and sends it through the envelope", async () => {
        jest.mocked(api.connectTelegram).mockResolvedValue({
            success: false, httpStatus: 400, error: SERVER_PROSE, errorCode: "invalid_bot_key",
        } as any);
        const screen = await renderScreen(<TelegramSetupPage />);
        try {
            await submitKey(screen, "  123:abc  ");
            expect(api.connectTelegram).toHaveBeenCalledWith("123:abc");
            // The connect no longer goes through `api.fetch`, which kept only the prose.
            expect(jest.mocked(api.fetch).mock.calls.map(([endpoint]) => endpoint)).not.toContain("/channels/telegram/connect");

            const card = screen.container.querySelector('[data-connect-failure="telegram:invalidBotKey"]');
            expect(card?.querySelector("[role=alert]")?.textContent).toContain(CARDS.invalidBotKey.title);
            expect(card?.textContent).toContain(CARDS.invalidBotKey.action);
            expect(screen.container.textContent).not.toContain(SERVER_PROSE);
            // The form right above it is the retry; the card adds no second button.
            expect(card?.querySelectorAll("button, a")).toHaveLength(0);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally { screen.unmount(); }
    });

    it("offers the one retry when Telegram accepted the key but did not finish", async () => {
        jest.mocked(api.connectTelegram).mockResolvedValue({
            success: false, httpStatus: 400, error: SERVER_PROSE, errorCode: "telegram_unavailable",
        } as any);
        const screen = await renderScreen(<TelegramSetupPage />);
        try {
            await submitKey(screen);
            const card = screen.container.querySelector('[data-connect-failure="telegram:unavailable"]') as HTMLElement;
            expect(card.textContent).toContain(CARDS.unavailable.title);
            const controls = card.querySelectorAll("button, a");
            expect(controls).toHaveLength(1);
            expect(controls[0].textContent).toContain(CARDS.retry);
            await interact(() => (controls[0] as HTMLButtonElement).click());
            await interact(() => {});
            expect(api.connectTelegram).toHaveBeenCalledTimes(2);
        } finally { screen.unmount(); }
    });

    it.each([
        ["plan_limit_reached", "planLimit", "/admin/settings/billing"],
        ["channel_not_available", "channelNotAvailable", "/admin/settings/billing"],
        ["email_not_verified", "emailNotVerified", "/verify-email"],
    ])("sends %s to the one place it is fixed", async (code, key, href) => {
        jest.mocked(api.connectTelegram).mockResolvedValue({ success: false, httpStatus: 403, error: SERVER_PROSE, errorCode: code } as any);
        const screen = await renderScreen(<TelegramSetupPage />);
        try {
            await submitKey(screen);
            const card = screen.container.querySelector(`[data-connect-failure="telegram:${key}"]`) as HTMLElement;
            expect(card.textContent).toContain(CARDS[key].title);
            const controls = card.querySelectorAll("button, a");
            expect(controls).toHaveLength(1);
            expect(controls[0].getAttribute("href")).toBe(href);
            expect(screen.container.textContent).not.toContain(SERVER_PROSE);
        } finally { screen.unmount(); }
    });

    it("keeps anything it cannot name to the generic card", async () => {
        jest.mocked(api.connectTelegram).mockResolvedValue({ success: false, error: "Error de conexión" } as any);
        const screen = await renderScreen(<TelegramSetupPage />);
        try {
            await submitKey(screen);
            expect(screen.container.querySelector('[data-connect-failure="telegram:generic"]')?.textContent)
                .toContain(CARDS.generic.title);
            expect(screen.container.textContent).not.toContain("Error de conexión");
        } finally { screen.unmount(); }
    });

    it("clears the card as soon as the key is edited", async () => {
        jest.mocked(api.connectTelegram).mockResolvedValue({ success: false, errorCode: "invalid_bot_key", error: SERVER_PROSE } as any);
        const screen = await renderScreen(<TelegramSetupPage />);
        try {
            await submitKey(screen);
            expect(screen.container.querySelector("[data-connect-failure]")).not.toBeNull();
            await interact(() => type(screen.container.querySelector("input") as HTMLInputElement, "123:abcd"));
            expect(screen.container.querySelector("[data-connect-failure]")).toBeNull();
        } finally { screen.unmount(); }
    });
});
