import { PersonaController } from './persona.controller';
import { DEMO_ALLOWANCE_DEFAULTS } from '../throttle/demo-allowance.service';

/**
 * F11: `setup-status` handed out the agent's link unconditionally, so the
 * wizard, Channels and the agent editor said "tu agente ya responde por su
 * enlace" to an account whose trial the platform had switched off, or whose
 * platform-paid replies were used up. The link now says whether it answers,
 * with the reason when it does not — read the way the reply lane decides.
 */
describe('setup-status: whether the agent\'s link answers right now', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    function harness(options: {
        planWidget?: boolean | Error;
        allowance?: { enabled: boolean; messagesPerTenant: number; dailyCapPerPage?: number };
        source?: 'stored' | 'default' | 'fallback';
        used?: number | Error;
        withoutAllowanceService?: boolean;
        noLink?: boolean;
    } = {}) {
        const throttleService = {
            getPlanFeatures: jest.fn(async () => {
                if (options.planWidget instanceof Error) throw options.planWidget;
                return { widget: options.planWidget ?? false };
            }),
            getDemoMessageUsage: jest.fn(async () => {
                if (options.used instanceof Error) throw options.used;
                return { used: options.used ?? 0, limit: null };
            }),
        };
        const demoAllowance = {
            getWithSource: jest.fn(async () => ({
                allowance: { ...DEMO_ALLOWANCE_DEFAULTS, ...options.allowance },
                source: options.source ?? 'stored',
            })),
        };
        const controller: any = Object.create(PersonaController.prototype);
        Object.assign(controller, {
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
            throttleService,
            ...(options.withoutAllowanceService ? {} : { demoAllowance }),
            prisma: {
                tenant: { findUnique: jest.fn().mockResolvedValue({
                    id: tenantId, schemaName: 'tenant_demo', industry: 'salud', settings: { setupWizardCompleted: true },
                }) },
                $queryRawUnsafe: jest.fn(async (sql: string) => {
                    if (sql.includes('FROM public.widget_configs')) {
                        if (options.noLink) throw new Error('widget table unavailable');
                        return [{ widget_id: 'wgt_0a1b2c3d4e5f', agent_name: 'Luna', locale: 'es' }];
                    }
                    if (sql.includes('agent_personas') && sql.includes('is_default')) {
                        return [{ id: '22222222-2222-4222-8222-222222222222', name: 'Luna', template_id: null, config_json: {} }];
                    }
                    if (sql.includes('DISTINCT channel_type')) return [];
                    return [{ c: 0 }];
                }),
            },
        });
        return { controller, throttleService, demoAllowance };
    }
    const demoLinkOf = async (h: ReturnType<typeof harness>) => (await h.controller.getSetupStatus(tenantId)).data.demoLink;

    it('keeps the link itself and adds the two fields', async () => {
        expect(await demoLinkOf(harness({ used: 3 }))).toEqual({
            widgetId: 'wgt_0a1b2c3d4e5f', path: '/w/wgt_0a1b2c3d4e5f', agentName: 'Luna',
            answers: true, unavailableReason: null,
        });
    });

    it('answers on a plan that includes the web chat, whatever the trial allowance says', async () => {
        const h = harness({ planWidget: true, allowance: { enabled: false, messagesPerTenant: 0 }, used: 999 });
        expect(await demoLinkOf(h)).toMatchObject({ answers: true, unavailableReason: null });
        // A real channel is bounded by the plan, not by the trial: nothing else to read.
        expect(h.demoAllowance.getWithSource).not.toHaveBeenCalled();
        expect(h.throttleService.getDemoMessageUsage).not.toHaveBeenCalled();
    });

    it('does not answer when the platform switched the trial off', async () => {
        expect(await demoLinkOf(harness({ allowance: { enabled: false, messagesPerTenant: 200 }, used: 0 })))
            .toMatchObject({ answers: false, unavailableReason: 'switched_off' });
    });

    it('does not answer once the platform-paid replies are used up, and answers while one is left', async () => {
        expect(await demoLinkOf(harness({ allowance: { enabled: true, messagesPerTenant: 200 }, used: 200 })))
            .toMatchObject({ answers: false, unavailableReason: 'allowance_used' });
        expect(await demoLinkOf(harness({ allowance: { enabled: true, messagesPerTenant: 200 }, used: 199 })))
            .toMatchObject({ answers: true, unavailableReason: null });
        expect(await demoLinkOf(harness({ allowance: { enabled: true, messagesPerTenant: 0 }, used: 0 })))
            .toMatchObject({ answers: false, unavailableReason: 'allowance_used' });
    });

    it('reads the lifetime counter of this tenant, the one the reply lane reserves against', async () => {
        const h = harness({ used: 5 });
        await demoLinkOf(h);
        expect(h.throttleService.getDemoMessageUsage).toHaveBeenCalledWith(tenantId);
        expect(h.throttleService.getPlanFeatures).toHaveBeenCalledWith(tenantId);
    });

    it.each([
        ['the plan cannot be read', { planWidget: new Error('redis down'), allowance: { enabled: false, messagesPerTenant: 0 } }],
        ['the stored allowance cannot be read', { source: 'fallback' as const, allowance: { enabled: false, messagesPerTenant: 0 } }],
        ['the counter cannot be read', { used: new Error('redis down'), allowance: { enabled: true, messagesPerTenant: 0 } }],
        ['the allowance service is not there', { withoutAllowanceService: true }],
    ])('says it answers when %s: a blip never hides the link', async (_label, options) => {
        expect(await demoLinkOf(harness(options as any))).toMatchObject({ answers: true, unavailableReason: null });
    });

    it('still answers null, and never throws, when there is no link to describe', async () => {
        const h = harness({ noLink: true });
        expect(await demoLinkOf(h)).toBeNull();
        expect(h.throttleService.getPlanFeatures).not.toHaveBeenCalled();
    });
});
