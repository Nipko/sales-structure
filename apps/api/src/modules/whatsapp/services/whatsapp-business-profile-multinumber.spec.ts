import * as fs from 'fs';
import * as path from 'path';
import { WhatsappConnectionService } from './whatsapp-connection.service';

describe('WhatsApp Business profile multi-number routing', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it('reads the selected number and its matching messaging tier', async () => {
        const prisma = {
            executeInTenantSchema: jest.fn(async () => [{ messaging_limit_tier: 'TIER_10K' }]),
        };
        const service = new WhatsappConnectionService(
            prisma as any, {} as any, {} as any, {} as any,
        );
        const token = jest.spyOn(service, 'getValidAccessToken').mockResolvedValue({
            accessToken: 'secret', phoneNumberId: 'pn-second', wabaId: 'waba-2', channelId: 'channel-2',
        });
        global.fetch = jest
            .fn()
            .mockResolvedValueOnce({ json: async () => ({ data: [{ about: 'Second profile' }] }) })
            .mockResolvedValueOnce({ json: async () => ({ display_phone_number: '+57 300 222 2222' }) }) as any;

        const result = await service.getBusinessProfile('tenant_schema', 'pn-second');

        expect(token).toHaveBeenCalledWith('tenant_schema', 'pn-second');
        expect(prisma.executeInTenantSchema).toHaveBeenCalledWith(
            'tenant_schema',
            expect.stringContaining('WHERE phone_number_id = $1'),
            ['pn-second'],
        );
        expect(result.phoneDetails).toMatchObject({
            display_phone_number: '+57 300 222 2222',
            messaging_limit_tier: 'TIER_10K',
        });
    });

    it('passes an explicit number through every profile mutation surface', () => {
        const serviceSource = fs.readFileSync(path.join(__dirname, 'whatsapp-connection.service.ts'), 'utf8');
        const controllerSource = fs.readFileSync(path.join(__dirname, '..', 'whatsapp.controller.ts'), 'utf8');
        expect(serviceSource.match(/getValidAccessToken\(schemaName, requestedPhoneNumberId\)/g)).toHaveLength(4);
        expect(controllerSource).toContain("@Query('phoneNumberId') phoneNumberId?: string");
        expect(controllerSource).toContain('updateBusinessProfile(schemaName, profile, phoneNumberId)');
        expect(controllerSource).toContain('uploadProfilePhoto(schemaName, file, phoneNumberId)');
        expect(controllerSource).toContain('deleteProfilePhoto(schemaName, body?.phoneNumberId)');
    });
});
