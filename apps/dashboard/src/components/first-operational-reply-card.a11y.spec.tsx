import { createElement } from "react";
import { api } from "@/lib/api";
import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import FirstOperationalReplyCard from "./FirstOperationalReplyCard";

jest.mock("@/lib/api", () => ({
  api: { getSetupStatus: jest.fn() },
}));

describe("the first operational reply guide", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(api.getSetupStatus).mockResolvedValue({
      success: true,
      data: {
        hasAnyChannel: true,
        connectedChannelTypes: ["whatsapp"],
        firstReplyAt: null,
      },
    } as any);
  });

  it("offers the known bot link and only reads evidence when checking", async () => {
    const screen = await renderScreen(createElement(FirstOperationalReplyCard, {
      tenantId: "11111111-1111-4111-8111-111111111111",
      connectedChannelTypes: ["telegram"],
      testChannel: { href: "https://t.me/tienda_bot", name: "Telegram" },
      onVerified: jest.fn(),
    }));
    try {
      const link = screen.container.querySelector('a[href="https://t.me/tienda_bot"]');
      expect(link?.textContent).toContain("Abrir Telegram");
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(screen.container.textContent).not.toContain("La configuración está lista");
      await interact(() => (screen.container.querySelector("button") as HTMLButtonElement).click());
      expect(api.getSetupStatus).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
      expect(await findAccessibilityViolations(screen.container)).toEqual([]);
    } finally { screen.unmount(); }
  });

  it("distinguishes an unavailable check from a successful check with no reply", async () => {
    const screen = await renderScreen(createElement(FirstOperationalReplyCard, {
      tenantId: "11111111-1111-4111-8111-111111111111",
      connectedChannelTypes: ["telegram"],
      onVerified: jest.fn(),
    }));
    try {
      jest.mocked(api.getSetupStatus).mockRejectedValueOnce(new Error("network unavailable"));
      const button = screen.container.querySelector("button") as HTMLButtonElement;
      await interact(() => button.click());
      expect(screen.container.querySelector('[role="status"]')?.textContent).toContain("No pudimos consultar las respuestas");
      expect(screen.container.textContent).not.toContain("Todavía no vemos una respuesta operativa");
      expect(button.textContent).toContain("Reintentar comprobación");
      await interact(() => button.click());
      expect(screen.container.querySelector('[role="status"]')?.textContent).toContain("Todavía no vemos una respuesta operativa");
      expect(button.textContent).toContain("Comprobar ahora");
    } finally { screen.unmount(); }
  });

  it("does not turn an unreadable status response into a claim that no reply exists", async () => {
    jest.mocked(api.getSetupStatus).mockResolvedValue({ success: false } as any);
    const screen = await renderScreen(createElement(FirstOperationalReplyCard, {
      tenantId: "11111111-1111-4111-8111-111111111111",
      connectedChannelTypes: ["telegram"],
      onVerified: jest.fn(),
    }));
    try {
      expect(screen.container.textContent).toContain("No pudimos consultar las respuestas");
      expect(screen.container.textContent).not.toContain("Todavía no vemos una respuesta operativa");
    } finally { screen.unmount(); }
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
