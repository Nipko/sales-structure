import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { AIToolExecutorService } from './ai-tool-executor.service';

/**
 * A customer types "Audifono" and the catalogue says "Audífono"; a Portuguese
 * speaker types "coracao" for "Coração"; a French one "coeur" for "Cœur".
 * The lookup used to be a literal ILIKE, so the agent told the customer the
 * product does not exist. And `check_stock` answered without a price, so the
 * agent either invented one or skipped it.
 *
 * Runs against the disposable PostgreSQL only: the folding is SQL, and a mock
 * cannot say whether the database agrees with the expectation.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('catalogue lookups on PostgreSQL', () => {
    jest.setTimeout(120_000);
    const schema = `tenant_lookup_${randomUUID().replace(/-/g, '')}`;
    let client: PrismaClient;
    let executor: any;

    const ids: Record<string, string> = {};
    const catalogue: Array<[string, string, number, string, number | null]> = [
        // key, name, price, currency, stock
        ['audifono', 'Audífono Bluetooth', 129900, 'COP', 4],
        ['canon', 'Cañón de Luz', 450000, 'COP', 0],
        ['coracao', 'Coração de Café', 18.5, 'BRL', 12],
        ['limoes', 'Limões Sicilianos', 7.25, 'EUR', 30],
        ['pessego', 'Pêssego em Calda', 9, 'EUR', 3],
        ['coeur', 'Cœur de Lyon', 22, 'EUR', 8],
        ['creme', 'Crème Brûlée', 6.5, 'EUR', 15],
        ['naive', 'Naïve Noël', 11, 'EUR', 2],
        ['pate', 'Pâté à l’Île', 14, 'EUR', 5],
        ['hay', 'Haÿ-les-Roses', 3, 'EUR', 1],
        ['plain', 'Cable USB', 5, 'USD', 100],
        // Differ only by the accent: the exact spelling must win, deterministically.
        ['proPlain', 'Audifono Pro', 80000, 'COP', 1],
        ['proAccent', 'Audífono Pro', 90000, 'COP', 2],
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
        for (const [key, name, price, currency, stock] of catalogue) {
            ids[key] = randomUUID();
            await client.$executeRawUnsafe(
                `INSERT INTO "${schema}".products(id,name,description,category,price,currency,stock) VALUES($1::uuid,$2,$3,$4,$5::numeric,$6,$7::int)`,
                ids[key], name, `Descripción de ${name}`, 'Catálogo', price, currency, stock);
        }
        executor = Object.create(AIToolExecutorService.prototype);
        executor.prisma = client;
        executor.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_lookup_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
        } finally { await client.$disconnect(); }
    });

    describe('check_stock', () => {
        it('returns the price and currency, like get_product', async () => {
            const stock = await executor.checkStock(schema, ids.audifono);
            expect(stock).toMatchObject({ id: ids.audifono, stock: 4, inStock: true, price: 129900, currency: 'COP' });
            const product = await executor.getProduct(schema, ids.audifono);
            expect({ price: stock.price, currency: stock.currency }).toEqual({ price: product.price, currency: product.currency });
        });

        it('still reports the price of a product that is out of stock', async () => {
            expect(await executor.checkStock(schema, ids.canon))
                .toMatchObject({ inStock: false, stock: 0, price: 450000, currency: 'COP' });
        });

        it('keeps a fractional price exact', async () => {
            expect(await executor.checkStock(schema, ids.coracao)).toMatchObject({ price: 18.5, currency: 'BRL' });
        });
    });

    // query typed by the customer -> catalogue key that must be found
    const folded: Array<[string, string]> = [
        ['Audifono Bluetooth', 'audifono'],
        ['audifono bluetooth', 'audifono'],
        ['AUDIFONO BLUETOOTH', 'audifono'],
        ['Audífono Bluetooth', 'audifono'],
        ['Audi\u0301fono Bluetooth', 'audifono'],          // decomposed (NFD) input
        ['Canon de Luz', 'canon'],                         // ñ and ó
        ['coracao de cafe', 'coracao'],                    // ç ã é
        ['limoes sicilianos', 'limoes'],                   // õ
        ['pessego em calda', 'pessego'],                   // ê
        ['coeur de lyon', 'coeur'],                        // œ
        ['creme brulee', 'creme'],                         // è û
        ['naive noel', 'naive'],                           // ï ë
        ['pate a l’ile', 'pate'],                     // â à î
        ['hay-les-roses', 'hay'],                          // ÿ
    ];

    describe.each(['checkStock', 'getProduct'] as const)('%s ignores accents and case', method => {
        it.each(folded)('finds "%s"', async (typed, key) => {
            const result = await executor[method](schema, typed);
            expect(result.error).toBeUndefined();
            expect(result.id).toBe(ids[key]);
        });

        it('finds an unaccented catalogue name from an accented query', async () => {
            expect((await executor[method](schema, 'Cáblé ÚSB')).id).toBe(ids.plain);
        });

        it('does not turn a different word into a match', async () => {
            const result = await executor[method](schema, 'audifonos');
            expect(result.id).toBeUndefined();
        });

        it('treats LIKE wildcards in the customer text literally', async () => {
            expect((await executor[method](schema, '%')).id).toBeUndefined();
            expect((await executor[method](schema, 'audifono_bluetooth')).id).toBeUndefined();
        });
    });

    describe.each(['checkStock', 'getProduct'] as const)('%s with two names that differ only by the accent', method => {
        it('returns the exact spelling the customer typed, on every call', async () => {
            for (let i = 0; i < 5; i++) {
                expect((await executor[method](schema, 'Audifono Pro')).id).toBe(ids.proPlain);
                expect((await executor[method](schema, 'Audífono Pro')).id).toBe(ids.proAccent);
            }
        });

        it('falls back to a stable choice when neither is typed exactly', async () => {
            const first = (await executor[method](schema, 'AUDIFONO PRO')).id;
            for (let i = 0; i < 5; i++) expect((await executor[method](schema, 'AUDIFONO PRO')).id).toBe(first);
        });
    });

    it('search_products treats % and _ as text and folds the category filter', async () => {
        expect((await executor.searchProducts(schema, '%', 5)).products).toHaveLength(0);
        expect((await executor.searchProducts(schema, 'audifono_pro', 5)).products).toHaveLength(0);
        const byCategory = await executor.searchProducts(schema, 'cable', 5, 'catalogo');
        expect(byCategory.products.map((p: any) => p.id)).toContain(ids.plain);
    });

    it('search_products finds by an unaccented word too', async () => {
        const result = await executor.searchProducts(schema, 'audifono', 5);
        expect(result.products.map((p: any) => p.id)).toContain(ids.audifono);
        const french = await executor.searchProducts(schema, 'coeur', 5);
        expect(french.products.map((p: any) => p.id)).toContain(ids.coeur);
        // ...and an accented query finds an unaccented catalogue name.
        const accented = await executor.searchProducts(schema, 'cáblé', 5);
        expect(accented.products.map((p: any) => p.id)).toContain(ids.plain);
        // NFD input from a keyboard or a pasted message.
        const decomposed = await executor.searchProducts(schema, 'AUDI\u0301FONO', 5);
        expect(decomposed.products.map((p: any) => p.id)).toContain(ids.audifono);
    });
});
