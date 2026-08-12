import { AgentConsoleGateway } from './agent-console.gateway';
import { StructuredHandoffSummary } from '@parallext/shared';

describe('AgentConsoleGateway structured handoff compatibility', () => {
    const structuredSummary: StructuredHandoffSummary = {
        version: 1,
        reason: 'human_request',
        customerIntent: 'Cambiar el pedido',
        knownFacts: ['El cliente solicitó un cambio'],
        sources: [{
            type: 'message',
            id: 'message-1',
            label: 'Solicitud del cliente',
            citation: '[message:message-1]',
        }],
        lastToolOutcomes: [],
        pendingActions: ['Validar el cambio'],
        confidence: 0.8,
        uncertainty: [],
        language: 'es',
        traceId: 'trace-1',
        generatedAt: '2026-08-08T00:00:00.000Z',
        generatedBy: 'deterministic_fallback',
    };

    it('keeps handoff PII out of the tenant room and uses scoped sensitive rooms', () => {
        const wsRelay = { publish: jest.fn() };
        const gateway = new AgentConsoleGateway(
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            wsRelay as any,
        );

        gateway.handleHandoffEscalated({
            tenantId: '11111111-1111-4111-8111-111111111111',
            schemaName: 'tenant_acme_11111111111141118111111111111111',
            conversationId: '22222222-2222-4222-8222-222222222222',
            reason: 'human_request',
            summary: '**Tema**: Cambiar el pedido',
            structuredSummary,
            traceId: 'trace-1',
            assignedTo: '33333333-3333-4333-8333-333333333333',
            contactName: 'Cliente',
            handoffTriggeredAt: '2026-08-08T00:00:00.000Z',
        });

        expect(wsRelay.publish).toHaveBeenCalledWith('agent', expect.objectContaining({
            room: 'role:11111111-1111-4111-8111-111111111111:tenant_admin',
            event: 'inbox:handoff',
            payload: expect.objectContaining({
                summary: '**Tema**: Cambiar el pedido',
                structuredSummary,
                traceId: 'trace-1',
            }),
        }));
        expect(wsRelay.publish).toHaveBeenCalledWith('agent', expect.objectContaining({
            room: 'conversation:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222',
            event: 'inbox:handoff',
        }));
        expect(wsRelay.publish).toHaveBeenCalledWith('agent', expect.objectContaining({
            room: 'agent:11111111-1111-4111-8111-111111111111:33333333-3333-4333-8333-333333333333',
            event: 'inbox:assigned_to_you',
            payload: expect.objectContaining({
                summary: '**Tema**: Cambiar el pedido',
                structuredSummary,
                traceId: 'trace-1',
            }),
        }));
        const tenantHandoff = wsRelay.publish.mock.calls.find(([, item]) =>
            item.room === 'tenant:11111111-1111-4111-8111-111111111111'
            && item.event === 'inbox:handoff',
        );
        expect(tenantHandoff).toBeUndefined();
        expect(wsRelay.publish).toHaveBeenCalledWith('agent', {
            room: 'tenant:11111111-1111-4111-8111-111111111111',
            event: 'inbox:refresh',
            payload: {},
        });
    });

    it('routes draft and approval content only to conversation/elevated rooms', () => {
        const wsRelay = { publish: jest.fn() };
        const gateway = new AgentConsoleGateway(
            {} as any, {} as any, {} as any, {} as any,
            {} as any, {} as any, {} as any, wsRelay as any,
        );
        const tenantId = '11111111-1111-4111-8111-111111111111';
        const conversationId = '22222222-2222-4222-8222-222222222222';

        gateway.handleDraftSuggested({ tenantId, conversationId, text: 'Respuesta privada' });
        gateway.handleToolApprovalNotification({
            tenantId,
            conversationId,
            eventId: 'event-1',
            eventType: 'approval.requested',
            ticketId: 'ticket-1',
        });

        for (const sensitiveEvent of ['inbox:draft_suggestion', 'inbox:tool_approval']) {
            expect(wsRelay.publish.mock.calls.some(([, item]) =>
                item.room === `tenant:${tenantId}` && item.event === sensitiveEvent,
            )).toBe(false);
            expect(wsRelay.publish.mock.calls.some(([, item]) =>
                item.room === `conversation:${tenantId}:${conversationId}` && item.event === sensitiveEvent,
            )).toBe(true);
            expect(wsRelay.publish.mock.calls.some(([, item]) =>
                item.room === `role:${tenantId}:tenant_admin` && item.event === sensitiveEvent,
            )).toBe(true);
        }
        const tenantPayloads = wsRelay.publish.mock.calls
            .filter(([, item]) => item.room === `tenant:${tenantId}`)
            .map(([, item]) => item.payload);
        expect(tenantPayloads.every((payload) => !payload.suggestedText && !payload.ticketId)).toBe(true);
    });
});
