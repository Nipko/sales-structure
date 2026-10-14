import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { knowledgeFileTypeWidenSql } from '../prisma/knowledge-file-type-schema';

const url = process.env.KNOWLEDGE_FILE_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

integration('Knowledge MIME persistence in disposable PostgreSQL', () => {
    let db: Client;
    const legacy = `tenant_mime_legacy_${randomUUID().replace(/-/g, '')}`;
    const fresh = `tenant_mime_fresh_${randomUUID().replace(/-/g, '')}`;

    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        db = new Client({ connectionString: url });
        await db.connect();
        await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await db.query(`CREATE SCHEMA "${legacy}"`);
        await db.query(`CREATE SCHEMA "${fresh}"`);
    });
    afterAll(async () => {
        if (!db) return;
        try {
            await db.query(`DROP SCHEMA IF EXISTS "${legacy}" CASCADE`);
            await db.query(`DROP SCHEMA IF EXISTS "${fresh}" CASCADE`);
        } finally { await db.end(); }
    });

    it('widens an existing schema idempotently without changing previous content or visibility', async () => {
        await db.query(`CREATE TABLE "${legacy}".knowledge_documents(id TEXT PRIMARY KEY,file_type VARCHAR(50),content_text TEXT,is_public BOOLEAN)`);
        await db.query(`INSERT INTO "${legacy}".knowledge_documents VALUES('original','text/plain','Original private content',false)`);
        await expect(db.query(`INSERT INTO "${legacy}".knowledge_documents VALUES('before',$1,'DOCX',false)`, [mime]))
            .rejects.toMatchObject({ code: '22001' });
        await db.query('BEGIN');
        try {
            await db.query(`SET LOCAL search_path TO "${legacy}"`);
            await db.query(knowledgeFileTypeWidenSql(legacy));
            await db.query(knowledgeFileTypeWidenSql(legacy));
            await db.query('COMMIT');
        } catch (error) { await db.query('ROLLBACK'); throw error; }
        await db.query(`INSERT INTO "${legacy}".knowledge_documents VALUES('docx',$1,'JADE-DOCX-527',false)`, [mime]);
        const rows = (await db.query(`SELECT * FROM "${legacy}".knowledge_documents ORDER BY id`)).rows;
        expect(rows).toEqual([
            { id: 'docx', file_type: mime, content_text: 'JADE-DOCX-527', is_public: false },
            { id: 'original', file_type: 'text/plain', content_text: 'Original private content', is_public: false },
        ]);
    });

    it('stores the full DOCX MIME using the canonical new-tenant table definition', async () => {
        const template = readFileSync(join(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        const statement = template.match(/CREATE TABLE IF NOT EXISTS "\{\{SCHEMA_NAME\}\}"\."knowledge_documents" \([\s\S]*?\n\);/);
        if (!statement) throw new Error('canonical_knowledge_table_missing');
        await db.query(statement[0].replace(/\{\{SCHEMA_NAME\}\}/g, fresh));
        await db.query(`INSERT INTO "${fresh}".knowledge_documents(title,file_type,content_text) VALUES('Synthetic DOCX',$1,'JADE-DOCX-527')`, [mime]);
        expect((await db.query(`SELECT file_type,content_text FROM "${fresh}".knowledge_documents`)).rows)
            .toEqual([{ file_type: mime, content_text: 'JADE-DOCX-527' }]);
    });
});
