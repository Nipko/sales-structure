import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import {
    AGENT_TEST_SAFE_TOOL_NAMES,
    AGENT_TEST_SANDBOX_CONTACT_ID,
} from './agent-test-tool-policy';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SCHEMA = 'tenant_agent_test_tools';
const ENTITY_ID = '22222222-2222-4222-8222-222222222222';

function blockedTrap(name: string) {
    return jest.fn(() => {
        throw new Error(`forbidden side effect: ${name}`);
    });
}

function read(value: any) {
    return jest.fn().mockResolvedValue(value);
}

describe('Agent Test complete safe-tool allowlist', () => {
    it('keeps every advertised tool on local/read-only paths under persistence:disabled', async () => {
        const prisma = {
            $executeRawUnsafe: blockedTrap('prisma.$executeRawUnsafe'),
            $queryRawUnsafe: jest.fn().mockResolvedValue([]),
            executeInTenantSchema: jest.fn().mockResolvedValue([]),
        };
        const redis = {
            get: blockedTrap('redis.get'),
            getJson: blockedTrap('redis.getJson'),
            set: blockedTrap('redis.set'),
            setJson: blockedTrap('redis.setJson'),
            del: blockedTrap('redis.del'),
            incrBy: blockedTrap('redis.incrBy'),
            expire: blockedTrap('redis.expire'),
        };
        const eventEmitter = { emit: blockedTrap('eventEmitter.emit') };
        const calendarIntegration = {
            getFreeBusyForDate: blockedTrap('calendar.getFreeBusyForDate'),
            createEvent: blockedTrap('calendar.createEvent'),
        };
        const faqs = {
            search: read([]),
            incrementViews: blockedTrap('faqs.incrementViews'),
        };
        const policies = { getActive: read(null) };
        const knowledge = {
            tenantHasKnowledge: read(false),
            searchRelevant: read([]),
        };
        const properties = {
            checkAvailability: read({ available: true }),
            getById: read(null),
            createBooking: blockedTrap('properties.createBooking'),
            cancelBooking: blockedTrap('properties.cancelBooking'),
        };
        const tours = {
            searchPackages: read([]),
            getPackage: read(null),
            listInventory: read([]),
            checkAvailability: read({ available: true }),
            createBooking: blockedTrap('tours.createBooking'),
            cancelBooking: blockedTrap('tours.cancelBooking'),
        };
        const treatment = { summaryForContact: read(null) };
        const listings = { search: read([]), getById: read(null) };
        const pets = {
            summaryForContact: read([]),
            getById: read(null),
            listVaccinations: read([]),
            create: blockedTrap('pets.create'),
            update: blockedTrap('pets.update'),
        };
        const restaurants = {
            searchMenu: read([]),
            listPromotions: read([]),
            createOrder: blockedTrap('restaurants.createOrder'),
            updateOrderStatus: blockedTrap('restaurants.updateOrderStatus'),
        };
        const gyms = {
            listPlans: read([]),
            upcomingClasses: read([]),
            getMemberByContact: read(null),
            bookClass: blockedTrap('gyms.bookClass'),
            freezeMember: blockedTrap('gyms.freezeMember'),
            cancelBooking: blockedTrap('gyms.cancelBooking'),
        };
        const education = {
            listCourses: read([]),
            upcomingCohorts: read([]),
            getPlacementTestForContact: read(null),
            enrollStudent: blockedTrap('education.enrollStudent'),
            createPlacementTest: blockedTrap('education.createPlacementTest'),
            updateEnrollment: blockedTrap('education.updateEnrollment'),
        };
        const insurance = {
            listPlans: read([]),
            getPolicyByNumber: read(null),
            createQuote: blockedTrap('insurance.createQuote'),
            fileClaim: blockedTrap('insurance.fileClaim'),
            updateQuoteStatus: blockedTrap('insurance.updateQuoteStatus'),
        };
        const chatIdentity = {
            isVerified: blockedTrap('chatIdentity.isVerified'),
            startVerification: blockedTrap('chatIdentity.startVerification'),
            verifyCode: blockedTrap('chatIdentity.verifyCode'),
        };
        const homeServices = {
            getRequestById: read(null),
            createRequest: blockedTrap('homeServices.createRequest'),
            updateRequest: blockedTrap('homeServices.updateRequest'),
        };
        const ecommerce = { searchProductsForAI: read([]) };
        const verticalIntegrations = {
            getMenuForAI: blockedTrap('verticalIntegrations.getMenuForAI'),
            getScheduleForAI: blockedTrap('verticalIntegrations.getScheduleForAI'),
            getClinicServicesForAI: blockedTrap('verticalIntegrations.getClinicServicesForAI'),
            checkClinikoAvailability: blockedTrap('verticalIntegrations.checkClinikoAvailability'),
        };
        const mcp = { callRemoteTool: blockedTrap('mcp.callRemoteTool') };

        const executor = new AIToolExecutorService(
            prisma as any,
            redis as any,
            eventEmitter as any,
            calendarIntegration as any,
            faqs as any,
            policies as any,
            knowledge as any,
            properties as any,
            tours as any,
            treatment as any,
            listings as any,
            pets as any,
            restaurants as any,
            gyms as any,
            education as any,
            insurance as any,
            chatIdentity as any,
            homeServices as any,
            ecommerce as any,
            verticalIntegrations as any,
            mcp as any,
            {
                preflight: jest.fn().mockResolvedValue({ allowed: true, policy: { externalEffect: 'none' } }),
                complete: jest.fn(),
                fail: jest.fn(),
            } as any,
            {} as any,
            {} as any,
        );
        jest.spyOn((executor as any).logger, 'log').mockImplementation(() => undefined);
        jest.spyOn((executor as any).logger, 'warn').mockImplementation(() => undefined);
        jest.spyOn((executor as any).logger, 'error').mockImplementation(() => undefined);
        const args = {
            query: 'prueba',
            search: 'prueba',
            limit: 5,
            productId: ENTITY_ID,
            appointmentId: ENTITY_ID,
            propertyId: ENTITY_ID,
            packageId: ENTITY_ID,
            listingId: ENTITY_ID,
            vehicleId: ENTITY_ID,
            petId: ENTITY_ID,
            orderId: ENTITY_ID,
            requestId: ENTITY_ID,
            policyNumber: 'POL-TEST',
            date: '2026-08-10',
            checkIn: '2026-08-10',
            checkOut: '2026-08-12',
            partySize: 1,
            guests: 1,
            symptoms: 'consulta general',
        };

        for (const toolName of AGENT_TEST_SAFE_TOOL_NAMES) {
            const result = await executor.execute(
                SCHEMA,
                TENANT_ID,
                AGENT_TEST_SANDBOX_CONTACT_ID,
                toolName,
                args,
                undefined,
                // Deliberately omit readOnly: persistence:disabled alone must
                // be sufficient to suppress lazy DDL in recommend_products.
                {
                    authority: authorityFor(toolName),
                    executionContext: AGENT_TEST_EXECUTION_CONTEXT,
                },
            );
            expect(result).not.toMatchObject({ error: 'agent_test_read_only' });
            expect(result).not.toMatchObject({ error: 'tool_failed' });
        }

        const writeSql = prisma.$queryRawUnsafe.mock.calls
            .map(([sql]) => String(sql))
            .filter(sql => /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(sql));
        expect(writeSql).toEqual([]);
        expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
        expect(eventEmitter.emit).not.toHaveBeenCalled();
        for (const method of [redis.get, redis.getJson, redis.set, redis.setJson, redis.del, redis.incrBy, redis.expire]) {
            expect(method).not.toHaveBeenCalled();
        }
        for (const method of [
            calendarIntegration.getFreeBusyForDate,
            calendarIntegration.createEvent,
            verticalIntegrations.getMenuForAI,
            verticalIntegrations.getScheduleForAI,
            verticalIntegrations.getClinicServicesForAI,
            verticalIntegrations.checkClinikoAvailability,
            mcp.callRemoteTool,
            chatIdentity.isVerified,
            chatIdentity.startVerification,
            chatIdentity.verifyCode,
        ]) {
            expect(method).not.toHaveBeenCalled();
        }
        for (const method of [
            properties.createBooking,
            properties.cancelBooking,
            tours.createBooking,
            tours.cancelBooking,
            pets.create,
            pets.update,
            restaurants.createOrder,
            restaurants.updateOrderStatus,
            gyms.bookClass,
            gyms.freezeMember,
            gyms.cancelBooking,
            education.enrollStudent,
            education.createPlacementTest,
            education.updateEnrollment,
            insurance.createQuote,
            insurance.fileClaim,
            insurance.updateQuoteStatus,
            homeServices.createRequest,
            homeServices.updateRequest,
            faqs.incrementViews,
        ]) {
            expect(method).not.toHaveBeenCalled();
        }
        expect(ecommerce.searchProductsForAI).toHaveBeenCalledWith(
            SCHEMA,
            expect.any(Object),
            { createTablesIfMissing: false },
        );
    });
});
