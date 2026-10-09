import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

/**
 * Los errores que el dashboard tiene que poder traducir viajan con un `error`
 * estable ademas del `message` en ingles/espanol que ya llevaban. Antes una
 * clave incorrecta se mostraba como "Invalid credentials" sobre un dashboard en
 * espanol, y un codigo vencido era indistinguible de uno mal tipeado.
 */
describe('auth stable error codes', () => {
    const userId = '11111111-1111-4111-8111-111111111111';

    const build = () => {
        const service = Object.create(AuthService.prototype) as AuthService;
        const prisma: any = {
            user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
        };
        prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));
        (service as any).prisma = prisma;
        (service as any).logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
        return { service, prisma };
    };

    async function thrown(promise: Promise<unknown>) {
        try {
            await promise;
        } catch (error) {
            return error as any;
        }
        throw new Error('expected the call to throw');
    }

    describe('login', () => {
        it('answers a wrong password with invalid_credentials and keeps the English message', async () => {
            const { service, prisma } = build();
            prisma.user.findUnique.mockResolvedValue({
                id: userId, isActive: true, password: await bcrypt.hash('la-correcta-123', 4),
            });

            const error = await thrown(service.login('owner@example.com', 'otra-clave-999'));

            expect(error).toBeInstanceOf(UnauthorizedException);
            expect(error.getResponse()).toMatchObject({
                error: 'invalid_credentials', message: 'Invalid credentials',
            });
        });

        it('does not tell an unknown email apart from a wrong password', async () => {
            const { service, prisma } = build();
            prisma.user.findUnique.mockResolvedValue(null);

            const error = await thrown(service.login('nadie@example.com', 'x'));

            expect(error.getResponse()).toMatchObject({ error: 'invalid_credentials' });
        });

        it('flags a Google-only account with its own code', async () => {
            const { service, prisma } = build();
            prisma.user.findUnique.mockResolvedValue({ id: userId, isActive: true, password: null });

            const error = await thrown(service.login('owner@example.com', 'x'));

            expect(error.getResponse()).toMatchObject({ error: 'google_account_only' });
        });
    });

    describe('verifyEmailCode', () => {
        const pending = (overrides: Record<string, unknown>) => ({
            id: userId,
            emailVerifyCode: '123456',
            emailVerifyExpires: new Date(Date.now() + 60_000),
            ...overrides,
        });

        it('wrong code -> invalid_verification_code', async () => {
            const { service, prisma } = build();
            prisma.user.findUnique.mockResolvedValue(pending({}));

            const error = await thrown(service.verifyEmailCode(userId, '000000'));

            expect(error).toBeInstanceOf(BadRequestException);
            expect(error.getResponse()).toMatchObject({ error: 'invalid_verification_code' });
            expect(prisma.user.update).not.toHaveBeenCalled();
        });

        it('expired code -> verification_code_expired, even when the digits match', async () => {
            const { service, prisma } = build();
            prisma.user.findUnique.mockResolvedValue(
                pending({ emailVerifyExpires: new Date(Date.now() - 1_000) }),
            );

            const error = await thrown(service.verifyEmailCode(userId, '123456'));

            expect(error.getResponse()).toMatchObject({ error: 'verification_code_expired' });
            expect(prisma.user.update).not.toHaveBeenCalled();
        });

        it('no pending code at all -> verification_code_expired (ask for a new one)', async () => {
            const { service, prisma } = build();
            prisma.user.findUnique.mockResolvedValue(
                pending({ emailVerifyCode: null, emailVerifyExpires: null }),
            );

            const error = await thrown(service.verifyEmailCode(userId, '123456'));

            expect(error.getResponse()).toMatchObject({ error: 'verification_code_expired' });
        });

        it('still verifies a correct, current code', async () => {
            const { service, prisma } = build();
            prisma.user.findUnique.mockResolvedValue(pending({}));

            await expect(service.verifyEmailCode(userId, '123456')).resolves.toMatchObject({
                message: 'Email verified successfully',
            });
            expect(prisma.user.update).toHaveBeenCalledTimes(1);
        });
    });
});
