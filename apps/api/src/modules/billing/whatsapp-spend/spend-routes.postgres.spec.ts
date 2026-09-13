import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { WhatsappSpendController } from './whatsapp-spend.controller';
import { declareSpendCeiling, readSpendCeilings, type SpendQuery } from './spend-ledger';
import { isTenantDeclarableScope } from './spend-scopes';
import { WHATSAPP_RATE_CARDS } from '../whatsapp-rates/whatsapp-rate-table.generated';

/**
 * ═══ THE THREE DOORS THAT WERE NEVER CUT ═══
 *
 * The ledger has honoured standing ceilings since it was built. The campaign
 * estimator prices a send before anybody presses it. The funding classifier
 * knows the difference between "no card" and "we could not ask". All three were
 * written, tested and unreachable: no route returned any of them, so a tenant
 * could not set a limit, could not see what a campaign would cost, and found
 * out about their funding when Meta refused the first send.
 *
 * The dashboard agent building the screens is what surfaced it — three separate
 * "I needed this field and there is no endpoint" findings in one report. A
 * capability with no door is not a capability.
 *
 * These cases drive the controller directly against real PostgreSQL. The
 * oracle for money is the published rate card, read by hand in the test, never
 * the resolver the estimator itself calls.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;

(connection ? describe : describe.skip)('the spend routes a person actually reaches', () => {
    const schema = `tenant_routes_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID();
    const NUMBER = '15550001111';
    const WABA = '900900900';
    let client: Client;
    let controller: WhatsappSpendController;
    jest.setTimeout(180_000);

    const query: SpendQuery = async <R = any[]>(sql: string, params: any[] = []): Promise<R> =>
        (await client.query(sql, params)).rows as any;

    const req = (role = 'tenant_admin') => ({ user: { tenantId, role } });

    /** The USD card in force, read by hand — never through the estimator's resolver. */
    const usdCard = WHATSAPP_RATE_CARDS
        .filter(card => card.currency === 'USD' && card.effectiveFrom <= '2026-10-15')
        .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))
        .at(-1)!;
    const microsFor = (market: string, category: string) => {
        const entry = usdCard.entries.find(row => row.market === market)!;
        return (entry.micros as Record<string, number | null>)[category]!;
    };

    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new Client({ connectionString: connection });
        await client.connect();
        await query(`CREATE SCHEMA "${schema}"`);
        const tenantSchema = readFileSync(resolve(__dirname, '../../../../prisma/tenant-schema.sql'), 'utf8');
        const block = tenantSchema.split('-- BEGIN WHATSAPP SPEND LEDGER')[1]
            ?.split('-- END WHATSAPP SPEND LEDGER')[0];
        if (!block) throw new Error('tenant_schema_block_missing');
        for (const statement of block.replace(/^\s*--.*$/gm, '').split(';').filter(value => value.trim())) {
            await query(statement.replaceAll('{{SCHEMA_NAME}}', schema));
        }
        await query(`CREATE TABLE "${schema}".whatsapp_channels(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), phone_number_id TEXT, meta_waba_id TEXT)`);
        await query(`CREATE TABLE "${schema}".whatsapp_templates(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), channel_id UUID, name TEXT, language TEXT,
            category TEXT, approval_status TEXT, last_sync_at TIMESTAMPTZ DEFAULT NOW())`);
        await query(`INSERT INTO "${schema}".whatsapp_channels(phone_number_id, meta_waba_id)
                     VALUES($1,$2)`, [NUMBER, WABA]);
        await query(`INSERT INTO "${schema}".whatsapp_templates(channel_id, name, language, category,
                        approval_status)
                     SELECT id, 'promo_octubre', 'es', 'MARKETING', 'APPROVED'
                       FROM "${schema}".whatsapp_channels WHERE phone_number_id = $1`, [NUMBER]);

        const prisma: any = {
            getTenantSchemaName: async () => schema,
            // The real one sets the search path before the statement. A fake
            // that does not makes an unqualified table name resolve to nothing
            // and the caller read it as "the catalogue has no such template" —
            // a fixture disagreeing with production about where tables live.
            executeInTenantSchema: async (_schema: string, sql: string, params: any[] = []) => {
                await client.query(`SET search_path TO "${schema}", public`);
                try { return (await client.query(sql, params)).rows; }
                finally { await client.query('SET search_path TO public'); }
            },
            transactionInTenantSchema: async (_schema: string, work: any) => work(query),
            channelAccount: {
                findMany: async () => [{ accountId: NUMBER, displayName: 'Principal' }],
            },
        };
        const spend: any = {
            ceilings: (_s: string, input: any) =>
                prisma.transactionInTenantSchema(schema, (q: SpendQuery) =>
                    readSpendCeilings(q, schema, input)),
            setCeiling: (_s: string, input: any) =>
                prisma.transactionInTenantSchema(schema, (q: SpendQuery) =>
                    declareSpendCeiling(q, schema, input)),
        };
        const pauses: any = { current: async () => null };
        controller = new WhatsappSpendController(prisma, spend, pauses, {} as any);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_routes_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    describe('setting a ceiling', () => {
        const scope = () => ({ scopeKind: 'account', scopeKey: `k-${randomUUID()}`, period: '2026-10' });

        it('stores money and messages together, which is the whole point', async () => {
            const answer = await controller.setCeiling(req(), {
                ...scope(), capMinor: 5_000, capDeliveries: 100, currency: 'USD',
            });
            expect(answer.success).toBe(true);
            expect(answer.data.capKind).toBe('both');
        });

        it('refuses a money ceiling with no currency, as a 400 and not a 500', async () => {
            // The ledger's refusals are ANSWERS. A caller that gets a 500 for
            // saying something wrong cannot tell it from an outage.
            await expect(controller.setCeiling(req(), { ...scope(), capMinor: 5_000 }))
                .rejects.toBeInstanceOf(BadRequestException);
        });

        it.each([
            ['a scope kind nobody defined', { scopeKind: 'whatever', scopeKey: 'k', period: '2026-10' }],
            ['no scope key', { scopeKind: 'account', scopeKey: '  ', period: '2026-10' }],
            ['a period that is not a month', { scopeKind: 'account', scopeKey: 'k', period: '2026' }],
        ])('refuses %s', async (_case, body) => {
            await expect(controller.setCeiling(req(), body as any))
                .rejects.toBeInstanceOf(BadRequestException);
        });

        it('reads them back with what is committed against them', async () => {
            const on = scope();
            await controller.setCeiling(req(), { ...on, capDeliveries: 40 });
            const answer = await controller.ceilings(req(), '2026-10');
            expect(answer.data.ceilings.some(row => row.scopeKey === on.scopeKey)).toBe(true);
            // WHAT MAY BE SET IS NOT WHAT MAY BE READ. This field sits beside
            // the ceilings a form is about to edit, so it is the menu that
            // form offers — and it used to offer `number_month`, which the
            // POST on the same controller refuses by name. A menu whose
            // entries the server rejects is a 400 the screen walked into.
            expect(answer.data.scopeKinds).not.toContain('number_month');
            // And reading one is still legitimate: that row is Meta's free
            // thousand, so reading it is how somebody checks what is left.
            expect(answer.data.readableScopeKinds).toContain('number_month');
            // The pairing itself, rather than two hardcoded lists: every kind
            // the GET offers to set must survive the POST's own guard.
            for (const kind of answer.data.scopeKinds) {
                expect(isTenantDeclarableScope(kind)).toBe(true);
            }
        });

        it('says what a ceiling cannot promise, from the server', async () => {
            // Said once, by the server, so no screen has to compose it and none
            // can quietly omit it.
            const answer = await controller.ceilings(req());
            expect(answer.data.scopeNote).toContain('lo que envía Parallly');
            expect(answer.data.scopeNote).toMatch(/otra aplicación|bandeja de Meta/);
        });
    });

    describe('estimating a campaign', () => {
        const people = (...addresses: (string | null)[]) =>
            addresses.map((address, index) => ({ recipientRef: `r${index}`, address }));

        it('prices it from the template’s APPROVED category, read here not supplied', async () => {
            // Meta charges by the approved category, and a category supplied by
            // a client is one a client can get wrong in the cheap direction.
            const answer = await controller.campaignEstimate(req(), {
                channelAccountId: NUMBER, templateName: 'promo_octubre', currency: 'USD',
                wabaTimeZone: 'America/Bogota',
                recipients: people('+573001112233', '+4915112345678'),
            });
            expect(answer.data.category).toBe('marketing');
            expect(answer.data.totalMicros).toBe(
                microsFor('Colombia', 'marketing') + microsFor('Germany', 'marketing'));
        });

        it('prices nothing when the catalogue does not know the template', async () => {
            const answer = await controller.campaignEstimate(req(), {
                channelAccountId: NUMBER, templateName: 'no_sincronizada', currency: 'USD',
                wabaTimeZone: 'America/Bogota', recipients: people('+573001112233'),
            });
            expect(answer.data.category).toBeNull();
            expect(answer.data.priced).toBe(0);
            expect(answer.data.unpricedByReason.category_unknown).toBe(1);
        });

        it('counts the recipients it could not price beside the total', async () => {
            const answer = await controller.campaignEstimate(req(), {
                channelAccountId: NUMBER, templateName: 'promo_octubre', currency: 'USD',
                wabaTimeZone: 'America/Bogota',
                recipients: people('+573001112233', '+14155550123', null),
            });
            expect(answer.data.priced).toBe(1);
            expect(answer.data.unpriced).toHaveLength(2);
            expect(answer.data.totalMicros).toBe(microsFor('Colombia', 'marketing'));
        });

        it('refuses an unbounded list rather than pinning a worker', async () => {
            await expect(controller.campaignEstimate(req(), {
                channelAccountId: NUMBER, templateName: 'promo_octubre',
                recipients: Array.from({ length: 50_001 },
                    (_unused, index) => ({ recipientRef: `r${index}`, address: '+573001112233' })),
            })).rejects.toBeInstanceOf(BadRequestException);
        });

        it.each([
            ['no account', { templateName: 'promo_octubre', recipients: [{ address: '+57300' }] }],
            ['no recipients', { channelAccountId: '15550001111', recipients: [] }],
        ])('refuses a request with %s', async (_case, body) => {
            await expect(controller.campaignEstimate(req(), body as any))
                .rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('funding readiness', () => {
        it('reports what it knows and says it did not ask Meta', async () => {
            // A screen that renders "we have not checked" the same as "checked
            // and fine" is the defect the whole classifier exists to avoid, and
            // a client cannot avoid it without being told which it is seeing.
            const answer = await controller.fundingReadiness(req());
            expect(answer.data.numbers).toHaveLength(1);
            expect(answer.data.numbers[0].state).toBe('not_checked');
            expect(answer.data.numbers[0].delivery).toBe('unestablished');
            expect(answer.data.numbers[0].actionable).toBe(false);
            expect(answer.data.probe.reachesMeta).toBe(false);
            expect(answer.data.probe.note).toContain('no es');
        });

        it('never reports a number nobody checked as ready', async () => {
            const answer = await controller.fundingReadiness(req());
            for (const number of answer.data.numbers) {
                expect(number.delivery).not.toBe('ready');
            }
        });
    });
});
