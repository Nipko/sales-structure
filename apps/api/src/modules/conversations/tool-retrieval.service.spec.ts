import { ToolRetrievalService } from './tool-retrieval.service';
import { isConfirmableWriteTool } from './tool-policy-registry';

/**
 * The turn that closes a sale is the shortest one in the whole conversation.
 *
 * Relevance is scored against the customer's current message, and that message
 * is "sí". Two characters: below the tokenizer's minimum, matching nothing, so
 * every tool scored zero and the fallback returned the first ten by registration
 * order — the appointment family. `create_property_booking`, the tool the
 * pending confirmation was waiting on, was cut from the exact turn where it had
 * to run, and the booking could never execute.
 */

const tool = (name: string, description = 'does something') => ({
    name,
    description,
    parameters: { type: 'object', properties: {} },
} as any);

// A turismo tenant: appointments + catalog + knowledge + properties.
const TURISMO_TOOLSET = [
    tool('list_services', 'List bookable services with duration and price'),
    tool('check_availability', 'Check appointment availability for a service and date'),
    tool('create_appointment', 'Create an appointment'),
    tool('cancel_appointment', 'Cancel an existing appointment'),
    tool('reschedule_appointment', 'Reschedule an appointment'),
    tool('get_appointment_details', 'Get details of an appointment'),
    tool('list_customer_appointments', 'List the customer appointments'),
    tool('send_booking_link', 'Send a booking link'),
    tool('search_products', 'Search the product catalog'),
    tool('get_product_details', 'Get details of a product'),
    tool('search_knowledge_base', 'Search the knowledge base'),
    tool('list_properties', 'List available properties'),
    tool('check_property_availability', 'Check whether a property is free for a date range'),
    tool('create_property_booking', 'Create a direct booking for a property'),
    tool('cancel_property_booking', 'Cancel a property booking'),
    tool('send_property_image', 'Send a photo of a property'),
];

describe('ToolRetrievalService', () => {
    const service = new ToolRetrievalService();
    const pinnedFor = (tools: any[]) =>
        new Set(tools.filter(t => isConfirmableWriteTool(t.name)).map(t => t.name as string));

    it('keeps the writer the confirmation is waiting on when the customer just says yes', () => {
        const result = service.retrieveRelevantTools('sí turismo idle', TURISMO_TOOLSET, 10, pinnedFor(TURISMO_TOOLSET));
        const names = result.map(t => t.name);

        expect(names).toContain('create_property_booking');
        expect(names).toContain('create_appointment');
    });

    it('drops the writer when nothing is pinned — the regression this guards', () => {
        const names = service
            .retrieveRelevantTools('sí turismo idle', TURISMO_TOOLSET, 10)
            .map(t => t.name);

        expect(names).not.toContain('create_property_booking');
    });

    it('still narrows the toolset instead of returning everything', () => {
        const result = service.retrieveRelevantTools('sí', TURISMO_TOOLSET, 10, pinnedFor(TURISMO_TOOLSET));

        expect(result.length).toBeLessThan(TURISMO_TOOLSET.length);
        // Reads must not be squeezed out entirely by the pinned writers.
        expect(result.some(t => !isConfirmableWriteTool(t.name))).toBe(true);
    });

    it('never returns the same tool twice', () => {
        const names = service
            .retrieveRelevantTools('quiero reservar una propiedad', TURISMO_TOOLSET, 10, pinnedFor(TURISMO_TOOLSET))
            .map(t => t.name);

        expect(new Set(names).size).toBe(names.length);
    });

    it('still ranks by relevance for a descriptive message', () => {
        const names = service
            .retrieveRelevantTools('quiero ver propiedades disponibles', TURISMO_TOOLSET, 10, pinnedFor(TURISMO_TOOLSET))
            .map(t => t.name);

        expect(names).toContain('list_properties');
    });

    it('returns the toolset untouched when it already fits', () => {
        const small = TURISMO_TOOLSET.slice(0, 4);
        expect(service.retrieveRelevantTools('sí', small, 10, pinnedFor(small))).toHaveLength(4);
    });

    it('does not crash on an empty query and still honours the pins', () => {
        const names = service
            .retrieveRelevantTools('', TURISMO_TOOLSET, 10, pinnedFor(TURISMO_TOOLSET))
            .map(t => t.name);

        expect(names).toContain('create_property_booking');
    });
});
