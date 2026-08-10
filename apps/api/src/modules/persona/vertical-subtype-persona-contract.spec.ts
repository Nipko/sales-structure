import {
    reconcileVerticalSubtypePersonaRules,
    resolveVerticalSubtypePersonaContract,
    VERTICAL_PERSONA_LOCALES,
    VERTICAL_SUBTYPE_PERSONA_CONTRACTS,
} from './vertical-subtype-persona-contract';

describe('vertical subtype persona contract', () => {
    const nativeProfiles = [
        ['salud', 'farmacia'],
        ['automotriz', 'repuestos'],
        ['automotriz', 'alquiler'],
        ['technology', 'hardware'],
        ['pet_services', 'guarderia'],
        ['pet_services', 'hotel'],
    ] as const;

    it('defines the six native-operation profiles with honest rules in four locales', () => {
        expect(VERTICAL_SUBTYPE_PERSONA_CONTRACTS).toHaveLength(nativeProfiles.length);
        for (const [industry, subType] of nativeProfiles) {
            const contract = resolveVerticalSubtypePersonaContract(industry, subType);
            expect(contract).toEqual(expect.objectContaining({
                industry,
                subType,
                onboardingTemplateId: 'tpl_sales',
                managedTemplateIds: expect.arrayContaining(['tpl_sales']),
            }));
            for (const locale of VERTICAL_PERSONA_LOCALES) {
                expect(contract?.nativeRules[locale]).toHaveLength(3);
                expect(contract?.nativeRules[locale].join(' ')).not.toMatch(
                    /\b(cita|appointment|demo|test drive|prueba de manejo|agend\w*)\b/i,
                );
            }
        }
    });

    it('removes only exact v1 template/definition rules for a matching template and subtype', () => {
        const legacyTemplateRule = 'Siempre ofrece agendar una cita cuando el paciente describe síntomas';
        const legacyDefinitionRule = `${legacyTemplateRule}.`;
        const tenantVariant = `${legacyTemplateRule} cuando el negocio esté abierto`;
        const customRule = 'Regla propia del tenant';

        const reconciled = reconcileVerticalSubtypePersonaRules({
            industry: 'salud',
            subType: 'farmacia',
            templateId: 'tpl_salud_recepcion',
            language: 'es-CO',
            existingRules: [legacyTemplateRule, legacyDefinitionRule, tenantVariant, customRule],
            canonicalDefinitionRules: [legacyDefinitionRule],
        });

        expect(reconciled).not.toContain(legacyTemplateRule);
        expect(reconciled).not.toContain(legacyDefinitionRule);
        expect(reconciled).toEqual(expect.arrayContaining([tenantVariant, customRule]));
        expect(reconciled).toEqual(expect.arrayContaining(
            resolveVerticalSubtypePersonaContract('salud', 'farmacia')!.nativeRules.es,
        ));
    });

    it('reconciles every shipped v1 template id without deleting edited variants', () => {
        for (const contract of VERTICAL_SUBTYPE_PERSONA_CONTRACTS) {
            for (const [templateId, legacyRules] of Object.entries(contract.legacyTemplateRules)) {
                if (legacyRules.length === 0) continue;
                const editedRules = legacyRules.map((rule) => `${rule} [tenant]`);
                const canonicalDefinitionRule = `canonical:${contract.industry}/${contract.subType}`;
                const reconciled = reconcileVerticalSubtypePersonaRules({
                    industry: contract.industry,
                    subType: contract.subType,
                    templateId,
                    language: 'fr',
                    existingRules: [...legacyRules, ...editedRules, canonicalDefinitionRule],
                    canonicalDefinitionRules: [canonicalDefinitionRule],
                });

                for (const legacyRule of legacyRules) expect(reconciled).not.toContain(legacyRule);
                expect(reconciled).not.toContain(canonicalDefinitionRule);
                expect(reconciled).toEqual(expect.arrayContaining(editedRules));
                expect(reconciled).toEqual(expect.arrayContaining(contract.nativeRules.fr));
            }
        }
    });

    it('preserves canonical-looking rules when template ownership does not match', () => {
        const legacyRule = 'Ofrece agendar prueba de manejo';
        const definitionRule = 'Ofrece agendar prueba de manejo.';
        const reconciled = reconcileVerticalSubtypePersonaRules({
            industry: 'automotriz',
            subType: 'alquiler',
            templateId: 'tpl_owner_custom',
            language: 'en',
            existingRules: [legacyRule, definitionRule],
            canonicalDefinitionRules: [definitionRule],
        });

        expect(reconciled).toEqual(expect.arrayContaining([legacyRule, definitionRule]));
        expect(reconciled).toEqual(expect.arrayContaining(
            resolveVerticalSubtypePersonaContract('automotriz', 'alquiler')!.nativeRules.en,
        ));
    });

    it('is additive and idempotent for the v2 generic onboarding template', () => {
        const nativeRules = resolveVerticalSubtypePersonaContract('technology', 'hardware')!.nativeRules.pt;
        const first = reconcileVerticalSubtypePersonaRules({
            industry: 'technology',
            subType: 'hardware',
            templateId: 'tpl_sales',
            language: 'pt-BR',
            existingRules: ['Regra personalizada', ...nativeRules],
            canonicalDefinitionRules: ['Ofereça demos.'],
        });
        const second = reconcileVerticalSubtypePersonaRules({
            industry: 'technology',
            subType: 'hardware',
            templateId: 'tpl_sales',
            language: 'pt-BR',
            existingRules: first,
            canonicalDefinitionRules: ['Ofereça demos.'],
        });

        expect(second).toEqual(first);
        expect(second.filter((rule) => nativeRules.includes(rule))).toHaveLength(nativeRules.length);
    });

    it('leaves unrelated subtype rules byte-for-byte unchanged', () => {
        const rules = ['Ofrece agendar prueba de manejo', 'Regla propia'];
        expect(reconcileVerticalSubtypePersonaRules({
            industry: 'automotriz',
            subType: 'concesionario',
            templateId: 'tpl_automotriz_ventas',
            language: 'es',
            existingRules: rules,
        })).toEqual(rules);
    });
});
