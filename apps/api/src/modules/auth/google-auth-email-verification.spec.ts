import { UnauthorizedException } from '@nestjs/common';
import { GoogleAuthService } from './google-auth.service';

describe('GoogleAuthService verified-email boundary', () => {
    const build = (payload: Record<string, unknown>) => {
        const service = new GoogleAuthService({ get: jest.fn().mockReturnValue('google-client') } as any);
        (service as any).client = {
            verifyIdToken: jest.fn().mockResolvedValue({ getPayload: () => payload }),
        };
        return service;
    };

    it('accepts a signed provider identity only when Google verified the email', async () => {
        await expect(build({
            sub: 'google-user', email: 'owner@example.com', email_verified: true,
            given_name: 'Owner', family_name: 'Tenant',
        }).verifyIdToken('signed-token')).resolves.toMatchObject({ email: 'owner@example.com' });
    });

    it('does not turn an unverified provider claim into a verified Parallly account', async () => {
        await expect(build({
            sub: 'google-user', email: 'owner@example.com', email_verified: false,
        }).verifyIdToken('signed-token')).rejects.toBeInstanceOf(UnauthorizedException);
    });
});
