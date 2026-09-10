import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { composeSubtypeEvalPack, EVAL_LANGUAGES } from '@parallext/shared';

import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PersonaService } from './persona.service';
import { AgentDraftService } from './agent-draft.service';
import { AgentDraftController } from './agent-draft.controller';
import { AgentPublicationService } from './agent-publication.service';
import { AgentPublicationController } from './agent-publication.controller';
import { AGENT_PUBLICATION_TABLES } from './agent-publication-store';
import { AgentConfigurationRevisionStore, operationalConfigurationHash, type RevisionQuery } from './agent-configuration-revision';
import { servedAgentAuthority } from './served-agent-authority';
import { AgentReleaseService } from '../simulation/agent-release.service';
import { AgentReleaseController } from '../simulation/agent-release.controller';
import { AgentReleaseStore } from '../simulation/agent-release-store';
import { releaseRunContext, sealReleaseRun } from '../simulation/agent-release-policy';
import { EvaluationRevisionService } from '../evaluation-revision/evaluation-revision.service';
import { revisionHash, sealRevision } from '../evaluation-revision/evaluation-revision';
import { sealStructuredKnowledgeCapture } from '../evaluation-revision/evaluation-structured-knowledge';
import { evaluationSnapshot, sealEvaluationSnapshot, resolveEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { evaluationKnowledgeFixture } from '../conversations/__fixtures__/evaluation-knowledge.fixture';
import { ConversationsService } from '../conversations/conversations.service';
import { PromptAssemblerService } from '../conversations/prompt-assembler.service';
import { ResponseValidatorService } from '../conversations/response-validator.service';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

const url = process.env.AGENT_RELEASE_TEST_DATABASE_URL;

/**
 * ═══ PUBLISHING AN AGENT, WALKED — NOT ASSERTED FROM THE INSIDE ═══
 *
 * The transactional primitive already has a real-PostgreSQL suite, and the
 * application boundary has a unit suite with the store stubbed. Between them
 * nothing ever went the whole way: nobody had taken a reviewed candidate to the
 * agent that answers customers through the routes a person actually calls, and
 * then shown that the next turn speaks with what was published — and, after a
 * rollback, with what it replaced.
 *
 * A test that calls `AgentPublicationStore.publish` and then reads the row it
 * just wrote proves the row. It cannot prove that the guard chain lets the right
 * person through, that the service supplies the live checks the primitive
 * refuses to invent, or that resolution by connection now answers for a channel
 * it did not answer for a minute ago. This walks all of that.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS REAL
 * ─────────────────────────────────────────────────────────────────────────────
 *  · PostgreSQL 55437, two disposable tenant schemas. Every publication,
 *    revision and release table comes from the shipped `prisma/tenant-schema.sql`
 *    through the production `ensureCanonicalTables`, and `agent_personas`
 *    through the production `PersonaService.ensureMultiAgentTables` — no
 *    hand-written approximation of either.
 *  · `PrismaService`'s own `executeInTenantSchema` / `transactionInTenantSchema`
 *    over a real `PrismaClient`, so each statement really runs in its own
 *    transaction under `SET LOCAL search_path`.
 *  · The real `RolesGuard` — with a real `Reflector` reading the real `@Roles`
 *    metadata off the real handler functions — and the real `TenantGuard`, in
 *    front of every call. No request here skips the door.
 *  · `AgentDraftController` → `AgentDraftService`, `AgentReleaseController` →
 *    `AgentReleaseService` → `AgentReleaseStore`, `AgentPublicationController` →
 *    `AgentPublicationService` → `AgentPublicationStore`, including the live
 *    checks the service builds per call (evaluation currency, subscription
 *    entitlement, configuration entitlement) and the post-commit settlement
 *    (cache drop, audit row, `agent.config.updated`).
 *  · `PersonaService.resolvePersonaForChannel` — the exact call the turn makes —
 *    and `servedAgentAuthority`, over the real rows.
 *  · `PromptAssemblerService` on the real `PersonaService`, so the system prompt
 *    is assembled from the published configuration by shipped code, and
 *    `ConversationsService.generateResponse`, the real method, up to the model.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS A FIXTURE, AND WHY IT HAS TO BE
 * ─────────────────────────────────────────────────────────────────────────────
 *  · The model. There are no provider keys here and no budget to spend, so
 *    `llmRouter.execute` is a double that records its request. What it records
 *    is the assembled `systemPrompt`, which is the only thing asked of it.
 *  · The evaluation RUN. Producing evidence across four languages and two
 *    channels means real model calls; the scores below are synthetic and
 *    certify NOTHING about model performance. What is real is everything the
 *    evidence then has to survive — the review CAS, the evidence hash, the
 *    approval row, and the publication's refusal when any of them moves.
 *  · The dependency inventory behind `EvaluationRevisionService.capture`, which
 *    would need a fully seeded tenant. `assertCurrent`'s integrity check and
 *    comparison are the real ones, and one test moves the inventory to prove
 *    the gate refuses at the instant of the effect.
 *  · The collaborators around `generateResponse` that have no bearing on WHICH
 *    configuration is spoken — message store, knowledge, booking, tools. The
 *    whole-turn spine is proven in `normal-turn-e2e.postgres.spec.ts`.
 *  · The global Prisma models: this disposable database has synthetic global
 *    tables, not the generated schema.
 */
(url ? describe : describe.skip)('Publishing an agent and taking it back, from the route to the next turn', () => {
    const suffix = randomUUID().replace(/-/g, '');
    const schema = `tenant_pubwalk_${suffix}`, otherSchema = `tenant_pubwalkb_${suffix}`;
    const tenantId = randomUUID(), otherTenantId = randomUUID(), agentId = randomUUID();
    const adminId = randomUUID(), supervisorId = randomUUID(), operatorId = randomUUID(), otherAdminId = randomUUID();

    const admin = { sub: adminId, id: adminId, role: 'tenant_admin', tenantId, email: 'admin@example.test' };
    const supervisor = { sub: supervisorId, id: supervisorId, role: 'tenant_supervisor', tenantId };
    const operator = { sub: operatorId, id: operatorId, role: 'tenant_agent', tenantId };
    const otherAdmin = { sub: otherAdminId, id: otherAdminId, role: 'tenant_admin', tenantId: otherTenantId };

    /** What the agent says before anything is published — and again after a rollback. */
    const SERVING_ROLE = 'Asesor de ventas de mostrador';
    const SERVING_GREETING = 'SALUDO_OPERACIONAL: buenas, te ayudo con el mostrador.';
    const SERVING_RULE = 'REGLA_OPERACIONAL: no prometas fechas sin confirmar stock.';
    /** What the reviewed candidate would have it say instead. */
    const PUBLISHED_ROLE = 'Asesora de reservas';
    const PUBLISHED_GREETING = 'SALUDO_PUBLICADO: hola, agendamos tu visita.';
    const PUBLISHED_RULE = 'REGLA_PUBLICADA: ofrece siempre el horario de la tarde primero.';

    const servingConfig = () => ({
        language: 'es',
        persona: { name: 'Alex', role: SERVING_ROLE, greeting: SERVING_GREETING, fallbackMessage: 'Te paso con una persona.' },
        behavior: { rules: [SERVING_RULE], handoffTriggers: ['hablar con humano'] },
        hours: { aiOutsideHours: true },
    });

    let client: PrismaClient, prisma: any, personaService: PersonaService;
    let draftController: AgentDraftController, releaseController: AgentReleaseController;
    let publicationController: AgentPublicationController;
    let releaseStore: AgentReleaseStore, promptAssembler: PromptAssemblerService;
    let findTenant: any;
    const emitted: any[] = [], audited: any[] = [];
    /** Moved by one test, to prove the evaluation gate is re-read at the effect. */
    let liveManifest: any = null;
    /** Flipped by one test, to prove the review refuses a snapshot that moved. */
    let snapshotStale = false;

    const query = (sql: string, params: any[] = []): Promise<any[]> => prisma.executeInTenantSchema(schema, sql, params);
    const tx = <T>(work: (q: RevisionQuery) => Promise<T>) => prisma.transactionInTenantSchema(schema, work);
    const agentRow = async () => (await query('SELECT * FROM agent_personas WHERE id=$1::uuid', [agentId]))[0];

    // ── the door ────────────────────────────────────────────────────────────
    // Every call below passes the real guard chain first. A test that reaches a
    // controller method directly proves the method, not the endpoint.
    const reflector = new Reflector(), rolesGuard = new RolesGuard(reflector), tenantGuard = new TenantGuard();
    const admit = (controller: any, handler: string, req: any) => {
        const context: any = {
            getHandler: () => Object.getPrototypeOf(controller)[handler],
            getClass: () => controller.constructor,
            switchToHttp: () => ({ getRequest: () => req }),
        };
        if (!rolesGuard.canActivate(context)) throw new ForbiddenException({ error: 'roles_guard_denied' });
        if (!tenantGuard.canActivate(context)) throw new ForbiddenException({ error: 'tenant_guard_denied' });
        return req;
    };

    const readWorkspace = (user: any = admin) => {
        const req = admit(draftController, 'read', { user, params: { tenantId, agentId } });
        return draftController.read(tenantId, agentId, req).then(r => r.data as any);
    };
    const saveDraft = (body: any, user: any = admin) => {
        const req = admit(draftController, 'save', { user, params: { tenantId, agentId }, body });
        return draftController.save(tenantId, agentId, body, req).then(r => r.data as any);
    };
    const readCandidate = (candidateId: string, user: any = admin, tenant = tenantId) => {
        const req = admit(releaseController, 'read', { user, params: { tenantId: tenant, agentId, candidateId } });
        return releaseController.read(tenant, agentId, candidateId, req).then(r => r.data as any);
    };
    const reviewCandidate = (candidateId: string, body: any, user: any = admin, tenant = tenantId) => {
        const req = admit(releaseController, 'review', { user, params: { tenantId: tenant, agentId, candidateId }, body });
        return releaseController.review(tenant, agentId, candidateId, body, req).then(r => r.data as any);
    };
    const history = (user: any = admin, tenant = tenantId) => {
        const req = admit(publicationController, 'history', { user, params: { tenantId: tenant, agentId } });
        return publicationController.history(tenant, agentId, undefined as any, req).then(r => r.data as any);
    };
    const publish = (candidateId: string, body: any, user: any = admin, tenant = tenantId) => {
        const req = admit(publicationController, 'publish', { user, params: { tenantId: tenant, agentId, candidateId }, body });
        return publicationController.publish(tenant, agentId, candidateId, body, req).then(r => r.data as any);
    };
    const rollback = (body: any, user: any = admin, tenant = tenantId) => {
        const req = admit(publicationController, 'rollback', { user, params: { tenantId: tenant, agentId }, body });
        return publicationController.rollback(tenant, agentId, body, req).then(r => r.data as any);
    };

    // ── the candidate and its evidence ──────────────────────────────────────
    const CHANNELS = ['whatsapp', 'telegram'];
    const sourceScenarios = EVAL_LANGUAGES
        .flatMap(language => composeSubtypeEvalPack({ industry: 'education', subtype: 'capacitacion', language }))
        .filter(row => !row.key.startsWith('intent_') || row.key.startsWith('intent_ask_question_'))
        .map(row => ({ ...row, key: row.storageKey, managedSeedKey: row.key, seedOrigin: row.origin, expectedActions: row.expectedActions || [] }));

    const publishedBody = (operational: any) => ({
        name: 'Alex',
        configJson: {
            ...structuredClone(operational.config_json),
            persona: { name: 'Alex', role: PUBLISHED_ROLE, greeting: PUBLISHED_GREETING, fallbackMessage: 'Te paso con una persona.' },
            behavior: { rules: [PUBLISHED_RULE], handoffTriggers: ['hablar con humano'] },
        },
        channels: [...CHANNELS],
        channelBindings: ['whatsapp:wa-main', 'telegram:tg-main'],
        scheduleMode: '24_7', isActive: true, isDefault: false,
    });

    /** Save the edit as a draft through the panel route, and return its revision. */
    const savedDraft = async () => {
        const operational = await agentRow();
        const body = publishedBody(operational);
        const saved = await saveDraft({ expectedOperationalVersion: Number(operational.version),
            expectedDraftRevision: null, requestKey: randomUUID(), body });
        return { revision: saved.savedRevision, body, operational };
    };

    const snapshotFor = (draft: any, body: any, operational: any) => {
        const snapshot: any = evaluationSnapshot(tenantId, agentId, { version: Number(operational.version), config_json: body.configJson });
        snapshot.configurationRevisionId = draft.id;
        snapshot.configurationRevisionHash = draft.bodyHash;
        snapshot.configurationBody = structuredClone(body);
        snapshot.configurationBaseOperationalHash = draft.baseOperationalHash;
        snapshot.configurationBaseOperationalBody = {
            name: operational.name, configJson: operational.config_json, channels: operational.channels || [],
            channelBindings: operational.channel_bindings || [], scheduleMode: operational.schedule_mode || '24_7',
            isActive: operational.is_active === true, isDefault: operational.is_default === true,
        };
        snapshot.releaseScope = { profileId: 'education/capacitacion', intentKeys: ['ask_question'],
            missionConfigured: true, channels: [...CHANNELS], languages: [...EVAL_LANGUAGES] };
        snapshot.mcpTools = []; snapshot.mcpToolsHash = revisionHash([]);
        snapshot.procedures = []; snapshot.proceduresHash = revisionHash([]);
        snapshot.runtimeInputs = { providerHealth: {}, planFeatures: {}, llmSpendUsdCents: 0, mcpDiscoveredCount: 0, mcpApprovedCount: 0 };
        snapshot.runtimeInputsHash = revisionHash(snapshot.runtimeInputs);
        snapshot.contextInputs = { version: 1, tenantId, businessHours: null, business: null, activeObjectPolicy: {},
            regional: new RegionalProfileService({} as any, {} as any).compose(tenantId, {}), vertical: { es: null, en: null, pt: null, fr: null } };
        snapshot.structuredKnowledgeInputs = sealStructuredKnowledgeCapture({ version: 1, tenantId, sourceSchema: schema,
            capturedAt: snapshot.capturedAt, faqs: { state: 'present', rows: [] }, policies: { state: 'present', rows: [] } });
        snapshot.knowledgeInputs = evaluationKnowledgeFixture(tenantId, agentId, schema);
        snapshot.manifest = sealRevision(tenantId, [{ key: 'fixture.publication_walk', state: 'present', hash: revisionHash('synthetic') }], []);
        sealEvaluationSnapshot(snapshot);
        return snapshot;
    };

    // Synthetic scores. See the header: this stands in for a model run, and the
    // only thing it certifies is that the storage and approval policy accept it.
    const completed = (work: any) => {
        const evidence: any = { agentId, dependencyRevision: work.candidate.agent_snapshot.manifest.revision,
            configHash: work.candidate.agent_snapshot.configHash, channelType: work.evaluation.channel_type,
            status: 'completed', k: 3, passPolicy: 'all', threshold: 8, scenarios: work.candidate.scenarios };
        const results = evidence.scenarios.map((row: any) => ({ key: row.key, scenarioHash: revisionHash(row),
            contextHash: releaseRunContext(evidence), k: 3, passes: 3, passed: true, score: 9,
            runs: Array.from({ length: 3 }, () => ({ score: 9, passed: true, flags: [], actionChecks: row.expectedActions.map(() => ({ ok: true })),
                transcript: [{ role: 'user', content: 'Pregunta sintética' }, { role: 'assistant', content: `Respuesta sintética ${row.language}` }],
                transcriptTruncated: false })) }));
        return { status: 'completed' as const, results, evidence: sealReleaseRun({ ...evidence, results }), runId: randomUUID() };
    };

    /** A candidate carrying complete evidence for every assigned channel. */
    const evaluatedCandidate = async () => {
        const { revision, body, operational } = await savedDraft();
        const snapshot = snapshotFor(revision, body, operational);
        const candidate = await tx(q => releaseStore.create(q, schema, { tenantId, agentId, actor: { id: adminId, role: 'tenant_admin' },
            requestKey: randomUUID(), snapshot, scenarios: structuredClone(sourceScenarios) }));
        for (const channel of CHANNELS) {
            const data = (await tx(q => releaseStore.read(q, agentId, (candidate as any).id)))!;
            const evaluation = data.evaluations.find((row: any) => row.channel_type === channel)!;
            const work: any = await tx(q => releaseStore.claim(q, schema, tenantId, agentId, (candidate as any).id, evaluation.id));
            if (!work) throw new Error(`agent_release claim returned null for ${channel}`);
            await tx(q => releaseStore.checkpoint(q, schema, { tenantId, agentId, candidateId: (candidate as any).id,
                evaluationId: work.evaluation.id, leaseToken: work.leaseToken, ...completed(work) }));
        }
        return { candidateId: (candidate as any).id, body, operational };
    };

    /** All the way to an approved candidate the publication may take. */
    const approvedCandidate = async () => {
        const prepared = await evaluatedCandidate();
        const view = await readCandidate(prepared.candidateId);
        expect(view.review.eligibleForReview).toBe(true);
        const decision = { expectedVersion: view.version, evidenceHash: view.review.evidenceHash, requestKey: randomUUID(),
            decision: 'approve' as const, checks: { objective: true, instructions: true, facts: true, tools: true, style: true, limits: true },
            sampleHashes: view.review.sampleHashes };
        const reviewed = await reviewCandidate(prepared.candidateId, decision);
        expect(reviewed.status).toBe('approved');
        const operational = await agentRow();
        return { ...prepared, evidenceHash: decision.evidenceHash, approvedVersion: reviewed.version, operational,
            publishBody: () => ({ expectedOperationalVersion: Number(operational.version),
                expectedOperationalHash: operationalConfigurationHash(operational), requestKey: randomUUID(),
                expectedCandidateVersion: reviewed.version, evidenceHash: decision.evidenceHash, activation: 'preserve' as const }) };
    };

    // ── the turn ────────────────────────────────────────────────────────────
    /**
     * One real turn, up to the model, with the configuration the runtime itself
     * resolved for a connection. The double records the assembled prompt; the
     * assembly is the shipped `PromptAssemblerService` over the shipped
     * `PersonaService.buildSystemPrompt`.
     */
    const turnPrompt = async (channelType: string, accountId: string) => {
        const resolution = await personaService.resolvePersonaForChannel(tenantId, channelType, accountId);
        const scope = resolution.agentId ? servedAgentAuthority(tenantId, schema, resolution) : undefined;
        const contactId = '22222222-2222-4222-8222-222222222222';
        const service: any = Object.create(ConversationsService.prototype);
        const captured: any[] = [];
        let metadata: any = {};
        const stubQuery = jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
            if (sql.startsWith('SELECT contact_id FROM conversations')) return [{ contact_id: contactId }];
            if (sql.startsWith('SELECT metadata FROM conversations')) return [{ metadata: structuredClone(metadata) }];
            if (sql.startsWith('UPDATE conversations SET metadata')) {
                const payload = params.find(value => typeof value === 'string' && value.startsWith('{'));
                if (payload) metadata = { ...metadata, ...JSON.parse(payload) };
                return [{ id: params[0] }];
            }
            return [];
        });
        Object.assign(service, {
            logger: { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
            prisma: { executeInTenantSchema: stubQuery,
                transactionInTenantSchema: (s: string, work: any) => work((sql: string, params?: any[]) => stubQuery(s, sql, params)),
                tenant: { findUnique: jest.fn(async () => ({ settings: {} })) } },
            redis: { getJson: jest.fn(async () => null), setJson: jest.fn(async () => undefined), del: jest.fn(async () => undefined),
                set: jest.fn(async () => undefined), incr: jest.fn(async () => 1), expire: jest.fn(), sadd: jest.fn(), rpush: jest.fn() },
            llmRouter: { analyzeComplexity: () => 0, analyzeSentiment: () => 0, stageToScore: () => 0,
                execute: jest.fn(async (request: any) => { captured.push(request); return { content: 'Listo.' }; }) },
            languageDetector: { detect: () => 'es' },
            tenantSchema: jest.fn(async () => schema),
            isWithinBusinessHours: jest.fn(() => true),
            loadBookingState: jest.fn(async () => ({ step: 'idle' })),
            procedureEngine: { getState: jest.fn(async () => null), process: jest.fn(async () => ({ handled: false })), missionCandidates: jest.fn(async () => []) },
            bookingEngine: { process: jest.fn(async () => ({ handled: false, state: { step: 'idle' } })) },
            activeOperationsContext: { populateTurnContext: jest.fn() },
            businessInfoService: { getPrimary: jest.fn(async () => null) },
            knowledgeService: { tenantHasKnowledge: jest.fn(async () => false), searchRelevant: jest.fn(async () => []),
                recordResponseAttribution: jest.fn(async () => ({ persistence: 'disabled' })) },
            rewriteSearchQuery: jest.fn(async (text: string) => text),
            turnCapabilityComposer: { resolve: jest.fn(async () => ({ tools: [], deniedTools: [], commitmentBlocked: null,
                authority: { source: 'turn_contract', allowedTools: [], deniedTools: [], commitmentBlocked: null, resolvedAt: new Date().toISOString() },
                status: { status: 'ok' },
                contract: { version: 1, publishedTools: [], resolvedAt: new Date().toISOString(), excluded: [], writersBlocked: false } })) },
            toolExecutionControl: { findPendingConfirmation: jest.fn(async () => null) },
            toolExecutor: { logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
            handoffService: { executeHandoff: jest.fn(), isInHandoff: jest.fn(async () => false) },
            promptAssembler, responseValidator: new ResponseValidatorService(),
            throttle: { getPlanFeatures: jest.fn(async () => ({ llmTier: 'tier_2' })) },
            analyticsService: { trackEvent: jest.fn(async () => undefined) },
            eventEmitter: { emit: jest.fn() },
            sendMedia: jest.fn(), sendPaymentLink: jest.fn(), sendFlow: jest.fn(),
        });
        service.bookingEngine.forExecution = () => service.bookingEngine;
        service.procedureEngine.forExecution = () => service.procedureEngine;
        const conversation = { id: '33333333-3333-4333-8333-333333333333', contact_id: contactId, updated_at: new Date(), metadata: {} };
        await service.generateResponse(tenantId, conversation,
            { channelType, channelAccountId: accountId, content: { type: 'text', text: 'Hola' }, metadata: {} },
            resolution.config, { id: contactId, name: 'Ana' }, {}, conversation.updated_at, {},
            randomUUID(), resolution.agentId ?? undefined, undefined, resolution.version ?? undefined, scope);
        expect(captured.length).toBeGreaterThan(0);
        return { resolution, scope, systemPrompt: String(captured[0].systemPrompt) };
    };

    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !parsed.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: url });
        await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await ensureSyntheticGlobalTables(statement => client.$executeRawUnsafe(statement));
        for (const [id, name] of [[tenantId, schema], [otherTenantId, otherSchema]] as const) {
            await client.$executeRawUnsafe(
                `INSERT INTO public.tenants(id,schema_name,is_active,industry,settings)
                 VALUES($1::uuid,$2,true,'education','{"verticalConfig":{"industry":"education","subType":"capacitacion"}}'::jsonb)`, id, name);
            await client.$executeRawUnsafe(`CREATE SCHEMA "${name}"`);
        }

        const tenants = new Map<string, any>(([[tenantId, schema], [otherTenantId, otherSchema]] as const).map(([id, name]) => [id,
            { id, schemaName: name, isActive: true, isInternal: false, subscriptionStatus: 'active', settings: {},
                subscription: { status: 'active', trialEndsAt: null, cancelAtPeriodEnd: false, currentPeriodEnd: null,
                    cancellationReason: null, dunningStartedAt: null } }]));

        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
        prisma.$executeRawUnsafe = client.$executeRawUnsafe.bind(client);
        findTenant = jest.fn(async ({ where }: any) => tenants.get(where.id) ?? null);
        prisma.tenant = { findUnique: (args: any) => prisma.tenant.impl(args), impl: findTenant,
            findMany: jest.fn(async () => [...tenants.values()]) };
        prisma.auditLog = { create: jest.fn(async ({ data }: any) => { audited.push(data); return data; }) };

        const redis: any = { del: jest.fn(async () => 1), get: jest.fn(async () => null), set: jest.fn(async () => undefined),
            getJson: jest.fn(async () => null), setJson: jest.fn(async () => undefined) };
        const tenantsService: any = { getSchemaName: jest.fn(async (id: string) => tenants.get(id)?.schemaName) };
        const throttle: any = { isFeatureEnabled: jest.fn(async () => true), getPlanFeatures: jest.fn(async () => ({ llmTier: 'tier_2' })) };
        const events = new EventEmitter2();
        events.on('agent.config.updated', payload => emitted.push(payload));

        personaService = new PersonaService(prisma, redis, tenantsService, throttle, events);
        promptAssembler = new PromptAssemblerService(personaService);
        const drafts = new AgentDraftService(prisma, personaService, throttle);
        draftController = new AgentDraftController(drafts);

        const revisions = new EvaluationRevisionService(prisma, null as any);
        jest.spyOn(revisions, 'capture').mockImplementation(async () => liveManifest);
        publicationController = new AgentPublicationController(
            new AgentPublicationService(prisma, personaService, drafts, revisions, events));

        // Only `review` and `read` are driven here; `request` and `process` need
        // a model. A collaborator this suite never reaches stays absent on
        // purpose, so a future call to one fails loudly instead of quietly.
        const tests: any = { assertSnapshotCurrent: jest.fn(async (snapshot: any, tenant: string, agent: string) => {
            resolveEvaluationSnapshot(snapshot, tenant, agent);
            if (snapshotStale) throw new Error('evaluation_revision_changed');
        }) };
        releaseController = new AgentReleaseController(
            new AgentReleaseService(prisma, tests, undefined as any, undefined as any, undefined as any));
        releaseStore = new AgentReleaseStore(prisma);

        // Every table below comes from the shipped DDL through the production
        // bootstrap. They are created here only because `beforeEach` truncates
        // them before the first route call would have created them.
        await releaseStore.ensure(schema);
        await new AgentConfigurationRevisionStore(prisma).ensure(schema);
        await prisma.ensureCanonicalTables(schema, AGENT_PUBLICATION_TABLES);
        for (const name of [schema, otherSchema]) {
            await client.$executeRawUnsafe(
                `CREATE TABLE IF NOT EXISTS "${name}".persona_config(id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                 version INTEGER DEFAULT 1, is_active BOOLEAN DEFAULT true, config_yaml TEXT, config_json JSONB NOT NULL,
                 created_at TIMESTAMP DEFAULT NOW())`);
        }
        await personaService.ensureMultiAgentTables(tenantId);
        await personaService.ensureMultiAgentTables(otherTenantId);
    }, 300_000);

    beforeEach(async () => {
        emitted.length = 0; audited.length = 0; snapshotStale = false;
        prisma.tenant.impl = findTenant;
        await query(`TRUNCATE agent_publication_heads,agent_publication_events,agent_release_candidates,
            agent_configuration_commands,agent_configuration_drafts,agent_configuration_revisions,agent_personas CASCADE`);
        await query(`INSERT INTO agent_personas(id,name,config_json,channels,channel_bindings,schedule_mode,is_active,is_default,version)
            VALUES($1::uuid,'Alex',$2::jsonb,ARRAY['whatsapp'],ARRAY['whatsapp:wa-main'],'24_7',true,false,7)`,
            [agentId, JSON.stringify(servingConfig())]);
        liveManifest = sealRevision(tenantId, [{ key: 'fixture.publication_walk', state: 'present', hash: revisionHash('synthetic') }], []);
        (personaService as any).initializedTenants = new Set([tenantId, otherTenantId]);
        (personaService as any).attributionReadyTenants = new Set([tenantId, otherTenantId]);
    }, 120_000);

    afterAll(async () => {
        if (!client) return;
        try {
            for (const name of [schema, otherSchema]) {
                if (!/^tenant_pubwalkb?_[a-f0-9]{32}$/.test(name)) throw new Error('invalid_cleanup_scope');
                await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
            }
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=ANY($1::uuid[])', [tenantId, otherTenantId]);
        } finally { await client.$disconnect(); }
    });

    it('1-2 · saves the edit as a draft and changes nothing a customer can reach', async () => {
        const before = await agentRow();
        const workspace = await readWorkspace();
        expect(workspace.operational.version).toBe(7);
        expect(workspace.draft).toBeNull();

        const { revision } = await savedDraft();
        expect(revision.currentBase).toBe(true);
        expect(revision.body.configJson.persona.greeting).toBe(PUBLISHED_GREETING);

        // The serving row is untouched, and so is what the runtime resolves for
        // the live connection.
        expect(await agentRow()).toEqual(before);
        const live = await personaService.resolvePersonaForChannel(tenantId, 'whatsapp', 'wa-main');
        expect(live.version).toBe(7);
        expect((live.config as any).persona.greeting).toBe(SERVING_GREETING);
        // And the connection the draft would add does not exist yet.
        expect((await personaService.resolvePersonaForChannel(tenantId, 'telegram', 'tg-main')).agentId).toBeNull();
    }, 300_000);

    it('3-4 · shows the reviewer the diff and the evidence before anything is published', async () => {
        const prepared = await evaluatedCandidate();
        const view = await readCandidate(prepared.candidateId);
        expect(view.status).toBe('evaluated');
        expect(view.revisionState).toBe('current');
        expect(view.evaluations.map((row: any) => row.channel).sort()).toEqual([...CHANNELS].sort());
        expect(view.review.eligibleForReview).toBe(true);
        // Reviewing is not activating; the release surface says so itself.
        expect(view.activationAllowed).toBe(false);
        expect(view.certified).toBe(false);

        // The diff a person is asked to approve, off the same workspace the panel
        // reads: what is serving, and what would replace it.
        const workspace = await readWorkspace();
        expect(workspace.operational.body.configJson.persona.greeting).toBe(SERVING_GREETING);
        expect(workspace.draft.body.configJson.persona.greeting).toBe(PUBLISHED_GREETING);
        expect(workspace.operational.body.channels).toEqual(['whatsapp']);
        expect(workspace.draft.body.channels).toEqual(CHANNELS);

        // And nothing has been published.
        expect((await history()).head).toBeNull();
    }, 300_000);

    it('5-6 · publishes with the request key, the hashes and the expected revision, and leaves a receipt', async () => {
        const prepared = await approvedCandidate();
        const body = prepared.publishBody();
        const receipt = await publish(prepared.candidateId, body);

        expect(receipt).toMatchObject({ agentId, kind: 'publish', operationalVersion: 8, idempotentReplay: false });
        const agent = await agentRow();
        expect(Number(agent.version)).toBe(8);
        expect(agent.config_json.persona.greeting).toBe(PUBLISHED_GREETING);
        expect([...agent.channel_bindings].sort()).toEqual(['telegram:tg-main', 'whatsapp:wa-main']);
        expect(receipt.operationalHash).toBe(operationalConfigurationHash(agent));

        // Durable, and readable through the route a rollback has to name.
        const after = await history();
        expect(after.operationalVersion).toBe(8);
        expect(after.head).toMatchObject({ id: receipt.id, kind: 'publish', operationalVersion: 8 });
        expect(after.events[0]).toMatchObject({ id: receipt.id, baseVersion: 7, operationalVersion: 8,
            beforeHash: body.expectedOperationalHash, evidenceHash: prepared.evidenceHash, requestedBy: adminId });

        // The editable pointer is consumed, so the same draft cannot publish twice.
        expect((await readWorkspace()).draft).toBeNull();
        // The settlement really happened: audit row, and the notification the
        // eval autorun listener waits on.
        expect(audited.some(row => row.action === 'agent.publication.publish' && row.userId === adminId)).toBe(true);
        expect(emitted).toHaveLength(1);
        expect(emitted[0]).toMatchObject({ tenantId, agentId, operationalVersion: 8, publicationId: receipt.id });
    }, 300_000);

    it('7 · the next turn on the published connection speaks with the published configuration', async () => {
        const prepared = await approvedCandidate();
        const receipt = await publish(prepared.candidateId, prepared.publishBody());

        // Resolution by connection, through the exact call the turn makes. This
        // binding resolved to nothing before the publication.
        const turn = await turnPrompt('telegram', 'tg-main');
        expect(turn.resolution.agentId).toBe(agentId);
        expect(turn.resolution.version).toBe(8);
        expect(turn.scope).toMatchObject({ kind: 'agent', tenantId, schemaName: schema, agentId, version: 8,
            operationalHash: receipt.operationalHash });

        // What the model was actually given.
        expect(turn.systemPrompt).toContain(PUBLISHED_GREETING);
        expect(turn.systemPrompt).toContain(PUBLISHED_ROLE);
        expect(turn.systemPrompt).toContain(PUBLISHED_RULE);
        expect(turn.systemPrompt).not.toContain(SERVING_GREETING);
        expect(turn.systemPrompt).not.toContain(SERVING_RULE);
    }, 300_000);

    it('8 · rollback restores the previous configuration, and the turn after it uses that one', async () => {
        const prepared = await approvedCandidate();
        const receipt = await publish(prepared.candidateId, prepared.publishBody());
        const restored = await rollback({ expectedPublicationId: receipt.id, expectedOperationalVersion: receipt.operationalVersion,
            expectedOperationalHash: receipt.operationalHash, requestKey: randomUUID() });

        // Forward, never backward: the previous body returns under a NEW version.
        expect(restored).toMatchObject({ kind: 'rollback', operationalVersion: 9, idempotentReplay: false });
        const agent = await agentRow();
        expect(agent.config_json.persona.greeting).toBe(SERVING_GREETING);
        expect(agent.channel_bindings).toEqual(['whatsapp:wa-main']);

        const turn = await turnPrompt('whatsapp', 'wa-main');
        expect(turn.resolution.version).toBe(9);
        expect(turn.systemPrompt).toContain(SERVING_GREETING);
        expect(turn.systemPrompt).toContain(SERVING_RULE);
        expect(turn.systemPrompt).not.toContain(PUBLISHED_GREETING);

        // The connection the publication had added leaves with it.
        expect((await personaService.resolvePersonaForChannel(tenantId, 'telegram', 'tg-main')).agentId).toBeNull();
        expect(audited.filter(row => row.action === 'agent.publication.rollback')).toHaveLength(1);
    }, 300_000);

    it('9 · a double click publishes once', async () => {
        const prepared = await approvedCandidate();
        const body = prepared.publishBody();

        const first = await publish(prepared.candidateId, body);
        const second = await publish(prepared.candidateId, body);
        expect(second).toMatchObject({ id: first.id, operationalVersion: 8, idempotentReplay: true });
        const racing = await Promise.all(Array.from({ length: 5 }, () => publish(prepared.candidateId, body)));
        expect(new Set(racing.map(row => row.id))).toEqual(new Set([first.id]));
        expect(await query('SELECT id FROM agent_publication_events')).toHaveLength(1);
        expect(Number((await agentRow()).version)).toBe(8);
        // A replay must not spend the tenant's evaluation budget again.
        expect(emitted).toHaveLength(1);
    }, 300_000);

    it('9 · refuses an obsolete base, an obsolete candidate and evidence that moved', async () => {
        const prepared = await approvedCandidate();
        const body = prepared.publishBody();
        const before = await agentRow();

        await expect(publish(prepared.candidateId, { ...body, requestKey: randomUUID(), expectedOperationalHash: 'a'.repeat(64) }))
            .rejects.toMatchObject({ response: { error: 'agent_operational_configuration_changed' } });
        await expect(publish(prepared.candidateId, { ...body, requestKey: randomUUID(), expectedCandidateVersion: prepared.approvedVersion + 1 }))
            .rejects.toMatchObject({ response: { error: 'agent_release_version_changed' } });
        await expect(publish(prepared.candidateId, { ...body, requestKey: randomUUID(), evidenceHash: 'b'.repeat(64) }))
            .rejects.toMatchObject({ response: { error: 'agent_release_evidence_changed' } });

        // The approval row is what makes an evidence hash an approval: without it
        // the very same hash publishes nothing.
        await query('DELETE FROM agent_release_reviews');
        await expect(publish(prepared.candidateId, { ...body, requestKey: randomUUID() }))
            .rejects.toMatchObject({ response: { error: 'agent_release_evidence_changed' } });

        expect(await agentRow()).toEqual(before);
        expect(await query('SELECT id FROM agent_publication_events')).toHaveLength(0);
        expect((await readWorkspace()).draft).not.toBeNull();
        expect(emitted).toHaveLength(0);
    }, 300_000);

    it('re-reads the evaluation gate at the instant of the effect, not when it was approved', async () => {
        const prepared = await approvedCandidate();
        const before = await agentRow();
        // The world moved between the approval and the click.
        liveManifest = sealRevision(tenantId, [{ key: 'fixture.publication_walk', state: 'present', hash: revisionHash('moved') }], []);
        await expect(publish(prepared.candidateId, prepared.publishBody())).rejects.toThrow(/evaluation_dependencies_changed/);
        expect(await agentRow()).toEqual(before);
        expect(await query('SELECT id FROM agent_publication_events')).toHaveLength(0);
        // A refusal does not take the edit with it.
        expect((await readWorkspace()).draft).not.toBeNull();
    }, 300_000);

    it('refuses to publish while the tenant subscription cannot be read', async () => {
        const prepared = await approvedCandidate();
        const before = await agentRow();
        prisma.tenant.impl = jest.fn(async (args: any) => {
            const row = await findTenant(args);
            return row && args.where.id === tenantId ? { ...row, subscriptionStatus: null, subscription: null } : row;
        });
        await expect(publish(prepared.candidateId, prepared.publishBody()))
            .rejects.toMatchObject({ response: { error: 'agent_publication_subscription_restricted' } });
        expect(await agentRow()).toEqual(before);
        expect(await query('SELECT id FROM agent_publication_events')).toHaveLength(0);
    }, 300_000);

    it('refuses the review when the snapshot behind the evidence is no longer current', async () => {
        const prepared = await evaluatedCandidate();
        const view = await readCandidate(prepared.candidateId);
        snapshotStale = true;
        await expect(reviewCandidate(prepared.candidateId, { expectedVersion: view.version, evidenceHash: view.review.evidenceHash,
            requestKey: randomUUID(), decision: 'approve', sampleHashes: view.review.sampleHashes,
            checks: { objective: true, instructions: true, facts: true, tools: true, style: true, limits: true } }))
            .rejects.toThrow('evaluation_revision_changed');
        expect(await query('SELECT id FROM agent_release_reviews')).toHaveLength(0);
    }, 300_000);

    describe('who may do it', () => {
        it('turns a tenant_agent away at the door, on every publication route', async () => {
            const prepared = await approvedCandidate();
            const body = prepared.publishBody();
            expect(() => admit(publicationController, 'publish',
                { user: operator, params: { tenantId, agentId, candidateId: prepared.candidateId }, body })).toThrow();
            expect(() => admit(publicationController, 'rollback', { user: operator, params: { tenantId, agentId }, body: {} })).toThrow();
            expect(() => admit(releaseController, 'review',
                { user: operator, params: { tenantId, agentId, candidateId: prepared.candidateId }, body: {} })).toThrow();
            expect(() => admit(draftController, 'save', { user: operator, params: { tenantId, agentId }, body: {} })).toThrow();
            // Reading is not writing, and an operator has neither.
            expect(() => admit(publicationController, 'history', { user: operator, params: { tenantId, agentId } })).toThrow();
            expect(await query('SELECT id FROM agent_publication_events')).toHaveLength(0);
        }, 300_000);

        it('lets a supervisor watch, and refuses to let one publish', async () => {
            const prepared = await approvedCandidate();
            const view = await readCandidate(prepared.candidateId, supervisor);
            expect(view.status).toBe('approved');
            expect((await history(supervisor)).head).toBeNull();
            expect(() => admit(publicationController, 'publish',
                { user: supervisor, params: { tenantId, agentId, candidateId: prepared.candidateId }, body: prepared.publishBody() })).toThrow();
            // And the service refuses on its own, so a route added tomorrow
            // without the decorator is still not a publication endpoint.
            await expect((publicationController as any).publications.publish(tenantId, agentId, prepared.candidateId,
                prepared.publishBody(), { id: supervisorId, role: 'tenant_supervisor' }))
                .rejects.toMatchObject({ response: { error: 'agent_publication_admin_required' } });
            expect(await query('SELECT id FROM agent_publication_events')).toHaveLength(0);
        }, 300_000);

        it('never lets an administrator of another tenant see or move this candidate', async () => {
            const prepared = await approvedCandidate();
            const before = await agentRow();

            // The door: their own token cannot name somebody else's tenant.
            expect(() => admit(publicationController, 'publish',
                { user: otherAdmin, params: { tenantId, agentId, candidateId: prepared.candidateId }, body: prepared.publishBody() })).toThrow();
            expect(() => admit(releaseController, 'read',
                { user: otherAdmin, params: { tenantId, agentId, candidateId: prepared.candidateId } })).toThrow();

            // And behind the door: naming their OWN tenant resolves to their own
            // schema, where this agent does not exist. Isolation does not rest on
            // the guard alone.
            await expect(publish(prepared.candidateId, prepared.publishBody(), otherAdmin, otherTenantId))
                .rejects.toMatchObject({ response: { error: 'agent_not_found' } });
            await expect(history(otherAdmin, otherTenantId))
                .rejects.toMatchObject({ response: { error: 'agent_not_found' } });
            await expect(readCandidate(prepared.candidateId, otherAdmin, otherTenantId))
                .rejects.toMatchObject({ response: { error: 'agent_release_not_found' } });

            expect(await agentRow()).toEqual(before);
            expect(await query('SELECT id FROM agent_publication_events')).toHaveLength(0);
        }, 300_000);
    });
});
