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
        manifest['uses-permission'] = perms;
        return cfg;
    });
};
