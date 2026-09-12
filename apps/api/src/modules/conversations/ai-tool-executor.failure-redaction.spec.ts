import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { AIToolExecutorService } from './ai-tool-executor.service';

function harness(homeServicesService: Record<string, jest.Mock>) {
    const executor = Object.create(AIToolExecutorService.prototype) as AIToolExecutorService;
    Object.assign(executor as any, {
        logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
        homeServicesService,
    });
    return executor as any;
}

describe('AI tool failures are safe model input', () => {
    const storageFailure = new Error(
        'SELECT secret FROM tenant_secret.service_requests WHERE token = provider_private_key',
    );

    it('does not expose a read-side driver error', async () => {
        const executor = harness({
            listCapacityServices: jest.fn().mockRejectedValue(storageFailure),
        });

        const result = await executor.listHomeServicesTool('tenant_secret');

        expect(result).toMatchObject({
            error: 'list_home_services_unavailable',
            status: 'error',
            retryable: true,
        });
        expect(JSON.stringify(result)).not.toMatch(/tenant_secret|provider_private_key|SELECT secret/);
    });

    it('does not expose a write-side driver error or claim success', async () => {
        const executor = harness({
            createRequest: jest.fn().mockRejectedValue(storageFailure),
        });

        const result = await executor.createServiceRequestTool(
            'tenant_secret',
            '22222222-2222-4222-8222-222222222222',
            '33333333-3333-4333-8333-333333333333',
            { serviceType: 'repair', customerName: 'A', issueDescription: 'B' },
        );

        expect(result).toMatchObject({
            error: 'create_service_request_unavailable',
            retryable: true,
            shouldHandoff: true,
        });
        expect(result.success).not.toBe(true);
        expect(JSON.stringify(result)).not.toMatch(/tenant_secret|provider_private_key|SELECT secret/);
    });

    it('retains an explicit business validation without treating it as an outage', async () => {
        const executor = harness({
            checkAvailability: jest.fn().mockRejectedValue(
                new BadRequestException('La fecha debe estar dentro del horario configurado.'),
            ),
        });

        const result = await executor.checkHomeServiceAvailabilityTool('tenant', {
            serviceId: 'service', startAt: 'invalid',
        });

        expect(result).toMatchObject({
            error: 'check_home_service_availability_rejected',
            status: 'error',
            retryable: false,
            available: false,
            message: 'La fecha debe estar dentro del horario configurado.',
        });
    });

    it('does not turn a failed case lookup into an empty customer record', async () => {
        const executor = harness({});
        executor.prisma = {
            executeInTenantSchema: jest.fn().mockRejectedValue(storageFailure),
        };

        const result = await executor.getCaseStatusTool(
            'tenant_secret',
            '22222222-2222-4222-8222-222222222222',
        );

        expect(result).toMatchObject({
            error: 'get_case_status_unavailable',
            status: 'error',
            retryable: true,
        });
        expect(result).not.toHaveProperty('cases');
        expect(JSON.stringify(result)).not.toContain('tenant_secret');
    });

    it('keeps raw exception messages out of every catch result in the executor', () => {
        const source = readFileSync(require.resolve('./ai-tool-executor.service'), 'utf8');
        expect(source).not.toMatch(/return\s*\{\s*error:\s*(?:e|error)\.message/);
        expect(source).not.toMatch(/\bmessage:\s*(?:e|error)\.message/);
    });
});
