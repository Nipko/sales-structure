import { ConflictException } from '@nestjs/common';
import { InvitationsService } from './invitations.service';

describe('InvitationsService provisioned owner claims', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const placeholder = {
        id: 'owner-1',
        email: 'owner@clinicanorte.com',
        tenantId,
        role: 'tenant_admin',
        authProvider: 'invitation',
        password: null,
        emailVerified: false,
        isActive: true,
    };

    function setup(existingUser: any = placeholder) {
        const invitation = {
            id: 'invite-1',
            tenantId,
            email: placeholder.email,
            role: 'tenant_admin',
            skillTags: [],
            token: 'valid-token',
            expiresAt: new Date(Date.now() + 86_400_000),
            acceptedAt: null,
            revokedAt: null,
        };
        const prisma: any = {
            user: {
                findUnique: jest.fn(async () => existingUser),
                findFirst: jest.fn(async () => null),
                count: jest.fn(async () => 1),
                create: jest.fn(async ({ data }: any) => ({ id: 'new-user', ...data })),
                update: jest.fn(async ({ data }: any) => ({ ...existingUser, ...data })),
            },
            tenantInvitation: {
                findUnique: jest.fn(async () => invitation),
                findFirst: jest.fn(async () => null),
                count: jest.fn(async () => 0),
                create: jest.fn(async ({ data }: any) => ({ id: 'invite-2', ...data })),
                update: jest.fn(async ({ data }: any) => ({ ...invitation, ...data })),
            },
            tenant: {
                findUnique: jest.fn(async () => ({
                    name: 'Clínica Norte',
                    slug: 'clinica-norte',
                    settings: {},
                    language: 'es-CO',
                })),
            },
            auditLog: { create: jest.fn(async () => ({ id: 'audit-1' })) },
        };
        const email: any = { send: jest.fn(async () => undefined) };
        const throttle: any = { enforcePlanLimit: jest.fn(async () => undefined) };
        return {
            service: new InvitationsService(prisma, email, throttle),
            prisma,
            email,
            throttle,
        };
    }

    it('creates the owner invitation without counting the existing placeholder as a new seat', async () => {
        const ctx = setup();

        await ctx.service.create({
            tenantId,
            email: placeholder.email,
            role: 'tenant_admin',
        });

        expect(ctx.throttle.enforcePlanLimit)
            .toHaveBeenCalledWith(tenantId, 'seats', 0, 'usuarios');
        expect(ctx.prisma.tenantInvitation.create).toHaveBeenCalled();
    });

    it('claims only the inert owner placeholder when the invitation is accepted', async () => {
        const ctx = setup();

        const result = await ctx.service.accept('valid-token', {
            password: 'Secure!Pass123',
            firstName: 'Laura',
            lastName: 'Gómez',
        });

        expect(ctx.prisma.user.update).toHaveBeenCalledWith({
            where: { id: placeholder.id },
            data: expect.objectContaining({
                firstName: 'Laura',
                emailVerified: true,
                authProvider: 'email',
                onboardingCompleted: true,
            }),
        });
        expect(ctx.prisma.user.create).not.toHaveBeenCalled();
        expect(ctx.throttle.enforcePlanLimit).not.toHaveBeenCalled();
        expect(ctx.prisma.tenantInvitation.update).toHaveBeenCalledWith({
            where: { id: 'invite-1' },
            data: expect.objectContaining({ acceptedUserId: placeholder.id }),
        });
        expect(result).toEqual({ userId: placeholder.id, tenantId, role: 'tenant_admin' });
    });

    it('never overwrites or moves a normal existing account', async () => {
        const ctx = setup({ ...placeholder, authProvider: 'email', password: 'already-set', emailVerified: true });

        await expect(ctx.service.accept('valid-token', {
            password: 'Secure!Pass123',
            firstName: 'Laura',
        })).rejects.toBeInstanceOf(ConflictException);

        expect(ctx.prisma.user.update).not.toHaveBeenCalled();
    });
});
