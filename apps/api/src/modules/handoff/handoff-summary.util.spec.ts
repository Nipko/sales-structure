import {
    buildDeterministicHandoffSummary,
    HANDOFF_SUMMARY_MAX_BYTES,
    parseLlmHandoffSummary,
    sanitizeHandoffText,
} from './handoff-summary.util';

describe('structured handoff summary', () => {
    const context = {
        tenantId: '11111111-1111-4111-8111-111111111111',
        conversationId: '22222222-2222-4222-8222-222222222222',
        reason: 'human_request',
        language: 'es',
        generatedAt: '2026-08-08T00:00:00.000Z',
        messages: [
            {
                id: '33333333-3333-4333-8333-333333333333',
                direction: 'outbound',
                content_text: 'Te ayudo con eso.',
                metadata: {},
            },
            {
                id: '44444444-4444-4444-8444-444444444444',
                direction: 'inbound',
                content_text: 'Escríbeme a private@example.com, mi teléfono es +57 300 123 4567 y password=hunter2. Quiero cancelar.',
                metadata: {},
            },
        ],
        turnTrace: {
            id: '55555555-5555-4555-8555-555555555555',
            steps: [
                {
                    type: 'kb_retrieval',
                    metadata: { sources: ['Política de cancelación api_key=supersecret'] },
                },
                {
                    type: 'tool_result',
                    label: 'cancel_order',
                    startedAt: '2026-08-08T00:00:01.000Z',
                    metadata: { ok: false, error: 'authorization=Bearer abcdefghijklmnopqrstuvwxyz123456' },
                },
            ],
        },
        conversationTrace: null,
    };

    it('builds deterministic evidence, citations and tool outcomes without unnecessary PII or secrets', () => {
        const first = buildDeterministicHandoffSummary(context);
        const second = buildDeterministicHandoffSummary(context);
        const serialized = JSON.stringify(first);

        expect(first.traceId).toBe('55555555-5555-4555-8555-555555555555');
        expect(second.traceId).toBe(first.traceId);
        expect(first.generatedBy).toBe('deterministic_fallback');
        expect(first.sources).toEqual(expect.arrayContaining([
            expect.objectContaining({ citation: '[message:44444444-4444-4444-8444-444444444444]' }),
            expect.objectContaining({ type: 'knowledge' }),
            expect.objectContaining({ citation: '[trace:55555555-5555-4555-8555-555555555555]' }),
        ]));
        expect(first.lastToolOutcomes).toEqual([
            expect.objectContaining({ tool: 'cancel_order', status: 'failed' }),
        ]);
        expect(serialized).not.toContain('private@example.com');
        expect(serialized).not.toContain('300 123 4567');
        expect(serialized).not.toContain('hunter2');
        expect(serialized).not.toContain('supersecret');
        expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(HANDOFF_SUMMARY_MAX_BYTES);
    });

    it('derives a stable hash trace when neither metadata nor persisted traces exist', () => {
        const withoutTrace = { ...context, turnTrace: null, conversationTrace: null };
        const first = buildDeterministicHandoffSummary(withoutTrace);
        const second = buildDeterministicHandoffSummary(withoutTrace);

        expect(first.traceId).toMatch(/^handoff_[a-f0-9]{32}$/);
        expect(second.traceId).toBe(first.traceId);
        expect(first.uncertainty).toContain('No persisted turn trace was available.');
    });

    it('accepts only bounded LLM fields while preserving authoritative evidence and identity', () => {
        const fallback = buildDeterministicHandoffSummary(context);
        const parsed = parseLlmHandoffSummary(JSON.stringify({
            customerIntent: 'Cancelar usando secret=do-not-store y user@example.com',
            knownFacts: Array.from({ length: 20 }, (_, index) => `Dato ${index}`),
            pendingActions: ['Validar cancelación'],
            confidence: 5,
            uncertainty: ['No confirmó fecha'],
            sources: [{ citation: '[invented]' }],
            traceId: 'invented-trace',
        }), fallback)!;

        expect(parsed.generatedBy).toBe('llm');
        expect(parsed.traceId).toBe(fallback.traceId);
        expect(parsed.sources).toEqual(fallback.sources);
        expect(parsed.confidence).toBe(1);
        expect(parsed.knownFacts).toHaveLength(6);
        expect(JSON.stringify(parsed)).not.toContain('do-not-store');
        expect(JSON.stringify(parsed)).not.toContain('user@example.com');
    });

    it('rejects malformed LLM output and redacts direct sanitizer inputs', () => {
        const fallback = buildDeterministicHandoffSummary(context);
        expect(parseLlmHandoffSummary('not-json', fallback)).toBeNull();
        expect(sanitizeHandoffText('Bearer abc.def.ghi private@example.com'))
            .toContain('[redacted-secret]');
    });
});
