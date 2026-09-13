import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_CATEGORY_KEYS,
  normalizeNotificationPreferences,
} from "./notification-preferences";

describe("notification preference contract", () => {
  it("keeps every visible category in the persisted contract", () => {
    expect(Object.keys(DEFAULT_NOTIFICATION_PREFERENCES.categories).sort())
      .toEqual([...NOTIFICATION_CATEGORY_KEYS].sort());
  });

  it("fills legacy partial values without enabling optional noise", () => {
    expect(normalizeNotificationPreferences({ categories: { orders: true } })).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      categories: { ...DEFAULT_NOTIFICATION_PREFERENCES.categories, orders: true },
    });
  });
});
