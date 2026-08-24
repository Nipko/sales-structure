import { BadRequestException } from '@nestjs/common';
import { promises as dns } from 'node:dns';
import { McpClientService } from './mcp-client.service';
import { TenantSecretCryptoService } from '../../common/crypto/tenant-secret-crypto.service';

describe('McpClientService outbound URL security', () => {
    let lookupSpy: jest.SpyInstance;
    let prisma: any;
    let redis: any;
    let http: any;
    let service: McpClientService;

    beforeEach(() => {
        lookupSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([
            { address: '203.0.114.70', family: 4 },
        ] as any);
        prisma = {
            tenant: {
                findUnique: jest.fn().mockResolvedValue({ settings: {} }),
                update: jest.fn().mockResolvedValue({}),
            },
        };
        redis = { del: jest.fn().mockResolvedValue(undefined) };
        http = {
            axiosRef: {
                post: jest.fn()
                    .mockResolvedValueOnce({ headers: {}, data: {} })
                    .mockResolvedValueOnce({ headers: {}, data: {} })
                    .mockResolvedValueOnce({ headers: {}, data: { result: { tools: [] } } }),
            },
        };
        service = new McpClientService(prisma, redis, http, new TenantSecretCryptoService());
    });

    afterEach(() => lookupSpy.mockRestore());

    it('rejects a private MCP endpoint before storing it', async () => {
        lookupSpy.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as any);

        await expect(service.saveServer('tenant-1', {
            name: 'Internal',
            url: 'https://mcp.example.com/rpc',
        })).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.tenant.update).not.toHaveBeenCalled();
        expect(http.axiosRef.post).not.toHaveBeenCalled();
    });

    it('pins and bounds every request made for a pre-existing MCP server', async () => {
        prisma.tenant.findUnique.mockResolvedValue({
            settings: {
                mcpServers: [{
                    id: 'remote',
                    name: 'Remote',
                    url: 'https://mcp.example.com/rpc',
                    enabled: true,
                }],
            },
        });

        await expect(service.testServer('tenant-1', 'remote')).resolves.toEqual({ ok: true, toolCount: 0 });
        expect(http.axiosRef.post).toHaveBeenCalledTimes(3);
        for (const call of http.axiosRef.post.mock.calls) {
            expect(call[0]).toBe('https://mcp.example.com/rpc');
            expect(call[2]).toEqual(expect.objectContaining({
                maxRedirects: 0,
                maxContentLength: 8 * 1024 * 1024,
                maxBodyLength: 1024 * 1024,
                proxy: false,
                httpsAgent: expect.any(Object),
            }));
        }
    });
});
