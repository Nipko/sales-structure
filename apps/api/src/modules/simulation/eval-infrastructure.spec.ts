import { EvalService } from './eval.service';
import { composeSubtypeEvalPack } from '@parallext/shared';
import { EVAL_EFFECT_VERIFIERS } from './eval.service';

function buildService() {
    const prisma = {
        executeInTenantSchema: jest.fn().mockResolvedValue([{ cnt: 1 }]),
        getTenantSchemaName: jest.fn().mockResolvedValue('tenant_schema'),
        tenant: { findUnique: jest.fn() },
    };
    const service = new EvalService(
        prisma as any,
        {} as any,
        {} as any,
        { acquireLock: jest.fn(), releaseLock: jest.fn() } as any,
        { emit: jest.fn() } as any,
    );
    return { service, prisma };
}

describe('versioned multilingual eval infrastructure', () => {
    it('upserts the managed pack in all four languages with profile/locale/version identity', async () => {
        const { service, prisma } = buildService();
        await (service as any).seedDefaults('tenant_schema', {
            industry: 'retail', subtype: 'moda',
            language: 'es', locale: 'es-CO', addressForm: 'usted',
        });

        const inserts = prisma.executeInTenantSchema.mock.calls
            .filter((call: any[]) => String(call[1]).includes('INSERT INTO eval_scenarios'));
        expect(inserts.length).toBeGreaterThan(100);
        expect(new Set(inserts.map((call: any[]) => call[2][3])))
            .toEqual(new Set(['es', 'en', 'pt', 'fr']));
        expect(inserts.every((call: any[]) => String(call[1]).includes('DO UPDATE SET'))).toBe(true);
        expect(inserts.every((call: any[]) => String(call[2][0]).startsWith(
            'eval:v2:retail/moda:',
        ))).toBe(true);
        expect(inserts.find((call: any[]) => call[2][3] === 'es')?.[2][4]).toBe('es-CO');
        expect(inserts.every((call: any[]) => call[2][6] === 2)).toBe(true);
        expect(inserts.every((call: any[]) => call[2][8])).toBe(true);
        expect(inserts.every((call: any[]) => call[2][9] === 'active')).toBe(true);

        const retirement = prisma.executeInTenantSchema.mock.calls.find(
            (call: any[]) => String(call[1]).includes("SET seed_state = 'retired'"),
        );
        expect(retirement?.[1]).toContain('managed_seed_key IS NOT NULL');
        expect(retirement?.[2][0]).toEqual(inserts.map((call: any[]) => call[2][0]));
    });

    it('supports tool-call assertions and fails closed for an unaudited effect family', async () => {
        const { service } = buildService();
        const result = await (service as any).verifyActions(
            'tenant_schema',
            [
                { kind: 'tool_call', type: 'called', tool: 'search_products' },
                { kind: 'tool_call', type: 'not_called', tool: 'create_payment_link' },
                {
                    kind: 'db_effect', type: 'row_exists', family: 'orders', table: 'orders',
                    description: 'order writer sandbox',
                },
            ],
            '00000000-0000-4000-8000-00000000eba1',
            [{ name: 'search_products', result: { products: [] } }],
        );
        expect(result.checks.slice(0, 2).every((check: any) => check.ok)).toBe(true);
        expect(result.checks[2]).toMatchObject({ ok: false, description: 'order writer sandbox' });
        expect(result.passed).toBe(false);
    });

    it('has one contact-scoped verifier for every mutating sandbox family', () => {
        expect(Object.keys(EVAL_EFFECT_VERIFIERS).sort()).toEqual([
            'appointments', 'catalog_orders', 'class_bookings', 'enrollments',
            'photo_sessions', 'property_bookings', 'resource_rentals',
            'restaurant_orders', 'service_requests', 'tour_bookings',
        ]);
        expect(EVAL_EFFECT_VERIFIERS.class_bookings.contactColumn).toBe('contact_id');
    });

    it('prepares owned fixtures and cleanup covers effects, ledger, conversations and fixtures', async () => {
        const { service, prisma } = buildService();
        prisma.executeInTenantSchema.mockResolvedValue([]);

        await (service as any).prepareSandboxFixtures('tenant_schema');
        const fixtureWrites = prisma.executeInTenantSchema.mock.calls
            .filter((call: any[]) => /INSERT INTO "tenant_schema"\./.test(String(call[1])));
        expect(fixtureWrites.length).toBeGreaterThanOrEqual(14);
        expect(fixtureWrites.every((call: any[]) => /ON CONFLICT \(id\) DO UPDATE/.test(String(call[1]))))
            .toBe(true);

        prisma.executeInTenantSchema.mockClear();
        await (service as any).cleanupSandbox('tenant_schema');
        const deletes = prisma.executeInTenantSchema.mock.calls.map((call: any[]) => String(call[1]));
        for (const verifier of Object.values(EVAL_EFFECT_VERIFIERS)) {
            expect(deletes.some(sql => sql.includes(`.${verifier.table} WHERE ${verifier.contactColumn}`)))
                .toBe(true);
        }
        expect(deletes.some(sql => sql.includes('.tool_execution_ledger'))).toBe(true);
        expect(deletes.some(sql => sql.includes('.messages'))).toBe(true);
        expect(deletes.some(sql => sql.includes('.conversations'))).toBe(true);
        expect(deletes.filter(sql => /metadata->>'evalSandbox' = 'true'/.test(sql)).length)
            .toBeGreaterThanOrEqual(10);
    });

    it('creates the sandbox conversation with the required channel account identity', async () => {
        const { service, prisma } = buildService();
        prisma.executeInTenantSchema.mockResolvedValue([
            { id: '11111111-1111-4111-8111-111111111111' },
        ]);

        await expect((service as any).ensureSandboxConversation('tenant_schema'))
            .resolves.toBe('11111111-1111-4111-8111-111111111111');

        const [, sql, params] = prisma.executeInTenantSchema.mock.calls[0];
        expect(sql).toContain(
            'INSERT INTO conversations (contact_id, channel_type, channel_account_id, status, stage)',
        );
        expect(params).toEqual([
            '00000000-0000-4000-8000-00000000eba1',
            'eval-sandbox',
        ]);
    });

    it('always cleans a partially prepared sandbox when the model/provider path fails', async () => {
        const { service } = buildService();
        const cleanup = jest.spyOn(service as any, 'cleanupSandbox').mockResolvedValue(undefined);
        jest.spyOn(service as any, 'prepareSandboxFixtures').mockResolvedValue(undefined);
        jest.spyOn(service as any, 'ensureSandboxConversation')
            .mockResolvedValue('11111111-1111-4111-8111-111111111111');
        jest.spyOn(service as any, 'recordSandboxInbound').mockResolvedValue(undefined);
        (service as any).agentTest = {
            test: jest.fn().mockRejectedValue(new Error('provider unavailable')),
        };

        await expect((service as any).runScenarioWithActions(
            'tenant-id',
            '22222222-2222-4222-8222-222222222222',
            'tenant_schema',
            {
                messages: ['confirm'],
                expectedActions: [{ kind: 'tool_call', type: 'not_called', tool: 'create_appointment' }],
            },
            7,
            true,
        )).rejects.toThrow('provider unavailable');

        expect(cleanup).toHaveBeenCalledTimes(2);
        expect(cleanup).toHaveBeenNthCalledWith(1, 'tenant_schema');
        expect(cleanup).toHaveBeenNthCalledWith(2, 'tenant_schema');
    });

    it('retires exact legacy seeds, preserves custom rows and quarantines ambiguous edits', async () => {
        const exact = composeSubtypeEvalPack({
            industry: 'retail', subtype: 'moda', language: 'es', addressForm: 'usted',
        }).find(scenario => scenario.key === 'greeting')!;
        const rows = [
            {
                id: '11111111-1111-4111-8111-111111111111', key: exact.key,
                title: exact.title, language: exact.language,
                messages: exact.messages, criteria: exact.criteria,
            },
            {
                id: '22222222-2222-4222-8222-222222222222', key: 'my_custom_regression',
                title: 'My scenario', language: 'en', messages: ['Custom'], criteria: 'Custom',
            },
            {
                id: '33333333-3333-4333-8333-333333333333', key: 'intent_place_catalog_order_happy_path',
                title: 'Owner edited this', language: 'en', messages: ['Custom edit'], criteria: 'Custom edit',
            },
        ];
        const { service, prisma } = buildService();
        prisma.executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) => (
            sql.includes('WHERE contract_version IS NULL') ? rows : []
        ));

        await (service as any).migrateLegacyScenarios('tenant_schema', {
            industry: 'retail', subtype: 'moda', language: 'es', locale: 'es-CO', addressForm: 'usted',
        });

        const updates = prisma.executeInTenantSchema.mock.calls
            .filter((call: any[]) => String(call[1]).includes('UPDATE eval_scenarios'));
        expect(updates.map((call: any[]) => call[2])).toEqual(expect.arrayContaining([
            [rows[0].id, 'legacy_managed', 'greeting', 'retired'],
            [rows[1].id, 'custom_legacy', null, 'active'],
            [rows[2].id, 'legacy_ambiguous', rows[2].key, 'review_required'],
        ]));
        expect(prisma.executeInTenantSchema.mock.calls.some(
            (call: any[]) => /DELETE FROM eval_scenarios/i.test(String(call[1])),
        )).toBe(false);
    });
});
