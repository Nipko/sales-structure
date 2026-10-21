import { BadRequestException } from '@nestjs/common';
import { PoliciesService } from './policies.service';

describe('policy validation compatibility', () => {
    function harness() {
        const s = Object.create(PoliciesService.prototype) as any;
        s.ensureSchema = jest.fn().mockResolvedValue('tenant_synthetic');
        s.prisma = { $executeRawUnsafe: jest.fn().mockResolvedValue(1), $queryRawUnsafe: jest.fn(async (sql: string, ...args: any[]) => {
            if (sql.includes('MAX(version)')) return [{ next_version: 8 }];
            if (sql.includes('INSERT INTO')) return [{ id: '11111111-1111-4111-8111-111111111111', type: args[0], title: args[1], content: args[2], version: args[3], is_active: true }];
            return [];
        }) };
        s.redis = { del: jest.fn() }; s.events = { emit: jest.fn() };
        return s;
    }
    it.each([
        ['title beyond database bound', { type: 'privacy', title: 'x'.repeat(501), content: 'Synthetic content' }],
        ['unsupported policy type', { type: 'marketing', title: 'Synthetic title', content: 'Synthetic content' }],
        ['missing payload', null],
    ])('rejects %s before any mutation', async (_label, input) => {
        const s = harness();
        await expect(s.upsert('synthetic-tenant', input)).rejects.toBeInstanceOf(BadRequestException);
        expect(s.ensureSchema).not.toHaveBeenCalled(); expect(s.prisma.$queryRawUnsafe).not.toHaveBeenCalled();
        expect(s.prisma.$executeRawUnsafe).not.toHaveBeenCalled();
        expect(s.redis.del).not.toHaveBeenCalled(); expect(s.events.emit).not.toHaveBeenCalled();
    });
    it('preserves exact Unicode content and accepts a 500-character title', async () => {
        const s = harness(), title = 'x'.repeat(500), content = '\n Política sintética — versión QA.\nNo comercializar.\n';
        const result = await s.upsert('synthetic-tenant', { type: 'privacy', title, content }, 'synthetic-operator');
        expect(result).toMatchObject({ title, content, version: 8, isActive: true });
        const inserts = s.prisma.$queryRawUnsafe.mock.calls.filter((c: any[]) => c[0].includes('INSERT INTO'));
        expect(inserts).toHaveLength(1); expect(inserts[0].slice(1, 4)).toEqual(['privacy', title, content]);
        expect(s.redis.del).toHaveBeenCalledWith('policy:synthetic-tenant:privacy:active');
        expect(s.events.emit).toHaveBeenCalledTimes(1);
    });
});
