import { BadRequestException } from '@nestjs/common';

export const NOTIFICATION_CATEGORIES = [
    'chat', 'handoff', 'compliance', 'appointments', 'automation', 'orders', 'system',
] as const;

export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number];

export interface NotificationPreferences {
    version: 1;
    soundEnabled: boolean;
    categories: Record<NotificationCategory, boolean>;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = Object.freeze({
    version: 1,
    soundEnabled: true,
    categories: Object.freeze({
        chat: true,
        handoff: true,
        compliance: true,
        appointments: true,
        automation: false,
        orders: false,
        system: true,
    }),
});

export function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
    const input = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any> : {};
    const categories = input.categories && typeof input.categories === 'object'
        && !Array.isArray(input.categories) ? input.categories as Record<string, unknown> : {};
    return {
        version: 1,
        soundEnabled: typeof input.soundEnabled === 'boolean'
            ? input.soundEnabled : DEFAULT_NOTIFICATION_PREFERENCES.soundEnabled,
        categories: Object.fromEntries(NOTIFICATION_CATEGORIES.map(category => [
            category,
            typeof categories[category] === 'boolean'
                ? categories[category] : DEFAULT_NOTIFICATION_PREFERENCES.categories[category],
        ])) as Record<NotificationCategory, boolean>,
    };
}

export function validateNotificationPreferences(value: unknown): NotificationPreferences {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new BadRequestException('notification_preferences_invalid');
    }
    const input = value as Record<string, unknown>;
    if (typeof input.soundEnabled !== 'boolean'
        || !input.categories || typeof input.categories !== 'object' || Array.isArray(input.categories)) {
        throw new BadRequestException('notification_preferences_invalid');
    }
    const categories = input.categories as Record<string, unknown>;
    const unknown = Object.keys(categories).filter(key => !NOTIFICATION_CATEGORIES.includes(key as any));
    if (unknown.length || NOTIFICATION_CATEGORIES.some(key => typeof categories[key] !== 'boolean')) {
        throw new BadRequestException('notification_preferences_invalid');
    }
    return normalizeNotificationPreferences(input);
}
