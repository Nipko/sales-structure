import { AGENT_CONFIG_TOOL_FAMILIES } from '@parallext/shared';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PersonaController } from './persona.controller';
import { PersonaService } from './persona.service';
import { summarizeAgentToolConfiguration } from './agent-tool-configuration-summary';

const row = (tools: unknown, active = true) => ({ tools, is_active: active, config_valid: true });

describe('published tool configuration for manual modules', () => {
    it('considers every agent, not just the default, and separates paused agents', () => {
        const summary = summarizeAgentToolConfiguration([
            row({ appointments: { enabled: false } }), row({ appointments: { enabled: true } }),
            row({ appointments: { enabled: true } }, false),
        ]);
        expect(summary).toMatchObject({ source: 'operational', totalAgents: 3,
            families: { appointments: { activeEnabledAgents: 1, pausedEnabledAgents: 1, unknownAgents: 0 } } });
        expect(Object.keys(summary.families)).toEqual([...AGENT_CONFIG_TOOL_FAMILIES]);
    });

    it('does not infer activation from subpermissions, strings or arbitrary tool data', () => {
        const summary = summarizeAgentToolConfiguration([
            row({ appointments: { enabled: false, canBook: true }, private: 'do-not-expose' }),
            row({ appointments: { enabled: 'true' } }), row(null),
        ]);
        expect(summary.families.appointments).toEqual({ activeEnabledAgents: 0, pausedEnabledAgents: 0, unknownAgents: 1 });
        expect(JSON.stringify(summary)).not.toContain('do-not-expose');
    });

    it('distinguishes malformed configuration from an explicit disable', () => {
        for (const invalid of [row('broken'), { ...row({}), config_valid: false }]) {
            expect(Object.values(summarizeAgentToolConfiguration([invalid]).families).every(counts => counts.unknownAgents === 1)).toBe(true);
        }
        expect(summarizeAgentToolConfiguration([row({})]).families.appointments.unknownAgents).toBe(0);
        expect(summarizeAgentToolConfiguration([])).toMatchObject({ totalAgents: 0 });
    });

    it('reads a single tenant snapshot with legacy fallback, never drafts or initialization writes', async () => {
        const prisma = { executeInTenantSchema: jest.fn().mockResolvedValue([row({ appointments: { enabled: true } })]) };
        const tenants = { getSchemaName: jest.fn().mockResolvedValue('tenant_tools') };
        const service = new PersonaService(prisma as any, {} as any, tenants as any, {} as any, {} as any);
        const initialize = jest.spyOn(service as any, 'ensureTablesForTenant');
        expect((await service.getToolConfigurationSummary('tenant-id')).families.appointments.activeEnabledAgents).toBe(1);
        expect(tenants.getSchemaName).toHaveBeenCalledWith('tenant-id');
        expect(prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
        const [schema, sql] = prisma.executeInTenantSchema.mock.calls[0];
        expect(schema).toBe('tenant_tools');
        expect(sql).toContain("config_json->'tools'");
        expect(sql).toContain('NOT EXISTS (SELECT 1 FROM durable)');
        expect(sql).not.toMatch(/draft|INSERT|UPDATE|CREATE|DELETE|tenant-id/);
        expect(initialize).not.toHaveBeenCalled();
    });

    it('propagates an unavailable database instead of reporting every tool disabled', async () => {
        const service = new PersonaService({ executeInTenantSchema: jest.fn().mockRejectedValue(new Error('unavailable')) } as any,
            {} as any, { getSchemaName: jest.fn().mockResolvedValue('tenant_tools') } as any, {} as any, {} as any);
        await expect(service.getToolConfigurationSummary('tenant-id')).rejects.toThrow('unavailable');
    });

    it('keeps the summary behind authentication and tenant isolation', async () => {
        expect(Reflect.getMetadata(GUARDS_METADATA, PersonaController).map((guard: any) => guard.name))
            .toEqual(expect.arrayContaining(['RolesGuard', 'TenantGuard']));
        const summary = summarizeAgentToolConfiguration([]);
        const service = { getToolConfigurationSummary: jest.fn().mockResolvedValue(summary) };
        const controller = new PersonaController(service as any, {} as any, {} as any);
        expect(await controller.getToolConfigurationSummary('tenant-id')).toEqual({ success: true, data: summary });
        expect(service.getToolConfigurationSummary).toHaveBeenCalledWith('tenant-id');
    });
});
