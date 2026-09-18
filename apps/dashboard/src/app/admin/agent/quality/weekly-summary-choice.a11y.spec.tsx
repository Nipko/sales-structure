import { renderScreen, findAccessibilityViolations } from "@/test/a11y";
import { WeeklySummaryChoice } from "./WeeklySummaryChoice";

describe("weekly summary delivery choice", () => {
  it("offers the existing opt-in email report without promising WhatsApp delivery", async () => {
    const screen = await renderScreen(<WeeklySummaryChoice />);
    try {
      const link = screen.container.querySelector("a");
      expect(link?.getAttribute("href")).toBe("/admin/settings/alerts");
      expect(screen.container.textContent).toMatch(/correo/i);
      expect(screen.container.textContent).toMatch(/WhatsApp/);
      expect(screen.container.textContent).toMatch(/no está disponible/i);
      expect(await findAccessibilityViolations(screen.container)).toEqual([]);
    } finally {
      screen.unmount();
    }
  });
});
