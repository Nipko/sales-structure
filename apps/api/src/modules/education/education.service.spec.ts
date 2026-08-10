import { BadRequestException } from '@nestjs/common';
import { EducationService } from './education.service';

describe('EducationService enrollment contact integrity', () => {
    const schemaName = 'tenant_education';
    const cohortId = '11111111-1111-4111-8111-111111111111';
    const courseId = '22222222-2222-4222-8222-222222222222';
    const contactId = '33333333-3333-4333-8333-333333333333';
    const enrollmentId = '44444444-4444-4444-8444-444444444444';

    function buildService(query: jest.Mock) {
        const prisma = {
            executeInTenantSchema: jest.fn(),
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
        };
        return { service: new EducationService(prisma as any), prisma };
    }

    it('rejects malformed and foreign contacts before claiming a cohort seat', async () => {
        const query = jest.fn().mockResolvedValue([]);
        const { service, prisma } = buildService(query);
        const base = { cohortId, contactId, studentName: 'Ana' };

        await expect(service.enrollStudent(schemaName, { ...base, contactId: 'bad-contact' }))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();

        await expect(service.enrollStudent(schemaName, base))
            .rejects.toThrow('contactId does not belong to this tenant');
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE course_cohorts'))).toBe(false);
    });

    it('validates the contact, claims capacity and inserts in one transaction', async () => {
        const stored = { id: enrollmentId, cohort_id: cohortId, contact_id: contactId };
        const query = jest.fn(async (sql: string, params?: any[]) => {
            if (sql.includes('FROM contacts')) return [{ id: contactId }];
            if (sql.includes('SELECT * FROM course_cohorts')) {
                return [{ id: cohortId, course_id: courseId, status: 'open', available_seats: 2 }];
            }
            if (sql.includes('UPDATE course_cohorts')) return [{ id: cohortId }];
            if (sql.includes('INSERT INTO enrollments')) {
                expect(params?.[2]).toBe(contactId);
                return [stored];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service, prisma } = buildService(query);

        await expect(service.enrollStudent(schemaName, {
            cohortId,
            contactId,
            studentName: 'Ana',
        })).resolves.toBe(stored);
        expect(prisma.transactionInTenantSchema).toHaveBeenCalledWith(schemaName, expect.any(Function));
        expect(String(query.mock.calls[1][0])).toContain('FOR UPDATE');
        expect(query).toHaveBeenCalledTimes(4);
    });
});

