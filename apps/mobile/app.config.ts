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
    ],
    extra: {
        apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://api.parallly-chat.cloud/api/v1',
    },
});
