import { promises as dns } from 'node:dns';
import axios from 'axios';
import { BadRequestException } from '@nestjs/common';
import { SlackController } from './slack.controller';
import { SlackService } from './slack.service';
import { TenantSecretCryptoService } from '../../common/crypto/tenant-secret-crypto.service';

const TENANT_ID = '33333333-3333-4333-8333-333333333333';
const KEY = 'c'.repeat(64);
const WEBHOOK = 'https://hooks.slack.com/services/T00000000/B00000000/secret-token';

describe('Slack tenant secrets', () => {
    const originalEnv = { ...process.env };
    let settings: Record<string, any>;
    let prisma: any;
    let service: SlackService;
    let controller: SlackController;
    let lookupSpy: jest.SpyInstance;
    let postSpy: jest.SpyInstance;

    beforeEach(() => {
        process.env.TENANT_SECRET_KEY = KEY;
        delete process.env.TENANT_SECRET_PLAINTEXT;
        settings = {};
        const tx = {
            $queryRawUnsafe: jest.fn(async () => [{ value: settings.slack ?? null }]),
            $executeRawUnsafe: jest.fn(async (_sql: string, ...params: any[]) => {
                settings.slack = JSON.parse(params[2]);
                return 1;
            }),
        };
        prisma = {
            tenant: { findUnique: jest.fn(async () => ({ settings })) },
            $transaction: jest.fn(async (callback: any) => callback(tx)),
        };
        lookupSpy = jest.spyOn(dns, 'lookup').mockResolvedValue([
            { address: '203.0.114.90', family: 4 },
        ] as any);
        postSpy = jest.spyOn(axios, 'post').mockResolvedValue({ data: 'ok' } as any);
        service = new SlackService(prisma, new TenantSecretCryptoService());
        controller = new SlackController(service);
    });

    afterEach(() => {
        lookupSpy.mockRestore();
        postSpy.mockRestore();
        process.env = { ...originalEnv };
    });

    it('encrypts the webhook, masks controllers, preserves *** and decrypts for delivery', async () => {
        const updated = await controller.updateConfig(TENANT_ID, {
            enabled: true,
            webhookUrl: WEBHOOK,
            events: { handoff: true, appointment: false },
        });

        expect(settings.slack.webhookUrl).toMatch(/^tsc:v1:/);
        expect(settings.slack.webhookUrl).not.toContain('secret-token');
        expect(updated.data.webhookUrl).toBe('***');
        expect((await controller.getConfig(TENANT_ID)).data.webhookUrl).toBe('***');

        const envelope = settings.slack.webhookUrl;
        await controller.updateConfig(TENANT_ID, {
            webhookUrl: '***',
            events: { handoff: false, appointment: true },
        });
        expect(settings.slack.webhookUrl).toBe(envelope);
        expect((await service.getConfig(TENANT_ID)).webhookUrl).toBe(WEBHOOK);

        await service.sendTest(TENANT_ID);
        expect(postSpy).toHaveBeenCalledWith(
            WEBHOOK,
            expect.objectContaining({ text: expect.stringContaining('Parallly') }),
            expect.any(Object),
        );
    });

    it('rewraps a legacy webhook and keeps consuming it after the plaintext cut', async () => {
        settings.slack = {
            enabled: true,
            webhookUrl: WEBHOOK,
            events: { handoff: true, appointment: true },
        };

        expect((await service.getConfig(TENANT_ID)).webhookUrl).toBe(WEBHOOK);
        expect(settings.slack.webhookUrl).toMatch(/^tsc:v1:/);

        process.env.TENANT_SECRET_PLAINTEXT = 'reject';
        expect((await service.getConfig(TENANT_ID)).webhookUrl).toBe(WEBHOOK);
    });

    it('fails closed after the cut and does not send the stored plaintext as a URL', async () => {
        settings.slack = {
            enabled: true,
            webhookUrl: WEBHOOK,
            events: { handoff: true, appointment: true },
        };
        process.env.TENANT_SECRET_PLAINTEXT = 'reject';

        await expect(controller.updateConfig(TENANT_ID, {
            webhookUrl: '***',
            events: { handoff: false, appointment: true },
        })).rejects.toThrow('tenant_secret_plaintext_rejected');
        await expect(service.sendTest(TENANT_ID)).rejects.toBeInstanceOf(BadRequestException);
        expect(postSpy).not.toHaveBeenCalled();
    });
});
