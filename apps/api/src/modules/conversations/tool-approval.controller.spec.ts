import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { ToolApprovalController } from './tool-approval.controller';

const tenantId = '11111111-1111-4111-8111-111111111111';
const ticketId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';

describe('ToolApprovalController', () => {
    it('requires tenant isolation and limits list, decisions and resume to elevated tenant roles', () => {
        const guards = Reflect.getMetadata(GUARDS_METADATA, ToolApprovalController) || [];
        expect(guards).toContain(TenantGuard);
        const roles = ['super_admin', 'tenant_admin', 'tenant_supervisor'];
        expect(Reflect.getMetadata(ROLES_KEY, ToolApprovalController.prototype.list)).toEqual(roles);
        expect(Reflect.getMetadata(ROLES_KEY, ToolApprovalController.prototype.decide)).toEqual(roles);
        expect(Reflect.getMetadata(ROLES_KEY, ToolApprovalController.prototype.resume)).toEqual(roles);
    });

    it('lists only through the tenant-scoped workflow with bounded filters', async () => {
        const workflow = { listApprovals: jest.fn().mockResolvedValue([{ id: ticketId }]) };
        const controller = new ToolApprovalController(workflow as any);

        await expect(controller.list(tenantId, 'pending', '25')).resolves.toEqual({
            success: true,
            data: [{ id: ticketId }],
        });
        expect(workflow.listApprovals).toHaveBeenCalledWith({
            tenantId,
            status: 'pending',
            limit: 25,
        });
        await expect(controller.list(tenantId, 'unknown', '25'))
            .rejects.toBeInstanceOf(BadRequestException);
        await expect(controller.list(tenantId, 'pending', '101'))
            .rejects.toBeInstanceOf(BadRequestException);
    });

    it('passes the authenticated actor and tenant scope to decide-and-resume', async () => {
        const workflow = {
            decide: jest.fn().mockResolvedValue({
                ticketId,
                status: 'approved',
                resume: { state: 'completed', result: { success: true } },
            }),
        };
        const controller = new ToolApprovalController(workflow as any);

        await expect(controller.decide(
            tenantId,
            ticketId,
            { decision: 'approved', reason: 'Reviewed by supervisor' },
            { user: { id: actorId } },
        )).resolves.toEqual({
            success: true,
            data: {
                ticketId,
                status: 'approved',
                resume: { state: 'completed', result: { success: true } },
            },
        });
        expect(workflow.decide).toHaveBeenCalledWith({
            tenantId,
            ticketId,
            actorId,
            decision: 'approved',
            reason: 'Reviewed by supervisor',
        });
    });

    it('rejects invalid decisions before reaching the workflow', async () => {
        const workflow = { decide: jest.fn() };
        const controller = new ToolApprovalController(workflow as any);

        await expect(controller.decide(
            tenantId,
            ticketId,
            { decision: 'pending' as any },
            { user: { id: actorId } },
        )).rejects.toBeInstanceOf(BadRequestException);
        expect(workflow.decide).not.toHaveBeenCalled();
    });

    it('exposes an idempotent manual resume boundary for approved tickets', async () => {
        const workflow = {
            resumeApprovedTicket: jest.fn().mockResolvedValue({
                state: 'completed',
                result: { success: true },
            }),
        };
        const controller = new ToolApprovalController(workflow as any);

        await expect(controller.resume(tenantId, ticketId)).resolves.toEqual({
            success: true,
            data: { state: 'completed', result: { success: true } },
        });
        expect(workflow.resumeApprovedTicket).toHaveBeenCalledWith(tenantId, ticketId);
    });
});
