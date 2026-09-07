import { HttpException, HttpStatus, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CONVERSATIONAL_CHANNELS, type NormalizedMessage, type TestAgentRequest, type TestAgentResponse } from '@parallext/shared';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { PersonaService } from '../persona/persona.service';
import { TenantsService } from '../tenants/tenants.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { LearningService } from '../learning/learning.service';
import { ConversationsService } from './conversations.service';
import { AgentEvaluationSnapshot, evaluationSnapshot } from './agent-evaluation-snapshot';
import { AgentTurnSessionStore } from './agent-turn-session';
import { buildToolParityReport } from './agent-test-parity';
import { EVAL_SANDBOX_CONTACT_ID, resolveAgentTestContactId } from './agent-test-tool-policy';

export interface AgentTestExecutionOptions {
    disableTools?: boolean;
    evalMode?: boolean;
    sandboxContactId?: string;
    sandboxConversationId?: string;
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
    ) {}

    async captureSnapshot(tenantId: string, agentId: string): Promise<AgentEvaluationSnapshot> {
        const agent = await this.personaService.getAgent(tenantId, agentId, AGENT_TEST_EXECUTION_CONTEXT);
        if (!agent) throw new NotFoundException('Agent not found');
        const snapshot = evaluationSnapshot(tenantId, agentId, agent);
        const release = await this.learning?.getPublishedReleaseSnapshot(tenantId, agentId, resolveAgentTestContactId());
        snapshot.learningReleaseId = release?.releaseId || null;
        snapshot.learningReleaseHash = release?.releaseHash || null;
        return snapshot;
    }

    async test(tenantId: string, agentId: string, req: TestAgentRequest, options?: AgentTestExecutionOptions): Promise<TestAgentResponse> {
        const startedAt = Date.now();
        if (!await this.throttle.hasAiMessageQuota(tenantId)) throw new HttpException('ai_message_quota_exceeded', HttpStatus.TOO_MANY_REQUESTS);
        const channelType = req.channelType && CONVERSATIONAL_CHANNELS.includes(req.channelType) ? req.channelType : 'web_widget';
        const snapshot = structuredClone(options?.agentSnapshot || (req.runtimeSessionId ? this.sessions.getSnapshot(req.runtimeSessionId, tenantId, agentId) : await this.captureSnapshot(tenantId, agentId)));
        if (options?.learningReleaseId !== undefined) {
            snapshot.learningReleaseId = options.learningReleaseId;
            snapshot.learningReleaseHash = null; // The immutable candidate validates its own hash at retrieval.
        }
        const contactId = resolveAgentTestContactId(options?.sandboxContactId);
        if (options?.evalMode && (contactId !== EVAL_SANDBOX_CONTACT_ID || !options.sandboxConversationId)) throw new Error('eval_sandbox_identity_required');
        const schemaName = await this.tenantsService.getSchemaName(tenantId, AGENT_TEST_EXECUTION_CONTEXT);
        const session = this.sessions.resolve({
            id: options?.sandboxConversationId || req.runtimeSessionId,
            tenantId, agentId, channelType, contactId, schemaName, snapshot,
            mode: options?.evalMode ? 'sandbox' : 'preview',
            conversationId: options?.sandboxConversationId || randomUUID(),
            executionContext: AGENT_TEST_EXECUTION_CONTEXT,
            history: (req.conversationHistory || []).map(row => ({ ...row })),
            beforeToolExecution: options?.beforeToolExecution,
            beforeModelExecution: options?.beforeModelExecution,
            disableTools: options?.disableTools ?? req.options?.disableTools,
        });
        session.busy = true;
        try {
            const message = { id: randomUUID(), channelAccountId: 'agent-test', conversationId: session.conversationId, direction: 'inbound', status: 'pending', tenantId, channelType, contactId, content: { type: 'text', text: req.message },
                timestamp: new Date(), metadata: { allowHumanHandoff: false } } as NormalizedMessage;
            const reply = await this.runtime.executeAgentTurn(message, session);
            const trace = session.trace;
            const toolParity = buildToolParityReport(trace.advertisedTools);
            toolParity.executableCount = trace.executableToolNames.length;
            for (const tool of toolParity.tools) {
                tool.executableInTest = trace.executableToolNames.includes(tool.name);
                if (tool.executableInTest) tool.reason = 'executable';
            }
            return { reply, debug: {
                runtimeSessionId: session.id, runtimeError: trace.error,
                agentRevision: { version: snapshot.version, configHash: snapshot.configHash, capturedAt: snapshot.capturedAt },
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
