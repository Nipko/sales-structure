import Constants from 'expo-constants';

/** API base, e.g. https://api.parallly-chat.cloud/api/v1 */
export const API_URL: string =
    (Constants.expoConfig?.extra as any)?.apiUrl ||
    process.env.EXPO_PUBLIC_API_URL ||
    'https://api.parallly-chat.cloud/api/v1';

/** Socket.io origin — API URL without the /api/v1 suffix (matches the dashboard). */
export const SOCKET_URL: string = API_URL.replace(/\/api\/v1\/?$/, '');
