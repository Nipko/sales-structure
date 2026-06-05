/**
 * Expo config plugin: añade permiso RECORD_AUDIO para grabación de notas de voz.
 * expo-av no tiene su propio plugin que inyecte este permiso automáticamente.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withAudioPermission(config) {
    return withAndroidManifest(config, (cfg) => {
        const manifest = cfg.modResults.manifest;
        const perms = manifest['uses-permission'] || [];
        const name = 'android.permission.RECORD_AUDIO';
        if (!perms.some((p) => p.$?.['android:name'] === name)) {
            perms.push({ $: { 'android:name': name } });
            manifest['uses-permission'] = perms;
        }
        return cfg;
    });
};
