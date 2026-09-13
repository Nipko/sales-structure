import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;
const ORIGINAL_MIGRATION = resolve(__dirname,
    '../../../prisma/migrations/20260912130000_media_ai_consent_authority/migration.sql');
const MESSAGE_MIGRATION = resolve(__dirname,
    '../../../prisma/migrations/20260913100000_bind_media_consent_confirmation/migration.sql');

integration('media consent schema remains identical for existing and new tenants', () => {
    const suffix = randomUUID().replace(/-/g, '');
    const fresh = `tenant_media_fresh_${suffix}`;
    const migrated = `tenant_media_migr_${suffix}`;
    const tenantId = randomUUID();
    let client: Client;
    const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;

    beforeAll(async () => {
        if (!isDisposableDatabase(connection)) throw new Error('disposable_database_required');
        client = new Client({ connectionString: connection });
        await client.connect();
        await q(`CREATE SCHEMA "${fresh}"`);
        await q(`CREATE SCHEMA "${migrated}"`);

        await q(`CREATE TABLE "${fresh}".leads(id UUID PRIMARY KEY)`);
        const template = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        const block = template.split('-- ---- Consent Records ----')[1]
            ?.split('-- ---- Opt-Out Records ----')[0];
        if (!block) throw new Error('tenant_schema_consent_block_missing');
        for (const statement of block.replace(/^\s*--.*$/gm, '').split(';').filter(value => value.trim())) {
            await q(statement.replaceAll('{{SCHEMA_NAME}}', fresh));
        }

        // Existing-tenant shape before the media-consent authority existed.
        await q(`CREATE TABLE "${migrated}".leads(id UUID PRIMARY KEY, contact_id UUID)`);
        await q(`CREATE TABLE "${migrated}".consent_records(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), lead_id UUID,
            channel VARCHAR(50) NOT NULL DEFAULT 'web_form', legal_version VARCHAR(50) NOT NULL,
            legal_text_hash VARCHAR(64), policy_id UUID, policy_type VARCHAR(50), policy_version INTEGER,
            consent_scope VARCHAR(80), conversation_id UUID, execution_ledger_id UUID,
            capture_mode VARCHAR(50), ip_address VARCHAR(45), user_agent TEXT, origin_url TEXT,
            created_at TIMESTAMP DEFAULT NOW())`);
        // The disposable harness deliberately gives public.tenants only the
        // columns migrations are allowed to require.
        await q(`INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)`,
            [tenantId, migrated]);
        try {
            await q(readFileSync(ORIGINAL_MIGRATION, 'utf8'));
            await q(readFileSync(MESSAGE_MIGRATION, 'utf8'));
            // Every additive migration must be safe when deployment retries it.
            await q(readFileSync(MESSAGE_MIGRATION, 'utf8'));
        } finally {
            await q('DELETE FROM public.tenants WHERE id=$1::uuid', [tenantId]);
        }
    });

    afterAll(async () => {
        if (!client) return;
        try {
            for (const schema of [fresh, migrated]) {
                if (!/^tenant_media_(fresh|migr)_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
                await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            }
        } finally { await client.end(); }
    });

    const authority = (schema: string) => q(
        `SELECT table_name, column_name, data_type, character_maximum_length, is_nullable
           FROM information_schema.columns
          WHERE table_schema=$1 AND table_name IN ('consent_records','media_ai_consent_challenges')
            AND column_name IN (
                'contact_id','expires_at','revoked_at','consent_request_id','confirmation_message_id',
                'request_id','conversation_id','channel','purposes','policy_id','policy_version',
                'legal_text_hash','issued_at','resolved_at','resolution'
            )
          ORDER BY table_name, column_name`, [schema]);

    it('produces the same authority columns through migration and fresh provisioning', async () => {
        const [freshColumns, migratedColumns] = await Promise.all([authority(fresh), authority(migrated)]);
        expect(freshColumns.length).toBeGreaterThanOrEqual(20);
        expect(migratedColumns).toEqual(freshColumns);
        expect(freshColumns.filter(row => row.column_name === 'confirmation_message_id')).toHaveLength(2);
        expect(freshColumns.filter(row => row.column_name === 'confirmation_message_id')
            .every(row => row.character_maximum_length === 512)).toBe(true);
    });

    it('keeps the one-pending-challenge and idempotent-request indexes on both paths', async () => {
        const indexes = async (schema: string) => (await q(
            `SELECT indexname FROM pg_indexes WHERE schemaname=$1
              AND indexname IN ('uidx_consent_request','uidx_media_ai_consent_challenge_pending')
              ORDER BY indexname`, [schema])).map(row => row.indexname);
        expect(await indexes(fresh)).toEqual(['uidx_consent_request', 'uidx_media_ai_consent_challenge_pending']);
        expect(await indexes(migrated)).toEqual(await indexes(fresh));
    });
});
