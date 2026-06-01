import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { api } from './api';

// Show notifications while the app is foregrounded.
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        // SDK 53+ keys (older keys above are ignored on new versions):
        shouldShowBanner: true,
        shouldShowList: true,
    }) as any,
});

/**
 * Request permission, get the Expo push token and register it on the backend.
 * Degrades gracefully if there's no EAS projectId (run `eas init`) or on a
 * simulator — push simply stays off until those are set up.
 */
export async function registerForPush(): Promise<void> {
    try {
        if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync('default', {
                name: 'Parallly',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#6c5ce7',
            });
        }

        const existing = await Notifications.getPermissionsAsync();
        let status = existing.status;
        if (status !== 'granted') {
            const req = await Notifications.requestPermissionsAsync();
            status = req.status;
        }
        if (status !== 'granted') return;

        const projectId =
            (Constants.expoConfig as any)?.extra?.eas?.projectId ||
            (Constants as any)?.easConfig?.projectId;

        const tokenResp = await Notifications.getExpoPushTokenAsync(
            projectId ? { projectId } : undefined,
        );
        const token = tokenResp.data;
        if (token) await api.subscribeExpoPush(token);
    } catch (e: any) {
        // Most common in Expo Go without EAS init, or on emulators.
        console.log('[push] registration skipped:', e?.message);
    }
}

/** Subscribe to notification taps → returns the subscription to clean up. */
export function onNotificationTap(handler: (data: any) => void) {
    return Notifications.addNotificationResponseReceivedListener((response) => {
        handler(response?.notification?.request?.content?.data || {});
    });
}

/** Notification that cold-started the app (tapped while closed), if any. */
export async function getColdStartData(): Promise<any | null> {
    try {
        const r = await Notifications.getLastNotificationResponseAsync();
        return r?.notification?.request?.content?.data || null;
    } catch {
        return null;
    }
}
