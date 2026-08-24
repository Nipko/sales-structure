import { ChannelManagerService } from './channel-manager.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SCHEMA = 'tenant_hostaway';

function build() {
    const queries: Array<{ sql: string; params: any[] }> = [];
    const query = jest.fn(async (sql: string, params: any[] = []) => {
        queries.push({ sql, params });
        if (/INSERT INTO cm_reservations/.test(sql)) return [{ id: 'reservation' }];
        return [];
    });
    const prisma: any = {
        tenant: { findUnique: jest.fn().mockResolvedValue({ schemaName: SCHEMA }) },
        assertTenantSchemaName: jest.fn(),
        executeInTenantSchema: jest.fn().mockResolvedValue([]),
        $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: 1 }]),
        transactionInTenantSchema: jest.fn(async (_schema: string, run: any) => run(query)),
    };
    const http: any = { axiosRef: { get: jest.fn(), post: jest.fn() } };
    const service = new ChannelManagerService(
        prisma,
        { get: jest.fn(), set: jest.fn(), del: jest.fn() } as any,
        http,
        { encrypt: jest.fn(), decrypt: jest.fn() } as any,
    );
    jest.spyOn(service, 'getConfig').mockResolvedValue({
        provider: 'hostaway', accountId: 'account', apiSecret: 'secret',
        syncInterval: 60, autoBlock: true,
    });
    jest.spyOn(service, 'ensureTables').mockResolvedValue(undefined);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    return { service, prisma, http, query, queries };
}

describe('Hostaway sync completo, atómico y no destructivo', () => {
    it('pagina por offset y publica listings/reservations/tombstones en una transacción', async () => {
        const { service, prisma, http, queries } = build();
        http.axiosRef.post.mockResolvedValue({ data: { access_token: 'token' } });
        const firstListings = Array.from({ length: 100 }, (_, i) => ({
            id: i + 1, name: `Listing ${i + 1}`,
        }));
        http.axiosRef.get.mockImplementation(async (url: string, options: any) => {
            if (url.endsWith('/listings')) {
                return options.params.offset === 0
                    ? { data: { result: firstListings, count: 101 } }
                    : { data: { result: [{ id: 101, name: 'Last listing' }], count: 101 } };
            }
            return {
                data: {
                    result: [{
                        id: 'r1', listingMapId: 1, arrivalDate: '2026-09-01', departureDate: '2026-09-02',
                    }],
                    count: 1,
                },
            };
        });

        await expect(service.syncHostaway(TENANT_ID)).resolves.toEqual({ listings: 101, reservations: 1 });

        const listingCalls = http.axiosRef.get.mock.calls.filter(([url]: [string]) => url.endsWith('/listings'));
        expect(listingCalls.map((call: any[]) => call[1].params.offset)).toEqual([0, 100]);
        expect(prisma.transactionInTenantSchema).toHaveBeenCalledWith(
            SCHEMA, expect.any(Function), { timeout: 120_000 },
        );
        expect(queries.filter(q => /INSERT INTO cm_listings/.test(q.sql))).toHaveLength(101);
        expect(queries.some(q => /UPDATE cm_reservations/.test(q.sql))).toBe(true);
        expect(queries.some(q => /UPDATE cm_listings/.test(q.sql))).toBe(true);
    });

    it('si falla cualquier página, no muta ni tombstonea el espejo', async () => {
        const { service, prisma, http } = build();
        http.axiosRef.post.mockResolvedValue({ data: { access_token: 'token' } });
        http.axiosRef.get
            .mockResolvedValueOnce({ data: { result: [{ id: 1, name: 'One' }], count: 1 } })
            .mockRejectedValueOnce(new Error('reservations unavailable'));

        await expect(service.syncHostaway(TENANT_ID)).rejects.toThrow('reservations unavailable');
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('test connection sólo autentica y lee una fila, sin tocar el mirror', async () => {
        const { service, prisma, http } = build();
        http.axiosRef.post.mockResolvedValue({ data: { access_token: 'token' } });
        http.axiosRef.get.mockResolvedValue({ data: { result: [] } });

        await expect(service.testHostawayConnection(TENANT_ID)).resolves.toEqual({
            ok: true, provider: 'hostaway', reachable: true,
        });
        expect(http.axiosRef.get).toHaveBeenCalledWith(
            'https://api.hostaway.com/v1/listings',
            expect.objectContaining({ params: { limit: 1, offset: 0 } }),
        );
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });
});
