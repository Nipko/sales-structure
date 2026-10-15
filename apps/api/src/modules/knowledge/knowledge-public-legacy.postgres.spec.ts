import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { KnowledgeService } from './knowledge.service';

const url = process.env.KNOWLEDGE_FILE_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration.each([false, true])('Public KB with legacy excerpt column=%s', (hasExcerpt) => {
    const schema = `tenant_publickb_${randomUUID().replace(/-/g, '')}`;
    let db: Pool;
    let service: KnowledgeService;
    const legacyContent = 'Synthetic legacy article. '.repeat(20);

    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        db = new Pool({ connectionString: url, max: 4 });
        await db.query(`CREATE SCHEMA "${schema}"`);
        await db.query(`CREATE TABLE "${schema}".knowledge_resources(
            id UUID PRIMARY KEY, title TEXT, slug TEXT, category TEXT, content TEXT,
            published_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, is_public BOOLEAN, status TEXT
            ${hasExcerpt ? ', excerpt TEXT' : ''})`);
        await db.query(`CREATE TABLE "${schema}".knowledge_documents(
            id UUID PRIMARY KEY, title TEXT, slug TEXT, category TEXT, excerpt TEXT, content_text TEXT,
            created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, is_public BOOLEAN, status TEXT)`);
        for (const [slug, isPublic, status] of [['legacy-public', true, 'ready'], ['legacy-private', false, 'ready'], ['legacy-draft', true, 'draft']] as const) {
            await db.query(`INSERT INTO "${schema}".knowledge_resources(id,title,slug,category,content,is_public,status)
                VALUES($1::uuid,$2,$2,'QA',$3,$4,$5)`, [randomUUID(), slug, legacyContent, isPublic, status]);
        }
        if (hasExcerpt) await db.query(`UPDATE "${schema}".knowledge_resources SET excerpt='Curated synthetic excerpt' WHERE slug='legacy-public'`);
        for (const [slug, isPublic] of [['document-public', true], ['document-private', false]] as const) {
            await db.query(`INSERT INTO "${schema}".knowledge_documents(id,title,slug,excerpt,content_text,is_public,status)
                VALUES($1::uuid,$2,$2,'Document excerpt','Synthetic document',$3,'ready')`, [randomUUID(), slug, isPublic]);
        }
        service = Object.create(KnowledgeService.prototype) as KnowledgeService;
        Object.assign(service as any, {
            resolveSchemaFromSlug: async () => schema,
            logger: { error: jest.fn(), warn: jest.fn() },
            prisma: { executeInTenantSchema: async (name: string, sql: string, params: unknown[] = []) => {
                if (name !== schema) throw new Error('test_scope_violation');
                const client = await db.connect();
                try {
                    await client.query('BEGIN');
                    await client.query(`SET LOCAL search_path TO "${schema}"`);
                    const result = await client.query(sql, params);
                    await client.query('COMMIT');
                    return result.rows;
                } catch (error) { await client.query('ROLLBACK'); throw error; }
                finally { client.release(); }
            } },
        });
    });
    afterAll(async () => {
        if (!db) return;
        try { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
        finally { await db.end(); }
    });

    it('lists both public sources without losing legacy articles or exposing private/draft rows', async () => {
        const rows = await service.getPublicArticles('synthetic');
        expect(rows.map(r => r.slug).sort()).toEqual(['document-public', 'legacy-public']);
        expect(rows.find(r => r.slug === 'legacy-public')?.excerpt)
            .toBe(hasExcerpt ? 'Curated synthetic excerpt' : legacyContent.slice(0, 300));
    });
    it('reads a legacy public article with its optional excerpt or a bounded content preview', async () => {
        const row = await service.getPublicArticle('synthetic', 'legacy-public');
        expect(row).toMatchObject({ slug: 'legacy-public', content: legacyContent,
            excerpt: hasExcerpt ? 'Curated synthetic excerpt' : legacyContent.slice(0, 300) });
    });
    it('returns no article for private, draft, or absent slugs after both sources succeed', async () => {
        for (const slug of ['legacy-private', 'legacy-draft', 'document-private', 'absent']) {
            await expect(service.getPublicArticle('synthetic', slug)).resolves.toBeNull();
        }
        const columns = await db.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2', [schema, 'knowledge_resources']);
        expect(columns.rows.some(r => r.column_name === 'excerpt')).toBe(hasExcerpt);
    });
});
