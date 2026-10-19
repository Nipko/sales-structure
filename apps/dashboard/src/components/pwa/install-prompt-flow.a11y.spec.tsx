import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import { act } from "react";
import { renderScreen } from "@/test/a11y";
import { InstallPrompt } from "./InstallPrompt";

const mockUser = { onboardingStage: "completed", firstReplyAt: new Date().toISOString() };
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
const SNOOZE_KEY = "pwa-install-snooze-until";

async function offer(choice = "accepted") {
    const prompt = jest.fn();
    await act(async () => {
        const event = new Event("beforeinstallprompt");
        Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: choice }) });
        window.dispatchEvent(event);
    });
    return prompt;
}

describe("the install offer in the page flow", () => {
    beforeEach(() => localStorage.clear());

    it("uses normal flow and adapts to the content width instead of covering fields", async () => {
        const screen = await renderScreen(<InstallPrompt />);
        try {
            await offer();
            const box = screen.container.firstElementChild as HTMLElement;
            expect(box.style.position).not.toBe("fixed");
            expect(box.style.position).not.toBe("absolute");
            expect(box.style.width).toBe("100%");
            expect(box.style.maxWidth).toBe("400px");
            expect(box.style.flexWrap).toBe("wrap");
            expect(box.style.transform).toBe("");
            expect(box.style.zIndex).toBe("");
        } finally { screen.unmount(); }
    });

    it("places the one offer inside the actual dashboard scrolling main", () => {
        const file = path.join(__dirname, "../../app/admin/layout.tsx");
        const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const offers: ts.JsxSelfClosingElement[] = [];
        function visit(node: ts.Node) {
            if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "InstallPrompt") offers.push(node);
            ts.forEachChild(node, visit);
        }
        visit(source);
        expect(offers).toHaveLength(1);
        let insideMain = false;
        for (let node: ts.Node | undefined = offers[0].parent; node; node = node.parent) {
            if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "main") insideMain = true;
        }
        expect(insideMain).toBe(true);
    });

    it("still invokes the deferred install prompt and snoozes an OS dismissal", async () => {
        const screen = await renderScreen(<InstallPrompt />);
        try {
            const prompt = await offer("dismissed");
            const install = [...screen.container.querySelectorAll("button")].find(button => button.textContent === "Instalar")!;
            const before = Date.now();
            await act(async () => install.click());
            expect(prompt).toHaveBeenCalledTimes(1);
            expect(Number(localStorage.getItem(SNOOZE_KEY))).toBeGreaterThanOrEqual(before + 7 * 86_400_000);
            expect(screen.container.textContent).toBe("");
        } finally { screen.unmount(); }
    });

    it("preserves the named close and its thirty-day snooze", async () => {
        const screen = await renderScreen(<InstallPrompt />);
        try {
            await offer();
            const before = Date.now();
            await act(async () => (screen.container.querySelector('[aria-label="Cerrar"]') as HTMLButtonElement).click());
            expect(Number(localStorage.getItem(SNOOZE_KEY))).toBeGreaterThanOrEqual(before + 30 * 86_400_000);
            expect(screen.container.textContent).toBe("");
        } finally { screen.unmount(); }
    });

    it("removes the offer when the app becomes installed", async () => {
        const screen = await renderScreen(<InstallPrompt />);
        try {
            await offer();
            await act(async () => { window.dispatchEvent(new Event("appinstalled")); });
            expect(screen.container.textContent).toBe("");
            expect(localStorage.getItem(SNOOZE_KEY)).toBeNull();
        } finally { screen.unmount(); }
    });
});
