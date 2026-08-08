import type { TurnContext } from '@parallext/shared';
import {
    ActiveOperationsContextService,
    classifyActiveObjectStatus,
    resolveActiveOperationsLoaders,
} from './active-operations-context.service';

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
const SUBJECT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-08-08T12:00:00.000Z');

function turn(): TurnContext {
    return {
        language: 'es',
        timezone: 'America/Bogota',
        now: NOW.toISOString(),
        upcomingDays: [],
        businessHoursStatus: 'open',
    };
}

describe('ActiveOperationsContextService', () => {
    it('activates by effective capabilities/tool groups, with explicit tool flags taking precedence', () => {
        expect(resolveActiveOperationsLoaders({
            capabilities: ['appointment_booking', 'nightly_booking', 'tour_booking', 'restaurant_ordering'],
        } as any)).toEqual([
            'appointments', 'property_bookings', 'tour_bookings', 'food_orders',
        ]);

        expect(resolveActiveOperationsLoaders({
            capabilityManifest: { toolGroups: ['appointments', 'properties', 'tours', 'restaurants'] },
            tools: {
                appointments: { enabled: false },
                orders: { enabled: true },
                restaurants: { enabled: false },
            },
        } as any)).toEqual(['property_bookings', 'tour_bookings', 'orders']);

        // Industry alone is deliberately not a loader switch.
        expect(resolveActiveOperationsLoaders({ industry: 'restaurantes' } as any)).toEqual([]);
    });

    it('enforces contact ownership and allow-lists only safe appointment subject metadata', async () => {
        const query = jest.fn(async (_schema: string, sql: string, params: any[]) => {
            if (sql.includes('FROM appointments')) {
                return [{
                    id: 'appointment-1',
                    service_name: 'Consulta',
                    status: 'confirmed',
                    starts_at_iso: '2026-08-09T14:00:00.000Z',
                    ends_at_iso: '2026-08-09T15:00:00.000Z',
                    updated_at_iso: '2026-08-08T11:00:00.000Z',
                    pet_id: SUBJECT_ID,
                    notes: 'FORBIDDEN_NOTES',
                    address: 'FORBIDDEN_ADDRESS',
                    access_code: 'FORBIDDEN_ACCESS',
                    medical_description: 'FORBIDDEN_MEDICAL',
                }];
            }
            if (sql.includes('FROM pets')) {
                return [{
                    id: SUBJECT_ID,
                    label: 'Luna (dog)',
                    allergies: 'FORBIDDEN_ALLERGY',
                }];
            }
            return [];
        });
        const service = new ActiveOperationsContextService({
            executeInTenantSchema: query,
        } as any);

        const result = await service.load({
            tenantId: 'tenant-1',
            schemaName: 'tenant_test',
            contactId: CONTACT_ID,
            config: { capabilities: ['appointment_booking'] } as any,
            timezone: 'America/Bogota',
            now: NOW,
        });

        const appointmentCall = query.mock.calls.find(([, sql]) => sql.includes('FROM appointments'))!;
        expect(appointmentCall[1]).toContain('contact_id = $1::uuid');
        expect(appointmentCall[2][0]).toBe(CONTACT_ID);
        const petCall = query.mock.calls.find(([, sql]) => sql.includes('FROM pets'))!;
        expect(petCall[1]).toContain('contact_id = $2::uuid');
        expect(petCall[2]).toEqual([SUBJECT_ID, CONTACT_ID]);

        expect(result.activeObjects?.items[0]).toMatchObject({
            kind: 'appointment',
            statusClass: 'active',
            subject: { kind: 'pet', id: SUBJECT_ID, label: 'Luna (dog)' },
        });
        const serialized = JSON.stringify(result);
        for (const forbidden of [
            'FORBIDDEN_NOTES', 'FORBIDDEN_ADDRESS', 'FORBIDDEN_ACCESS',
            'FORBIDDEN_MEDICAL', 'FORBIDDEN_ALLERGY',
        ]) {
            expect(serialized).not.toContain(forbidden);
        }
        const allSql = query.mock.calls.map(([, sql]) => sql).join('\n').toLowerCase();
        expect(allSql).not.toMatch(/\b(notes|address|access_code|allergies|chronic_conditions|medical_description)\b/);
    });

    it('isolates loader failures with Promise.allSettled, normalizes status/ISO, and preserves NULL amounts', async () => {
        const query = jest.fn(async (_schema: string, sql: string, params: any[]) => {
            expect(params[0]).toBe(CONTACT_ID);
            if (sql.includes('FROM appointments')) throw new Error('appointments table unavailable');
            if (sql.includes('FROM property_bookings')) return [{
                id: 'property-1', status: 'confirmed', total_price: null, currency: 'cop',
                property_name: 'Casa Mar', starts_at_iso: '2026-08-10T00:00:00.000Z',
                ends_at_iso: '2026-08-12T00:00:00.000Z', updated_at_iso: '2026-08-08T10:00:00.000Z',
            }];
            if (sql.includes('FROM tour_bookings')) return [{
                id: 'tour-1', status: 'reserved', total_price: '99.50', currency: 'usd',
                package_name: 'City Tour', starts_at_iso: '2026-08-11T15:30:00.000Z',
                updated_at_iso: '2026-08-08T10:00:00.000Z',
            }];
            if (sql.includes('FROM orders')) return [{
                id: 'order-1', status: 'completed', total_amount: null, currency: 'cop',
                starts_at_iso: '2026-08-07T09:00:00.000Z', updated_at_iso: '2026-08-07T10:00:00.000Z',
            }];
            if (sql.includes('FROM food_orders')) return [{
                id: 'food-1', status: 'ready', total: null, currency: 'cop',
                starts_at_iso: '2026-08-08T11:00:00.000Z', ends_at_iso: null,
                updated_at_iso: '2026-08-08T11:15:00.000Z',
            }];
            return [];
        });
        const service = new ActiveOperationsContextService({ executeInTenantSchema: query } as any);
        const result = await service.load({
            tenantId: 'tenant-1',
            schemaName: 'tenant_test',
            contactId: CONTACT_ID,
            config: {
                tools: {
                    appointments: { enabled: true },
                    properties: { enabled: true },
                    tours: { enabled: true },
                    orders: { enabled: true },
                    restaurants: { enabled: true },
                },
            } as any,
            timezone: 'America/Bogota',
            now: NOW,
        });

        expect(result.failures).toEqual([{
            loader: 'appointments',
            message: 'appointments table unavailable',
        }]);
        expect(result.activeObjects).toMatchObject({ version: 1, asOf: NOW.toISOString() });
        expect(result.activeObjects?.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'property_booking', statusClass: 'active', amount: null, currency: 'COP' }),
            expect.objectContaining({ kind: 'tour_booking', statusClass: 'active', amount: 99.5, currency: 'USD' }),
            expect.objectContaining({
                kind: 'order', statusClass: 'completed', amount: null,
                detailsTool: 'list_customer_orders',
            }),
            expect.objectContaining({
                kind: 'food_order', statusClass: 'active', amount: null,
                detailsTool: 'list_my_orders',
            }),
        ]));
        expect(result.activeBookings?.map((booking) => booking.type)).toEqual(['property', 'tour']);
        expect(result.recentOrders).toEqual([{
            id: 'order-1',
            status: 'completed',
            total: undefined,
            currency: 'COP',
            date: '2026-08-07T09:00:00.000Z',
        }]);

        const primaryCalls = query.mock.calls.filter(([, sql]) => /FROM (appointments|property_bookings|tour_bookings|orders|food_orders)/.test(sql));
        expect(primaryCalls).toHaveLength(5);
        for (const [, sql, params] of primaryCalls) {
            expect(sql).toContain('contact_id = $1::uuid');
            expect(params[0]).toBe(CONTACT_ID);
        }
    });

    it.each([
        ['appointments', 'pending', 'pending'],
        ['appointments', 'confirmed', 'active'],
        ['tour_bookings', 'reserved', 'active'],
        ['food_orders', 'delivered', 'completed'],
        ['orders', 'refunded', 'cancelled'],
        ['appointments', 'no-show', 'failed'],
        ['orders', 'vendor_specific_state', 'unknown'],
    ] as const)('maps %s/%s to canonical %s', (source, status, expected) => {
        expect(classifyActiveObjectStatus(source, status)).toBe(expected);
    });

    it('bounds both each query and the final context', async () => {
        const rows = Array.from({ length: 8 }, (_, index) => ({
            id: `food-${index}`,
            status: 'received',
            total: index,
            currency: 'COP',
            starts_at_iso: `2026-08-08T11:0${index}:00.000Z`,
        }));
        const query = jest.fn().mockResolvedValue(rows);
        const service = new ActiveOperationsContextService({ executeInTenantSchema: query } as any);
        const result = await service.load({
            tenantId: 'tenant-1', schemaName: 'tenant_test', contactId: CONTACT_ID,
            config: { tools: { restaurants: { enabled: true } } } as any,
            now: NOW, maxItems: 2,
        });

        expect(query.mock.calls[0][1]).toContain('LIMIT 2');
        expect(result.activeObjects?.items).toHaveLength(2);
    });

    it('projects an identical canonical and legacy turn context for production and Agent Test callers', async () => {
        const query = jest.fn().mockResolvedValue([{
            id: 'order-1', status: 'processing', total_amount: '42.00', currency: 'cop',
            starts_at_iso: '2026-08-08T10:00:00.000Z', updated_at_iso: '2026-08-08T11:00:00.000Z',
        }]);
        const service = new ActiveOperationsContextService({ executeInTenantSchema: query } as any);
        const productionTurn = turn();
        const agentTestTurn = turn();
        const input = {
            tenantId: 'tenant-1', schemaName: 'tenant_test', contactId: CONTACT_ID,
            config: { tools: { orders: { enabled: true } } } as any,
            timezone: 'America/Bogota', now: NOW,
        };

        await service.populateTurnContext(productionTurn, input);
        await service.populateTurnContext(agentTestTurn, input);

        expect(agentTestTurn.activeObjects).toEqual(productionTurn.activeObjects);
        expect(agentTestTurn.recentOrders).toEqual(productionTurn.recentOrders);
        expect(agentTestTurn.activeBookings).toEqual(productionTurn.activeBookings);
    });
});
