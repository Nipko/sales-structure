import { TenantBoardRepository, CORE_STATEMENT_TIMEOUT_MS, VOLUME_STATEMENT_TIMEOUT_MS } from './tenant-board.repository';

type Responder = (sql: string, params: any[]) => any;

/** Prisma falso: cada transacción recibe un `query` que responde por patrón de SQL y registra lo ejecutado. */
function prismaWith(tables: Record<string, boolean>, responders: Array<[RegExp, Responder]>, opts: { failVolume?: boolean } = {}) {
    const log: Array<{ tx: number; sql: string; params: any[] }> = [];
    let tx = 0;
    const prisma = {
        assertTenantSchemaName: jest.fn((name: string) => {
            if (!/^tenant_[a-z0-9_]+$/.test(name)) throw new Error('Invalid schema name');
        }),
        $queryRawUnsafe: jest.fn(async (sql: string, ...params: any[]): Promise<any[]> => {
            log.push({ tx: 0, sql, params });
            return [];
        }),
        transactionInTenantSchema: jest.fn(async (schema: string, callback: (query: any) => Promise<any>) => {
            const id = ++tx;
            const query = async (sql: string, params: any[] = []) => {
                log.push({ tx: id, sql, params });
                if (/set_config\('statement_timeout'/.test(sql)) return [{ statement_timeout: params[0] }];
                if (/to_regclass\(format/.test(sql)) return [tables];
                if (/current_schema\(\) AS schema/.test(sql)) return [{ schema, outbox: tables.agent_dispatch_outbox ? `${schema}.agent_dispatch_outbox` : null }];
                if (opts.failVolume && /FROM messages/.test(sql)) throw new Error('canceling statement due to statement timeout');
                for (const [pattern, respond] of responders) if (pattern.test(sql)) return respond(sql, params);
                return [];
            };
            return callback(query);
        }),
    };
    return { prisma, log };
}

const ALL = {
    readiness_evaluations: true, agent_personas: true, agent_publication_heads: true, agent_turn_ledger: true,
    messages: true, conversations: true, whatsapp_channels: true, agent_dispatch_outbox: true,
};
const NONE = Object.fromEntries(Object.keys(ALL).map(key => [key, false]));

describe('TenantBoardRepository.readTenantSchema', () => {
    it('reads every section from a fully migrated tenant, each transaction capped by statement_timeout', async () => {
        const { prisma, log } = prismaWith(ALL, [
            [/FROM readiness_evaluations/, () => [{
                verdict: 'no_listo', counts: { blockingFailing: 2, necessaryFailing: 1 },
                blocking_gaps: ['a', 'b', 'c', 'd', 'e', 'f'], coverage: '55.5', created_at: new Date('2026-11-06T00:00:00Z'),
            }]],
            [/FROM agent_personas$/, () => [{ active: 2, total: 3 }]],
            [/FROM agent_publication_heads/, () => [{ published: 1 }]],
            [/FROM whatsapp_channels/, () => [{ phone_number_id: '555' }]],
            [/delivery_state IN \('pending', 'unknown', 'failed'\)/, () => [{ pending: 3, unknown: 1, failed: 2, stuck: 1 }]],
            [/FROM agent_dispatch_outbox/, () => [{ total: 2, oldest: 4000, breaching: 1, stalled: 0, stalled_oldest: 0 }]],
            [/FROM messages/, () => [{ inbound: 7, outbound: 8, last_inbound: new Date('2026-11-06T10:00:00Z') }]],
            [/FROM conversations/, () => [{ conversations: 4 }]],
            [/COUNT\(\*\)::int AS total,/, () => [{ total: 12, delivered: 9, last_delivered: '2026-11-06T11:00:00Z' }]],
        ]);
        const facts = await new TenantBoardRepository(prisma as any).readTenantSchema('tenant_alpha', { readLegacyWhatsApp: true });

        expect(facts.readiness).toEqual({
            value: {
                verdict: 'no_listo', blockingFailing: 2, necessaryFailing: 1, coveragePct: 55.5,
                blockingGaps: ['a', 'b', 'c', 'd', 'e'], evaluatedAt: '2026-11-06T00:00:00.000Z',
            },
            error: null,
        });
        expect(facts.agents.value).toEqual({ active: 2, total: 3, published: 1 });
        expect(facts.legacyWhatsApp.value).toEqual(['555']);
        expect(facts.dispatch.value).toEqual({ reconciliationRequired: 2, reconciliationOverdue: 1, stalled: 0 });
        expect(facts.delivery.value).toEqual({
            pending: 3, unknown: 1, failed: 2, stuck: 1, delivered: 9, total: 12, lastDeliveredAt: '2026-11-06T11:00:00.000Z',
        });
        expect(facts.volume.value).toEqual({ inbound: 7, outbound: 8, conversations: 4, lastInboundAt: '2026-11-06T10:00:00.000Z' });

        // Dos transacciones, cada una abre con su tope.
        const timeouts = log.filter(entry => /statement_timeout/.test(entry.sql));
        expect(timeouts.map(entry => [entry.tx, entry.params[0]])).toEqual([
            [1, String(CORE_STATEMENT_TIMEOUT_MS)], [2, String(VOLUME_STATEMENT_TIMEOUT_MS)],
        ]);
        expect(log.filter(entry => entry.tx === 1)[0].sql).toMatch(/statement_timeout/);
        expect(log.filter(entry => entry.tx === 2)[0].sql).toMatch(/statement_timeout/);
        // Sólo lecturas: nada de DDL ni escrituras.
        for (const entry of log) expect(entry.sql).not.toMatch(/^\s*(CREATE|ALTER|INSERT|UPDATE|DELETE|DROP)\b/i);
    });

    it('a tenant with no tables answers empty sections without querying them', async () => {
        const { prisma, log } = prismaWith(NONE, []);
        const facts = await new TenantBoardRepository(prisma as any).readTenantSchema('tenant_fresh', { readLegacyWhatsApp: true });
        expect(facts.readiness).toEqual({ value: null, error: null });
        expect(facts.agents).toEqual({ value: { active: 0, total: 0, published: null }, error: null });
        expect(facts.delivery).toEqual({ value: null, error: null });
        expect(facts.dispatch.value).toEqual({ reconciliationRequired: 0, reconciliationOverdue: 0, stalled: 0 });
        expect(facts.volume.value).toEqual({ inbound: 0, outbound: 0, conversations: 0, lastInboundAt: null });
        expect(facts.legacyWhatsApp.value).toEqual([]);
        expect(log.some(entry => /FROM (readiness_evaluations|agent_personas|agent_turn_ledger|messages|whatsapp_channels)/.test(entry.sql))).toBe(false);
    });

    it('a volume timeout loses only the volume section', async () => {
        const { prisma } = prismaWith(ALL, [
            [/FROM agent_personas$/, () => [{ active: 1, total: 1 }]],
            [/FROM agent_dispatch_outbox/, () => [{ total: 0 }]],
        ], { failVolume: true });
        const facts = await new TenantBoardRepository(prisma as any).readTenantSchema('tenant_alpha', { readLegacyWhatsApp: false });
        expect(facts.volume).toEqual({ value: null, error: 'canceling statement due to statement timeout' });
        expect(facts.agents.error).toBeNull();
        expect(facts.dispatch.error).toBeNull();
    });

    it('when the core transaction cannot open, every section carries the error', async () => {
        const { prisma } = prismaWith(ALL, []);
        prisma.transactionInTenantSchema.mockRejectedValue(new Error('Transaction API error: timeout'));
        const facts = await new TenantBoardRepository(prisma as any).readTenantSchema('tenant_alpha', { readLegacyWhatsApp: false });
        for (const key of ['readiness', 'agents', 'delivery', 'dispatch', 'volume', 'legacyWhatsApp'] as const) {
            expect(facts[key].value).toBeNull();
            expect(facts[key].error).toBe('Transaction API error: timeout');
        }
    });

    it('refuses a schema name that is not a tenant schema', async () => {
        const { prisma } = prismaWith(ALL, []);
        await expect(new TenantBoardRepository(prisma as any).readTenantSchema('public; drop', { readLegacyWhatsApp: false }))
            .rejects.toThrow('Invalid schema name');
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });
});

describe('TenantBoardRepository public reads', () => {
    it('never selects the channel access token itself', async () => {
        const { prisma, log } = prismaWith(ALL, []);
        await new TenantBoardRepository(prisma as any).channelAccounts();
        const sql = log[0].sql;
        expect(sql).toMatch(/access_token IS NOT NULL/);
        expect(sql).not.toMatch(/SELECT[^;]*\baccess_token\s*,/);
        expect(sql).not.toMatch(/refresh_token|webhook_secret/);
    });

    it('tool usage only counts live mode within the window', async () => {
        const { prisma } = prismaWith(ALL, []);
        prisma.$queryRawUnsafe.mockResolvedValueOnce([{ tenant_id: 't', calls: BigInt(5), errors: '2', blocked: null, last_error_code: null }]);
        const rows = await new TenantBoardRepository(prisma as any).toolUsage();
        expect(rows).toEqual([{ tenant_id: 't', calls: 5, errors: 2, blocked: 0, last_error_code: null }]);
        const [sql, days] = prisma.$queryRawUnsafe.mock.calls[0];
        expect(sql).toMatch(/mode = 'live'/);
        expect(days).toBe(7);
    });
});
