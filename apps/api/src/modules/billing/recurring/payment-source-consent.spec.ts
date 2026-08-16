import { PaymentSourceService } from './payment-source.service';
import { WOMPI_CAPABILITIES } from '../adapters/provider-capabilities';

describe('PaymentSourceService consent challenge', () => {
    const TENANT = '11111111-1111-4111-8111-111111111111';

    const jwt = (claims: Record<string, unknown>) => [
        Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
        Buffer.from(JSON.stringify(claims)).toString('base64url'),
        'signature',
    ].join('.');

    const contracts = {
        endUserPolicy: {
            token: jwt({ jit: 'policy-jit', file_hash: 'policy-v7' }),
            permalink: 'https://wompi.co/policy-v7',
            type: 'END_USER_POLICY',
        },
        personalDataAuth: {
            token: jwt({ jti: 'personal-jti', file_hash: 'personal-v3' }),
            permalink: 'https://wompi.co/personal-v3',
            type: 'PERSONAL_DATA_AUTH',
        },
    };

    function harness() {
        const cache = new Map<string, string>();
        const redis = {
            setJson: jest.fn(async (key: string, value: unknown) => {
                cache.set(key, JSON.stringify(value));
            }),
            getDel: jest.fn(async (key: string) => {
                const value = cache.get(key) ?? null;
                cache.delete(key);
                return value;
            }),
        };
        const charging = {
            getAcceptanceContracts: jest.fn().mockResolvedValue(contracts),
            startPaymentSource: jest.fn().mockResolvedValue({
                providerSourceId: 'pending:nequi:token-1',
                kind: 'nequi',
                status: 'pending_auth',
                authTokenId: 'token-1',
            }),
        };
        const prisma: any = {
            billingSubscription: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 'sub-1', tenantId: TENANT, provider: 'wompi',
                    providerSubscriptionId: 'frozen-provider', engine: 'internal',
                }),
            },
            billingPaymentSource: {
                findUnique: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockImplementation(async (args: any) => ({ id: 'source-1', ...args.data })),
                update: jest.fn().mockImplementation(async (args: any) => ({ id: args.where.id, ...args.data })),
                findMany: jest.fn().mockResolvedValue([{
                    id: 'source-1', tenantId: TENANT, provider: 'wompi',
                    kind: 'nequi', authTokenId: 'token-1', status: 'pending_auth',
                    createdAt: new Date(),
                }]),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            $queryRawUnsafe: jest.fn().mockResolvedValue([{
                id: 'source-1', tenantId: TENANT, metadata: {}, pendingCheckCount: 0,
            }]),
        };
        const providerFactory = {
            capabilitiesOf: jest.fn().mockReturnValue(WOMPI_CAPABILITIES),
            getCharging: jest.fn().mockReturnValue(charging),
        };
        const routing = {
            resolveForSubscription: jest.fn().mockReturnValue('wompi'),
            getConfig: jest.fn().mockResolvedValue({
                wompiMethods: { card: true, nequi: true, bancolombiaTransfer: true },
            }),
        };
        const service = new PaymentSourceService(
            prisma as any,
            redis as any,
            { emit: jest.fn() } as any,
            providerFactory as any,
            routing as any,
            {} as any,
            { getConfig: jest.fn().mockResolvedValue({ fiscalGateEnabled: false }) } as any,
            {} as any,
        );
        return { service, redis, charging, prisma };
    }

    it('returns versioned links plus a one-use nonce, never provider JWTs', async () => {
        const { service, redis } = harness();
        const result = await service.issueAcceptanceChallenge(TENANT);

        expect(result).toMatchObject({
            provider: 'wompi',
            consentId: expect.any(String),
            expiresAt: expect.any(String),
            endUserPolicy: {
                type: 'END_USER_POLICY',
                permalink: 'https://wompi.co/policy-v7',
                version: 'policy-v7',
                jti: 'policy-jit',
                fileHash: 'policy-v7',
            },
            personalDataAuth: {
                type: 'PERSONAL_DATA_AUTH',
                permalink: 'https://wompi.co/personal-v3',
                version: 'personal-v3',
                jti: 'personal-jti',
                fileHash: 'personal-v3',
            },
        });
        expect(JSON.stringify(result)).not.toContain(contracts.endUserPolicy.token);
        expect(redis.setJson).toHaveBeenCalledWith(
            `billing:acceptance:${TENANT}:${result.consentId}`,
            expect.any(Object),
            600,
        );
    });

    it('rejects direct API bypass before consuming the consent nonce', async () => {
        const { service, redis, charging } = harness();
        await expect(service.addPaymentSource({
            tenantId: TENANT,
            kind: 'nequi',
            token: 'token-1',
            customerEmail: 'owner@tenant.co',
            consentId: '22222222-2222-4222-8222-222222222222',
            acceptEndUserPolicy: true,
            acceptPersonalDataAuth: false,
        })).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'explicit_acceptance_required' }),
        });
        expect(redis.getDel).not.toHaveBeenCalled();
        expect(charging.startPaymentSource).not.toHaveBeenCalled();
    });

    it('uses the exact accepted contracts once and persists evidence for both', async () => {
        const { service, charging, prisma } = harness();
        const challenge = await service.issueAcceptanceChallenge(TENANT);
        const input = {
            tenantId: TENANT,
            kind: 'nequi' as const,
            token: 'token-1',
            customerEmail: 'owner@tenant.co',
            consentId: challenge.consentId,
            acceptEndUserPolicy: true,
            acceptPersonalDataAuth: true,
            acceptedIp: '203.0.113.7',
            acceptedByUserId: 'user-1',
            acceptedByEmail: 'owner@tenant.co',
        };

        await expect(service.addPaymentSource(input)).resolves.toMatchObject({
            id: 'source-1', status: 'pending_auth', requiresAuthorization: true,
        });
        expect(charging.startPaymentSource).toHaveBeenCalledWith(expect.objectContaining({
            acceptance: contracts,
        }));
        expect(prisma.billingPaymentSource.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                acceptanceJti: 'policy-jit',
                acceptanceFileHash: 'policy-v7',
                acceptedIp: '203.0.113.7',
                metadata: expect.objectContaining({
                    consent: expect.objectContaining({
                        consentId: challenge.consentId,
                        endUserPolicy: expect.objectContaining({ fileHash: 'policy-v7', accepted: true }),
                        personalDataAuth: expect.objectContaining({ fileHash: 'personal-v3', accepted: true }),
                        acceptedByUserId: 'user-1',
                    }),
                }),
            }),
        }));

        await expect(service.addPaymentSource(input)).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'acceptance_challenge_invalid' }),
        });
        expect(charging.startPaymentSource).toHaveBeenCalledTimes(1);
    });

    it('never mutates a provider source that belongs to another tenant', async () => {
        const { service, prisma } = harness();
        const challenge = await service.issueAcceptanceChallenge(TENANT);
        prisma.billingPaymentSource.findUnique.mockResolvedValue({
            id: 'foreign-source',
            tenantId: '99999999-9999-4999-8999-999999999999',
            provider: 'wompi',
            providerSourceId: 'pending:nequi:token-1',
            metadata: { untouched: true },
        });

        await expect(service.addPaymentSource({
            tenantId: TENANT,
            kind: 'nequi',
            token: 'token-1',
            customerEmail: 'owner@tenant.co',
            consentId: challenge.consentId,
            acceptEndUserPolicy: true,
            acceptPersonalDataAuth: true,
        })).rejects.toMatchObject({
            status: 409,
            response: expect.objectContaining({ error: 'payment_source_owner_conflict' }),
        });
        expect(prisma.billingPaymentSource.update).not.toHaveBeenCalled();
        expect(prisma.billingPaymentSource.create).not.toHaveBeenCalled();
    });

    it('finishes an approved token from the webhook even when the browser stopped polling', async () => {
        const { service } = harness();
        const poll = jest.spyOn(service, 'pollAuthorization').mockResolvedValue({ status: 'available' } as any);
        await service.onPaymentMethodAuthorized({
            event: {
                provider: 'wompi',
                type: 'billing.payment_method.authorized',
                providerEventId: 'nequi_token.updated.token-1.APPROVED',
                occurredAt: new Date(),
                rawPayload: { data: { nequi_token: { id: 'token-1', status: 'APPROVED' } } },
            } as any,
        });
        expect(poll).toHaveBeenCalledWith(TENANT, 'source-1');
    });

    it('marks a declined Bancolombia token without waiting for a UI request', async () => {
        const { service, prisma } = harness();
        await service.onPaymentMethodDeclined({
            event: {
                provider: 'wompi',
                type: 'billing.payment_method.declined',
                providerEventId: 'bancolombia_transfer_token.updated.token-1.DECLINED',
                occurredAt: new Date(),
                rawPayload: {
                    data: { bancolombia_transfer_token: { id: 'token-1', status: 'DECLINED' } },
                },
            } as any,
        });
        expect(prisma.billingPaymentSource.updateMany).toHaveBeenCalledWith({
            where: { id: 'source-1', status: 'pending_auth' },
            data: { status: 'declined', authUrl: null },
        });
    });

    it('recovers on the durable sweep when the asynchronous webhook listener failed', async () => {
        const { service } = harness();
        const poll = jest.spyOn(service, 'pollAuthorization')
            .mockRejectedValueOnce(new Error('temporary provider outage'))
            .mockResolvedValueOnce({ status: 'available' } as any);
        const payload = {
            event: {
                provider: 'wompi',
                rawPayload: { data: { nequi_token: { id: 'token-1', status: 'APPROVED' } } },
            } as any,
        };

        await expect(service.onPaymentMethodAuthorized(payload)).rejects.toThrow('temporary provider outage');
        await expect(service.reconcilePendingAuthorizations()).resolves.toEqual({
            scanned: 1,
            completed: 1,
            failed: 0,
        });
        expect(poll).toHaveBeenCalledTimes(2);
    });

    it('moves past 20 still-pending tokens and reaches a later completed authorization', async () => {
        const { service, prisma } = harness();
        const firstPage = Array.from({ length: 20 }, (_, index) => ({
            id: `source-pending-${index}`,
            tenantId: TENANT,
            metadata: {},
            pendingCheckCount: 0,
        }));
        prisma.$queryRawUnsafe
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce([{
                id: 'source-ready', tenantId: TENANT, metadata: {}, pendingCheckCount: 0,
            }]);
        jest.spyOn(service, 'pollAuthorization').mockImplementation(async (_tenantId, sourceId) => ({
            status: sourceId === 'source-ready' ? 'available' : 'pending_auth',
        } as any));

        await expect(service.reconcilePendingAuthorizations()).resolves.toEqual({
            scanned: 21,
            completed: 1,
            failed: 0,
        });
        expect(prisma.billingPaymentSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ status: 'pending_auth' }),
            data: expect.objectContaining({
                metadata: expect.objectContaining({ authPollNextAt: expect.any(String) }),
            }),
        }));
    });

    it('refuses an ambiguous token shared by multiple pending tenant rows', async () => {
        const { service, prisma } = harness();
        prisma.billingPaymentSource.findMany.mockResolvedValueOnce([
            { id: 'source-1', tenantId: TENANT },
            { id: 'source-2', tenantId: '99999999-9999-4999-8999-999999999999' },
        ]);
        const poll = jest.spyOn(service, 'pollAuthorization');
        await expect(service.onPaymentMethodAuthorized({
            event: {
                provider: 'wompi',
                rawPayload: { data: { nequi_token: { id: 'token-1' } } },
            } as any,
        })).rejects.toThrow('ambiguous_payment_source_auth_token');
        expect(poll).not.toHaveBeenCalled();
    });
});
