import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import { QUALITY_ASSIST_EVENT, parseQualityAssistantDetail } from "@/lib/quality-assistant-contract";
import { AgentGuideCards } from "./AgentGuideCards";
import type { PersonaConfig } from "../_types";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a> }));

const AGENT = "22222222-2222-4222-8222-222222222222";
const config = { tools: { appointments: { enabled: true }, faqs: { enabled: true }, catalog: { enabled: false } } } as PersonaConfig;

describe("agent guide cards", () => {
  it("uses the same four business decisions to navigate canonical settings", async () => {
    const onSelectTab = jest.fn();
    let detail: unknown;
    const listener = (event: Event) => { detail = (event as CustomEvent).detail; };
    window.addEventListener(QUALITY_ASSIST_EVENT, listener);
    const screen = await renderScreen(<AgentGuideCards agentId={AGENT} agentName="Ana" config={config} onSelectTab={onSelectTab} />);
    try {
      const text = screen.container.textContent ?? "";
      expect(text).toContain("Qué ofreces");
      expect(text).toContain("Dónde y cuándo atiendes");
      expect(text).toContain("Cómo compran o reservan");
      expect(text).toContain("Preguntas frecuentes");
      await interact(() => Array.from(screen.container.querySelectorAll("button")).find((button) => button.textContent === "Revisar horarios")!.click());
      expect(onSelectTab).toHaveBeenCalledWith("schedule");
      await interact(() => Array.from(screen.container.querySelectorAll("button")).find((button) => button.textContent?.includes("Pedir ayuda a Assist"))!.click());
      expect(parseQualityAssistantDetail(detail)).toMatchObject({ agentId: AGENT, agentName: "Ana", send: undefined });
      expect(await findAccessibilityViolations(screen.container)).toEqual([]);
    } finally {
      window.removeEventListener(QUALITY_ASSIST_EVENT, listener);
      screen.unmount();
    }
  });
});
