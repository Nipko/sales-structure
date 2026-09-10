import { randomUUID } from 'crypto';
import { Client } from 'pg';
import {
    TURN_LEDGER_DDL, TurnLedgerError,
    openTurnLedger, readTurnLedger, recordTurnDelivery, recordTurnHandoff,
    recordTurnResult, redactPendingDrafts, redactTurnLedger, settleTurnLedger,
    type TurnBinding, type TurnEnvelope,
} from './agent-turn-ledger';

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
