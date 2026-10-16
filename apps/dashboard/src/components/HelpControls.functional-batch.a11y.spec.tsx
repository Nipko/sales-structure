import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import * as fs from "fs";
import * as path from "path";
import { HelpPanel } from "./ui/help-panel";
import { HelpAssistant } from "./HelpAssistant";
jest.mock("@/lib/api", () => ({ api: { copilotChat: jest.fn() } }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "qa", role: "tenant_admin", tenantId: "11111111-1111-4111-8111-111111111111", onboardingStage: "agent_reviewed" } }) }));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "11111111-1111-4111-8111-111111111111" }) }));
jest.mock("@/hooks/useRole", () => ({ useRole: () => ({ role: "tenant_admin", canEditAgent: true }) }));
jest.mock("next/navigation", () => ({ usePathname: () => "/admin/agent", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
const { api } = jest.requireMock("@/lib/api");
async function settle() { await act(async () => { await Promise.resolve(); }); }
describe.each(["es", "en", "pt", "fr"])("published help controls local regression in %s", locale => {
  const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../messages", locale + ".json"), "utf8"));
  beforeEach(() => { api.copilotChat.mockReset().mockImplementation(() => { throw new Error("Unexpected chat send"); }); sessionStorage.clear(); localStorage.clear(); });
  async function mounted(element: React.ReactElement, check: (c: HTMLElement) => Promise<void>) {
    for (const v of [messages.common.close, messages.helpAssistant.chat.send]) expect(typeof v).toBe("string");
    const c = document.createElement("div"); document.body.appendChild(c); const root = createRoot(c);
    try { await act(async () => root.render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Bogota">{element}</NextIntlClientProvider>)); await settle(); await check(c); expect(api.copilotChat).not.toHaveBeenCalled(); }
    finally { act(() => root.unmount()); c.remove(); }
  }
  it("P1 contextual help has named close and transfers keyboard focus on expand and collapse", async () => {
    await mounted(<HelpPanel title={messages.help.agent.title} description={messages.help.agent.description} tips={messages.help.agent.tips} />, async c => {
      let trigger = c.querySelector("button")!; trigger.focus();
      await act(async () => trigger.click()); await settle();
      expect(c.querySelector("h3")?.textContent).toBe(messages.help.agent.title);
      const close = Array.from(c.querySelectorAll("button")).find(x => x.getAttribute("aria-label") === messages.common.close);
      expect(close).toBeDefined();
      expect(document.activeElement).toBe(close);
      await act(async () => close!.click()); await settle();
      trigger = c.querySelector("button")!;
      expect(c.querySelector("h3")).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(trigger.textContent).toContain(messages.help.agent.title);
    });
  });
  it("P2 an initially expanded inline panel does not steal focus", async () => {
    const anchor = document.createElement("button"); document.body.appendChild(anchor); anchor.focus();
    try { await mounted(<HelpPanel title={messages.help.agent.title} description={messages.help.agent.description} defaultOpen />, async c => {
      expect(c.querySelector("h3")?.textContent).toBe(messages.help.agent.title);
      expect(document.activeElement).toBe(anchor);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    }); } finally { anchor.remove(); }
  });
  it("A1 generic Assist identifies sending and closing with locale-specific action names", async () => {
    await mounted(<HelpAssistant />, async () => {
      await act(async () => window.dispatchEvent(new CustomEvent("parallly:open-copilot"))); await settle();
      const d = document.querySelector('[role="dialog"]')!;
      const submit = d.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      expect(submit.disabled).toBe(true);
      expect(submit.getAttribute("aria-label")).toBe(messages.helpAssistant.chat.send);
      expect(Array.from(d.querySelectorAll("button")).some(x => x.textContent?.trim() === messages.common.close)).toBe(true);
    });
  });
});
