import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PersonaService } from './persona.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SCHEMA = 'tenant_test';

function petServicesSettings() {
    return {
        verticalConfig: {
            industry: 'pet_services',
            subType: 'peluqueria',
            bookingEnabled: true,
            manifestVersion: 2,
            effectiveCapabilities: [
                'crm_pipeline', 'faq_search', 'appointment_booking',
                'pet_records', 'pet_services',
            ],
        },
    };
}

function buildHarness(options: {
    settings?: any;
    activeAgents?: number;
    maxAgents?: number;
    channelConflict?: boolean;
    services?: number;
    slots?: number;
} = {}) {
    let insertedConfig: any;
    const queryRaw = jest.fn(async (sql: string, ...params: any[]) => {
        if (sql.includes('COUNT(*)::int AS cnt') && sql.includes('agent_personas')) {
            return [{ cnt: options.activeAgents ?? 1 }];
        }
        if (sql.includes(`"${SCHEMA}".services`)) return [{ cnt: options.services ?? 2 }];
        if (sql.includes(`"${SCHEMA}".availability_slots`)) return [{ cnt: options.slots ?? 7 }];
        if (sql.includes('SELECT id, name') && sql.includes('ANY(channels)')) {
            return options.channelConflict
                ? [{ id: '22222222-2222-4222-8222-222222222222', name: 'Agente previo' }]
                : [];
        }
        if (sql.includes('INSERT INTO') && sql.includes('agent_personas')) {
            insertedConfig = JSON.parse(params[2]);
            return [{ id: '33333333-3333-4333-8333-333333333333', config_json: insertedConfig }];
        }
        throw new Error(`Unexpected query: ${sql}`);
    });
    const prisma: any = {
        tenant: {
            findUnique: jest.fn(async () => ({ settings: options.settings ?? petServicesSettings() })),
        },
        channelAccount: { findMany: jest.fn(async () => []) },
        $queryRawUnsafe: queryRaw,
        $executeRawUnsafe: jest.fn(async () => 0),
    };
    const redis: any = {
        del: jest.fn(async () => 1),
        getJson: jest.fn(),
        setJson: jest.fn(),
    };
    const tenants: any = { getSchemaName: jest.fn(async () => SCHEMA) };
    const throttle: any = {
        getPlanFeatures: jest.fn(async () => ({ maxAgents: options.maxAgents ?? 3 })),
    };
    const events: any = { emit: jest.fn() };
    const service = new PersonaService(prisma, redis, tenants, throttle, events);
    return { service, prisma, tenants, throttle, queryRaw, getInsertedConfig: () => insertedConfig };
}

describe('PersonaService vertical inheritance for newly-created agents', () => {
    it('inherits effective tools/capabilities without patching another agent config', async () => {
        const ctx = buildHarness();
        const created = await ctx.service.createAgent(TENANT_ID, {
            name: 'Agente Instagram',
            configJson: { tools: { pets: { enabled: false } } },
            channels: [],
            channelBindings: [],
        });

        const config = ctx.getInsertedConfig();
        expect(created.config_json).toBe(config);
        expect(config.capabilities).toEqual(petServicesSettings().verticalConfig.effectiveCapabilities);
        expect(config.tools).toEqual(expect.objectContaining({
            faqs: { enabled: true },
            appointments: { enabled: true, canBook: true, canCancel: true },
            pets: { enabled: false },
            petServices: { enabled: true },
        }));

        const agentUpdates = ctx.prisma.$executeRawUnsafe.mock.calls
            .map((call: any[]) => String(call[0]))
            .filter((sql: string) => /UPDATE\s+"tenant_test"\.agent_personas/i.test(sql));
        expect(agentUpdates).toEqual([]);
    });

    it('fails invalid vertical settings before DDL, plan checks, or agent mutation', async () => {
        const ctx = buildHarness({
            settings: {
                verticalConfig: {
                    industry: 'restaurantes',
                    subType: 'boutique',
                    bookingEnabled: false,
                    manifestVersion: 1,
                },
            },
        });

        const action = ctx.service.createAgent(TENANT_ID, {
            name: 'Inválido', configJson: {}, channels: ['whatsapp'], isDefault: true,
        });
        await expect(action).rejects.toBeInstanceOf(BadRequestException);
        await expect(action).rejects.toMatchObject({
            response: {
                error: 'invalid_vertical_agent_defaults',
                reason: 'vertical_manifest_unresolvable',
            },
        });
        expect(ctx.prisma.$executeRawUnsafe).not.toHaveBeenCalled();
        expect(ctx.tenants.getSchemaName).not.toHaveBeenCalled();
        expect(ctx.throttle.getPlanFeatures).not.toHaveBeenCalled();
    });

    it('keeps the server-side plan limit before insertion', async () => {
        const ctx = buildHarness({ activeAgents: 1, maxAgents: 1 });

        await expect(ctx.service.createAgent(TENANT_ID, {
            name: 'Fuera de cuota', configJson: { tools: { appointments: { enabled: false } } },
        })).rejects.toBeInstanceOf(ForbiddenException);
        expect(ctx.queryRaw.mock.calls.some((call: any[]) => String(call[0]).includes('INSERT INTO'))).toBe(false);
    });

    it('gates an inherited appointments tool before reassigning a channel', async () => {
        const ctx = buildHarness({ channelConflict: true, services: 0, slots: 0 });

        await expect(ctx.service.createAgent(TENANT_ID, {
            name: 'Agenda incompleta', configJson: {}, channels: ['whatsapp'],
        })).rejects.toMatchObject({
            response: { error: 'appointments_prerequisites_missing' },
        });
        const agentUpdates = ctx.prisma.$executeRawUnsafe.mock.calls.filter(
            (call: any[]) => /UPDATE\s+"tenant_test"\.agent_personas/i.test(String(call[0])),
        );
        expect(agentUpdates).toEqual([]);
        expect(ctx.queryRaw.mock.calls.some((call: any[]) => String(call[0]).includes('INSERT INTO'))).toBe(false);
    });

    it('retains one-agent-per-channel ownership without capability-patching the prior agent', async () => {
        const ctx = buildHarness({ channelConflict: true });
        await ctx.service.createAgent(TENANT_ID, {
            name: 'Nuevo WhatsApp',
            configJson: { tools: { appointments: { enabled: false } } },
            channels: ['whatsapp'],
        });

        expect(ctx.prisma.$executeRawUnsafe).toHaveBeenCalledWith(
            expect.stringContaining('channels = array_remove(channels, $1)'),
            'whatsapp',
            '22222222-2222-4222-8222-222222222222',
        );
        const configPatches = ctx.prisma.$executeRawUnsafe.mock.calls.filter(
            (call: any[]) => /UPDATE[\s\S]+config_json/i.test(String(call[0])),
        );
        expect(configPatches).toEqual([]);
    });
});
