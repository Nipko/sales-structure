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

/** Public website origin — legal resources must not be derived from the admin host. */
export const PUBLIC_SITE_URL: string = (
    (Constants.expoConfig?.extra as any)?.publicSiteUrl ||
    process.env.EXPO_PUBLIC_SITE_URL ||
    'https://parallly-chat.cloud'
).replace(/\/+$/, '');

export const PRIVACY_POLICY_URL = `${PUBLIC_SITE_URL}/privacy`;
export const ACCOUNT_DELETION_URL = `${PUBLIC_SITE_URL}/data-deletion`;
