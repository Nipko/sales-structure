import { listVerticalCapabilityConfigurations } from '@parallext/shared';
import { READINESS, VerticalReadinessService } from './vertical-readiness.service';

describe('vertical readiness executable contract', () => {
    it('implements every declared readiness key except the provisioned pipeline', () => {
        const declared = new Set(listVerticalCapabilityConfigurations()
            .flatMap(configuration => configuration.readiness.requirements));
        const missing = [...declared]
            .filter(key => key !== 'pipeline')
            .filter(key => !READINESS[key]);
        expect(missing).toEqual([]);
    });

    it('does not mistake customer records for business configuration', () => {
        expect(READINESS).not.toHaveProperty('professional_cases');
        expect(READINESS).not.toHaveProperty('treatment_catalog');
    });

    it('sends agenda-less and dispatch profiles to the direct service catalogue', () => {
        for (const key of ['service_catalog', 'photo_sessions', 'boarding_capacity'] as const) {
            expect(READINESS[key]?.repairRoute).toBe('/admin/service-catalog');
        }
    });

    it('proves appointment readiness across service, slot, user and tenant', async () => {
        const executeInTenantSchema = jest.fn().mockResolvedValue([{ total: 1 }]);
        const service = new VerticalReadinessService({ executeInTenantSchema } as any, {} as any);

        const report = await service.evaluate(
            '11111111-1111-4111-8111-111111111111',
            'tenant_appointments',
            ['appointment_services'],
            { mode: 'agent_test', persistence: 'disabled' },
        );

        expect(report.unmet).toEqual([]);
        expect(executeInTenantSchema).toHaveBeenCalledTimes(1);
        const [schema, sql, params] = executeInTenantSchema.mock.calls[0];
        expect(schema).toBe('tenant_appointments');
        expect(sql).toContain('FROM availability_slots availability');
        expect(sql).toContain('JOIN public.users staff_user');
        expect(sql).toContain('JOIN public.tenants tenant_owner');
        expect(sql).toContain('EXISTS (');
        expect(sql).toContain('FROM services service');
        expect(params).toEqual(['tenant_appointments']);
    });

    it('uses the leased actor directory during isolated certification', async () => {
        const executeInTenantSchema = jest.fn()
            .mockResolvedValueOnce([{ owned: 1 }])
            .mockResolvedValueOnce([{ total: 1 }]);
        const service = new VerticalReadinessService({ executeInTenantSchema } as any, {} as any);
        const sandboxNamespace = {
            schemaName: 'tenant_eval_11111111_111111111111111111111111',
            sourceSchema: 'tenant_source',
            tenantId: '11111111-1111-4111-8111-111111111111',
            token: '22222222-2222-4222-8222-222222222222',
            tables: [],
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };

        const report = await service.evaluate(
            sandboxNamespace.tenantId,
            sandboxNamespace.schemaName,
            ['appointment_services'],
            { mode: 'agent_test', persistence: 'disabled' },
            { sandboxNamespace },
        );

        expect(report.unmet).toEqual([]);
        expect(String(executeInTenantSchema.mock.calls[0][1])).toContain('FROM __eval_namespace');
        const readinessSql = String(executeInTenantSchema.mock.calls[1][1]);
        expect(readinessSql).toContain(`"${sandboxNamespace.schemaName}".__eval_ref_users`);
        expect(readinessSql).toContain(`"${sandboxNamespace.schemaName}".__eval_ref_tenants`);
    });

    it('proves education readiness against a future sellable cohort', async () => {
        const executeInTenantSchema = jest.fn().mockResolvedValue([{ total: 1 }]);
        const service = new VerticalReadinessService({ executeInTenantSchema } as any, {} as any);

        const report = await service.evaluate(
            '11111111-1111-4111-8111-111111111111',
            'tenant_education',
            ['courses'],
            { mode: 'agent_test', persistence: 'disabled' },
        );

        expect(report.unmet).toEqual([]);
        const sql = String(executeInTenantSchema.mock.calls[0][1]);
        expect(sql).toContain('course_cohorts cohort JOIN courses course');
        expect(sql).toContain("cohort.status IN ('open', 'full')");
        expect(sql).toContain("INTERVAL '180 days'");
        expect(sql).toContain('cohort.available_seats BETWEEN 0 AND cohort.max_capacity');
    });

    it('does not invent a check for an operational professional case', async () => {
        const prisma = {
            executeInTenantSchema: jest.fn().mockResolvedValue([{ total: 1 }]),
        };
        const redis = {
            getJson: jest.fn().mockResolvedValue(null),
            setJson: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(undefined),
        };
        const service = new VerticalReadinessService(prisma as any, redis as any);

        const report = await service.evaluate(
            '11111111-1111-4111-8111-111111111111',
            'tenant_professional',
            [],
        );

        expect(report).toMatchObject({
            degraded: false,
            unmet: [],
            checks: [],
        });
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });
});
