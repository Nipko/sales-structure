const mockSecureStore = new Map<string, string>();

jest.mock('expo-constants', () => ({
    __esModule: true,
    default: {
        executionEnvironment: 'standalone',
        expoConfig: { extra: { eas: { projectId: 'eas-project' } } },
    },
}));
jest.mock('expo-secure-store', () => ({
    getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => { mockSecureStore.set(key, value); }),
    deleteItemAsync: jest.fn(async (key: string) => { mockSecureStore.delete(key); }),
}));
jest.mock('expo-crypto', () => ({
    randomUUID: jest.fn(() => '33333333-3333-4333-8333-333333333333'),
}));
jest.mock('expo-notifications', () => ({
    AndroidImportance: { MAX: 5 },
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
    getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
    requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
    getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExponentPushToken[test-device]' }),
    unregisterForNotificationsAsync: jest.fn().mockResolvedValue(undefined),
    dismissAllNotificationsAsync: jest.fn().mockResolvedValue(undefined),
    clearLastNotificationResponseAsync: jest.fn().mockResolvedValue(undefined),
    scheduleNotificationAsync: jest.fn().mockResolvedValue(undefined),
    setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
    addNotificationResponseReceivedListener: jest.fn(),
    getLastNotificationResponseAsync: jest.fn(),
}));
jest.mock('../api', () => ({
    api: {
        subscribeExpoPush: jest.fn(),
        unsubscribeExpoPush: jest.fn(),
    },
}));
jest.mock('../log', () => ({ log: jest.fn() }));
jest.mock('../notifPrefs', () => ({ isDndActive: jest.fn().mockResolvedValue(false) }));

import { deactivatePushScope, PUSH_LOGOUT_TIMEOUT_MS, registerForPush, unregisterPushForLogout } from '../push';
import { api } from '../api';
import * as Notifications from 'expo-notifications';

const mockSubscribeExpoPush = api.subscribeExpoPush as jest.Mock;
const mockUnsubscribeExpoPush = api.unsubscribeExpoPush as jest.Mock;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('native push session ownership', () => {
    beforeEach(async () => {
        await deactivatePushScope();
        mockSecureStore.clear();
        mockSubscribeExpoPush.mockReset().mockResolvedValue({ success: true });
        mockUnsubscribeExpoPush.mockReset().mockResolvedValue({ success: true });
    });

    it('persists the registered token under the exact user and tenant', async () => {
        await registerForPush('user-1', 'tenant-1');

        expect(mockSubscribeExpoPush).toHaveBeenCalledWith(
            'ExponentPushToken[test-device]',
            '33333333-3333-4333-8333-333333333333',
            expect.any(AbortSignal),
        );
        expect(mockSecureStore.get('parallly_expo_push_tenant-1_user-1')).toBe('ExponentPushToken[test-device]');
    });

    it('unregisters the stored token before deleting its local association', async () => {
        await registerForPush('user-1', 'tenant-1');
        await expect(unregisterPushForLogout('user-1', 'tenant-1')).resolves.toBe(true);

        expect(mockUnsubscribeExpoPush).toHaveBeenCalledWith(
            'ExponentPushToken[test-device]',
            expect.any(AbortSignal),
        );
        expect(mockSecureStore.has('parallly_expo_push_tenant-1_user-1')).toBe(false);
        expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
    });

    it('uses the guarded account-wide cleanup for a legacy registration without a stored token', async () => {
        await expect(unregisterPushForLogout('user-legacy', 'tenant-legacy')).resolves.toBe(true);
        expect(mockUnsubscribeExpoPush).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));
    });

    it('waits for an in-flight registration before revoking at logout', async () => {
        let resolveSubscribe!: (value: any) => void;
        mockSubscribeExpoPush.mockReturnValue(new Promise((resolve) => { resolveSubscribe = resolve; }));

        const registering = registerForPush('user-1', 'tenant-1');
        await tick();
        expect(mockSubscribeExpoPush).toHaveBeenCalledTimes(1);

        const unregistering = unregisterPushForLogout('user-1', 'tenant-1');
        expect(mockUnsubscribeExpoPush).not.toHaveBeenCalled();
        resolveSubscribe({ success: true });
        await registering;
        await unregistering;

        expect(mockUnsubscribeExpoPush).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));
        expect(mockUnsubscribeExpoPush.mock.invocationCallOrder[0])
            .toBeGreaterThan(mockSubscribeExpoPush.mock.invocationCallOrder[0]);
    });

    it('re-registers the same installation for a second account after auth failure cleanup', async () => {
        await registerForPush('user-1', 'tenant-1');
        await deactivatePushScope();
        await registerForPush('user-2', 'tenant-2');

        expect(mockSubscribeExpoPush).toHaveBeenNthCalledWith(
            2,
            'ExponentPushToken[test-device]',
            '33333333-3333-4333-8333-333333333333',
            expect.any(AbortSignal),
        );
        expect(mockSecureStore.has('parallly_expo_push_tenant-1_user-1')).toBe(false);
        expect(mockSecureStore.get('parallly_expo_push_tenant-2_user-2')).toBe('ExponentPushToken[test-device]');
    });

    it('finishes local logout cleanup when the backend unsubscribe never responds', async () => {
        jest.useFakeTimers();
        try {
            mockSecureStore.set('parallly_expo_push_tenant-1_user-1', 'ExponentPushToken[test-device]');
            mockUnsubscribeExpoPush.mockReturnValue(new Promise(() => undefined));

            const pending = unregisterPushForLogout('user-1', 'tenant-1');
            await Promise.resolve();
            jest.advanceTimersByTime(PUSH_LOGOUT_TIMEOUT_MS);
            await expect(pending).resolves.toBe(false);

            expect(mockSecureStore.has('parallly_expo_push_tenant-1_user-1')).toBe(false);
            expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });
});
