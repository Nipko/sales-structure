import { AGENT_CONFIG_TOOL_FAMILIES, VERTICAL_TOOL_GROUPS, listVerticalCapabilityConfigurations } from "@parallext/shared";
import { resolveAgentToolAvailability } from "./agent-tool-availability";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("agent editor capability admission", () => {
  it.each(["es", "en", "pt", "fr"])("explains every unavailability in %s without replacing the availability label", (locale) => {
    const messages = JSON.parse(readFileSync(join(__dirname, "../../messages", `${locale}.json`), "utf8"));
    expect(typeof messages.agent.capabilities.availability).toBe("string");
    for (const reason of ["profile_unknown", "not_in_subtype", "plan_unknown", "plan_missing_feature"]) {
      expect(messages.agent.capabilities.toolAvailabilityState[reason]).toEqual(expect.any(String));
    }
  });
  it.each(listVerticalCapabilityConfigurations().map(profile => [
    `${profile.industry}/${profile.subtype}`, profile,
  ] as const))("offers exactly the subtype families for %s", (_name, profile) => {
    const availability = resolveAgentToolAvailability(profile, {}, { customerPayments: true });
    for (const family of VERTICAL_TOOL_GROUPS) {
      expect({ family, ...availability[family] }).toEqual({
        family, visible: profile.toolGroups.includes(family),
        canEnable: profile.toolGroups.includes(family),
        reason: profile.toolGroups.includes(family) ? null : "not_in_subtype",
      });
    }
    for (const family of AGENT_CONFIG_TOOL_FAMILIES.filter(family => !(VERTICAL_TOOL_GROUPS as readonly string[]).includes(family))) {
      expect(availability[family]).toEqual({ visible: true, canEnable: true, reason: null });
    }
    const allEnabled = Object.fromEntries(AGENT_CONFIG_TOOL_FAMILIES.map(family => [family, { enabled: true }]));
    const legacy = resolveAgentToolAvailability(profile, allEnabled, { customerPayments: true });
    for (const family of VERTICAL_TOOL_GROUPS.filter(family => !profile.toolGroups.includes(family))) {
      expect(legacy[family]).toEqual({ visible: true, canEnable: false, reason: "not_in_subtype" });
    }
  });

  it("never guesses a subtype or a paid entitlement", () => {
    for (const vertical of [null, { industry: "turismo" }, { industry: "turismo", subType: "invented" }]) {
      const result = resolveAgentToolAvailability(vertical, { properties: { enabled: true } }, null);
      expect(result.properties).toEqual({ visible: true, canEnable: false, reason: "profile_unknown" });
      expect(result.tours).toEqual({ visible: false, canEnable: false, reason: "profile_unknown" });
      expect(result.crm.canEnable).toBe(true);
      expect(result.payments).toEqual({ visible: true, canEnable: false, reason: "plan_unknown" });
    }
    expect(resolveAgentToolAvailability(null, {}, { customerPayments: false }).payments.reason).toBe("plan_missing_feature");
  });
});
