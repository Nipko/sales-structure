import { EvalService } from './eval.service';
import { composeSubtypeEvalPack } from '@parallext/shared';
import { EVAL_EFFECT_VERIFIERS } from './eval.service';

function buildService() {
    const prisma = {
        executeInTenantSchema: jest.fn().mockResolvedValue([{ cnt: 1 }]),
        getTenantSchemaName: jest.fn().mockResolvedValue('tenant_schema'),
        tenant: { findUnique: jest.fn() },
    };
    const lease = { schemaName:'tenant_eval_11111111_111111111111111111111111',tenantId:'tenant-id',sourceSchema:'tenant_schema',token:'token',expiresAt:new Date(Date.now()+3600000).toISOString(),tables:[] };
    const namespaces = { provisionRuntime:jest.fn().mockResolvedValue(lease),assertOwned:jest.fn().mockResolvedValue(undefined),dispose:jest.fn().mockResolvedValue(undefined) };
    const service = new EvalService(
        prisma as any,
        {} as any,
        {} as any,
        { acquireLockToken:jest.fn().mockResolvedValue('token'),renewLockToken:jest.fn().mockResolvedValue(true),releaseLockToken:jest.fn().mockResolvedValue(true) } as any,
        { emit: jest.fn() } as any,undefined,namespaces as any,
    );
    return { service, prisma, namespaces, lease };
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
            'photo_sessions', 'property_bookings', 'repair_orders', 'resource_rentals',
            'restaurant_orders', 'service_requests', 'tour_bookings',
        ]);
        expect(EVAL_EFFECT_VERIFIERS.class_bookings.contactColumn).toBe('contact_id');
    });

    it('prepares only an owned namespace and tears it down without deleting any live contact rows', async () => {
        const {service,prisma,namespaces,lease}=buildService();
        prisma.executeInTenantSchema.mockResolvedValue([{id:'11111111-1111-4111-8111-111111111111'}]);
        await service.withSandboxSession('tenant-id',async session=>{await session.reset('telegram');await session.recordInbound('hola');});
        expect(namespaces.provisionRuntime).toHaveBeenCalledWith('tenant-id','tenant_schema');
        expect(prisma.executeInTenantSchema.mock.calls.every(call=>call[0]===lease.schemaName)).toBe(true);
        expect(prisma.executeInTenantSchema.mock.calls.every(call=>!String(call[1]).includes('DELETE FROM'))).toBe(true);
        expect(namespaces.dispose).toHaveBeenCalledWith(lease);
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
            'web_widget',
        ]);
    });

    it('cleans its namespace when a provider fails and rejects missing sandbox infrastructure', async () => {
        const {service,prisma,namespaces,lease}=buildService();
        prisma.executeInTenantSchema.mockResolvedValue([{id:'11111111-1111-4111-8111-111111111111'}]);
        (service as any).agentTest={test:jest.fn().mockRejectedValue(new Error('provider unavailable'))};
        await expect((service as any).runScenarioWithActions('tenant-id','agent','tenant_schema',{messages:['hola']},7,false)).rejects.toThrow('provider unavailable');
        expect(namespaces.dispose).toHaveBeenCalledTimes(1);expect(namespaces.dispose).toHaveBeenCalledWith(lease);
        (service as any).namespaces=undefined;prisma.executeInTenantSchema.mockClear();
        await expect(service.withSandboxSession('tenant-id',async session=>session.reset('telegram'))).rejects.toThrow('canonical_sandbox_not_available');
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
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
