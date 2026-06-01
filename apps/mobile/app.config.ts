import { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Parallly Mobile (agents) — Expo config.
 * API base comes from EXPO_PUBLIC_API_URL or defaults to production.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
    ...config,
    name: 'Parallly',
    slug: 'parallly-mobile',
    scheme: 'parallly',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    icon: './assets/icon.png',
    splash: {
        image: './assets/splash.png',
        resizeMode: 'contain',
        backgroundColor: '#0a0a12',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
        supportsTablet: true,
        bundleIdentifier: 'cloud.parallly.mobile',
        infoPlist: {
            NSFaceIDUsageDescription: 'Usa Face ID para acceder de forma segura a Parallly.',
        },
    },
    android: {
        package: 'cloud.parallly.mobile',
        adaptiveIcon: {
            foregroundImage: './assets/adaptive-icon.png',
            backgroundColor: '#0a0a12',
        },
    },
    plugins: [
        'expo-secure-store',
        'expo-local-authentication',
        [
            'expo-notifications',
            { color: '#6c5ce7' },
        ],
        '@react-native-google-signin/google-signin',
    ],
    extra: {
        apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://api.parallly-chat.cloud/api/v1',
        // WEB OAuth client ID (= backend GOOGLE_OAUTH_CLIENT_ID / dashboard
        // NEXT_PUBLIC_GOOGLE_CLIENT_ID). NOT the Android client. The mobile id_token
        // is audienced to this so /auth/google verifies it unchanged.
        googleWebClientId:
            process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
            '950001098107-4ctk2jm3876afqktip7r4f04120kt0ou.apps.googleusercontent.com',
    },
});
