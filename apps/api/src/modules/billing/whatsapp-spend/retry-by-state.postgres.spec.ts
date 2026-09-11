import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappSpendService, mayTransmit } from './whatsapp-spend.service';

/**
 * ═══ WHAT A RETRY IS ALLOWED TO DO, PER STATE ═══
 *
 * A retry is not a decision. It is a worker waking up with the same job and no
 * new information, and the states it can wake up into mean very different
 * things:
 *
 *   `held`                     nothing has happened yet. Send.
 *   `pending_reconciliation`   it ARRIVED. Another POST is a second copy on a
 *                              customer's phone and a second charge.
 *   `indeterminate`            the provider may have acted and nobody knows.
 *                              Another POST is the duplicate the whole outbox
 *                              exists to prevent.
 *   `settled` / `released`     the money already moved. There is nothing left
 *                              to settle a second send against.
 *
 * So four of the five refuse, and the refusal is not a bug to be worked around:
 * the effect is finished or waiting on evidence nobody in the send path has. A
 * message that genuinely still needs to go out becomes a NEW effect, with its
 * own identity and its own reservation — which is the same rule as "two
 * campaigns with identical words are two messages", seen from the other side.
 *
 * Run against real PostgreSQL because the property is about what the row and
 * the counters say, and both are SQL.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

integration('what a retry may do with each reservation state', () => {
    const schema = `tenant_retrystate_${randomUUID().replace(/-/g, '')}`;
    const TENANT = randomUUID();
    let client: Client;
    let prisma: PrismaService;
    let priorUrl: string | undefined;
    jest.setTimeout(120_000);

    const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;
    const service = () => new WhatsappSpendService(prisma as any);

    const authorize = (effectKey: string) => service().authorize(schema, {
        effectKey,
        identity: {
            tenantId: TENANT, channelType: 'whatsapp', channelAccountId: '15550001111',
            channelAddress: '+1 555 000 1111',
            payerKind: 'business_direct', payerWabaId: 'waba-1', payerBusinessId: 'biz-1',
            credentialId: 'cred-1', credentialSource: 'system_user',
            recipientScope: 'customer', recipientRef: 'contact-1',
            category: 'marketing', market: 'CO', currency: 'USD',
        } as any,
        contactId: 'contact-1', deliveries: 1,
        wabaTimeZone: 'America/Bogota', admissionReason: 'campaign',
        disposition: 'proactive', allowUnknownCost: true,
        at: new Date('2026-10-05T12:00:00.000Z'),
    } as any);

    /**
     * Put a row in a state the way the schema allows one to exist.
     *
     * `settled` requires a charge and `settled`/`released` require evidence —
     * CHECK constraints, not conventions. A shortcut UPDATE that set only the
     * state was rejected by the database, which is the schema doing its job.
     */
    const forceState = (effectKey: string, state: string) => q(
        `UPDATE "${schema}".whatsapp_spend_reservations
            SET state = $2,
                charged_minor = CASE WHEN $2 = 'settled' THEN 0 ELSE NULL END,
                evidence = CASE WHEN $2 IN ('settled','released') THEN 'spec_forced' ELSE evidence END
          WHERE effect_key = $1`,
        [effectKey, state]);

    const counters = async () => (await q(
        `SELECT COALESCE(SUM(reserved_minor),0) AS reserved, COALESCE(SUM(settled_minor),0) AS settled
           FROM "${schema}".whatsapp_spend_counters WHERE scope_kind = 'account'`))[0];

    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new Client({ connectionString: connection });
        await client.connect();
        await q(`CREATE SCHEMA "${schema}"`);
        const tenantSchema = readFileSync(resolve(__dirname, '../../../../prisma/tenant-schema.sql'), 'utf8');
        const block = tenantSchema.split('-- BEGIN WHATSAPP SPEND LEDGER')[1]
            ?.split('-- END WHATSAPP SPEND LEDGER')[0];
        if (!block) throw new Error('tenant_schema_block_missing');
        for (const statement of block.replace(/^\s*--.*$/gm, '').split(';').filter(value => value.trim())) {
            await q(statement.replaceAll('{{SCHEMA_NAME}}', schema));
        }
        priorUrl = process.env.DATABASE_URL;
        process.env.DATABASE_URL = connection!;
        prisma = new PrismaService();
        await prisma.$connect();
    });

    afterAll(async () => {
        try { await prisma?.$disconnect(); } catch { /* already closed */ }
        if (priorUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = priorUrl;
        if (!client) return;
        try {
            if (!/^tenant_retrystate_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    beforeEach(async () => {
        await q(`TRUNCATE "${schema}".whatsapp_spend_allocations,
                          "${schema}".whatsapp_spend_reservations,
                          "${schema}".whatsapp_spend_counters`);
    });

    it('lets a retry send when nothing has happened yet', async () => {
        const effectKey = `rs-${randomUUID().replace(/-/g, '')}`;
        await authorize(effectKey);

        const retry = await authorize(effectKey);
        expect(retry.outcome).toBe('adopted');
        expect(mayTransmit(retry)).toBe(true);
        // And the claim is exclusive, so two workers waking together still
        // produce one POST.
        expect((await service().claimTransmission(schema, effectKey)).kind).toBe('granted');
    });

    for (const state of ['pending_reconciliation', 'indeterminate', 'settled', 'released'] as const) {
        it(`refuses a retry of a ${state} effect, and moves no money doing it`, async () => {
            const effectKey = `rs-${randomUUID().replace(/-/g, '')}`;
            await authorize(effectKey);
            await forceState(effectKey, state);
            const before = await counters();

            const retry = await authorize(effectKey);
            expect(retry.outcome).toBe('adopted');
            // The gate every sink applies. `adopted` alone never meant "send".
            expect(mayTransmit(retry)).toBe(false);
            // And the transmission right itself refuses, so a sink that forgot
            // the check still cannot POST.
            expect((await service().claimTransmission(schema, effectKey)).kind)
                .toBe('not_transmittable');
            // A refused retry reserves nothing. Adopting used to be free and
            // this is what makes it stay free.
            expect(await counters()).toEqual(before);
        });
    }

    it('opens a new attempt as its own effect, with its own money', async () => {
        // The other half of the rule. A message that genuinely still has to go
        // out after a proven rejection is a NEW effect: new identity, new
        // reservation, its own outcome. It does not resurrect the old row,
        // because the old row is the record of what already happened.
        const original = `rs-${randomUUID().replace(/-/g, '')}`;
        await authorize(original);
        await service().resolveManually(schema, {
            effectKey: original, decision: 'not_delivered',
            reason: 'the customer confirmed by phone that nothing arrived',
            actorId: 'user-42',
        });
        expect(mayTransmit(await authorize(original))).toBe(false);

        const fresh = service().effectKey({
            tenantId: TENANT, channelAccountId: '15550001111', recipientRef: 'contact-1',
            category: 'marketing', producer: 'campaign', ordinal: 0, contentDigest: 'digest',
            // Derived from the original on purpose: the lineage is readable, and
            // a second retry of the same original lands somewhere else again.
            logicalEffectId: `request:retry:${original}:1`,
        });
        expect(fresh).not.toBe(original);

        const reopened = await authorize(fresh);
        expect(reopened.outcome).toBe('reserved');
        expect(mayTransmit(reopened)).toBe(true);
        // Two rows, two identities, and only the new one may send.
        expect(Number((await q(
            `SELECT COUNT(*)::int AS n FROM "${schema}".whatsapp_spend_reservations`))[0].n)).toBe(2);
    });

    it('never lets an adopted terminal row look like a fresh reservation', async () => {
        // The specific defect: `outcome === 'adopted'` was read as success, and
        // a settled effect adopted on retry was told to send — a second copy of
        // a delivered message, with nothing left to settle it against.
        const effectKey = `rs-${randomUUID().replace(/-/g, '')}`;
        await authorize(effectKey);
        await forceState(effectKey, 'settled');

        const retry = await authorize(effectKey);
        expect(retry.outcome).toBe('adopted');
        expect((retry as any).reservation.state).toBe('settled');
        expect(mayTransmit(retry)).toBe(false);
    });
});
