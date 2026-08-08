import { EventEmitter2 } from '@nestjs/event-emitter';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConversationsModule } from './conversations.module';
import { ToolApprovalController } from './tool-approval.controller';
import { ToolApprovalWorkflowService } from './tool-approval-workflow.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const ticketId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const contactId = '44444444-4444-4444-8444-444444444444';
const conversationId = '55555555-5555-4555-8555-555555555555';
const schemaName = 'tenant_approval_e2e';

describe('A4 approval workflow e2e', () => {
    it('registers the controller and durable workflow in ConversationsModule DI', () => {
        const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ConversationsModule) || [];
        const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ConversationsModule) || [];
        const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, ConversationsModule) || [];
        expect(providers).toContain(ToolApprovalWorkflowService);
        expect(controllers).toContain(ToolApprovalController);
        expect(exports).toContain(ToolApprovalWorkflowService);
    });

    it('discovers, approves, resumes and commits one execution across idempotent retries', async () => {
        const state: any = {
            status: 'pending',
            resumeState: 'not_requested',
            result: null,
            outbox: [
                { id: 'a1111111-1111-4111-8111-111111111111', eventType: 'tool.approval.requested' },
            ],
            published: [],
        };
        const controls = {
            listApprovalTickets: jest.fn(async () => [{
                id: ticketId,
                toolName: 'apply_discount',
                contactId,
                conversationId,
                status: state.status,
                request: { percent: 10, reason: 'retención' },
                resumeState: state.resumeState,
            }]),
            decideApprovalTicket: jest.fn(async (input: any) => {
                const replay = state.status === input.decision;
                state.status = input.decision;
                if (input.decision === 'approved' && state.resumeState === 'not_requested') {
                    state.resumeState = 'pending';
                    state.outbox.push({
                        id: 'a2222222-2222-4222-8222-222222222222',
                        eventType: 'tool.approval.approved',
                    });
                }
                return {
                    tenantId,
                    schemaName,
                    ticketId,
                    status: input.decision,
                    decidedBy: actorId,
                    decidedAt: '2026-08-08T12:00:00.000Z',
                    ...(replay ? { idempotentReplay: true } : {}),
                };
            }),
            claimApprovalResume: jest.fn(async () => {
                if (state.resumeState === 'completed') {
                    return { state: 'completed', result: state.result };
                }
                if (state.status !== 'approved' || state.resumeState !== 'pending') return { state: 'none' };
                state.resumeState = 'processing';
                return {
                    state: 'claimed',
                    claim: {
                        tenantId,
                        schemaName,
                        ticketId,
                        leaseToken: '66666666-6666-4666-8666-666666666666',
                        toolName: 'apply_discount',
                        contactId,
                        conversationId,
                        channelType: 'whatsapp',
                        args: { percent: 10, reason: 'retención' },
                    },
                };
            }),
            finishApprovalResume: jest.fn(async (_claim: any, result: any) => {
                state.resumeState = 'completed';
                state.result = result;
                state.outbox.push({
                    id: 'a3333333-3333-4333-8333-333333333333',
                    eventType: 'tool.approval.resumed',
                });
                return { state: 'completed', result };
            }),
            claimApprovalOutboxEvents: jest.fn(async () => state.outbox.splice(0).map((event: any) => ({
                ...event,
                leaseToken: '77777777-7777-4777-8777-777777777777',
                payload: { ticketId, toolName: 'apply_discount', contactId, conversationId },
            }))),
            finishApprovalOutboxEvent: jest.fn(async (_schema: string, event: any) => {
                state.published.push(event.eventType);
            }),
            expirePendingApprovalTickets: jest.fn().mockResolvedValue(0),
            reconcileExpiredExecutionLeases: jest.fn().mockResolvedValue(0),
        };
        const executor = {
            execute: jest.fn().mockResolvedValue({ success: true, discountId: 'discount-1' }),
        };
        const events = new EventEmitter2();
        const notifications: any[] = [];
        events.on('tool.approval.notification', (event) => notifications.push(event));
        const workflow = new ToolApprovalWorkflowService(
            { tenant: { findMany: jest.fn().mockResolvedValue([]) } } as any,
            controls as any,
            executor as any,
            events,
            { runExclusive: jest.fn() } as any,
        );
        const controller = new ToolApprovalController(workflow);

        const discovered = await controller.list(tenantId, 'pending', '25');
        expect(discovered.data).toHaveLength(1);
        expect(discovered.data[0]).toMatchObject({
            id: ticketId,
            status: 'pending',
            request: { percent: 10 },
        });

        const first = await controller.decide(
            tenantId,
            ticketId,
            { decision: 'approved', reason: 'verified' },
            { user: { id: actorId } },
        );
        expect(first.data.resume).toEqual({
            state: 'completed',
            result: { success: true, discountId: 'discount-1' },
        });

        const replay = await controller.decide(
            tenantId,
            ticketId,
            { decision: 'approved', reason: 'verified' },
            { user: { id: actorId } },
        );
        expect(replay.data).toMatchObject({
            idempotentReplay: true,
            resume: { state: 'completed', result: { discountId: 'discount-1' } },
        });
        expect(executor.execute).toHaveBeenCalledTimes(1);
        expect(executor.execute).toHaveBeenCalledWith(
            schemaName,
            tenantId,
            contactId,
            'apply_discount',
            { percent: 10, reason: 'retención' },
            conversationId,
            { channelType: 'whatsapp' },
        );
        expect(state.published).toEqual([
            'tool.approval.requested',
            'tool.approval.approved',
            'tool.approval.resumed',
        ]);
        expect(notifications).toHaveLength(3);
        expect(notifications.every((event) => event.tenantId === tenantId)).toBe(true);
    });

    it('sweeps expired pending tickets before claiming cron recovery work', async () => {
        const order: string[] = [];
        const controls = {
            expirePendingApprovalTickets: jest.fn(async () => {
                order.push('expire');
                return 1;
            }),
            reconcileExpiredExecutionLeases: jest.fn(async () => {
                order.push('execution-leases');
                return 0;
            }),
            claimApprovalResume: jest.fn(async () => {
                order.push('resume-claim');
                return { state: 'none' };
            }),
            claimApprovalOutboxEvents: jest.fn(async () => {
                order.push('outbox');
                return [];
            }),
        };
        const workflow = new ToolApprovalWorkflowService(
            {
                tenant: {
                    findMany: jest.fn().mockResolvedValue([{ id: tenantId, schemaName }]),
                },
            } as any,
            controls as any,
            { execute: jest.fn() } as any,
            new EventEmitter2(),
            { runExclusive: jest.fn() } as any,
        );

        await workflow.recoverAllTenants();

        expect(controls.expirePendingApprovalTickets).toHaveBeenCalledWith(schemaName);
        expect(order).toEqual(['expire', 'execution-leases', 'resume-claim', 'outbox']);
    });
});
