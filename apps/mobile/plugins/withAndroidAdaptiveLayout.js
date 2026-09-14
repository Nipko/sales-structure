/**
 * Allow Android windows to rotate and resize, including tablets and foldables.
 * Android 16 ignores portrait locks on large screens. Keep this in prebuild so
 * EAS regenerates the manifest; the app's iOS orientation setting stays intact.
 */
const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

function configureAdaptiveActivity(manifest) {
    const main = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
    delete main.$['android:screenOrientation'];
    main.$['android:resizeableActivity'] = 'true';
    return manifest;
}

module.exports = function withAndroidAdaptiveLayout(config) {
    return withAndroidManifest(config, (cfg) => {
        cfg.modResults = configureAdaptiveActivity(cfg.modResults);
        return cfg;
    });
};

module.exports.configureAdaptiveActivity = configureAdaptiveActivity;
