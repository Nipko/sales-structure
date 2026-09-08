import type { ToolDefinition } from '@parallext/shared';
import { isBusinessWriteTool } from './tool-policy-registry';

/** Core lifecycles also apply when they are not a vertical's primary mission. */
export const CORE_PREREQUISITES: Readonly<Record<string, readonly string[]>> = {
    create_appointment: ['list_services', 'check_availability'],
    schedule_test_drive: ['search_vehicles', 'get_vehicle_details', 'list_services', 'check_availability'],
    cancel_appointment: ['list_customer_appointments', 'get_appointment_details'],
    reschedule_appointment: ['list_customer_appointments', 'get_appointment_details', 'check_availability'],
    create_payment_link: ['get_payment_status'],
    book_class: ['get_class_schedule', 'get_my_membership'],
    cancel_class_booking: ['get_my_class_bookings'],
    freeze_membership: ['get_my_membership'],
    enroll_student: ['get_courses', 'get_course_schedule'],
    cancel_enrollment: ['list_my_enrollments'],
    create_property_booking: ['list_properties', 'check_property_availability'],
    cancel_property_booking: ['list_my_property_bookings'],
    create_tour_booking: ['search_packages', 'get_package_details', 'check_package_availability'],
    cancel_tour_booking: ['list_my_tour_bookings'],
    place_order: ['get_menu'],
    cancel_order: ['list_my_orders', 'check_order_status'],
    place_catalog_order: ['search_products', 'get_product', 'check_stock'],
    approve_repair: ['list_my_repair_orders', 'get_repair_order'],
    cancel_repair_order: ['list_my_repair_orders', 'get_repair_order'],
    register_pet: ['list_pets_for_contact'],
    update_pet: ['list_pets_for_contact'],
};

/** Expand selection within the already-authorized snapshot, never outside it. */
export function retainTaskDependencies(
    selected: readonly ToolDefinition[],
    candidates: readonly ToolDefinition[],
    authoredPlans: readonly (readonly string[])[] = [],
): ToolDefinition[] {
    const available = new Map(candidates.map(tool => [tool.name, tool]));
    const retained = new Map(selected.map(tool => [tool.name, tool]));
    for (const tool of retained.values()) {
        const prerequisites = new Set(CORE_PREREQUISITES[tool.name] || []);
        if (isBusinessWriteTool(tool.name)) {
            for (const plan of authoredPlans) {
                if (plan.includes(tool.name)) {
                    // A task's readers survive together with its selected writer.
                    // Other writers in a plan remain subject to ordinary selection.
                    for (const name of plan) if (!isBusinessWriteTool(name)) prerequisites.add(name);
                }
            }
        }
        for (const name of prerequisites) {
            const dependency = available.get(name);
            if (dependency && !retained.has(name)) retained.set(name, dependency);
        }
    }
    return [...retained.values()];
}
