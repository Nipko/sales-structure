const fs = require('fs');
const os = require('os');
const path = require('path');
const withAndroidReleaseOptimization = require('../withAndroidReleaseOptimization');
const { configureReleaseProperties, configureReleaseGradle, DIAGNOSTIC_RULES } = withAndroidReleaseOptimization;

function gradleFixture() {
    return { language: 'groovy', contents: `apply plugin: "com.android.application"
def enableMinifyInReleaseBuilds = (findProperty('android.enableMinifyInReleaseBuilds') ?: false).toBoolean()
android {
    buildTypes {
        debug { signingConfig signingConfigs.debug }
        release {
            signingConfig signingConfigs.release
            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'
            shrinkResources enableShrinkResources.toBoolean()
            minifyEnabled enableMinifyInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro", "custom.pro"
        }
    }
}
` };
}

describe('Android release R8 configuration', () => {
    it('enables shrinking and full mode even if older native settings disabled them', () => {
        const properties = configureReleaseProperties([
            { type: 'comment', value: 'Preserve native settings' },
            { type: 'property', key: 'hermesEnabled', value: 'true' },
            { type: 'property', key: 'android.enableMinifyInReleaseBuilds', value: 'false' },
            { type: 'property', key: 'android.enableMinifyInReleaseBuilds', value: 'false' },
            { type: 'property', key: 'android.enableShrinkResourcesInReleaseBuilds', value: 'false' },
            { type: 'property', key: 'android.enableR8.fullMode', value: 'false' },
        ]);
        for (const key of ['android.enableMinifyInReleaseBuilds', 'android.enableShrinkResourcesInReleaseBuilds', 'android.enableR8.fullMode']) {
            expect(properties.filter((entry) => entry.key === key)).toEqual([{ type: 'property', key, value: 'true' }]);
        }
        expect(properties).toContainEqual({ type: 'property', key: 'hermesEnabled', value: 'true' });
        expect(properties[0].type).toBe('comment');
        expect(configureReleaseProperties(properties)).toEqual(properties);
    });

    it('uses optimizing defaults and diagnostic metadata without changing signing, debug or custom rules', () => {
        const result = configureReleaseGradle(gradleFixture());
        expect(result.contents).toContain('getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro", "custom.pro", "parallly-r8.pro"');
        expect(result.contents).toContain('debug { signingConfig signingConfigs.debug }');
        expect(result.contents).toContain('signingConfig signingConfigs.release');
        expect(configureReleaseGradle(result)).toEqual(result);
    });

    it('supports single-quoted defaults from an equivalent Groovy template', () => {
        const fixture = gradleFixture();
        fixture.contents = fixture.contents.replace('"proguard-android.txt"', "'proguard-android.txt'");
        expect(configureReleaseGradle(fixture).contents).toContain("getDefaultProguardFile('proguard-android-optimize.txt')");
    });

    it.each([
        ['different DSL', (fixture) => ({ ...fixture, language: 'kotlin' })],
        ['disconnected release flag', (fixture) => ({ ...fixture, contents: fixture.contents.replace('minifyEnabled enableMinifyInReleaseBuilds', 'minifyEnabled false') })],
        ['missing resource shrinker', (fixture) => ({ ...fixture, contents: fixture.contents.replace('shrinkResources enableShrinkResources.toBoolean()', '') })],
        ['missing default rules', (fixture) => ({ ...fixture, contents: fixture.contents.replace('proguard-android.txt', 'unrecognized.pro') })],
    ])('fails prebuild for %s so an SDK upgrade cannot silently disable optimization', (_name, change) => {
        expect(() => configureReleaseGradle(change(gradleFixture()))).toThrow('Android release optimization');
    });

    it('preserves crash locations without adding blanket keep or disabling R8 phases', () => {
        expect(DIAGNOSTIC_RULES).toContain('-keepattributes SourceFile,LineNumberTable');
        expect(DIAGNOSTIC_RULES).not.toMatch(/^-keep\s|^-dont(?:optimize|obfuscate|shrink|warn)\b/m);
    });

    it('creates the diagnostic rules during prebuild, including repeated regeneration', async () => {
        const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parallly-r8-test-'));
        const appDirectory = path.join(nativeRoot, 'app');
        const rulesPath = path.join(appDirectory, 'parallly-r8.pro');
        fs.mkdirSync(appDirectory);
        try {
            const config = withAndroidReleaseOptimization({ name: 'Parallly', slug: 'parallly-mobile' });
            for (let run = 0; run < 2; run += 1) {
                await config.mods.android.dangerous({ ...config, modRequest: { platformProjectRoot: nativeRoot } });
                expect(fs.readFileSync(rulesPath, 'utf8')).toBe(DIAGNOSTIC_RULES);
            }
        } finally {
            if (fs.existsSync(rulesPath)) fs.unlinkSync(rulesPath);
            fs.rmdirSync(appDirectory);
            fs.rmdirSync(nativeRoot);
        }
    });
});
