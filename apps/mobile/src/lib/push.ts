import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { api } from './api';
import { log } from './log';

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
    // Expo Go (storeClient) dropped remote push in SDK 53 — skip cleanly to avoid
    // noisy errors. Push activates in a development/production build (eas build).
    if (Constants.executionEnvironment === 'storeClient') {
        log('[push] Expo Go detected — remote push needs a development build (eas build).');
        return;
    }
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
        if (token) {
            log('[push] Expo token:', token); // temp: pega esto en expo.dev/notifications para probar
            await api.subscribeExpoPush(token);
        }
    } catch (e: any) {
        // Most common in Expo Go without EAS init, or on emulators.
        log('[push] registration skipped:', e?.message);
    }
}

/**
 * Show a LOCAL notification immediately. Works without EAS/FCM as long as the app
 * process is alive (foreground or backgrounded with the socket still connected) —
 * used for real-time handoff alerts. True push when the app is CLOSED still needs
 * an Expo push token (eas init + Android FCM); see registerForPush.
 */
export async function presentLocalNotification(title: string, body: string, data?: any) {
    try {
        await Notifications.scheduleNotificationAsync({
            content: { title, body, data: data || {}, sound: true },
            trigger: null, // deliver now
        });
    } catch (e: any) {
        log('[push] local notification failed:', e?.message);
    }
}

/**
 * Register the 'message' notification category so handoff/message notifications
 * show "Responder" (inline text) + "Abrir" quick actions. The backend stamps
 * categoryId='message' on those pushes (push.service).
 */
export async function registerNotificationCategories() {
    try {
        await Notifications.setNotificationCategoryAsync('message', [
            {
                identifier: 'reply',
                buttonTitle: 'Responder',
                textInput: { submitButtonTitle: 'Enviar', placeholder: 'Escribe una respuesta…' },
            },
            { identifier: 'open', buttonTitle: 'Abrir' },
        ]);
    } catch (e: any) {
        log('[push] category registration skipped:', e?.message);
    }
}

export interface NotificationResponseInfo { data: any; actionIdentifier: string; userText?: string }

/** Subscribe to notification taps/actions → returns the subscription to clean up. */
export function onNotificationTap(handler: (info: NotificationResponseInfo) => void) {
    return Notifications.addNotificationResponseReceivedListener((response) => {
        handler({
            data: response?.notification?.request?.content?.data || {},
            actionIdentifier: response?.actionIdentifier || '',
            userText: (response as any)?.userText,
        });
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
