import { BadRequestException } from '@nestjs/common';
import { promises as dns } from 'node:dns';
import { HttpRequestService } from './http-request.service';

describe('HttpRequestService SSRF boundary', () => {
    let lookupSpy: jest.SpyInstance;
    let http: any;
    let service: HttpRequestService;

    beforeEach(() => {
        lookupSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([
            { address: '203.0.114.60', family: 4 },
        ] as any);
        http = {
            axiosRef: {
                request: jest.fn().mockResolvedValue({ status: 200, headers: {}, data: { ok: true } }),
            },
        };
        service = new HttpRequestService(http);
    });

    afterEach(() => lookupSpy.mockRestore());

    it('rejects insecure and private destinations before sending automation traffic', async () => {
        await expect(service.execute({ method: 'GET', url: 'http://api.example.com' }))
            .rejects.toBeInstanceOf(BadRequestException);

        lookupSpy.mockResolvedValue([{ address: '10.0.0.10', family: 4 }] as any);
        await expect(service.execute({ method: 'GET', url: 'https://api.example.com' }))
            .rejects.toBeInstanceOf(BadRequestException);

        expect(http.axiosRef.request).not.toHaveBeenCalled();
    });

    it('uses the pinned agent and bounded direct request options', async () => {
        await service.execute({
            method: 'POST',
            url: 'https://api.example.com/hooks?source=automation',
            body: { hello: 'world' },
            timeoutMs: 60_000,
        });

        expect(http.axiosRef.request).toHaveBeenCalledWith(expect.objectContaining({
            method: 'POST',
            url: 'https://api.example.com/hooks?source=automation',
            timeout: 10_000,
            maxRedirects: 0,
            maxContentLength: 8 * 1024 * 1024,
            maxBodyLength: 1024 * 1024,
            proxy: false,
            httpsAgent: expect.any(Object),
        }));
    });

    it('rejects Host and proxy-routing header overrides', async () => {
        await expect(service.execute({
            method: 'POST',
            url: 'https://api.example.com/hooks',
            headers: { Host: 'metadata.google.internal' },
        })).rejects.toBeInstanceOf(BadRequestException);

        expect(http.axiosRef.request).not.toHaveBeenCalled();
    });
});
