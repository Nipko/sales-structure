import {
  buildEssentialSetupItems,
  resolveInitialSetupSources,
  type QualityCheckStatuses,
} from "./initial-setup";

const allowAll = () => true;

const READY: QualityCheckStatuses = {
  persona_identity: "pass",
  fallback_message: "pass",
  behavior_rules: "pass",
  handoff_triggers: "pass",
  business_identity: "pass",
  knowledge_coverage: "pass",
  human_handoff_route: "pass",
};

function overview(checks: QualityCheckStatuses) {
  return {
    success: true,
    data: {
      preparation: {
        dimensions: [
          {
            dimension: "business_scope",
            checks: Object.entries(checks).map(([code, status]) => ({ code, status, critical: true })),
          },
        ],
      },
    },
  };
}

describe("buildEssentialSetupItems", () => {
  it("derives every essential from the agent's own preparation checks", () => {
    const items = buildEssentialSetupItems({
      status: { setupWizardChannels: ["whatsapp"] },
      planChannels: ["whatsapp"],
      activeChannels: ["whatsapp"],
      checks: READY,
      canAccess: allowAll,
    });

    expect(items).toEqual([
      { key: "channel", href: "/admin/channels/whatsapp", done: true, tourId: "first_channel_whatsapp" },
      { key: "agent", href: "/admin/agent", done: true, tourId: "agent_handoff_rules" },
      { key: "business", href: "/admin/settings/business-info", done: true, tourId: "business_identity" },
      { key: "knowledge", href: "/admin/knowledge", done: true, tourId: "knowledge_base" },
      { key: "team", href: "/admin/users", done: true, tourId: "human_handoff_route" },
    ]);
  });

  it("keeps 'review your agent' pending while any of its checks still fails", () => {
    const items = buildEssentialSetupItems({
      status: {},
      planChannels: ["whatsapp"],
      activeChannels: [],
      checks: { ...READY, handoff_triggers: "fail" },
      canAccess: allowAll,
    });

    expect(items.find((item) => item.key === "agent")?.done).toBe(false);
    expect(items.find((item) => item.key === "channel")?.done).toBe(false);
  });

  it("treats a check that does not apply to the industry as settled", () => {
    const items = buildEssentialSetupItems({
      status: {},
      planChannels: ["whatsapp"],
      activeChannels: [],
      checks: { ...READY, behavior_rules: "not_applicable" },
      canAccess: allowAll,
    });

    expect(items.find((item) => item.key === "agent")?.done).toBe(true);
  });

  it("shows the schedule item only for businesses that book appointments", () => {
    const withoutAppointments = buildEssentialSetupItems({
      status: {},
      planChannels: ["whatsapp"],
      activeChannels: [],
      checks: { ...READY, tool_appointments: "not_applicable" },
      canAccess: allowAll,
    });
    expect(withoutAppointments.some((item) => item.key === "hours")).toBe(false);

    const withAppointments = buildEssentialSetupItems({
      status: {},
      planChannels: ["whatsapp"],
      activeChannels: [],
      checks: { ...READY, tool_appointments: "fail", business_hours: "pass" },
      canAccess: allowAll,
    });
    expect(withAppointments.find((item) => item.key === "hours"))
      .toEqual({ key: "hours", href: "/admin/settings/business-hours", done: false, tourId: "business_hours" });
  });

  it("never marks a group done from checks that were never evaluated", () => {
    const items = buildEssentialSetupItems({
      status: {},
      planChannels: ["whatsapp"],
      activeChannels: [],
      checks: {},
      canAccess: allowAll,
    });

    expect(items.filter((item) => item.done)).toEqual([]);
  });

  it("uses the selected certified channel when the plan allows it", () => {
    const items = buildEssentialSetupItems({
      status: { setupWizardChannels: ["instagram"] },
      planChannels: ["whatsapp", "instagram", "email"],
      activeChannels: ["instagram"],
      checks: READY,
      canAccess: allowAll,
    });

    expect(items[0]).toEqual({
      key: "channel",
      href: "/admin/channels/instagram",
      done: true,
      tourId: "connect_channel",
    });
  });

  it("replaces generic knowledge with the vertical's operational catalog", () => {
    const items = buildEssentialSetupItems({
      status: { hasVerticalCatalog: false, verticalCatalogRoute: "/admin/menu" },
      planChannels: ["whatsapp"],
      activeChannels: [],
      checks: { ...READY, knowledge_coverage: "fail" },
      canAccess: allowAll,
    });

    expect(items.find((item) => item.key === "catalog"))
      .toEqual({ key: "catalog", href: "/admin/menu", done: false, tourId: null });
    expect(items.some((item) => item.key === "knowledge")).toBe(false);
  });

  it("does not expose routes the current role cannot open", () => {
    const items = buildEssentialSetupItems({
      status: {},
      planChannels: ["whatsapp"],
      activeChannels: [],
      checks: READY,
      canAccess: (href) => href === "/admin/knowledge",
    });

    expect(items).toEqual([
      { key: "knowledge", href: "/admin/knowledge", done: true, tourId: "knowledge_base" },
    ]);
  });
});

describe("resolveInitialSetupSources", () => {
  const validStatus = { success: true, data: { hasPersona: true } };
  const validPlan = { success: true, data: { channels: ["whatsapp"] } };
  const validChannels = { success: true, data: [{ channelType: "whatsapp", isActive: true }] };

  it("returns only verified plan, channel and quality data", () => {
    expect(resolveInitialSetupSources(validStatus, validPlan, validChannels, overview(READY))).toEqual({
      status: { hasPersona: true },
      planChannels: ["whatsapp"],
      activeChannels: ["whatsapp"],
      checks: READY,
    });
  });

  it("reads an absent overview as 'this tenant has no agent yet', not as an error", () => {
    expect(resolveInitialSetupSources(validStatus, validPlan, validChannels).checks).toEqual({});
  });

  it.each([
    ["plan unavailable", validStatus, { success: false, data: null }, validChannels, undefined],
    ["plan channels invalid", validStatus, { success: true, data: {} }, validChannels, undefined],
    ["channels unavailable", validStatus, validPlan, { success: false, data: [] }, undefined],
    ["channel shape invalid", validStatus, validPlan, { success: true, data: [{ channelType: "whatsapp" }] }, undefined],
    ["status unavailable", { success: false }, validPlan, validChannels, undefined],
    ["quality request failed", validStatus, validPlan, validChannels, { success: false, error: "boom" }],
    ["quality shape invalid", validStatus, validPlan, validChannels, { success: true, data: { preparation: {} } }],
  ])("fails closed when %s", (_label, status, plan, channels, quality) => {
    expect(() => resolveInitialSetupSources(status, plan, channels, quality)).toThrow();
  });

  it("ignores malformed individual checks instead of trusting them", () => {
    const noisy = {
      success: true,
      data: {
        preparation: {
          dimensions: [
            { checks: [{ code: "business_identity", status: "pass" }, { code: "", status: "pass" }, { status: "pass" }] },
            { checks: [{ code: "human_handoff_route", status: "not_a_status" }] },
            { notChecks: true },
          ],
        },
      },
    };

    expect(resolveInitialSetupSources(validStatus, validPlan, validChannels, noisy).checks)
      .toEqual({ business_identity: "pass" });
  });
});
