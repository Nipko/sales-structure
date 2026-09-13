import { BadRequestException } from '@nestjs/common';
import { HomeServicesService } from './home-services.service';

describe('HomeServicesService scheduled request invariant', () => {
    const schemaName = 'tenant_home_services';
    const requestId = '11111111-1111-4111-8111-111111111111';
    const contactId = '22222222-2222-4222-8222-222222222222';
    const serviceId = '33333333-3333-4333-8333-333333333333';
    const scheduledAt = '2030-08-10T09:00:00';

    it('keeps open-duration work visible without claiming it can be auto-scheduled', async () => {
        const prisma = { executeInTenantSchema: jest.fn().mockResolvedValue([
            { id: 'open', name: 'Diagnóstico', category: 'plomeria', duration_minutes: 0,
                duration_type: 'open', max_concurrent: 1 },
            { id: 'fixed', name: 'Mantenimiento', category: 'plomeria', duration_minutes: 60,
                duration_type: 'fixed', max_concurrent: 2 },
        ]) };
        const service = new HomeServicesService(prisma as any, { emit: jest.fn() } as any);

        await expect(service.listCapacityServices(schemaName)).resolves.toEqual([
            expect.objectContaining({ id: 'open', durationType: 'open', automaticScheduling: false }),
            expect.objectContaining({ id: 'fixed', durationType: 'fixed', automaticScheduling: true }),
        ]);
        expect(prisma.executeInTenantSchema.mock.calls[0][1]).not.toContain('duration_minutes > 0');
    });

    describe('createRequest', () => {
        it('creates a scheduled request only when a valid scheduledAt is persisted with it', async () => {
            const query = jest.fn(async (sql: string, _params: any[] = []) => {
                if (sql.includes('pg_advisory_xact_lock')) return [{ lock_acquired: '1' }];
                if (sql.includes('FROM services')) return [{
                    id: serviceId,
                    name: 'Visita de plomería',
                    category: 'plomeria',
                    duration_minutes: 90,
                    max_concurrent: 1,
                }];
                if (sql.includes('COUNT(*)')) return [{ occupied: 0 }];
                if (sql.includes('INSERT INTO service_requests')) return [{
                    id: requestId,
                    service_id: serviceId,
                    service_type: 'plomeria',
                    estimated_duration_minutes: 90,
                    status: 'scheduled',
                    scheduled_at: scheduledAt,
                }];
                throw new Error(`Unexpected SQL: ${sql}`);
            });
            const prisma = {
                executeInTenantSchema: jest.fn(),
                transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
            };
            const eventEmitter = { emit: jest.fn() };
            const service = new HomeServicesService(prisma as any, eventEmitter as any);

            await expect(service.createRequest(schemaName, {
                serviceType: 'plomeria',
                serviceId,
                status: 'scheduled',
                scheduledAt,
            })).resolves.toMatchObject({ status: 'scheduled', scheduled_at: scheduledAt });

            expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
            const insertCall = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO service_requests'))!;
            const [sql, params] = insertCall as unknown as [string, any[]];
            expect(sql).toContain('service_id');
            expect(sql).toContain('scheduled_at, status');
            expect(sql).toContain('$18::timestamp, $19');
            expect(sql).toContain('scheduled_at_text');
            expect(params[3]).toBe(serviceId);
            expect(params[14]).toBe(90);
            expect(params[17]).toBe(scheduledAt);
            expect(params[18]).toBe('scheduled');
            expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
            expect(eventEmitter.emit).toHaveBeenCalledWith(
                'service_request.created',
                expect.objectContaining({ requestId }),
            );
        });

        it('rejects scheduled status without scheduledAt before persistence', async () => {
            const prisma = { executeInTenantSchema: jest.fn() };
            const eventEmitter = { emit: jest.fn() };
            const service = new HomeServicesService(prisma as any, eventEmitter as any);

            await expect(service.createRequest(schemaName, {
                serviceType: 'electricidad',
                status: 'scheduled',
            })).rejects.toMatchObject({
                response: expect.objectContaining({
                    message: 'scheduledAt is required when status is scheduled',
                }),
            });

            expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
            expect(eventEmitter.emit).not.toHaveBeenCalled();
        });

        it.each([
            'not-a-date',
            '2030-02-30T10:00:00Z',
            '2030-08-10',
        ])('rejects invalid ISO scheduledAt %s', async (invalidScheduledAt) => {
            const prisma = { executeInTenantSchema: jest.fn() };
            const eventEmitter = { emit: jest.fn() };
            const service = new HomeServicesService(prisma as any, eventEmitter as any);

            await expect(service.createRequest(schemaName, {
                serviceType: 'limpieza',
                status: 'scheduled',
                scheduledAt: invalidScheduledAt,
            })).rejects.toBeInstanceOf(BadRequestException);

            expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
            expect(eventEmitter.emit).not.toHaveBeenCalled();
        });

        it('validates a supplied contact in-tenant before creating the request', async () => {
            const query = jest.fn(async (sql: string, _params?: any[]) => {
                if (sql.includes('FROM contacts')) return [{ id: contactId }];
                if (sql.includes('FROM opportunities o')) return [];
                if (sql.includes('INSERT INTO service_requests')) {
                    return [{ id: requestId, contact_id: contactId, status: 'pending' }];
                }
                throw new Error(`Unexpected SQL: ${sql}`);
            });
            const prisma = {
                transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
                executeInTenantSchema: jest.fn(),
            };
            const eventEmitter = { emit: jest.fn() };
            const service = new HomeServicesService(prisma as any, eventEmitter as any);

            await expect(service.createRequest(schemaName, {
                contactId,
                serviceType: 'limpieza',
            })).resolves.toMatchObject({ contact_id: contactId });
            expect(query).toHaveBeenCalledTimes(3);
            expect(String(query.mock.calls[0][0])).toContain('FROM contacts');
            expect(query.mock.calls[2][1]?.[0]).toBe(contactId);
            expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
        });

        it('commits one durable emergency notice per active dispatcher in the request transaction', async () => {
            const query = jest.fn(async (sql: string, params: any[] = []) => {
                if (sql.includes('pg_advisory_xact_lock')) return [{ lock_acquired: '1' }];
                if (sql.startsWith('CREATE ') || sql.startsWith('ALTER TABLE') || sql.startsWith('CREATE INDEX')) return [];
                if (sql.includes('pg_get_constraintdef')) return [{ definition: "CHECK (kind = ANY (ARRAY['home_service.emergency']))" }];
                if (sql.includes('INSERT INTO service_requests')) return [{
                    id: requestId, contact_id: null, conversation_id: null,
                    service_type: 'gas', urgency: 'emergencia', status: 'pending',
                }];
                if (sql.includes('INSERT INTO operational_notice_outbox')) {
                    expect(params).toEqual([
                        'home_service.emergency', 'home_service.emergency', requestId,
                        null, null, schemaName, '1', ['tenant_admin', 'tenant_supervisor'],
                    ]);
                    return [{ id: 'notice-admin' }, { id: 'notice-supervisor' }];
                }
                throw new Error(`Unexpected SQL: ${sql}`);
            });
            const prisma = {
                transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
                executeInTenantSchema: jest.fn(),
            };
            const eventEmitter = { emit: jest.fn() };
            const service = new HomeServicesService(prisma as any, eventEmitter as any);

            await expect(service.createRequest(schemaName, {
                serviceType: 'gas', urgency: 'emergencia',
            })).resolves.toMatchObject({ id: requestId, urgency: 'emergencia' });

            expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(2);
            const domainTransactionCalls = query.mock.calls
                .map(([sql]) => String(sql))
                .filter(sql => sql.includes('INSERT INTO service_requests') || sql.includes('INSERT INTO operational_notice_outbox'));
            expect(domainTransactionCalls).toHaveLength(2);
            expect(eventEmitter.emit).toHaveBeenCalledWith('service_request.created', expect.objectContaining({ requestId }));
        });

        it('rejects malformed and foreign contacts without inserting', async () => {
            const query = jest.fn().mockResolvedValue([]);
            const prisma = {
                transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
                executeInTenantSchema: jest.fn(),
            };
            const eventEmitter = { emit: jest.fn() };
            const service = new HomeServicesService(prisma as any, eventEmitter as any);

            await expect(service.createRequest(schemaName, {
                contactId: 'bad-contact',
                serviceType: 'limpieza',
            })).rejects.toBeInstanceOf(BadRequestException);
            expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();

            await expect(service.createRequest(schemaName, { contactId, serviceType: 'limpieza' }))
                .rejects.toThrow('contactId does not belong to this tenant');
            expect(query).toHaveBeenCalledTimes(1);
            expect(eventEmitter.emit).not.toHaveBeenCalled();
        });
    });

    describe('updateRequest', () => {
        function buildHarness(existing: { status: string; scheduled_at: string | null }) {
            const query = jest.fn(async (sql: string, params: any[] = []) => {
                if (sql.includes('SELECT status, scheduled_at')) return [{
                    ...existing,
                    service_id: serviceId,
                    service_type: 'plomeria',
                    assigned_technician_id: null,
                }];
                if (sql.includes('pg_advisory_xact_lock')) return [{ lock_acquired: '1' }];
                if (sql.includes('FROM services')) return [{
                    id: serviceId,
                    name: 'Visita de plomería',
                    category: 'plomeria',
                    duration_minutes: 90,
                    max_concurrent: 1,
                }];
                if (sql.includes('COUNT(*)')) return [{ occupied: 0 }];
                if (sql.includes('UPDATE service_requests')) {
                    return [{
                        id: requestId,
                        status: params.includes('scheduled') ? 'scheduled' : existing.status,
                        scheduled_at: params.includes(scheduledAt) ? scheduledAt : existing.scheduled_at,
                    }];
                }
                throw new Error(`Unexpected SQL: ${sql}`);
            });
            const prisma = {
                transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
                executeInTenantSchema: jest.fn(),
            };
            const eventEmitter = { emit: jest.fn() };
            return {
                service: new HomeServicesService(prisma as any, eventEmitter as any),
                prisma,
                query,
                eventEmitter,
            };
        }

        it('atomically accepts scheduled status with a valid scheduledAt in the update', async () => {
            const harness = buildHarness({ status: 'pending', scheduled_at: null });

            await expect(harness.service.updateRequest(schemaName, requestId, {
                status: 'scheduled',
                scheduledAt,
            })).resolves.toMatchObject({ status: 'scheduled', scheduled_at: scheduledAt });

            expect(harness.prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
            expect(harness.prisma.transactionInTenantSchema.mock.calls[0][0]).toBe(schemaName);
            expect(harness.query).toHaveBeenCalledTimes(5);
            const [selectSql, selectParams] = harness.query.mock.calls[0];
            expect(selectSql).toContain('FOR UPDATE');
            expect(selectParams).toEqual([requestId]);
            const [updateSql, updateParams] = harness.query.mock.calls[4];
            expect(updateSql).toContain('service_id = $1');
            expect(updateSql).toContain('estimated_duration_minutes = $3');
            expect(updateSql).toContain('scheduled_at = $4');
            expect(updateSql).toContain('status = $5');
            expect(updateParams).toEqual([
                serviceId,
                'plomeria',
                90,
                scheduledAt,
                'scheduled',
                requestId,
            ]);
            expect(harness.eventEmitter.emit).toHaveBeenCalledWith(
                'service_request.scheduled',
                expect.objectContaining({ requestId, tenantSchemaName: schemaName }),
            );
        });

        it('rejects scheduled status when neither the row nor the update has a date', async () => {
            const harness = buildHarness({ status: 'pending', scheduled_at: null });

            await expect(harness.service.updateRequest(schemaName, requestId, {
                status: 'scheduled',
            })).rejects.toMatchObject({
                response: expect.objectContaining({
                    message: 'scheduledAt is required when status is scheduled',
                }),
            });

            expect(harness.query).toHaveBeenCalledTimes(1);
            expect(String(harness.query.mock.calls[0][0])).toContain('FOR UPDATE');
        });

        it('keeps the existing scheduled_at when scheduling without replacing the date', async () => {
            const harness = buildHarness({ status: 'quoted', scheduled_at: scheduledAt });

            await expect(harness.service.updateRequest(schemaName, requestId, {
                status: 'scheduled',
            })).resolves.toMatchObject({ status: 'scheduled', scheduled_at: scheduledAt });

            expect(harness.query).toHaveBeenCalledTimes(5);
            const [updateSql, updateParams] = harness.query.mock.calls[4];
            expect(updateSql).not.toContain('scheduled_at =');
            expect(updateSql).toContain('status = $4');
            expect(updateParams).toEqual([
                serviceId,
                'plomeria',
                90,
                'scheduled',
                requestId,
            ]);
            expect(harness.eventEmitter.emit).toHaveBeenCalledWith(
                'service_request.scheduled',
                expect.objectContaining({ requestId, tenantSchemaName: schemaName }),
            );
        });

        it('does not allow clearing the date while the final status remains scheduled', async () => {
            const harness = buildHarness({ status: 'scheduled', scheduled_at: scheduledAt });

            await expect(harness.service.updateRequest(schemaName, requestId, {
                scheduledAt: null,
            })).rejects.toBeInstanceOf(BadRequestException);

            expect(harness.query).toHaveBeenCalledTimes(1);
        });
    });
});
