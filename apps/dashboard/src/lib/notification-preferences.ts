export const NOTIFICATION_CATEGORY_KEYS = [
  "chat", "handoff", "compliance", "appointments", "automation", "orders", "system",
] as const;

export type NotificationCategoryKey = typeof NOTIFICATION_CATEGORY_KEYS[number];

export type NotificationPreferences = {
  version: 1;
  soundEnabled: boolean;
  categories: Record<NotificationCategoryKey, boolean>;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  version: 1,
  soundEnabled: true,
  categories: {
    chat: true,
    handoff: true,
    compliance: true,
    appointments: true,
    automation: false,
    orders: false,
    system: true,
  },
};

export function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any> : {};
  const categories = input.categories && typeof input.categories === "object"
    && !Array.isArray(input.categories) ? input.categories as Record<string, unknown> : {};
  return {
    version: 1,
    soundEnabled: typeof input.soundEnabled === "boolean"
      ? input.soundEnabled : DEFAULT_NOTIFICATION_PREFERENCES.soundEnabled,
    categories: Object.fromEntries(NOTIFICATION_CATEGORY_KEYS.map((key) => [
      key,
      typeof categories[key] === "boolean"
        ? categories[key] : DEFAULT_NOTIFICATION_PREFERENCES.categories[key],
    ])) as Record<NotificationCategoryKey, boolean>,
  };
}
