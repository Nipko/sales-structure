import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { MediaConsentService } from './media-consent.service';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('durable media consent against PostgreSQL', () => {
    let client: Client;
    let schema: string;
    let contactId: string;
    let conversationId: string;
    let tenantId: string;

    beforeAll(async () => {
        const parsed = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(parsed.hostname)
            || !parsed.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new Client({ connectionString: databaseUrl });
        await client.connect();
    });

    beforeEach(async () => {
        schema = `tenant_media_consent_${randomUUID().replace(/-/g, '')}`;
        contactId = randomUUID();
        conversationId = randomUUID();
        tenantId = randomUUID();
        await client.query(`CREATE SCHEMA "${schema}"`);
        await client.query(`
            CREATE TABLE "${schema}".policies(
                id UUID PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL,
                content TEXT NOT NULL, version INTEGER NOT NULL, is_active BOOLEAN NOT NULL);
            CREATE TABLE "${schema}".consent_records(
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(), lead_id UUID, contact_id UUID,
                channel TEXT NOT NULL, legal_version TEXT NOT NULL, legal_text_hash TEXT,
                policy_id UUID, policy_type TEXT, policy_version INTEGER, consent_scope TEXT,
                conversation_id UUID, capture_mode TEXT, expires_at TIMESTAMPTZ,
                revoked_at TIMESTAMPTZ, consent_request_id UUID,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
            CREATE UNIQUE INDEX uidx_consent_request ON "${schema}".consent_records(consent_request_id)
                WHERE consent_request_id IS NOT NULL;
            CREATE TABLE "${schema}".leads(id UUID PRIMARY KEY, contact_id UUID);
            CREATE TABLE "${schema}".media_ai_consent_challenges(
                request_id UUID PRIMARY KEY, contact_id UUID NOT NULL, conversation_id UUID NOT NULL,
                channel TEXT NOT NULL, purposes TEXT[] NOT NULL, policy_id UUID NOT NULL,
                policy_title TEXT NOT NULL, policy_version INTEGER NOT NULL, legal_text_hash TEXT NOT NULL,
                issued_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
                resolved_at TIMESTAMPTZ, resolution TEXT);
            CREATE UNIQUE INDEX uidx_media_ai_consent_challenge_pending
                ON "${schema}".media_ai_consent_challenges(conversation_id) WHERE resolved_at IS NULL;
        `);
        await client.query(
            `INSERT INTO "${schema}".policies VALUES($1::uuid,'privacy','Privacy','media policy',4,true)`,
            [randomUUID()],
        );
    });

    afterEach(async () => {
        if (!/^tenant_media_consent_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    });

    afterAll(async () => { await client.end(); });

    function service(): MediaConsentService {
        const execute = async <T>(_: string, sql: string, params: any[] = []): Promise<T> => {
            await client.query('BEGIN');
            try {
                await client.query(`SET LOCAL search_path TO "${schema}", public`);
                const result = await client.query(sql, params);
                await client.query('COMMIT');
                return result.rows as T;
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        };
        const transaction = async <T>(_: string, callback: (query: any) => Promise<T>): Promise<T> => {
            await client.query('BEGIN');
            try {
                await client.query(`SET LOCAL search_path TO "${schema}", public`);
                const result = await callback(async (sql: string, params: any[] = []) =>
                    (await client.query(sql, params)).rows);
                await client.query('COMMIT');
                return result;
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        };
        return new MediaConsentService({
            getTenantSchemaName: jest.fn().mockResolvedValue(schema),
            executeInTenantSchema: execute,
            transactionInTenantSchema: transaction,
            tenant: { findUnique: jest.fn().mockResolvedValue({ slug: 'durable-business' }) },
        } as any);
    }

    it('survives a worker replacement and resolves one idempotent grant', async () => {
        const asked = await service().request(
            tenantId, contactId, conversationId, 'whatsapp', ['image_analysis'], 'en',
        );
        expect(asked.message).toContain('yes, I confirm');

        const confirmed = await service().handlePendingReply(
            tenantId, contactId, conversationId, 'Yes, I confirm', 'en',
        );
        expect(confirmed.message).toContain('Authorization recorded');

        const resolved = await service().resolve(tenantId, contactId, 'image_analysis');
        expect(resolved?.consent).toMatchObject({
            subjectId: contactId, purposes: ['image_analysis'], source: 'verified_consent_registry',
        });
        const { rows } = await client.query(
            `SELECT resolution FROM "${schema}".media_ai_consent_challenges`,
        );
        expect(rows).toEqual([{ resolution: 'granted' }]);
    });
});
