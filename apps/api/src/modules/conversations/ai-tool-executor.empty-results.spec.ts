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
        const toursService = { searchPackages: jest.fn() };
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
        return { executor, toursService, listingsService };
    }

    const run = (h: ReturnType<typeof createHarness>, tool: string, args: Record<string, any>) =>
        h.executor.execute(schemaName, tenantId, contactId, tool, args, undefined, { authority: authorityFor(tool) });

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
        h.listingsService.search.mockResolvedValue([]);
        const result = await run(h, 'search_listings', { city: 'Bogotá', maxPrice: 10 });
        expect(result.listings).toEqual([]);
        expect(result.message).toContain('No hay inmuebles con esos criterios');
    });

    it('search_listings adds no empty-result message when there are matches', async () => {
        const h = createHarness();
        h.listingsService.search.mockResolvedValue([{ id: 'l1', name: 'Apto', price: 100 }]);
        const result = await run(h, 'search_listings', { city: 'Bogotá' });
        expect(result.listings).toHaveLength(1);
        expect(result.message).toBeUndefined();
    });
});
