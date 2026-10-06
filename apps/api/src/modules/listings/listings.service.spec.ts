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

    // Customer read vs admin read: getById stays unfiltered for the panel;
    // getAvailableById only hands the row over when search_listings would offer it.
    it.each([
        ['sold', { status: 'sold', is_active: true }],
        ['rented', { status: 'rented', is_active: true }],
        ['reserved', { status: 'reserved', is_active: true }],
        ['inactive status', { status: 'inactive', is_active: true }],
        ['deactivated', { status: 'available', is_active: false }],
        ['null flag', { status: 'available', is_active: null }],
        ['null status', { status: null, is_active: true }],
    ])('getAvailableById never returns the row of a %s listing', async (_label, row) => {
        const { service, prisma } = buildService();
        prisma.executeInTenantSchema.mockResolvedValue([{ id: listingId, name: 'Casa', price: 1, ...row }]);

        await expect(service.getAvailableById(schemaName, listingId)).resolves.toEqual({ state: 'unavailable' });
        await expect(service.getById(schemaName, listingId)).resolves.toMatchObject({ name: 'Casa' });
    });

    it('getAvailableById returns an available, active listing and reports a missing one', async () => {
        const { service, prisma } = buildService();
        const row = { id: listingId, name: 'Casa', status: 'available', is_active: true };
        prisma.executeInTenantSchema.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);

        await expect(service.getAvailableById(schemaName, listingId)).resolves.toEqual({ state: 'available', listing: row });
        await expect(service.getAvailableById(schemaName, listingId)).resolves.toEqual({ state: 'not_found' });
    });
});
