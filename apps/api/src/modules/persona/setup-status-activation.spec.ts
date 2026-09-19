import { PersonaController } from './persona.controller';
import { isOnboardingBeforeLive } from '@parallext/shared';

/**
 * setup-status carries the activation next to the stage (slice A, sep-2026).
 *
 * The stage is monotonic and `completed` outranks `live`, so the wizard's last
 * button made `live` unwritable: an owner who connected her channel and clicked
 * "Ir al panel" lost the day-0 silence in that click, before her agent had
 * answered anybody. The setup card reads this endpoint, so it gets the same two
 * facts as the session payload, under the same names.
 */
describe('setup-status reports the first reply and the signup date', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const createdAt = new Date('2026-09-14T13:00:00.000Z');

    function harness(settings: Record<string, unknown>, tenantOverrides: Record<string, unknown> = {}) {
        const controller: any = Object.create(PersonaController.prototype);
        const findUnique = jest.fn().mockResolvedValue({
            id: tenantId, schemaName: 'tenant_demo', industry: 'salud', settings, createdAt, ...tenantOverrides,
        });
        Object.assign(controller, {
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
            prisma: {
                tenant: { findUnique },
                getTenantSchemaName: jest.fn().mockResolvedValue('tenant_demo'),
                $queryRawUnsafe: jest.fn(async (sql: string) =>
                    sql.includes('DISTINCT channel_type') ? [{ channel_type: 'whatsapp' }] : [{ c: 1 }]),
            },
        });
        return { controller, findUnique };
    }

    it('a finished wizard without a reply is still day 0; the first reply ends it', async () => {
        const now = createdAt.getTime() + 2 * 60 * 60 * 1000;

        const waiting: any = await harness({ onboardingStage: 'completed', setupWizardCompleted: true })
            .controller.getSetupStatus(tenantId);
        expect(waiting.data.onboardingStage).toBe('completed');
        expect(waiting.data.firstReplyAt).toBeNull();
        expect(waiting.data.tenantCreatedAt).toBe(createdAt.toISOString());
        expect(isOnboardingBeforeLive(waiting.data.onboardingStage,
            { firstReplyAt: waiting.data.firstReplyAt, createdAt: waiting.data.tenantCreatedAt, now })).toBe(true);

        const answered: any = await harness({ onboardingStage: 'completed', firstReplyAt: '2026-09-14T14:10:00.000Z' })
            .controller.getSetupStatus(tenantId);
        expect(answered.data.firstReplyAt).toBe('2026-09-14T14:10:00.000Z');
        expect(isOnboardingBeforeLive(answered.data.onboardingStage,
            { firstReplyAt: answered.data.firstReplyAt, createdAt: answered.data.tenantCreatedAt, now })).toBe(false);
    });

    it('reads the signup date from the same row as the settings', async () => {
        const { controller, findUnique } = harness({ onboardingStage: 'channel_connected' });
        await controller.getSetupStatus(tenantId);
        expect(findUnique).toHaveBeenCalledTimes(1);
        expect(findUnique.mock.calls[0][0].select).toMatchObject({ settings: true, createdAt: true });
    });

    it('a value that is not a date is no first reply, and a missing row claims nothing', async () => {
        const junk: any = await harness({ onboardingStage: 'completed', firstReplyAt: 'pronto' })
            .controller.getSetupStatus(tenantId);
        expect(junk.data.firstReplyAt).toBeNull();

        const missing = harness({});
        missing.findUnique.mockResolvedValue(null);
        const answer: any = await missing.controller.getSetupStatus(tenantId);
        expect(answer.data.firstReplyAt).toBeNull();
        expect(answer.data.tenantCreatedAt).toBeNull();
    });
});
