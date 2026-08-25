import {
    COUNTRY_LANGUAGE_PACKS,
    COUNTRY_MARKET_STATE,
    MIN_SCENARIOS_PER_PROFILE,
    VERTICAL_AUTHORING_PACKAGE_VERSION,
} from '@parallext/shared';
import {
    buildVerticalAuthoringPackage,
    listVerticalAuthoringPackages,
    summariseVerticalAuthoringPackages,
} from './vertical-authoring-package';

describe('AUTH-01 versioned 1:1 authoring packages', () => {
    const canonical = listVerticalAuthoringPackages();
    const compatible = listVerticalAuthoringPackages({ includeLegacy: true });

    it('covers 76 canonical configurations plus five compatibility identities', () => {
        expect(canonical).toHaveLength(76);
        expect(compatible).toHaveLength(81);
        expect(new Set(compatible.map(entry => entry.packageId)).size).toBe(81);
        expect(compatible.filter(entry => entry.compatibility.legacy)).toHaveLength(5);
        expect(canonical.every(entry => entry.version === VERTICAL_AUTHORING_PACKAGE_VERSION)).toBe(true);
    });

    it('makes every critical source and inherited review visible', () => {
        for (const entry of compatible) {
            expect(entry.governance.stage).toBe('mechanically_complete');
            expect(Object.keys(entry.governance.criticalFieldSources).length).toBeGreaterThanOrEqual(15);
            for (const fieldSource of Object.values(entry.governance.criticalFieldSources)) {
                expect(fieldSource.reference.length).toBeGreaterThan(3);
                expect(typeof fieldSource.inherited).toBe('boolean');
                expect(typeof fieldSource.expertReviewRequired).toBe('boolean');
            }
        }
    });

    it('does not pretend the 60 inherited glossaries were expert-reviewed', () => {
        const summary = summariseVerticalAuthoringPackages(canonical);
        expect(summary.terminologyExpertReview).toBe(60);
        expect(summary.promptTemplateExpertReview).toBe(70);
        const inherited = canonical.filter(entry =>
            entry.governance.expertReviewsRequired.includes('terminology.domain_glossary'));
        expect(inherited.every(entry => entry.governance.promotionBlockers
            .includes('expert.terminology.domain_glossary'))).toBe(true);
    });

    it('pins all four base languages and the deterministic eval floor', () => {
        for (const entry of canonical) {
            expect(entry.localization.baseLanguages).toEqual(['es', 'en', 'pt', 'fr']);
            expect(Object.values(entry.evals.byLanguage).every(count =>
                count >= MIN_SCENARIOS_PER_PROFILE)).toBe(true);
            expect(new Set(Object.values(entry.evals.byLanguage)).size).toBe(1);
            expect(entry.evals.adversarial).toBeGreaterThan(0);
            expect(entry.evals.toolHonesty).toBeGreaterThan(0);
        }
    });

    it('carries fifteen preview packs and recognition-only US/CA separately', () => {
        const overlays = canonical[0].localization.countryOverlays;
        expect(overlays).toHaveLength(17);
        expect(overlays.filter(entry => entry.market.state === 'preview')).toHaveLength(15);
        expect(overlays.filter(entry => entry.market.state === 'recognized').map(entry => entry.country).sort())
            .toEqual(['CA', 'US']);
        expect(Object.keys(COUNTRY_LANGUAGE_PACKS)).toHaveLength(17);
        expect(Object.keys(COUNTRY_MARKET_STATE)).toHaveLength(17);
        const colombia = overlays.find(entry => entry.country === 'CO')!;
        expect(colombia.recognizedAliases.map(alias => alias.value))
            .toEqual(expect.arrayContaining(['hagale', 'de una', 'listo pues']));
        expect(colombia.ambiguousConsentPhrases)
            .toEqual(expect.arrayContaining(['hagale', 'de una', 'listo pues']));
    });

    it('puts tourism daily bookings before the room/rental catalogue', () => {
        const hotel = buildVerticalAuthoringPackage({ industry: 'turismo', subtype: 'hotel' });
        expect(hotel.navigation.items.slice(0, 2).map(item => item.id))
            .toEqual(['stays', 'properties']);
        expect(hotel.navigation.items[0].classification).toBe('daily_work');
        expect(hotel.navigation.items[1].classification).toBe('catalog');
        expect(hotel.navigation.items[0].labels?.es).not.toBe(hotel.navigation.items[1].labels?.es);
    });

    it('ties writer, active object, deep-link menu and roles together', () => {
        const navigationOffenders: string[] = [];
        for (const entry of canonical) {
            if (!entry.navigation.dailyWorkFirst || !entry.navigation.catalogSeparated
                || entry.navigation.gaps.length) {
                navigationOffenders.push(`${entry.profileId}: ${entry.navigation.gaps.join(',')}`);
            }
            for (const object of entry.tools.activeObjects) expect(object.length).toBeGreaterThan(2);
            for (const item of entry.navigation.items.filter(item => item.classification === 'daily_work')) {
                expect(item.roles).toContain('tenant_agent');
                expect(item.mobileProjection).toBe('capability_workspace');
            }
        }
        expect(navigationOffenders).toEqual([]);
    });

    it('reuses the sidebar surface contract instead of calling support or catalogues daily work', () => {
        const education = buildVerticalAuthoringPackage({ industry: 'education', subtype: 'idiomas' });
        expect(education.navigation.items.find(item => item.id === 'courses')?.classification)
            .toBe('catalog');
        expect(education.navigation.items.find(item => item.id === 'inbox')).toMatchObject({
            classification: 'supporting',
            roles: expect.arrayContaining(['tenant_agent']),
        });

        const pets = buildVerticalAuthoringPackage({ industry: 'veterinaria', subtype: 'clinica_general' });
        expect(pets.navigation.items.find(item => item.id === 'pets')?.classification)
            .toBe('daily_work');
    });

    it('preserves the requested legacy identity while composing the canonical product', () => {
        const legacy = buildVerticalAuthoringPackage({
            industry: 'veterinaria',
            subtype: 'peluqueria_canina',
        });
        expect(legacy).toMatchObject({
            requestedProfileId: 'veterinaria/peluqueria_canina',
            profileId: 'pet_services/peluqueria',
            compatibility: { legacy: true, resolvesTo: 'pet_services/peluqueria' },
        });
    });
});
