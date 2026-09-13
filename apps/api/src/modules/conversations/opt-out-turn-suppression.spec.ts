import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ConversationsService } from './conversations.service';

describe('opt-out turn suppression', () => {
    it('stops the turn even when persistence is temporarily unavailable', async () => {
        const service: any = Object.create(ConversationsService.prototype);
        service.logger = { warn: jest.fn(), error: jest.fn() };
        service.complianceService = {
            detectOptOut: jest.fn(() => true),
            processOptOut: jest.fn(async () => { throw new Error('database unavailable'); }),
        };

        await expect(service.suppressDetectedOptOut({
            tenantId: 'tenant', contactId: 'contact', channelType: 'whatsapp', text: 'STOP',
        })).resolves.toBe(true);
        expect(service.complianceService.processOptOut).toHaveBeenCalledTimes(1);
    });

    it('returns before handoff and model work in the live turn', () => {
        const source = readFileSync(resolve(__dirname, 'conversations.service.ts'), 'utf8');
        const suppression = source.indexOf('if (await this.suppressDetectedOptOut');
        const handoff = source.indexOf('const handoffReason = this.handoffService.shouldHandoff', suppression);

        expect(suppression).toBeGreaterThan(0);
        expect(source.slice(suppression, handoff)).toContain(')) return;');
        expect(handoff).toBeGreaterThan(suppression);
    });
});
