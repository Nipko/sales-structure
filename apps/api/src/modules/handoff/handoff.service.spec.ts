import { HandoffService } from './handoff.service';

describe('HandoffService structured handoff', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const schemaName = 'tenant_acme_11111111111141118111111111111111';
    const contactId = '33333333-3333-4333-8333-333333333333';

    function makeHarness() {
        const prisma: any = {
            getTenantSchemaName: jest.fn().mockResolvedValue(schemaName),
            tenant: {
                findUnique: jest.fn().mockImplementation(async (args: any) => (
                    args?.select?.language ? { language: 'es-CO' } : { billingEmail: null }
                )),
            },
            user: { findFirst: jest.fn().mockResolvedValue(null) },
            executeInTenantSchema: jest.fn().mockImplementation(async (_schema: string, sql: string) => {
                if (sql.includes('FROM messages') && sql.includes('LIMIT 20')) {
                    return [{
                        id: '44444444-4444-4444-8444-444444444444',
                        direction: 'inbound',
                        content_text: 'Quiero cancelar mi pedido',
                        metadata: {},
                        created_at: '2026-08-08T00:00:00.000Z',
                    }];
                }
                if (sql.includes('FROM turn_traces')) {
                    return [{
                        id: '55555555-5555-4555-8555-555555555555',
                        steps: [{
                            type: 'tool_result',
                            label: 'lookup_order',
                            startedAt: '2026-08-08T00:00:00.000Z',
                            metadata: { ok: true },
                        }],
                    }];
                }
                if (sql.includes('FROM conversation_traces')) return [];
                if (sql.includes('LEFT JOIN contacts')) {
                    return [{
                        contact_id: contactId,
                        contact_name: 'Cliente',
                        contact_phone: '+573001234567',
                        last_message: 'Quiero cancelar mi pedido',
                    }];
                }
                return [];
            }),
        };
        const redis = {
            set: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(undefined),
            get: jest.fn(),
        };
        const events = { emit: jest.fn().mockReturnValue(true) };
        const email = { send: jest.fn().mockResolvedValue(undefined) };
        const templates = { renderAndSend: jest.fn() };
        const llm = {
            execute: jest.fn().mockResolvedValue({
                content: JSON.stringify({
                    customerIntent: 'Cancelar el pedido',
                    knownFacts: ['El cliente pidió una cancelación'],
                    pendingActions: ['Validar si aún se puede cancelar'],
                    confidence: 0.9,
                    uncertainty: ['No se conoce el número de pedido'],
                }),
            }),
        };
        const aiResolution = { ensureResolutionColumns: jest.fn().mockResolvedValue(undefined) };
        const service = new HandoffService(
            prisma,
            redis as any,
            events as any,
            email as any,
            templates as any,
            llm as any,
            aiResolution as any,
        );
        jest.spyOn(service as any, 'tryAutoAssign').mockResolvedValue(null);
        return { service, prisma, redis, events, llm, aiResolution };
    }

    it('persists and emits the structured summary while preserving the legacy string', async () => {
        const h = makeHarness();
        const result = await h.service.executeHandoff(
            tenantId,
            conversationId,
            {
                id: 'provider-message-1',
                tenantId,
                conversationId,
                channelType: 'whatsapp',
                channelAccountId: 'wa-1',
                contactId: 'external-contact-1',
                direction: 'inbound',
                content: { type: 'text', text: 'Quiero cancelar' },
                timestamp: new Date('2026-08-08T00:00:00.000Z'),
                status: 'delivered',
                metadata: { traceId: 'request-trace-1' },
            },
            'human_request',
        );

        const persistenceCall = h.prisma.executeInTenantSchema.mock.calls.find((call: any[]) =>
            String(call[1]).includes('handoff_summary = $3::jsonb'));
        expect(persistenceCall).toBeDefined();
        const metadataHandoff = JSON.parse(persistenceCall[2][1]);
        const structured = JSON.parse(persistenceCall[2][2]);
        expect(metadataHandoff.summary).toEqual(expect.any(String));
        expect(metadataHandoff.structuredSummary).toEqual(structured);
        expect(structured).toMatchObject({
            version: 1,
            reason: 'human_request',
            customerIntent: 'Cancelar el pedido',
            traceId: 'request-trace-1',
            generatedBy: 'llm',
        });
        expect(result.summary).toEqual(expect.any(String));
        expect(result.structuredSummary).toEqual(structured);

        expect(h.events.emit).toHaveBeenCalledWith('handoff.escalated', expect.objectContaining({
            tenantId,
            schemaName,
            conversationId,
            summary: result.summary,
            structuredSummary: structured,
            traceId: 'request-trace-1',
        }));
        const cached = JSON.parse(h.redis.set.mock.calls[0][1]);
        expect(cached.summary).toBe(result.summary);
        expect(cached.structuredSummary).toEqual(structured);
        expect(h.aiResolution.ensureResolutionColumns).toHaveBeenCalledWith(schemaName);
    });

    it('uses a deterministic fallback when the LLM and persisted trace are unavailable', async () => {
        const h = makeHarness();
        h.llm.execute.mockRejectedValue(new Error('provider unavailable'));
        const context = {
            tenantId,
            conversationId,
            reason: 'complaint',
            language: 'es',
            generatedAt: '2026-08-08T00:00:00.000Z',
            messages: [{
                id: '44444444-4444-4444-8444-444444444444',
                direction: 'inbound',
                content_text: 'Necesito ayuda',
                metadata: {},
            }],
            turnTrace: null,
            conversationTrace: null,
        };

        const first = await (h.service as any).generateStructuredSummary(context);
        const second = await (h.service as any).generateStructuredSummary(context);

        expect(first.generatedBy).toBe('deterministic_fallback');
        expect(first.traceId).toMatch(/^handoff_[a-f0-9]{32}$/);
        expect(second.traceId).toBe(first.traceId);
    });
});

describe('HandoffService canonical auto-assignment event', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const schemaName = 'tenant_acme_11111111111141118111111111111111';
    const agentId = '33333333-3333-4333-8333-333333333333';
    const contactId = '44444444-4444-4444-8444-444444444444';

    function makeHarness(transactionFails = false) {
        const order: string[] = [];
        const query = jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('RETURNING contact_id')) return [{ contact_id: contactId }];
            if (sql.includes('SELECT phone FROM contacts')) return [{ phone: '+573001234567' }];
            return [];
        });
        const prisma: any = {
            executeInTenantSchema: jest.fn().mockImplementation(async (_schema: string, sql: string) => {
                if (sql.includes('SELECT contact_id')) return [{ contact_id: contactId }];
                if (sql.includes('SELECT score')) return [{ score: 10 }];
                return [];
            }),
            $queryRawUnsafe: jest.fn()
                .mockResolvedValueOnce([{ settings: {} }])
                .mockResolvedValueOnce([{
                    id: agentId,
                    name: 'Agente Uno',
                    active_count: 0,
                    matching_skills_count: 1,
                }]),
            transactionInTenantSchema: jest.fn().mockImplementation(async (_schema: string, callback: any) => {
                if (transactionFails) throw new Error('assignment transaction failed');
                const value = await callback(query);
                order.push('commit');
                return value;
            }),
        };
        const events = {
            emit: jest.fn().mockImplementation(() => { order.push('event'); return true; }),
        };
        const service = new HandoffService(
            prisma,
            {} as any,
            events as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );
        return { service, prisma, events, query, order };
    }

    it('emits conversation.assigned only after the assignment transaction commits', async () => {
        const h = makeHarness();

        await expect((h.service as any).tryAutoAssign(
            tenantId,
            schemaName,
            conversationId,
            'human_request',
        )).resolves.toMatchObject({ agentId, contactId, phone: '+573001234567' });

        expect(h.order).toEqual(['commit', 'event']);
        expect(h.events.emit).toHaveBeenCalledWith('conversation.assigned', expect.objectContaining({
            tenantId,
            schemaName,
            conversationId,
            agentId,
            contactId,
            phone: '+573001234567',
            assignmentSource: 'auto',
            assignedAt: expect.any(String),
        }));
    });

    it('does not emit conversation.assigned when the auto-assignment transaction fails', async () => {
        const h = makeHarness(true);

        await expect((h.service as any).tryAutoAssign(
            tenantId,
            schemaName,
            conversationId,
            'human_request',
        )).resolves.toBeNull();

        expect(h.events.emit).not.toHaveBeenCalledWith('conversation.assigned', expect.anything());
    });
});
