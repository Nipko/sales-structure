import {
    listCanonicalSubtypeExperienceProfileIds,
    resolveSubtypeExperienceProfile,
} from '@parallext/shared';
import { TOOL_FAMILIES } from './agent-tool-registry';
import { EffectiveCapabilityService, PROVIDER_INTEGRATION_POLICIES } from './effective-capability.service';
import { TurnCapabilityComposerService } from './turn-capability-composer.service';
import { Logger } from '@nestjs/common';

const tenantId = '11111111-1111-4111-8111-111111111111';
const schemaName = 'tenant_owner_controls';
const profiles = listCanonicalSubtypeExperienceProfileIds();

function build(options: { ownershipUnavailable?: boolean; configured?: boolean; paymentUnavailable?: boolean; paymentFailure?: boolean; readiness?: any } = {}) {
    const effective = new EffectiveCapabilityService({
        getPlanFeatures: jest.fn().mockResolvedValue({ customerPayments: true }),
        getTenantPlan: jest.fn().mockResolvedValue('pro'),
    } as any, options.readiness);
    const providers = Object.fromEntries(Object.keys(PROVIDER_INTEGRATION_POLICIES).map(name => [name, {
        configured: options.configured !== false,
        connected: options.configured !== false,
        status: 'healthy', scopeStatus: 'satisfied', circuitState: 'closed',
        lastSuccessfulSyncAt: new Date().toISOString(),
    }]));
    const integrations = {
        getAllHealth: options.ownershipUnavailable
            ? jest.fn().mockRejectedValue(new Error('health storage unavailable'))
            : jest.fn().mockResolvedValue(providers),
        getConfiguredProviderBindings: options.ownershipUnavailable
            ? jest.fn().mockRejectedValue(new Error('binding storage unavailable'))
            : jest.fn().mockResolvedValue({ toast: false, mindbody: false, cliniko: false }),
    };
    const composer = new TurnCapabilityComposerService(effective, {
        getRuntimeCapability: options.paymentFailure ? jest.fn().mockRejectedValue(new Error('payment unavailable')) : jest.fn().mockResolvedValue({
            planEnabled: true, statusAvailable: true, ready: !options.paymentUnavailable,
            discountsAvailable: false,
        }),
    } as any, integrations as any, {
        listPublishableTools: jest.fn().mockResolvedValue({ tools: [], discoveredCount: 0, approvedCount: 0 }),
    } as any);
    return { composer, integrations };
}

function input(profileId: string, enabled: boolean) {
    const [industry, subtype] = profileId.split('/');
    const tools = Object.fromEntries(TOOL_FAMILIES.map(family => [family.key, { enabled }]));
    return {
        tenantId, schemaName, industry, subType: subtype === '__none__' ? null : subtype,
        role: 'tenant_agent', channelType: 'whatsapp',
        config: { tools } as any,
    };
}

describe('owner controls through the production capability composer', () => {
    beforeEach(() => jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined));
    afterEach(() => jest.restoreAllMocks());
    it('covers each canonical business profile without merging subtype siblings', () => {
        expect(profiles).toHaveLength(80);
        expect(new Set(profiles).size).toBe(80);
    });

    it.each(profiles)('%s cannot publish provider tools when every family is disabled', async profileId => {
        const { composer } = build();
        const result = await composer.resolve(input(profileId, false));
        expect(result.tools).toEqual([]);
        expect(result.authority.allowedTools).toEqual([]);
    });

    it.each(profiles)('%s cannot regain local provider-owned writers when both ownership reads fail', async profileId => {
        const { composer } = build({ ownershipUnavailable: true });
        const result = await composer.resolve(input(profileId, true));
        const profile = resolveSubtypeExperienceProfile(input(profileId, true).industry, input(profileId, true).subType);
        const policies = Object.values(PROVIDER_INTEGRATION_POLICIES).filter(policy => policy.profileIds.includes(profile.id));
        for (const policy of policies) {
            for (const name of [...policy.tools, ...policy.localWritersDisplaced]) {
                expect(result.authority.allowedTools).not.toContain(name);
            }
        }
        if (policies.length) {
            expect(result.contract?.degraded).toBe(true);
            expect(result.contract?.excluded).toContainEqual(expect.objectContaining({ reason: 'provider_unavailable' }));
        }
    });

    it.each([
        ['restaurantes/comida_rapida', 'place_order', 'get_menu'],
        ['gimnasios/gimnasio_general', 'book_class', 'get_class_schedule'],
        ['salud/medica_general', 'create_appointment', 'list_services'],
    ])('%s keeps its native writer when the authoritative lookup confirms no provider', async (profileId, writer, reader) => {
        const { composer } = build({ configured: false });
        const result = await composer.resolve(input(profileId, true));
        expect(result.authority.allowedTools).toContain(writer);
        expect(result.authority.allowedTools).toContain(reader);
        expect(result.contract?.degraded).toBe(false);
    });

    it.each([false, true])('payment setup exclusions lead to the tenant payment integration screen (lookup throws=%s)', async paymentFailure => {
        const { composer } = build({ paymentUnavailable: true, paymentFailure, configured: false });
        const args = input('retail/moda', false);
        args.config.tools.payments = { enabled: true, canCreateLinks: true };
        const result = await composer.resolve(args);
        expect(result.contract?.excluded).toContainEqual(expect.objectContaining({
            subject: 'payments', reason: 'provider_unavailable',
            repairRoute: '/admin/settings/integrations/payments',
        }));
    });

    it('only an explicit diagnostics refresh bypasses the readiness cache', async () => {
        const readiness = { evaluate: jest.fn().mockResolvedValue({ unmet: [], checks: [], degraded: false }) };
        const { composer } = build({ configured: false, readiness });
        const args = input('gimnasios/gimnasio_general', true);
        await composer.resolve(args);
        expect(readiness.evaluate.mock.calls[0]).toHaveLength(5);
        expect(readiness.evaluate.mock.calls[0][4]).toEqual({
            refresh: undefined, sandboxNamespace: undefined,
        });
        await composer.resolve({ ...args, refreshReadiness: true });
        expect(readiness.evaluate.mock.calls[1]).toHaveLength(5);
        expect(readiness.evaluate.mock.calls[1][4]).toEqual({
            refresh: true, sandboxNamespace: undefined,
        });
    });
});
