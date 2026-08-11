import { sanitizeNavigationPreferences } from "@/lib/navigation-preferences";

describe("sanitizeNavigationPreferences", () => {
  it("deduplicates and bounds favorites", () => {
    const value = sanitizeNavigationPreferences({
      favorites: ["inbox", "inbox", "contacts", "pipeline", "agents", "knowledge", "automation", "broadcast", "analytics", "settings"],
      recents: [],
    });
    expect(value.favorites).toEqual(["inbox", "contacts", "pipeline", "agents", "knowledge", "automation", "broadcast", "analytics"]);
  });

  it("drops malformed and external recent destinations", () => {
    const value = sanitizeNavigationPreferences({
      favorites: [null, "inbox"],
      recents: [
        { routeId: "inbox", href: "/admin/inbox", visitedAt: 2 },
        { routeId: "external", href: "https://example.com", visitedAt: 3 },
        { routeId: "bad", href: "/admin/bad", visitedAt: Number.NaN },
      ],
    });
    expect(value).toEqual({
      favorites: ["inbox"],
      recents: [{ routeId: "inbox", href: "/admin/inbox", visitedAt: 2 }],
    });
  });

  it("drops legacy aliases and unfinished routes from stored navigation", () => {
    const value = sanitizeNavigationPreferences({
      favorites: ["channelSms", "settingsCompany", "inbox"],
      recents: [
        { routeId: "channelSms", href: "/admin/channels/sms", visitedAt: 3 },
        { routeId: "settingsCompany", href: "/admin/settings/company", visitedAt: 2 },
        { routeId: "inbox", href: "/admin/inbox", visitedAt: 1 },
      ],
    });

    expect(value).toEqual({
      favorites: ["inbox"],
      recents: [{ routeId: "inbox", href: "/admin/inbox", visitedAt: 1 }],
    });
  });
});
