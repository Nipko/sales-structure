const withAndroidAdaptiveLayout = require('../withAndroidAdaptiveLayout');
const { configureAdaptiveActivity } = withAndroidAdaptiveLayout;

function manifestFixture() {
    return {
        manifest: {
            application: [{ activity: [
                { $: {
                    'android:name': '.MainActivity',
                    'android:screenOrientation': 'portrait',
                    'android:resizeableActivity': 'false',
                    'android:windowSoftInputMode': 'adjustNothing',
                    'android:configChanges': 'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode',
                } },
                { $: { 'android:name': 'com.example.CropActivity', 'android:screenOrientation': 'portrait' } },
            ] }],
        },
    };
}

describe('Android adaptive window manifest', () => {
    it('removes the main portrait lock without changing keyboard handling or library activities', () => {
        const manifest = configureAdaptiveActivity(manifestFixture());
        const [main, crop] = manifest.manifest.application[0].activity;
        expect(main.$['android:screenOrientation']).toBeUndefined();
        expect(main.$['android:resizeableActivity']).toBe('true');
        expect(main.$['android:windowSoftInputMode']).toBe('adjustNothing');
        expect(main.$['android:configChanges']).toContain('orientation|screenSize');
        expect(crop.$['android:screenOrientation']).toBe('portrait');
    });

    it('is stable across repeated prebuilds', () => {
        const once = configureAdaptiveActivity(manifestFixture());
        const snapshot = JSON.stringify(once);
        expect(JSON.stringify(configureAdaptiveActivity(once))).toBe(snapshot);
    });

    it('preserves the configured iOS orientation', () => {
        const result = withAndroidAdaptiveLayout({ name: 'Parallly', slug: 'parallly-mobile', orientation: 'portrait' });
        expect(result.orientation).toBe('portrait');
        expect(result.mods.android.manifest).toEqual(expect.any(Function));
    });

    it('fails prebuild when the expected main activity is missing', () => {
        expect(() => configureAdaptiveActivity({ manifest: { application: [{ activity: [] }] } }))
            .toThrow('MainActivity');
    });
});
