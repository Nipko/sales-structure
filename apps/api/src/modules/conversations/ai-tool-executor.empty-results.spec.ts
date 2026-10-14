import { BadRequestException } from '@nestjs/common';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * An empty result with no reason makes the model guess, and it guesses "I can't search".
 * `search_packages` must say WHY a date matched nothing, and `search_listings` must
 * say that the search ran and there is simply no property for those criteria.
 */
describe('AIToolExecutorService empty search results', () => {
    const schemaName = 'tenant_empty';
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const contactId = '22222222-2222-4222-8222-222222222222';

    function createHarness() {
        const prisma = {
            $queryRawUnsafe: jest.fn().mockResolvedValue([]),
            $executeRawUnsafe: jest.fn(),
            executeInTenantSchema: jest.fn().mockResolvedValue([]),
        };
        const toursService = { searchPackages: jest.fn(), getPackage: jest.fn(), listInventory: jest.fn() };
        const listingsService = { search: jest.fn() };
        const toolExecutionControl = {
            preflight: jest.fn().mockResolvedValue({ allowed: true, policy: { externalEffect: 'none' } }),
            complete: jest.fn().mockResolvedValue(undefined),
            fail: jest.fn().mockResolvedValue(undefined),
        };
        const executor = new AIToolExecutorService(
            prisma as any, {} as any, { emit: jest.fn() } as any, {} as any, {} as any, {} as any, {} as any, {} as any,
            toursService as any, {} as any, listingsService as any,
            {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
            toolExecutionControl as any, {} as any, {} as any,
        );
        return { executor, prisma, toursService, listingsService };
    }

    const run = (h: ReturnType<typeof createHarness>, tool: string, args: Record<string, any>) =>
        h.executor.execute(schemaName, tenantId, contactId, tool, args, undefined, { authority: authorityFor(tool) });

    const packageId = '33333333-3333-4333-8333-333333333333';
    const packageRow = { id: packageId, name: 'Tour QA Aurora 20261014', price: 129000, currency: 'COP', duration_type: 'hours', duration_value: 4, is_active: true };

    it('resolves an exact active package name within the tenant before querying UUID details', async () => {
        const h = createHarness();
        h.prisma.executeInTenantSchema.mockResolvedValue([{ id: packageId }]);
        h.toursService.getPackage.mockImplementation(async (_schema, id) => {
            if (id !== packageId) throw new Error('invalid input syntax for uuid');
            return packageRow;
        });
        h.toursService.listInventory.mockResolvedValue([]);
        const result = await run(h, 'get_package_details', { packageId: 'Tour QA Aurora 20261014' });
        expect(result).toMatchObject({ id: packageId, price: 129000, currency: 'COP', durationValue: 4 });
        expect(h.toursService.getPackage).toHaveBeenCalledWith(schemaName, packageId);
        expect(h.toursService.listInventory).toHaveBeenCalledWith(schemaName, packageId, expect.any(String));
        const lookup = h.prisma.executeInTenantSchema.mock.calls.find(call => String(call[1]).includes('LOWER(name)'))!;
        expect(lookup[0]).toBe(schemaName);
        expect(lookup[1]).toContain('is_active = true');
        expect(lookup[1]).toContain('LIMIT 2');
        expect(lookup[1]).not.toContain('Tour QA');
        expect(lookup[2]).toEqual(['Tour QA Aurora 20261014']);
    });

    it('does not choose a package when an exact name matches more than one active row', async () => {
        const h = createHarness();
        h.prisma.executeInTenantSchema.mockResolvedValue([{ id: packageId }, { id: '44444444-4444-4444-8444-444444444444' }]);
        expect(await run(h, 'get_package_details', { packageId: 'Tour QA Aurora 20261014' }))
            .toMatchObject({ error: 'package_reference_ambiguous', retryable: false });
        expect(h.toursService.getPackage).not.toHaveBeenCalled();
        expect(h.toursService.listInventory).not.toHaveBeenCalled();
    });

    it('returns not found for a missing exact name without a fuzzy fallback', async () => {
        const h = createHarness();
        h.prisma.executeInTenantSchema.mockImplementation(async (_schema, sql) => String(sql).includes('LOWER(name)') ? [] : [{ present: 1 }]);
        expect(await run(h, 'get_package_details', { packageId: 'Tour no publicado' })).toMatchObject({ error: 'package_not_found' });
        expect(h.toursService.getPackage).not.toHaveBeenCalled();
    });

    it('keeps UUID reads canonical and refuses an inactive package', async () => {
        const h = createHarness();
        h.prisma.executeInTenantSchema.mockResolvedValue([{ present: 1 }]);
        h.toursService.getPackage.mockResolvedValue({ ...packageRow, is_active: false });
        expect(await run(h, 'get_package_details', { packageId })).toMatchObject({ error: 'package_not_found' });
        expect(h.toursService.getPackage).toHaveBeenCalledWith(schemaName, packageId);
        expect(h.toursService.listInventory).not.toHaveBeenCalled();
        expect(h.prisma.executeInTenantSchema.mock.calls.some(call => String(call[1]).includes('LOWER(name)'))).toBe(false);
    });

    it('preserves details and inventory for an active canonical UUID', async () => {
        const h = createHarness();
        h.prisma.executeInTenantSchema.mockResolvedValue([{ present: 1 }]);
        h.toursService.getPackage.mockResolvedValue(packageRow);
        h.toursService.listInventory.mockResolvedValue([{ departure_date: '2026-12-01', available_seats: 3 }]);
        expect(await run(h, 'get_package_details', { packageId })).toMatchObject({
            id: packageId, price: 129000, currency: 'COP', upcomingDepartures: [{ date: '2026-12-01', seatsLeft: 3 }],
        });
        expect(h.prisma.executeInTenantSchema.mock.calls.some(call => String(call[1]).includes('LOWER(name)'))).toBe(false);
    });

    it.each([
        ['departure_in_past', 'That departure date has already passed. Offer a future date.'],
        ['invalid_departure_date', 'date must be a real calendar date (YYYY-MM-DD)'],
    ])('search_packages tells the model the date problem (%s) instead of an unexplained empty list', async (reason, message) => {
        const h = createHarness();
        h.toursService.searchPackages.mockRejectedValue(new BadRequestException({ error: reason, message }));
        const result = await run(h, 'search_packages', { destination: 'Cartagena', date: '2020-01-01' });
        expect(result.packages).toEqual([]);
        expect(result.reason).toBe(reason);
        expect(result.message).toContain(message);
    });

    it('search_packages keeps reporting other rejections as a failed read', async () => {
        const h = createHarness();
        h.toursService.searchPackages.mockRejectedValue(new BadRequestException('maxPrice must be positive'));
        const result = await run(h, 'search_packages', { maxPrice: -1 });
        expect(result.packages).toBeUndefined();
        expect(result.error).toBe('search_packages_rejected');
    });

    it('search_listings says explicitly that nothing matched the criteria', async () => {
        const h = createHarness();
        h.prisma.executeInTenantSchema.mockResolvedValue([{ present: 1 }]); // the catalogue HAS listings
        h.listingsService.search.mockResolvedValue([]);
        const result = await run(h, 'search_listings', { city: 'Bogotá', maxPrice: 10 });
        expect(result.listings).toEqual([]);
        expect(result.message).toContain('No hay inmuebles con esos criterios');
        expect(result.catalog_empty).toBeUndefined();
    });

    it('search_listings over a catalogue with NO listings answers catalog_empty, not a plain no-match', async () => {
        const h = createHarness(); // the readiness predicate finds no row
        h.listingsService.search.mockResolvedValue([]);
        const result = await run(h, 'search_listings', { transactionType: 'sale', neighborhood: 'Usaquén', minBedrooms: 3 });
        expect(result.listings).toEqual([]);
        expect(result.catalog_empty).toBe(true);
        expect(result.message).toMatch(/catálogo está vacío/);
        expect(result.message).not.toContain('No hay inmuebles con esos criterios');
        expect(h.prisma.executeInTenantSchema.mock.calls.at(-1)![1]).toContain('FROM real_estate_listings');
    });

    it('search_packages over a catalogue with NO packages answers catalog_empty', async () => {
        const h = createHarness();
        h.toursService.searchPackages.mockResolvedValue([]);
        const result = await run(h, 'search_packages', { destination: 'Cartagena' });
        expect(result.packages).toEqual([]);
        expect(result.catalog_empty).toBe(true);
        expect(h.prisma.executeInTenantSchema.mock.calls.at(-1)![1]).toContain('FROM tour_packages');
    });

    it('search_packages with packages loaded but none matching stays a plain empty list', async () => {
        const h = createHarness();
        h.prisma.executeInTenantSchema.mockResolvedValue([{ present: 1 }]);
        h.toursService.searchPackages.mockResolvedValue([]);
        const result = await run(h, 'search_packages', { destination: 'Tokio' });
        expect(result.packages).toEqual([]);
        expect(result.catalog_empty).toBeUndefined();
    });

    it('a past departure date over an EMPTY catalogue still says the date passed (the date comes first)', async () => {
        const h = createHarness();
        h.toursService.searchPackages.mockRejectedValue(new BadRequestException({ error: 'departure_in_past', message: 'Esa fecha de salida ya pasó.' }));
        const result = await run(h, 'search_packages', { date: '2026-09-01' });
        expect(result.reason).toBe('departure_in_past');
        expect(result.catalog_empty).toBeUndefined();
    });

    it('search_listings adds no empty-result message when there are matches', async () => {
        const h = createHarness();
        h.listingsService.search.mockResolvedValue([{ id: 'l1', name: 'Apto', price: 100 }]);
        const result = await run(h, 'search_listings', { city: 'Bogotá' });
        expect(result.listings).toHaveLength(1);
        expect(result.message).toBeUndefined();
    });
});
