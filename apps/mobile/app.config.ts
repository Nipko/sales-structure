import { ExpoConfig, ConfigContext } from 'expo/config';
import * as fs from 'fs';

/**
 * FCM credentials for Android push (google-services.json).
 * - Local: el archivo vive en apps/mobile/google-services.json (gitignored).
 * - EAS: se inyecta como file-secret → la env var GOOGLE_SERVICES_JSON apunta a
 *   su ruta en el build. Crear con:
 *     eas secret:create --scope project --type file \
 *       --name GOOGLE_SERVICES_JSON --value ./google-services.json
 * Si no existe (ni archivo ni env), se omite para no romper prebuild.
 */
const googleServicesPath = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
const hasFcm = fs.existsSync(googleServicesPath);

/**
 * Parallly Mobile (agents) — Expo config.
 * API base comes from EXPO_PUBLIC_API_URL or defaults to production.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
    ...config,
    name: 'Parallly',
    slug: 'parallly-mobile',
    owner: 'nirlevin',
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
        ...(hasFcm ? { googleServicesFile: googleServicesPath } : {}),
        adaptiveIcon: {
            foregroundImage: './assets/adaptive-icon.png',
            backgroundImage: './assets/adaptive-bg.png',
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
        // Sentry. Para EAS/store builds sube source maps automáticamente usando
        // 3 secretos de EAS: SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN.
        // Si org/project no están en env, el plugin cae a esas env vars en build.
        // (Los builds locales con gradlew NO corren config plugins → no afecta.)
        [
            '@sentry/react-native',
            {
                url: 'https://sentry.io/',
                organization: process.env.SENTRY_ORG,
                project: process.env.SENTRY_PROJECT,
            },
        ],
        'expo-localization',
        [
            'expo-image-picker',
            {
                photosPermission: 'Permite adjuntar imágenes de tu galería a las conversaciones.',
                cameraPermission: 'Permite tomar fotos para enviarlas en las conversaciones.',
            },
        ],
        // Keyboard fix for EAS/store builds (edge-to-edge SDK 54): force adjustNothing
        // so lib/useKeyboardSpace owns the inset math. Mirrors the local manual setting.
        './plugins/withSoftInputAdjustNothing',
        // GATE 0 (seguridad): network_security_config Android → solo HTTPS (sin
        // cleartext) + plantilla de cert pinning opt-in. Mirrors the local setting.
        './plugins/withAndroidNetworkSecurity',
        // Permiso de micrófono para notas de voz salientes (expo-av no lo inyecta solo).
        './plugins/withAudioPermission',
    ],
    extra: {
        eas: { projectId: '5a6f6dab-dec2-44e0-b00a-58e77c909501' },
        apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://api.parallly-chat.cloud/api/v1',
        // Sentry DSN (client key — safe to embed). Mobile project, separate from the backend.
        sentryDsn:
            process.env.EXPO_PUBLIC_SENTRY_DSN ||
            'https://c8801571c8e7c0b06692e6e1ae1e1afe@o4511502203748352.ingest.us.sentry.io/4511502208729088',
        // WEB OAuth client ID (= backend GOOGLE_OAUTH_CLIENT_ID / dashboard
        // NEXT_PUBLIC_GOOGLE_CLIENT_ID). NOT the Android client. The mobile id_token
        // is audienced to this so /auth/google verifies it unchanged.
        googleWebClientId:
            process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
            '950001098107-4ctk2jm3876afqktip7r4f04120kt0ou.apps.googleusercontent.com',
    },
});
