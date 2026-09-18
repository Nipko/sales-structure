import { renderScreen, findAccessibilityViolations } from "@/test/a11y";
import OptionalSetupPaths from "./OptionalSetupPaths";

const AGENT = "22222222-2222-4222-8222-222222222222";

describe("optional setup paths", () => {
    it("offers only supported, reviewable inputs and preserves the wizard", async () => {
        const screen = await renderScreen(<OptionalSetupPaths agentId={AGENT} />);
        try {
            const links = [...screen.container.querySelectorAll("a")] as HTMLAnchorElement[];
            expect(links.map((link) => link.getAttribute("href"))).toEqual([
                "/admin/knowledge",
                `/admin/agent/${AGENT}/learning`,
                "/admin/agent/simulation",
            ]);
            for (const link of links) {
                expect(link.getAttribute("target")).toBe("_blank");
                expect(link.getAttribute("rel")).toBe("noopener noreferrer");
                expect(document.getElementById(link.getAttribute("aria-describedby") || "")?.textContent?.length)
                    .toBeGreaterThan(30);
            }
            expect(screen.container.textContent).toMatch(/fotos|audios/i);
            expect(screen.container.textContent).toMatch(/no se importan/i);
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("does not invent a learning destination before the agent exists", async () => {
        const screen = await renderScreen(<OptionalSetupPaths agentId={null} />);
        try {
            expect(screen.container.querySelectorAll("a")).toHaveLength(2);
            expect(screen.container.querySelector('[href*="/learning"]')).toBeNull();
        } finally {
            screen.unmount();
        }
    });
});
