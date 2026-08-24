import { promises as dns } from 'node:dns';
import { McpClientService } from './mcp-client.service';
import { McpController } from './mcp.controller';
import { TenantSecretCryptoService } from '../../common/crypto/tenant-secret-crypto.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const KEY = 'a'.repeat(64);

describe('MCP tenant secrets', () => {
    const originalEnv = { ...process.env };
    let settings: Record<string, any>;
    let prisma: any;
    let redis: any;
    let http: any;
    let service: McpClientService;
    let controller: McpController;
    let lookupSpy: jest.SpyInstance;

    beforeEach(() => {
        process.env.TENANT_SECRET_KEY = KEY;
        delete process.env.TENANT_SECRET_PLAINTEXT;
        settings = {};
        const tx = {
            $queryRawUnsafe: jest.fn(async () => [{ value: settings.mcpServers ?? null }]),
            $executeRawUnsafe: jest.fn(async (_sql: string, ...params: any[]) => {
                settings.mcpServers = JSON.parse(params[2]);
                return 1;
            }),
        };
        prisma = {
            tenant: {
                findUnique: jest.fn(async () => ({ settings })),
            },
            $transaction: jest.fn(async (callback: any) => callback(tx)),
        };
        redis = {
            del: jest.fn().mockResolvedValue(undefined),
            getJson: jest.fn().mockResolvedValue(null),
            setJson: jest.fn().mockResolvedValue(undefined),
        };
        http = { axiosRef: { post: jest.fn().mockResolvedValue({ headers: {}, data: {} }) } };
        lookupSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([
            { address: '203.0.114.70', family: 4 },
        ] as any);
        service = new McpClientService(
            prisma,
            redis,
            http,
            new TenantSecretCryptoService(),
        );
        controller = new McpController(service);
    });

    afterEach(() => {
        lookupSpy.mockRestore();
        process.env = { ...originalEnv };
    });

    it('encrypts authHeader, masks every controller response and preserves ***', async () => {
        const created = await controller.save(TENANT_ID, {
            name: 'Remote',
            url: 'https://mcp.example.com/rpc',
            authHeader: 'Bearer super-secret',
        });

        const stored = settings.mcpServers[0];
        expect(stored.authHeader).toMatch(/^tsc:v1:/);
        expect(stored.authHeader).not.toContain('super-secret');
        expect(created.data.authHeader).toBe('***');
        expect((await controller.list(TENANT_ID)).data[0].authHeader).toBe('***');

        const envelope = stored.authHeader;
        const updated = await controller.save(TENANT_ID, {
            id: stored.id,
            name: 'Remote renamed',
            url: 'https://mcp.example.com/rpc',
            authHeader: '***',
            enabled: false,
        });
        expect(settings.mcpServers[0].authHeader).toBe(envelope);
        expect(updated.data.authHeader).toBe('***');

        const runtime = await service.listServers(TENANT_ID);
        expect(runtime[0].authHeader).toBe('Bearer super-secret');
        expect(runtime[0]._authUnavailable).toBeUndefined();
    });

    it('reads legacy plaintext, rewraps it with CAS and remains readable after the cut', async () => {
        settings.mcpServers = [{
            id: 'remote',
            name: 'Remote',
            url: 'https://mcp.example.com/rpc',
            authHeader: 'Bearer legacy',
            enabled: true,
        }];

        expect((await service.listServers(TENANT_ID))[0].authHeader).toBe('Bearer legacy');
        expect(settings.mcpServers[0].authHeader).toMatch(/^tsc:v1:/);

        process.env.TENANT_SECRET_PLAINTEXT = 'reject';
        expect((await service.listServers(TENANT_ID))[0].authHeader).toBe('Bearer legacy');
    });

    it('fails closed after the plaintext cut instead of sending without Authorization', async () => {
        settings.mcpServers = [{
            id: 'remote',
            name: 'Remote',
            url: 'https://mcp.example.com/rpc',
            authHeader: 'Bearer plaintext-after-cut',
            enabled: true,
        }];
        process.env.TENANT_SECRET_PLAINTEXT = 'reject';

        const runtime = await service.listServers(TENANT_ID);
        expect(runtime[0]).toMatchObject({ _authUnavailable: true });
        expect(runtime[0].authHeader).toBeUndefined();
        await expect(controller.save(TENANT_ID, {
            id: 'remote',
            name: 'Remote',
            url: 'https://mcp.example.com/rpc',
            authHeader: '***',
        })).rejects.toThrow('tenant_secret_plaintext_rejected');
        await expect(service.testServer(TENANT_ID, 'remote')).resolves.toEqual(expect.objectContaining({ ok: false }));
        expect(http.axiosRef.post).not.toHaveBeenCalled();
    });
});
