import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { ConversationsService } from './conversations.service';

/**
 * Production 2026-10-10, Tienda QA Electrónica: «quisiera comprar audífonos aurora» was answered «no hay audífonos Aurora disponibles en
 * nuestro catálogo» about the «Audífono QA Aurora» on sale. The words of a search find a product whatever the plural, the case, the
 * accent, the order and the words of the name the customer left out (catalog-search-tolerant.spec.ts reads the SQL; this runs it).
 *
 * Runs against the disposable PostgreSQL only (PARALLLY_ISOLATION_TEST_URL): the folding and the word matching are SQL, and a mock cannot
 * say whether the database agrees with the expectation.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('catalogue search by words on PostgreSQL', () => {
    jest.setTimeout(120_000);
    const schema = `tenant_words_${randomUUID().replace(/-/g, '')}`;
    let client: PrismaClient;
    let executor: any;

    const catalogue: Array<[string, string, number | null]> = [
        ['Audífono QA Aurora', 'Audio', 2],
        ['Cargador QA Nova', 'Accesorios', 5],
        ['Pantalones de lino', 'Ropa', 3],
        ['Camisa azul', 'Ropa', 4],
        ['Aurora', 'Otros', 1],
    ];

    beforeAll(async () => {
        const parsed = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || !parsed.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await client.$executeRawUnsafe(`CREATE TABLE "${schema}".products(
            id UUID PRIMARY KEY, name VARCHAR(500) NOT NULL, description TEXT, category VARCHAR(255), price DECIMAL(15, 2) NOT NULL DEFAULT 0, currency VARCHAR(10) DEFAULT 'COP',
            stock INTEGER, is_available BOOLEAN DEFAULT true, images JSONB DEFAULT '[]', metadata JSONB DEFAULT '{}',
            requires_prescription BOOLEAN DEFAULT false)`);
        for (const [name, category, stock] of catalogue) {
            await client.$executeRawUnsafe(
                `INSERT INTO "${schema}".products(id,name,description,category,price,currency,stock) VALUES($1::uuid,$2,$3,$4,$5::numeric,'COP',$6::int)`,
                randomUUID(), name, `Descripción de ${name}`, category, 100000, stock);
        }
        executor = Object.create(AIToolExecutorService.prototype);
        executor.prisma = client;
        executor.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_words_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
        } finally { await client.$disconnect(); }
    });

    const names = (result: any): string[] => (result.products ?? []).map((product: any) => product.name).sort();

    describe('search_products', () => {
        it.each(['audífonos aurora', 'Audifono Aurora', 'AUDÍFONOS AURORA', 'aurora audífono', 'audífono qa aurora'])('«%s» finds the product', async said => {
            expect(names(await executor.searchProducts(schema, said))).toContain('Audífono QA Aurora');
        });

        it('every word is needed: another product is not an answer', async () => {
            expect(names(await executor.searchProducts(schema, 'cargadores aurora'))).toEqual([]);
        });

        it('the plural of a word that ends in a consonant finds the singular name, and the other way round', async () => {
            expect(names(await executor.searchProducts(schema, 'camisas azules'))).toEqual(['Camisa azul']);
            expect(names(await executor.searchProducts(schema, 'pantalón de lino'))).toEqual(['Pantalones de lino']);
            expect(names(await executor.searchProducts(schema, 'cargador'))).toEqual(['Cargador QA Nova']);
        });

        it('an empty search lists the catalogue, and a customer\'s % is text', async () => {
            expect((await executor.searchProducts(schema, '', 20)).products).toHaveLength(catalogue.length);
            expect(names(await executor.searchProducts(schema, '100%'))).toEqual([]);
        });
    });

    describe('check_stock / get_product by a partial name', () => {
        it('«audífonos aurora» is the one product that holds both words', async () => {
            const stock = await executor.checkStock(schema, 'audífonos aurora');
            expect(stock).toMatchObject({ name: 'Audífono QA Aurora', stock: 2 });
        });

        it('a word that is the whole name of one product and part of another: the exact name wins', async () => {
            // «aurora» is the exact name of the one-word product, which the exact lookup finds first
            expect(await executor.checkStock(schema, 'aurora')).toMatchObject({ name: 'Aurora' });
        });
    });

    describe('the catalogue the turn is given (more than twelve products: only the ones the message names are listed)', () => {
        it('lists the product the customer named in the plural, without its «QA»', async () => {
            const fillers = Array.from({ length: 14 }, (_, index) => `Relleno ${index + 1}`);
            for (const name of fillers) {
                await client.$executeRawUnsafe(
                    `INSERT INTO "${schema}".products(id,name,description,category,price,currency,stock) VALUES($1::uuid,$2,'relleno','Otros',1000,'COP',1)`, randomUUID(), name);
            }
            const service: any = Object.create(ConversationsService.prototype);
            service.prisma = {
                // the production primitive runs in the tenant schema; here the table is qualified instead
                executeInTenantSchema: (_schema: string, sql: string, params: unknown[]) =>
                    client.$queryRawUnsafe(sql.replace('FROM products', `FROM "${schema}".products`), ...params),
            };
            const titles = (rows: any[]) => rows.map(row => row.title).sort();
            expect(titles(await service.loadOwnCatalogForTurn(schema, 'quisiera comprar audífonos aurora'))).toEqual(['Audífono QA Aurora', 'Aurora']);
            expect(titles(await service.loadOwnCatalogForTurn(schema, 'quisiera comprar el cargador nova'))).toEqual(['Cargador QA Nova']);
            expect(await service.loadOwnCatalogForTurn(schema, 'hola, buenas tardes')).toEqual([]);
            await client.$executeRawUnsafe(`DELETE FROM "${schema}".products WHERE name LIKE 'Relleno %'`);
        });
    });
});
