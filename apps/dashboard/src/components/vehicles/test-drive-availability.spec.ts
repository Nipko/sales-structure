import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TestDriveAvailability, requestTestDrives, type TestDriveLoadState } from "./TestDriveAvailability";

let mockLocale = "es";
const mockMessages: Record<string, any> = Object.fromEntries(["es", "en", "pt", "fr"].map(locale => [locale, require(`../../../messages/${locale}.json`)]));
jest.mock("next-intl", () => ({ useTranslations: (namespace: string) => (key: string) => {
    const value = `${namespace}.${key}`.split(".").reduce((current: any, part) => current?.[part], mockMessages[mockLocale]);
    if (typeof value !== "string") throw new Error(`missing_translation:${mockLocale}.${namespace}.${key}`);
    return value;
} }));

const render = (state: TestDriveLoadState) => renderToStaticMarkup(createElement(TestDriveAvailability,
    { state, retry: async () => {} }, createElement("span", null, "confirmed-result")));
function button(node: unknown): ReactElement<{ onClick: () => Promise<void> }> | undefined {
    if (!isValidElement(node)) return undefined;
    if (node.type === "button") return node as ReactElement<{ onClick: () => Promise<void> }>;
    const children = (node.props as { children?: unknown }).children;
    for (const child of Array.isArray(children) ? children : [children]) {
        const found = button(child); if (found) return found;
    }
}

describe("test-drive availability with a recoverable read failure", () => {
    it.each(["es", "en", "pt", "fr"])("keeps failed/loading/empty results distinct in %s", locale => {
        mockLocale = locale;
        const strings = mockMessages[locale].vehicles;
        const failed = render({ status: "failed" });
        expect(failed).toContain('role="alert"'); expect(failed).toContain(strings.testDrives.loadError);
        expect(failed).toContain(strings.retry); expect(failed).not.toContain(strings.testDrives.empty);
        expect(failed).not.toContain("confirmed-result");
        for (const status of ["idle", "loading"] as const) {
            const pending = render({ status });
            expect(pending).toContain('aria-busy="true"'); expect(pending).not.toContain(strings.testDrives.empty);
            expect(pending).not.toContain("<button"); expect(pending).not.toContain("confirmed-result");
        }
        const empty = render({ status: "ready", items: [] });
        expect(empty).toContain(strings.testDrives.empty); expect(empty).not.toContain('role="alert"');
        expect(render({ status: "ready", items: [{ id: "appointment" }] })).toContain("confirmed-result");
    });
    it.each(["failed_envelope", "invalid_payload", "rejected_request"])("reconsults the reader from the visible retry after %s", async failure => {
        mockLocale = "es";
        let resolveRetry!: (value: { success: boolean; data: unknown[] }) => void;
        const pending = new Promise<{ success: boolean; data: unknown[] }>(resolve => { resolveRetry = resolve; });
        const request = jest.fn<Promise<{ success: boolean; data?: unknown }>, []>();
        if (failure === "rejected_request") request.mockRejectedValueOnce(new Error("private backend details"));
        else request.mockResolvedValueOnce(failure === "failed_envelope" ? { success: false } : { success: true, data: null });
        request.mockReturnValueOnce(pending);
        let state: TestDriveLoadState = { status: "idle" };
        const updates: string[] = [];
        const retry = () => requestTestDrives(request, next => { state = next; updates.push(next.status); });
        await retry();
        expect(state).toEqual({ status: "failed" });
        const retryButton = button(TestDriveAvailability({ state, retry }));
        expect(retryButton).toBeDefined();
        const reloading = retryButton!.props.onClick();
        expect(request).toHaveBeenCalledTimes(2); expect(state).toEqual({ status: "loading" });
        expect(render(state)).not.toContain(mockMessages.es.vehicles.testDrives.empty);
        resolveRetry({ success: true, data: [{ id: "appointment" }] }); await reloading;
        expect(state).toEqual({ status: "ready", items: [{ id: "appointment" }] });
        expect(updates).toEqual(["loading", "failed", "loading", "ready"]);
    });
    it("accepts a successful empty retry without keeping an earlier error", async () => {
        let state: TestDriveLoadState = { status: "failed" };
        await requestTestDrives(async () => ({ success: true, data: [] }), next => { state = next; });
        expect(state).toEqual({ status: "ready", items: [] });
        expect(render(state)).not.toContain('role="alert"');
    });
});
