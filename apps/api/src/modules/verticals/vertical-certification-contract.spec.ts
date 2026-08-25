import {
    VERTICAL_CERTIFICATION_CONTRACT_VERSION,
    listVerticalCertificationSnapshots,
    resolveVerticalCertificationSnapshot,
} from '@parallext/shared';

describe('CTR-01 shared certification snapshot', () => {
    it('covers the 76 canonical profiles and 81 resolvable identities', () => {
        expect(listVerticalCertificationSnapshots()).toHaveLength(76);
        expect(listVerticalCertificationSnapshots({ includeLegacy: true })).toHaveLength(81);
        expect(new Set(listVerticalCertificationSnapshots().map(entry => entry.profileId)).size).toBe(76);
    });

    it('keeps availability, country and provider as separate auditable axes', () => {
        const snapshot = resolveVerticalCertificationSnapshot({
            industry: 'finanzas',
            subtype: 'pagos_recaudos',
            operatingCountry: 'CO',
        });
        expect(snapshot).toMatchObject({
            version: VERTICAL_CERTIFICATION_CONTRACT_VERSION,
            profileId: 'finanzas/pagos_recaudos',
            product: {
                availability: 'waitlist',
                executionMode: 'read_only_handoff',
            },
            market: {
                operatingCountry: 'CO',
                countryPackStatus: 'draft',
                marketPolicy: { state: 'preview' },
                certified: false,
            },
            provider: { requirement: 'required', configured: false, certified: false },
            overall: { certified: false, deepMarketingAllowed: false },
        });
        expect(snapshot.reasons.map(reason => reason.code)).toEqual(expect.arrayContaining([
            'profile_waitlist',
            'country_pack_draft',
            'provider_required',
        ]));
    });

    it('does not confuse a healthy provider with a certified provider version/capability', () => {
        const snapshot = resolveVerticalCertificationSnapshot({
            industry: 'seguros',
            subtype: 'aseguradora',
            operatingCountry: 'MX',
            providers: [{
                name: 'guidewire',
                kind: 'policy_administration_system',
                configured: true,
                healthy: true,
            }],
        });
        expect(snapshot.provider).toMatchObject({
            selected: 'guidewire',
            configured: true,
            healthy: true,
            apiVersion: null,
            certified: false,
        });
        expect(snapshot.reasons.map(reason => reason.code)).toContain('provider_version_missing');
    });

    it('ignores a connected provider that does not own this profile boundary', () => {
        const snapshot = resolveVerticalCertificationSnapshot({
            industry: 'technology',
            subtype: 'hardware',
            operatingCountry: 'CO',
            providers: [{
                name: 'toast', apiVersion: 'menus-v2', configured: true, healthy: true,
            }],
        });

        expect(snapshot.provider).toMatchObject({
            requirement: 'none',
            selected: null,
            configured: false,
            certified: true,
        });
        expect(snapshot.reasons.map(reason => reason.code)).not.toContain('provider_not_certified');
    });

    it('does not promote a market when only its language pack was certified', () => {
        const snapshot = resolveVerticalCertificationSnapshot({
            industry: 'technology',
            subtype: 'saas',
            operatingCountry: 'CO',
            countryPack: { id: 'es-CO', status: 'certified' },
            promotion: {
                stage: 'certified',
                domainEvidenceComplete: true,
                deepMarketingApproved: true,
            },
        });

        expect(snapshot.market).toMatchObject({
            countryPackStatus: 'certified',
            marketPolicy: { state: 'preview' },
            certified: false,
        });
        expect(snapshot.overall).toMatchObject({ certified: false, deepMarketingAllowed: false });
        expect(snapshot.reasons.map(reason => reason.code)).toContain('market_not_certified');
    });

    it('preserves the requested legacy identity while resolving its canonical product', () => {
        const snapshot = resolveVerticalCertificationSnapshot({
            industry: 'veterinaria',
            subtype: 'peluqueria_canina',
            operatingCountry: 'CO',
        });
        expect(snapshot.requestedProfileId).toBe('veterinaria/peluqueria_canina');
        expect(snapshot.profileId).toBe('pet_services/peluqueria');
    });
});
