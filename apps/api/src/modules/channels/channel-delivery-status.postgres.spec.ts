import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { recordChannelDeliveryStatuses } from './channel-delivery-status';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

/**
 * The delivery-status writes, against the `messages` table tenants really get.
 *
 * The deployed WhatsApp worker ran `UPDATE messages SET status=$1, updated_at=NOW()`
 * for months. `messages` has never had an `updated_at`, so PostgreSQL refused
 * every one of those statements and a `catch` turned the refusal into a warning:
 * no delivery status, for any producer, was ever recorded. Nothing caught it
 * because nothing ever executed that SQL against the real table — so this suite
 * builds the table from the provisioning DDL itself.
 */
(databaseUrl ? describe : describe.skip)('delivery status against the provisioned messages table', () => {
    const schema = `tenant_delivery_status_${randomUUID().replace(/-/g, '')}`;
    let client: PrismaClient, prisma: any;
    let conversationId: string;

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);
    const logger = { error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    const record = (events: any[]) => recordChannelDeliveryStatuses(
        events,
        { channelType: 'whatsapp', channelAccountId: '15550001111' },
        { store: prisma, logger, resolveSchema: async () => schema },
    );
    const statusOf = async (externalId: string) =>
        (await sql('SELECT status FROM messages WHERE external_id=$1', [externalId]))[0].status;
    const refusal = async (pending: Promise<unknown>): Promise<string> => {
        try { await pending; } catch (error: any) {
            return `${error?.meta?.code ?? ''} ${error?.meta?.message ?? ''} ${error?.message ?? ''}`;
        }
        return 'no_error';
    };

    /** The real DDL, so the columns under test are the ones tenants actually have. */
    function provisionedMessagesDdl(): string[] {
        const source = fs.readFileSync(
            path.resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        const table = /CREATE TABLE IF NOT EXISTS "\{\{SCHEMA_NAME\}\}"\."messages" \([^;]*\);/.exec(source);
        const index = /CREATE UNIQUE INDEX IF NOT EXISTS "uidx_messages_external_id"[^;]*;/.exec(source);
        if (!table || !index) throw new Error('messages DDL not found in tenant-schema.sql');
        return [table[0], index[0]].map(statement =>
            statement.replace(/\{\{SCHEMA_NAME\}\}/g, schema));
    }

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        // Only the foreign key target is a stand-in; `messages` itself is verbatim.
        await sql('CREATE TABLE conversations(id UUID PRIMARY KEY)');
        for (const statement of provisionedMessagesDdl()) await sql(statement);
        conversationId = randomUUID();
        await sql('INSERT INTO conversations(id) VALUES($1::uuid)', [conversationId]);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_delivery_status_[a-f\d]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => { await sql('DELETE FROM messages'); });

    const outbound = async (externalId: string, status: string) => {
        await sql(
            `INSERT INTO messages(conversation_id, direction, status, external_id)
             VALUES($1::uuid, 'outbound', $2, $3)`,
            [conversationId, status, externalId]);
        return externalId;
    };

    it('proves the worker statement could never have run at all', async () => {
        await outbound('wamid.LEGACY', 'sent');
        const error = await refusal(sql(
            `UPDATE messages SET status = $1, updated_at = NOW() WHERE external_id = $2`,
            ['delivered', 'wamid.LEGACY']));
        // 42703 is undefined_column. Every status webhook the deployed worker
        // ever received died exactly here, inside a catch that only warned.
        expect(error).toMatch(/42703|updated_at/);
        expect(await statusOf('wamid.LEGACY')).toBe('sent');
    });

    it('marks a pre-outbox outbound rejected by the id its producer stored', async () => {
        await outbound('wamid.REFUSED', 'sent');
        const report = await record([
            { providerMessageId: 'wamid.REFUSED', status: 'failed', errorCode: 'wa_131047' },
        ]);
        // With no dispatch row to own the receipt, this is a legacy producer.
        expect(report.results[0]).toMatchObject({ applied: false, reason: 'unknown_receipt' });
        expect(report.unavailable).toBe(false);
        expect(await statusOf('wamid.REFUSED')).toBe('failed');
    });

    it('never walks a message the customer already has back to failed', async () => {
        await outbound('wamid.DELIVERED', 'delivered');
        await outbound('wamid.READ', 'read');
        await record([
            { providerMessageId: 'wamid.DELIVERED', status: 'failed', errorCode: 'wa_131026' },
            { providerMessageId: 'wamid.READ', status: 'failed', errorCode: 'wa_131026' },
        ]);
        // The old worker ranked `failed` above both of these. "Failed" would be
        // the false statement once the provider has confirmed arrival.
        expect(await statusOf('wamid.DELIVERED')).toBe('delivered');
        expect(await statusOf('wamid.READ')).toBe('read');
    });

    it('leaves an inbound message alone, whatever id it happens to carry', async () => {
        await sql(
            `INSERT INTO messages(conversation_id, direction, status, external_id)
             VALUES($1::uuid, 'inbound', 'received', 'wamid.INBOUND')`, [conversationId]);
        await record([{ providerMessageId: 'wamid.INBOUND', status: 'failed', errorCode: null }]);
        expect(await statusOf('wamid.INBOUND')).toBe('received');
    });

    it('reports the record as unreadable rather than silently doing nothing', async () => {
        await sql('ALTER TABLE messages RENAME TO messages_hidden');
        try {
            const report = await record([{ providerMessageId: 'wamid.X', status: 'failed', errorCode: null }]);
            // The API answers Meta 200 either way, but a caller holding a
            // retryable job has to be able to tell this from a refusal.
            expect(report.unavailable).toBe(true);
        } finally {
            await sql('ALTER TABLE messages_hidden RENAME TO messages');
        }
    });
});
