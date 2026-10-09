import { ListingsService } from './listings.service';
import { ACCENT_FOLD_FROM, ACCENT_FOLD_TO } from '../../common/utils/sql-accent-fold.util';

/**
 * Inmobiliaria QA, 2026-10-09: the customer types «Usaquén» (or «Usaquen» on a phone) and the owner typed the other
 * one. `neighborhood ILIKE '%Usaquén%'` does not find «Usaquen»; both sides are now folded in SQL
 * (`translate`, no `unaccent` extension) so the accent is not part of the match.
 */
describe('ListingsService.search is accent-insensitive', () => {
    const schemaName = 'tenant_realestate';

    async function run(params: Parameters<ListingsService['search']>[1]) {
        const prisma = { executeInTenantSchema: jest.fn().mockResolvedValue([]) };
        const service = new ListingsService(prisma as any);
        await service.search(schemaName, params);
        const [, sql, values] = prisma.executeInTenantSchema.mock.calls[0];
        return { sql: String(sql), values: values as unknown[] };
    }

    // The same fold the SQL performs, to prove both spellings meet in the middle.
    const fold = (text: string) => [...text.normalize('NFC')].map((ch) => {
        const at = ACCENT_FOLD_FROM.indexOf(ch);
        return at < 0 ? ch : ACCENT_FOLD_TO[at];
    }).join('').toLowerCase();
    const contains = (column: string, pattern: string) => fold(column).includes(fold(pattern.replace(/^%|%$/g, '')));

    it('neighborhood and address are compared folded on BOTH sides, with one bound parameter', async () => {
        const { sql, values } = await run({ neighborhood: 'Usaquén' });
        expect(sql).toContain(`translate(neighborhood, '${ACCENT_FOLD_FROM}', '${ACCENT_FOLD_TO}')`);
        expect(sql).toContain(`translate(address, '${ACCENT_FOLD_FROM}', '${ACCENT_FOLD_TO}')`);
        expect(sql).toContain(`translate($1::text, '${ACCENT_FOLD_FROM}', '${ACCENT_FOLD_TO}')`);
        expect(sql).not.toMatch(/ILIKE/);
        expect(values).toEqual(['%Usaquén%']);
    });

    it('city is folded too, and the parameters keep their order next to the other filters', async () => {
        const { sql, values } = await run({ transactionType: 'sale', maxPrice: 600_000_000, neighborhood: 'Usaquen', city: 'Bogotá' });
        expect(sql).toContain(`translate(city, '${ACCENT_FOLD_FROM}', '${ACCENT_FOLD_TO}')`);
        expect(sql).toContain('transaction_type = $1');
        expect(sql).toContain('price <= $2');
        expect(values).toEqual(['sale', 600_000_000, '%Usaquen%', '%Bogotá%']);
    });

    it.each([
        ['Usaquén', 'Usaquen'],
        ['Usaquen', 'Usaquén'],
        ['Usaquén', 'USAQUÉN'],
        ['Chapinero Alto', 'chapinero'],
        ['Medellín', 'Medellin'],
    ])('a column holding «%s» is found by the search text «%s» (and the fold is symmetric)', (column, text) => {
        expect(contains(column, `%${text}%`)).toBe(true);
    });

    it('a search text typed with a decomposed accent is composed before binding', async () => {
        const { values } = await run({ neighborhood: 'Usaquén' });
        expect(values[0]).toBe('%Usaquén%');
    });

    it('the customer percent, underscore and backslash are text, not wildcards', async () => {
        const backslash = String.fromCharCode(92);
        const { values } = await run({ neighborhood: '100%_x' + backslash + 'y' });
        expect(values[0]).toBe('%100' + backslash + '%' + backslash + '_x' + backslash + backslash + 'y%');
    });
});
