import { IsolatedEvalNamespace, type EvalNamespaceLease } from '../simulation/isolated-eval-namespace';
import { HttpException, HttpStatus, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CONVERSATIONAL_CHANNELS, type NormalizedMessage, type TestAgentRequest, type TestAgentResponse } from '@parallext/shared';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { PersonaService } from '../persona/persona.service';
import { operationalConfigurationBody, operationalConfigurationHash } from '../persona/agent-configuration-revision';
import { TenantsService } from '../tenants/tenants.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { LearningService } from '../learning/learning.service';
import { ConversationsService } from './conversations.service';
import { AgentEvaluationSnapshot, evaluationSnapshot, sealEvaluationSnapshot } from './agent-evaluation-snapshot';
import { resolveEvaluationSnapshot } from './agent-evaluation-snapshot';
import { EvaluationRevisionService } from '../evaluation-revision/evaluation-revision.service';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { McpClientService } from '../mcp/mcp-client.service';
import { VerticalIntegrationsService } from '../vertical-integrations/vertical-integrations.service';
import { AgentTurnSessionStore } from './agent-turn-session';
import { buildToolParityReport } from './agent-test-parity';
import { EVAL_SANDBOX_CONTACT_ID, resolveAgentTestContactId } from './agent-test-tool-policy';

export interface AgentTestExecutionOptions {
    disableTools?: boolean;
    evalMode?: boolean;
    sandboxContactId?: string;
    sandboxConversationId?: string;
    sandboxNamespace?: EvalNamespaceLease;
    /** ID returned by the isolated inbound recorder; never accepted in the public DTO. */
    sandboxInboundMessageId?: string;
    agentSnapshot?: AgentEvaluationSnapshot;
    learningReleaseId?: string | null;
    beforeToolExecution?: () => Promise<void>;
    beforeModelExecution?: () => Promise<void>;
}

/** Adapter to the operational turn core. It owns no prompt, engine or tool loop. */
@Injectable()
export class AgentTestService {
    private readonly sessions = new AgentTurnSessionStore();
    constructor(
        private readonly personaService: PersonaService,
        private readonly tenantsService: TenantsService,
        private readonly throttle: TenantThrottleService,
        private readonly runtime: ConversationsService,
        @Optional() private readonly learning?: LearningService,
        @Optional() private readonly namespaces?: IsolatedEvalNamespace,
        @Optional() private readonly revisions?: EvaluationRevisionService,
        @Optional() private readonly mcp?: McpClientService,
        @Optional() private readonly integrations?: VerticalIntegrationsService,
    ) {}

    async captureSnapshot(tenantId: string, agentId: string, options?:{configurationRevisionId:string}): Promise<AgentEvaluationSnapshot> {
        if (!this.revisions || !this.mcp || !this.integrations) throw new Error('evaluation_revision_service_unavailable');
        const manifest = await this.revisions.capture(tenantId);
        let agent = await this.personaService.getAgent(tenantId, agentId, AGENT_TEST_EXECUTION_CONTEXT);
        if (!agent) throw new NotFoundException('Agent not found');
        const revision=options
            ?await this.personaService.readConfigurationRevision(tenantId,agentId,options.configurationRevisionId,AGENT_TEST_EXECUTION_CONTEXT):null;
        const operationalBody=revision?structuredClone(operationalConfigurationBody(agent)):undefined;
        if(revision&&operationalConfigurationHash({...agent,id:agentId})!==revision.base_operational_hash)
            throw new Error('agent_operational_configuration_changed');
        if(revision){
            const body=revision.body;
            agent={...agent,name:body.name,config_json:body.configJson,channels:body.channels,channel_bindings:body.channelBindings,
                schedule_mode:body.scheduleMode,is_active:body.isActive,is_default:body.isDefault};
        }
        const snapshot = evaluationSnapshot(tenantId, agentId, agent);
        if(revision){snapshot.configurationRevisionId=revision.id;snapshot.configurationRevisionHash=revision.body_hash;snapshot.configurationBody=structuredClone(revision.body);
            snapshot.configurationBaseOperationalHash=revision.base_operational_hash;snapshot.configurationBaseOperationalBody=operationalBody;}
        snapshot.releaseScope = await this.revisions.captureAgentReleaseScope(tenantId, agent);
        const release = await this.learning?.getPublishedReleaseSnapshot(tenantId, agentId, resolveAgentTestContactId());
        snapshot.learningReleaseId = release?.releaseId || null;
        snapshot.learningReleaseHash = release?.releaseHash || null;
        snapshot.manifest = manifest;
        const mcp = await this.mcp.listPublishableTools(tenantId, AGENT_TEST_EXECUTION_CONTEXT, {strict:true});
        snapshot.mcpTools = mcp.tools;
        snapshot.mcpToolsHash = revisionHash(snapshot.mcpTools);
        snapshot.procedures = await this.revisions.captureProcedures(tenantId);
        snapshot.proceduresHash = revisionHash(snapshot.procedures);
        const health = await this.integrations.getAllHealth(tenantId);
        // Keep only fields consumed by the composer; provider errors/config payloads may contain private details.
        const providerHealth = Object.fromEntries(Object.entries(health).map(([name,value]:[string,any])=>[name,{
            configured:value?.configured,connected:value?.connected,status:value?.status,scopeStatus:value?.scopeStatus,
            circuitState:value?.circuitState,grantedScopes:value?.grantedScopes,lastSuccessfulSyncAt:value?.lastSuccessfulSyncAt,
        }]));
        snapshot.runtimeInputs = {providerHealth,
            planFeatures:await this.throttle.getPlanFeatures(tenantId, AGENT_TEST_EXECUTION_CONTEXT),
            llmSpendUsdCents:await this.throttle.getLlmSpendUsdCents(tenantId),
            mcpDiscoveredCount:mcp.discoveredCount, mcpApprovedCount:mcp.approvedCount};
        snapshot.runtimeInputsHash = revisionHash(snapshot.runtimeInputs);
        snapshot.contextInputs = await this.runtime.captureEvaluationContext(tenantId, snapshot.config);
        snapshot.structuredKnowledgeInputs = await this.revisions.captureStructuredKnowledge(tenantId);
        sealEvaluationSnapshot(snapshot);
        await this.assertSnapshotCurrent(snapshot);
        return snapshot;
    }

    async assertSnapshotCurrent(snapshot?: AgentEvaluationSnapshot, tenantId = snapshot?.tenantId, agentId = snapshot?.agentId): Promise<void> {
        if (!snapshot || !this.revisions) throw new Error('evaluation_revision_manifest_required');
        resolveEvaluationSnapshot(snapshot,tenantId!,agentId!);
        await this.revisions.assertCurrent(snapshot.manifest);
    }

    async test(tenantId: string, agentId: string, req: TestAgentRequest, options?: AgentTestExecutionOptions): Promise<TestAgentResponse> {
        const startedAt = Date.now();
        if (!await this.throttle.hasAiMessageQuota(tenantId)) throw new HttpException('ai_message_quota_exceeded', HttpStatus.TOO_MANY_REQUESTS);
        const channelType = req.channelType && CONVERSATIONAL_CHANNELS.includes(req.channelType) ? req.channelType : 'web_widget';
        const snapshot = structuredClone(options?.agentSnapshot || (req.runtimeSessionId
            ? this.sessions.getSnapshot(req.runtimeSessionId, tenantId, agentId)
            : await this.captureSnapshot(tenantId, agentId,req.configurationRevisionId!==undefined
                ?{configurationRevisionId:req.configurationRevisionId}:undefined)));
        if(req.configurationRevisionId!==undefined&&snapshot.configurationRevisionId!==req.configurationRevisionId)
            throw new Error('agent_test_session_configuration_revision_changed');
        resolveEvaluationSnapshot(snapshot,tenantId,agentId);
        await this.assertSnapshotCurrent(snapshot);
        if (options?.learningReleaseId !== undefined) {
            snapshot.learningReleaseId = options.learningReleaseId;
            snapshot.learningReleaseHash = null; // The immutable candidate validates its own hash at retrieval.
            sealEvaluationSnapshot(snapshot);
        }
        const contactId = resolveAgentTestContactId(options?.sandboxContactId);
        if (options?.evalMode && (contactId !== EVAL_SANDBOX_CONTACT_ID || !options.sandboxConversationId)) throw new Error('eval_sandbox_identity_required');
        const sourceSchema = await this.tenantsService.getSchemaName(tenantId, AGENT_TEST_EXECUTION_CONTEXT);
        if (snapshot.structuredKnowledgeInputs!.sourceSchema !== sourceSchema) throw new Error('evaluation_structured_knowledge_schema_mismatch');
        const namespace = options?.sandboxNamespace;
        if (namespace && !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(options?.sandboxInboundMessageId || '')) throw new Error('eval_sandbox_inbound_required');
        if (options?.sandboxInboundMessageId && !namespace) throw new Error('eval_namespace_scope_mismatch');
        if (namespace && (!options?.evalMode || namespace.tenantId !== tenantId || namespace.sourceSchema !== sourceSchema)) throw new Error('eval_namespace_scope_mismatch');
        if (namespace) {
            if (!this.namespaces) throw new Error('canonical_sandbox_not_available');
            await this.namespaces.assertOwned(namespace);
        }
        const schemaName = namespace?.schemaName || sourceSchema;
        const assertNamespace = async () => { if (namespace) await this.namespaces!.assertOwned(namespace); await this.assertSnapshotCurrent(snapshot); };
        const session = this.sessions.resolve({
            id: options?.sandboxConversationId || req.runtimeSessionId,
            tenantId, agentId, channelType, contactId, schemaName, snapshot,
            mode: options?.evalMode ? 'sandbox' : 'preview',
            conversationId: options?.sandboxConversationId || randomUUID(),
            executionContext: AGENT_TEST_EXECUTION_CONTEXT,
            sandboxNamespace: namespace,
            history: (req.conversationHistory || []).map(row => ({ ...row })),
            beforeToolExecution: async () => { await assertNamespace(); await options?.beforeToolExecution?.(); },
            beforeModelExecution: async () => { await assertNamespace(); await options?.beforeModelExecution?.(); },
            afterDependencyRead: assertNamespace,
            disableTools: options?.disableTools ?? req.options?.disableTools,
        });
        session.busy = true;
        try {
            const message = { id: options?.sandboxInboundMessageId || randomUUID(), channelAccountId: 'agent-test', conversationId: session.conversationId, direction: 'inbound', status: 'pending', tenantId, channelType, contactId, content: { type: 'text', text: req.message },
                timestamp: new Date(), metadata: { allowHumanHandoff: false } } as NormalizedMessage;
            const reply = await this.runtime.executeAgentTurn(message, session);
            await assertNamespace();
            const trace = session.trace;
            const toolParity = buildToolParityReport(trace.advertisedTools);
            toolParity.executableCount = trace.executableToolNames.length;
            for (const tool of toolParity.tools) {
                tool.executableInTest = trace.executableToolNames.includes(tool.name);
                if (tool.executableInTest) tool.reason = 'executable';
            }
            return { reply, debug: {
                runtimeSessionId: session.id, runtimeError: trace.error,
                agentRevision: { version: snapshot.version, configHash: snapshot.configHash, capturedAt: snapshot.capturedAt,
                    configurationRevisionId:snapshot.configurationRevisionId,
                    dependencyRevision: snapshot.manifest!.revision, strategy: snapshot.manifest!.strategy,
                    limitations: [...snapshot.manifest!.limitations] },
                systemPrompt: trace.systemPrompt, toolCalls: trace.toolCalls,
                ragHits: trace.turnContext?.retrievedKnowledge || [],
                tokens: { input: trace.inputTokens, output: trace.outputTokens },
                cost: trace.cost, model: trace.model, latencyMs: Date.now() - startedAt,
                turnContext: trace.turnContext || { language: snapshot.config.language || 'es', timezone: snapshot.config.hours?.timezone || 'America/Bogota', now: new Date().toISOString(), upcomingDays: [], businessHoursStatus: 'unknown' },
                toolParity, regional: trace.turnContext?.regional || null, effectiveCapability: trace.capability || null,
            } };
        } finally {
            session.busy = false;
            // Same provider accounting as live, with no customer analytics or deliveries.
            for (let call = 0; call < session.trace.providerCalls; call++) await this.throttle.incrementAiMessageCount(tenantId);
        }
    }
}
