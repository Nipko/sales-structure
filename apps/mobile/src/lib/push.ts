import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { api } from './api';
import { log } from './log';
import { isDndActive } from './notifPrefs';
import type { NotifPrefs } from './notifPrefs';

interface PushScope { userId: string; tenantId: string }
let activePushScope: PushScope | null = null;
let registrationPromise: Promise<void> | null = null;
let registrationAbortController: AbortController | null = null;
const INSTALLATION_ID_KEY = 'parallly_push_installation_id';
export const PUSH_LOGOUT_TIMEOUT_MS = 2_500;

function storedTokenKey(userId: string, tenantId: string): string {
    // UUIDs are SecureStore-key safe; replacement also keeps this robust for
    // non-UUID test/development identities.
    return `parallly_expo_push_${tenantId}_${userId}`.replace(/[^A-Za-z0-9._-]/g, '_');
}

function isActivePushScope(scope: PushScope): boolean {
    return activePushScope?.userId === scope.userId && activePushScope?.tenantId === scope.tenantId;
}

function expoProjectId(): string | undefined {
    return (Constants.expoConfig as any)?.extra?.eas?.projectId
        || (Constants as any)?.easConfig?.projectId;
}

async function getOrCreateInstallationId(): Promise<string> {
    const existing = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
    if (existing) return existing;
    const installationId = Crypto.randomUUID();
    await SecureStore.setItemAsync(INSTALLATION_ID_KEY, installationId);
    return installationId;
}

async function clearNativePushState(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            Promise.allSettled([
                Notifications.unregisterForNotificationsAsync(),
                Notifications.dismissAllNotificationsAsync(),
                Notifications.clearLastNotificationResponseAsync(),
            ]).then(() => undefined),
            new Promise<void>((resolve) => { timeout = setTimeout(resolve, 500); }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

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
export async function registerForPush(userId: string, tenantId: string): Promise<void> {
    if (!userId || !tenantId) return;
    const scope = { userId, tenantId };
    registrationAbortController?.abort();
    const abortController = new AbortController();
    registrationAbortController = abortController;
    activePushScope = scope;
    const currentRegistration = (async () => {
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

        if (!isActivePushScope(scope)) return;
        const projectId = expoProjectId();

        const tokenResp = await Notifications.getExpoPushTokenAsync(
            projectId ? { projectId } : undefined,
        );
        const token = tokenResp.data;
        if (token && isActivePushScope(scope)) {
            const installationId = await getOrCreateInstallationId();
            if (!isActivePushScope(scope) || abortController.signal.aborted) return;
            const result = await api.subscribeExpoPush(token, installationId, abortController.signal);
            if (result?.success && isActivePushScope(scope)) {
                await SecureStore.setItemAsync(storedTokenKey(userId, tenantId), token);
            }
        }
    } catch (e: any) {
        // Most common in Expo Go without EAS init, or on emulators.
        log('[push] registration skipped:', e?.message);
    }
    })();
    registrationPromise = currentRegistration;
    try {
        await currentRegistration;
    } finally {
        if (registrationPromise === currentRegistration) registrationPromise = null;
        if (registrationAbortController === abortController) registrationAbortController = null;
    }
}

/** Stop an in-flight registration when a session dies without an explicit logout. */
export async function deactivatePushScope(): Promise<void> {
    const previous = activePushScope;
    activePushScope = null;
    registrationAbortController?.abort();
    if (previous) {
        await SecureStore.deleteItemAsync(storedTokenKey(previous.userId, previous.tenantId)).catch(() => {});
        await clearNativePushState();
    }
}

/**
 * Revoke native push before auth tokens are erased. Waiting for an in-flight
 * registration closes the race where logout could delete a token and the older
 * registration request could recreate it a moment later.
 */
export async function unregisterPushForLogout(userId: string, tenantId: string): Promise<boolean> {
    activePushScope = null;
    registrationAbortController?.abort();
    const pending = registrationPromise;
    const key = storedTokenKey(userId, tenantId);
    const abortController = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    let success = false;
    try {
        const deadline = new Promise<void>((resolve) => {
            timeout = setTimeout(() => {
                expired = true;
                abortController.abort();
                resolve();
            }, PUSH_LOGOUT_TIMEOUT_MS);
        });
        if (pending) await Promise.race([pending.catch(() => {}), deadline]);
        if (expired) return false;
        const token = await SecureStore.getItemAsync(key).catch(() => null);
        if (expired) return false;
        // No token means a legacy app registration may still exist. The guarded
        // endpoint then removes all Expo tokens scoped to this user + tenant.
        const result = await Promise.race([
            api.unsubscribeExpoPush(token || undefined, abortController.signal),
            deadline.then(() => null),
        ]);
        success = !!result?.success;
    } catch (e: any) {
        log('[push] unregister skipped:', e?.message);
    } finally {
        if (timeout) clearTimeout(timeout);
        await SecureStore.deleteItemAsync(key).catch(() => {});
        // Invalidate the OS/provider registration too. This protects an offline
        // logout immediately; the next login obtains/registers a fresh Expo token.
        await clearNativePushState();
    }
    return success;
}

/**
 * Show a LOCAL notification immediately. Works without EAS/FCM as long as the app
 * process is alive (foreground or backgrounded with the socket still connected) —
 * used for real-time handoff alerts. True push when the app is CLOSED still needs
 * an Expo push token (eas init + Android FCM); see registerForPush.
 *
 * category: optional key for DND / category preference check (handoff/messages/sla/appointments).
 * If DND is active or the category is disabled, the notification is silently suppressed.
 */
export async function presentLocalNotification(
    title: string,
    body: string,
    data?: any,
    category?: keyof NotifPrefs['categories'],
) {
    try {
        // Respect Do-Not-Disturb and per-category prefs (GATE 0 — UX).
        if (await isDndActive(category)) {
            log('[push] local notification suppressed by DND/category prefs');
            return;
        }
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
