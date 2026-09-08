import { CANONICAL_EVAL_TOOLS } from '../simulation/isolated-eval-namespace';
export { CANONICAL_EVAL_TOOLS } from '../simulation/isolated-eval-namespace';
import type { AIToolExecutorService } from './ai-tool-executor.service';
import type { LLMRouterService } from '../ai/router/llm-router.service';
import type { AgentTurnSession } from './agent-turn-session';
import { resolveStructuredKnowledgeCapture } from '../evaluation-revision/evaluation-structured-knowledge';
import { agentTestBlockedToolResult, isAgentTestSafeToolName } from './agent-test-tool-policy';

export function sessionCanExecute(session: AgentTurnSession, name: string): boolean {
    if (session.disableTools) return false;
    return isAgentTestSafeToolName(name) || (session.mode === 'sandbox' && !!session.sandboxNamespace && CANONICAL_EVAL_TOOLS.has(name));
}

export function sessionToolExecutor(executor: AIToolExecutorService, session: AgentTurnSession): AIToolExecutorService {
    return {
        execute: async (...input: Parameters<AIToolExecutorService['execute']>) => {
            const [schemaName, tenantId, contactId, name, args, conversationId, options] = input;
            const started = Date.now();
            let result: any;
            try {
            await session.beforeToolExecution?.();
            if (schemaName !== session.schemaName || tenantId !== session.tenantId || contactId !== session.contactId
                || (conversationId && conversationId !== session.conversationId)) throw new Error('runtime_tool_scope_mismatch');
            const structuredKnowledgeInputs = ['search_faqs', 'get_policy'].includes(name)
                ? resolveStructuredKnowledgeCapture(session.snapshot?.structuredKnowledgeInputs, tenantId) : undefined;
            if (!sessionCanExecute(session, name)) result = session.mode === 'sandbox' && CANONICAL_EVAL_TOOLS.has(name) ? { error: 'canonical_sandbox_not_available', persisted: false, controlBlocked: true } : agentTestBlockedToolResult(name);
            else result = await executor.execute(schemaName, tenantId, contactId, name, args, conversationId, {
                ...options,
                authority: options.authority,
                executionContext: session.executionContext,
                readOnly: !session.sandboxNamespace || isAgentTestSafeToolName(name),
                evalMode: !!session.sandboxNamespace,
                sandboxNamespace: session.sandboxNamespace,
                executionState: session.state,
                structuredKnowledgeInputs,
                channelType: session.channelType,
            });
            await session.afterDependencyRead?.();
            } catch (error: any) {
                session.trace.error = String(error?.message || error);
                session.trace.toolCalls.push({ name, args: (args || {}) as Record<string, unknown>,
                    result: { error: 'tool_failed', persisted: false }, durationMs: Date.now() - started });
                throw error;
            }
            session.trace.toolCalls.push({ name, args: (args || {}) as Record<string, unknown>, result, durationMs: Date.now() - started });
            return result;
        },
    } as AIToolExecutorService;
}

/** Explicit I/O adapter; routing, fallback and pricing remain the real router. */
export function sessionLlmRouter(router: LLMRouterService, session: AgentTurnSession): LLMRouterService {
    return {
        analyzeComplexity: (text: string) => router.analyzeComplexity(text),
        analyzeSentiment: (text: string) => router.analyzeSentiment(text),
        stageToScore: (stage: string) => router.stageToScore(stage),
        execute: async (request: Parameters<LLMRouterService['execute']>[0]) => {
        try {
            await session.beforeModelExecution?.();
            session.trace.providerCalls++;
            const response = await router.execute({ ...request, executionContext: session.executionContext });
            session.trace.provider(response);
            await session.afterDependencyRead?.();
            return response;
        } catch (error: any) {
            session.trace.error = String(error?.message || error);
            throw error;
        }
        },
    } as LLMRouterService;
}
