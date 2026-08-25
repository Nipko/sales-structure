import { decideToolAuthority } from '@parallext/shared';
import { EffectiveCapabilityService } from './effective-capability.service';
import { ProcedureEngineService } from './procedure-engine.service';
import { TurnCapabilityComposerService } from './turn-capability-composer.service';
import { bookingEngineAuthorityDecision } from './turn-authority';

const tenantId = '11111111-1111-4111-8111-111111111111';
const schemaName = 'tenant_composed_authority';

function build(options: {
    payment?: Record<string, unknown>;
    mcpTools?: any[];
    plan?: Record<string, unknown>;
    providerHealth?: Record<string, unknown> | Error;
    providerBindings?: Record<string, boolean>;
} = {}) {
    const effective = new EffectiveCapabilityService(
        {
            getPlanFeatures: jest.fn().mockResolvedValue({
                plan: 'enterprise',
                verticalToolGroups: 'all',
                customerPayments: true,
                ...(options.plan || {}),
            }),
        } as any,
        undefined,
        undefined,
    );
    const payments = {
        getRuntimeCapability: jest.fn().mockResolvedValue({
            planEnabled: true,
            configured: true,
            ready: true,
            statusAvailable: true,
            activeProvider: 'wompi',
            discountsAvailable: false,
            ...(options.payment || {}),
        }),
    };
    const verticalIntegrations = {
        getAllHealth: options.providerHealth instanceof Error
            ? jest.fn().mockRejectedValue(options.providerHealth)
            : jest.fn().mockResolvedValue(options.providerHealth || {}),
        getConfiguredProviderBindings: jest.fn().mockResolvedValue(options.providerBindings || {
            toast: false, mindbody: false, cliniko: false,
        }),
    };
    const mcp = {
        listPublishableTools: jest.fn().mockResolvedValue({
            tools: options.mcpTools || [],
            discoveredCount: options.mcpTools?.length || 0,
            approvedCount: options.mcpTools?.length || 0,
        }),
    };
    return {
        service: new TurnCapabilityComposerService(
            effective,
            payments as any,
            verticalIntegrations as any,
            mcp as any,
        ),
        payments,
        mcp,
        verticalIntegrations,
    };
}

const config = (industry: string, tools: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    id: 'agent-1',
    name: 'Agente',
    slug: 'agente',
    industry,
    language: 'es',
    isActive: true,
    tools,
    ...extra,
} as any);

describe('TurnCapabilityComposerService', () => {
    it('keeps horizontal/core families while the subtype ceiling rejects an unrelated vertical', async () => {
        const { service } = build();

        const result = await service.resolve({
            tenantId,
            schemaName,
            config: config('salud', {
                crm: { enabled: true },
                policies: { enabled: true },
                knowledge: { enabled: true },
                orders: { enabled: true },
                insurance: { enabled: true },
            }),
            industry: 'salud',
            subType: 'dental',
            role: 'tenant_agent',
            channelType: 'whatsapp',
        });

        expect(result.contract?.publishedTools).toEqual(expect.arrayContaining([
            'get_customer_context',
            'add_contact_note',
            'get_policy',
            'search_knowledge_base',
            'list_customer_orders',
        ]));
        expect(result.contract?.publishedTools).not.toContain('file_claim');
        expect(result.contract?.excluded).toContainEqual(expect.objectContaining({
            subject: 'insurance',
            reason: 'not_in_subtype',
        }));
        expect(result.authority.allowedTools).toEqual(result.contract?.publishedTools);
    });

    it('composes live payment tools into the same contract and authority used by confirmations', async () => {
        const { service } = build();

        const result = await service.resolve({
            tenantId,
            schemaName,
            config: config('retail', {
                payments: { enabled: true, canCreateLinks: true },
            }),
            industry: 'retail',
            subType: 'moda',
            role: 'tenant_agent',
            channelType: 'whatsapp',
        });

        expect(result.tools.map(tool => tool.name)).toEqual(expect.arrayContaining([
            'get_payment_status',
            'create_payment_link',
        ]));
        expect(result.contract?.publishedTools).toContain('create_payment_link');
        expect(result.contract?.publishedByOrigin?.core).toContain('create_payment_link');
        expect(decideToolAuthority(result.authority, 'create_payment_link', { isNonCommittal: false }))
            .toEqual({ allowed: true });

        // Procedures used to receive the base/static contract resolved before
        // payment registration. Exercise the real Procedure gate with the
        // composed snapshot: it must reach the executor instead of producing a
        // false "tool not enabled" handoff.
        const procedure = {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Cobro',
            trigger: { keywords: ['pagar'] },
            status: 'active',
            version: 1,
            steps: [{
                id: 'pay',
                type: 'tool',
                config: {
                    tool: 'create_payment_link',
                    args: { amountCents: 5000, currency: 'COP', description: 'Pedido' },
                },
            }],
        };
        const executor = {
            execute: jest.fn().mockResolvedValue({
                error: 'confirmation_required',
                message: '¿Confirmas el pago?',
            }),
        };
        const procedureEngine = new ProcedureEngineService(
            {
                executeInTenantSchema: jest.fn().mockResolvedValue([procedure]),
            } as any,
            {
                getJson: jest.fn().mockResolvedValue({
                    procedureId: procedure.id,
                    version: 1,
                    currentStepId: 'pay',
                    collected: {},
                    awaitingField: null,
                    startedAt: new Date().toISOString(),
                }),
                setJson: jest.fn().mockResolvedValue(undefined),
                del: jest.fn().mockResolvedValue(undefined),
            } as any,
            executor as any,
        );

        const procedureResult = await procedureEngine.process(
            schemaName,
            tenantId,
            '33333333-3333-4333-8333-333333333333',
            '44444444-4444-4444-8444-444444444444',
            'sí',
            {
                toolsConfig: { payments: { enabled: true, canCreateLinks: true } },
                channelType: 'whatsapp',
                authority: result.authority,
            },
        );

        expect(procedureResult).toMatchObject({
            handled: true,
            completed: false,
            text: '¿Confirmas el pago?',
        });
        expect(executor.execute).toHaveBeenCalledWith(
            schemaName,
            tenantId,
            '44444444-4444-4444-8444-444444444444',
            'create_payment_link',
            { amountCents: 5000, currency: 'COP', description: 'Pedido' },
            '33333333-3333-4333-8333-333333333333',
            expect.objectContaining({ authority: result.authority }),
        );
    });

    it('applies STOP to payment and MCP writers while preserving reviewed reads', async () => {
        const { service } = build({
            mcpTools: [
                {
                    name: 'mcp__ledger__lookup',
                    description: 'Read a public ledger entry',
                    inputSchema: { type: 'object', properties: {} },
                    reviewedEffect: 'read',
                },
                {
                    name: 'mcp__ledger__post',
                    description: 'Post a ledger entry',
                    inputSchema: { type: 'object', properties: {} },
                    reviewedEffect: 'write',
                },
            ],
        });

        const result = await service.resolve({
            tenantId,
            schemaName,
            config: config('finanzas', {
                faqs: { enabled: true },
                payments: { enabled: true, canCreateLinks: true },
            }),
            industry: 'finanzas',
            subType: 'fintech',
            role: 'tenant_agent',
            channelType: 'whatsapp',
        });

        expect(result.status.status).toBe('blocked');
        expect(result.tools.map(tool => tool.name)).toEqual(expect.arrayContaining([
            'search_faqs',
            'get_payment_status',
            'mcp__ledger__lookup',
        ]));
        expect(result.tools.map(tool => tool.name)).not.toEqual(expect.arrayContaining([
            'create_payment_link',
            'mcp__ledger__post',
        ]));
        expect(result.authority.commitmentBlocked).toEqual(expect.objectContaining({
            reason: expect.stringContaining('profile_blocked'),
        }));
    });

    it('makes the booking engine fail closed when an owner subpermission removes its writer', async () => {
        const { service } = build();

        const result = await service.resolve({
            tenantId,
            schemaName,
            config: config('moda_belleza', {
                appointments: { enabled: true, canBook: false },
            }),
            industry: 'moda_belleza',
            subType: 'barberia',
            role: 'tenant_agent',
            channelType: 'whatsapp',
        });

        expect(result.contract?.publishedTools).not.toContain('create_appointment');
        expect(result.deniedTools).toContain('create_appointment');
        expect(bookingEngineAuthorityDecision(result.authority)).toMatchObject({
            allowed: false,
            deniedTool: 'create_appointment',
            reason: 'disabled_by_owner',
        });
    });

    it('preserves provider ownership when health retrieval fails', async () => {
        const { service, verticalIntegrations } = build({
            providerHealth: new Error('health store unavailable'),
            providerBindings: { toast: false, mindbody: true, cliniko: false },
        });

        const result = await service.resolve({
            tenantId,
            schemaName,
            config: config('gimnasios', { gyms: { enabled: true } }),
            industry: 'gimnasios',
            subType: 'gimnasio_general',
            role: 'tenant_agent',
            channelType: 'whatsapp',
        });

        expect(verticalIntegrations.getConfiguredProviderBindings).toHaveBeenCalledWith(tenantId);
        expect(result.contract?.publishedTools).not.toContain('get_fitness_schedule');
        expect(result.contract?.publishedTools).not.toContain('book_class');
        expect(result.contract?.publishedTools).not.toContain('cancel_class_booking');
        expect(result.contract?.certification.provider).toMatchObject({
            selected: 'mindbody',
            apiVersion: 'public-v6',
            configured: true,
            certified: false,
        });
        expect(result.contract?.certification.reasons.map(reason => reason.code))
            .toContain('provider_not_certified');
    });

    it.each([
        ['provider outage', { configured: true, connected: false, status: 'unhealthy' }],
        ['missing scope', {
            configured: true, connected: true, status: 'healthy', scopeStatus: 'missing',
            circuitState: 'closed',
        }],
        ['open circuit', {
            configured: true, connected: true, status: 'healthy', scopeStatus: 'satisfied',
            circuitState: 'open',
        }],
    ])('%s blocks external reads without restoring local writers', async (_case, mindbody) => {
        const { service } = build({ providerHealth: { mindbody } });

        const result = await service.resolve({
            tenantId,
            schemaName,
            config: config('gimnasios', { gyms: { enabled: true } }),
            industry: 'gimnasios',
            subType: 'gimnasio_general',
            role: 'tenant_agent',
            channelType: 'whatsapp',
        });

        expect(result.contract?.publishedTools).not.toContain('get_fitness_schedule');
        expect(result.contract?.publishedTools).not.toContain('book_class');
        expect(result.contract?.publishedTools).not.toContain('cancel_class_booking');
    });
});
