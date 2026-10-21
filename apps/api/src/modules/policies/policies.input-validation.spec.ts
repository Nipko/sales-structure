import { BadRequestException } from '@nestjs/common';
import { PoliciesService } from './policies.service';

describe('invalid policy edits cannot retire the active policy', () => {
    it.each([
        ['POLICYINPUT_A_EMPTY_CONTENT', 'content', ''],
        ['POLICYINPUT_A_BLANK_CONTENT', 'content', ' \n\t '],
        ['POLICYINPUT_A_OBJECT_CONTENT', 'content', { text: 'Synthetic content' }],
        ['POLICYINPUT_B_EMPTY_TITLE', 'title', ''],
        ['POLICYINPUT_B_BLANK_TITLE', 'title', ' \n\t '],
        ['POLICYINPUT_B_OBJECT_TITLE', 'title', { text: 'Synthetic title' }],
    ])('%s rejects malformed %s before schema or policy mutation', async (_id, field, value) => {
        const service = Object.create(PoliciesService.prototype) as any;
        service.ensureSchema = jest.fn().mockResolvedValue('tenant_synthetic');
        service.prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([{
            id: '11111111-1111-4111-8111-111111111111', type: 'privacy', title: 'Synthetic title',
            content: 'Synthetic canonical content', version: 8, next_version: 8, is_active: true,
        }]) };
        service.redis = { del: jest.fn() };
        service.events = { emit: jest.fn() };
        const input = { type: 'privacy', title: 'Synthetic title', content: 'Synthetic content', [field as string]: value };
        await expect(service.upsert('synthetic-tenant', input)).rejects.toBeInstanceOf(BadRequestException);
        expect(service.ensureSchema).not.toHaveBeenCalled();
        expect(service.prisma.$queryRawUnsafe).not.toHaveBeenCalled();
        expect(service.redis.del).not.toHaveBeenCalled();
        expect(service.events.emit).not.toHaveBeenCalled();
    });
});
