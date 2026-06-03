import Constants from 'expo-constants';

/** API base, e.g. https://api.parallly-chat.cloud/api/v1 */
export const API_URL: string =
    (Constants.expoConfig?.extra as any)?.apiUrl ||
    process.env.EXPO_PUBLIC_API_URL ||
    'https://api.parallly-chat.cloud/api/v1';

/** Socket.io origin — API URL without the /api/v1 suffix (matches the dashboard). */
export const SOCKET_URL: string = API_URL.replace(/\/api\/v1\/?$/, '');

/** Web dashboard origin — used to deep-link to web-only flows (e.g. password reset). */
export const DASHBOARD_URL: string =
    (Constants.expoConfig?.extra as any)?.dashboardUrl ||
    process.env.EXPO_PUBLIC_DASHBOARD_URL ||
    'https://admin.parallly-chat.cloud';
