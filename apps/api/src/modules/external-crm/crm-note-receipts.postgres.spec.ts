import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Pool } from 'pg';
import {
    CRM_NOTE_RECEIPT_DDL, crmNoteReceiptCounts, ensureCrmNoteReceipts, pendingCrmNoteRetractions,
    recordCrmNoteReceipt, requestCrmNoteRetraction, retryCrmNoteRetraction, settleCrmNoteRetraction,
    type CrmReceiptQuery, type CrmRetractionOutcome,
} from './crm-note-receipts';
import { ExternalCrmService, type CrmSyncJob } from './external-crm.service';
import type { CrmRetraction } from './adapters/crm-adapter.interface';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';

/**
 * The copy of the agent's words that lives in somebody else's CRM.
 *
 * A transfer to a human writes a summary of the customer's conversation and
 * pushes it into the tenant's HubSpot or Pipedrive as a note. The adapter
 * returned the id of the note it created and `runJob` dropped it: `persistLink`
 * is called for a contact and a deal, never for an activity. So an erasure could
 * clear `handoff_summary`, delete the internal notes, and leave the same
 * paragraph — a customer's problem, in their words — sitting in a third party's
 * CRM with nothing able to point at it.
 *
 * The provider here is synthetic and answers whatever the test tells it to,
 * which is the only way to exercise the third outcome: a real CRM cannot be
 * asked to time out on demand, and `unknown` is precisely the state that must
 * never be quietly rounded up to success.
 */

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;

const MIGRATION = resolve(__dirname, '../../../prisma/migrations/20260909190000_add_crm_note_receipts/migration.sql');

(connection ? describe : describe.skip)('where a pushed handoff note went', () => {
    let pool: Pool;
    const schema = `crmnote_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID();
    const connectionId = randomUUID();
    const contactId = randomUUID();
    const otherContact = randomUUID();

    const sql = async (text: string, params: any[] = []): Promise<any[]> => {
        const client = await pool.connect();
        try {
            // `SET LOCAL` outside a transaction does nothing, and every helper
            // here runs a single statement, so the session setting is the one
            // that applies. Re-set on each borrow, because the pool hands the
            // same connection to the parity test, which points it elsewhere.
            await client.query(`SET search_path TO "${schema}"`);
            return (await client.query(text, params)).rows;
        } finally { client.release(); }
    };
    const query: CrmReceiptQuery = ((text: string, params: any[] = []) => sql(text, params)) as CrmReceiptQuery;

    // ── the synthetic provider ──────────────────────────────────────────────
    let nextNoteId = 1000;
    let retraction: CrmRetraction = { outcome: 'accepted', detail: 'http_204' };
    const retracted: string[] = [];
    let adapter: any;
    let service: ExternalCrmService;
    const enqueued: Array<{ name: string; data: CrmSyncJob; opts: any }> = [];

    beforeAll(async () => {
        if (!isDisposableDatabase(connection)) throw new Error('disposable_database_required');
        pool = new Pool({ connectionString: connection, max: 4 });
        await sql(`CREATE SCHEMA "${schema}"`);
        await sql(`CREATE TABLE "${schema}".crm_external_links(
            provider TEXT, entity TEXT, internal_id UUID, external_id TEXT, external_url TEXT,
            last_synced_at TIMESTAMPTZ, checksum TEXT, updated_at TIMESTAMPTZ)`);
        await sql(`CREATE TABLE "${schema}".crm_sync_log(
            provider TEXT, entity TEXT, internal_id UUID, external_id TEXT, operation TEXT,
            status TEXT, error_message TEXT, duration_ms INT)`);
        await ensureCrmNoteReceipts(query);
        // The contact has to be synced before an activity can be pushed at all.
        await sql(`INSERT INTO "${schema}".crm_external_links(provider, entity, internal_id, external_id)
            VALUES('synthetic','contact',$1::uuid,'ext-contact-1'),('synthetic','contact',$2::uuid,'ext-contact-2')`,
        [contactId, otherContact]);

        adapter = {
            provider: 'synthetic',
            pushActivity: jest.fn(async () => ({ externalId: `note-${nextNoteId++}`, operation: 'create' })),
            retractActivity: jest.fn(async (_ctx: any, externalId: string) => {
                retracted.push(externalId);
                return retraction;
            }),
        };
        const prisma: any = {
            tenant: { findUnique: async () => ({ schemaName: schema }) },
            crmConnection: {
                findFirst: async () => ({ id: connectionId, tenantId, provider: 'synthetic',
                    status: 'active', accessToken: 'sealed', refreshToken: null, tokenExpiresAt: null }),
                update: async () => undefined,
                findMany: async () => [{ id: connectionId, provider: 'synthetic' }],
            },
            executeInTenantSchema: (_schema: string, text: string, params: any[] = []) => sql(text, params),
        };
        service = new ExternalCrmService(
            prisma,
            { get: () => undefined } as any,
            { decrypt: (value: string) => value, encrypt: (value: string) => value } as any,
            { get: () => adapter } as any,
            {} as any,
            { add: async (name: string, data: CrmSyncJob, opts: any) => { enqueued.push({ name, data, opts }); return { id: name }; } } as any,
        );
    }, 60000);

    afterAll(async () => {
        if (pool) {
            await sql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await pool.end();
        }
    });

    beforeEach(async () => {
        enqueued.length = 0;
        retracted.length = 0;
        retraction = { outcome: 'accepted', detail: 'http_204' };
        await sql('DELETE FROM crm_note_receipts');
    });

    const pushNote = async (sourceId: string, contact = contactId): Promise<void> => {
        await service.runJob({
            tenantId, connectionId, provider: 'synthetic', entity: 'activity', operation: 'pushActivity',
            payload: { id: randomUUID(), contactId: contact, type: 'note', body: 'El cliente pidió hablar con alguien.',
                occurredAt: new Date() },
            receipt: { sourceKind: 'handoff_summary', sourceId, contactId: contact },
        } as CrmSyncJob);
    };

    const drain = async (): Promise<void> => {
        await service.retractPendingCrmNotes(tenantId);
        for (const job of enqueued.filter(entry => entry.data.operation === 'retractActivity')) {
            await service.runJob(job.data);
        }
    };

    it('writes down the id the provider gave back, which used to be dropped', async () => {
        await pushNote('handoff-1');
        const [row] = await sql('SELECT * FROM crm_note_receipts');
        expect(row).toMatchObject({
            connection_id: connectionId, provider: 'synthetic',
            source_kind: 'handoff_summary', source_id: 'handoff-1',
            contact_id: contactId, state: 'recorded',
        });
        expect(String(row.external_id)).toMatch(/^note-\d+$/);
    }, 120000);

    it('resolves the same handoff pushed twice to one row', async () => {
        await pushNote('handoff-2');
        const [first] = await sql('SELECT external_id FROM crm_note_receipts');
        await pushNote('handoff-2');
        const rows = await sql('SELECT external_id, retract_reason FROM crm_note_receipts');
        expect(rows).toHaveLength(1);
        // A second push that returns a different id keeps the NEWER one, because
        // that is the one a retraction has to use — and says so, because losing
        // the older note is worth somebody knowing about.
        expect(rows[0].external_id).not.toBe(first.external_id);
        expect(rows[0].retract_reason).toBe(`superseded:${first.external_id}`);
    }, 120000);

    it('lets an erasure name the copy outside the platform, and only that person\'s', async () => {
        await pushNote('handoff-mine');
        await pushNote('handoff-theirs', otherContact);
        expect(await requestCrmNoteRetraction(query, [contactId])).toBe(1);
        const rows = await sql('SELECT source_id, state, retract_reason FROM crm_note_receipts ORDER BY source_id');
        expect(rows[0]).toMatchObject({ source_id: 'handoff-mine', state: 'retract_pending', retract_reason: 'contact_erasure' });
        expect(rows[1]).toMatchObject({ source_id: 'handoff-theirs', state: 'recorded' });
    }, 120000);

    it.each<[CrmRetractionOutcome, string]>([
        ['accepted', 'retracted'],
        ['rejected', 'rejected'],
        ['unknown', 'unknown'],
    ])('settles a %s answer as %s and never as "we tried"', async (outcome, state) => {
        await pushNote(`handoff-${outcome}`);
        await requestCrmNoteRetraction(query, [contactId]);
        retraction = { outcome, detail: `synthetic_${outcome}` };
        await drain();
        expect(retracted).toHaveLength(1);
        const [row] = await sql('SELECT state, attempts, last_error FROM crm_note_receipts');
        expect(row).toMatchObject({ state, attempts: 1, last_error: `synthetic_${outcome}` });
    }, 120000);

    it('does not delete the same note twice when the drain runs again', async () => {
        await pushNote('handoff-idempotent');
        await requestCrmNoteRetraction(query, [contactId]);
        await drain();
        expect(retracted).toHaveLength(1);
        const settled = retracted[0];
        // A settled receipt is no longer pending, so a second sweep finds nothing
        // to do — which is what makes the reconcile safe to run as often as it
        // likes against somebody else's CRM.
        enqueued.length = 0;
        expect(await service.retractPendingCrmNotes(tenantId)).toBe(0);
        await drain();
        expect(retracted).toEqual([settled]);
        expect((await sql('SELECT state FROM crm_note_receipts'))[0].state).toBe('retracted');
    }, 120000);

    it('does not sweep a refusal back up, and does re-ask an unknown when told to', async () => {
        await pushNote('handoff-refused');
        await pushNote('handoff-silent');
        await requestCrmNoteRetraction(query, [contactId]);
        retraction = { outcome: 'rejected', detail: 'http_403' };
        await drain();
        retraction = { outcome: 'unknown', detail: 'transport:timeout' };
        // Both are terminal answers now; neither is work.
        await sql("UPDATE crm_note_receipts SET state='unknown' WHERE source_id='handoff-silent'");
        enqueued.length = 0;
        expect(await service.retractPendingCrmNotes(tenantId)).toBe(0);
        // Retrying is a decision somebody makes, and only about the answer nobody
        // got. A refusal stays refused rather than looping against the tenant's CRM.
        const [silent] = await sql("SELECT id FROM crm_note_receipts WHERE source_id='handoff-silent'");
        const [refused] = await sql("SELECT id FROM crm_note_receipts WHERE source_id='handoff-refused'");
        expect(await retryCrmNoteRetraction(query, String(silent.id))).toBe(true);
        expect(await retryCrmNoteRetraction(query, String(refused.id))).toBe(false);
        expect(await service.retractPendingCrmNotes(tenantId)).toBe(1);
    }, 120000);

    it('says unknown when the provider cannot delete a note at all', async () => {
        await pushNote('handoff-no-support');
        await requestCrmNoteRetraction(query, [contactId]);
        const supported = adapter.retractActivity;
        adapter.retractActivity = undefined;
        try {
            await drain();
        } finally { adapter.retractActivity = supported; }
        const [row] = await sql('SELECT state, last_error FROM crm_note_receipts');
        // Visible, with the reason on it. Not a silent success on a note still
        // sitting in somebody's CRM.
        expect(row).toMatchObject({ state: 'unknown', last_error: 'provider_cannot_retract' });
    }, 120000);

    it('settles once when two reconcile passes race over the same receipt', async () => {
        await pushNote('handoff-race');
        await requestCrmNoteRetraction(query, [contactId]);
        const [row] = await sql('SELECT id FROM crm_note_receipts');
        const both = await Promise.all([
            settleCrmNoteRetraction(query, String(row.id), 'accepted'),
            settleCrmNoteRetraction(query, String(row.id), 'rejected'),
        ]);
        expect(both.filter(Boolean)).toHaveLength(1);
        expect(Number((await sql('SELECT attempts FROM crm_note_receipts'))[0].attempts)).toBe(1);
    }, 120000);

    it('counts what is still owed, so the gap is a number somebody can see', async () => {
        await pushNote('handoff-count-1');
        await pushNote('handoff-count-2');
        await requestCrmNoteRetraction(query, [contactId]);
        const [row] = await sql("SELECT id FROM crm_note_receipts WHERE source_id='handoff-count-1'");
        await settleCrmNoteRetraction(query, String(row.id), 'accepted');
        expect(await crmNoteReceiptCounts(query)).toMatchObject({ retracted: 1, retract_pending: 1, recorded: 0 });
        expect((await pendingCrmNoteRetractions(query)).map(receipt => receipt.sourceId)).toEqual(['handoff-count-2']);
    }, 120000);

    it('refuses an outcome that is not one of the three', async () => {
        await expect(settleCrmNoteRetraction(query, randomUUID(), 'maybe' as any))
            .rejects.toThrow('crm_retraction_outcome_invalid');
    }, 120000);

    it('does nothing at all on a tenant that has no receipts table', async () => {
        const bare = `crmnote_${randomUUID().replace(/-/g, '')}`;
        const client = await pool.connect();
        try {
            await client.query(`CREATE SCHEMA "${bare}"`);
            await client.query(`SET search_path TO "${bare}"`);
            const bareQuery = (async (text: string, params: any[] = []) =>
                (await client.query(text, params)).rows) as CrmReceiptQuery;
            // Runs inside the erasure's transaction, so a missing relation must
            // answer rather than abort everything after it.
            expect(await requestCrmNoteRetraction(bareQuery, [contactId])).toBe(0);
            expect(await pendingCrmNoteRetractions(bareQuery)).toEqual([]);
            expect(await recordCrmNoteReceipt(bareQuery, { connectionId, provider: 'synthetic',
                sourceKind: 'handoff_summary', sourceId: 'x', externalId: 'note-x' })).toBeNull();
        } finally {
            await client.query('SET search_path TO public');
            await client.query(`DROP SCHEMA IF EXISTS "${bare}" CASCADE`);
            client.release();
        }
    }, 120000);

    it('keeps asking, so a job lost to a restart is not a note left behind', async () => {
        await pushNote('handoff-lost');
        await requestCrmNoteRetraction(query, [contactId]);
        // The drain enqueues from the ROW, not from anything the erasure held in
        // memory — which is the same thing that makes it the recovery path: the
        // job below is simply thrown away, as a restart would.
        expect(await service.drainCrmRetractions()).toBe(1);
        enqueued.length = 0;
        expect(await service.drainCrmRetractions()).toBe(1);
        expect(enqueued).toHaveLength(1);
        // And the job id is deterministic, so the second enqueue is the same job
        // rather than a second delete of the same note.
        const [row] = await sql('SELECT id FROM crm_note_receipts');
        expect(enqueued[0].opts.jobId).toBe(`crm-retract-${row.id}`);
        await drain();
        expect((await sql('SELECT state FROM crm_note_receipts'))[0].state).toBe('retracted');
        expect(await service.drainCrmRetractions()).toBe(0);
    }, 120000);

    // ── the three definitions of the table ──────────────────────────────────
    it('creates the same table from the bootstrap, the template and the migration', async () => {
        const paths = {
            bootstrap: `crmnote_boot_${randomUUID().replace(/-/g, '')}`,
            fresh: `crmnote_fresh_${randomUUID().replace(/-/g, '')}`,
            migrated: `crmnote_migr_${randomUUID().replace(/-/g, '')}`,
        };
        const client = await pool.connect();
        try {
            for (const name of Object.values(paths)) await client.query(`CREATE SCHEMA "${name}"`);
            await client.query(`SET search_path TO "${paths.bootstrap}"`);
            for (const statement of CRM_NOTE_RECEIPT_DDL) await client.query(statement);
            await client.query('SET search_path TO public');

            const template = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
            const block = template.split('-- BEGIN CRM NOTE RECEIPTS')[1]?.split('-- END CRM NOTE RECEIPTS')[0];
            if (!block) throw new Error('tenant_schema_block_missing:CRM NOTE RECEIPTS');
            for (const statement of block.replace(/^\s*--.*$/gm, '').split(';').filter(value => value.trim())) {
                await client.query(statement.replaceAll('{{SCHEMA_NAME}}', paths.fresh));
            }

            await client.query('CREATE TABLE IF NOT EXISTS public.tenants(id UUID PRIMARY KEY, schema_name TEXT NOT NULL)');
            const row = randomUUID();
            await client.query('INSERT INTO public.tenants(id, schema_name) VALUES($1::uuid,$2)', [row, paths.migrated]);
            try { await client.query(readFileSync(MIGRATION, 'utf8')); }
            finally { await client.query('DELETE FROM public.tenants WHERE id=$1::uuid', [row]); }

            const columns = async (name: string) => (await client.query(
                `SELECT table_name, column_name, data_type, is_nullable, column_default
                   FROM information_schema.columns WHERE table_schema=$1 AND table_name='crm_note_receipts'
                  ORDER BY column_name`, [name])).rows;
            const indexes = async (name: string) => (await client.query(
                `SELECT replace(indexdef, $1 || '.', '') AS definition FROM pg_indexes
                  WHERE schemaname=$1 AND tablename='crm_note_receipts' ORDER BY definition`, [name])).rows;
            const boot = await columns(paths.bootstrap);
            // A path that created nothing would make the comparison trivially true.
            expect(boot.length).toBeGreaterThan(10);
            expect(await columns(paths.fresh)).toEqual(boot);
            expect(await columns(paths.migrated)).toEqual(boot);
            const bootIndexes = await indexes(paths.bootstrap);
            expect(bootIndexes.some(entry => String(entry.definition).includes('uidx_crm_note_receipt_source'))).toBe(true);
            expect(await indexes(paths.fresh)).toEqual(bootIndexes);
            expect(await indexes(paths.migrated)).toEqual(bootIndexes);
        } finally {
            for (const name of Object.values(paths)) await client.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
            client.release();
        }
    }, 120000);

    it('is additive, so the old code can keep running during a rolling restart', () => {
        const migration = readFileSync(MIGRATION, 'utf8');
        const statements = migration
            .replace(/CHECK \([^)]*\)/gi, '')
            .split(/;|\bEXECUTE format\(\$ddl\$/i)
            .map(part => part.trim());
        for (const statement of statements) {
            expect(statement).not.toMatch(/^\s*(DROP|ALTER|UPDATE|DELETE|INSERT INTO|TRUNCATE)\b/i);
        }
        expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b|\bALTER\s+TABLE\b/i);
        expect((migration.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length).toBe(1);
    });
});
