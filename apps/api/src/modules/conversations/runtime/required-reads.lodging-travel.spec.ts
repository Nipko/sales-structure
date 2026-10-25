import { getOperation } from '@parallext/shared';
import {
    buildRequiredReadsTrace,
    FROM_PRICE_NOTE,
    pickReceiptId,
    REQUIRED_READS_PILOT_OPERATIONS,
    requiredReadsGate,
    requiredReadsPilotForProfile,
    requiredReadsPlan,
    runRequiredReads,
} from './required-reads.runner';
import { requiredReadSlotsIn } from './required-read-slots';
import type { OperationShadowVerdict } from './operation-classifier.service';

/**
 * Operations runtime PR7: the required-reads runner for hotel / vacation rental (`properties`) and travel (`tours`).
 * Production QA (Telegram, hotel): «¿cuánto cuesta la noche?» → asked for dates, then «no tengo un precio base» (list_properties
 * has nightPrice 150.000 COP); «¿tienen disponible del 3 al 5 de diciembre para 2?» → availability claimed with no availability
 * read; «¿a qué hora es el check-in?» → only get_property_details has the time.
 */
const verdict = (operationKey: string, confidence = 0.92): OperationShadowVerdict =>
    ({ version: 1, operationKey, confidence, fallback: null, candidates: [operationKey], latencyMs: 5 });

const op = (key: string) => {
    const operation = getOperation(key);
    if (!operation) throw new Error(`missing operation ${key}`);
    return operation;
};

const TODAY = '2026-10-22';
const CABANA = '11111111-1111-4111-8111-111111111111';
const SUITE = '22222222-2222-4222-8222-222222222222';
const PROPERTY = { id: CABANA, name: 'Cabaña del Lago', nightPrice: 150000, currency: 'COP', minNights: 1, priceStatus: 'confirmed', maxGuests: 4 };
const DETAILS = { ...PROPERTY, checkInTime: '15:00', checkOutTime: '11:00', amenities: ['wifi', 'piscina'], houseRules: 'No mascotas' };
const TOUR = '33333333-3333-4333-8333-333333333333';
const PACKAGES = [
    { id: TOUR, name: 'Tour Cafetero', price: 129000, currency: 'COP', priceStatus: 'confirmed', seatsLeft: 8 },
    { id: '44444444-4444-4444-8444-444444444444', name: 'Ruta del Sol', price: 99000, currency: 'COP', priceStatus: 'confirmed', seatsLeft: null },
];

function harness(results: Record<string, (args: any) => any>, extra: Partial<Parameters<typeof runRequiredReads>[1]> = {}) {
    const calls: Array<{ name: string; args: any }> = [];
    return {
        calls,
        io: {
            publishedTools: [
                'list_properties', 'check_property_availability', 'get_property_details', 'get_check_in_instructions',
                'create_property_booking', 'list_my_property_bookings',
                'search_packages', 'get_package_details', 'check_package_availability', 'create_tour_booking',
            ],
            alreadyRead: [],
            projectedContexts: [],
            execute: async (name: string, args: any) => {
                calls.push({ name, args });
                if (!results[name]) throw new Error(`unexpected read ${name}`);
                return results[name](args);
            },
            ...extra,
        } as Parameters<typeof runRequiredReads>[1],
    };
}

describe('required reads PR7: pilots and gate', () => {
    it('hotel and vacation rental are the properties pilot, travel agency and tours the tours pilot (same industry, by tool family)', () => {
        expect(requiredReadsPilotForProfile('turismo/hotel')).toBe('properties');
        expect(requiredReadsPilotForProfile('turismo/alquiler_vacacional')).toBe('properties');
        expect(requiredReadsPilotForProfile('turismo/tours')).toBe('tours');
        expect(requiredReadsPilotForProfile('turismo/agencia_viajes')).toBe('tours');
        // A pet hotel is not lodging; PR5 pilots unchanged.
        expect(requiredReadsPilotForProfile('pet_services/hotel')).toBeNull();
        expect(requiredReadsPilotForProfile('restaurantes/casual_dining')).toBe('restaurants');
        expect(requiredReadsPilotForProfile('retail/electronica')).toBe('catalog');
    });

    it('the PR7 operations are the catalogue\'s, each owes reads, and the other vertical\'s operation is a pilot mismatch', () => {
        const pr7 = Object.entries(REQUIRED_READS_PILOT_OPERATIONS).filter(([, pilot]) => pilot === 'properties' || pilot === 'tours').map(([key]) => key).sort();
        // F4300-08 adds the guest's and the traveller's own bookings (view_my_stay_bookings, view_my_tour_bookings).
        expect(pr7).toEqual(['book_stay', 'book_tour', 'package_availability', 'package_info', 'property_info', 'stay_logistics',
            'view_my_stay_bookings', 'view_my_tour_bookings']);
        for (const key of pr7) expect(op(key).requiredReads.length).toBeGreaterThan(0);
        expect(requiredReadsGate(verdict('property_info'), 'tours')).toEqual({ run: false, reason: 'pilot_mismatch' });
        expect(requiredReadsGate(verdict('package_info'), 'properties')).toEqual({ run: false, reason: 'pilot_mismatch' });
        expect(requiredReadsGate(verdict('menu_info'), 'properties')).toEqual({ run: false, reason: 'pilot_mismatch' });
        const gate = requiredReadsGate(verdict('package_availability'), 'tours');
        expect(gate.run && gate.operation.key).toBe('package_availability');
    });

    it('the plan: dates add the availability read, stay_logistics runs only its public reads, a dateless departure question reads the departures', () => {
        const tools = (key: string, slots = {}) => requiredReadsPlan(op(key), slots).map(r => r.tool);
        expect(tools('property_info')).toEqual(['list_properties', 'get_property_details']);
        expect(tools('property_info', { check_in: '2026-12-03', check_out: '2026-12-05' }))
            .toEqual(['list_properties', 'get_property_details', 'check_property_availability']);
        expect(tools('book_stay')).toEqual(['list_properties', 'check_property_availability']);
        expect(tools('stay_logistics')).toEqual(['list_properties', 'get_property_details']);
        expect(tools('package_info')).toEqual(['search_packages', 'get_package_details']);
        expect(tools('package_availability')).toEqual(['search_packages', 'check_package_availability', 'get_package_details']);
        expect(tools('package_availability', { starts_at: '2026-11-15' })).toEqual(['search_packages', 'check_package_availability']);
        // PR5 operations are untouched by slots.
        expect(tools('track_food_order', { check_in: '2026-12-03', check_out: '2026-12-05' })).toEqual(['list_my_orders', 'check_order_status']);
    });
});

describe('required reads PR7: slots of the message', () => {
    it('reads a stay range said with its month once, and the people', () => {
        expect(requiredReadSlotsIn('¿tienen disponible del 3 al 5 de diciembre para 2?', TODAY))
            .toEqual({ check_in: '2026-12-03', check_out: '2026-12-05', starts_at: '2026-12-03', guests: 2, travellers: 2 });
        expect(requiredReadSlotsIn('entre el 30 de noviembre y el 2 de diciembre, somos 3 personas', TODAY))
            .toMatchObject({ check_in: '2026-11-30', check_out: '2026-12-02', guests: 3 });
    });

    it('a single date is a departure, not a stay; no date and no count is nothing', () => {
        expect(requiredReadSlotsIn('hay cupo para el 15 de noviembre para cuatro?', TODAY)).toEqual({ starts_at: '2026-11-15', guests: 4, travellers: 4 });
        expect(requiredReadSlotsIn('cuánto cuesta la noche?', TODAY)).toEqual({});
        expect(requiredReadSlotsIn('a qué hora es el check-in?', TODAY)).toEqual({});
        // «para 2 noches» is a length of stay, not two people.
        expect(requiredReadSlotsIn('precio para 2 noches', TODAY)).toEqual({});
    });
});

describe('required reads PR7: runner', () => {
    it('price with no dates: list_properties then the one property\'s details; the price is marked as a "desde" price', async () => {
        const h = harness({ list_properties: () => ({ properties: [PROPERTY] }), get_property_details: args => ({ ...DETAILS, id: args.propertyId }) });
        const run = await runRequiredReads(op('property_info'), h.io);
        expect(h.calls).toEqual([{ name: 'list_properties', args: {} }, { name: 'get_property_details', args: { propertyId: CABANA } }]);
        expect(run.outcome).toBe('read');
        const list = run.results[0].result;
        expect(list).toMatchObject({ properties: [expect.objectContaining({ nightPrice: 150000, minNights: 1 })], complete: true, total: 1, hasMore: false,
            priceBasis: 'from_nightly_price', priceNote: FROM_PRICE_NOTE });
        expect(run.reads[0]).toMatchObject({ tool: 'list_properties', status: 'read', rows: 1, complete: true, total: 1 });
    });

    it('a dated question forces the availability read: the list for those dates, then check_property_availability on the one property', async () => {
        const h = harness({
            list_properties: () => ({ properties: [{ ...PROPERTY, totalPrice: 300000, nights: 2 }] }),
            check_property_availability: () => ({ available: true, nights: 2, totalPrice: 300000, nightPrice: 150000, currency: 'COP' }),
            get_property_details: args => ({ ...DETAILS, id: args.propertyId }),
        });
        const slots = requiredReadSlotsIn('¿tienen disponible del 3 al 5 de diciembre para 2?', TODAY);
        for (const key of ['property_info', 'book_stay', 'stay_logistics']) {
            h.calls.length = 0;
            const run = await runRequiredReads(op(key), { ...h.io, slots, customerText: 'tienen disponible del 3 al 5 de diciembre para 2' });
            const dated = { guests: 2, checkIn: '2026-12-03', checkOut: '2026-12-05' };
            expect(h.calls[0]).toEqual({ name: 'list_properties', args: dated });
            expect(h.calls).toContainEqual({ name: 'check_property_availability', args: { propertyId: CABANA, ...dated } });
            // A dated list is the availability, not a "from" price.
            expect(run.results[0].result.priceNote).toBeUndefined();
        }
    });

    it('availability with no dates: check_property_availability is not run (the model asks), nothing is claimed', async () => {
        const h = harness({ list_properties: () => ({ properties: [PROPERTY] }) });
        const run = await runRequiredReads(op('book_stay'), { ...h.io, slots: {} });
        expect(h.calls.map(c => c.name)).toEqual(['list_properties']);
        expect(run.reads[1]).toEqual({ tool: 'check_property_availability', args: {}, status: 'missing_slot' });
    });

    it('schedule questions chain get_property_details: the only property, or the one the customer named; several unnamed is left to the model', async () => {
        const two = { properties: [PROPERTY, { ...PROPERTY, id: SUITE, name: 'Suite Mirador' }] };
        const h = harness({ list_properties: () => two, get_property_details: args => ({ ...DETAILS, id: args.propertyId }) });
        const named = await runRequiredReads(op('stay_logistics'), { ...h.io, customerText: '¿A qué hora es el check-in en la Suite Mirador?' });
        expect(h.calls).toEqual([{ name: 'list_properties', args: {} }, { name: 'get_property_details', args: { propertyId: SUITE } }]);
        expect(named.results[1].result).toMatchObject({ checkInTime: '15:00', checkOutTime: '11:00' });

        h.calls.length = 0;
        const unnamed = await runRequiredReads(op('property_info'), { ...h.io, customerText: 'a qué hora hay que entregar la habitación?' });
        expect(h.calls.map(c => c.name)).toEqual(['list_properties']);
        expect(unnamed.reads[1]).toEqual({ tool: 'get_property_details', args: {}, status: 'ambiguous_receipt' });
        expect(pickReceiptId(two, { tool: 'list_properties', container: 'properties', field: 'id' }, 'la suite')).toEqual({ reason: 'ambiguous_receipt' });
    });

    it('a failed read admits instead of returning an empty list', async () => {
        for (const failing of [() => ({ error: 'catalog_unavailable' }), () => { throw new Error('connection reset'); }]) {
            const h = harness({ list_properties: failing });
            const run = await runRequiredReads(op('property_info'), h.io);
            expect(run.outcome).toBe('admit');
            expect(run.results).toHaveLength(1);
            expect(run.results[0].result.properties).toBeUndefined();
            expect(run.results[0].result.message).toMatch(/^No pude consultar/);
            expect(run.reads[1]).toEqual({ tool: 'get_property_details', args: {}, status: 'upstream_failed' });
        }
        const tours = harness({ search_packages: () => { throw new Error('timeout'); } });
        const toursRun = await runRequiredReads(op('package_info'), tours.io);
        expect(toursRun.outcome).toBe('admit');
        expect(toursRun.results[0].result.packages).toBeUndefined();
        expect(toursRun.results[0].result.message).toMatch(/^No pude consultar/);
    });

    it('travel, open question: search_packages runs unfiltered and lists every package; the details are not guessed', async () => {
        const h = harness({ search_packages: () => ({ packages: PACKAGES }) });
        const run = await runRequiredReads(op('package_info'), { ...h.io, slots: {}, customerText: '¿qué planes manejan?' });
        expect(h.calls).toEqual([{ name: 'search_packages', args: {} }]);
        expect(run.results[0].result.packages).toHaveLength(2);
        expect(run.reads[1]).toEqual({ tool: 'get_package_details', args: {}, status: 'ambiguous_receipt' });
    });

    it('travel, availability with a date: check_package_availability on the named package with the date and the group', async () => {
        const h = harness({
            search_packages: () => ({ packages: PACKAGES }),
            check_package_availability: () => ({ available: true, seatsLeft: 8 }),
        });
        const text = '¿hay cupo en el Tour Cafetero para el 15 de noviembre para 4?';
        const run = await runRequiredReads(op('package_availability'), { ...h.io, slots: requiredReadSlotsIn(text, TODAY), customerText: text });
        expect(h.calls).toEqual([
            { name: 'search_packages', args: {} },
            { name: 'check_package_availability', args: { packageId: TOUR, date: '2026-11-15', partySize: 4 } },
        ]);
        expect(run.outcome).toBe('read');
    });

    it('travel, departures with no date: check_package_availability waits for a date and the package\'s upcoming departures are read', async () => {
        const h = harness({
            search_packages: () => ({ packages: [PACKAGES[0]] }),
            get_package_details: args => ({ id: args.packageId, name: 'Tour Cafetero', upcomingDepartures: [{ date: '2026-11-15', seatsLeft: 8 }] }),
        });
        const run = await runRequiredReads(op('package_availability'), { ...h.io, slots: {}, customerText: '¿cuándo salen?' });
        expect(h.calls.map(c => c.name)).toEqual(['search_packages', 'get_package_details']);
        expect(run.reads.map(r => [r.tool, r.status])).toEqual([
            ['search_packages', 'read'], ['check_package_availability', 'missing_slot'], ['get_package_details', 'read'],
        ]);
    });

    it('trace: the slot names (never their values) and the read statuses', () => {
        const trace = buildRequiredReadsTrace({
            pilot: 'properties', verdict: verdict('book_stay'), gate: { run: true, operation: op('book_stay'), pilot: 'properties' },
            run: { operationKey: 'book_stay', outcome: 'read', latencyMs: 3, results: [], reads: [{ tool: 'check_property_availability', args: {}, status: 'missing_slot' }] },
            latencyMs: 9, slots: { guests: 2, travellers: 2 },
        });
        expect(trace).toMatchObject({ pilot: 'properties', operation: 'book_stay', slots: ['guests', 'travellers'], reads: [{ tool: 'check_property_availability', status: 'missing_slot' }] });
    });
});
