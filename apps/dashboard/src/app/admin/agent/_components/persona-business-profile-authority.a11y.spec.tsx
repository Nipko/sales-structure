import { useState } from "react";
import { interact, renderScreen } from "@/test/a11y";
import { PersonaTab } from "./PersonaTab";
import { defaultConfig, type PersonaConfig } from "../_types";

const context = {
  verticalConfig: { industry: "event_planning", subType: "event_venue" },
  isVerticalConfigLoading: false,
};
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => context }));

function Editor() {
  const [config, setConfig] = useState<PersonaConfig>({
    ...defaultConfig,
    industry: "inmobiliaria",
  });
  return <PersonaTab config={config}
    onChange={updates => setConfig(previous => ({ ...previous, ...updates }))} />;
}

describe("the agent editor uses the tenant business profile", () => {
  it("shows the authoritative vertical and subtype as read-only", async () => {
    const screen = await renderScreen(<Editor />);
    try {
      const input = Array.from(screen.container.querySelectorAll("input"))
        .find(element => element.value === "event planning / event venue")!;
      expect(input).toBeTruthy();
      expect(input.readOnly).toBe(true);
      expect(screen.container.textContent).not.toContain("inmobiliaria");
      expect(screen.container.textContent).toContain("se administra una sola vez");
      expect(Array.from(screen.container.querySelectorAll("option")).map(option => option.value))
        .toEqual(expect.arrayContaining(["es-CO", "es-MX", "en-US", "pt-BR", "fr-FR"]));
      await interact(() => input.focus());
      expect(input.value).toBe("event planning / event venue");
    } finally { screen.unmount(); }
  });
});
