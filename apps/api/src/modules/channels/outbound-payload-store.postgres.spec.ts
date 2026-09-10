import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import {
    ensureOutboundPayloads, loadOutboundPayload, markOutboundPayloadSent,
    redactOutboundPayloadsForContact, redactOutboundPayloadsForRelease, storeOutboundPayload,
    type OutboundPayloadQuery,
} from './outbound-payload-store';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';

/**
 * The legacy reply path, made reachable.
 *
 * It used to put the words and the phone number in a BullMQ job, hold them
 * through a delay, and keep them for a day after a failure. Nothing could touch
 * them: a retraction matches on a release id and the job carried none, an
 * erasure matches on a contact and the job was not in any database. The
 * inventory called it the widest hole in the sweep, and "turn on the durable
 * outbox" was never an answer anybody could give for a live tenant.
 *
 * Each test here is one of the three things that were impossible before: a
 * delayed reply survives the process that queued it, a withdrawal or an erasure
 * reaches it BEFORE it goes out, and a replay does not send it twice.
 */

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;

(connection ? describe : describe.skip)('what a queued reply leaves behind', () => {
    let pool: Pool;
    const schema = `outbound_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID();
    const contactId = randomUUID();
    const otherContact = randomUUID();

    const transaction = async <T>(work: (query: OutboundPayloadQuery) => Promise<T>): Promise<T> => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL search_path TO "${schema}"`);
            const value = await work((async (text: string, params: any[] = []) =>
                (await client.query(text, params)).rows) as OutboundPayloadQuery);
            await client.query('COMMIT');
            return value;
        } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    };
    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        transaction(query => query(text, params)) as Promise<any[]>;

    const reply = (over: Record<string, unknown> = {}) => ({
        tenantId, channelType: 'whatsapp', contactId,
        releaseIds: ['release-1'],
        payload: { tenantId, channelType: 'whatsapp', to: '+573001112233',
            content: { type: 'text', text: 'Tu turno quedó para el jueves a las 10.' } },
        ...over,
    });

    beforeAll(async () => {
        if (!isDisposableDatabase(connection)) throw new Error('disposable_database_required');
        pool = new Pool({ connectionString: connection, max: 4 });
        await transaction(query => query(`CREATE SCHEMA "${schema}"`));
        await transaction(ensureOutboundPayloads);
    }, 60000);

    afterAll(async () => {
        if (pool) {
            await transaction(query => query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
            await pool.end();
        }
    });

    it('commits the words before anything is published, so a crash loses only time', async () => {
        const id = await transaction(query => storeOutboundPayload(query, reply()));
        // A different connection — the point is that the row outlived the one
        // that wrote it, which a Redis job in a dead process does not.
        const stored = await transaction(query => loadOutboundPayload(query, id));
        expect(stored?.payload).toMatchObject({ to: '+573001112233' });
        expect(stored?.redactedAt).toBeNull();
        expect(stored?.sentAt).toBeNull();
    }, 120000);

    it('resolves the same reply prepared twice to one row', async () => {
        const dedupeId = `turn-${randomUUID()}`;
        const first = await transaction(query => storeOutboundPayload(query, reply({ dedupeId })));
        const again = await transaction(query => storeOutboundPayload(query, reply({ dedupeId })));
        expect(again).toBe(first);
        const [count] = await sql('SELECT count(*)::int AS n FROM outbound_payloads WHERE dedupe_id=$1', [dedupeId]);
        expect(Number(count.n)).toBe(1);
    }, 120000);

    it('lets a withdrawn release take back what has not gone out', async () => {
        const id = await transaction(query => storeOutboundPayload(query, reply({ dedupeId: randomUUID() })));
        expect(await transaction(query => redactOutboundPayloadsForRelease(query, ['release-1']))).toBeGreaterThan(0);
        const stored = await transaction(query => loadOutboundPayload(query, id));
        // The row survives as the fact that stops a resend; what it no longer
        // holds is the message.
        expect(stored?.payload).toBeNull();
        expect(stored?.redactedReason).toBe('retraction');
    }, 120000);

    it('does not rewrite a conversation that already happened', async () => {
        const id = await transaction(query => storeOutboundPayload(query, reply({ dedupeId: randomUUID() })));
        await transaction(query => markOutboundPayloadSent(query, id));
        const before = await transaction(query => loadOutboundPayload(query, id));
        expect(before?.sentAt).not.toBeNull();
        // A retraction withdraws a release. It reaches what is still queued and
        // deliberately leaves a message the customer already read alone.
        await transaction(query => redactOutboundPayloadsForRelease(query, ['release-1']));
        const after = await transaction(query => loadOutboundPayload(query, id));
        expect(after?.redactedReason).toBe('delivered');
    }, 120000);

    it('lets an erasure reach a queued reply whatever produced it', async () => {
        const mine = await transaction(query => storeOutboundPayload(query,
            reply({ dedupeId: randomUUID(), releaseIds: [] })));
        const theirs = await transaction(query => storeOutboundPayload(query,
            reply({ dedupeId: randomUUID(), contactId: otherContact })));
        expect(await transaction(query => redactOutboundPayloadsForContact(query, [contactId]))).toBeGreaterThan(0);
        expect((await transaction(query => loadOutboundPayload(query, mine)))?.payload).toBeNull();
        expect((await transaction(query => loadOutboundPayload(query, mine)))?.redactedReason).toBe('erasure');
        // And nobody else's.
        expect((await transaction(query => loadOutboundPayload(query, theirs)))?.payload).not.toBeNull();
    }, 120000);

    it('has nothing to send the second time the same job runs', async () => {
        const id = await transaction(query => storeOutboundPayload(query, reply({ dedupeId: randomUUID() })));
        await transaction(query => markOutboundPayloadSent(query, id));
        const replayed = await transaction(query => loadOutboundPayload(query, id));
        expect(replayed?.payload).toBeNull();
        // Marking again does not resurrect it or move the timestamp.
        const sentAt = replayed?.sentAt;
        await transaction(query => markOutboundPayloadSent(query, id));
        expect((await transaction(query => loadOutboundPayload(query, id)))?.sentAt).toBe(sentAt);
    }, 120000);

    it('keeps no words for a reply that was taken back or delivered', async () => {
        const [rows] = await sql(
            `SELECT count(*)::int AS n FROM outbound_payloads
              WHERE payload IS NOT NULL AND (redacted_at IS NOT NULL OR sent_at IS NOT NULL)`);
        expect(Number(rows.n)).toBe(0);
    }, 120000);
});
