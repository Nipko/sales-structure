import {
    buildDomainContractDraft,
    COUNTRY_EMERGENCY_CONTACTS,
    listSubtypeExperienceProfileIds,
    matchSafetyBackstop,
    renderSafetyTemplate,
    safetyClassFor,
    SAFETY_CLASSES,
    SAFETY_CLASS_BY_INDUSTRY,
    SAFETY_CLASS_BY_PROFILE,
    SAFETY_LANGUAGES,
    SAFETY_POLICY_VERSION,
    SAFETY_TEMPLATES,
    SAFETY_TEMPLATE_REVIEW,
    SUBTYPE_EXPERIENCE_PROFILES,
    type SafetyClassDefinition,
} from '@parallext/shared';

const HEALTH_INDUSTRIES = ['salud', 'veterinaria', 'pet_services'];
const classes = Object.values(SAFETY_CLASSES) as SafetyClassDefinition[];

describe('safety policy data integrity', () => {
    it('is versioned and still awaiting the clinical review the owner required before activation', () => {
        expect(SAFETY_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
        expect(SAFETY_TEMPLATE_REVIEW.status).toBe('pending_clinical_review');
    });

    it('gives every health business type (and aliases to one) a safety class', () => {
        const health = listSubtypeExperienceProfileIds().filter(id => HEALTH_INDUSTRIES.includes(id.split('/')[0]));
        expect(health.length).toBeGreaterThanOrEqual(13);
        for (const id of health) {
            const profile = SUBTYPE_EXPERIENCE_PROFILES[id];
            const resolved = safetyClassFor(profile.industry, profile.subtype === '__none__' ? null : profile.subtype);
            expect({ id, cls: resolved?.key ?? null }).toEqual({ id, cls: expect.any(String) });
        }
        // An industry-level fallback for an unknown or missing subtype.
        for (const industry of HEALTH_INDUSTRIES) expect(safetyClassFor(industry, null)).not.toBeNull();
        // Aesthetic medicine sold under beauty is a health business for triage purposes.
        expect(safetyClassFor('moda_belleza', 'estetica')?.key).toBe('aesthetic_complication');
        // A legacy alias resolves through its canonical id.
        expect(safetyClassFor('veterinaria', 'peluqueria_canina')?.key).toBe('pet_emergency');
    });

    it('maps the named verticals to the right class', () => {
        expect(safetyClassFor('salud', 'dental')?.key).toBe('dental_acute');
        expect(safetyClassFor('salud', 'medica_general')?.key).toBe('medical_acute');
        expect(safetyClassFor('salud', 'dermatologia')?.key).toBe('aesthetic_complication');
        expect(safetyClassFor('salud', 'psicologia')?.key).toBe('mental_health_crisis');
        expect(safetyClassFor('veterinaria', 'hospital_24h')?.key).toBe('pet_emergency');
    });

    it('leaves non-health businesses without a class', () => {
        for (const [industry, subtype] of [['restaurantes', 'comida_rapida'], ['retail', 'moda'], ['moda_belleza', 'salon_belleza'], ['seguros', 'salud'], ['otro', null]] as const) {
            expect(safetyClassFor(industry, subtype)).toBeNull();
        }
        expect(safetyClassFor(null, null)).toBeNull();
    });

    it('only maps profiles and industries that exist', () => {
        for (const id of Object.keys(SAFETY_CLASS_BY_PROFILE)) expect(SUBTYPE_EXPERIENCE_PROFILES[id]).toBeDefined();
        for (const key of [...Object.values(SAFETY_CLASS_BY_PROFILE), ...Object.values(SAFETY_CLASS_BY_INDUSTRY)]) expect(SAFETY_CLASSES[key]).toBeDefined();
    });

    it.each(classes.map(cls => [cls.key, cls] as const))('%s: always hands off, never lets booking continue, and defines its red flags in 4 languages', (_key, cls) => {
        expect(cls.bookingMayContinue).toBe(false);
        expect(cls.handoffPriority).toBe('urgent');
        expect(cls.description.length).toBeGreaterThan(10);
        expect(cls.notRedFlags.length).toBeGreaterThan(10);
        expect(cls.redFlags.length).toBeGreaterThan(0);
        expect(new Set(cls.redFlags.map(flag => flag.key)).size).toBe(cls.redFlags.length);
        for (const flag of cls.redFlags) {
            expect(flag.description.length).toBeGreaterThan(10);
            for (const lang of SAFETY_LANGUAGES) {
                expect({ flag: flag.key, lang, families: flag.terms[lang].length > 0 }).toEqual({ flag: flag.key, lang, families: true });
                for (const family of flag.terms[lang]) {
                    expect(family.allOf.length).toBeGreaterThan(0);
                    for (const group of family.allOf) {
                        expect(group.length).toBeGreaterThan(0);
                        for (const term of group) expect(term.trim().length).toBeGreaterThan(1);
                    }
                }
            }
        }
        expect(SAFETY_TEMPLATES[cls.urgencyTemplateKey]).toBeDefined();
        expect(SAFETY_TEMPLATES[cls.footerTemplateKey]).toBeDefined();
    });

    it('has every template in es/en/pt/fr', () => {
        for (const [key, byLang] of Object.entries(SAFETY_TEMPLATES)) {
            for (const lang of SAFETY_LANGUAGES) expect({ key, lang, ok: (byLang as any)[lang]?.trim().length > 20 }).toEqual({ key, lang, ok: true });
        }
    });

    it('takes the emergency line from the country pack, never from the template', () => {
        for (const cls of classes) {
            for (const lang of SAFETY_LANGUAGES) {
                const urgency = SAFETY_TEMPLATES[cls.urgencyTemplateKey][lang];
                expect(urgency).not.toMatch(/\b(911|112|123|192|107|131|106|988)\b/);
                if (cls.emergencyContactSource === 'none') expect(urgency).not.toContain('{emergencyLine}');
                else expect(urgency).toContain('{emergencyLine}');
                if (cls.emergencyContactSource === 'country_pack.medical_and_crisis') expect(urgency).toContain('{crisisLine}');
            }
        }
        const dental = SAFETY_CLASSES.dental_acute;
        expect(renderSafetyTemplate('urgency.dental', dental, 'es', 'CO').text).toContain('al 123');
        expect(renderSafetyTemplate('urgency.dental', dental, 'pt', 'BR').text).toContain('o 192');
        expect(renderSafetyTemplate('urgency.dental', dental, 'en', 'US').text).toContain('call 911');
        // A country the pack does not list gets the generic phrase, never a guessed number.
        const unknown = renderSafetyTemplate('urgency.dental', dental, 'fr', 'ZZ');
        expect(unknown.text).toContain("le numéro d'urgence de votre pays");
        expect(unknown.emergencyNumber).toBeNull();
        expect(unknown.emergencyReviewStatus).toBe('not_listed');
        const crisis = renderSafetyTemplate('urgency.mental_health', SAFETY_CLASSES.mental_health_crisis, 'es', 'MX');
        expect(crisis.text).toContain('800 911 2000');
        expect(renderSafetyTemplate('urgency.mental_health', SAFETY_CLASSES.mental_health_crisis, 'es', 'CO').text).not.toContain('{crisisLine}');
        for (const contacts of Object.values(COUNTRY_EMERGENCY_CONTACTS)) expect(contacts.reviewStatus).toBe('unreviewed');
    });

    it('shares the pet class semantics with the pet_emergency domain intent', () => {
        expect(SAFETY_CLASSES.pet_emergency.domainIntentKey).toBe('pet_emergency');
        const contract = buildDomainContractDraft('veterinaria', 'clinica_general');
        expect(contract.intents.map(intent => intent.key)).toContain('pet_emergency');
    });
});

describe('safety term backstop', () => {
    const cases: Array<[string, string, string]> = [
        ['dental_acute', 'me duele una muela desde hace 3 días y se me hinchó la cara, ¿qué antibiótico me tomo?', 'facial_swelling'],
        ['dental_acute', 'tengo fiebre y la encía muy inflamada desde la extracción de ayer', 'dental_infection_with_fever'],
        ['dental_acute', 'se me inflamó el cachete', 'facial_swelling'],
        ['dental_acute', 'no puedo abrir la boca', 'cannot_open_mouth_or_swallow'],
        ['dental_acute', 'my face is swollen after the extraction and I have a fever', 'facial_swelling'],
        ['dental_acute', 'meu rosto inchou depois da extração e estou com febre', 'facial_swelling'],
        ['dental_acute', "ma joue a gonflé et j'ai de la fièvre depuis l'extraction", 'facial_swelling'],
        ['medical_acute', 'tengo un dolor fuerte en el pecho', 'chest_pain'],
        ['mental_health_crisis', 'ya no quiero vivir', 'suicidal_ideation'],
        ['mental_health_crisis', 'I want to kill myself', 'suicidal_ideation'],
        ['pet_emergency', 'mi perro se comió chocolate', 'pet_poisoning'],
        ['aesthetic_complication', 'me aplicaron relleno ayer y la piel está blanca y me duele', 'post_procedure_complication'],
    ];
    it.each(cases)('%s fires on «%s»', (key, text, flag) => {
        expect(matchSafetyBackstop(text, SAFETY_CLASSES[key as keyof typeof SAFETY_CLASSES]).flags).toContain(flag);
    });

    it.each([
        'quiero blanqueamiento',
        'hace un año tuve hinchazón',
        'hace un año se me hinchó la cara y ya estoy bien, quiero una limpieza',
        '¿cuánto cuesta una limpieza?',
        'me sangran un poco las encías al cepillarme',
        'tengo la encía un poco inflamada',
        'tengo los ojos rojos de sueño',
        'I would like teeth whitening',
        'quero clareamento dental',
        'je voudrais un blanchiment',
    ])('dental stays quiet on «%s»', text => {
        expect(matchSafetyBackstop(text, SAFETY_CLASSES.dental_acute).flags).toEqual([]);
    });

    it('does not let a past marker hide a symptom that is happening now', () => {
        expect(matchSafetyBackstop('desde hace un año, y hoy otra vez se me hinchó la cara', SAFETY_CLASSES.dental_acute).flags).toContain('facial_swelling');
        expect(matchSafetyBackstop('hace un año se me hinchó la cara', SAFETY_CLASSES.dental_acute).suppressedByHistory).toBe(true);
        // Mental health: a disclosed past attempt is for the classifier, the terms still fire.
        expect(matchSafetyBackstop('hace años intenté suicidarme', SAFETY_CLASSES.mental_health_crisis).flags).toContain('suicidal_ideation');
    });
});
