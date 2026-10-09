import {
    listVerticalCapabilityConfigurations,
    resolveSubtypeExperienceProfile,
} from '@parallext/shared';
import { getVerticalDefinition } from '../verticals/vertical-definitions';
import { PersonaService } from './persona.service';
import { applyNativeSubtypeBirthBehavior } from './subtype-recipe-identity';
import { VERTICAL_SUBTYPE_PERSONA_CONTRACTS } from './vertical-subtype-persona-contract';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SCHEMA = 'tenant_native_identity_test';

function harness(language = 'es-CO', existingAgents = 0) {
    let inserted: { name: string; templateId: string; config: any } | null = null;
    const prisma: any = {
        tenant: { findUnique: jest.fn(async () => ({ language })) },
        $queryRawUnsafe: jest.fn(async (sql: string) => {
            if (sql.includes('COUNT(*)::int AS cnt') && sql.includes('agent_personas')) {
                return [{ cnt: existingAgents }];
            }
            if (sql.includes(`"${SCHEMA}".services`) || sql.includes(`"${SCHEMA}".availability_slots`)) {
                return [{ cnt: 1 }];
            }
            throw new Error(`Unexpected query: ${sql}`);
        }),
        $executeRawUnsafe: jest.fn(async (sql: string, ...params: any[]) => {
            if (sql.includes('INSERT INTO') && sql.includes('agent_personas')) {
                inserted = { name: params[0], templateId: params[1], config: JSON.parse(params[2]) };
                return 1;
            }
            throw new Error(`Unexpected execute: ${sql}`);
        }),
    };
    const service = new PersonaService(
        prisma,
        { del: jest.fn() } as any,
        { getSchemaName: jest.fn(async () => SCHEMA) } as any,
        {} as any,
        {} as any,
    );
    return { service, prisma, inserted: () => inserted };
}

const SCHEDULING = /\b(cita|citas|agenda|agend\w*|appointments?|schedul\w*|rendez-vous|agendamento|demo|demos|test[- ]drives?|prueba de manejo|essai routier)\b/i;

/**
 * What each native subtype's tools can NOT do, so its identity must not
 * promise it (docs/business-types-catalog.md, «Familias de herramientas»).
 */
const PROMISES_TO_AVOID: Record<string, RegExp> = {
    'salud/farmacia': /recet|prescri|ordonnance|dosis|dosage|posologi|diagn[oó]st/i,
    'automotriz/repuestos': /instal|montaje|taller|mec[aá]nic/i,
    'automotriz/alquiler': /compra|venta|financ|sale\b|buy/i,
    'technology/hardware': /cotiz|quote|devis|or[cç]amento|propuesta|proposal|soporte|support/i,
    'pet_services/guarderia': /peluquer|grooming|ba[nñ]o|bath|bain|banho|paseo|walk|promenade|veterin/i,
    'pet_services/hotel': /peluquer|grooming|ba[nñ]o|bath|bain|banho|paseo|walk|promenade|veterin/i,
};

const NATIVE: Array<[string, string, string, string]> = [
    // industry, subtype, name (es), role (es)
    ['salud', 'farmacia', 'Marina', 'Asistente de farmacia'],
    ['automotriz', 'repuestos', 'Camilo', 'Asesor de repuestos'],
    ['automotriz', 'alquiler', 'Lucía', 'Asesora de alquiler de vehículos'],
    ['technology', 'hardware', 'Esteban', 'Asesor de hardware y redes'],
    ['pet_services', 'guarderia', 'Bruno', 'Asistente de guardería para mascotas'],
    ['pet_services', 'hotel', 'Nala', 'Asistente del hotel para mascotas'],
];

const SPIN_FRAGMENTS = [
    'SPIN', 'objeción', 'objection', 'lead caliente', 'hot lead', 'características o precios',
    'features or pricing', 'presupuesto + plazo', 'budget + timeline', 'benefits and outcomes',
    'beneficios y resultados',
];

describe('native-operation subtypes are born with an identity that fits them', () => {
    it('covers exactly the six subtypes of the persona contract', () => {
        expect(NATIVE.map(([i, s]) => `${i}/${s}`).sort()).toEqual(
            VERTICAL_SUBTYPE_PERSONA_CONTRACTS.map((c) => `${c.industry}/${c.subType}`).sort(),
        );
    });

    it('tells only the pharmacy agent that prescription products go to a person (the catalogue gate does exactly that)', async () => {
        for (const [industry, subType] of NATIVE) {
            const ctx = harness();
            await ctx.service.createDefaultAgentFromGoals(TENANT_ID, ['sales'], 'onboarding', industry, subType);
            const rules = (ctx.inserted()!.config.behavior.rules as string[]).join(' ');
            if (subType === 'farmacia') {
                expect(rules).toMatch(/fórmula médica no se venden por chat/);
                expect(rules).toMatch(/persona del equipo para que revise la receta/);
            } else {
                expect(rules).not.toMatch(/fórmula|receta/i);
            }
        }
        for (const language of ['pt-BR', 'fr-FR', 'en-US']) {
            const ctx = harness(language);
            await ctx.service.createDefaultAgentFromGoals(TENANT_ID, ['sales'], 'onboarding', 'salud', 'farmacia');
            expect((ctx.inserted()!.config.behavior.rules as string[]).join(' '))
                .toMatch(/prescription|receita|ordonnance/);
        }
    });

    describe.each(NATIVE)('%s/%s', (industry, subType, name, role) => {
        it('is born with its own name, role, voice and greeting instead of «Asesor de Ventas»', async () => {
            const ctx = harness();
            await ctx.service.createDefaultAgentFromGoals(TENANT_ID, ['sales'], 'onboarding', industry, subType);

            const inserted = ctx.inserted()!;
            // Still the safe generic template: the identity is layered on at birth.
            expect(inserted.templateId).toBe('tpl_sales');
            expect(inserted.name).toBe(name);
            expect(inserted.config.persona).toMatchObject({ name, role });
            expect(inserted.config.persona.greeting).toContain(name);
            expect(inserted.config.persona.name).not.toBe('Asesor de Ventas');
            expect(inserted.config.persona.role).not.toMatch(/comercial consultivo/i);
            expect(inserted.config.persona.greeting).not.toMatch(/Me encantaría entender qué estás buscando/);
        });

        it('applies the authored voice (tone and formality) from the recipe overlay', async () => {
            const ctx = harness();
            await ctx.service.createDefaultAgentFromGoals(TENANT_ID, [], 'onboarding', industry, subType);
            const agent = getVerticalDefinition(industry, subType).agent;
            expect(ctx.inserted()!.config.persona.personality).toMatchObject({
                tone: agent.tone, formality: agent.formality,
            });
            // The overlay really authors the voice: it is not the industry's.
            expect(`${agent.name.es}|${agent.role.es}`).not.toBe(
                `${getVerticalDefinition(industry).agent.name.es}|${getVerticalDefinition(industry).agent.role.es}`,
            );
        });

        it('replaces the SPIN sales script with the subtype contract rules', async () => {
            const ctx = harness();
            await ctx.service.createDefaultAgentFromGoals(TENANT_ID, ['sales'], 'onboarding', industry, subType);
            const behavior = ctx.inserted()!.config.behavior;
            const contract = VERTICAL_SUBTYPE_PERSONA_CONTRACTS
                .find((c) => c.industry === industry && c.subType === subType)!;

            expect(behavior.rules).toEqual([...contract.birthBehavior.es.rules, ...contract.nativeRules.es]);
            const everything = JSON.stringify(behavior);
            for (const fragment of SPIN_FRAGMENTS) expect(everything).not.toContain(fragment);
            expect(behavior.handoffTriggers).toEqual(contract.birthBehavior.es.handoffTriggers);
            // Not an agenda business: nothing the born agent says offers scheduling.
            expect([...behavior.rules, ...behavior.handoffTriggers].join(' ')).not.toMatch(SCHEDULING);
        });

        it.each(['es', 'en', 'pt', 'fr'])('describes only what its tools do, in %s', (language) => {
            const agent = getVerticalDefinition(industry, subType).agent;
            const text = [agent.name, agent.role, agent.greeting]
                .map((localized) => (localized as Record<string, string>)[language])
                .join(' | ');
            expect(text.replace(/\s|\|/g, '')).not.toBe('');
            for (const field of [agent.name, agent.role, agent.greeting]) {
                expect((field as Record<string, string>)[language]?.trim()).toBeTruthy();
            }
            expect(text).not.toMatch(SCHEDULING);
            expect(text).not.toMatch(PROMISES_TO_AVOID[`${industry}/${subType}`]);
        });

        it.each([
            ['pt-BR', 'pt'],
            ['fr-FR', 'fr'],
            ['en-US', 'en'],
        ])('is localized for a %s tenant', async (tenantLanguage, locale) => {
            const ctx = harness(tenantLanguage);
            await ctx.service.createDefaultAgentFromGoals(TENANT_ID, ['sales'], 'onboarding', industry, subType);
            const agent = getVerticalDefinition(industry, subType).agent;
            const contract = VERTICAL_SUBTYPE_PERSONA_CONTRACTS
                .find((c) => c.industry === industry && c.subType === subType)!;
            const born = ctx.inserted()!.config;
            expect(born.persona.name).toBe((agent.name as Record<string, string>)[locale]);
            expect(born.persona.role).toBe((agent.role as Record<string, string>)[locale]);
            expect(born.persona.greeting).toBe((agent.greeting as Record<string, string>)[locale]);
            expect(born.behavior.rules).toEqual(
                [...contract.birthBehavior[locale as 'pt'].rules, ...contract.nativeRules[locale as 'pt']],
            );
            // The English template is what pt/fr tenants get: none of its SPIN text survives.
            for (const fragment of SPIN_FRAGMENTS) expect(JSON.stringify(born.behavior)).not.toContain(fragment);
        });

        it('never touches an agent that already exists (create-only)', async () => {
            const ctx = harness('es-CO', 1);
            await ctx.service.createDefaultAgentFromGoals(TENANT_ID, ['sales'], 'onboarding', industry, subType);
            expect(ctx.inserted()).toBeNull();
            expect(ctx.prisma.$executeRawUnsafe).not.toHaveBeenCalled();
        });
    });

    it('leaves the other subtypes of the same industries on their own templates and identities', async () => {
        const cases: Array<[string, string, string]> = [
            ['salud', 'dental', 'tpl_salud_dental'],
            ['automotriz', 'concesionario', 'tpl_automotriz_ventas'],
            ['automotriz', 'taller', 'tpl_automotriz_servicio'],
            ['technology', 'saas', 'tpl_technology_ventas'],
            ['pet_services', 'peluqueria', 'tpl_pet_atencion'],
        ];
        for (const [industry, subType, templateId] of cases) {
            const ctx = harness();
            await ctx.service.createDefaultAgentFromGoals(TENANT_ID, ['faq'], 'onboarding', industry, subType);
            const inserted = ctx.inserted()!;
            expect(inserted.templateId).toBe(templateId);
            for (const [, , nativeName] of NATIVE) expect(inserted.config.persona.name).not.toBe(nativeName);
        }
    });

    it('applyNativeSubtypeBirthBehavior is a no-op outside the generic onboarding template', () => {
        const config = { behavior: { rules: ['Regla propia'], handoffTriggers: ['Disparador propio'] } };
        expect(applyNativeSubtypeBirthBehavior(config, 'salud', 'farmacia', 'tpl_salud_recepcion', 'es'))
            .toEqual({ config, applied: false });
        expect(applyNativeSubtypeBirthBehavior(config, 'salud', 'dental', 'tpl_sales', 'es'))
            .toEqual({ config, applied: false });
        expect(applyNativeSubtypeBirthBehavior(config, undefined, undefined, 'tpl_sales', 'es'))
            .toEqual({ config, applied: false });
    });

    it('falls back to Spanish for a language the contract does not localize', () => {
        const result = applyNativeSubtypeBirthBehavior({}, 'salud', 'farmacia', 'tpl_sales', 'de');
        const contract = VERTICAL_SUBTYPE_PERSONA_CONTRACTS[0];
        expect(result.applied).toBe(true);
        expect(result.config.behavior.rules).toEqual([...contract.birthBehavior.es.rules, ...contract.nativeRules.es]);
    });
});

/**
 * The guard the owner asked for: no business type a customer can pick at
 * signup is born as the generic «Asesor de Ventas». A new selectable subtype
 * that lands on `tpl_sales` fails here until someone writes its identity (or
 * lists it below with the reason it is intended).
 */
describe('no selectable business type is born with the generic sales identity', () => {
    const GENERIC_SALES_NAMES = new Set(['Asesor de Ventas', 'Sales Advisor']);
    /** Intended exceptions: «industry/subtype» -> why. Empty on purpose. */
    const INTENDED_GENERIC: Record<string, string> = {};
    const GOAL_SETS: string[][] = [[], ['sales'], ['faq'], ['support'], ['appointments'], ['lead_qualification']];

    const selectable = listVerticalCapabilityConfigurations().filter(
        (c) => resolveSubtypeExperienceProfile(c.industry, c.subtype).availability === 'selectable',
    );

    it('sweeps a meaningful number of selectable configurations', () => {
        expect(selectable.length).toBeGreaterThan(50);
    });

    it('lists every selectable subtype that is born as tpl_sales with the generic identity', async () => {
        const offenders = new Set<string>();
        for (const config of selectable) {
            for (const goals of GOAL_SETS) {
                for (const language of ['es-CO', 'en-US']) {
                    const ctx = harness(language);
                    await ctx.service.createDefaultAgentFromGoals(
                        TENANT_ID, goals, 'onboarding', config.industry, config.subtype ?? undefined,
                    );
                    const inserted = ctx.inserted()!;
                    if (inserted.templateId === 'tpl_sales' && GENERIC_SALES_NAMES.has(inserted.config.persona.name)) {
                        offenders.add(`${config.industry}/${config.subtype ?? '__none__'}`);
                    }
                }
            }
        }
        expect([...offenders].sort()).toEqual(Object.keys(INTENDED_GENERIC).sort());
    }, 120_000);
});
