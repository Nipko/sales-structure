import { readFileSync } from 'fs';
import { resolve } from 'path';
import { EVAL_SANDBOX_CONTACT_ID } from './agent-test-tool-policy';
import {
    EVAL_SANDBOX_FIXTURE_IDS,
    evalIdentityChallengeResult,
    executeEvalSandboxMutation,
} from './eval-writer-sandbox';

describe('isolated eval writer adapter', () => {
    const tenantSchemaSql = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
    const conversationId = '11111111-1111-4111-8111-111111111111';
    const createdId = '22222222-2222-4222-8222-222222222222';
    const cases: Array<[string, string, Record<string, any>]> = [
        ['create_appointment', 'appointments', {
            serviceId: EVAL_SANDBOX_FIXTURE_IDS.service,
            date: '2099-06-01', time: '10:00', customerName: 'Eval', customerEmail: 'eval@example.invalid',
        }],
        ['create_property_booking', 'property_bookings', {
            propertyId: EVAL_SANDBOX_FIXTURE_IDS.property,
            checkIn: '2099-06-01', checkOut: '2099-06-02', guestName: 'Eval',
        }],
        ['create_tour_booking', 'tour_bookings', {
            packageId: EVAL_SANDBOX_FIXTURE_IDS.tourPackage,
            departureDate: '2099-06-01', partySize: 1, guestName: 'Eval',
        }],
        ['place_order', 'food_orders', {
            orderType: 'pickup', customerName: 'Eval',
            items: [{ menuItemId: EVAL_SANDBOX_FIXTURE_IDS.menuItem, quantity: 1 }],
        }],
        ['book_class', 'class_bookings', { classId: EVAL_SANDBOX_FIXTURE_IDS.fitnessClass }],
        ['enroll_student', 'enrollments', {
            cohortId: EVAL_SANDBOX_FIXTURE_IDS.cohort, studentName: 'Eval',
        }],
        ['create_service_request', 'service_requests', {
            serviceType: 'plomeria', customerName: 'Eval', issueDescription: 'Eval',
        }],
        ['request_photo_quote', 'photo_sessions', {
            date: '2099-06-01', customerName: 'Eval', sessionType: 'portrait',
        }],
        ['create_vehicle_rental', 'resource_rentals', {
            vehicleId: EVAL_SANDBOX_FIXTURE_IDS.vehicle,
            startDate: '2099-06-01', endDate: '2099-06-02', driverName: 'Eval',
        }],
        ['create_pet_boarding', 'resource_rentals', {
            petId: EVAL_SANDBOX_FIXTURE_IDS.pet,
            serviceId: EVAL_SANDBOX_FIXTURE_IDS.boardingService,
            startDate: '2099-06-01', endDate: '2099-06-02',
        }],
        ['place_catalog_order', 'orders', {
            items: [{ productId: EVAL_SANDBOX_FIXTURE_IDS.product, quantity: 1 }],
        }],
    ];

    it.each(cases)('%s persists only its local %s evidence row', async (toolName, table, args) => {
        const db = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: createdId }]) };
        const result = await executeEvalSandboxMutation(
            db as any,
            'tenant_schema',
            EVAL_SANDBOX_CONTACT_ID,
            conversationId,
            toolName,
            args,
        );

        expect(result).toMatchObject({ success: true, evalSandbox: true });
        expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(1);
        expect(String(db.$queryRawUnsafe.mock.calls[0][0])).toContain(`"tenant_schema".${table}`);
        expect(String(db.$queryRawUnsafe.mock.calls[0][0])).toMatch(/^INSERT\s+INTO/i);
        expect(db.$queryRawUnsafe.mock.calls[0]).toContainEqual(
            expect.stringContaining('"evalSandbox":true'),
        );

        // A mocked query returning an id does not prove the INSERT can run on
        // a real tenant. Compare every inserted column with the canonical
        // schema so a drift such as property_bookings.payment_status fails CI.
        const insertSql = String(db.$queryRawUnsafe.mock.calls[0][0]);
        const insert = insertSql.match(
            /INSERT\s+INTO\s+"[^"]+"\."?([a-z_][a-z0-9_]*)"?\s*\(([\s\S]*?)\)\s*VALUES/i,
        );
        expect(insert?.[1]).toBe(table);
        const insertColumns = (insert?.[2] || '').split(',').map(column => column.trim());
        const tableStart = tenantSchemaSql.indexOf(
            `CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."${table}"`,
        );
        expect(tableStart).toBeGreaterThanOrEqual(0);
        const tableEnd = tenantSchemaSql.indexOf('\n);', tableStart);
        const declaredColumns = new Set(
            [...tenantSchemaSql.slice(tableStart, tableEnd).matchAll(/^\s*"([a-z_][a-z0-9_]*)"\s+/gmi)]
                .map(match => match[1]),
        );
        expect(insertColumns.filter(column => !declaredColumns.has(column))).toEqual([]);
    });

    it('normalizes an inconsistent tour party breakdown to the declared party size', async () => {
        const db = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: createdId }]) };
        await executeEvalSandboxMutation(
            db as any,
            'tenant_schema',
            EVAL_SANDBOX_CONTACT_ID,
            conversationId,
            'create_tour_booking',
            {
                packageId: EVAL_SANDBOX_FIXTURE_IDS.tourPackage,
                departureDate: '2099-06-01', partySize: 2, adults: 5, children: 3,
                guestName: 'Eval',
            },
        );
        expect(db.$queryRawUnsafe.mock.calls[0].slice(10, 13)).toEqual([2, 0, 2]);
    });

    it('requires the fixed eval identity even for an audited mutation', async () => {
        const db = { $queryRawUnsafe: jest.fn() };
        const result = await executeEvalSandboxMutation(
            db as any,
            'tenant_schema',
            '33333333-3333-4333-8333-333333333333',
            conversationId,
            'create_service_request',
            {},
        );
        expect(result).toEqual({ error: 'eval_sandbox_contact_required', persisted: false });
        expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('keeps identity step-up as a negative challenge and never treats it as a sandbox mutation', async () => {
        const db = { $queryRawUnsafe: jest.fn() };
        await expect(executeEvalSandboxMutation(
            db as any,
            'tenant_schema',
            EVAL_SANDBOX_CONTACT_ID,
            conversationId,
            'file_claim',
            {},
        )).resolves.toMatchObject({ error: 'eval_writer_not_audited', persisted: false });
        expect(evalIdentityChallengeResult('file_claim')).toMatchObject({
            error: 'identity_verification_required',
            needsVerification: true,
            outboundSuppressed: true,
            persisted: false,
        });
        expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
    });
});
