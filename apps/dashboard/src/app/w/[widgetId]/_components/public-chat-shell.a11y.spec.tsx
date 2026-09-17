import { createElement } from "react";
import { act } from "react";
import { renderScreen, findAccessibilityViolations, interact } from "@/test/a11y";
import PublicChatShell, { WIDGET_HOST_ID } from "./PublicChatShell";

/**
 * The public chat page, as a visitor's screen reader receives it.
 *
 * The chat itself is mounted by the platform loader, which jsdom never fetches;
 * what this checks is the frame the page owns — the headline that names whose
 * agent this is, the "test page" pill, the region the loader fills, the credit
 * link — and the two states the loader cannot reach: a link that does not
 * exist, and a config that could not be read. Also the wiring the loader
 * depends on: the global set before the script, the script added once.
 *
 * Two facts the fixtures below exist to pin, because both were wrong once:
 * the API answers a dead link with an HTTP **200** carrying
 * `{ success: false }`, not a 404; and only a DEMO widget may be mounted on a
 * public URL — a tenant's production widget arriving here is a link that does
 * not exist, not a page.
 */

type FetchMock = jest.Mock<Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>>;

function respondWith(status: number, body: unknown): FetchMock {
    return jest.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    }));
}

const READY = {
    success: true,
    data: {
        widgetId: "wgt_abc123",
        primaryColor: "#6c5ce7",
        position: "bottom-right",
        welcomeMessage: "Hola",
        agentName: "Ana",
        agentAvatar: null,
        preChatEnabled: false,
        preChatFields: [],
        locale: "es",
        tenantName: "Café Central",
        isDemo: true,
    },
};

/** What the API really sends for a missing, inactive or unavailable widget. */
const NOT_FOUND_BODY = { success: false, error: "Widget not found" };

/** The config and then the tenant's messages; two macrotasks let both land. */
async function settle(): Promise<void> {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

const originalFetch = globalThis.fetch;

function useFetch(mock: FetchMock): void {
    (globalThis as { fetch: unknown }).fetch = mock;
}

afterEach(() => {
    (globalThis as { fetch: unknown }).fetch = originalFetch;
    // The loader script and its global outlive a render on purpose (strict
    // mode guard); between tests they must not.
    document.querySelectorAll("script[data-parallly-loader]").forEach((node) => node.remove());
    delete (window as { __paralllyWidget?: unknown }).__paralllyWidget;
    document.title = "";
    document.documentElement.lang = "";
});

describe("the agent's public page, as a visitor receives it", () => {
    it("names the agent and the business, marks the test page, and frames the chat", async () => {
        useFetch(respondWith(200, READY));
        const screen = await renderScreen(createElement(PublicChatShell, { widgetId: "wgt_abc123" }));
        try {
            await settle();
            const heading = screen.container.querySelector("h1");
            expect(heading?.textContent).toBe("Ana · Café Central");
            expect(document.title).toBe("Ana · Café Central");
            expect(screen.container.textContent).toContain("Página de prueba");

            const host = screen.container.querySelector(`#${WIDGET_HOST_ID}`);
            expect(host?.tagName).toBe("SECTION");
            expect(host?.getAttribute("aria-label")).toBe("Chat con Ana");

            const credit = screen.container.querySelector("footer a") as HTMLAnchorElement;
            expect(credit.getAttribute("href")).toBe("https://parallly-chat.cloud");
            expect(credit.getAttribute("rel")).toBe("noopener noreferrer");
            expect(credit.textContent).toBe("Hecho con Parallly");

            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("sets the loader's global before adding the script, and adds it once", async () => {
        useFetch(respondWith(200, READY));
        const screen = await renderScreen(createElement(PublicChatShell, { widgetId: "wgt_abc123" }));
        try {
            await settle();
            const target = window as { __paralllyWidget?: { widgetId: string; mode: string; host: string } };
            expect(target.__paralllyWidget).toEqual({
                widgetId: "wgt_abc123",
                mode: "page",
                host: `#${WIDGET_HOST_ID}`,
            });
            const scripts = document.querySelectorAll("script[data-parallly-loader]");
            expect(scripts).toHaveLength(1);
            expect(scripts[0].getAttribute("src")).toMatch(/\/widget\/loader\.js$/);
            expect((scripts[0] as HTMLScriptElement).async).toBe(true);
        } finally {
            screen.unmount();
        }
    });

    it("speaks the tenant's language, not the visitor's cookie", async () => {
        useFetch(respondWith(200, { ...READY, data: { ...READY.data, locale: "en" } }));
        const screen = await renderScreen(createElement(PublicChatShell, { widgetId: "wgt_abc123" }));
        try {
            await settle();
            // The harness's provider is Spanish; the widget's config wins.
            expect(screen.container.textContent).toContain("Test page");
            expect(screen.container.textContent).not.toContain("Página de prueba");
            expect(screen.container.querySelector("footer a")?.textContent).toBe("Made with Parallly");
            expect(screen.container.querySelector(`#${WIDGET_HOST_ID}`)?.getAttribute("aria-label"))
                .toBe("Chat with Ana");
            expect(document.documentElement.lang).toBe("en");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("falls back to the visitor's language when the config names none", async () => {
        useFetch(respondWith(200, { ...READY, data: { ...READY.data, locale: "kl" } }));
        const screen = await renderScreen(createElement(PublicChatShell, { widgetId: "wgt_abc123" }));
        try {
            await settle();
            expect(screen.container.textContent).toContain("Página de prueba");
            // An unknown locale never reaches an import path, and never becomes
            // a lie about what the document is written in.
            expect(document.documentElement.lang).toBe("");
        } finally {
            screen.unmount();
        }
    });

    it("does not turn a tenant's own widget into a page anyone can open", async () => {
        useFetch(respondWith(200, { ...READY, data: { ...READY.data, isDemo: false } }));
        const screen = await renderScreen(createElement(PublicChatShell, { widgetId: "wgt_real" }));
        try {
            await settle();
            expect(screen.container.querySelector("h1")?.textContent)
                .toBe("Este enlace no existe o ya no está disponible.");
            // The fence is the loader never being injected, not a hidden frame.
            expect(screen.container.querySelector(`#${WIDGET_HOST_ID}`)).toBeNull();
            expect(document.querySelectorAll("script[data-parallly-loader]")).toHaveLength(0);
            expect((window as { __paralllyWidget?: unknown }).__paralllyWidget).toBeUndefined();
        } finally {
            screen.unmount();
        }
    });

    it("tells a visitor plainly when the link no longer exists", async () => {
        // The shape the API really sends: HTTP 200, `success: false`.
        useFetch(respondWith(200, NOT_FOUND_BODY));
        const screen = await renderScreen(createElement(PublicChatShell, { widgetId: "wgt_gone" }));
        try {
            await settle();
            expect(screen.container.querySelector("h1")?.textContent)
                .toBe("Este enlace no existe o ya no está disponible.");
            // Not the connection excuse, and no retry button to press.
            expect(screen.container.textContent).not.toContain("Revisa tu conexión");
            expect(screen.container.querySelector("button")).toBeNull();
            // Nothing to mount into, and nothing mounted.
            expect(screen.container.querySelector(`#${WIDGET_HOST_ID}`)).toBeNull();
            expect(document.querySelectorAll("script[data-parallly-loader]")).toHaveLength(0);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("reads an HTTP 404 as the same dead link", async () => {
        useFetch(respondWith(404, NOT_FOUND_BODY));
        const screen = await renderScreen(createElement(PublicChatShell, { widgetId: "wgt_gone" }));
        try {
            await settle();
            expect(screen.container.querySelector("h1")?.textContent)
                .toBe("Este enlace no existe o ya no está disponible.");
        } finally {
            screen.unmount();
        }
    });

    it("offers a retry when the config could not be read, and retries", async () => {
        const fetchMock = respondWith(503, { success: false });
        useFetch(fetchMock);
        const screen = await renderScreen(createElement(PublicChatShell, { widgetId: "wgt_abc123" }));
        try {
            await settle();
            expect(screen.container.querySelector("h1")?.textContent).toBe("No pudimos abrir el chat.");
            const retry = screen.container.querySelector("button") as HTMLButtonElement;
            expect(retry.textContent).toBe("Intentar de nuevo");
            expect(fetchMock).toHaveBeenCalledTimes(1);

            await interact(() => retry.click());
            await settle();
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("treats a missing id as a link that does not exist, without asking the API", async () => {
        const fetchMock = respondWith(200, READY);
        useFetch(fetchMock);
        const screen = await renderScreen(createElement(PublicChatShell, { widgetId: "" }));
        try {
            await settle();
            expect(fetchMock).not.toHaveBeenCalled();
            expect(screen.container.querySelector("h1")?.textContent)
                .toBe("Este enlace no existe o ya no está disponible.");
        } finally {
            screen.unmount();
        }
    });
});
