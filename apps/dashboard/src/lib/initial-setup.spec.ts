import { buildEssentialSetupItems, resolveInitialSetupSources } from "./initial-setup";

const allowAll = () => true;

describe("buildEssentialSetupItems", () => {
  it("only includes essentials available to an Emprendedor tenant", () => {
    expect(buildEssentialSetupItems({
      status: { hasPersona: true, hasKnowledge: false, setupWizardChannels: ["instagram"] },
      planChannels: ["whatsapp"],
      activeChannels: ["whatsapp"],
      canAccess: allowAll,
    })).toEqual([
      { key: "agent", href: "/admin/agent", done: true },
      { key: "channel", href: "/admin/channels/whatsapp", done: true },
      { key: "knowledge", href: "/admin/knowledge", done: false },
    ]);
  });

  it("uses the selected certified channel when the plan allows it", () => {
    expect(buildEssentialSetupItems({
      status: { hasPersona: true, hasKnowledge: true, setupWizardChannels: ["instagram"] },
      planChannels: ["whatsapp", "instagram", "email"],
      activeChannels: ["instagram"],
      canAccess: allowAll,
    })[1]).toEqual({ key: "channel", href: "/admin/channels/instagram", done: true });
  });

  it("replaces generic knowledge with the vertical's operational catalog", () => {
    expect(buildEssentialSetupItems({
      status: {
        hasPersona: true,
        hasKnowledge: true,
        hasVerticalCatalog: false,
        verticalCatalogRoute: "/admin/menu",
      },
      planChannels: ["whatsapp"],
      activeChannels: [],
      canAccess: allowAll,
    }).at(-1)).toEqual({ key: "catalog", href: "/admin/menu", done: false });
  });

  it("does not expose routes the current role cannot open", () => {
    expect(buildEssentialSetupItems({
      status: { hasPersona: false, hasKnowledge: false },
      planChannels: ["whatsapp"],
      activeChannels: [],
      canAccess: (href) => href === "/admin/knowledge",
    })).toEqual([{ key: "knowledge", href: "/admin/knowledge", done: false }]);
  });
});

describe("resolveInitialSetupSources", () => {
  const validStatus = { success: true, data: { hasPersona: true } };
  const validPlan = { success: true, data: { channels: ["whatsapp"] } };
  const validChannels = { success: true, data: [{ channelType: "whatsapp", isActive: true }] };

  it("returns only verified plan and channel data", () => {
    expect(resolveInitialSetupSources(validStatus, validPlan, validChannels)).toEqual({
      status: { hasPersona: true },
      planChannels: ["whatsapp"],
      activeChannels: ["whatsapp"],
    });
  });

  it.each([
    [validStatus, { success: false, data: null }, validChannels],
    [validStatus, { success: true, data: {} }, validChannels],
    [validStatus, validPlan, { success: false, data: [] }],
    [validStatus, validPlan, { success: true, data: [{ channelType: "whatsapp" }] }],
  ])("fails closed when a source cannot be verified", (status, plan, channels) => {
    expect(() => resolveInitialSetupSources(status, plan, channels)).toThrow();
  });
});
