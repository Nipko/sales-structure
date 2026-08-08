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

    it('forwards both legacy and structured summaries to tenant and assigned-agent consumers', () => {
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
            room: 'tenant:11111111-1111-4111-8111-111111111111',
            event: 'inbox:handoff',
            payload: expect.objectContaining({
                summary: '**Tema**: Cambiar el pedido',
                structuredSummary,
                traceId: 'trace-1',
            }),
        }));
        expect(wsRelay.publish).toHaveBeenCalledWith('agent', expect.objectContaining({
            room: 'agent:33333333-3333-4333-8333-333333333333',
            event: 'inbox:assigned_to_you',
            payload: expect.objectContaining({
                summary: '**Tema**: Cambiar el pedido',
                structuredSummary,
                traceId: 'trace-1',
            }),
        }));
    });
});
