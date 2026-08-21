import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { BusinessInfoService } from '../business-info/business-info.service';
import { FaqsService } from '../faqs/faqs.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { PersonaService } from '../persona/persona.service';
import { PoliciesService } from '../policies/policies.service';
import { TenantsService } from '../tenants/tenants.service';
import { AgentTestService } from './agent-test.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';
const SCHEMA = 'tenant_read_only_11111111111141118111111111111111';

function writerTrap(name: string) {
    return jest.fn(() => {
        throw new Error(`unexpected write: ${name}`);
    });
}

function buildRedis() {
    return {
        get: jest.fn().mockResolvedValue(null),
        getJson: jest.fn().mockResolvedValue(null),
        smembers: jest.fn().mockResolvedValue([]),
        tenantKey: jest.fn((tenantId: string, suffix: string) => `tenant:${tenantId}:${suffix}`),
        getClient: jest.fn(() => ({ lrange: jest.fn().mockResolvedValue([]) })),
        set: writerTrap('redis.set'),
        setJson: writerTrap('redis.setJson'),
        del: writerTrap('redis.del'),
        incrBy: jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(1),
        sadd: jest.fn().mockResolvedValue(1),
    };
}

function assertOnlyOperationalRedisWrites(redis: ReturnType<typeof buildRedis>) {
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.setJson).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
    for (const [key] of redis.incrBy.mock.calls) {
        expect(key).toMatch(/^llm:(?:stats|cost):/);
    }
    for (const [key] of redis.expire.mock.calls) {
        expect(key).toMatch(/^llm:(?:stats|cost):/);
    }
    for (const [key] of redis.sadd.mock.calls) {
        expect(key).toMatch(/^llm:stats:/);
    }
}

function assertNoRedisWrites(redis: ReturnType<typeof buildRedis>) {
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.setJson).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
    expect(redis.incrBy).not.toHaveBeenCalled();
    expect(redis.expire).not.toHaveBeenCalled();
    expect(redis.sadd).not.toHaveBeenCalled();
}

function assertNoRedisAccess(redis: ReturnType<typeof buildRedis>) {
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.getJson).not.toHaveBeenCalled();
    expect(redis.smembers).not.toHaveBeenCalled();
    expect(redis.tenantKey).not.toHaveBeenCalled();
    expect(redis.getClient).not.toHaveBeenCalled();
    assertNoRedisWrites(redis);
}

describe('Agent Test no-business-write execution', () => {
    it('resolves the tenant schema from Postgres without warming Redis', async () => {
        const redis = buildRedis();
        const prisma = {
            tenant: {
                findUnique: jest.fn().mockResolvedValue({ schemaName: SCHEMA }),
            },
        };

        const schema = await TenantsService.prototype.getSchemaName.call(
            { prisma, redis },
            TENANT_ID,
            AGENT_TEST_EXECUTION_CONTEXT,
        );

        expect(schema).toBe(SCHEMA);
        expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
            where: { id: TENANT_ID },
            select: { schemaName: true },
        });
        expect(redis.get).not.toHaveBeenCalled();
        assertNoRedisAccess(redis);
    });

    it('runs real read paths without DDL/cache/events while accounting provider cost and quota', async () => {
        const redis = buildRedis();
        const config = {
            language: 'es-CO',
            rag: { enabled: true, topK: 3, similarityThreshold: 0 },
            tools: {},
            llm: { temperature: 0 },
        };
        const prisma = {
            $executeRawUnsafe: writerTrap('prisma.$executeRawUnsafe'),
            $queryRawUnsafe: jest.fn(async (sql: string) => {
                if (sql.includes('agent_personas')) return [{ id: AGENT_ID, config_json: config }];
                if (sql.includes('companies')) {
                    return [{
                        id: '33333333-3333-4333-8333-333333333333',
                        name: 'Empresa de prueba',
                        industry: 'services',
                        city: 'Bogotá',
                        country: 'CO',
                        website: null,
                        phone: null,
                        email: null,
                        about: null,
                        address: null,
                        logo_url: null,
                        social_links: {},
                        is_primary: true,
                        created_at: new Date(),
                        updated_at: new Date(),
                    }];
                }
                throw new Error(`unexpected direct query: ${sql}`);
            }),
            executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
                if (sql.includes('COUNT(*)')) return [{ cnt: 1 }];
                if (sql.includes('<=>')) {
                    return [{
                        chunk_id: '44444444-4444-4444-8444-444444444444',
                        document_id: '55555555-5555-4555-8555-555555555555',
                        title: 'Horario',
                        chunk_text: 'Atendemos de lunes a viernes.',
                        chunk_index: 0,
                        metadata: {},
                        doc_language: 'es',
                        distance: 0.1,
                    }];
                }
                if (sql.includes('search_tsv')) return [];
                throw new Error(`unexpected tenant query: ${sql}`);
            }),
            getTenantSchemaName: jest.fn().mockResolvedValue(SCHEMA),
        };
        const tenants = {
            getSchemaName: jest.fn(async (_tenantId: string, context: any) => {
                expect(context).toBe(AGENT_TEST_EXECUTION_CONTEXT);
                return SCHEMA;
            }),
        };
        const eventEmitter = { emit: writerTrap('eventEmitter.emit') };
        const llmKeys = {
            isConfigured: jest.fn(async (provider: string) => provider === 'openai'),
            getKey: jest.fn().mockResolvedValue('test-openai-key'),
        };
        const provider = {
            providerName: 'openai',
            generate: jest.fn().mockResolvedValue({
                content: 'Respuesta de prueba',
                finishReason: 'stop',
                usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
            }),
        };
        const router = new LLMRouterService(
            [provider] as any,
            redis as any,
            llmKeys as any,
            eventEmitter as any,
        );
        const persona = new PersonaService(
            prisma as any,
            redis as any,
            tenants as any,
            {} as any,
            eventEmitter as any,
        );
        const businessInfo = new BusinessInfoService(prisma as any, redis as any, tenants as any);
        const knowledge = new KnowledgeService(
            prisma as any,
            redis as any,
            {} as any,
            {} as any,
            llmKeys as any,
            router,
        );
        (knowledge as any).openai = {
            embeddings: {
                create: jest.fn().mockResolvedValue({
                    data: [{ embedding: [0.1, 0.2, 0.3] }],
                    usage: { total_tokens: 3 },
                }),
            },
        };
        (knowledge as any).currentKey = 'test-openai-key';

        const ensurePersona = jest.spyOn(persona, 'ensureMultiAgentTables');
        const ensureBusiness = jest.spyOn(businessInfo as any, 'ensureSchema');
        const ensureKnowledge = jest.spyOn(knowledge as any, 'ensureKbSearchVector');
        const retrievalWriter = jest.spyOn(knowledge as any, 'trackRetrieval');
        const statsWriter = jest.spyOn(router as any, 'trackStats');
        const affinityWriter = jest.spyOn(router as any, 'setAffinity');
        const breakerWriter = jest.spyOn(router as any, 'markProviderFailure');
        const traceWriter = jest.spyOn(router as any, 'emitTurnTrace');
        const throttle = {
            hasAiMessageQuota: jest.fn().mockResolvedValue(true),
            getPlanFeatures: jest.fn().mockResolvedValue({ llmTier: 'tier_2' }),
            getLlmSpendUsdCents: jest.fn().mockResolvedValue(0),
            incrementAiMessageCount: jest.fn().mockResolvedValue(1),
        };

        const service = new AgentTestService(
            persona,
            router,
            knowledge,
            businessInfo,
            {
                computeUpcomingDays: jest.fn().mockReturnValue([]),
                assemble: jest.fn().mockReturnValue('<system>test</system>'),
            } as any,
            { detect: jest.fn().mockReturnValue('es') } as any,
            { execute: jest.fn() } as any,
            tenants as any,
            throttle as any,
            { populateTurnContext: jest.fn().mockResolvedValue({ failures: [] }) } as any,
        );

        const result = await service.test(TENANT_ID, AGENT_ID, { message: '¿Cuál es el horario?' });
        await new Promise(resolve => setImmediate(resolve));

        expect(result.reply).toBe('Respuesta de prueba');
        expect(result.debug.ragHits).toHaveLength(1);
        expect(provider.generate).toHaveBeenCalled();
        expect(ensurePersona).not.toHaveBeenCalled();
        expect(ensureBusiness).not.toHaveBeenCalled();
        expect(ensureKnowledge).not.toHaveBeenCalled();
        expect(retrievalWriter).not.toHaveBeenCalled();
        expect(statsWriter).toHaveBeenCalledTimes(1);
        expect(throttle.incrementAiMessageCount).toHaveBeenCalledWith(TENANT_ID);
        expect(affinityWriter).not.toHaveBeenCalled();
        expect(breakerWriter).not.toHaveBeenCalled();
        expect(traceWriter).not.toHaveBeenCalled();
        expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
        expect(eventEmitter.emit).not.toHaveBeenCalled();
        assertOnlyOperationalRedisWrites(redis);
    });

    it('accounts failed provider attempts but does not mutate breaker state or emit alerts', async () => {
        const redis = buildRedis();
        const eventEmitter = { emit: writerTrap('eventEmitter.emit') };
        const router = new LLMRouterService(
            [{
                providerName: 'openai',
                generate: jest.fn().mockRejectedValue(new Error('provider down')),
            }] as any,
            redis as any,
            { isConfigured: jest.fn(async (provider: string) => provider === 'openai') } as any,
            eventEmitter as any,
        );
        const breakerWriter = jest.spyOn(router as any, 'markProviderFailure');
        const statsWriter = jest.spyOn(router as any, 'trackStats');

        await expect(router.execute({
            task: 'conversation',
            messages: [{ role: 'user', content: 'hola' }],
            tenantId: TENANT_ID,
            executionContext: AGENT_TEST_EXECUTION_CONTEXT,
        })).rejects.toThrow('provider down');
        await new Promise(resolve => setImmediate(resolve));

        expect(breakerWriter).not.toHaveBeenCalled();
        expect(statsWriter).toHaveBeenCalled();
        expect(eventEmitter.emit).not.toHaveBeenCalled();
        assertOnlyOperationalRedisWrites(redis);
    });

    it('keeps FAQ and policy tools read-only and rejects a writer at the real executor boundary', async () => {
        const redis = buildRedis();
        const prisma = {
            $executeRawUnsafe: writerTrap('prisma.$executeRawUnsafe'),
            $queryRawUnsafe: jest.fn(async (sql: string) => {
                if (sql.includes('"faqs"')) {
                    return [{
                        id: '66666666-6666-4666-8666-666666666666',
                        question: '¿Cuál es el horario?',
                        answer: 'De 8 a 5',
                        category: 'general',
                        tags: [],
                        order_index: 0,
                        is_published: true,
                        views: 0,
                        created_at: new Date(),
                        updated_at: new Date(),
                    }];
                }
                if (sql.includes('"policies"')) {
                    return [{
                        id: '77777777-7777-4777-8777-777777777777',
                        type: 'return',
                        title: 'Devoluciones',
                        content: 'Hasta 30 días.',
                        version: 1,
                        effective_from: new Date(),
                        effective_to: null,
                        is_active: true,
                        created_at: new Date(),
                        updated_at: new Date(),
                    }];
                }
                throw new Error(`unexpected query: ${sql}`);
            }),
        };
        const tenants = { getSchemaName: jest.fn().mockResolvedValue(SCHEMA) };
        const faqs = new FaqsService(prisma as any, redis as any, tenants as any);
        const policies = new PoliciesService(prisma as any, redis as any, tenants as any);
        const incrementWriter = jest.spyOn(faqs, 'incrementViews');
        const executor = new AIToolExecutorService(
            prisma as any,
            redis as any,
            { emit: writerTrap('eventEmitter.emit') } as any,
            {} as any,
            faqs,
            policies,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {
                preflight: jest.fn().mockResolvedValue({ allowed: true, policy: { externalEffect: 'none' } }),
                complete: jest.fn(),
                fail: jest.fn(),
            } as any,
            {} as any,
            {} as any,
        );

        // Las tres tools están autorizadas a propósito, `create_appointment`
        // incluida: lo que este caso mide es que el modo de sólo-lectura la
        // frene. Dejarla fuera de la autoridad la haría caer por
        // `not_authorised` y la prueba pasaría sin ejercitar el gate.
        const opts = {
            authority: authorityFor('search_faqs', 'get_policy', 'create_appointment'),
            readOnly: true,
            executionContext: AGENT_TEST_EXECUTION_CONTEXT,
        };
        const faqResult = await executor.execute(
            SCHEMA, TENANT_ID, AGENT_ID, 'search_faqs', { query: 'horario' }, undefined, opts,
        );
        const policyResult = await executor.execute(
            SCHEMA, TENANT_ID, AGENT_ID, 'get_policy', { type: 'return' }, undefined, opts,
        );
        const blocked = await executor.execute(
            SCHEMA, TENANT_ID, AGENT_ID, 'create_appointment', {}, undefined, opts,
        );

        expect(faqResult.faqs).toHaveLength(1);
        expect(policyResult).toMatchObject({ type: 'return', version: 1 });
        expect(blocked).toMatchObject({ error: 'agent_test_read_only', persisted: false });
        expect(incrementWriter).not.toHaveBeenCalled();
        expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
        assertNoRedisAccess(redis);
    });
});
