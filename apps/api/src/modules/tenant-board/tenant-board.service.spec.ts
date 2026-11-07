import {
    BOARD_CACHE_TTL_MS,
    BOARD_MIN_REFRESH_MS,
    BOARD_SCHEMA_CONCURRENCY,
    TenantBoardService,
    boardChannels,
} from './tenant-board.service';
import type { BoardTenantRecord, TenantBoardRepository, TenantSchemaFacts } from './tenant-board.repository';

const tenant = (id: string, schemaName: string, over: Partial<BoardTenantRecord> = {}): BoardTenantRecord => ({
    id, name: id.toUpperCase(), slug: id, industry: 'health', plan: 'pro', schemaName,
    isActive: true, isInternal: false, settings: { subType: 'dental' }, subscriptionStatus: 'active',
    goLiveState: 'on', goLiveAt: new Date('2026-11-01T00:00:00Z'), onboardingCompletedAt: new Date('2026-10-01T00:00:00Z'),
    firstChannelConnectedAt: null, firstMessageAt: null, createdAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
});

const okFacts = (): TenantSchemaFacts => ({
    readiness: { value: { verdict: 'listo', blockingFailing: 0, necessaryFailing: 0, coveragePct: 80, blockingGaps: [], evaluatedAt: null }, error: null },
    agents: { value: { active: 1, total: 1, published: 1 }, error: null },
    delivery: { value: { pending: 0, unknown: 0, failed: 0, stuck: 0, delivered: 9, total: 9, lastDeliveredAt: null }, error: null },
    dispatch: { value: { reconciliationRequired: 0, reconciliationOverdue: 0, stalled: 0 }, error: null },
    volume: { value: { inbound: 9, outbound: 9, conversations: 3, lastInboundAt: null }, error: null },
    legacyWhatsApp: { value: [], error: null },
});

function repository(over: Partial<Record<keyof TenantBoardRepository, jest.Mock>> = {}) {
    const repo = {
        listTenants: jest.fn().mockResolvedValue([
            tenant('a1', 'tenant_alpha'),
            tenant('b2', 'tenant_beta'),
            tenant('e3', 'tenant_eval_alpha_1'),
            tenant('g4', 'tenant_gone'),
        ]),
        existingSchemas: jest.fn(async (names: string[]) => new Set(names.filter(name => name !== 'tenant_gone'))),
        channelAccounts: jest.fn().mockResolvedValue([
            { tenant_id: 'A1', channel_type: 'telegram', account_id: 'x', display_name: 'Bot', has_token: true, token_expires_at: null, token_refresh_state: 'idle', token_refresh_error: null, created_at: '2026-10-02T00:00:00Z' },
        ]),
        latestCredentials: jest.fn().mockResolvedValue([]),
        activeWidgets: jest.fn().mockResolvedValue(new Map([['b2', 1]])),
        toolUsage: jest.fn().mockResolvedValue([{ tenant_id: 'a1', calls: 30, errors: 9, blocked: 0, last_error_code: 'timeout' }]),
        readTenantSchema: jest.fn(async () => okFacts()),
        ...over,
    };
    return repo;
}

const build = (repo: ReturnType<typeof repository>) => new TenantBoardService(repo as unknown as TenantBoardRepository);

describe('TenantBoardService', () => {
    it('skips eval replicas and missing schemas, and never reads them', async () => {
        const repo = repository();
        const data = await build(repo).getBoard();
        expect(data.tenants.map(row => row.tenantId)).toEqual(['a1', 'b2']);
        expect(data.skipped).toEqual({ evalReplicas: 1, missingSchemas: 1 });
        expect(repo.existingSchemas).toHaveBeenCalledWith(['tenant_alpha', 'tenant_beta', 'tenant_gone']);
        expect(repo.readTenantSchema.mock.calls.map(call => call[0])).toEqual(['tenant_alpha', 'tenant_beta']);
    });

    it('joins public facts by tenant id regardless of case and computes each status', async () => {
        const data = await build(repository()).getBoard();
        const [alpha, beta] = data.tenants;
        expect(alpha.channels).toEqual([expect.objectContaining({ type: 'telegram', health: 'ok', displayName: 'Bot' })]);
        expect(alpha.subtype).toBe('dental');
        // 9/30 = 30% de error en vivo con 30 llamadas.
        expect(alpha.tools).toMatchObject({ calls: 30, errors: 9, lastErrorCode: 'timeout' });
        expect(alpha.status).toBe('critico');
        expect(alpha.reasons[0].code).toBe('tool_error_rate_high');
        // beta sólo tiene el widget y no usó tools: sano, con uso en cero.
        expect(beta.widgets).toBe(1);
        expect(beta.tools).toMatchObject({ calls: 0, errors: 0 });
        expect(beta.status).toBe('ok');
        expect(data.summary).toMatchObject({ total: 2, live: 2, byStatus: { ok: 1, atencion: 0, critico: 1, error: 0 } });
    });

    it('a tenant whose schema read throws shows error and the page still answers', async () => {
        const repo = repository({
            readTenantSchema: jest.fn(async (schema: string) => {
                if (schema === 'tenant_beta') throw new Error('connection reset');
                return okFacts();
            }),
        });
        const data = await build(repo).getBoard();
        const beta = data.tenants.find(row => row.tenantId === 'b2')!;
        expect(beta.status).toBe('error');
        expect(beta.error).toBe('connection reset');
        expect(beta.reasons).toEqual([{ code: 'tenant_unreadable', severity: 'critico', params: { error: 'connection reset' } }]);
        expect(data.summary.byStatus.error).toBe(1);
    });

    it('a failed section (missing table, timeout) is partial data, never a zero', async () => {
        const facts = okFacts();
        facts.volume = { value: null, error: 'canceling statement due to statement timeout' };
        facts.readiness = { value: null, error: 'boom' };
        const repo = repository({ readTenantSchema: jest.fn(async () => facts) });
        const [alpha] = (await build(repo).getBoard()).tenants;
        expect(alpha.volume).toBeNull();
        expect(alpha.sectionErrors).toEqual(['readiness', 'volume']);
        expect(alpha.reasons.map(reason => reason.code)).toContain('partial_data');
        expect(alpha.reasons.map(reason => reason.code)).not.toContain('no_inbound_while_live');
        expect(alpha.reasons.map(reason => reason.code)).not.toContain('readiness_missing');
    });

    it('an unreadable public source is reported once, and does not invent per-tenant problems', async () => {
        const repo = repository({
            toolUsage: jest.fn().mockRejectedValue(new Error('relation "platform_tool_usage_daily" does not exist')),
            channelAccounts: jest.fn().mockRejectedValue(new Error('down')),
        });
        const data = await build(repo).getBoard();
        expect(data.unavailable.sort()).toEqual(['channel_accounts', 'platform_tool_usage_daily']);
        for (const row of data.tenants) {
            expect(row.tools).toBeNull();
            expect(row.reasons.map(reason => reason.code)).not.toContain('no_channel');
            expect(row.sectionErrors).toContain('channels');
        }
    });

    it('only asks for legacy WhatsApp tokens when the tenant has a WhatsApp account', async () => {
        const repo = repository({
            channelAccounts: jest.fn().mockResolvedValue([
                { tenant_id: 'b2', channel_type: 'whatsapp', account_id: '555', display_name: 'WA', has_token: false, token_expires_at: null, token_refresh_state: null, token_refresh_error: null, created_at: null },
            ]),
        });
        await build(repo).getBoard();
        expect(repo.readTenantSchema).toHaveBeenCalledWith('tenant_alpha', { readLegacyWhatsApp: false });
        expect(repo.readTenantSchema).toHaveBeenCalledWith('tenant_beta', { readLegacyWhatsApp: true });
    });

    it(`reads at most ${BOARD_SCHEMA_CONCURRENCY} schemas at a time`, async () => {
        const many = Array.from({ length: 11 }, (_, index) => tenant(`t${index}`, `tenant_t${index}`));
        let inFlight = 0;
        let peak = 0;
        const repo = repository({
            listTenants: jest.fn().mockResolvedValue(many),
            readTenantSchema: jest.fn(async () => {
                inFlight += 1;
                peak = Math.max(peak, inFlight);
                await new Promise(resolve => setTimeout(resolve, 2));
                inFlight -= 1;
                return okFacts();
            }),
        });
        const data = await build(repo).getBoard();
        expect(data.tenants).toHaveLength(11);
        expect(peak).toBeLessThanOrEqual(BOARD_SCHEMA_CONCURRENCY);
    });

    describe('cache', () => {
        it('serves the cached board within the TTL and rebuilds after it', async () => {
            const repo = repository();
            const service = build(repo);
            let now = 1_000_000;
            service.clock = () => now;

            expect((await service.getBoard()).cached).toBe(false);
            now += BOARD_CACHE_TTL_MS - 1;
            expect((await service.getBoard()).cached).toBe(true);
            expect(repo.listTenants).toHaveBeenCalledTimes(1);

            now += 2;
            expect((await service.getBoard()).cached).toBe(false);
            expect(repo.listTenants).toHaveBeenCalledTimes(2);
        });

        it('an explicit refresh rebuilds only once the minimum interval passed', async () => {
            const repo = repository();
            const service = build(repo);
            let now = 5_000_000;
            service.clock = () => now;

            await service.getBoard();
            now += BOARD_MIN_REFRESH_MS - 1;
            expect((await service.getBoard({ refresh: true })).cached).toBe(true);
            now += 2;
            expect((await service.getBoard({ refresh: true })).cached).toBe(false);
            expect(repo.listTenants).toHaveBeenCalledTimes(2);
        });

        it('concurrent requests share one build', async () => {
            const repo = repository();
            const service = build(repo);
            const [first, second] = await Promise.all([service.getBoard(), service.getBoard()]);
            expect(first.tenants).toHaveLength(2);
            expect(second.tenants).toHaveLength(2);
            expect(repo.listTenants).toHaveBeenCalledTimes(1);
        });

        it('a failed build is not cached', async () => {
            const repo = repository({
                listTenants: jest.fn()
                    .mockRejectedValueOnce(new Error('db down'))
                    .mockResolvedValue([tenant('a1', 'tenant_alpha')]),
            });
            const service = build(repo);
            await expect(service.getBoard()).rejects.toThrow('db down');
            expect((await service.getBoard()).tenants).toHaveLength(1);
        });
    });
});

describe('boardChannels', () => {
    const account = { tenant_id: 't', account_id: '555', display_name: 'WA', has_token: false, token_expires_at: null, token_refresh_state: null, token_refresh_error: null, created_at: null };

    it('a WhatsApp number without a system-user credential is missing, unless a legacy token rescues it', () => {
        const base = { accounts: [{ ...account, channel_type: 'whatsapp' }], credentials: [], now: Date.parse('2026-11-07T00:00:00Z') };
        expect(boardChannels({ ...base, legacyWhatsApp: [] })[0].health).toBe('missing');
        expect(boardChannels({ ...base, legacyWhatsApp: ['555'] })[0].health).toBe('ok');
    });

    it('an unreadable credential table is unknown, never a failure', () => {
        const [row] = boardChannels({ accounts: [{ ...account, channel_type: 'whatsapp' }], credentials: null, legacyWhatsApp: [], now: 0 });
        expect(row.health).toBe('unknown');
    });

    it('an Instagram token past tokenExpiresAt is expired', () => {
        const [row] = boardChannels({
            accounts: [{ ...account, channel_type: 'instagram', has_token: true, token_expires_at: '2026-11-01T00:00:00Z', token_refresh_error: 'refresh_failed' }],
            credentials: [], legacyWhatsApp: [], now: Date.parse('2026-11-07T00:00:00Z'),
        });
        expect(row).toMatchObject({ health: 'expired', lastError: 'refresh_failed' });
    });
});
