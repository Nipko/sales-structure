import { NurturingService, type NurturingConfig } from './nurturing.service';
import { fakeSettingsTransaction } from '../../common/utils/tenant-settings-branch.fixture';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

describe('Nurturing settings CAS', () => {
    it('merges the patch against the branch selected under FOR UPDATE', async () => {
        let settings: any = {};
        const prisma: any = {};
        prisma.$transaction = jest.fn(fakeSettingsTransaction(
            () => settings,
            (next) => { settings = next; },
        ));
        const redis: any = { del: jest.fn().mockResolvedValue(1) };
        const service = new NurturingService(
            {} as any,
            prisma,
            redis,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );
        const fallback: NurturingConfig = {
            enabled: false,
            maxAttempts: 3,
            delays: [14_400, 86_400, 259_200],
            allowedChannels: ['whatsapp'],
            finalAction: 'create_task',
            whatsappTemplateName: '',
            maxPerDay: 1,
        };
        jest.spyOn(service, 'getNurturingConfig').mockImplementation(async () => {
            // Simulates another admin's first save after the fallback read but
            // before this call acquires the row lock.
            settings.nurturing = {
                ...fallback,
                maxAttempts: 5,
                delays: [60, 120, 180],
                allowedChannels: ['telegram'],
            };
            return fallback;
        });

        const result = await service.updateNurturingConfig(TENANT_ID, { enabled: true });

        expect(result).toMatchObject({
            enabled: true,
            maxAttempts: 5,
            delays: [60, 120, 180],
            allowedChannels: ['telegram'],
        });
        expect(settings.nurturing).toEqual(result);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(redis.del).toHaveBeenCalledWith(`nurturing:config:${TENANT_ID}`);
    });
});
