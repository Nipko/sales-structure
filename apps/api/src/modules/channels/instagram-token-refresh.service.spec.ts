import { InstagramTokenRefreshService } from './instagram-token-refresh.service';

describe('InstagramTokenRefreshService durable provider boundary', () => {
    const account = {
        id: 'c3cf6b42-784f-4c86-a2ba-1c1ca43db879',
        tenantId: '668850d7-692e-4ef8-b6af-440a07557ad8',
        accountId: 'ig-account-1',
        accessToken: 'encrypted-old',
        metadata: { tokenExpiresAt: '2026-09-14T00:00:00.000Z' },
    };

    let order: string[];
    let executeCalls: Array<{ sql: string; params: any[] }>;
    let claimGranted: boolean;
    let prisma: any;
    let service: InstagramTokenRefreshService;
    let fetchMock: jest.Mock;

    beforeEach(() => {
        order = [];
        executeCalls = [];
        claimGranted = true;
        fetchMock = jest.fn();
        (global as any).fetch = fetchMock;

        const execute = async (sql: string, ...params: any[]) => {
            executeCalls.push({ sql, params });
            if (sql.includes("SET token_refresh_state = 'failed'")) {
                order.push('outcome:failed');
                return 1;
            }
            if (sql.includes("token_refresh_state = 'sending'")) {
                order.push('sending');
                return 1;
            }
            if (sql.includes('token_refresh_state = $3')) order.push(`outcome:${params[2]}`);
            return 1;
        };
        prisma = {
            channelAccount: { findMany: jest.fn().mockResolvedValue([account]) },
            whatsappCredential: { findFirst: jest.fn().mockResolvedValue(null) },
            $queryRawUnsafe: jest.fn(async () => {
                order.push('claim');
                return claimGranted ? [{ id: account.id }] : [];
            }),
            $executeRawUnsafe: jest.fn(execute),
            $transaction: jest.fn(async (work: (tx: any) => Promise<void>) => work({
                $executeRawUnsafe: jest.fn(async (sql: string, ...params: any[]) => {
                    executeCalls.push({ sql, params });
                    order.push('settle');
                    return 1;
                }),
                whatsappCredential: {
                    updateMany: jest.fn(async () => { order.push('legacy-receipt'); }),
                },
            })),
        };
        service = new InstagramTokenRefreshService(
            prisma,
            {
                decryptToken: jest.fn().mockReturnValue('old-token'),
                encryptToken: jest.fn().mockReturnValue('encrypted-new'),
            } as any,
            { invalidateCache: jest.fn().mockResolvedValue(undefined) } as any,
            {} as any,
            { emit: jest.fn() } as any,
        );
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('claims and marks sending before Meta, then commits the token as its durable receipt', async () => {
        fetchMock.mockImplementation(async () => {
            order.push('provider');
            return { json: async () => ({ access_token: 'new-token', expires_in: 5_184_000 }) };
        });

        await service.refreshExpiringSoonTokens();

        expect(order).toEqual(['claim', 'sending', 'provider', 'settle', 'legacy-receipt']);
        const settlement = executeCalls.find(call => call.sql.includes('access_token = $3'));
        expect(settlement?.params.slice(0, 3)).toEqual([
            account.id,
            expect.any(String),
            'encrypted-new',
        ]);
        expect(settlement?.sql).toContain("token_refresh_state = 'sending'");
        expect(settlement?.sql).toContain('token_refresh_lease_token = $2::uuid');
    });

    it('does not call Meta when another worker owns the account lease', async () => {
        claimGranted = false;

        await service.refreshExpiringSoonTokens();

        expect(order).toEqual(['claim']);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('records an unknown outcome when the request may have left without an answer', async () => {
        fetchMock.mockImplementation(async () => {
            order.push('provider');
            throw new Error('socket closed');
        });

        await service.refreshExpiringSoonTokens();

        expect(order).toEqual(['claim', 'sending', 'provider', 'outcome:unknown']);
        const outcome = executeCalls.find(call => call.sql.includes('token_refresh_state = $3'));
        expect(outcome?.params[2]).toBe('unknown');
        expect(outcome?.params[3]).toBe('socket closed');
    });

    it('records a conclusive provider refusal as failed and releases the lease', async () => {
        fetchMock.mockImplementation(async () => {
            order.push('provider');
            return { json: async () => ({ error: { code: 190 } }) };
        });

        await service.refreshExpiringSoonTokens();

        expect(order).toEqual(['claim', 'sending', 'provider', 'outcome:failed']);
        const refusal = executeCalls.find(call => call.sql.includes("token_refresh_state = 'failed'"));
        expect(refusal?.sql).toContain('token_refresh_lease_token = NULL');
        expect(refusal?.params).toEqual([account.id, expect.any(String)]);
    });
});
