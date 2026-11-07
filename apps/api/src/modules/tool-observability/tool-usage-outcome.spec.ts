import {
    classifyToolException,
    classifyToolResult,
    latencyBucketIndex,
    percentileFromBuckets,
    toolUsageModeOf,
} from './tool-usage-outcome';
import { AGENT_TEST_EXECUTION_CONTEXT, DRAFT_EXECUTION_CONTEXT } from '../../common/types/execution-context';

describe('tool usage outcome classification', () => {
    it('treats results without error (including empty reads and primitives) as ok', () => {
        expect(classifyToolResult({ items: [], status: 'empty' })).toEqual({ outcome: 'ok', errorCode: null });
        expect(classifyToolResult(undefined)).toEqual({ outcome: 'ok', errorCode: null });
        expect(classifyToolResult('texto')).toEqual({ outcome: 'ok', errorCode: null });
    });

    it('marks confirmation and human approval as pending, not as failures', () => {
        expect(classifyToolResult({ error: 'confirmation_required' })).toEqual({ outcome: 'pending', errorCode: 'confirmation_required' });
        expect(classifyToolResult({ error: 'approval_required', controlBlocked: true }).outcome).toBe('pending');
        expect(classifyToolResult({ requiresConfirmation: true }).outcome).toBe('pending');
    });

    it('marks gate refusals as blocked', () => {
        expect(classifyToolResult({ error: 'agent_test_read_only' })).toEqual({ outcome: 'blocked', errorCode: 'agent_test_read_only' });
        expect(classifyToolResult({ error: 'tool_disabled_by_owner' }).outcome).toBe('blocked');
        expect(classifyToolResult({ error: 'draft_action_requires_approval', controlBlocked: true }).outcome).toBe('blocked');
        expect(classifyToolResult({ error: 'execution_lease_expired', controlBlocked: true }).outcome).toBe('blocked');
    });

    it('marks any other error as error and truncates the code to 80 chars', () => {
        expect(classifyToolResult({ error: 'no_contact' })).toEqual({ outcome: 'error', errorCode: 'no_contact' });
        expect(classifyToolResult({ error: 'x'.repeat(200) }).errorCode).toHaveLength(80);
        expect(classifyToolResult({ error: 42 })).toEqual({ outcome: 'error', errorCode: '42' });
        expect(classifyToolException()).toEqual({ outcome: 'error', errorCode: 'exception' });
    });
});

describe('tool usage mode', () => {
    it('derives the mode only from server options', () => {
        expect(toolUsageModeOf(undefined)).toBe('live');
        expect(toolUsageModeOf({})).toBe('live');
        expect(toolUsageModeOf({ evalMode: true })).toBe('eval');
        expect(toolUsageModeOf({ executionContext: { mode: 'evaluation', persistence: 'disabled' } })).toBe('eval');
        expect(toolUsageModeOf({ executionContext: DRAFT_EXECUTION_CONTEXT })).toBe('draft');
        expect(toolUsageModeOf({ executionContext: AGENT_TEST_EXECUTION_CONTEXT })).toBe('agent_test');
        expect(toolUsageModeOf({ readOnly: true })).toBe('agent_test');
        // La búsqueda automática de FAQs apaga la persistencia, pero es tráfico real.
        expect(toolUsageModeOf({ executionContext: { mode: 'live', persistence: 'disabled' } })).toBe('live');
    });
});

describe('latency buckets and percentiles', () => {
    it('assigns latencies to the right bucket', () => {
        expect([0, 99, 100, 299, 300, 999, 1000, 2999, 3000, 9999, 10000, 60000, -5, NaN].map(latencyBucketIndex))
            .toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 0, 0]);
    });

    it('estimates percentiles by interpolating within the bucket', () => {
        // 100 llamadas, todas en <100 ms: p50 ≈ 50.
        expect(percentileFromBuckets([100, 0, 0, 0, 0, 0], 0.5)).toBe(50);
        // 90 rápidas y 10 entre 1 y 3 s: p95 cae en el cubo 1000-3000 a mitad de camino.
        expect(percentileFromBuckets([90, 0, 0, 10, 0, 0], 0.95)).toBe(2000);
        expect(percentileFromBuckets([90, 0, 0, 10, 0, 0], 0.5)).toBe(56);
    });

    it('caps the open-ended last bucket and every estimate with the observed maximum', () => {
        expect(percentileFromBuckets([0, 0, 0, 0, 0, 4], 0.5, 14000)).toBe(12000);
        expect(percentileFromBuckets([10, 0, 0, 0, 0, 0], 1, 40)).toBe(40);
    });

    it('returns null without data', () => {
        expect(percentileFromBuckets([0, 0, 0, 0, 0, 0], 0.95)).toBeNull();
        expect(percentileFromBuckets([], 0.5)).toBeNull();
    });
});
