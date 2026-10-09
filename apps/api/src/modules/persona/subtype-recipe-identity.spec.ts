import { listVerticalCapabilityCompatibilityConfigurations } from '@parallext/shared';
import { getSubtypeRecipeOverlay, getVerticalDefinition } from '../verticals/vertical-definitions';
import { PersonaService } from './persona.service';
import { applySubtypeRecipeIdentity } from './subtype-recipe-identity';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SCHEMA = 'tenant_identity_test';

function harness(language = 'es-CO') {
    let inserted: { name: string; templateId: string; config: any } | null = null;
    const prisma: any = {
        tenant: { findUnique: jest.fn(async () => ({ language })) },
        $queryRawUnsafe: jest.fn(async (sql: string) => {
            if (sql.includes('COUNT(*)::int AS cnt') && sql.includes('agent_personas')) return [{ cnt: 0 }];
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
    return { service, inserted: () => inserted };
}

/**
 * Identity precedence at birth: subtype recipe > goal/industry template >
 * industry definition. The four education subtypes with an authored agent used
 * to be born as "Pablo, asesor académico" whatever their recipe said.
 */
describe('subtype recipe identity at agent creation', () => {
    it.each([
        ['academia_baile', 'Valentina', 'Asesora de clases'],
        ['academia_musica', 'Camila', 'Asesora de clases'],
        ['autoescuela', 'Andrés', 'Asesor de cursos'],
    ])('education/%s is born with the identity its recipe authored', async (subType, name, role) => {
        const ctx = harness();
        await ctx.service.createDefaultAgentFromGoals(TENANT_ID, ['faq'], 'onboarding', 'education', subType);

        const inserted = ctx.inserted()!;
        expect(inserted.templateId).toBe('tpl_educacion_inscripciones');
        expect(inserted.name).toBe(name);
        expect(inserted.config.persona).toMatchObject({ name, role });
        // The greeting introduces the same person the persona names.
        expect(inserted.config.persona.greeting).toContain(name);
        expect(inserted.config.persona.greeting).not.toContain('Pablo');
        // Behaviour still comes from the template the goals selected.
        expect(inserted.config.behavior.rules.length).toBeGreaterThan(0);
    });

    it('applies the recipe voice (tone and formality), not only the labels', async () => {
        const ctx = harness();
        await ctx.service.createDefaultAgentFromGoals(TENANT_ID, ['faq'], 'onboarding', 'education', 'academia_baile');
        expect(ctx.inserted()!.config.persona.personality).toMatchObject({
            tone: 'friendly', formality: 'casual',
        });
    });

    it('localizes the recipe identity to the tenant language', async () => {
        const ctx = harness('pt-BR');
        await ctx.service.createDefaultAgentFromGoals(TENANT_ID, ['faq'], 'onboarding', 'education', 'autoescuela');
        expect(ctx.inserted()!.config.persona).toMatchObject({ name: 'André', role: 'Consultor de cursos' });
    });

    it('leaves subtypes with no authored agent on the template identity', async () => {
        const ctx = harness();
        await ctx.service.createDefaultAgentFromGoals(TENANT_ID, ['support'], 'onboarding', 'technology', 'saas');
        expect(ctx.inserted()!.config.persona).toMatchObject({ name: 'Diego', role: 'Soporte técnico' });
        expect(ctx.inserted()!.name).not.toBe('');
    });

    it('does not touch the persona when the subtype has no agent overlay', () => {
        const persona = { name: 'Pablo', role: 'Asesor académico' };
        expect(applySubtypeRecipeIdentity(persona, 'education', 'universitaria', 'es'))
            .toEqual({ persona, applied: false });
        expect(applySubtypeRecipeIdentity(persona, undefined, undefined, 'es'))
            .toEqual({ persona, applied: false });
    });

    it('is defined for every subtype with an agent overlay, in every locale', () => {
        const withOverlay = listVerticalCapabilityCompatibilityConfigurations()
            .filter((c) => getSubtypeRecipeOverlay(c.industry, c.subtype)?.agent);
        expect(withOverlay.map((c) => `${c.industry}/${c.subtype}`).sort()).toEqual([
            'education/academia_baile',
            'education/academia_musica',
            'education/autoescuela',
            'education/clases_particulares',
        ]);
        for (const c of withOverlay) {
            for (const language of ['es', 'en', 'pt', 'fr']) {
                const agent = getVerticalDefinition(c.industry, c.subtype).agent;
                const { persona, applied } = applySubtypeRecipeIdentity(
                    { name: 'Template', role: 'Template role', greeting: 'Template greeting' },
                    c.industry,
                    c.subtype!,
                    language,
                );
                expect(applied).toBe(true);
                expect(persona!.name).toBe((agent.name[language] || agent.name.es).trim());
                expect(persona!.role).toBe((agent.role[language] || agent.role.es).trim());
                expect(persona!.greeting).toBe((agent.greeting[language] || agent.greeting.es).trim());
            }
        }
    });
});
