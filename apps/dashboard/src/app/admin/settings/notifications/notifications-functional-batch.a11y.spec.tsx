import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import * as fs from "fs";
import * as path from "path";
import NotificationsPage from "./page";
import type { NotificationPreferences } from "@/lib/notification-preferences";

jest.mock("@/lib/api", () => ({ api: {
    getNotificationPreferences: jest.fn(), updateNotificationPreferences: jest.fn(),
} }));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "11111111-1111-4111-8111-111111111111" }) }));
jest.mock("@/hooks/useRole", () => ({ useRole: () => ({ role: "tenant_admin" }) }));
const { api } = jest.requireMock("@/lib/api") as { api: {
    getNotificationPreferences: jest.Mock; updateNotificationPreferences: jest.Mock;
} };

// Real page + hook + HelpPanel + PushNotificationToggle. Only the documented API
// boundary and existing tenant/role context are simulated. jsdom has no push
// support, so mounting never requests permission or creates a subscription.
// apiGet/apiPut catch normal network failures and return success:false; rejecting
// the mocked method would invent a transport contract the actual caller lacks.
const STORED: NotificationPreferences = {
    version: 1,
    soundEnabled: false,
    categories: { chat: false, handoff: true, compliance: false, appointments: true,
        automation: true, orders: true, system: false },
};
const EVENT = "parallly:notification-preferences";
const LABEL_KEYS = ["sound", "catChat", "catHandoff", "catCompliance", "catAppointments", "catAutomation", "catOrders", "catSystem"];
const clone = (value: NotificationPreferences): NotificationPreferences => ({ ...value, categories: { ...value.categories } });
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
function switches(container: HTMLElement): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="switch"]'));
}
function observed(container: HTMLElement): boolean[] {
    return switches(container).map(button => button.getAttribute("aria-checked") === "true");
}
function expected(preferences: NotificationPreferences): boolean[] {
    return [preferences.soundEnabled, ...["chat", "handoff", "compliance", "appointments", "automation", "orders", "system"]
        .map(key => preferences.categories[key as keyof NotificationPreferences["categories"]])];
}
async function settle() { await act(async () => { await Promise.resolve(); }); }

describe.each(["es", "en", "pt", "fr"])("notification preferences real page functional batch in %s", locale => {
    beforeEach(() => {
        api.getNotificationPreferences.mockReset();
        api.updateNotificationPreferences.mockReset();
    });
    async function mounted(check: (container: HTMLDivElement, messages: any) => Promise<void>) {
        const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../../messages", locale + ".json"), "utf8"));
        for (const key of [...LABEL_KEYS, "saveError", "saving", "serverNote"]) {
            expect(typeof messages.notifications[key]).toBe("string");
            expect(messages.notifications[key].trim().length).toBeGreaterThan(0);
        }
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        try {
            await act(async () => { root.render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Bogota"><NotificationsPage /></NextIntlClientProvider>); });
            await settle();
            expect(api.getNotificationPreferences).toHaveBeenCalledTimes(1);
            expect(api.getNotificationPreferences.mock.calls[0]).toEqual([]);
            expect(switches(container)).toHaveLength(8);
            expect(switches(container).map(button => button.getAttribute("aria-label")))
                .toEqual(LABEL_KEYS.map(key => messages.notifications[key]));
            await check(container, messages);
        } finally {
            act(() => root.unmount());
            container.remove();
        }
    }

    it("N1 identifies an initial read failure without claiming a save or restoration, and protects unknown stored values", async () => {
        api.getNotificationPreferences.mockResolvedValue({ success: false, error: "Error de conexión" });
        await mounted(async (container, messages) => {
            const alerts = Array.from(container.querySelectorAll('[role="alert"]'));
            expect(api.updateNotificationPreferences).not.toHaveBeenCalled();
            expect(alerts).toHaveLength(1);
            expect(alerts[0].textContent?.trim().length).toBeGreaterThan(0);
            // This negative semantic oracle uses the existing real translated
            // save-failure copy; no invented loadError key can fail the harness.
            expect(alerts[0].textContent?.trim()).not.toBe(messages.notifications.saveError);
            expect(switches(container).every(button => button.disabled)).toBe(true);
        });
    });

    it("N4 does not write default assumptions when a normal sound click follows a failed initial read", async () => {
        api.getNotificationPreferences.mockResolvedValue({ success: false, error: "Error de conexión" });
        api.updateNotificationPreferences.mockImplementation(async (preferences: NotificationPreferences) => ({ success: true, data: clone(preferences) }));
        await mounted(async (container, messages) => {
            const sound = switches(container).find(button => button.getAttribute("aria-label") === messages.notifications.sound);
            expect(sound).toBeDefined();
            // Native click respects disabled. The complete mocked payload is
            // retained by Jest in the failure rather than claiming that real
            // production preferences were overwritten.
            await act(async () => { sound!.click(); });
            await settle();
            expect({
                requestCount: api.updateNotificationPreferences.mock.calls.length,
                syntheticPayloads: api.updateNotificationPreferences.mock.calls.map(call => call[0]),
            }).toEqual({ requestCount: 0, syntheticPayloads: [] });
        });
    });

    it("N2 exposes pending read state, then hydrates eight nondefault stored values without a write", async () => {
        const read = deferred<any>();
        api.getNotificationPreferences.mockReturnValue(read.promise);
        await mounted(async (container, messages) => {
            expect(switches(container).every(button => button.disabled)).toBe(true);
            expect(api.updateNotificationPreferences).not.toHaveBeenCalled();
            // Lock the pending snapshot before resolution so it cannot be
            // mistaken for a settled screen. Disabled controls alone do not
            // tell the waiting user that the account preferences are loading.
            const pendingStatus = container.querySelector('[role="status"]');
            const pending = {
                hasStatus: Boolean(pendingStatus?.textContent?.trim()),
                status: pendingStatus?.textContent?.trim(),
            };
            await act(async () => { read.resolve({ success: true, data: clone(STORED) }); });
            await settle();
            expect(observed(container)).toEqual(expected(STORED));
            expect(switches(container).every(button => !button.disabled)).toBe(true);
            expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
            expect(container.querySelector('[role="status"]')?.textContent?.trim()).toBe(messages.notifications.serverNote);
            expect(api.updateNotificationPreferences).not.toHaveBeenCalled();
            expect(pending.hasStatus).toBe(true);
            expect(pending.status).not.toBe(messages.notifications.serverNote);
            expect(pending.status).not.toBe(messages.notifications.saving);
        });
    });

    it("N3 rolls back a failed optimistic write and allows one deliberate successful retry", async () => {
        const write = deferred<any>();
        api.getNotificationPreferences.mockResolvedValue({ success: true, data: clone(STORED) });
        api.updateNotificationPreferences.mockReturnValueOnce(write.promise)
            .mockImplementationOnce(async (preferences: NotificationPreferences) => ({ success: true, data: clone(preferences) }));
        const events: NotificationPreferences[] = [];
        const onChange = (event: Event) => events.push(clone((event as CustomEvent<NotificationPreferences>).detail));
        window.addEventListener(EVENT, onChange);
        try {
            await mounted(async (container, messages) => {
                expect(observed(container)).toEqual(expected(STORED));
                const next = clone(STORED);
                next.categories.chat = true;
                const chat = () => switches(container).find(button => button.getAttribute("aria-label") === messages.notifications.catChat)!;
                expect(chat()).toBeDefined();
                await act(async () => { chat().click(); });
                expect(api.updateNotificationPreferences).toHaveBeenCalledTimes(1);
                expect(api.updateNotificationPreferences.mock.calls[0]).toEqual([next]);
                expect(observed(container)).toEqual(expected(next));
                expect(switches(container).every(button => button.disabled)).toBe(true);
                expect(container.querySelector('[role="status"]')?.textContent?.trim()).toBe(messages.notifications.saving);
                expect(events).toEqual([next]);
                await act(async () => { write.resolve({ success: false, error: "Error de conexión" }); });
                await settle();
                expect(observed(container)).toEqual(expected(STORED));
                expect(switches(container).every(button => !button.disabled)).toBe(true);
                expect(container.querySelector('[role="alert"]')?.textContent?.trim()).toBe(messages.notifications.saveError);
                expect(events).toEqual([next, STORED]);
                expect(api.updateNotificationPreferences).toHaveBeenCalledTimes(1);
                await act(async () => { chat().click(); });
                await settle();
                expect(api.updateNotificationPreferences).toHaveBeenCalledTimes(2);
                expect(api.updateNotificationPreferences.mock.calls[1]).toEqual([next]);
                expect(observed(container)).toEqual(expected(next));
                expect(switches(container).every(button => !button.disabled)).toBe(true);
                expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
                expect(container.querySelector('[role="status"]')?.textContent?.trim()).toBe(messages.notifications.serverNote);
                expect(events).toEqual([next, STORED, next, next]);
                expect(api.getNotificationPreferences).toHaveBeenCalledTimes(1);
            });
        } finally {
            window.removeEventListener(EVENT, onChange);
        }
    });
});
