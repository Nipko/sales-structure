import {
    buildDomainContractDraft,
    EFFECTIVE_CAPABILITY_CONTRACT_VERSION,
} from '@parallext/shared';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AgentTestService } from './agent-test.service';

describe('Agent Test live capability and prompt parity', () => {
    it('freezes the capability snapshot before every engine or LLM execution in the live turn', () => {
        const source = readFileSync(resolve(__dirname, 'conversations.service.ts'), 'utf8');
        const incomingStart = source.indexOf('async processIncomingMessage(');
        const generateStart = source.indexOf('private async generateResponse(');
        expect(incomingStart).toBeGreaterThanOrEqual(0);
        expect(generateStart).toBeGreaterThan(incomingStart);
        expect(source.slice(incomingStart, generateStart)).toContain('this.generateResponse(');

        const generateEnd = source.indexOf('\n    private async resolveEffectiveCapability(', generateStart);
        const body = source.slice(generateStart, generateEnd > generateStart ? generateEnd : undefined);
        const snapshotAt = body.indexOf('this.turnCapabilityComposer.resolve(');
        expect(snapshotAt).toBeGreaterThanOrEqual(0);
        for (const downstream of [
            'this.bookingEngine.process(',
            'this.procedureEngine.process(',
            'this.llmRouter.execute({',
        ]) {
            expect({ downstream, ordered: body.indexOf(downstream) > snapshotAt })
                .toEqual({ downstream, ordered: true });
        }
    });

    it('uses the shared turn composer and vertical-context builder verbatim', async () => {
        const domainContract = buildDomainContractDraft('retail', 'moda');
        const contract: any = {
            version: EFFECTIVE_CAPABILITY_CONTRACT_VERSION,
            tenantId: 'tenant-id',
            agentId: 'agent-id',
            subtypeProfileId: 'retail/moda',
            planSnapshot: 'pro',
            countryPackId: 'es-CO',
            domainContract,
            publishedTools: ['search_products', 'create_appointment'],
            publishedByOrigin: {
                core: ['search_products', 'create_appointment'],
                vertical: [], provider: [], mcp: [],
            },
            publishedGroups: ['catalog', 'appointments'],
            excluded: [],
            unmetReadiness: [],
            degraded: false,
            writersBlocked: false,
            decisionInputs: {},
            resolvedAt: '2026-08-23T12:00:00.000Z',
        };
        const composer = {
            resolve: jest.fn().mockResolvedValue({
                contract,
                status: { status: 'ok', profileId: 'retail/moda' },
                tools: [
                    { name: 'search_products', description: 'Search', parameters: { type: 'object', properties: {} } },
                    { name: 'create_appointment', description: 'Book', parameters: { type: 'object', properties: {} } },
                ],
                authority: {
                    source: 'turn_contract',
                    allowedTools: ['search_products', 'create_appointment'],
                    commitmentBlocked: null,
                    deniedTools: ['check_stock'],
                    resolvedAt: contract.resolvedAt,
                    subtypeProfileId: 'retail/moda',
                },
                deniedTools: ['check_stock'], commitmentBlocked: null,
            }),
        };
        const verticalContext = {
            resolve: jest.fn().mockResolvedValue({
                industry: 'retail',
                subType: 'moda',
                primaryObjectNoun: 'Producto',
                domainContract: {
                    contractVersion: 2,
                    profileId: 'retail/moda',
                    status: 'draft',
                    scope: 'venta_directa',
                    claims: [], intents: [], unresolved: [],
                },
            }),
        };
        const llmRouter = {
            execute: jest.fn()
                .mockResolvedValueOnce({
                    content: '', model: 'test',
                    toolCalls: [{ id: 'call-1', function: { name: 'search_products', arguments: '{}' } }],
                })
                .mockResolvedValueOnce({ content: 'ok', model: 'test' }),
        };
        const toolExecutor = { execute: jest.fn().mockResolvedValue({ items: [] }) };
        const promptAssembler = {
            computeUpcomingDays: jest.fn().mockReturnValue([]),
            assemble: jest.fn().mockReturnValue('prompt'),
        };
        const regional = {
            resolve: jest.fn().mockResolvedValue({
                operatingCountry: { value: 'CO' },
                operatingCurrency: { value: 'COP' },
                locale: { value: 'es-CO' },
                timezone: { value: 'America/Bogota' },
                addressForm: { value: 'usted' },
                countryPackId: 'es-CO', countryPackVersion: '1', countryPackStatus: 'draft',
                preferredTerms: { appointment: 'cita' }, prohibitedRegisters: ['parce'],
            }),
        };
        const service = new AgentTestService(
            { getAgent: jest.fn().mockResolvedValue({ config_json: { language: 'es-CO', industry: 'retail', tools: {} } }) } as any,
            llmRouter as any,
            { tenantHasKnowledge: jest.fn().mockResolvedValue(false) } as any,
            { getPrimary: jest.fn().mockResolvedValue(null) } as any,
            promptAssembler as any,
            { detect: jest.fn().mockReturnValue('es') } as any,
            toolExecutor as any,
            { getSchemaName: jest.fn().mockResolvedValue('tenant_schema') } as any,
            {
                hasAiMessageQuota: jest.fn().mockResolvedValue(true),
                getPlanFeatures: jest.fn().mockResolvedValue({ llmTier: 'tier_2', llmCostBudgetUsdCents: -1 }),
                incrementAiMessageCount: jest.fn().mockResolvedValue(1),
            } as any,
            { populateTurnContext: jest.fn().mockResolvedValue({ failures: [] }) } as any,
            regional as any,
            undefined,
            undefined,
            undefined,
            undefined,
            verticalContext as any,
            composer as any,
        );

        const result = await service.test('tenant-id', 'agent-id', {
            message: 'hola', channelType: 'telegram',
        });

        expect(composer.resolve).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: 'tenant-id', schemaName: 'tenant_schema',
            industry: 'retail', subType: 'moda',
            role: 'tenant_agent', channelType: 'telegram',
            operatingCountry: 'CO', jurisdiction: 'CO',
        }));
        expect(promptAssembler.assemble.mock.calls[0][1]).toMatchObject({
            regional: {
                preferredTerms: { appointment: 'cita' },
                prohibitedRegisters: ['parce'],
            },
            verticalContext: {
                industry: 'retail', subType: 'moda', primaryObjectNoun: 'Producto',
            },
            capability: { status: 'ok', profileId: 'retail/moda' },
        });
        expect(llmRouter.execute.mock.calls[0][0].tools.map((tool: any) => tool.name))
            .toEqual(['search_products']);
        expect(result.debug.toolParity?.tools.map(tool => tool.name))
            .toEqual(['search_products', 'create_appointment']);
        expect(result.debug.effectiveCapability).toBe(contract);
        expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
        expect(toolExecutor.execute.mock.calls[0][6].authority).toEqual({
            source: 'agent_test',
            allowedTools: ['search_products'],
            commitmentBlocked: null,
            deniedTools: ['check_stock'],
            resolvedAt: contract.resolvedAt,
            subtypeProfileId: 'retail/moda',
        });
        expect(toolExecutor.execute.mock.calls[0][6].channelType).toBe('telegram');
    });

    it('does not re-authorise an unpublished safe tool when the live contract is STOP', async () => {
        const domainContract = buildDomainContractDraft('retail', 'moda');
        const resolvedAt = new Date().toISOString();
        const contract: any = {
            version: EFFECTIVE_CAPABILITY_CONTRACT_VERSION,
            tenantId: 'tenant-id', agentId: 'agent-id', subtypeProfileId: 'retail/moda',
            planSnapshot: 'pro', countryPackId: 'es-CO', domainContract,
            publishedTools: ['search_products'],
            publishedByOrigin: { core: ['search_products'], vertical: [], provider: [], mcp: [] },
            publishedGroups: ['catalog'], excluded: [], unmetReadiness: [], degraded: false,
            writersBlocked: true, decisionInputs: {}, resolvedAt,
        };
        const composer = {
            resolve: jest.fn().mockResolvedValue({
                contract,
                status: { status: 'blocked', reason: 'profile_blocked', profileId: 'retail/moda' },
                tools: [{ name: 'search_products', description: 'Search', parameters: { type: 'object', properties: {} } }],
                authority: {
                    source: 'turn_contract',
                    allowedTools: ['search_products'],
                    commitmentBlocked: { reason: 'capability:blocked:profile_blocked' },
                    deniedTools: [], resolvedAt, subtypeProfileId: 'retail/moda',
                },
                deniedTools: [],
                commitmentBlocked: { reason: 'capability:blocked:profile_blocked' },
            }),
        };
        const llmRouter = {
            execute: jest.fn()
                // get_policy is globally read-only, but this turn did not publish it.
                .mockResolvedValueOnce({
                    content: '', model: 'test',
                    toolCalls: [{ id: 'call-1', function: { name: 'get_policy', arguments: '{}' } }],
                })
                .mockResolvedValueOnce({ content: 'ok', model: 'test' }),
        };
        const toolExecutor = { execute: jest.fn() };
        const service = new AgentTestService(
            { getAgent: jest.fn().mockResolvedValue({ config_json: { language: 'es-CO', industry: 'retail', tools: {} } }) } as any,
            llmRouter as any,
            { tenantHasKnowledge: jest.fn().mockResolvedValue(false) } as any,
            { getPrimary: jest.fn().mockResolvedValue(null) } as any,
            { computeUpcomingDays: jest.fn().mockReturnValue([]), assemble: jest.fn().mockReturnValue('prompt') } as any,
            { detect: jest.fn().mockReturnValue('es') } as any,
            toolExecutor as any,
            { getSchemaName: jest.fn().mockResolvedValue('tenant_schema') } as any,
            {
                hasAiMessageQuota: jest.fn().mockResolvedValue(true),
                getPlanFeatures: jest.fn().mockResolvedValue({ llmTier: 'tier_2', llmCostBudgetUsdCents: -1 }),
                incrementAiMessageCount: jest.fn().mockResolvedValue(1),
            } as any,
            { populateTurnContext: jest.fn().mockResolvedValue({ failures: [] }) } as any,
            undefined, undefined, undefined, undefined, undefined, undefined,
            composer as any,
        );

        const result = await service.test('tenant-id', 'agent-id', { message: 'hola' });

        expect(toolExecutor.execute).not.toHaveBeenCalled();
        expect(result.debug.toolCalls).toEqual([
            expect.objectContaining({
                name: 'get_policy',
                result: expect.objectContaining({ error: 'agent_test_read_only', persisted: false }),
            }),
        ]);
        expect(result.debug.effectiveCapability?.writersBlocked).toBe(true);
    });
});
