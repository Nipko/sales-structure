import { catalogHasNoRows, markCatalogEmpty, CATALOG_EMPTY_PROBES } from './catalog-empty.util';

/**
 * «The business has published nothing yet» is not «nothing matches these filters». The catalogue readers stay
 * published for an empty catalogue, so the tool result is where the agent learns which of the two it is.
 */
describe('catalog_empty marker for catalogue readers', () => {
    const prisma = (rows: any[] | Error) => ({
        executeInTenantSchema: jest.fn().mockImplementation(async () => {
            if (rows instanceof Error) throw rows;
            return rows;
        }),
    });

    it('asks the SAME predicate readiness uses, with LIMIT 1', async () => {
        const db = prisma([]);
        await catalogHasNoRows(db, 'tenant_x', 'listings');
        const sql = String(db.executeInTenantSchema.mock.calls[0][1]);
        expect(sql).toContain('FROM real_estate_listings');
        expect(sql).toContain(`is_active = true AND status = 'available'`);
        expect(sql).toMatch(/LIMIT 1$/);
    });

    it.each([
        ['search_listings', 'listings', 'inmuebles'],
        ['search_packages', 'packages', 'paquetes'],
    ])('%s: an empty list over an empty catalogue is catalog_empty with instructions for the model', async (tool, listKey, noun) => {
        const result = await markCatalogEmpty(prisma([]), tool, 'tenant_x', { [listKey]: [] });

        expect(result.catalog_empty).toBe(true);
        expect(result[listKey]).toEqual([]);
        expect(result.message).toContain(noun);
        expect(result.message).toMatch(/catálogo está vacío/);
        expect(result.message).toMatch(/nunca digas que no puedes buscar/);
        expect(result.message).toMatch(/no pidas presupuesto, fechas ni datos personales/);
    });

    it('an empty list over a catalogue that HAS rows stays an ordinary «no matches» (no catalog_empty)', async () => {
        const original = { listings: [], message: 'No hay inmuebles con esos criterios.' };
        const result = await markCatalogEmpty(prisma([{ present: 1 }]), 'search_listings', 'tenant_x', original);

        expect(result).toBe(original);
        expect(result.catalog_empty).toBeUndefined();
    });

    it('a non-empty list is never touched and never probes the database', async () => {
        const db = prisma([]);
        const original = { listings: [{ id: 'l1' }] };
        expect(await markCatalogEmpty(db, 'search_listings', 'tenant_x', original)).toBe(original);
        expect(db.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('a date problem outranks an empty catalogue (the departure already passed is what the customer must hear)', async () => {
        const db = prisma([]);
        const original = { packages: [], reason: 'departure_in_past', message: 'Esa fecha de salida ya pasó.' };
        expect(await markCatalogEmpty(db, 'search_packages', 'tenant_x', original)).toBe(original);
        expect(db.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('a failed read is never turned into «the catalogue is empty»', async () => {
        const db = prisma([]);
        const failed = { error: 'tool_failed', packages: [] };
        expect(await markCatalogEmpty(db, 'search_packages', 'tenant_x', failed)).toBe(failed);
        expect(db.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('a probe that itself fails is «unknown», not «empty»', async () => {
        const original = { listings: [] };
        expect(await markCatalogEmpty(prisma(new Error('connection reset')), 'search_listings', 'tenant_x', original)).toBe(original);
        expect(await catalogHasNoRows(prisma(new Error('connection reset')), 'tenant_x', 'listings')).toBeNull();
    });

    it('a table the tenant never provisioned counts as an empty catalogue, like readiness reads it', async () => {
        expect(await catalogHasNoRows(prisma(Object.assign(new Error('relation does not exist'), { code: '42P01' })), 'tenant_x', 'tour_packages')).toBe(true);
    });

    it('tools without a probe are returned untouched', async () => {
        const original = { slots: [] };
        expect(await markCatalogEmpty(prisma([]), 'check_availability', 'tenant_x', original)).toBe(original);
    });

    it('every probe names a list key and a noun', () => {
        for (const probe of Object.values(CATALOG_EMPTY_PROBES)) {
            expect(probe.listKey.length).toBeGreaterThan(0);
            expect(probe.noun.length).toBeGreaterThan(0);
        }
    });
});
