import {
    TERMINOLOGY_LANGUAGES,
    listSubtypeExperienceProfileIds,
    localizeVerticalPromptPhrases,
    resolveSubtypeExperienceProfile,
    subtypeTerminologyFor,
    buildDomainContractDraft,
} from '@parallext/shared';

describe('localized vertical prompt boundaries', () => {
    it('covers every claim, exclusion and forbidden term used by every business profile', () => {
        const missing: string[] = [];

        for (const profileId of listSubtypeExperienceProfileIds()) {
            const [industry, subtype] = profileId.split('/');
            const profile = resolveSubtypeExperienceProfile(industry, subtype);
            const domain = buildDomainContractDraft(industry, subtype);
            const avoid = subtypeTerminologyFor(industry, subtype)?.avoid ?? [];

            for (const language of TERMINOLOGY_LANGUAGES) {
                for (const [field, source] of [
                    ['claims', domain.prompt.claims],
                    ['notOffered', profile.exclusions],
                    ['avoid', avoid],
                ] as const) {
                    for (const phrase of localizeVerticalPromptPhrases(source, language).missing) {
                        missing.push(`${profileId}:${field}.${language}:${phrase}`);
                    }
                }
            }
        }

        expect(missing).toEqual([]);
    });
});
