import { VerticalIntegrationsService } from './vertical-integrations.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SCHEMA = 'tenant_pagination';

function build() {
    const txQueries: Array<{ sql: string; params: any[] }> = [];
    const query = jest.fn(async (sql: string, params: any[] = []) => {
        txQueries.push({ sql, params });
        return [];
    });
    const prisma: any = {
        tenant: { findUnique: jest.fn(), findMany: jest.fn() },
        getTenantSchemaName: jest.fn().mockResolvedValue(SCHEMA),
        assertTenantSchemaName: jest.fn(),
        executeInTenantSchema: jest.fn().mockResolvedValue([]),
        transactionInTenantSchema: jest.fn(async (_schema: string, run: any) => run(query)),
    };
    const http: any = { axiosRef: { get: jest.fn(), post: jest.fn() } };
    const service = new VerticalIntegrationsService(
        prisma,
        { get: jest.fn(), set: jest.fn(), del: jest.fn() } as any,
        http,
        { runExclusive: jest.fn() } as any,
        { get: jest.fn().mockReturnValue('') } as any,
        { encrypt: jest.fn(), decrypt: jest.fn() } as any,
    );
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(service as any, 'prepareProviderEndpoint').mockImplementation(
        async (_provider: string, value: string) => ({ baseUrl: value, target: {} }),
    );
    return { service, prisma, http, query, txQueries };
}

const toastItem = (id: number) => ({ guid: `toast-${id}`, name: `Item ${id}`, price: 10 });
const menuPage = (items: any[], nextPageToken?: string) => ({
    data: {
        menus: [{ name: 'Menu', menuGroups: [{ name: 'Group', menuItems: items }] }],
        nextPageToken,
    },
    headers: {},
});

describe('paginación completa de espejos verticales', () => {
    it('sigue el cursor Toast y devuelve todas las páginas antes de persistir', async () => {
        const { service, http, prisma } = build();
        jest.spyOn(service as any, 'toastToken').mockResolvedValue('token');
        http.axiosRef.get
            .mockResolvedValueOnce(menuPage([toastItem(1)], 'next-2'))
            .mockResolvedValueOnce(menuPage([toastItem(2)]));

        const result = await (service as any).syncToast({
            hostname: 'https://toast.example', locationGuid: 'location',
        });

        expect(result.synced).toBe(2);
        expect(result.items.map((item: any) => item.externalId)).toEqual(['toast-1', 'toast-2']);
        expect(http.axiosRef.get.mock.calls[0][1].params).toBeUndefined();
        expect(http.axiosRef.get.mock.calls[1][1].params).toEqual({ pageToken: 'next-2' });
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('avanza Limit/Offset en Mindbody hasta TotalResults', async () => {
        const { service, http } = build();
        const first = Array.from({ length: 200 }, (_, i) => ({
            Id: i + 1, ClassDescription: { Name: `Class ${i + 1}` },
        }));
        http.axiosRef.get
            .mockResolvedValueOnce({ data: { Classes: first, PaginationResponse: { TotalResults: 201 } } })
            .mockResolvedValueOnce({ data: { Classes: [{ Id: 201 }], PaginationResponse: { TotalResults: 201 } } });

        const result = await (service as any).syncMindbody({ apiKey: 'k', siteId: 's' });

        expect(result.synced).toBe(201);
        expect(http.axiosRef.get.mock.calls.map((call: any[]) => call[1].params.Offset)).toEqual([0, 200]);
    });

    it('sigue links.next de Cliniko y termina con la última página corta', async () => {
        const { service, http } = build();
        const first = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `Type ${i + 1}` }));
        http.axiosRef.get
            .mockResolvedValueOnce({ data: { appointment_types: first, links: { next: 'page-2' } } })
            .mockResolvedValueOnce({ data: { appointment_types: [{ id: 101, name: 'Last' }], links: {} } });

        const result = await (service as any).syncCliniko({
            apiKey: 'k', baseUrl: 'https://api.au1.cliniko.com/v1',
        });

        expect(result.synced).toBe(101);
        expect(http.axiosRef.get.mock.calls.map((call: any[]) => call[1].params.page)).toEqual([1, 2]);
    });
});

describe('publicación atómica por generación', () => {
    it('upserts y tombstones ocurren dentro de la misma transacción', async () => {
        const { service, prisma, txQueries } = build();
        jest.spyOn(service as any, 'assertProviderApplicable').mockResolvedValue(undefined);
        jest.spyOn(service, 'getConfig').mockResolvedValue({ provider: 'toast', configRevision: 3 } as any);
        jest.spyOn(service, 'ensureTables').mockResolvedValue(undefined);
        jest.spyOn(service as any, 'syncToast').mockResolvedValue({
            synced: 2,
            items: [toastItem(1), toastItem(2)].map(item => ({
                provider: 'toast', itemType: 'menu_item', externalId: item.guid, title: item.name,
            })),
        });
        jest.spyOn(service, 'updateHealth').mockResolvedValue({ status: 'healthy' } as any);

        await expect(service.sync(TENANT_ID, 'toast')).resolves.toEqual({ synced: 2 });

        expect(prisma.transactionInTenantSchema).toHaveBeenCalledWith(
            SCHEMA, expect.any(Function), { timeout: 120_000 },
        );
        expect(txQueries.filter(q => /INSERT INTO vi_items/.test(q.sql))).toHaveLength(2);
        expect(txQueries.at(-1)?.sql).toContain('UPDATE vi_items');
        expect(txQueries.at(-1)?.params.slice(0, 2)).toEqual(['toast', 'menu_item']);
    });

    it('una página fallida no abre una transacción ni tombstonea el espejo anterior', async () => {
        const { service, prisma } = build();
        jest.spyOn(service as any, 'assertProviderApplicable').mockResolvedValue(undefined);
        jest.spyOn(service, 'getConfig').mockResolvedValue({ provider: 'toast', configRevision: 1 } as any);
        jest.spyOn(service, 'ensureTables').mockResolvedValue(undefined);
        jest.spyOn(service as any, 'syncToast').mockRejectedValue(new Error('page 3 timeout'));
        jest.spyOn(service, 'updateHealth').mockResolvedValue({ status: 'unhealthy' } as any);

        await expect(service.sync(TENANT_ID, 'toast')).rejects.toThrow('page 3 timeout');
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });
});
