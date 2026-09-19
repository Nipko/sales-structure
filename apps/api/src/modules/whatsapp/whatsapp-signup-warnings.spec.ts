import { ChannelManagementController } from '../channels/channel-management.controller';
import {
    LATEST_SIGNUP_WARNINGS_SQL, readSignupWarnings, signupWarningsForAccount, type LatestSignupRow,
} from './whatsapp-signup-warnings';

/**
 * ═══ A NUMBER CONNECTED EARLIER STILL SAYS WHAT ITS SIGNUP LEFT OPEN ═══
 *
 * Embedded Signup persists its warnings on the onboarding row, and
 * `GET /channels/whatsapp/status` never returned them: the wizard's last screen
 * and Canales → WhatsApp could only show the warnings of a signup run in that
 * same page session. A number whose webhook subscription Meta did not confirm,
 * or that Meta did not register, read "Conectado" after a reload. These pin the
 * additive `signupWarnings` field on each connected WhatsApp account, its
 * tenant scoping, and when a recorded signup no longer describes the
 * connection.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const signup = (over: Partial<LatestSignupRow> = {}): LatestSignupRow => ({
    phone_number_id: 'phone-1', waba_id: 'waba-1',
    warnings: ['phone_registration_deferred', 'webhook_subscription_failed'],
    completed_at: new Date('2026-09-17T15:00:00.000Z'),
    ...over,
});
const account = (metadata: Record<string, unknown> = { wabaId: 'waba-1', source: 'embedded_signup' }) => ({
    accountId: 'phone-1', metadata,
});

describe('which recorded signup describes a connection', () => {
    it('returns the known codes of the latest signup, with when it completed', () => {
        expect(signupWarningsForAccount(account(), signup())).toEqual({
            codes: ['phone_registration_deferred', 'webhook_subscription_failed'],
            recordedAt: '2026-09-17T15:00:00.000Z',
        });
    });

    it('drops free text and unknown codes: a screen only gets what it can say', () => {
        expect(signupWarningsForAccount(account(), signup({ warnings: ['La verificación…', 'future_code', 'business_not_verified'] })).codes)
            .toEqual(['business_not_verified']);
        expect(signupWarningsForAccount(account(), signup({ warnings: null })).codes).toEqual([]);
    });

    it('says nothing about a number reconnected by hand after the signup', () => {
        expect(signupWarningsForAccount(account({ wabaId: 'waba-1', source: 'manual_connect' }), signup()))
            .toEqual({ codes: [], recordedAt: null });
    });

    it('says nothing about a number now on another WABA than the signup\'s', () => {
        expect(signupWarningsForAccount(account({ wabaId: 'waba-2', source: 'embedded_signup' }), signup()))
            .toEqual({ codes: [], recordedAt: null });
    });

    it('a number with no recorded signup has nothing open', () => {
        expect(signupWarningsForAccount(account(), undefined)).toEqual({ codes: [], recordedAt: null });
    });
});

describe('readSignupWarnings', () => {
    it('asks only for this tenant and only for its numbers, and never reads the token beside the warnings', async () => {
        const prisma = { $queryRawUnsafe: jest.fn(async () => [signup()]) };

        const result = await readSignupWarnings(prisma, TENANT, [account(), { accountId: 'phone-2', metadata: {} }]);

        expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(LATEST_SIGNUP_WARNINGS_SQL, TENANT, ['phone-1', 'phone-2']);
        expect(LATEST_SIGNUP_WARNINGS_SQL).toContain("exchange_payload->'warnings'");
        expect(LATEST_SIGNUP_WARNINGS_SQL).not.toMatch(/exchange_payload\s*(,|\n|FROM)/);
        expect(result?.get('phone-1')?.codes).toEqual(['phone_registration_deferred', 'webhook_subscription_failed']);
        expect(result?.get('phone-2')).toEqual({ codes: [], recordedAt: null });
    });

    it('answers null, not "nothing open", when the read fails — and does not throw', async () => {
        const onError = jest.fn();
        const prisma = { $queryRawUnsafe: jest.fn(async () => { throw new Error('pgbouncer down'); }) };

        await expect(readSignupWarnings(prisma, TENANT, [account()], onError)).resolves.toBeNull();
        expect(onError).toHaveBeenCalled();
    });

    it('does not query at all without numbers', async () => {
        const prisma = { $queryRawUnsafe: jest.fn() };
        expect(await readSignupWarnings(prisma, TENANT, [])).toEqual(new Map());
        expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });
});

describe('GET /channels/:channelType/status carries them for WhatsApp', () => {
    const rows = [
        { accountId: 'phone-1', displayName: 'Tienda', channelType: 'whatsapp', metadata: { wabaId: 'waba-1', source: 'embedded_signup' } },
        { accountId: 'phone-2', displayName: 'Sucursal', channelType: 'whatsapp', metadata: { wabaId: 'waba-2', source: 'embedded_signup' } },
    ];
    const controllerWith = (query: () => Promise<unknown>) => {
        const prisma = {
            channelAccount: { findMany: jest.fn(async () => rows) },
            $queryRawUnsafe: jest.fn(query),
        };
        const controller = new ChannelManagementController(
            prisma as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
        );
        jest.spyOn((controller as any).logger, 'warn').mockImplementation(() => undefined);
        return { controller, prisma };
    };
    const req = { user: { tenantId: TENANT } };

    it('adds signupWarnings per connected number, scoped to the tenant on the request', async () => {
        const { controller, prisma } = controllerWith(async () => [signup({ warnings: ['phone_registration_deferred'] })]);

        const body: any = await controller.getStatus('whatsapp', req);

        expect(prisma.channelAccount.findMany).toHaveBeenCalledWith({ where: { tenantId: TENANT, channelType: 'whatsapp', isActive: true } });
        expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(LATEST_SIGNUP_WARNINGS_SQL, TENANT, ['phone-1', 'phone-2']);
        expect(body.data.accounts).toEqual([
            expect.objectContaining({ accountId: 'phone-1', signupWarnings: ['phone_registration_deferred'], signupWarningsAt: '2026-09-17T15:00:00.000Z' }),
            expect.objectContaining({ accountId: 'phone-2', signupWarnings: [], signupWarningsAt: null }),
        ]);
        expect(body.data.account).toEqual(expect.objectContaining({ accountId: 'phone-1', signupWarnings: ['phone_registration_deferred'] }));
    });

    it('still answers the status when the warnings cannot be read, marking them unknown', async () => {
        const { controller } = controllerWith(async () => { throw new Error('boom'); });

        const body: any = await controller.getStatus('whatsapp', req);

        expect(body.data.connected).toBe(true);
        expect(body.data.accounts.map((a: any) => a.signupWarnings)).toEqual([null, null]);
    });

    it('leaves other channels exactly as they were', async () => {
        const { controller, prisma } = controllerWith(async () => []);

        const body: any = await controller.getStatus('telegram', req);

        expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
        expect(body.data.accounts[0]).not.toHaveProperty('signupWarnings');
    });
});
