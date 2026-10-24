import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { AIToolExecutorService } from './ai-tool-executor.service';

/**
 * F4300-29, second residual: the «mentioned» rule of the not-for-sale read is SQL (accent folding, word splitting, word starts), so a
 * mock cannot say whether PostgreSQL agrees (sold-out-name-autoread.f4300.spec.ts reads the SQL; this runs it). The store's automatic
 * read runs with `query: ''` and the customer's message from the server; a product not for sale that the message names comes back
 * under `notForSale`, and `products` stays the for-sale list.
 *
 * Runs against the disposable PostgreSQL only (PARALLLY_ISOLATION_TEST_URL).
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('F4300-29 not-for-sale products named by the message, on PostgreSQL', () => {
    jest.setTimeout(120_000);
    const schema = `tenant_soldout_${randomUUID().replace(/-/g, '')}`;
    let client: PrismaClient;
    let executor: any;

    const catalogue: Array<[string, boolean, number | null]> = [
        ['Audífono QA Aurora', true, 5],
        ['QA Agente Stock 20261020T1737Z', false, 0],
        ['Gorra Roja', true, 0],
        ['Cámara Óptica', false, 3],
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
        for (const [name, available, stock] of catalogue) {
            await client.$executeRawUnsafe(
                `INSERT INTO "${schema}".products(id,name,price,currency,stock,is_available) VALUES($1::uuid,$2,100000,'COP',$3::int,$4)`,
                randomUUID(), name, stock, available);
        }
        executor = Object.create(AIToolExecutorService.prototype);
        executor.prisma = client;
        executor.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_soldout_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
        } finally { await client.$disconnect(); }
    });

    const browse = (message: string) => executor.searchProducts(schema, '', 20, undefined, undefined, undefined, message);
    const notForSale = (result: any): string[] => (result.notForSale ?? []).map((p: any) => p.name).sort();

    it.each([
        'tienen el QA Agente Stock?', 'vocês têm o QA Agente Stock?', 'do you have the QA Agente Stock?', 'avez-vous le QA Agente Stock ?',
        'me vendes el QA Agente Stock?', 'TIENEN EL AGENTE STOCK???',
    ])('«%s» names the product not for sale', async message => {
        const result = await browse(message);
        expect(notForSale(result)).toEqual(['QA Agente Stock 20261020T1737Z']);
        expect(result.notForSale[0]).toMatchObject({ isAvailable: false, inStock: false, soldOut: true, stock: 0 });
        expect(result.products.map((p: any) => p.name).sort()).toEqual(['Audífono QA Aurora', 'Gorra Roja']);
    });

    it('accents and plurals: «camaras opticas» names «Cámara Óptica»', async () => {
        expect(notForSale(await browse('tienen camaras opticas?'))).toEqual(['Cámara Óptica']);
    });

    it('every identifying word is needed, and a word inside another is not one', async () => {
        expect(notForSale(await browse('tienen el agente?'))).toEqual([]);
        expect(notForSale(await browse('tienen el reagente stock?'))).toEqual([]);
        expect(notForSale(await browse('hola, buenas tardes'))).toEqual([]);
    });

    it('a product for sale with stock 0 stays in products, not repeated under notForSale', async () => {
        const result = await browse('tienen la gorra roja?');
        expect(notForSale(result)).toEqual([]);
        expect(result.products.find((p: any) => p.name === 'Gorra Roja')).toMatchObject({ inStock: false, stock: 0 });
    });

    it('without the message the browse is the for-sale list only', async () => {
        const result = await executor.searchProducts(schema, '', 20);
        expect(result).not.toHaveProperty('notForSale');
    });
});
