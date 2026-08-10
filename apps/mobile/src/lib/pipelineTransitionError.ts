export interface PipelineMoveErrorDescriptor {
    key: string;
    params?: Record<string, string | number>;
}

const RULE_KEYS: Readonly<Record<string, string>> = {
    email_required: 'pipeline.ruleEmail',
    phone_required: 'pipeline.rulePhone',
    name_required: 'pipeline.ruleName',
    agent_assigned: 'pipeline.ruleAgent',
    appointment_required: 'pipeline.ruleAppointment',
    tour_booking_required: 'pipeline.ruleTourBooking',
    property_booking_required: 'pipeline.rulePropertyBooking',
    service_request_scheduled_required: 'pipeline.ruleServiceRequestScheduled',
    food_order_required: 'pipeline.ruleFoodOrder',
    photo_session_scheduled_required: 'pipeline.rulePhotoSessionScheduled',
    pet_boarding_required: 'pipeline.rulePetBoarding',
    vehicle_rental_required: 'pipeline.ruleVehicleRental',
    order_required: 'pipeline.ruleOrder',
    offer_required: 'pipeline.ruleOffer',
};

function errorText(error: unknown): string {
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    if (!error || typeof error !== 'object') return '';
    const record = error as Record<string, unknown>;
    return errorText(record.message) || errorText(record.error) || errorText(record.data);
}

/**
 * Converts every backend transition failure into an i18n descriptor. The raw
 * TRANSITION_RULE_FAILED contract must never be rendered to a mobile user.
 */
export function describePipelineMoveError(error: unknown): PipelineMoveErrorDescriptor {
    const message = errorText(error);
    if (/terminal stage/i.test(message)) return { key: 'pipeline.ruleTerminal' };

    const match = /TRANSITION_RULE_FAILED:([^:\s"']+)(?::([^:\s"']*))?(?::([^\s"']*))?/i.exec(message);
    if (!match) return { key: 'pipeline.moveError' };

    const rule = match[1].toLowerCase();
    if (rule === 'min_score') {
        return { key: 'pipeline.ruleScore', params: { score: match[2] || '0' } };
    }
    if (rule === 'custom_attribute_required') {
        return { key: 'pipeline.ruleCustomRequired', params: { field: match[2] || '' } };
    }
    if (rule === 'custom_attribute_equals') {
        return {
            key: 'pipeline.ruleCustomEquals',
            params: { field: match[2] || '', value: match[3] || '' },
        };
    }
    return { key: RULE_KEYS[rule] || 'pipeline.ruleGeneric' };
}
