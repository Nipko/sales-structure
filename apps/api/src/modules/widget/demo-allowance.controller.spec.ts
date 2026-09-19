import 'reflect-metadata';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { DemoAllowanceController } from './demo-allowance.controller';
import { DEMO_ALLOWANCE_DEFAULTS, DEMO_ALLOWANCE_LIMITS } from '../throttle/demo-allowance.service';

/**
 * The platform-paid allowance of the public link had no screen and no trace
 * (audit #47): three numbers every tenant's link spends against, movable only
 * by SQL. These pin the API behind the new super_admin screen: platform role
 * only, strict input, and every real change audited under the real operator.
 */
function harness(current = { ...DEMO_ALLOWANCE_DEFAULTS }, source: 'stored' | 'default' | 'fallback' = 'stored') {
    let value = { ...current };
    const allowance = {
        get: jest.fn(async () => ({ ...value })),
        getWithSource: jest.fn(async () => ({ allowance: { ...value }, source })),
        set: jest.fn(async (patch: Record<string, unknown>) => { value = { ...value, ...patch } as typeof value; return { ...value }; }),
    };
    const auditLog = { create: jest.fn().mockResolvedValue({}) };
    const controller = new DemoAllowanceController(allowance as any, { auditLog } as any);
    return { controller, allowance, auditLog };
}

const OWNER = { id: 'owner-1', role: 'super_admin' };

describe('DemoAllowanceController', () => {
    it('belongs to the platform role alone', () => {
        expect(Reflect.getMetadata(ROLES_KEY, DemoAllowanceController)).toEqual(['super_admin']);
        expect(Reflect.getMetadata('path', DemoAllowanceController)).toBe('platform/demo-allowance');
    });

    it('reads the effective values with the defaults and the limits the screen validates against', async () => {
        const { controller } = harness({ enabled: true, messagesPerTenant: 150, dailyCapPerPage: 40 });
        expect(await controller.read()).toEqual({
            success: true,
            data: {
                allowance: { enabled: true, messagesPerTenant: 150, dailyCapPerPage: 40 },
                source: 'stored',
                defaults: DEMO_ALLOWANCE_DEFAULTS,
                limits: DEMO_ALLOWANCE_LIMITS,
            },
        });
    });

    /**
     * F0: the service answers the defaults when the row cannot be read. The
     * screen showed them as the value in force, and a save merged the edit
     * over them — `enabled: true` written back over a switched-off demo.
     */
    it('says where the values came from, so stand-in defaults are never shown as the value in force', async () => {
        const { controller, allowance } = harness({ ...DEMO_ALLOWANCE_DEFAULTS }, 'fallback');
        expect(await controller.read()).toMatchObject({ success: true, data: { allowance: DEMO_ALLOWANCE_DEFAULTS, source: 'fallback' } });
        // The screen reads the row itself, not the runtime's cached copy.
        expect(allowance.getWithSource).toHaveBeenCalledTimes(1);
        expect(allowance.get).not.toHaveBeenCalled();
        expect((await harness({ ...DEMO_ALLOWANCE_DEFAULTS }, 'default').controller.read()).data.source).toBe('default');
    });

    it('refuses to save over a row it could not read: nothing written, nothing audited', async () => {
        const { controller, allowance, auditLog } = harness({ ...DEMO_ALLOWANCE_DEFAULTS }, 'fallback');
        const refusal = await controller.update({ messagesPerTenant: 300 }, { user: OWNER }).catch((error: unknown) => error);
        expect(refusal).toBeInstanceOf(ServiceUnavailableException);
        expect((refusal as ServiceUnavailableException).getResponse()).toMatchObject({ error: 'demo_allowance_unreadable' });
        expect(allowance.set).not.toHaveBeenCalled();
        expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('saves a valid edit and audits the before, the after and what moved, under the real operator', async () => {
        const { controller, allowance, auditLog } = harness();
        const result = await controller.update({ messagesPerTenant: 300, dailyCapPerPage: 60 }, { user: OWNER });
        expect(allowance.set).toHaveBeenCalledWith({ messagesPerTenant: 300, dailyCapPerPage: 60 });
        expect(result.data.allowance).toEqual({ enabled: true, messagesPerTenant: 300, dailyCapPerPage: 60 });
        expect(result.data.source).toBe('stored');
        expect(auditLog.create).toHaveBeenCalledWith({
            data: {
                tenantId: null,
                userId: 'owner-1',
                action: 'platform.demo_allowance_changed',
                resource: 'platform_settings/onboarding.demoAllowance',
                details: {
                    before: DEMO_ALLOWANCE_DEFAULTS,
                    after: { enabled: true, messagesPerTenant: 300, dailyCapPerPage: 60 },
                    changed: ['messagesPerTenant'],
                },
            },
        });
    });

    it('records the delegation when the token carries one, never a bare impersonated id', async () => {
        const { controller, auditLog } = harness();
        await controller.update({ enabled: false }, {
            user: { id: 'owner-1', role: 'super_admin', isImpersonation: true, impersonatedBy: 'real-owner', impersonationSid: 'sid-9' },
        });
        expect(auditLog.create.mock.calls[0][0].data.details).toMatchObject({
            viaImpersonation: true, performedBy: 'real-owner', impersonationSid: 'sid-9', changed: ['enabled'],
        });
    });

    it('writes no audit entry when nothing actually changed', async () => {
        const { controller, auditLog } = harness();
        await controller.update({ messagesPerTenant: DEMO_ALLOWANCE_DEFAULTS.messagesPerTenant }, { user: OWNER });
        expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('refuses an invalid edit whole, names the fields, and writes nothing', async () => {
        const { controller, allowance, auditLog } = harness();
        const refusal = await controller.update({ messagesPerTenant: 99_999, dailyCapPerPage: '5' }, { user: OWNER })
            .catch((error: unknown) => error);
        expect(refusal).toBeInstanceOf(BadRequestException);
        expect((refusal as BadRequestException).getResponse()).toMatchObject({
            error: 'demo_allowance_invalid',
            fields: [
                { path: 'messagesPerTenant', constraint: 'max' },
                { path: 'dailyCapPerPage', constraint: 'integer' },
            ],
        });
        expect(allowance.set).not.toHaveBeenCalled();
        expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('keeps the saved change when the audit write fails, and says so loudly', async () => {
        const { controller, auditLog } = harness();
        auditLog.create.mockRejectedValueOnce(new Error('audit down'));
        const error = jest.spyOn((controller as any).logger, 'error').mockImplementation(() => undefined);
        const result = await controller.update({ dailyCapPerPage: 10 }, { user: OWNER });
        expect(result.data.allowance.dailyCapPerPage).toBe(10);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('audit down'));
    });
});
