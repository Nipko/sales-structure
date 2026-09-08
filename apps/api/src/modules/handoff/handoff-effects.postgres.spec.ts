import { randomUUID } from 'crypto';
import { Client } from 'pg';
import {
    HANDOFF_EFFECTS_DDL, HandoffEffectError,
    admitHandoffEffect, prepareHandoffEffects, projectHandoffEffects,
    readHandoffEffects, settleHandoffEffect,
} from './handoff-effects';
import { HANDOFF_RECEIPT_DDL } from './handoff-receipt';

/**
 * The invariants that make one transfer produce one effect per destination.
 *
 * The receipt used to carry a single `announced` boolean covering six
 * consumers, so a failure in any one of them re-announced the transfer to the
 * five that had already succeeded. These rows exist to make that impossible,
 * and the case they must survive is the one nobody can observe from inside the
 * process: the effect happened and the record of it did not.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

integration('one handoff effect per destination', () => {
    const schema = `tenant_handoff_fx_${randomUUID().replace(/-/g, '')}`;
    let client: Client;
    jest.setTimeout(60_000);

    const query = async <R = any[]>(sql: string, params: any[] = []): Promise<R> =>
        (await client.query(sql, params)).rows as any;

    /** A receipt row is only needed so the projection has somewhere to land. */
    const receiptFor = async (): Promise<string> => {
        const id = randomUUID();
        await query(
            `INSERT INTO agent_handoff_receipts
                (id, conversation_id, contact_id, inbound_message_id, channel_type, channel_account_id,
                 reason, from_status, to_status, notice_kind, notice_language)
             VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'web_widget','widget-main',
                 'explicit_request','active','waiting_human','queue_head','es')`,
            [id, randomUUID(), randomUUID(), randomUUID()]);
        await prepareHandoffEffects(query, schema, id, ['assignment', 'inbox', 'slack', 'email']);
        return id;
    };

    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new Client({ connectionString: connection });
        await client.connect();
        await query(`CREATE SCHEMA "${schema}"`);
        await query(`SET search_path TO "${schema}"`);
        for (const statement of [...HANDOFF_RECEIPT_DDL, ...HANDOFF_EFFECTS_DDL]) await query(statement);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_handoff_fx_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    it('prepares one row per destination and is safe to prepare twice', async () => {
        const receiptId = await receiptFor();
        await prepareHandoffEffects(query, schema, receiptId, ['assignment', 'inbox', 'slack', 'email']);
        const rows = await readHandoffEffects(query, schema, receiptId);
        expect(rows.map(row => row.destination)).toEqual(['assignment', 'email', 'inbox', 'slack']);
        expect(rows.every(row => row.state === 'prepared' && row.attempts === 0)).toBe(true);
    });

    it('admits one attempt at a time and refuses a second holder', async () => {
        const receiptId = await receiptFor();
        const admitted = await admitHandoffEffect(query, schema,
            { receiptId, destination: 'slack', leaseToken: randomUUID() });
        expect(admitted.state).toBe('admitted');
        expect(admitted.attempts).toBe(1);
        await expect(admitHandoffEffect(query, schema,
            { receiptId, destination: 'slack', leaseToken: randomUUID() }))
            .rejects.toMatchObject({ code: 'handoff_effect_leased' });
    });

    it('never hands a lapsed lease back, because the effect may have happened', async () => {
        const receiptId = await receiptFor();
        await admitHandoffEffect(query, schema,
            { receiptId, destination: 'slack', leaseToken: randomUUID(), leaseSeconds: 1 });
        await query(`UPDATE agent_handoff_effects SET lease_expires_at = NOW() - INTERVAL '1 minute'
                      WHERE receipt_id=$1::uuid AND destination='slack'`, [receiptId]);

        await expect(admitHandoffEffect(query, schema,
            { receiptId, destination: 'slack', leaseToken: randomUUID() }))
            .rejects.toMatchObject({ code: 'handoff_effect_terminal:unknown' });
        const [row] = (await readHandoffEffects(query, schema, receiptId))
            .filter(entry => entry.destination === 'slack');
        expect(row).toMatchObject({ state: 'unknown', errorCode: 'lease_expired_after_admission', attempts: 1 });
        // And it stays refused: a person decides, not another attempt.
        await expect(admitHandoffEffect(query, schema,
            { receiptId, destination: 'slack', leaseToken: randomUUID() }))
            .rejects.toMatchObject({ code: 'handoff_effect_terminal:unknown' });
    });

    it('lets a rejected destination try again without touching the ones that succeeded', async () => {
        const receiptId = await receiptFor();
        const inboxLease = randomUUID(), slackLease = randomUUID();
        await admitHandoffEffect(query, schema, { receiptId, destination: 'inbox', leaseToken: inboxLease });
        await settleHandoffEffect(query, schema,
            { receiptId, destination: 'inbox', leaseToken: inboxLease, outcome: { kind: 'accepted' } });
        await admitHandoffEffect(query, schema, { receiptId, destination: 'slack', leaseToken: slackLease });
        await settleHandoffEffect(query, schema,
            { receiptId, destination: 'slack', leaseToken: slackLease, outcome: { kind: 'rejected', errorCode: 'slack_unreachable' } });

        await expect(admitHandoffEffect(query, schema,
            { receiptId, destination: 'inbox', leaseToken: randomUUID() }))
            .rejects.toMatchObject({ code: 'handoff_effect_terminal:accepted' });
        const retried = await admitHandoffEffect(query, schema,
            { receiptId, destination: 'slack', leaseToken: randomUUID() });
        expect(retried.attempts).toBe(2);
    });

    it('refuses to settle under a lease that is no longer ours', async () => {
        const receiptId = await receiptFor();
        await admitHandoffEffect(query, schema, { receiptId, destination: 'email', leaseToken: randomUUID() });
        await expect(settleHandoffEffect(query, schema,
            { receiptId, destination: 'email', leaseToken: randomUUID(), outcome: { kind: 'accepted' } }))
            .rejects.toBeInstanceOf(HandoffEffectError);
    });

    it('keeps the SMTP message id of an accepted notification', async () => {
        const receiptId = await receiptFor();
        const lease = randomUUID();
        await admitHandoffEffect(query, schema, { receiptId, destination: 'email', leaseToken: lease });
        const settled = await settleHandoffEffect(query, schema,
            { receiptId, destination: 'email', leaseToken: lease, outcome: { kind: 'accepted', receipt: '<abc@smtp>' } });
        expect(settled).toMatchObject({ state: 'accepted', receipt: '<abc@smtp>' });
    });

    it('only claims the transfer was announced once every consumer has finished', async () => {
        const receiptId = await receiptFor();
        // A receipt with only some of the announcement destinations prepared:
        // `announced` may not appear while one of them is still outstanding.
        await prepareHandoffEffects(query, schema, receiptId, ['crm', 'push', 'webhooks', 'sms']);
        const settle = async (destination: any, kind: 'accepted' | 'rejected' = 'accepted') => {
            const lease = randomUUID();
            await admitHandoffEffect(query, schema, { receiptId, destination, leaseToken: lease });
            await settleHandoffEffect(query, schema, {
                receiptId, destination, leaseToken: lease,
                outcome: kind === 'accepted' ? { kind } : { kind, errorCode: 'listener_threw' },
            });
            await projectHandoffEffects(query, schema, receiptId);
        };
        for (const destination of ['inbox', 'crm', 'push', 'webhooks']) await settle(destination);
        await settle('slack', 'rejected');
        let [row] = await query<any[]>('SELECT effects FROM agent_handoff_receipts WHERE id=$1::uuid', [receiptId]);
        expect(row.effects.announced).toBeUndefined();

        await settle('slack');
        await settle('sms');
        [row] = await query<any[]>('SELECT effects FROM agent_handoff_receipts WHERE id=$1::uuid', [receiptId]);
        expect(row.effects.announced).toBe(true);
    });

    it('projects the values a resumed transfer reads back', async () => {
        const receiptId = await receiptFor();
        const agentId = randomUUID(), lease = randomUUID(), cacheLease = randomUUID();
        await prepareHandoffEffects(query, schema, receiptId, ['cache']);
        await admitHandoffEffect(query, schema, { receiptId, destination: 'assignment', leaseToken: lease });
        await settleHandoffEffect(query, schema,
            { receiptId, destination: 'assignment', leaseToken: lease, outcome: { kind: 'accepted', receipt: agentId } });
        await admitHandoffEffect(query, schema, { receiptId, destination: 'cache', leaseToken: cacheLease });
        await settleHandoffEffect(query, schema,
            { receiptId, destination: 'cache', leaseToken: cacheLease, outcome: { kind: 'accepted', receipt: 'hoff_1' } });
        await projectHandoffEffects(query, schema, receiptId);

        const [row] = await query<any[]>('SELECT effects FROM agent_handoff_receipts WHERE id=$1::uuid', [receiptId]);
        expect(row.effects).toMatchObject({ assignment: agentId, cache: 'hoff_1' });
    });

    it('refuses a destination nobody prepared instead of inventing one', async () => {
        const receiptId = await receiptFor();
        await expect(admitHandoffEffect(query, schema,
            { receiptId, destination: 'push', leaseToken: randomUUID() }))
            .rejects.toMatchObject({ code: 'handoff_effect_unprepared' });
    });
});
