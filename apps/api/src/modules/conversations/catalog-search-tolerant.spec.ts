import { AIToolExecutorService } from './ai-tool-executor.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { foldedSql } from '../../common/utils/sql-accent-fold.util';
import { ConversationsService } from './conversations.service';
import { EcommerceService } from '../ecommerce/ecommerce.service';
import { TenantSecretCryptoService } from '../../common/crypto/tenant-secret-crypto.service';

/**
 * Production 2026-10-10, Tienda QA Electrónica: «quisiera comprar audífonos aurora» was answered «no hay audífonos Aurora disponibles en
 * nuestro catálogo» about the «Audífono QA Aurora» on sale (the second attempt, minutes later, found it). The tool searched for the WHOLE
 * text as one substring of the name: plural, lower case and a missing «QA» made it a miss.
 *
 * Without a database the SQL is read, not run: the predicate must be one condition PER significant word (so a plural, a different order
 * or a missing word of the name still finds the product), each folded in SQL, and an empty result must stay «nothing matched», never a
 * failure. The same words are exercised against PostgreSQL in ai-tool-executor.product-lookup.postgres.spec.ts.
 */
const schemaName = 'tenant_catalog';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';

function createExecutor(queryRawUnsafe: jest.Mock) {
    const control = {
        preflight: jest.fn().mockResolvedValue({ allowed: true, idempotencyKey: 'catalog-call' }),
        complete: jest.fn().mockResolvedValue(undefined),
        fail: jest.fn().mockResolvedValue(undefined),
    };
    const stub = () => ({}) as any;
    const executor = new AIToolExecutorService(
        { $queryRawUnsafe: queryRawUnsafe } as any,
        stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
        stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
        control as any,
        { preparePaymentLink: jest.fn(), confirmationRequiredResult: jest.fn() } as any,
        stub(),
        undefined as any,
    );
    jest.spyOn((executor as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((executor as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((executor as any).logger, 'error').mockImplementation(() => undefined);
    return executor;
}

const search = (executor: AIToolExecutorService, query: string) => executor.execute(
    schemaName, tenantId, contactId, 'search_products', { query }, conversationId, { authority: authorityFor('search_products') });

describe('search_products finds a product by its significant words', () => {
    it.each(['audífonos aurora', 'Audifono Aurora', 'AUDÍFONOS AURORA', 'audífonos Aurora'])(
        '«%s»: one folded condition per word, each a substring of the singular and the plural spelling', async said => {
            const query = jest.fn().mockResolvedValue([]);
            await search(createExecutor(query), said);
            const [sql, ...params] = query.mock.calls[0];
            const name = foldedSql('name');
            // two words, two conditions: not one LIKE over «audifonos aurora» (the defect)
            expect(sql.split(`${name} LIKE`).length - 1).toBe(2);
            expect(params.slice(0, 2)).toEqual(['%audifono%', '%aurora%']);
            expect(sql).toContain('is_available = true');
            expect(params[params.length - 1]).toBe(5);
        });

    it('a single-word search and an empty one behave as before (one pattern, or all of the catalogue)', async () => {
        const one = jest.fn().mockResolvedValue([]);
        await search(createExecutor(one), 'ibuprofeno');
        expect(one.mock.calls[0].slice(1, 2)).toEqual(['%ibuprofeno%']);
        const none = jest.fn().mockResolvedValue([]);
        await search(createExecutor(none), '');
        expect(none.mock.calls[0].slice(1, 2)).toEqual(['%%']);
    });

    it('a failed read is still «could not read», and an empty one is «nothing matched»', async () => {
        const empty = await search(createExecutor(jest.fn().mockResolvedValue([])), 'audífonos aurora');
        expect(JSON.stringify(empty)).not.toContain('read_failed');
        const failed = await search(createExecutor(jest.fn().mockRejectedValue(new Error('db down'))), 'audífonos aurora');
        expect(JSON.stringify(failed)).toContain('read_failed');
    });

    it('the exact-name lookups (get_product / check_stock) accept the same words when the name is the only one that holds them', async () => {
        const row = { id: 'p1', name: 'Audífono QA Aurora', price: 119900, currency: 'COP', stock: 2, is_available: true, requires_prescription: false };
        const query = jest.fn()
            .mockResolvedValueOnce([])           // exact name: nothing
            .mockResolvedValueOnce([row]);       // «contains»: the sole product that holds every word
        const found: any = await (createExecutor(query) as any).checkStock(schemaName, 'audífonos aurora');
        expect(found.name).toBe('Audífono QA Aurora');
        const [sql, ...params] = query.mock.calls[1];
        expect(sql.split('LIKE').length - 1).toBe(2);
        expect(params).toEqual(['%audifono%', '%aurora%']);
    });

    it('two products that hold every word are ambiguous: none is picked', async () => {
        const rows = [
            { id: 'p1', name: 'Audífono QA Aurora', price: 1, currency: 'COP', stock: 2, is_available: true },
            { id: 'p2', name: 'Audífono QA Aurora Pro', price: 2, currency: 'COP', stock: 2, is_available: true },
        ];
        const query = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(rows);
        const found: any = await (createExecutor(query) as any).checkStock(schemaName, 'audífonos aurora');
        expect(JSON.stringify(found)).not.toContain('Audífono QA Aurora');
    });
});

describe('the catalogue the turn is given lists a product the customer named in the plural', () => {
    it('the «mentioned» flag also holds when every word of the name (3+ letters) is in the message', async () => {
        const executeInTenantSchema = jest.fn().mockResolvedValue([]);
        const service: any = Object.create(ConversationsService.prototype);
        service.prisma = { executeInTenantSchema };
        await service.loadOwnCatalogForTurn('tenant_x', 'quisiera comprar audífonos aurora');
        const [, sql, params] = executeInTenantSchema.mock.calls[0];
        // the whole name inside the message (as before) OR every word of the name inside it (plural, missing «QA»)
        expect(sql).toContain('AS mentioned');
        expect(sql).toMatch(/unnest\(regexp_split_to_array\(/);
        expect(sql).toMatch(/COALESCE\(\(SELECT bool_and\(position\(word IN /);
        expect(params[0]).toBe('quisiera comprar audífonos aurora');
    });
});

describe('the connected store catalogue is searched by the same words', () => {
    it('one folded condition per word of the search, each a substring of the singular and the plural', async () => {
        const executeInTenantSchema = jest.fn().mockResolvedValue([]);
        const prisma = { assertTenantSchemaName: jest.fn(), $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: 1 }]), executeInTenantSchema };
        const service = new EcommerceService(prisma as any, {} as any, {} as any, new TenantSecretCryptoService());
        await service.searchProductsForAI('tenant_test', { search: 'Camisas azules' }, { createTablesIfMissing: false });
        const [, sql, params] = executeInTenantSchema.mock.calls[0];
        expect(sql.split(foldedSql('title') + ' LIKE').length - 1).toBe(2);
        expect(params).toEqual(['%camisa%', '%azul%']);
    });
});
