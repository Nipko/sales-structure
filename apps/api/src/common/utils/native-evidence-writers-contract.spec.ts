import { readFileSync } from 'fs';
import { resolve } from 'path';

const API_SRC = resolve(__dirname, '../..');

function source(relativePath: string): string {
    return readFileSync(resolve(API_SRC, relativePath), 'utf8');
}

describe('native evidence writer ownership contract', () => {
    it.each([
        ['appointments/appointments.service.ts', 'appointments'],
        ['tours/tours.service.ts', 'tour_bookings'],
        ['vacation-rental/properties.service.ts', 'property_bookings'],
        ['home-services/home-services.service.ts', 'service_requests'],
        ['restaurants/restaurants.service.ts', 'food_orders'],
        ['photography/photography.service.ts', 'photo_sessions'],
        ['resource-rentals/resource-rentals.service.ts', 'resource_rentals'],
        ['orders/orders.service.ts', 'orders'],
    ])('%s resolves and persists exact ownership for %s', (file, table) => {
        const contents = source(`modules/${file}`);
        expect(contents).toContain('resolveNativeEvidenceOpportunity');
        expect(contents).toMatch(
            new RegExp(`INSERT INTO ${table}[\\s\\S]{0,500}opportunity_id`),
        );
    });

    it('derives AI appointment ownership from the trusted server conversation only', () => {
        const contents = source('modules/conversations/ai-tool-executor.service.ts');
        const start = contents.indexOf('private async createAppointment(');
        const end = contents.indexOf('private async cancelAppointment(', start);
        const createAppointment = contents.slice(start, end);

        expect(createAppointment).toContain('resolveNativeEvidenceOpportunity(query');
        expect(createAppointment).toContain('conversationId,');
        expect(createAppointment).toContain('opportunity_id, conversation_id');
        expect(createAppointment).not.toContain('args.opportunityId');
        expect(createAppointment).not.toContain('trustedOpportunityId: args');
    });
});
