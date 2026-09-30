import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PlatformCommunicationsController } from './platform-communications.controller';

describe('PlatformCommunicationsController authorization', () => {
    const context = (user: unknown) => ({
        getHandler: () => PlatformCommunicationsController.prototype.send,
        getClass: () => PlatformCommunicationsController,
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

    it('declares both JWT authentication and role enforcement', () => {
        const guards = Reflect.getMetadata(GUARDS_METADATA, PlatformCommunicationsController);
        expect(guards).toHaveLength(2);
        expect(typeof guards[0].prototype.canActivate).toBe('function');
        expect(guards[1]).toBe(RolesGuard);
    });

    it('rejects unauthenticated and all tenant roles, accepts super_admin', () => {
        const guard = new RolesGuard(new Reflector());
        expect(() => guard.canActivate(context(undefined))).toThrow(UnauthorizedException);
        for (const role of ['tenant_admin', 'tenant_supervisor', 'tenant_agent']) expect(guard.canActivate(context({ role }))).toBe(false);
        expect(guard.canActivate(context({ role: 'super_admin' }))).toBe(true);
    });

    it('rejects impersonation before invoking the service', async () => {
        const service: any = { send: jest.fn() };
        const controller = new PlatformCommunicationsController(service);
        await expect(controller.send({ user: { id: 'x', email: 'admin@example.com', isImpersonation: true } }, 'x', { expectedRevision: 1, previewVersion: 'x' })).rejects.toThrow(ForbiddenException);
        expect(service.send).not.toHaveBeenCalled();
    });
});
