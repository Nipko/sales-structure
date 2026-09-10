import { BadRequestException, ConflictException } from '@nestjs/common';
import { AGENT_ACCOUNT_DAYS } from '@parallext/shared';
import { TenantsService } from './tenants.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const hours = () => ({ is247: false, timezone: 'America/Bogota', afterHoursMessage: 'Te responderemos en horario de atención.',
    schedule: Object.fromEntries(AGENT_ACCOUNT_DAYS.map(day => [day, { enabled: true, open: '08:00', close: '17:00' }])) });
function harness() {
    let tenant: any = { industry: 'restaurantes', schemaName: 'tenant_test', settings: { businessHours: hours(), unrelated: { keep: true } } };
    let version = 5; let failAgent = false;
    const statements: string[] = [];
    const query = async (sql: string, params: any[] = []) => {
        statements.push(sql);
        if (sql.startsWith('UPDATE public.tenants')) {
            if (JSON.stringify(tenant.settings.businessHours ?? null) !== params[2]) return [];
            tenant.settings = { ...tenant.settings, ...JSON.parse(params[1]) }; return [{ id: TENANT }];
        }
        if (sql.startsWith('UPDATE agent_personas')) {
            if (failAgent) throw new Error('agent update failed');
            version++; return [{ id: 'agent' }];
        }
        throw new Error('Unexpected query');
    };
    const prisma = { tenant: { findUnique: jest.fn(async () => structuredClone(tenant)) },
        transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => {
            const before = { tenant: structuredClone(tenant), version };
            try { return await callback(query); } catch (error) { tenant = before.tenant; version = before.version; throw error; }
        }) };
    const persona = { invalidatePersonaResolutionCaches: jest.fn() };
    const events = { emit: jest.fn() };
    const service = new TenantsService(prisma as any, { del: jest.fn() } as any, {} as any, persona as any, {} as any, {} as any, {} as any,
        {} as any, {} as any, {} as any, {} as any, {} as any, events as any);
    return { service, tenant: () => tenant, version: () => version, statements, persona, events, failAgent: () => { failAgent = true; } };
}
describe('business-hours editor concurrency', () => {
    it('requires the exact displayed baseline and preserves unrelated settings', async () => {
        const h = harness(); const next = hours(); next.is247 = true;
        await h.service.update(TENANT, { expectedBusinessHours: hours(), settings: { businessHours: next } });
        expect(h.tenant().settings).toEqual({ businessHours: next, unrelated: { keep: true } });
        expect(h.version()).toBe(6);
        expect(h.statements[0]).toContain("COALESCE(settings->'businessHours','null'::jsonb)=$3::jsonb");
        expect(h.persona.invalidatePersonaResolutionCaches).toHaveBeenCalledWith(TENANT);
        expect(h.events.emit).toHaveBeenCalledWith('agent-quality.dependencies.updated', { tenantId: TENANT, source: 'tenant_settings' });
    });
    it('rejects an old page after another writer changed the hours', async () => {
        const h = harness(); h.tenant().settings.businessHours.timezone = 'Europe/Paris';
        await expect(h.service.update(TENANT, { expectedBusinessHours: hours(), settings: { businessHours: hours() } })).rejects.toBeInstanceOf(ConflictException);
        expect(h.version()).toBe(5);
        expect(h.tenant().settings.businessHours.timezone).toBe('Europe/Paris');
        expect(h.events.emit).not.toHaveBeenCalled();
    });
    it('rolls back hours if invalidating the behavioral versions cannot be committed', async () => {
        const h = harness(); h.failAgent(); const next = hours(); next.is247 = true;
        await expect(h.service.update(TENANT, { expectedBusinessHours: hours(), settings: { businessHours: next } })).rejects.toThrow('agent update failed');
        expect(h.tenant().settings.businessHours).toEqual(hours());
        expect(h.events.emit).not.toHaveBeenCalled();
    });
    it('rejects unversioned and invalid settings before writing', async () => {
        const h = harness();
        await expect(h.service.update(TENANT, { settings: { businessHours: hours() } })).rejects.toBeInstanceOf(BadRequestException);
        await expect(h.service.update(TENANT, { expectedBusinessHours: hours(), settings: { businessHours: { ...hours(), timezone: 'wrong' } } })).rejects.toBeInstanceOf(BadRequestException);
        expect(h.statements).toHaveLength(0);
    });
});
