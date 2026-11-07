import {
    TOOL_USAGE_MAX_KEYS,
    TOOL_USAGE_RETENTION_SQL,
    TOOL_USAGE_UPSERT_SQL,
    ToolUsageRecorder,
    type ToolUsageSample,
} from './tool-usage-recorder.service';

const TENANT = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';

function sample(overrides: Partial<ToolUsageSample> = {}): ToolUsageSample {
    return {
        tenantId: TENANT,
        toolName: 'search_products',
        mode: 'live',
        channel: 'whatsapp',
        outcome: 'ok',
        errorCode: null,
        durationMs: 50,
        at: new Date('2026-11-06T12:00:00.000Z'),
        ...overrides,
    };
}

function harness(execute: jest.Mock = jest.fn().mockResolvedValue(1)) {
    const prisma = { $executeRawUnsafe: execute } as any;
    const recorder = new ToolUsageRecorder(prisma);
    return { recorder, execute };
}

describe('ToolUsageRecorder', () => {
    afterEach(() => jest.useRealTimers());

    it('aggregates identical keys in memory and writes one additive upsert with column arrays', async () => {
        const { recorder, execute } = harness();
        recorder.record(sample({ durationMs: 50 }));
        recorder.record(sample({ durationMs: 250 }));
        recorder.record(sample({ durationMs: 12_000, at: new Date('2026-11-06T13:00:00.000Z') }));
        recorder.record(sample({ outcome: 'error', errorCode: 'no_contact', durationMs: 800 }));
        recorder.record(sample({ tenantId: OTHER, channel: '' }));
        expect(recorder.pendingKeys).toBe(3);

        await recorder.flush();

        expect(recorder.pendingKeys).toBe(0);
        const upserts = execute.mock.calls.filter(call => call[0] === TOOL_USAGE_UPSERT_SQL);
        expect(upserts).toHaveLength(1);
        const params = upserts[0].slice(1) as string[][];
        expect(params).toHaveLength(17);
        const okIndex = params[5].findIndex((outcome, index) => outcome === 'ok' && params[1][index] === TENANT);
        expect(params[0][okIndex]).toBe('2026-11-06');
        expect(params[2][okIndex]).toBe('search_products');
        expect(params[3][okIndex]).toBe('live');
        expect(params[4][okIndex]).toBe('whatsapp');
        expect(params[6][okIndex]).toBe('3');
        expect(params[7][okIndex]).toBe(String(50 + 250 + 12_000));
        expect(params[8][okIndex]).toBe('12000');
        // Cubos: <100, <300, <1000, <3000, <10000, >=10000.
        expect(params.slice(9, 15).map(column => column[okIndex])).toEqual(['1', '1', '0', '0', '0', '1']);
        expect(params[15][okIndex]).toBe('2026-11-06T13:00:00.000Z');
        expect(params[16][okIndex]).toBeNull();

        const errorIndex = params[5].indexOf('error');
        expect(params[16][errorIndex]).toBe('no_contact');
        const otherIndex = params[1].indexOf(OTHER);
        expect(params[4][otherIndex]).toBe('unknown');
    });

    it('uses an additive, replica-safe conflict clause', () => {
        expect(TOOL_USAGE_UPSERT_SQL).toContain('ON CONFLICT (day, tenant_id, tool_name, mode, channel, outcome) DO UPDATE');
        expect(TOOL_USAGE_UPSERT_SQL).toContain('calls = t.calls + EXCLUDED.calls');
        expect(TOOL_USAGE_UPSERT_SQL).toContain('max_ms = GREATEST(t.max_ms, EXCLUDED.max_ms)');
        expect(TOOL_USAGE_UPSERT_SQL).toContain('last_at = GREATEST(t.last_at, EXCLUDED.last_at)');
        expect(TOOL_USAGE_UPSERT_SQL).toContain('last_error_code = COALESCE(EXCLUDED.last_error_code, t.last_error_code)');
    });

    it('applies retention at most once per day', async () => {
        const { recorder, execute } = harness();
        recorder.record(sample());
        await recorder.flush();
        recorder.record(sample());
        await recorder.flush();
        expect(execute.mock.calls.filter(call => call[0] === TOOL_USAGE_RETENTION_SQL)).toHaveLength(1);
        expect(TOOL_USAGE_RETENTION_SQL).toContain('CURRENT_DATE - 400');
    });

    it('never throws from record, even with garbage input or a broken clock', () => {
        const { recorder } = harness();
        expect(() => recorder.record(null as any)).not.toThrow();
        expect(() => recorder.record(sample({ tenantId: 'not-a-uuid' }))).not.toThrow();
        expect(() => recorder.record(sample({ toolName: '' }))).not.toThrow();
        expect(() => recorder.record(sample({ at: new Date('nope'), durationMs: NaN }))).not.toThrow();
        expect(() => recorder.record({ get tenantId(): string { throw new Error('boom'); } } as any)).not.toThrow();
        expect(recorder.pendingKeys).toBe(1);
    });

    it('is a no-op without Prisma (hand-built executors in specs)', async () => {
        const recorder = new ToolUsageRecorder();
        recorder.record(sample());
        expect(recorder.pendingKeys).toBe(0);
        await expect(recorder.flush()).resolves.toBeUndefined();
    });

    it('never rejects when the database fails and keeps the counts for the next attempt', async () => {
        const execute = jest.fn().mockRejectedValueOnce(new Error('relation does not exist')).mockResolvedValue(1);
        const { recorder } = harness(execute);
        recorder.record(sample());
        await expect(recorder.flush()).resolves.toBeUndefined();
        expect(recorder.pendingKeys).toBe(1);
        recorder.record(sample());
        await recorder.flush();
        const upserts = execute.mock.calls.filter(call => call[0] === TOOL_USAGE_UPSERT_SQL);
        expect(upserts).toHaveLength(2);
        expect(upserts[1][7][0]).toBe('2');
    });

    it('flushes early when the key cap is reached', async () => {
        const { recorder, execute } = harness();
        for (let i = 0; i < TOOL_USAGE_MAX_KEYS; i++) recorder.record(sample({ toolName: `tool_${i}` }));
        await Promise.resolve();
        await new Promise(resolve => setImmediate(resolve));
        expect(execute.mock.calls.some(call => call[0] === TOOL_USAGE_UPSERT_SQL)).toBe(true);
        expect(recorder.pendingKeys).toBe(0);
        // 5 lotes de 1000: un upsert por lote.
        expect(execute.mock.calls.filter(call => call[0] === TOOL_USAGE_UPSERT_SQL)).toHaveLength(5);
    });

    it('flushes on a timer and on module destroy, then stops recording', async () => {
        jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
        const { recorder, execute } = harness();
        recorder.record(sample());
        jest.advanceTimersByTime(60_000);
        await new Promise(resolve => setImmediate(resolve));
        expect(execute.mock.calls.filter(call => call[0] === TOOL_USAGE_UPSERT_SQL)).toHaveLength(1);

        recorder.record(sample({ toolName: 'get_policy' }));
        await recorder.onModuleDestroy();
        expect(execute.mock.calls.filter(call => call[0] === TOOL_USAGE_UPSERT_SQL)).toHaveLength(2);
        recorder.record(sample());
        expect(recorder.pendingKeys).toBe(0);
    });
});
