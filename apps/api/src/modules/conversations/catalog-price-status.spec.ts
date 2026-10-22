/**
 * Production 2026-10-22: after search_listings returned price 250000 and areaM2 80
 * the agent told the buyer «el precio no está confirmado» and «el área no está
 * confirmada». Rule 22a only let PRODUCT results carry an amount, and no other
 * catalogue reader said its price was confirmed. Every catalogue projection that
 * returns an amount now carries `priceStatus` from one helper, and 22a reads it
 * whatever the reader.
 */
import { AIToolExecutorService } from './ai-tool-executor.service';
import { catalogPriceStatus } from './catalog-price-status';
import { canonicalPackageCatalogue } from './canonical-package-context';
import { projectEcommerceCatalogRow, projectOwnCatalogRow } from './catalog-turn-projection';
import { PromptAssemblerService } from './prompt-assembler.service';
import { buildTrustedPriceCorpus } from './trusted-price-context';
import { ResponseValidatorService } from './response-validator.service';

const UUID = '57542cc7-de10-4166-b731-704bc7fa403d';

describe('catalogPriceStatus', () => {
    it.each([
        [250000, 'confirmed'], ['129900.00', 'confirmed'], [0.5, 'confirmed'],
        [0, 'missing'], ['0.00', 'missing'], [null, 'missing'], [undefined, 'missing'],
        ['', 'missing'], ['abc', 'missing'], [-10, 'missing'],
    ] as const)('price %p without a price_status concept is %s', (price, expected) => {
        expect(catalogPriceStatus(price)).toBe(expected);
    });

    it('honours an explicit price_status column', () => {
        expect(catalogPriceStatus(50000, 'example')).toBe('example');
        expect(catalogPriceStatus(50000, 'quote')).toBe('quote');
        expect(catalogPriceStatus(null, 'quote')).toBe('quote');
        expect(catalogPriceStatus(50000, 'confirmed')).toBe('confirmed');
        expect(catalogPriceStatus(50000, null)).toBe('confirmed');
    });

    it('an explicit confirmed 0 is a price the owner declared free; with no amount it is missing', () => {
        expect(catalogPriceStatus(0, 'confirmed')).toBe('confirmed');
        expect(catalogPriceStatus(null, 'confirmed')).toBe('missing');
    });
});

describe('every catalogue reader states priceStatus next to its amount', () => {
    const executor = (deps: Record<string, unknown>): any =>
        Object.assign(Object.create(AIToolExecutorService.prototype), { logger: { warn: jest.fn(), log: jest.fn() } }, deps);

    const listing = (price: unknown) => ({
        id: UUID, name: 'Apartamento Chicó', transaction_type: 'sale', property_kind: 'apartment', price, currency: 'COP',
        bedrooms: 2, bathrooms: 2, area_m2: 80, parking_spots: 1, neighborhood: 'Chicó', city: 'Bogotá', status: 'available',
    });
    const property = (night: unknown) => ({
        id: UUID, name: 'Cabaña del Lago', max_guests: 4, bedrooms: 2, bathrooms: 1,
        night_price: night, cleaning_fee: 40000, currency: 'COP', min_nights: 1, images: [],
    });
    const pkg = (price: unknown) => ({
        id: UUID, name: 'Tour Cartagena', duration_type: 'days', duration_value: 3, price, currency: 'COP',
        destination: 'Cartagena', is_active: true,
    });

    type Reader = [string, (price: unknown) => Promise<any>];
    const readers: Reader[] = [
        ['search_listings', async price => (await executor({ listingsService: { search: jest.fn().mockResolvedValue([listing(price)]) } })
            .searchListings('tenant_qa', {})).listings[0]],
        ['get_listing_details', async price => executor({ listingsService: { getAvailableById: jest.fn().mockResolvedValue({ state: 'available', listing: listing(price) }) } })
            .getListingDetails('tenant_qa', UUID)],
        ['list_properties', async price => (await executor({ prisma: { $queryRawUnsafe: jest.fn().mockResolvedValue([property(price)]) } })
            .listProperties('tenant_qa')).properties[0]],
        ['get_property_details', async price => executor({ propertiesService: { getById: jest.fn().mockResolvedValue(property(price)) } })
            .getPropertyDetails('tenant_qa', UUID)],
        ['check_property_availability', async price => executor({ propertiesService: { checkAvailability: jest.fn().mockResolvedValue({
            available: true, canBookDirectly: true, nightPrice: Number(price), cleaningFee: 40000, nights: 2,
            totalPrice: Number(price) * 2 + 40000, currency: 'COP' }) } })
            .checkPropertyAvailability('tenant_qa', UUID, '2026-11-01', '2026-11-03')],
        ['search_packages', async price => (await executor({ toursService: { searchPackages: jest.fn().mockResolvedValue([pkg(price)]) } })
            .searchPackages('tenant_qa', {})).packages[0]],
        ['get_package_details', async price => executor({ toursService: {
            getPackage: jest.fn().mockResolvedValue(pkg(price)), listInventory: jest.fn().mockResolvedValue([]) } })
            .getPackageDetails('tenant_qa', UUID)],
        ['get_menu', async price => (await executor({ restaurantsService: { searchMenu: jest.fn().mockResolvedValue([{
            id: UUID, name: 'Bandeja paisa', price, currency: 'COP', category_name: 'Platos', tags: [], allergens: [], prep_time_minutes: 20 }]) } })
            .getMenu('tenant_qa', {})).items[0]],
        ['search_vehicles', async price => (await executor({ prisma: { $queryRawUnsafe: jest.fn().mockResolvedValue([{
            id: UUID, make: 'Mazda', model: '3', price_cents: price == null ? null : Number(price) * 100, currency: 'COP' }]) } })
            .searchVehicles('tenant_qa', {})).vehicles[0]],
        ['get_vehicle_details', async price => executor({ prisma: { $queryRawUnsafe: jest.fn().mockResolvedValue([{
            id: UUID, make: 'Mazda', model: '3', price_cents: price == null ? null : Number(price) * 100, currency: 'COP' }]) } })
            .getVehicleDetails('tenant_qa', UUID)],
        ['get_courses', async price => (await executor({ educationService: { listCourses: jest.fn().mockResolvedValue([{
            id: UUID, name: 'Inglés B1', price, currency: 'COP' }]) } })
            .getCoursesTool('tenant_qa', {})).courses[0]],
        ['get_course_schedule', async price => (await executor({ educationService: { upcomingCohorts: jest.fn().mockResolvedValue([{
            cohort_id: UUID, course_id: UUID, course_name: 'Inglés B1', available_seats: 3, price, currency: 'COP' }]) } })
            .getCourseScheduleTool('tenant_qa', {})).cohorts[0]],
    ];

    it.each(readers)('%s: a positive amount is confirmed', async (_name, read) => {
        const result = await read(250000);
        expect(result.priceStatus).toBe('confirmed');
    });

    it.each(readers)('%s: a 0 amount is missing, never confirmed', async (_name, read) => {
        const result = await read(0);
        expect(result.priceStatus).toBe('missing');
    });

    it('search_listings keeps the area as data, not as an amount', async () => {
        const result = await readers[0][1](250000);
        expect(result).toMatchObject({ price: 250000, priceStatus: 'confirmed', currency: 'COP', areaM2: 80 });
    });

    it('list_properties with dates keeps the status on the priced stay', async () => {
        const e = executor({
            prisma: { $queryRawUnsafe: jest.fn().mockResolvedValue([property(180000)]) },
            propertiesService: { checkAvailability: jest.fn().mockResolvedValue({ available: true, totalPrice: 400000, nights: 2 }) },
        });
        const { properties } = await e.listProperties('tenant_qa', undefined, '2026-11-01', '2026-11-03');
        expect(properties[0]).toMatchObject({ nightPrice: 180000, totalPrice: 400000, priceStatus: 'confirmed' });
    });

    it('a channel-manager property keeps the status next to its availability message', async () => {
        const e = executor({ propertiesService: { checkAvailability: jest.fn().mockResolvedValue({
            available: true, canBookDirectly: false, nightPrice: 180000, totalPrice: 400000, currency: 'COP' }) } });
        const result = await e.checkPropertyAvailability('tenant_qa', UUID, '2026-11-01', '2026-11-03');
        expect(result.priceStatus).toBe('confirmed');
        expect(result.message).toContain('channel manager');
    });

    it('recommend_products (synced store) states the status of each product', async () => {
        const e = executor({ ecommerceService: { searchProductsForAI: jest.fn().mockResolvedValue([
            { external_id: 'a', title: 'Lámpara', price_cents: 4990000, currency: 'COP', inventory_quantity: 2 },
            { external_id: 'b', title: 'Sin precio', price_cents: null, currency: 'COP', inventory_quantity: 2 },
        ]) } });
        const { products } = await e.recommendProducts('tenant_qa', 'lampara');
        expect(products.map((p: any) => p.priceStatus)).toEqual(['confirmed', 'missing']);
    });
});

describe('the turn catalogue carries the same status', () => {
    it('canonical packages', () => {
        const catalogue = canonicalPackageCatalogue({ packages: [
            { id: 'p1', name: 'Tour Cartagena', price: 1200000, currency: 'COP' },
            { id: 'p2', name: 'Tour sin precio', price: 0, currency: 'COP' },
        ] });
        expect(catalogue.map(item => item.priceStatus)).toEqual(['confirmed', 'missing']);
    });

    it('own catalogue and synced store rows', () => {
        expect(projectOwnCatalogRow({ id: 'a', name: 'A', price: '129900.00', stock: 1 }).priceStatus).toBe('confirmed');
        expect(projectOwnCatalogRow({ id: 'b', name: 'B', price: 0, stock: 1 }).priceStatus).toBe('missing');
        expect(projectEcommerceCatalogRow({ external_id: 'c', title: 'C', price_cents: 4990000 }).priceStatus).toBe('confirmed');
        expect(projectEcommerceCatalogRow({ external_id: 'd', title: 'D', price_cents: 0 }).priceStatus).toBe('missing');
    });

    it('<catalog> states no price_status for a confirmed amount and "missing" for a 0', () => {
        const assembler = new PromptAssemblerService({ buildSystemPrompt: () => '<persona/>' } as any);
        const prompt = assembler.assemble({ persona: {} } as any, {
            language: 'es', timezone: 'America/Bogota', now: '2026-10-22T15:00:00.000Z', upcomingDays: [], businessHoursStatus: 'open',
            catalog: canonicalPackageCatalogue({ packages: [
                { id: 'p1', name: 'Tour Cartagena', price: 1200000, currency: 'COP' },
                { id: 'p2', name: 'Tour sin precio', price: 0, currency: 'COP' },
            ] }),
        } as any);
        expect(prompt).toContain('<product id="p1" price="1200000" currency="COP">Tour Cartagena</product>');
        expect(prompt).toContain('<product id="p2" price="0" price_status="missing" currency="COP">Tour sin precio</product>');
    });
});

describe('the price guardrail validates catalogue amounts and never reads an area as money', () => {
    const validator = new ResponseValidatorService();
    const listingResult = { listings: [{ id: UUID, name: 'Apartamento Chicó', price: 250000, priceStatus: 'confirmed', currency: 'COP', areaM2: 80 }] };

    it('the listing price is trusted; the area is not an amount', () => {
        const corpus = JSON.parse(buildTrustedPriceCorpus({}, [{ name: 'search_listings', result: listingResult }]));
        expect(corpus.facts).toEqual([{ amount: 250000, currency: 'COP' }]);
    });

    it('a reply quoting the listing price passes; an amount equal to the area does not', () => {
        const corpus = buildTrustedPriceCorpus({}, [{ name: 'search_listings', result: listingResult }]);
        expect(validator.validatePrices('El apartamento cuesta $250.000 COP y tiene 80 m².', corpus).ok).toBe(true);
        expect(validator.validatePrices('Cuesta 80 COP.', corpus).ok).toBe(false);
    });

    it('property amounts (night, cleaning, total) stay validated', () => {
        const corpus = buildTrustedPriceCorpus({}, [{ name: 'check_property_availability', result: {
            available: true, nightPrice: 180000, cleaningFee: 40000, totalPrice: 400000, currency: 'COP', priceStatus: 'confirmed' } }]);
        expect(validator.validatePrices('Son 180.000 COP la noche, 40.000 COP de aseo: total 400.000 COP.', corpus).ok).toBe(true);
    });
});
