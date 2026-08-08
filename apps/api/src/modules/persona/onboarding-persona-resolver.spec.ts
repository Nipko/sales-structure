import { VERTICAL_REGISTRY } from '../verticals/vertical-definitions';
import { PersonaService } from './persona.service';
import {
    ONBOARDING_PERSONA_GOAL_PRIORITY,
    ONBOARDING_PERSONA_RESOLVER_VERSION,
    ONBOARDING_VERTICAL_PERSONA_POLICIES,
    resolveOnboardingPersonaTemplate,
} from './onboarding-persona-resolver';

function templateCatalog(industry: string, language = 'es') {
    const service = new PersonaService({} as any, {} as any, {} as any, {} as any, {} as any);
    return {
        vertical: (service.getVerticalTemplates(industry, language) || []).map((template: any) => template.id),
        builtin: service.getBuiltinTemplates(language).map((template: any) => template.id),
    };
}

function resolve(industry: string, subType: string | null, goals: string[], language = 'es') {
    const catalog = templateCatalog(industry, language);
    return resolveOnboardingPersonaTemplate({
        industry,
        subType,
        goals,
        availableVerticalTemplateIds: catalog.vertical,
        availableBuiltinTemplateIds: catalog.builtin,
    });
}

describe('versioned onboarding persona resolver', () => {
    it('covers the exact 18-vertical registry and every catalogued subtype/goal combination', () => {
        expect(Object.keys(ONBOARDING_VERTICAL_PERSONA_POLICIES).sort())
            .toEqual(Object.keys(VERTICAL_REGISTRY).sort());
        expect(Object.keys(VERTICAL_REGISTRY)).toHaveLength(18);

        for (const [industry, definition] of Object.entries(VERTICAL_REGISTRY)) {
            const subTypes = definition.subTypes.length > 0
                ? definition.subTypes.map(({ key }) => key)
                : [null];
            for (const language of ['es', 'en', 'pt', 'fr']) {
                const catalog = templateCatalog(industry, language);
                expect(catalog.vertical.length).toBeGreaterThan(0);
                for (const subType of subTypes) {
                    for (const goal of ONBOARDING_PERSONA_GOAL_PRIORITY) {
                        const resolution = resolveOnboardingPersonaTemplate({
                            industry,
                            subType,
                            goals: [goal],
                            availableVerticalTemplateIds: catalog.vertical,
                            availableBuiltinTemplateIds: catalog.builtin,
                        });
                        expect(resolution.version).toBe(ONBOARDING_PERSONA_RESOLVER_VERSION);
                        expect(catalog.vertical).toContain(resolution.templateId);
                    }
                }
            }
        }
    });

    it.each([
        ['salud', 'psicologia', 'support', 'tpl_salud_seguimiento'],
        ['gimnasios', 'gimnasio_general', 'appointments', 'tpl_gimnasio_clases'],
        ['seguros', 'vida', 'support', 'tpl_seguros_postventa'],
        ['moda_belleza', 'salon_belleza', 'sales', 'tpl_belleza_productos'],
        ['inmobiliaria', 'construccion', 'support', 'tpl_inmobiliaria_soporte'],
        ['restaurantes', 'cafeteria', 'sales', 'tpl_restaurante_delivery'],
        ['automotriz', 'concesionario', 'support', 'tpl_automotriz_servicio'],
        ['turismo', 'hotel', 'support', 'tpl_turismo_soporte'],
        ['finanzas', 'creditos', 'support', 'tpl_finanzas_renovaciones'],
        ['servicios_profesionales', 'consultores', 'support', 'tpl_legal_seguimiento'],
        ['retail', 'moda', 'support', 'tpl_retail_postventa'],
        ['technology', 'saas', 'support', 'tpl_technology_soporte'],
        ['pet_services', 'peluqueria', 'sales', 'tpl_pet_tienda'],
        ['servicios_hogar', 'plomeria', 'support', 'tpl_hogar_seguimiento'],
        ['fotografia', 'estudio', 'support', 'tpl_foto_entrega'],
        ['otro', null, 'support', 'tpl_otro_soporte'],
    ])('selects the existing role template for %s/%s goal %s', (industry, subType, goal, expected) => {
        expect(resolve(industry, subType, [goal]).templateId).toBe(expected);
        expect(resolve(industry, subType, [goal]).source).toBe('goal');
    });

    it.each([
        ['salud', 'dental', 'support', 'tpl_salud_dental'],
        ['restaurantes', 'dark_kitchen', 'appointments', 'tpl_restaurante_delivery'],
        ['inmobiliaria', 'venta', 'support', 'tpl_inmobiliaria_listings'],
        ['automotriz', 'taller', 'sales', 'tpl_automotriz_servicio'],
        ['turismo', 'tours', 'support', 'tpl_turismo_tours'],
        ['gimnasios', 'yoga_pilates', 'sales', 'tpl_gimnasio_clases'],
        ['seguros', 'broker', 'support', 'tpl_seguros_cotizador'],
        ['servicios_profesionales', 'abogados', 'support', 'tpl_legal_consulta'],
        ['fotografia', 'bodas', 'support', 'tpl_foto_reservas'],
    ])('preserves shipped subtype choice and reports a %s/%s goal conflict', (industry, subType, goal, expected) => {
        const resolution = resolve(industry, subType, [goal]);
        expect(resolution).toEqual(expect.objectContaining({
            templateId: expected,
            source: 'subtype',
            matchedGoal: goal,
            gaps: expect.arrayContaining(['subtype_goal_conflict']),
        }));
    });

    it('inherits the existing multi-goal priority independent of checkbox order', () => {
        const first = resolve('technology', 'saas', ['sales', 'support']);
        const reversed = resolve('technology', 'saas', ['support', 'sales']);
        expect(first.templateId).toBe('tpl_technology_soporte');
        expect(reversed.templateId).toBe(first.templateId);
        expect(first.matchedGoal).toBe('support');
        expect(first.gaps).toContain('multiple_goal_templates');
    });

    it('records a missing role template without guessing or mutating the input', () => {
        const goals = Object.freeze(['promotions']);
        const resolution = resolve('retail', 'moda', goals as unknown as string[]);
        expect(resolution).toEqual(expect.objectContaining({
            templateId: 'tpl_retail_ventas',
            source: 'vertical_default',
            matchedGoal: 'promotions',
            gaps: ['goal_template_missing'],
        }));
        expect(goals).toEqual(['promotions']);
    });

    it('retains generic goal behavior only when there is no canonical vertical policy', () => {
        const builtins = templateCatalog('otro').builtin;
        expect(resolveOnboardingPersonaTemplate({
            goals: ['support'],
            availableBuiltinTemplateIds: builtins,
        })).toEqual({
            version: 1,
            templateId: 'tpl_support',
            source: 'generic_goal',
            matchedGoal: 'support',
            gaps: [],
        });
    });
});
