import { BadRequestException } from '@nestjs/common';
import { AIToolExecutorService } from './ai-tool-executor.service';

/**
 * Regression: MediaService stores uploads as relative paths
 * (`/api/v1/media/file/...`), and the media tools dropped every URL that was not
 * already absolute. Every tenant that loaded its photos from the panel got an
 * empty media set and a plain `error` return — no throw, no warning — so the
 * customer never received the picture and nothing showed up in the logs.
 */
describe('AIToolExecutorService media URL resolution', () => {
    const schemaName = 'tenant_media';
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const contactId = '22222222-2222-4222-8222-222222222222';
    const propertyId = '33333333-3333-4333-8333-333333333333';
    const listingId = '44444444-4444-4444-8444-444444444444';
    const vehicleId = '55555555-5555-4555-8555-555555555555';
    const origin = 'https://api.media-test.local';

    let previousApiUrl: string | undefined;

    beforeAll(() => {
        previousApiUrl = process.env.API_PUBLIC_URL;
        process.env.API_PUBLIC_URL = `${origin}/api/v1`;
    });

    afterAll(() => {
        if (previousApiUrl === undefined) delete process.env.API_PUBLIC_URL;
        else process.env.API_PUBLIC_URL = previousApiUrl;
    });

    function createHarness() {
        const prisma = {
            $queryRawUnsafe: jest.fn().mockResolvedValue([]),
            $executeRawUnsafe: jest.fn(),
            executeInTenantSchema: jest.fn().mockResolvedValue([]),
        };
        const propertiesService = { getById: jest.fn() };
        const listingsService = { getById: jest.fn() };
        const toolExecutionControl = {
            preflight: jest.fn().mockResolvedValue({ allowed: true, policy: { externalEffect: 'none' } }),
            complete: jest.fn().mockResolvedValue(undefined),
            fail: jest.fn().mockResolvedValue(undefined),
        };
        const executor = new AIToolExecutorService(
            prisma as any,
            {} as any,
            { emit: jest.fn() } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            propertiesService as any,
            {} as any,
            {} as any,
            listingsService as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            toolExecutionControl as any,
            {} as any,
            {} as any,
        );
        return { executor, prisma, propertiesService, listingsService };
    }

    function run(harness: ReturnType<typeof createHarness>, tool: string, args: Record<string, any>) {
        return harness.executor.execute(schemaName, tenantId, contactId, tool, args);
    }

    it('absolutizes the relative paths MediaService stores for a property', async () => {
        const harness = createHarness();
        harness.propertiesService.getById.mockResolvedValue({
            id: propertyId,
            name: 'Casa Mar',
            images: [
                `/api/v1/media/file/${tenantId}/fachada.webp`,
                `/api/v1/media/file/${tenantId}/cocina.webp`,
            ],
        });

        const result = await run(harness, 'send_property_image', { propertyId });

        expect(result.success).toBe(true);
        expect(result._mediaToSend).toEqual([
            { url: `${origin}/api/v1/media/file/${tenantId}/fachada.webp`, caption: 'Casa Mar' },
            { url: `${origin}/api/v1/media/file/${tenantId}/cocina.webp`, caption: undefined },
        ]);
    });

    it('keeps already absolute URLs untouched and caps the carousel at three', async () => {
        const harness = createHarness();
        harness.propertiesService.getById.mockResolvedValue({
            id: propertyId,
            name: 'Casa Mar',
            images: [
                'https://cdn.example.com/1.jpg',
                `/api/v1/media/file/${tenantId}/2.webp`,
                'http://cdn.example.com/3.jpg',
                'https://cdn.example.com/4.jpg',
            ],
        });

        const result = await run(harness, 'send_property_image', { propertyId });

        expect(result._mediaToSend.map((m: any) => m.url)).toEqual([
            'https://cdn.example.com/1.jpg',
            `${origin}/api/v1/media/file/${tenantId}/2.webp`,
            'http://cdn.example.com/3.jpg',
        ]);
    });

    it('still discards entries that are not usable URLs', async () => {
        const harness = createHarness();
        harness.propertiesService.getById.mockResolvedValue({
            id: propertyId,
            name: 'Casa Mar',
            images: [
                null,
                '',
                '   ',
                { url: '/api/v1/media/file/x.webp' },
                'javascript:alert(1)',
                'data:image/png;base64,AAAA',
                '//evil.example.com/pwn.jpg',
            ],
        });

        const result = await run(harness, 'send_property_image', { propertyId });

        expect(result).toEqual({ error: 'Esa propiedad no tiene una imagen disponible.' });
    });

    it('absolutizes relative photos for a real-estate listing', async () => {
        const harness = createHarness();
        harness.listingsService.getById.mockResolvedValue({
            id: listingId,
            name: 'Penthouse Chapinero',
            images: [`/api/v1/media/file/${tenantId}/sala.webp`],
        });

        const result = await run(harness, 'send_listing_image', { listingId });

        expect(result.success).toBe(true);
        expect(result._mediaToSend).toEqual([
            { url: `${origin}/api/v1/media/file/${tenantId}/sala.webp`, caption: 'Penthouse Chapinero' },
        ]);
    });

    it('absolutizes the vehicle photo and still sends a single image', async () => {
        const harness = createHarness();
        harness.prisma.$queryRawUnsafe.mockResolvedValue([{
            id: vehicleId,
            make: 'Mazda',
            model: 'CX-5',
            year: 2024,
            photos: [
                `/api/v1/media/file/${tenantId}/cx5.webp`,
                `/api/v1/media/file/${tenantId}/cx5-interior.webp`,
            ],
        }]);

        const result = await run(harness, 'send_vehicle_image', { vehicleId });

        expect(result.success).toBe(true);
        expect(result._mediaToSend).toEqual({
            url: `${origin}/api/v1/media/file/${tenantId}/cx5.webp`,
            caption: '2024 Mazda CX-5',
        });
    });

    // Production sent `send_property_image` a slug ("amazon-minimalist"). The
    // model only self-corrects when the error names what it should pass and
    // where to get it.
    it('answers an invalid property id with a correctable error', async () => {
        const harness = createHarness();
        harness.propertiesService.getById.mockRejectedValue(
            new BadRequestException('propertyId must be a valid UUID'),
        );

        const result = await run(harness, 'send_property_image', { propertyId: 'amazon-minimalist' });

        expect(result.error).toBe('invalid_property_id');
        expect(result.message).toContain('UUID');
        expect(result.message).toContain('list_properties');
    });

    it('answers an invalid listing id with a correctable error', async () => {
        const harness = createHarness();
        harness.listingsService.getById.mockRejectedValue(
            new BadRequestException('listingId must be a valid UUID'),
        );

        const result = await run(harness, 'send_listing_image', { listingId: 'penthouse-chapinero' });

        expect(result.error).toBe('invalid_listing_id');
        expect(result.message).toContain('search_listings');
    });
});
