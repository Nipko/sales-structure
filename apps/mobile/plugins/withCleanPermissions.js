/**
 * Expo config plugin: garantiza que el AAB de producción NO declare permisos
 * sensibles que la app no usa (Play los escruta y pueden trabar la revisión):
 *  - SYSTEM_ALERT_WINDOW (dibujar sobre otras apps) — no se usa.
 *  - WRITE_EXTERNAL_STORAGE — ignorado en API 30+; la app no escribe a almacenamiento.
 *
 * Quita cualquier declaración existente y además añade `tools:node="remove"` para
 * borrar copias que pudieran inyectar dependencias en el merge del manifest.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const STRIP = [
    'android.permission.SYSTEM_ALERT_WINDOW',
    'android.permission.WRITE_EXTERNAL_STORAGE',
];

// READ_EXTERNAL_STORAGE lo inyecta expo-image-picker y Android 13+ lo ignora
// (ahí manda el Photo Picker del sistema). Declararlo SIN tope hace que Play lo
// lea como "acceso amplio a fotos y videos" y dispare esa revisión de política.
// Acotarlo a maxSdkVersion 32 lo deja donde de verdad hace falta (Android ≤12)
// y lo saca del radar de la revisión, sin romper la galería en equipos viejos.
const READ_STORAGE = 'android.permission.READ_EXTERNAL_STORAGE';
const READ_STORAGE_MAX_SDK = '32';

module.exports = function withCleanPermissions(config) {
    return withAndroidManifest(config, (cfg) => {
        const manifest = cfg.modResults.manifest;
        manifest.$ = manifest.$ || {};
        manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';

        let perms = manifest['uses-permission'] || [];
        // 1. Drop any direct declaration of the unwanted permissions.
        perms = perms.filter((p) => !STRIP.includes(p.$ && p.$['android:name']));
        // 2. Add explicit remove directives so merged-in copies are stripped too.
        for (const name of STRIP) {
            perms.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
        }
        // 3. Cap READ_EXTERNAL_STORAGE. `tools:replace` gana sobre la copia sin
        //    tope que inyecte cualquier dependencia durante el merge.
        const read = perms.find((p) => p.$ && p.$['android:name'] === READ_STORAGE);
        if (read) {
            read.$['android:maxSdkVersion'] = READ_STORAGE_MAX_SDK;
            read.$['tools:replace'] = 'android:maxSdkVersion';
        } else {
            perms.push({
                $: {
                    'android:name': READ_STORAGE,
                    'android:maxSdkVersion': READ_STORAGE_MAX_SDK,
                    'tools:replace': 'android:maxSdkVersion',
                },
            });
        }
        manifest['uses-permission'] = perms;
        return cfg;
    });
};
