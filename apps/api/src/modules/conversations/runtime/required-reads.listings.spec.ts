import { getOperation, getOperationCatalogue } from '@parallext/shared';
import {
    buildRequiredReadsTrace,
    REQUIRED_READS_PILOT_OPERATIONS,
    requiredReadsGate,
    requiredReadsPilotForProfile,
    requiredReadsPlan,
    runRequiredReads,
    withListEvidence,
} from './required-reads.runner';
import { listingSearchSlotsIn, requiredReadSlotsIn } from './required-read-slots';
import type { OperationShadowVerdict } from './operation-classifier.service';

/**
 * The required-reads runner for real estate (`listings`, flag `agentRuntime.requiredReads.listings`).
 * Production QA (real-estate QA tenant, gpt-4.1-mini, after #177): with search_listings in the turn «250.000 EUR, venta, 1 baño,
 * 80 m²» 2/2; without it «El precio del apartamento no está confirmado» and an advisor 0/3; «2 baños» invented with no
 * get_listing_details; «¿qué propiedades tienen?» answered with three filter questions while the agency has one listing.
 */
const verdict = (operationKey: string, confidence = 0.92): OperationShadowVerdict =>
    ({ version: 1, operationKey, confidence, fallback: null, candidates: [operationKey], latencyMs: 5 });

const op = (key: string) => {
    const operation = getOperation(key);
    if (!operation) throw new Error(`missing operation ${key}`);
    return operation;
};

const CHAPINERO = '55555555-5555-4555-8555-555555555555';
const ROSALES = '66666666-6666-4666-8666-666666666666';
const LISTING = {
    id: CHAPINERO, name: 'Apartamento Chapinero', transactionType: 'sale', propertyKind: 'apartment',
    price: 250000, priceStatus: 'confirmed', currency: 'EUR', bedrooms: 2, bathrooms: 1, areaM2: 80, status: 'available',
};
const DETAILS = { ...LISTING, address: 'Calle 60 # 5-20', amenities: ['ascensor'], hoaFee: null, externalUrl: null };

function harness(results: Record<string, (args: any) => any>, extra: Partial<Parameters<typeof runRequiredReads>[1]> = {}) {
    const calls: Array<{ name: string; args: any }> = [];
    return {
        calls,
        io: {
            publishedTools: ['search_listings', 'get_listing_details', 'send_listing_image', 'check_availability', 'create_appointment'],
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

const io = (text: string) => ({ slots: listingSearchSlotsIn(text), customerText: text });

describe('required reads, real estate: pilot and gate', () => {
    it('every inmobiliaria profile is the listings pilot (tool family realEstate); the other pilots are unchanged', () => {
        const realEstate = [...new Set(getOperationCatalogue().filter(o => o.toolGroup === 'realEstate').flatMap(o => o.profiles))];
        expect(realEstate.length).toBeGreaterThan(0);
        for (const profile of realEstate) {
            expect(profile.split('/')[0]).toBe('inmobiliaria');
            expect(requiredReadsPilotForProfile(profile)).toBe('listings');
        }
        expect(requiredReadsPilotForProfile('turismo/hotel')).toBe('properties');
        expect(requiredReadsPilotForProfile('turismo/tours')).toBe('tours');
        expect(requiredReadsPilotForProfile('restaurantes/casual_dining')).toBe('restaurants');
        expect(requiredReadsPilotForProfile('retail/electronica')).toBe('catalog');
    });

    it('the pilot operations are the catalogue\'s listing_info and find_listing; another vertical\'s operation is a mismatch', () => {
        const keys = Object.entries(REQUIRED_READS_PILOT_OPERATIONS).filter(([, pilot]) => pilot === 'listings').map(([key]) => key).sort();
        expect(keys).toEqual(['find_listing', 'listing_info']);
        for (const key of keys) {
            expect(op(key).toolGroup).toBe('realEstate');
            expect(op(key).writers).toEqual(key === 'find_listing' ? ['send_listing_image'] : []);
        }
        expect(requiredReadsGate(verdict('listing_info'), 'properties')).toEqual({ run: false, reason: 'pilot_mismatch' });
        expect(requiredReadsGate(verdict('property_info'), 'listings')).toEqual({ run: false, reason: 'pilot_mismatch' });
        expect(requiredReadsGate(verdict('product_info'), 'listings')).toEqual({ run: false, reason: 'pilot_mismatch' });
        // A visit is the appointment flow: not a pilot operation, its writes are untouched.
        expect(requiredReadsGate(verdict('book_appointment'), 'listings')).toEqual({ run: false, reason: 'not_pilot_operation' });
        expect(requiredReadsGate(verdict('listing_info', 0.79), 'listings')).toEqual({ run: false, reason: 'below_threshold' });
        const gate = requiredReadsGate(verdict('find_listing'), 'listings');
        expect(gate.run && gate.operation.key).toBe('find_listing');
    });

    it('the plan: listing_info reads the search then the details; an open browse question reads only the search', () => {
        const tools = (key: string) => requiredReadsPlan(op(key), listingSearchSlotsIn('apartamento en venta')).map(r => r.tool);
        expect(tools('listing_info')).toEqual(['search_listings', 'get_listing_details']);
        expect(tools('find_listing')).toEqual(['search_listings']);
    });
});

describe('required reads, real estate: the filters the message states', () => {
    it.each([
        ['¿cuál es el precio del apartamento?', { property_kind: 'apartment' }],
        ['cuántos baños tiene?', {}],
        ['¿qué propiedades tienen?', {}],
        ['¿cuántos metros tiene el apartamento en venta?', { operation: 'sale', property_kind: 'apartment' }],
        ['tienen casas en arriendo de 3 habitaciones?', { operation: 'rent', property_kind: 'house', bedrooms: 3 }],
        ['busco un apartamento para alquilar con dos habitaciones', { operation: 'rent', property_kind: 'apartment', bedrooms: 2 }],
        ['how much is the apartment for sale?', { operation: 'sale', property_kind: 'apartment' }],
        // Both operations, or two kinds: no single filter.
        ['¿está en venta o en arriendo?', {}],
        ['casa o apartamento, lo que tengan', {}],
        // «vender mi casa» is the customer selling, not a search for sale listings.
        ['quiero vender mi casa', { property_kind: 'house' }],
    ])('«%s»', (text, slots) => {
        expect(listingSearchSlotsIn(text)).toEqual(slots);
    });

    it('the lodging and travel slots are untouched by the real-estate words', () => {
        expect(requiredReadSlotsIn('¿cuál es el precio del apartamento en venta?', '2026-10-22')).toEqual({});
    });
});

describe('required reads, real estate: runner', () => {
    it('«¿cuál es el precio del apartamento?»: search_listings with the stated kind, then the one listing\'s details', async () => {
        const h = harness({ search_listings: () => ({ listings: [LISTING] }), get_listing_details: args => ({ ...DETAILS, id: args.listingId }) });
        const run = await runRequiredReads(op('listing_info'), { ...h.io, ...io('¿cuál es el precio del apartamento?') });
        expect(h.calls).toEqual([
            { name: 'search_listings', args: { propertyKind: 'apartment' } },
            { name: 'get_listing_details', args: { listingId: CHAPINERO } },
        ]);
        expect(run.outcome).toBe('read');
        expect(run.results[0].result).toMatchObject({ listings: [expect.objectContaining({ price: 250000, currency: 'EUR' })], complete: true, total: 1, hasMore: false });
        expect(run.results[1].result).toMatchObject({ bathrooms: 1, areaM2: 80, transactionType: 'sale' });
        expect(run.reads[0]).toMatchObject({ tool: 'search_listings', status: 'read', rows: 1, complete: true, total: 1 });
    });

    it('«¿cuántos baños tiene?» with no filter: unfiltered search and the only listing\'s details (never a guessed count)', async () => {
        const h = harness({ search_listings: () => ({ listings: [LISTING] }), get_listing_details: args => ({ ...DETAILS, id: args.listingId }) });
        const run = await runRequiredReads(op('listing_info'), { ...h.io, ...io('cuántos baños tiene?') });
        expect(h.calls).toEqual([{ name: 'search_listings', args: {} }, { name: 'get_listing_details', args: { listingId: CHAPINERO } }]);
        expect(run.results[1].result.bathrooms).toBe(1);
    });

    it('«¿qué propiedades tienen?»: the search runs unfiltered and the whole (complete) list reaches the model; no details are guessed', async () => {
        const h = harness({ search_listings: () => ({ listings: [LISTING] }) });
        const run = await runRequiredReads(op('find_listing'), { ...h.io, ...io('¿qué propiedades tienen?') });
        expect(h.calls).toEqual([{ name: 'search_listings', args: {} }]);
        expect(run.results[0].result).toMatchObject({ complete: true, total: 1, hasMore: false });
        expect(run.reads).toEqual([expect.objectContaining({ tool: 'search_listings', status: 'read' })]);
    });

    it('a named listing gets its details; several unnamed is ambiguous_receipt and left to the model', async () => {
        const two = { listings: [LISTING, { ...LISTING, id: ROSALES, name: 'Casa Rosales', propertyKind: 'house', price: 410000 }] };
        const h = harness({ search_listings: () => two, get_listing_details: args => ({ ...DETAILS, id: args.listingId, name: 'Casa Rosales' }) });
        const named = await runRequiredReads(op('listing_info'), { ...h.io, ...io('¿cuántos baños tiene la Casa Rosales?') });
        expect(h.calls).toEqual([
            { name: 'search_listings', args: { propertyKind: 'house' } },
            { name: 'get_listing_details', args: { listingId: ROSALES } },
        ]);
        expect(named.outcome).toBe('read');

        h.calls.length = 0;
        const unnamed = await runRequiredReads(op('listing_info'), { ...h.io, ...io('¿cuántos metros tiene?') });
        expect(h.calls.map(c => c.name)).toEqual(['search_listings']);
        expect(unnamed.reads[1]).toEqual({ tool: 'get_listing_details', args: {}, status: 'ambiguous_receipt' });
    });

    it('a failed read admits instead of returning an empty list', async () => {
        for (const failing of [() => ({ error: 'listings_unavailable' }), () => { throw new Error('connection reset'); }]) {
            const h = harness({ search_listings: failing });
            const run = await runRequiredReads(op('listing_info'), { ...h.io, ...io('¿cuál es el precio del apartamento?') });
            expect(run.outcome).toBe('admit');
            expect(run.results).toHaveLength(1);
            expect(run.results[0].result.listings).toBeUndefined();
            expect(run.results[0].result.message).toMatch(/^No pude consultar/);
            expect(run.reads[1]).toEqual({ tool: 'get_listing_details', args: {}, status: 'upstream_failed' });
        }
        const details = harness({ search_listings: () => ({ listings: [LISTING] }), get_listing_details: () => ({ error: 'listing_not_found' }) });
        const run = await runRequiredReads(op('listing_info'), { ...details.io, ...io('cuántos baños tiene?') });
        expect(run.outcome).toBe('admit');
        expect(run.results[1].result).toMatchObject({ requiredRead: true, message: expect.stringMatching(/^No pude consultar/) });
        expect(run.results[1].result.bathrooms).toBeUndefined();
    });

    it('reads the turn already ran are reused: the automatic search and the automatic detail lookup (recorded without args)', async () => {
        const h = harness({});
        const run = await runRequiredReads(op('listing_info'), {
            ...h.io, ...io('cuántos baños tiene?'),
            alreadyRead: [{ name: 'search_listings', result: { listings: [LISTING] } }, { name: 'get_listing_details', result: DETAILS }],
        });
        expect(h.calls).toEqual([]);
        expect(run.reads.map(r => [r.tool, r.status])).toEqual([['search_listings', 'already_read'], ['get_listing_details', 'already_read']]);
        expect(run.outcome).toBe('nothing_to_run');
    });

    it('a full page of 8 search results is not claimed complete', () => {
        const eight = { listings: Array.from({ length: 8 }, (_, i) => ({ ...LISTING, id: `l${i}` })) };
        expect(withListEvidence('search_listings', {}, eight)).toMatchObject({ rows: 8, complete: false, result: { hasMore: true, complete: false } });
        expect(withListEvidence('search_listings', {}, eight).result.total).toBeUndefined();
        // closestMatches is not the match list.
        const near = withListEvidence('search_listings', { propertyKind: 'house' }, { listings: [], closestMatches: [LISTING] });
        expect(near).toMatchObject({ rows: 0, complete: true, total: 0 });
        expect(near.result.closestMatches).toHaveLength(1);
    });

    it('trace: the slot names (never their values) and the read statuses', () => {
        const trace = buildRequiredReadsTrace({
            pilot: 'listings', verdict: verdict('listing_info'), gate: { run: true, operation: op('listing_info'), pilot: 'listings' },
            run: { operationKey: 'listing_info', outcome: 'read', latencyMs: 3, results: [], reads: [{ tool: 'search_listings', args: { propertyKind: 'apartment' }, status: 'read', rows: 1, complete: true, total: 1 }] },
            latencyMs: 9, slots: { property_kind: 'apartment' },
        });
        expect(trace).toMatchObject({ pilot: 'listings', operation: 'listing_info', slots: ['property_kind'], reads: [{ tool: 'search_listings', status: 'read', rows: 1, total: 1 }] });
        expect(JSON.stringify(trace)).not.toContain('apartment');
    });
});
