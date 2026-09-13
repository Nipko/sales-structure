import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { isDisposableDatabaseUrl } from '../../common/__fixtures__/disposable-database';
import { FaqsService } from './faqs.service';

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;

/**
 * Creating a FAQ by hand, through the driver production uses.
 *
 * The service's INSERT used `$3` twice: once in the column list, where
 * PostgreSQL deduces `character varying` from `faqs.category`, and once inside
 * `COALESCE($3, '')`, where the bare literal made it `text`. One parameter
 * cannot be both, so PostgreSQL refused to PREPARE the statement — `42P08` —
 * whenever the driver sent the value untyped, which is what Prisma does for
 * `null`. The category field of the FAQ editor is optional
 * (`category: form.category.trim() || undefined`), so every FAQ saved without a
 * category failed, on every tenant of every vertical. Saving one WITH a category
 * worked, which is why nobody found it; and the vertical seed always supplies a
 * category, which is why bootstrapped tenants have rows nobody could have added.
 *
 * It has to be Prisma and not `pg`: the failure is about how the DRIVER types an
 * untyped parameter, so a test that used a different driver would be testing a
 * different question.
 */
(connection ? describe : describe.skip)('creating a FAQ through the driver production uses', () => {
    const schema = `tenant_faqcreate_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID();
    let client: PrismaClient;
    let service: FaqsService;

    beforeAll(async () => {
        const url = new URL(connection!);
        if (!isDisposableDatabaseUrl(url)) throw new Error('disposable_database_required');
        client = new PrismaClient({ datasources: { db: { url: connection! } } });
        await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);

        // The canonical table, verbatim: the defect is about the declared type
        // of one column, so a hand-shrunk fixture would answer a different
        // question and `category VARCHAR(100)` is exactly the part that matters.
        const schemaSql = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        const start = schemaSql.indexOf('CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."faqs"');
        const create = schemaSql.slice(start, schemaSql.indexOf('\n);', start) + 3);
        expect(create).toContain('"category"      VARCHAR(100)');
        await client.$executeRawUnsafe(create.replace(/\{\{SCHEMA_NAME\}\}/g, schema));

        const cache = new Map<string, string>();
        service = new FaqsService(
            client as any,
            {
                get: async (key: string) => cache.get(key) ?? null,
                set: async (key: string, value: string) => { cache.set(key, value); },
                del: async (key: string) => { cache.delete(key); },
                getJson: async () => null,
                setJson: async () => undefined,
                keys: async () => [],
            } as any,
            { getSchemaName: async () => schema } as any,
        );
        // `ensureSchema` would re-create the table with its own copy of the DDL;
        // the canonical one is already applied, so mark it initialised.
        (service as any).initialized.add(tenantId);
    }, 60000);

    afterAll(async () => {
        if (!client) return;
        await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await client.$disconnect();
    });

    beforeEach(async () => {
        await client.$executeRawUnsafe(`TRUNCATE "${schema}"."faqs"`);
    });

    it('saves a FAQ with no category at all', async () => {
        // The default path of the editor, and the one that was refused.
        const faq = await service.create(tenantId, {
            question: '¿Hacen envíos a Medellín?', answer: 'Sí, con dos días de tránsito.',
        });
        expect(faq).toMatchObject({ question: '¿Hacen envíos a Medellín?', isPublished: true, category: undefined });
        const stored = await client.$queryRawUnsafe<any[]>(
            `SELECT category, search_tsv::text AS tsv FROM "${schema}"."faqs"`);
        expect(stored[0].category).toBeNull();
        // The vector still indexes question and answer, so the FAQ is findable.
        expect(stored[0].tsv).toContain('envíos');
        expect(stored[0].tsv).toContain('tránsito');
    });

    it('saves a FAQ with an explicit category, and indexes the category word', async () => {
        await service.create(tenantId, {
            question: '¿Cuánto cuesta el envío?', answer: 'Quince mil pesos.', category: 'logistica',
        });
        const stored = await client.$queryRawUnsafe<any[]>(
            `SELECT category, search_tsv::text AS tsv FROM "${schema}"."faqs"`);
        expect(stored[0].category).toBe('logistica');
        // Unchanged from the shape that used to work: the category is part of
        // the vector. Derived from the stored text rather than from the same
        // expression under test.
        expect(stored[0].tsv).toContain('logistica');
    });

    it('saves a FAQ whose category is an empty string', async () => {
        const faq = await service.create(tenantId, {
            question: '¿Tienen local?', answer: 'Sí, en el centro.', category: '',
        });
        expect(faq.category).toBe('');
    });

    it('is then found by the tool that reads these rows', async () => {
        // The link that makes the write worth anything: a FAQ created with no
        // category is what `search_faqs` answers the customer with.
        await service.create(tenantId, {
            question: '¿Hacen envíos a Medellín?', answer: 'Sí, con dos días de tránsito.',
        });
        const found = await service.search(tenantId, 'envíos', 5);
        expect(found.map(item => item.question)).toEqual(['¿Hacen envíos a Medellín?']);
    });

    it('still reports a duplicate question as a conflict rather than as this bug', async () => {
        // The only error the catch translates. It has to keep working, or the
        // fix would have widened one failure into two.
        await client.$executeRawUnsafe(
            `CREATE UNIQUE INDEX "uidx_faqs_question_${schema}" ON "${schema}"."faqs" ("question")`);
        try {
            await service.create(tenantId, { question: '¿Repetida?', answer: 'Una.' });
            await expect(service.create(tenantId, { question: '¿Repetida?', answer: 'Otra.' }))
                .rejects.toMatchObject({ status: 409 });
        } finally {
            await client.$executeRawUnsafe(`DROP INDEX "${schema}"."uidx_faqs_question_${schema}"`);
        }
    });
});
