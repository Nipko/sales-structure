import { randomUUID } from 'crypto';
import { Client } from 'pg';
import {
    TURN_LEDGER_DDL, TurnLedgerError,
    openTurnLedger, readRecentTurnOutcomes, readTurnLedger, recordTurnDelivery, recordTurnHandoff,
    recordTurnOutcome, recordTurnResult, redactPendingDrafts, redactTurnLedger, settleTurnLedger,
    type TurnBinding, type TurnEnvelope,
} from './agent-turn-ledger';
import { failureNoticesInEpisode } from './turn-outcome-wait';
import { DISPATCH_OUTBOX_DDL } from '../channels/agent-dispatch-outbox';

/**
 * The turn ledger against a real PostgreSQL.
 *
 * What is being proven is not that the SQL parses: it is that a replay of an
 * interrupted turn recovers the SAME envelope — words, payment links, pictures
 * and learned sources together — and that a second attempt can never overwrite
 * the answer the customer may already be receiving.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

integration('the durable record of a turn', () => {
    const schema = `tenant_turn_ledger_${randomUUID().replace(/-/g, '')}`;
    let client: Client;
    jest.setTimeout(60_000);

    const query = async <R = any[]>(sql: string, params: any[] = []): Promise<R> =>
        (await client.query(sql, params)).rows as any;

    const release = randomUUID();
    const footprint = (agentId: string) => ({
        version: 1 as const, tenantId: randomUUID(), agentId,
        entries: [{ releaseId: release, releaseHash: 'a'.repeat(64), exampleId: randomUUID(), projectionHash: 'b'.repeat(64) }],
    });
    const envelope = (text: string, agentId = randomUUID()): TurnEnvelope => ({
        text, chunks: [text],
        paymentLinks: ['https://checkout.example/abc'],
        media: [{ url: 'https://cdn.example/one.jpg', caption: 'la foto' }],
        learningFootprints: [footprint(agentId)],
    });
    const binding = (overrides: Partial<TurnBinding> = {}): TurnBinding => ({
        conversationId: randomUUID(), contactId: randomUUID(), inboundMessageId: randomUUID(),
        channelType: 'whatsapp', channelAccountId: 'account-one', recipient: '573001112233',
        providerMessageId: 'wamid.inbound', ...overrides,
    });

    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new Client({ connectionString: connection });
        await client.connect();
        await query(`CREATE SCHEMA "${schema}"`);
        await query(`SET search_path TO "${schema}"`);
        for (const statement of TURN_LEDGER_DDL) await query(statement);
        // The evidence side of the same question: whether the notice this
        // turn decided to send was actually acknowledged by the provider.
        for (const statement of DISPATCH_OUTBOX_DDL) await query(statement);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_turn_ledger_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    it('opens once and counts the attempts of a replay', async () => {
        const bind = binding();
        const first = await openTurnLedger(query, schema, bind);
        expect(first.state).toBe('open');
        expect(first.attempts).toBe(1);
        expect(first.envelope).toBeNull();

        const second = await openTurnLedger(query, schema, bind);
        expect(second.id).toBe(first.id);
        expect(second.attempts).toBe(2);
    });

    it('gives a replay back the whole envelope, not only the words', async () => {
        const bind = binding();
        await openTurnLedger(query, schema, bind);
        const agentId = randomUUID();
        await recordTurnResult(query, schema, {
            inboundMessageId: bind.inboundMessageId,
            envelope: envelope('Listo, te dejo el enlace', agentId),
            writers: [{ tool: 'create_appointment', status: 'succeeded', ledgerId: randomUUID(), receipt: 'appt-1' }],
            agentId, agentVersion: 7, operationalScope: { kind: 'agent', agentId },
        });

        const replay = await openTurnLedger(query, schema, bind);
        expect(replay.state).toBe('result_recorded');
        expect(replay.envelope?.text).toBe('Listo, te dejo el enlace');
        // The three effects the Redis cache never held.
        expect(replay.envelope?.paymentLinks).toEqual(['https://checkout.example/abc']);
        expect(replay.envelope?.media).toEqual([{ url: 'https://cdn.example/one.jpg', caption: 'la foto' }]);
        expect(replay.envelope?.learningFootprints).toHaveLength(1);
        // And what already happened in the business, so it is not run again.
        expect(replay.writers).toEqual([expect.objectContaining({ tool: 'create_appointment', status: 'succeeded', receipt: 'appt-1' })]);
        expect(replay.agentVersion).toBe(7);
    });

    it('keeps the first result when a second attempt generated its own answer', async () => {
        const bind = binding();
        await openTurnLedger(query, schema, bind);
        await recordTurnResult(query, schema, { inboundMessageId: bind.inboundMessageId, envelope: envelope('la primera') });
        const second = await recordTurnResult(query, schema,
            { inboundMessageId: bind.inboundMessageId, envelope: envelope('la segunda') });
        expect(second.envelope?.text).toBe('la primera');
        expect((await readTurnLedger(query, schema, bind.inboundMessageId))?.envelope?.text).toBe('la primera');
    });

    it('refuses a row whose binding is a different conversation wearing the same message id', async () => {
        const bind = binding();
        await openTurnLedger(query, schema, bind);
        await expect(openTurnLedger(query, schema, { ...bind, contactId: randomUUID() }))
            .rejects.toMatchObject({ code: 'turn_ledger_binding_mismatch' });
        await expect(openTurnLedger(query, schema, { ...bind, recipient: '573009998877' }))
            .rejects.toMatchObject({ code: 'turn_ledger_binding_mismatch' });
    });

    it('records which path owns the delivery and never moves a settled turn back', async () => {
        const bind = binding();
        await openTurnLedger(query, schema, bind);
        await recordTurnResult(query, schema, { inboundMessageId: bind.inboundMessageId, envelope: envelope('hola') });
        expect((await recordTurnDelivery(query, schema,
            { inboundMessageId: bind.inboundMessageId, route: 'durable' }))?.state).toBe('dispatch_owned');
        await settleTurnLedger(query, schema, bind.inboundMessageId);
        const late = await recordTurnDelivery(query, schema, { inboundMessageId: bind.inboundMessageId, route: 'legacy' });
        expect(late?.state).toBe('settled');
        expect(late?.deliveryRoute).toBe('legacy');
    });

    it('holds the handoff this turn produced', async () => {
        const bind = binding();
        await openTurnLedger(query, schema, bind);
        await recordTurnResult(query, schema, { inboundMessageId: bind.inboundMessageId, envelope: envelope('te paso con alguien') });
        const receiptId = randomUUID();
        const row = await recordTurnHandoff(query, schema,
            { inboundMessageId: bind.inboundMessageId, handoff: { receiptId, reason: 'customer_asked', noticeKind: 'transferring' } });
        expect(row?.handoff).toEqual({ receiptId, reason: 'customer_asked', noticeKind: 'transferring' });
    });

    it('erases the envelope for a contact and keeps the row that stops a replay', async () => {
        const bind = binding();
        await openTurnLedger(query, schema, bind);
        await recordTurnResult(query, schema, { inboundMessageId: bind.inboundMessageId, envelope: envelope('con datos') });
        expect(await redactTurnLedger(query, schema, { contactIds: [bind.contactId] })).toBe(1);

        const after = await readTurnLedger(query, schema, bind.inboundMessageId);
        expect(after?.redacted).toBe(true);
        expect(after?.envelope).toBeNull();
        expect(after?.binding).toBeNull();
        // The row itself survives: it is what stops the turn from running again.
        expect(after?.id).toBeTruthy();
        // And a second erasure is not an error.
        expect(await redactTurnLedger(query, schema, { contactIds: [bind.contactId] })).toBe(0);
    });

    it('erases only the turns that derived from a withdrawn release', async () => {
        const withdrawn = binding(), untouched = binding();
        const agentId = randomUUID();
        await openTurnLedger(query, schema, withdrawn);
        await recordTurnResult(query, schema, { inboundMessageId: withdrawn.inboundMessageId, envelope: envelope('con estilo', agentId) });
        await openTurnLedger(query, schema, untouched);
        await recordTurnResult(query, schema, {
            inboundMessageId: untouched.inboundMessageId,
            envelope: { ...envelope('sin estilo'), learningFootprints: [] },
        });

        expect(await redactTurnLedger(query, schema, { releaseIds: [release] })).toBeGreaterThanOrEqual(1);
        expect((await readTurnLedger(query, schema, withdrawn.inboundMessageId))?.envelope).toBeNull();
        expect((await readTurnLedger(query, schema, untouched.inboundMessageId))?.envelope?.text).toBe('sin estilo');
    });

    it('refuses an erasure with no scope rather than clearing the table', async () => {
        await expect(redactTurnLedger(query, schema, {} as any))
            .rejects.toBeInstanceOf(TurnLedgerError);
        await expect(redactTurnLedger(query, schema, { contactIds: [], releaseIds: [] }))
            .rejects.toBeInstanceOf(TurnLedgerError);
    });

    it('erases several contacts at once, the way the compliance path asks', async () => {
        const one = binding(), two = binding(), other = binding();
        for (const bind of [one, two, other]) {
            await openTurnLedger(query, schema, bind);
            await recordTurnResult(query, schema, { inboundMessageId: bind.inboundMessageId, envelope: envelope('hola') });
        }
        expect(await redactTurnLedger(query, schema, { contactIds: [one.contactId, two.contactId] })).toBe(2);
        expect((await readTurnLedger(query, schema, other.inboundMessageId))?.envelope?.text).toBe('hola');
    });

    it('answers zero for a tenant that never took a turn through the ledger', async () => {
        // Erasure must not fail because there was nothing to erase.
        const empty = `${schema}_absent`;
        await query(`CREATE SCHEMA IF NOT EXISTS "${empty}"`);
        try {
            expect(await redactTurnLedger(query, empty, { contactIds: [randomUUID()] })).toBe(0);
        } finally {
            await query(`DROP SCHEMA IF EXISTS "${empty}" CASCADE`);
        }
    });

    /**
     * Silence, written down.
     *
     * Before Meta charged per message, "we are not answering right now" was an
     * absence: a log line the next tick could not read. Now the difference
     * between a recorded wait and an absence is a loop of "¿podrías repetirlo?"
     * that the business pays for, so it has to survive a restart.
     */
    describe('what the turn decided, silence included', () => {
        const outcome = (kind: any, reason: string | null, resumeAfter?: string): any => ({
            version: 1, kind, ...(reason ? { reason } : {}),
            ...(resumeAfter ? { resumeAfter } : {}), effects: [],
        });

        it('keeps a wait, with its reason and its deadline, across a read', async () => {
            const bind = binding();
            await openTurnLedger(query, schema, bind);
            const resume = new Date(Date.now() + 600_000).toISOString();
            await recordTurnOutcome(query, schema, { inboundMessageId: bind.inboundMessageId,
                outcome: outcome('wait', 'failure_notice_already_sent', resume) });
            const row = await readTurnLedger(query, schema, bind.inboundMessageId);
            expect(row?.outcome).toMatchObject({
                kind: 'wait', reason: 'failure_notice_already_sent', resumeAfter: resume, effects: [],
            });
        });

        it('refuses to store a silence that carries an effect', async () => {
            // The one thing this column must never hold: a chargeable message
            // wearing the label of silence.
            const bind = binding();
            await openTurnLedger(query, schema, bind);
            await expect(recordTurnOutcome(query, schema, {
                inboundMessageId: bind.inboundMessageId,
                outcome: { version: 1, kind: 'wait', reason: 'x', resumeAfter: new Date().toISOString(),
                    effects: ['dispatch-1'] } as any,
            })).rejects.toThrow('turn_outcome_silence_cannot_send');
            expect((await readTurnLedger(query, schema, bind.inboundMessageId))?.outcome).toBeNull();
        });

        it('refuses a wait with no deadline, which is a silence nobody revisits', async () => {
            const bind = binding();
            await openTurnLedger(query, schema, bind);
            await expect(recordTurnOutcome(query, schema, {
                inboundMessageId: bind.inboundMessageId,
                outcome: { version: 1, kind: 'wait', reason: 'x', effects: [] } as any,
            })).rejects.toThrow('turn_outcome_wait_needs_deadline');
        });

        /** An outbox row for a turn, in whatever state the case is about. */
        const effect = async (bind: any, state: string, receipt: string | null) => {
            await query(
                `INSERT INTO "${schema}".agent_dispatch_outbox
                    (batch_id, conversation_id, contact_id, inbound_message_id, channel_type,
                     channel_account_id, recipient, item_index, item_kind, payload, state, receipt,
                     lease_token, lease_expires_at)
                 VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'whatsapp','acct','57300',0,'text',
                     '{"text":"no te entendi"}'::jsonb,$5,$6,
                     CASE WHEN $5 = 'admitted' THEN gen_random_uuid() END,
                     CASE WHEN $5 = 'admitted' THEN NOW() + INTERVAL '1 minute' END)`,
                [randomUUID(), bind.conversationId, bind.contactId, bind.inboundMessageId, state, receipt]);
        };

        it('finds the notices already sent on this conversation, newest first', async () => {
            const conversationId = randomUUID();
            const first = binding({ conversationId });
            const second = binding({ conversationId });
            await openTurnLedger(query, schema, first);
            await openTurnLedger(query, schema, second);
            await recordTurnOutcome(query, schema, { inboundMessageId: first.inboundMessageId,
                outcome: outcome('send', 'failure_notice') });
            await effect(first, 'sent', `wamid.OUT.${randomUUID()}`);
            await recordTurnOutcome(query, schema, { inboundMessageId: second.inboundMessageId,
                outcome: outcome('suppress', 'turn_produced_nothing') });
            const recent = await readRecentTurnOutcomes(query, schema, {
                conversationId, since: new Date(Date.now() - 3_600_000) });
            expect(recent.map(entry => entry.outcome.kind)).toEqual(
                expect.arrayContaining(['send', 'suppress']));
            expect(failureNoticesInEpisode(recent as any)).toBe(1);
        });

        /**
         * ═══ THE DECISION AND THE DELIVERY ARE DIFFERENT FACTS ═══
         *
         * The decision row is written BEFORE the dispatch it asks for, because
         * writing it after would lose the intent to a crash and send the same
         * notice twice. So the row alone proves only that a turn meant to speak.
         * Between it and the customer's phone there is a commit, a queue, a lease
         * and a POST — and each case below is one of those ending badly.
         *
         * Counted as delivered, any of them answers the customer's NEXT message
         * with silence on the strength of a message they never received.
         */
        it.each([
            ['a crash before admission leaves the item prepared', 'prepared', null, 0],
            ['a provider rejection', 'failed', null, 0],
            ['an outcome nobody could resolve', 'reconciliation_required', null, 0],
            ['an acceptance the provider never receipted', 'sent', null, 0],
            ['a delivery the provider acknowledged', 'sent', 'wamid.OUT.ok', 1],
        ])('counts %s as evidence or not', async (_label, state, receipt, expected) => {
            const conversationId = randomUUID();
            const bind = binding({ conversationId });
            await openTurnLedger(query, schema, bind);
            await recordTurnOutcome(query, schema, { inboundMessageId: bind.inboundMessageId,
                outcome: outcome('send', 'failure_notice') });
            await effect(bind, state as string, receipt as string | null);
            const recent = await readRecentTurnOutcomes(query, schema, {
                conversationId, since: new Date(Date.now() - 3_600_000) });
            expect({ state, counted: failureNoticesInEpisode(recent as any) })
                .toEqual({ state, counted: expected });
        });

        it('counts nothing at all for a turn that never reached the outbox', async () => {
            // The crash before the batch was even prepared. There is no row to
            // find, and the customer is owed a notice.
            const conversationId = randomUUID();
            const bind = binding({ conversationId });
            await openTurnLedger(query, schema, bind);
            await recordTurnOutcome(query, schema, { inboundMessageId: bind.inboundMessageId,
                outcome: outcome('send', 'failure_notice') });
            const recent = await readRecentTurnOutcomes(query, schema, {
                conversationId, since: new Date(Date.now() - 3_600_000) });
            expect(recent).toHaveLength(1);
            expect(failureNoticesInEpisode(recent as any)).toBe(0);
        });

        it('does not read another conversation\'s notices as this one\'s', async () => {
            // Two customers failing at once must not silence each other.
            const mine = randomUUID();
            const theirs = binding();
            await openTurnLedger(query, schema, theirs);
            await recordTurnOutcome(query, schema, { inboundMessageId: theirs.inboundMessageId,
                outcome: outcome('send', 'failure_notice') });
            const recent = await readRecentTurnOutcomes(query, schema, {
                conversationId: mine, since: new Date(Date.now() - 3_600_000) });
            expect(recent).toHaveLength(0);
        });

        /**
         * ═══ A SILENT TURN HAS TO BE ABLE TO CLOSE ═══
         *
         * `agent_turn_ledger_result` demanded an `envelope` for every state past
         * `open`. A turn that deliberately said nothing has an `outcome` and NO
         * envelope, so `settled` was refused by PostgreSQL and the row stayed
         * `result_recorded` forever — the ledger contradicting the decision it
         * had just been asked to record. The store only logged a warning, so it
         * was invisible.
         *
         * These walk the whole path the runtime walks, for both silent kinds.
         */
        it.each(['wait', 'suppress'] as const)(
            'takes a %s from open to settled, which the old constraint refused', async kind => {
                const bind = binding();
                await openTurnLedger(query, schema, bind);
                expect((await readTurnLedger(query, schema, bind.inboundMessageId))?.state).toBe('open');

                const resume = kind === 'wait' ? new Date(Date.now() + 600_000).toISOString() : undefined;
                await recordTurnOutcome(query, schema, { inboundMessageId: bind.inboundMessageId,
                    outcome: outcome(kind, `${kind}_reason`, resume) });
                // No envelope anywhere on this row: that is the whole point.
                const recorded = await readTurnLedger(query, schema, bind.inboundMessageId);
                expect(recorded?.envelope).toBeNull();
                expect(recorded?.outcome).toMatchObject({ kind, effects: [] });

                await expect(settleTurnLedger(query, schema, bind.inboundMessageId)).resolves.toBeTruthy();
                const settled = await readTurnLedger(query, schema, bind.inboundMessageId);
                expect({ state: settled?.state, envelope: settled?.envelope })
                    .toEqual({ state: 'settled', envelope: null });
            });

        it('still refuses a row past open that carries neither answer nor decision', async () => {
            // Widened, not dropped. A settled row with nothing on it would say
            // the turn produced no result when it produced one and lost it.
            const bind = binding();
            await openTurnLedger(query, schema, bind);
            await expect(query(`UPDATE "${schema}".agent_turn_ledger SET state = 'settled'
                                 WHERE inbound_message_id = $1::uuid`, [bind.inboundMessageId]))
                .rejects.toThrow(/agent_turn_ledger_result/);
        });

        it('replays a settled silence from the ledger alone, with no Redis in the picture', async () => {
            // The recovery question after a restart: was this inbound already
            // decided? For a silent turn the answer lived only in Redis, and
            // Redis is a cache. Now it is a row, and the row survives.
            const bind = binding();
            await openTurnLedger(query, schema, bind);
            await recordTurnOutcome(query, schema, { inboundMessageId: bind.inboundMessageId,
                outcome: outcome('suppress', 'turn_produced_nothing') });
            await settleTurnLedger(query, schema, bind.inboundMessageId);

            // A fresh connection is the closest thing to "the process restarted":
            // nothing in memory, nothing in a cache, only what was committed.
            const replay = new Client({ connectionString: connection });
            await replay.connect();
            try {
                const rows = (await replay.query(
                    `SELECT state, outcome, envelope FROM "${schema}".agent_turn_ledger
                      WHERE inbound_message_id = $1::uuid`, [bind.inboundMessageId])).rows;
                expect(rows).toHaveLength(1);
                expect(rows[0].state).toBe('settled');
                expect(rows[0].outcome).toMatchObject({ kind: 'suppress' });
                expect(rows[0].envelope).toBeNull();
            } finally { await replay.end(); }
        });

        it('lets an old episode fall out of the window', async () => {
            const conversationId = randomUUID();
            const bind = binding({ conversationId });
            await openTurnLedger(query, schema, bind);
            await recordTurnOutcome(query, schema, { inboundMessageId: bind.inboundMessageId,
                outcome: outcome('send', 'failure_notice') });
            await query(`UPDATE "${schema}".agent_turn_ledger SET created_at = NOW() - INTERVAL '2 hours'
                          WHERE inbound_message_id = $1::uuid`, [bind.inboundMessageId]);
            const recent = await readRecentTurnOutcomes(query, schema, {
                conversationId, since: new Date(Date.now() - 1_800_000) });
            expect(recent).toHaveLength(0);
        });
    });

    describe('the draft a person was one click from sending', () => {
        const withdrawn = randomUUID(), untouched = randomUUID();
        const draft = (releaseId: string) => JSON.stringify({
            pendingDraft: { text: 'Te ayudo con eso.', learningReleaseIds: [releaseId] },
        });

        it('takes back only the draft whose release was withdrawn', async () => {
            await query(`CREATE TABLE IF NOT EXISTS "${schema}".conversations(
                id UUID PRIMARY KEY, metadata JSONB, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
            const gone = randomUUID(), kept = randomUUID(), anonymous = randomUUID();
            await query(`INSERT INTO "${schema}".conversations(id, metadata)
                VALUES ($1::uuid,$4::jsonb),($2::uuid,$5::jsonb),($3::uuid,'{"pendingDraft":{"text":"sin origen"}}'::jsonb)`,
            [gone, kept, anonymous, draft(withdrawn), draft(untouched)]);

            expect(await redactPendingDrafts(query, schema, { releaseIds: [withdrawn] })).toBe(1);
            const metadata = async (id: string) =>
                (await query<any[]>(`SELECT metadata FROM "${schema}".conversations WHERE id=$1::uuid`, [id]))[0].metadata;
            expect(await metadata(gone)).not.toHaveProperty('pendingDraft');
            // A draft from a release nobody withdrew stays, and so does one with
            // no provenance at all: erasing a person's pending work because an
            // unrelated release was retracted costs more than the window is worth.
            expect(await metadata(kept)).toHaveProperty('pendingDraft');
            expect(await metadata(anonymous)).toHaveProperty('pendingDraft');
        });

        it('answers zero for a conversations table with nowhere to hold a draft', async () => {
            // This runs inside the caller's exclusive privacy fence, so a throw
            // here would roll back the WHOLE withdrawal of the release — one
            // under-provisioned tenant would make every retraction impossible.
            const bare = `${schema}_bare`;
            await query(`CREATE SCHEMA IF NOT EXISTS "${bare}"`);
            try {
                await query(`CREATE TABLE "${bare}".conversations(id UUID PRIMARY KEY)`);
                expect(await redactPendingDrafts(query, bare, { releaseIds: [withdrawn] })).toBe(0);
            } finally {
                await query(`DROP SCHEMA IF EXISTS "${bare}" CASCADE`);
            }
        });
    });
});
