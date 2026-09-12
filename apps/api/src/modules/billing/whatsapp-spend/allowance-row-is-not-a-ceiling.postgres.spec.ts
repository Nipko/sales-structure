import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappSpendService } from './whatsapp-spend.service';
import { WhatsappSpendController } from './whatsapp-spend.controller';
import { declareSpendCeiling, SpendLedgerError, type SpendQuery } from './spend-ledger';
import { TENANT_DECLARABLE_SCOPE_KINDS, SPEND_SCOPE_KINDS } from './spend-scopes';

/**
 * ═══ META'S ALLOWANCE IS NOT A CEILING A TENANT MAY EDIT ═══
 *
 * The `number_month` counter is not a limit somebody chose. It IS the free
 * thousand: `ensureCounters` seeds it `cap_kind = 'deliveries'`,
 * `cap_deliveries = 1000`, and `grantFreeDeliveries` hands out free slots with
 * `LEAST(used_deliveries + n, cap_deliveries)` against that exact row.
 *
 * `POST /whatsapp-spend/ceilings` validated its `scopeKind` against
 * `SPEND_SCOPE_KINDS`, which contains `number_month`, and passed it to an
 * INSERT … ON CONFLICT DO UPDATE that overwrites `cap_kind` and
 * `cap_deliveries`. Two reachable outcomes, both from a documented endpoint:
 *
 *   · `{scopeKind:'number_month', capDeliveries: 5000}` mints four thousand
 *     free deliveries that Meta bills in full. They are recorded
 *     `basis: 'free_allowance'`, `reservedMinor: 0`, so the exposure report
 *     shows a month costing nothing.
 *   · `{scopeKind:'number_month', capMinor: 5000}` with no `capDeliveries`
 *     writes `cap_kind='money'`, `cap_deliveries=NULL`. `grantFreeDeliveries`
 *     matches `AND cap_kind='deliveries'`, finds nothing, grants nothing, and
 *     the tenant is charged from their FIRST message for the rest of the month
 *     while the panel shows a thousand free ones waiting.
 *
 * That second one is verbatim the regression `ensureCounters` documents as
 * fixed, reachable again through the front door — and `ON CONFLICT DO NOTHING`
 * means the tampered row stands until the month rolls over.
 *
 * So the allowance scope is not tenant-declarable, at the route AND at the
 * ledger primitive: one of those is a validation, the other is the invariant.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;

describe('which scopes a tenant may declare a ceiling on', () => {
    it('excludes the allowance, and only the allowance', () => {
        expect(SPEND_SCOPE_KINDS).toContain('number_month');
        expect(TENANT_DECLARABLE_SCOPE_KINDS).not.toContain('number_month');
        // Every other scope stays declarable: the list is a subtraction, not a
        // second hand-maintained copy that can drift from the first.
        expect([...TENANT_DECLARABLE_SCOPE_KINDS].sort())
            .toEqual(SPEND_SCOPE_KINDS.filter(kind => kind !== 'number_month').slice().sort());
    });
});

(connection ? describe : describe.skip)('the allowance row, against a real database', () => {
    const schema = `tenant_allowguard_${randomUUID().replace(/-/g, '')}`;
    const TENANT = randomUUID();
    const ACCOUNT = '15550001111';
    let client: Client;
    let prisma: PrismaService;
    let priorUrl: string | undefined;
    jest.setTimeout(180_000);

    const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;
    const query: SpendQuery = async <R = any[]>(sql: string, params: any[] = []): Promise<R> =>
        (await client.query(sql, params)).rows as any;

    const send = (over: Record<string, unknown> = {}) =>
        new WhatsappSpendService(prisma as any).authorize(schema, {
            effectKey: `ag-${randomUUID().replace(/-/g, '')}`,
            identity: {
                tenantId: TENANT, channelType: 'whatsapp', channelAccountId: ACCOUNT,
                channelAddress: '+1 555 000 1111',
                payerKind: 'business_direct', payerWabaId: 'waba-1', payerBusinessId: 'biz-1',
                credentialId: 'cred-1', credentialSource: 'system_user',
                recipientScope: 'customer', recipientRef: 'contact-1',
                category: 'service', market: 'CO', currency: 'USD',
            } as any,
            contactId: 'contact-1', deliveries: 1,
            wabaTimeZone: 'America/Bogota', admissionReason: 'inbound_reply',
            disposition: 'reactive', allowUnknownCost: true,
            at: new Date('2026-10-05T12:00:00.000Z'),
            ...over,
        } as any);

    const allowance = async () => (await q(
        `SELECT cap_kind, cap_deliveries, free_deliveries, used_deliveries
           FROM "${schema}".whatsapp_spend_counters
          WHERE scope_kind = 'number_month' AND period_key = '2026-10'`))[0];

    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new Client({ connectionString: connection });
        await client.connect();
        await q(`CREATE SCHEMA "${schema}"`);
        const tenantSchema = readFileSync(
            resolve(__dirname, '../../../../prisma/tenant-schema.sql'), 'utf8');
        const block = tenantSchema.split('-- BEGIN WHATSAPP SPEND LEDGER')[1]
            ?.split('-- END WHATSAPP SPEND LEDGER')[0];
        if (!block) throw new Error('tenant_schema_block_missing');
        for (const statement of block.replace(/^\s*--.*$/gm, '').split(';').filter(v => v.trim())) {
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
            if (!/^tenant_allowguard_[a-f0-9]{32}$/.test(schema)) {
                throw new Error('invalid_cleanup_scope');
            }
            await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    beforeEach(async () => {
        await q(`TRUNCATE "${schema}".whatsapp_spend_allocations,
                          "${schema}".whatsapp_spend_reservations,
                          "${schema}".whatsapp_spend_counters`);
    });

    it('refuses to mint free deliveries Meta will bill in full', async () => {
        await send();
        await expect(declareSpendCeiling(query, schema, {
            scope: { kind: 'number_month', key: ACCOUNT, period: '2026-10' },
            capDeliveries: 5000,
        } as any)).rejects.toBeInstanceOf(SpendLedgerError);

        const row = await allowance();
        expect(Number(row.cap_deliveries)).toBe(1000);
        expect(row.cap_kind).toBe('deliveries');
    });

    it('refuses to destroy the allowance by making it a money row', async () => {
        // The worse of the two: nothing is minted, the free thousand simply
        // stops being granted and every message is charged from the first.
        await send();
        await expect(declareSpendCeiling(query, schema, {
            scope: { kind: 'number_month', key: ACCOUNT, period: '2026-10' },
            capMinor: 5_000, currency: 'USD',
        } as any)).rejects.toBeInstanceOf(SpendLedgerError);

        // And the proof is behavioural, not just the row: the next send is free.
        const next = await send();
        expect(Number((next as any).reservation.money.freeDeliveries)).toBe(1);
        expect((next as any).reservation.money.basis).toBe('free_allowance');
    });

    it('refuses it at the route as a 400, before any database is touched', async () => {
        const controller = new WhatsappSpendController(
            { getTenantSchemaName: async () => schema } as any,
            { setCeiling: async () => { throw new Error('must not reach the ledger'); } } as any,
            { current: async () => null } as any);
        await expect(controller.setCeiling({ user: { tenantId: TENANT, role: 'tenant_admin' } },
            { scopeKind: 'number_month', scopeKey: ACCOUNT, period: '2026-10', capDeliveries: 5000 }))
            .rejects.toBeInstanceOf(BadRequestException);
    });

    it('still lets a tenant cap the same NUMBER, through the scope that is theirs', async () => {
        // The allowance is Meta's; the account ceiling is the tenant's, and it
        // is keyed on the same phone number id. Refusing one must not take away
        // the other, or the guard would have removed the capability.
        const ceiling = await declareSpendCeiling(query, schema, {
            scope: { kind: 'account', key: ACCOUNT, period: '2026-10' },
            capDeliveries: 50,
        } as any);
        expect(ceiling.capDeliveries).toBe(50);
    });
});
