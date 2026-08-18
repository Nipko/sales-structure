import { BadRequestException } from '@nestjs/common';
import { ListingsService } from './listings.service';

describe('ListingsService id validation', () => {
    const schemaName = 'tenant_realestate';
    const listingId = '22222222-2222-4222-8222-222222222222';

    function buildService() {
        const prisma = { executeInTenantSchema: jest.fn().mockResolvedValue([]) };
        return { service: new ListingsService(prisma as any), prisma };
    }

    // Same hole vacation-rental had: send_listing_image handed whatever the LLM
    // invented straight to the `::uuid` cast, so a slug surfaced as a raw 22P02
    // instead of an error the model can correct.
    it.each([
        ['a slug', 'penthouse-chapinero'],
        ['an empty string', ''],
        ['a non-string', 42],
    ])('getById rejects %s before reaching the ::uuid cast', async (_label, badId) => {
        const { service, prisma } = buildService();

        await expect(service.getById(schemaName, badId as any))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('still queries the tenant schema for a well-formed id', async () => {
        const { service, prisma } = buildService();
        prisma.executeInTenantSchema.mockResolvedValue([{ id: listingId }]);

        await expect(service.getById(schemaName, listingId)).resolves.toEqual({ id: listingId });
        expect(prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
    });
});
