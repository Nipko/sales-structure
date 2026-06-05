/**
 * Expo config plugin: set MainActivity android:windowSoftInputMode="adjustNothing".
 *
 * WHY: Expo SDK 54 enforces edge-to-edge (Android 15+), which breaks the classic
 * adjustResize signal that KeyboardAvoidingView relies on under react-native-screens
 * native-stack. Our keyboard solution (lib/useKeyboardSpace) handles the inset
 * manually and REQUIRES the OS to do nothing → adjustNothing. app.config's
 * `android.softwareKeyboardLayoutMode` only supports "resize"/"pan", so this plugin
 * sets adjustNothing directly in the manifest during `expo prebuild` (EAS builds).
 *
 * (Local Windows builds set this by hand in android/AndroidManifest.xml, which is
 * gitignored — this plugin makes EAS/tienda builds reproduce it.)
 */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withSoftInputAdjustNothing(config) {
    return withAndroidManifest(config, (cfg) => {
        const app = cfg.modResults.manifest.application && cfg.modResults.manifest.application[0];
        const activities = (app && app.activity) || [];
        const main = activities.find((a) => a.$ && a.$['android:name'] === '.MainActivity');
        if (main) {
            main.$['android:windowSoftInputMode'] = 'adjustNothing';
        }
        return cfg;
    });
};
