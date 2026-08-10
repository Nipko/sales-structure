import type {
    VerticalDefinition,
    VerticalStageDefinition,
} from '@parallext/shared';

/**
 * Pipeline stages are defined at industry level, but a few subtypes use a
 * different operational engine.  This resolver is the canonical boundary
 * between the shared visual funnel and the concrete table that can satisfy a
 * transition rule.
 *
 * Keep stage slugs stable: persisted tenants and migration previews use them
 * as identity.  Only the rule is adapted, so retries never add a second funnel
 * merely because a subtype does not use generic appointments.
 */
const APPOINTMENT_RULE_BY_SUBTYPE: Readonly<
    Record<string, Readonly<Record<string, string | null>>>
> = {
    salud: {
        // Pharmacy currently has a catalogue, but no guaranteed order writer
        // in the conversational contract.  Do not block its funnel on a
        // medical appointment that the subtype deliberately disables.
        farmacia: null,
    },
    moda_belleza: {
        // Legacy clothing boutiques use catalogue operations, not salon seats.
        boutique: null,
    },
    technology: {
        // Hardware sellers use catalogue/order operations and the manifest
        // explicitly removes appointment booking for this subtype.
        hardware: 'order_required',
    },
    restaurantes: {
        comida_rapida: 'food_order_required',
        dark_kitchen: 'food_order_required',
        delivery: 'food_order_required',
    },
    automotriz: {
        // Parts are fulfilled by the generic commerce order engine. Vehicle
        // hire is a date-range resource reservation, not a test-drive slot.
        repuestos: 'order_required',
        alquiler: 'vehicle_rental_required',
    },
    turismo: {
        agencia_viajes: 'tour_booking_required',
        tours: 'tour_booking_required',
        hotel: 'property_booking_required',
        alquiler_vacacional: 'property_booking_required',
    },
    pet_services: {
        // Grooming, walks and training still use appointments. Day care and
        // hotel capacity live in the resource-rentals engine instead.
        guarderia: 'pet_boarding_required',
        hotel: 'pet_boarding_required',
    },
    fotografia: {
        // Every photography subtype writes the domain-native session table.
        // The wildcard also covers legacy tenants whose subtype is absent.
        '*': 'photo_session_scheduled_required',
    },
};

function resolvedRules(
    industry: string,
    subType: string | null | undefined,
    rules: any[] | undefined,
    appointmentBookingEnabledByDefault: boolean,
): any[] {
    const industryRules = APPOINTMENT_RULE_BY_SUBTYPE[industry];
    let replacement: string | null | undefined = subType
        && Object.prototype.hasOwnProperty.call(industryRules || {}, subType)
        ? industryRules[subType]
        : industryRules?.['*'];
    if (replacement === undefined && !appointmentBookingEnabledByDefault) {
        replacement = null;
    }
    if (replacement === undefined) return [...(rules || [])];

    return (rules || []).flatMap((rule) => {
        if (rule?.type !== 'appointment_required') return [rule];
        return replacement === null ? [] : [{ ...rule, type: replacement }];
    });
}

export function resolveVerticalPipelineStages(
    definition: VerticalDefinition,
    subType?: string | null,
): VerticalStageDefinition[] {
    return definition.pipeline.stages.map((stage) => ({
        ...stage,
        name: { ...stage.name },
        transitionRules: resolvedRules(
            definition.industry,
            subType,
            stage.transitionRules,
            definition.bookingEnabled,
        ),
    })) as VerticalStageDefinition[];
}

export function withResolvedVerticalPipeline(
    definition: VerticalDefinition,
    subType?: string | null,
): VerticalDefinition {
    return {
        ...definition,
        pipeline: { stages: resolveVerticalPipelineStages(definition, subType) },
    };
}
