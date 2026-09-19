import { createElement } from "react";
import { api } from "@/lib/api";
import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import FirstOperationalReplyCard from "./FirstOperationalReplyCard";

jest.mock("@/lib/api", () => ({
  api: { getSetupStatus: jest.fn() },
}));

describe("the first operational reply guide", () => {
  beforeEach(() => {
    jest.mocked(api.getSetupStatus).mockResolvedValue({
      success: true,
      data: {
        hasAnyChannel: true,
        connectedChannelTypes: ["whatsapp"],
        firstReplyAt: null,
      },
    } as any);
  });

  it("states the evidence limit and offers one check plus Inbox", async () => {
    const onVerified = jest.fn();
    const screen = await renderScreen(createElement(FirstOperationalReplyCard, {
      tenantId: "11111111-1111-4111-8111-111111111111",
      agentName: "Sofía",
      connectedChannelTypes: ["whatsapp"],
      onVerified,
    }));
    try {
      expect(screen.container.querySelector("h2")?.textContent).toBe("Comprueba la primera respuesta de Sofía");
      expect(screen.container.textContent).toContain("Eso no afirma que el proveedor la marcó como leída");
      expect(screen.container.querySelector('a[href="/admin/inbox"]')?.textContent).toContain("Abrir Inbox");
      const button = screen.container.querySelector("button") as HTMLButtonElement;
      await interact(() => button.click());
      expect(api.getSetupStatus).toHaveBeenCalled();
      expect(screen.container.textContent).toContain("Todavía no vemos una respuesta operativa");
      expect(await findAccessibilityViolations(screen.container)).toEqual([]);
    } finally {
      screen.unmount();
    }
  });
});
