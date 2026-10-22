import { AIToolExecutorService } from './ai-tool-executor.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { LISTINGS_TOOLS } from './tools/listings-tools';
import { evaluateListingCriteria, selectClosestListings } from '../listings/listing-closest-matches';

/**
 * Production (real-estate QA tenant, image f33f4b22): ONE apartment for sale,
 * 2 bedrooms, city «Spark QA Ciudad», neighbourhood NULL. «2 habitaciones en la
 * zona norte» became `neighborhood: 'norte'`, the strict search excluded the
 * row and the agent said «no hay apartamentos en venta con 2 habitaciones en la
 * zona norte». The strict list stays strict; the listing comes back as a
 * closest match that says the zone is not confirmed.
 */
describe('search_listings closest matches', () => {
    const schemaName = 'tenant_inmobiliaria_qa';
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const contactId = '22222222-2222-4222-8222-222222222222';
    const LISTING = {
        id: '57542cc7-de10-4166-b731-704bc7fa403d',
        name: 'Spark QA Inmueble 20261018T2220Z',
        transaction_type: 'sale',
        property_kind: 'apartment',
        price: 250000,
        currency: 'EUR',
        bedrooms: 2,
        bathrooms: 1,
        area_m2: 80,
        neighborhood: null,
        city: 'Spark QA Ciudad',
        address: 'Calle Sintetica QA 123',
        status: 'available',
    };

    /** A fake `ListingsService.search` that applies the same filters the SQL applies. */
    function sqlLikeSearch(rows: any[]) {
        const fold = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        return jest.fn(async (_schema: string, p: any) => rows.filter(r =>
            (!p.transactionType || r.transaction_type === p.transactionType)
            && (!p.propertyKind || r.property_kind === p.propertyKind)
            && (p.maxPrice === undefined || (r.price !== null && r.price <= p.maxPrice))
            && (p.minBedrooms === undefined || (r.bedrooms !== null && r.bedrooms >= p.minBedrooms))
            && (p.minAreaM2 === undefined || (r.area_m2 !== null && r.area_m2 >= p.minAreaM2))
            && (!p.neighborhood || [r.neighborhood, r.address].some(h => h !== null && fold(h).includes(fold(p.neighborhood))))
            && (!p.city || (r.city !== null && fold(r.city).includes(fold(p.city)))),
        ).slice(0, p.limit ?? 10));
    }

    function createHarness(rows: any[]) {
        const prisma = {
            $queryRawUnsafe: jest.fn().mockResolvedValue([]),
            $executeRawUnsafe: jest.fn(),
            // The catalogue has rows: an empty strict list is not `catalog_empty`.
            executeInTenantSchema: jest.fn().mockResolvedValue([{ present: 1 }]),
        };
        const listingsService = { search: sqlLikeSearch(rows) };
        const toolExecutionControl = {
            preflight: jest.fn().mockResolvedValue({ allowed: true, policy: { externalEffect: 'none' } }),
            complete: jest.fn().mockResolvedValue(undefined),
            fail: jest.fn().mockResolvedValue(undefined),
        };
        const executor = new AIToolExecutorService(
            prisma as any, {} as any, { emit: jest.fn() } as any, {} as any, {} as any, {} as any, {} as any, {} as any,
            {} as any, {} as any, listingsService as any,
            {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
            toolExecutionControl as any, {} as any, {} as any,
        );
        const run = (args: Record<string, any>) => executor.execute(
            schemaName, tenantId, contactId, 'search_listings', args, undefined, { authority: authorityFor('search_listings') },
        );
        return { run, listingsService };
    }

    it('a zone filter over a listing with no neighbourhood returns it as a closest match with a note', async () => {
        const h = createHarness([LISTING]);
        const result = await h.run({ transactionType: 'sale', propertyKind: 'apartment', minBedrooms: 2, neighborhood: 'zona norte' });

        expect(result.listings).toEqual([]);
        expect(result.message).toBeUndefined();
        expect(result.catalog_empty).toBeUndefined();
        expect(result.closestMatches).toHaveLength(1);
        const [match] = result.closestMatches;
        expect(match).toMatchObject({
            id: LISTING.id, name: LISTING.name, transactionType: 'sale', bedrooms: 2, price: 250000, currency: 'EUR',
            neighborhood: null, city: 'Spark QA Ciudad', unmetCriteria: [], unconfirmedCriteria: ['neighborhood'],
        });
        expect(match.matchNote).toMatch(/zona «zona norte» no confirmada: el inmueble no tiene barrio registrado/);
        expect(result.matchNote).toMatch(/No digas que no hay inmuebles/);
        expect(result.matchNote).toMatch(/no tengo uno confirmado en la zona norte, pero tengo este/);
    });

    it('a city-centre ask with a filled city and empty neighbourhood is also a closest match', async () => {
        const h = createHarness([LISTING]);
        const result = await h.run({ minBedrooms: 2, neighborhood: 'centro', city: 'Spark QA Ciudad' });
        expect(result.listings).toEqual([]);
        expect(result.closestMatches.map((m: any) => m.id)).toEqual([LISTING.id]);
        expect(result.closestMatches[0].unconfirmedCriteria).toEqual(['neighborhood']);
        expect(result.closestMatches[0].unmetCriteria).toEqual([]);
    });

    it('rent asked with only a sale listing: no rent result, the sale one flagged as a different transaction', async () => {
        const h = createHarness([LISTING]);
        const result = await h.run({ transactionType: 'rent', minBedrooms: 2 });

        expect(result.listings).toEqual([]);
        expect(result.closestMatches).toHaveLength(1);
        expect(result.closestMatches[0]).toMatchObject({
            id: LISTING.id, transactionType: 'sale', unmetCriteria: ['transactionType'], unconfirmedCriteria: [],
        });
        expect(result.closestMatches[0].matchNote).toBe('operación distinta: es venta, no arriendo');
        expect(result.message).toBeUndefined();
    });

    it('a near miss on bedrooms is reported, not hidden, and the strict list stays strict', async () => {
        const h = createHarness([LISTING]);
        const result = await h.run({ transactionType: 'sale', minBedrooms: 3 });
        expect(result.listings).toEqual([]);
        expect(result.closestMatches[0].unmetCriteria).toEqual(['minBedrooms']);
        expect(result.closestMatches[0].matchNote).toBe('tiene 2 habitaciones, se pidieron al menos 3');
    });

    it('an exact match is unaffected: listed once, no closest matches, no notes', async () => {
        const h = createHarness([LISTING]);
        const result = await h.run({ transactionType: 'sale', propertyKind: 'apartment', minBedrooms: 2, maxPrice: 300000 });
        expect(result.listings.map((l: any) => l.id)).toEqual([LISTING.id]);
        expect(result.closestMatches).toBeUndefined();
        expect(result.matchNote).toBeUndefined();
        expect(result.message).toBeUndefined();
        expect(h.listingsService.search).toHaveBeenCalledTimes(1);
    });

    it('an exact location match keeps a no-zone listing only as an unconfirmed extra, never a clear miss', async () => {
        const inZone = { ...LISTING, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', neighborhood: 'Norte Alto' };
        const elsewhere = { ...LISTING, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', neighborhood: 'Sur', address: 'Calle 1' };
        const h = createHarness([inZone, LISTING, elsewhere]);
        const result = await h.run({ transactionType: 'sale', neighborhood: 'norte' });
        expect(result.listings.map((l: any) => l.id)).toEqual([inZone.id]);
        expect(result.closestMatches.map((m: any) => m.id)).toEqual([LISTING.id]);
        expect(result.matchNote).toMatch(/no está confirmada/);
    });

    it('nothing at all in the catalogue for the criteria still answers the plain no-match message', async () => {
        const h = createHarness([]);
        const result = await h.run({ transactionType: 'rent', neighborhood: 'norte' });
        expect(result.listings).toEqual([]);
        expect(result.closestMatches).toBeUndefined();
        expect(result.message).toContain('No hay inmuebles con esos criterios');
    });

    it('a search with no criteria never asks for closest matches', async () => {
        const h = createHarness([]);
        await h.run({});
        expect(h.listingsService.search).toHaveBeenCalledTimes(1);
    });

    it('a failing closest-match lookup never breaks the strict answer', async () => {
        const h = createHarness([LISTING]);
        h.listingsService.search.mockImplementationOnce(async () => []).mockImplementation(async () => { throw new Error('db down'); });
        const result = await h.run({ transactionType: 'sale', neighborhood: 'norte' });
        expect(result.error).toBeUndefined();
        expect(result.listings).toEqual([]);
        expect(result.message).toContain('No hay inmuebles con esos criterios');
    });

    it('ranks hard misses after location-only unknowns', () => {
        const rent = { ...LISTING, id: 'r', transaction_type: 'rent' };
        const picked = selectClosestListings([rent, LISTING], { transactionType: 'sale', neighborhood: 'norte' }, {
            excludeIds: [], strictCount: 0, max: 3,
        });
        expect(picked.map(p => p.row.id)).toEqual([LISTING.id, 'r']);
        expect(evaluateListingCriteria({ ...LISTING, price: 0 }, { maxPrice: 1000 })).toEqual({ unmet: [], unconfirmed: ['maxPrice'] });
        expect(evaluateListingCriteria({ ...LISTING, neighborhood: 'Usaquén' }, { neighborhood: 'usaquen' })).toEqual({ unmet: [], unconfirmed: [] });
    });

    it('the tool description tells the model what closestMatches are and how to say them', () => {
        const tool = LISTINGS_TOOLS.find(t => t.name === 'search_listings')!;
        expect(tool.description).toMatch(/closestMatches/);
        expect(tool.description).toMatch(/never say there is nothing/);
        expect(tool.description).toMatch(/no tengo uno confirmado en la zona norte, pero tengo este/);
    });
});
