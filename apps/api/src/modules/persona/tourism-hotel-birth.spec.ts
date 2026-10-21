import { PersonaService } from './persona.service';
import { VerticalsService } from '../verticals/verticals.service';
import { getVerticalDefinition } from '../verticals/vertical-definitions';

function harness(language = 'es-CO', existing = 0) {
    let saved: any;
    const prisma: any = {
        tenant: { findUnique: jest.fn(async () => ({ language })) },
        $queryRawUnsafe: jest.fn(async (sql: string) => {
            if (sql.includes('COUNT(*)::int AS cnt') && sql.includes('agent_personas')) return [{ cnt: existing }];
            if (sql.includes('.services') || sql.includes('.availability_slots')) return [{ cnt: 1 }];
            throw new Error('Unexpected read');
        }),
        $executeRawUnsafe: jest.fn(async (sql: string, ...params: any[]) => {
            if (!sql.includes('INSERT INTO') || !sql.includes('agent_personas')) throw new Error('Unexpected write');
            saved = JSON.parse(params[2]); return 1;
        }),
    };
    const service = new PersonaService(prisma, { del: jest.fn() } as any,
        { getSchemaName: jest.fn(async () => 'tenant_hotel_birth_test') } as any, {} as any, {} as any);
    return { service, saved: () => saved, prisma };
}

describe('Tourism hotel birth matches property capabilities', () => {
    it.each(['es-CO', 'en-US', 'pt-BR', 'fr-FR'])('does not create a package sales agent for a hotel in %s', async language => {
        const h = harness(language);
        await h.service.createDefaultAgentFromGoals('11111111-1111-4111-8111-111111111111', ['sales'], 'onboarding', 'turismo', 'hotel');
        const config = h.saved();
        expect(config.behavior.rules.join(' ')).toContain('list_properties');
        expect(config.behavior.rules.join(' ')).toContain('send_property_image');
        expect(config.behavior.rules.join(' ')).not.toMatch(/search_packages|check_package_availability/);
        expect(config.persona.role).not.toMatch(/paquet|package|pacote|forfait/i);
        expect(config.tools.properties.enabled).toBe(true);
        expect(config.tools.tours.enabled).toBe(false);
    });

    it('never rewrites an existing hotel agent on onboarding retry', async () => {
        const h = harness('es', 1);
        await h.service.createDefaultAgentFromGoals('11111111-1111-4111-8111-111111111111', ['sales'], 'onboarding', 'turismo', 'hotel');
        expect(h.prisma.$executeRawUnsafe).not.toHaveBeenCalled();
        expect(h.saved()).toBeUndefined();
    });

    it('does not restore the package rules during the following vertical bootstrap', async () => {
        const h = harness();
        await h.service.createDefaultAgentFromGoals('11111111-1111-4111-8111-111111111111', ['sales'], 'onboarding', 'turismo', 'hotel');
        const created = h.saved(); let patched: any;
        const verticals: any = Object.create(VerticalsService.prototype);
        verticals.logger = { debug: jest.fn(), warn: jest.fn() };
        const query = jest.fn(async (sql: string, params?: any[]) => {
            if (sql.includes('SELECT id, name, template_id, config_json')) return [{ id: 'agent', name: 'Maya', template_id: 'tpl_turismo_ventas', config_json: created }];
            if (sql.includes('UPDATE agent_personas')) { patched = JSON.parse(params![1]); return 1; }
            throw new Error('Unexpected bootstrap query');
        });
        verticals.withTenantQuery = async (_schema: string, _executor: unknown, work: any) => work(query);
        await verticals.patchDefaultAgent('tenant_hotel_birth_test', getVerticalDefinition('turismo', 'hotel'), 'hotel', 'es');
        expect(patched.behavior.rules.join(' ')).toContain('list_properties');
        expect(patched.behavior.rules.join(' ')).not.toContain('search_packages');
        expect(patched.tools.properties.enabled).toBe(true);
        expect(patched.tools.tours.enabled).toBe(false);
    });

    it('preserves the package workflow for an actual travel agency', async () => {
        const h = harness();
        await h.service.createDefaultAgentFromGoals('11111111-1111-4111-8111-111111111111', ['sales'], 'onboarding', 'turismo', 'agencia_viajes');
        expect(h.saved().behavior.rules.join(' ')).toContain('search_packages');
    });
});
