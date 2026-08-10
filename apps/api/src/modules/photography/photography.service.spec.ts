import { BadRequestException } from '@nestjs/common';
import { PhotographyService } from './photography.service';

describe('PhotographyService contact integrity', () => {
    const schemaName = 'tenant_photography';
    const contactId = '11111111-1111-4111-8111-111111111111';

    function buildService(query: jest.Mock) {
        let committed = false;
        const eventEmitter = {
            emit: jest.fn(() => {
                expect(committed).toBe(true);
                return true;
            }),
        };
        const prisma = {
            executeInTenantSchema: jest.fn(),
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => {
                const result = await callback(query);
                committed = true;
                return result;
            }),
        };
        return {
            service: new PhotographyService(prisma as any, eventEmitter as any),
            prisma,
            eventEmitter,
        };
    }

    it('rejects malformed and foreign contacts before inserting a session', async () => {
        const query = jest.fn().mockResolvedValue([]);
        const { service, prisma, eventEmitter } = buildService(query);

        await expect(service.create(schemaName, {
            contactId: 'not-a-uuid',
            sessionType: 'portrait',
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();

        await expect(service.create(schemaName, {
            contactId,
            sessionType: 'portrait',
            scheduledAt: '2026-09-10',
        }))
            .rejects.toThrow('contactId does not belong to this tenant');
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO photo_sessions'))).toBe(false);
        expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('persists a contact only after resolving it in the tenant schema', async () => {
        const stored = { id: '22222222-2222-4222-8222-222222222222', contact_id: contactId };
        const query = jest.fn(async (sql: string, params?: any[]) => {
            if (sql.includes('FROM contacts')) return [{ id: contactId }];
            if (sql.includes('FROM opportunities o')) return [];
            if (sql.includes('INSERT INTO photo_sessions')) {
                expect(params?.[0]).toBe(contactId);
                expect(sql).toContain('scheduled_at_text');
                return [stored];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service, eventEmitter } = buildService(query);

        await expect(service.create(schemaName, {
            contactId,
            sessionType: 'wedding',
            scheduledAt: '2026-09-10',
        })).resolves.toEqual(stored);
        expect(query).toHaveBeenCalledTimes(3);
        expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('emits one requested event only after the create transaction commits', async () => {
        const stored = { id: '22222222-2222-4222-8222-222222222222', contact_id: contactId };
        const query = jest.fn(async (sql: string) => {
            if (sql.includes('FROM contacts')) return [{ id: contactId }];
            if (sql.includes('FROM opportunities o')) return [];
            if (sql.includes('INSERT INTO photo_sessions')) return [stored];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service, eventEmitter } = buildService(query);

        await expect(service.create(schemaName, {
            contactId,
            conversationId: '33333333-3333-4333-8333-333333333333',
            sessionType: 'portrait',
            clientName: 'Ana',
            scheduledAt: '2026-09-10',
            status: 'requested',
        })).resolves.toEqual(stored);

        expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
        expect(eventEmitter.emit).toHaveBeenCalledWith(
            'photo_session.requested',
            expect.objectContaining({
                sessionId: stored.id,
                contactId,
                customerName: 'Ana',
                date: '2026-09-10',
            }),
        );
    });

    it('emits no requested event when persistence fails', async () => {
        const query = jest.fn(async (sql: string) => {
            if (sql.includes('FROM contacts')) return [{ id: contactId }];
            if (sql.includes('FROM opportunities o')) return [];
            throw new Error('photo session insert failed');
        });
        const { service, eventEmitter } = buildService(query);

        await expect(service.create(schemaName, {
            contactId,
            sessionType: 'portrait',
            status: 'requested',
        })).rejects.toThrow('photo session insert failed');
        expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('validates create and update status vocabulary before persistence', async () => {
        const query = jest.fn();
        const { service, prisma } = buildService(query);

        await expect(service.create(schemaName, { sessionType: 'portrait', status: 'pending' }))
            .rejects.toBeInstanceOf(BadRequestException);
        await expect(service.update(schemaName, contactId, { status: 'pending' }))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('requires scheduledAt when creating a scheduled session', async () => {
        const { service, prisma } = buildService(jest.fn());

        await expect(service.create(schemaName, {
            sessionType: 'portrait',
            status: 'scheduled',
        })).rejects.toThrow('scheduledAt is required when status is scheduled');
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('locks the row and rejects scheduling when neither row nor update has scheduledAt', async () => {
        const query = jest.fn(async (sql: string) => {
            if (sql.includes('SELECT status, scheduled_at')) {
                return [{ status: 'requested', scheduled_at: null }];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = buildService(query);

        await expect(service.update(schemaName, contactId, { status: 'scheduled' }))
            .rejects.toThrow('scheduledAt is required when status is scheduled');
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
    });

    it('allows scheduling atomically when the row already has scheduledAt', async () => {
        const scheduledAt = '2026-09-10T10:00:00';
        const updated = { id: contactId, status: 'scheduled', scheduled_at: scheduledAt };
        const query = jest.fn(async (sql: string) => {
            if (sql.includes('SELECT status, scheduled_at')) {
                return [{ status: 'requested', scheduled_at: scheduledAt }];
            }
            if (sql.includes('UPDATE photo_sessions')) return [updated];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = buildService(query);

        await expect(service.update(schemaName, contactId, { status: 'scheduled' }))
            .resolves.toEqual(updated);
        expect(query).toHaveBeenCalledTimes(2);
        expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
    });

    it('orders and counts requested sessions explicitly', async () => {
        const executeInTenantSchema = jest.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ status: 'requested', n: 3 }]);
        const service = new PhotographyService(
            { executeInTenantSchema } as any,
            { emit: jest.fn() } as any,
        );

        await service.listSessions(schemaName);
        await expect(service.countsByStatus(schemaName)).resolves.toEqual({
            requested: 3,
            scheduled: 0,
            in_progress: 0,
            delivered: 0,
            cancelled: 0,
        });
        expect(executeInTenantSchema.mock.calls[0][1]).toContain("WHEN 'requested' THEN 1");
    });
});
