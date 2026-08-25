import { GoneException } from '@nestjs/common';
import { SmsCheckoutController } from '../billing/sms-checkout.controller';
import { SmsNotificationsController } from '../sms-notifications/sms-notifications.controller';
import { SmsCreditsController } from './sms-credits.controller';

describe('P26 retired SMS product boundary', () => {
    it('never publishes tenant package prices even when legacy config exists', async () => {
        const credits = { getPackages: jest.fn().mockResolvedValue([{ id: 'legacy', priceCents: 1000 }]) };
        const controller = new SmsCreditsController(credits as any);

        await expect(controller.getPackages()).resolves.toEqual({
            success: true,
            data: [],
            meta: { retired: true, code: 'sms_product_retired' },
        });
        expect(credits.getPackages).not.toHaveBeenCalled();
    });

    it('rejects every new checkout with a typed retirement response', async () => {
        const checkout = { createCheckout: jest.fn() };
        const controller = new SmsCheckoutController(checkout as any);

        await expect(controller.createCheckout(tenantId, { packageId: 'legacy' })).rejects.toMatchObject({
            response: { error: 'sms_product_retired', operation: 'purchase' },
        });
        expect(checkout.createCheckout).not.toHaveBeenCalled();
    });

    it('allows legacy reads but never enables a new notification config', async () => {
        const service = {
            getConfig: jest.fn().mockResolvedValue({ enabled: false, events: { handoff: true } }),
            updateConfig: jest.fn(),
        };
        const controller = new SmsNotificationsController(service as any);

        await expect(controller.updateConfig(tenantId, { enabled: true })).rejects.toBeInstanceOf(GoneException);
        expect(service.updateConfig).not.toHaveBeenCalled();
    });
});

const tenantId = '11111111-1111-4111-8111-111111111111';
