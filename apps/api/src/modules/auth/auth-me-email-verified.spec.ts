import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

/**
 * `/auth/me` says whether the email is confirmed, read from the database on
 * every call.
 *
 * The dashboard's setup wizard refuses Instagram, Messenger and Telegram while
 * the session says `emailVerified: false`. The session used to learn it only at
 * login and on /verify-email, so an owner who confirmed on her phone stayed
 * refused until she reloaded. The dashboard now re-reads `/auth/me` when she
 * comes back to the window and takes `emailVerified: true` from it
 * (`mergeOnboardingSessionFacts`); this pins the API half of that contract:
 * the user `/auth/me` returns is the one `validateUser` re-read, not a copy of
 * the login token, so a confirmation made anywhere is in the very next read.
 */
describe('/auth/me carries the confirmed email', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    function makeService(emailVerified: boolean) {
        const row = {
            id: 'u1', email: 'owner@example.com', role: 'tenant_admin', tenantId, isActive: true,
            onboardingCompleted: true, emailVerified, emailVerificationState: emailVerified ? 'verified' : 'unverified',
            tenant: { id: tenantId, schemaName: 'tenant_norte', isActive: true, onboardingCompletedAt: new Date('2026-09-14T13:00:00.000Z') },
        };
        const prisma: any = {
            user: { findUnique: jest.fn().mockResolvedValue(row) },
            tenant: {
                findUnique: jest.fn().mockResolvedValue({
                    settings: { onboardingStage: 'agent_reviewed' }, schemaName: 'tenant_norte',
                    createdAt: new Date('2026-09-14T13:00:00.000Z'),
                }),
            },
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ c: 1 }]),
        };
        const redis: any = { get: jest.fn().mockResolvedValue(null), getJson: jest.fn(), expire: jest.fn() };
        const service = new AuthService(
            prisma, {} as any, {} as any, {} as any, {} as any, redis, {} as any,
            {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
        );
        const controller: any = Object.create(AuthController.prototype);
        controller.authService = service;
        return { service, controller, prisma };
    }

    it.each([true, false])('returns emailVerified=%s as the database has it', async (emailVerified) => {
        const { service, controller } = makeService(emailVerified);
        // What the JWT guard puts on the request: the user `validateUser` re-read.
        const requestUser = await service.validateUser({ sub: 'u1', email: 'owner@example.com', role: 'tenant_admin', tenantId } as any);
        const answer = await controller.me(requestUser);

        expect(answer.success).toBe(true);
        expect(answer.data).toMatchObject({ id: 'u1', tenantId, emailVerified, onboardingStage: expect.any(String) });
    });

    it('reads it from the user row, not from the token', async () => {
        const { service, prisma } = makeService(true);
        // The token was minted before the confirmation and says nothing about it.
        await service.validateUser({ sub: 'u1', email: 'owner@example.com', role: 'tenant_admin', tenantId } as any);
        const selects = prisma.user.findUnique.mock.calls.map(([args]: [any]) => args?.select ?? {});
        expect(selects.some((select: Record<string, unknown>) => select.emailVerified === true)).toBe(true);
    });
});
