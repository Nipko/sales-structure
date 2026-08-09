import { BadRequestException } from '@nestjs/common';
import { MetaComplianceService } from './meta-compliance.service';

describe('MetaComplianceService account deletion requests', () => {
    const redis = { get: jest.fn(), set: jest.fn(), incrementRateLimit: jest.fn() };
    const email = { send: jest.fn() };
    const config = {
        get: jest.fn((key: string) => ({
            META_APP_SECRET: 'test-secret',
            PUBLIC_LANDING_URL: 'https://parallly-chat.cloud',
            COMPLIANCE_NOTIFY_EMAIL: 'compliance@example.com',
        } as Record<string, string>)[key]),
    };

    let service: MetaComplianceService;

    beforeEach(() => {
        jest.clearAllMocks();
        redis.set.mockResolvedValue(undefined);
        redis.incrementRateLimit.mockResolvedValue(1);
        email.send.mockResolvedValue(undefined);
        service = new MetaComplianceService(config as any, redis as any, email as any);
    });

    it('registra y notifica una solicitud de eliminación de cuenta y datos', async () => {
        const result = await service.submitUserRequest({
            email: ' Agent@Example.com ',
            description: 'Cuenta de demostración',
        });

        expect(result.confirmation_code).toMatch(/^[a-f0-9-]{36}$/i);
        expect(redis.set).toHaveBeenCalledTimes(1);

        const [, rawRecord, ttl] = redis.set.mock.calls[0];
        expect(JSON.parse(rawRecord)).toMatchObject({
            code: result.confirmation_code,
            source: 'user_request',
            email: 'agent@example.com',
            status: 'received',
            notes: 'Cuenta de demostración',
        });
        expect(ttl).toBe(90 * 24 * 60 * 60);

        expect(email.send).toHaveBeenCalledTimes(1);
        expect(email.send.mock.calls[0][0]).toMatchObject({
            to: 'compliance@example.com',
            subject: expect.stringContaining('Account and data deletion request'),
        });
        expect(email.send.mock.calls[0][0].html).toContain('Verify the requester');
    });

    it('permite al proceso de cumplimiento avanzar y completar el estado', async () => {
        const { confirmation_code: code } = await service.submitUserRequest({ email: 'agent@example.com' });
        const receivedRecord = redis.set.mock.calls[0][1];

        redis.get.mockResolvedValueOnce(receivedRecord);
        const processing = await service.updateStatus(code, 'processing', 'Identidad verificada');
        expect(processing).toMatchObject({ code, status: 'processing' });
        expect(processing).not.toHaveProperty('email');
        expect(processing).not.toHaveProperty('notes');

        const processingRecord = redis.set.mock.calls[1][1];
        redis.get.mockResolvedValueOnce(processingRecord);
        const completed = await service.updateStatus(code, 'completed');
        expect(completed).toMatchObject({ code, status: 'completed' });
        expect(completed.processedAt).toBeTruthy();

        const completedRecord = redis.set.mock.calls[2][1];
        redis.get.mockResolvedValueOnce(completedRecord);
        const repeated = await service.updateStatus(code, 'completed');
        expect(repeated.processedAt).toBe(completed.processedAt);
    });

    it('limita solicitudes repetidas dirigidas a la misma cuenta', async () => {
        redis.incrementRateLimit.mockResolvedValueOnce(3);

        await expect(service.submitUserRequest({ email: 'agent@example.com' })).rejects.toMatchObject({
            status: 429,
        });
        expect(redis.set).not.toHaveBeenCalled();
        expect(email.send).not.toHaveBeenCalled();
    });

    it('rechaza correos inválidos sin crear una solicitud', async () => {
        await expect(service.submitUserRequest({ email: 'invalid' })).rejects.toBeInstanceOf(BadRequestException);
        expect(redis.set).not.toHaveBeenCalled();
        expect(email.send).not.toHaveBeenCalled();
    });
});
