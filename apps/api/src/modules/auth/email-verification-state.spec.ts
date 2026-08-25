import { AuthService } from './auth.service';

describe('P25 persisted email-verification lifecycle', () => {
    const build = () => {
        const service = Object.create(AuthService.prototype) as AuthService;
        const prisma = {
            user: {
                findUnique: jest.fn(),
                update: jest.fn().mockResolvedValue({}),
            },
        };
        (service as any).prisma = prisma;
        (service as any).logger = { log: jest.fn(), error: jest.fn() };
        return { service, prisma };
    };

    it('moves a corrected unverified address to pending_change', async () => {
        const { service, prisma } = build();
        prisma.user.findUnique
            .mockResolvedValueOnce({ id: userId, email: 'wrong@example.com', emailVerified: false })
            .mockResolvedValueOnce(null);
        (service as any).sendVerificationEmail = jest.fn().mockResolvedValue({ sent: true });

        await expect(service.changePendingEmail(userId, 'owner@example.com')).resolves.toMatchObject({
            email: 'owner@example.com', verificationEmailSent: true,
        });
        expect(prisma.user.update).toHaveBeenCalledWith({
            where: { id: userId },
            data: expect.objectContaining({ email: 'owner@example.com', emailVerificationState: 'pending_change' }),
        });
    });

    it('atomically clears the challenge and records verified after a valid code', async () => {
        const { service, prisma } = build();
        prisma.user.findUnique.mockResolvedValue({
            id: userId,
            emailVerifyCode: '123456',
            emailVerifyExpires: new Date(Date.now() + 60_000),
        });
        (service as any).timingSafeEqual = jest.fn().mockReturnValue(true);

        await service.verifyEmailCode(userId, '123456');
        expect(prisma.user.update).toHaveBeenCalledWith({
            where: { id: userId },
            data: {
                emailVerified: true,
                emailVerificationState: 'verified',
                emailVerifyCode: null,
                emailVerifyExpires: null,
            },
        });
    });
});

const userId = '11111111-1111-4111-8111-111111111111';
