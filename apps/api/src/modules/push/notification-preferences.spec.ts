import { BadRequestException } from '@nestjs/common';
import {
    DEFAULT_NOTIFICATION_PREFERENCES,
    normalizeNotificationPreferences,
    validateNotificationPreferences,
} from './notification-preferences';

describe('notification preference contract', () => {
    it('fills missing legacy values from the declared defaults', () => {
        expect(normalizeNotificationPreferences({ categories: { orders: true } })).toEqual({
            ...DEFAULT_NOTIFICATION_PREFERENCES,
            categories: { ...DEFAULT_NOTIFICATION_PREFERENCES.categories, orders: true },
        });
    });

    it('requires every supported category and rejects invented ones on writes', () => {
        expect(() => validateNotificationPreferences({
            soundEnabled: true,
            categories: { ...DEFAULT_NOTIFICATION_PREFERENCES.categories, invented: true },
        })).toThrow(BadRequestException);
        expect(() => validateNotificationPreferences({
            soundEnabled: true,
            categories: { chat: true },
        })).toThrow(BadRequestException);
    });
});
