import {
    listVerticalCapabilityConfigurations,
    VERTICAL_CAPABILITY_MANIFEST,
    VERTICAL_MANIFEST_INDUSTRIES,
} from '@parallext/shared';
import type { VerticalServiceDefinition } from '@parallext/shared';
import { getVerticalDefinition } from '../verticals/vertical-definitions';
import { resolveVerticalAgendaSeedContract } from '../verticals/verticals.service';

export const VERTICAL_COMMERCIAL_UNITS_LAYER = 'contract/static/commercial-units' as const;

export interface VerticalCommercialUnitFailure {
    industry: string;
    subtype: string | null;
    service: string | null;
    field: 'subtype' | 'durationMinutes' | 'durationType' | 'currency';
    message: string;
}

export interface VerticalCommercialServiceRow {
    name: string;
    durationMinutes: number;
    durationType: 'fixed' | 'open';
    durationUnit: 'minutes';
    currency: string;
}

export interface VerticalCommercialConfigurationRow {
    industry: string;
    subtype: string | null;
    agendaAllowed: boolean;
    durationUnit: 'minutes';
    currencySource: 'vertical_definition';
    configuredServices: VerticalCommercialServiceRow[];
    seededServices: VerticalCommercialServiceRow[];
}

export interface VerticalCommercialIndustryRow {
    industry: string;
    subtypeCount: number;
    configuredServiceCount: number;
    currencies: string[];
    durationTypes: Array<'fixed' | 'open'>;
}

export interface VerticalCommercialUnitsMatrix {
    layer: typeof VERTICAL_COMMERCIAL_UNITS_LAYER;
    bootstrapCertified: false;
    dimensions: {
        industries: number;
        subtypes: number;
        operationalConfigurations: number;
    };
    industries: VerticalCommercialIndustryRow[];
    configurations: VerticalCommercialConfigurationRow[];
    failures: VerticalCommercialUnitFailure[];
}

function serviceName(service: VerticalServiceDefinition): string {
    return service.name.es || Object.values(service.name).find(Boolean) || '<unnamed>';
}

function mapService(service: VerticalServiceDefinition): VerticalCommercialServiceRow {
    return {
        name: serviceName(service),
        durationMinutes: service.durationMinutes,
        durationType: service.durationType || 'fixed',
        durationUnit: 'minutes',
        currency: service.currency,
    };
}

function validateService(
    industry: string,
    subtype: string | null,
    service: VerticalServiceDefinition,
    failures: VerticalCommercialUnitFailure[],
): void {
    const name = serviceName(service);
    if (!Number.isInteger(service.durationMinutes) || service.durationMinutes <= 0) {
        failures.push({
            industry,
            subtype,
            service: name,
            field: 'durationMinutes',
            message: 'Canonical service durationMinutes must be a positive integer.',
        });
    }
    if (service.durationType !== undefined && !['fixed', 'open'].includes(service.durationType)) {
        failures.push({
            industry,
            subtype,
            service: name,
            field: 'durationType',
            message: `Unsupported durationType ${String(service.durationType)}.`,
        });
    }
    if (!/^[A-Z]{3}$/.test(service.currency)) {
        failures.push({
            industry,
            subtype,
            service: name,
            field: 'currency',
            message: 'Canonical service currency must be an uppercase three-letter code.',
        });
    }
}

/**
 * Deterministic 18-industry / 75-subtype matrix. It consumes the actual
 * manifest, definitions and bootstrap resolver; it does not duplicate a
 * currency map or reinterpret package/night units.
 */
export function buildVerticalCommercialUnitsMatrix(): VerticalCommercialUnitsMatrix {
    const failures: VerticalCommercialUnitFailure[] = [];
    const configurations: VerticalCommercialConfigurationRow[] = [];
    const industries: VerticalCommercialIndustryRow[] = [];

    for (const industry of VERTICAL_MANIFEST_INDUSTRIES) {
        const definition = getVerticalDefinition(industry);
        const manifestSubtypes = [...VERTICAL_CAPABILITY_MANIFEST[industry].subtypes];
        const definitionSubtypes = definition.subTypes.map((subtype) => subtype.key);

        for (const subtype of manifestSubtypes) {
            if (!definitionSubtypes.includes(subtype)) {
                failures.push({
                    industry,
                    subtype,
                    service: null,
                    field: 'subtype',
                    message: 'Capability-manifest subtype is missing from the vertical definition.',
                });
            }
        }
        for (const subtype of definitionSubtypes) {
            if (!manifestSubtypes.includes(subtype)) {
                failures.push({
                    industry,
                    subtype,
                    service: null,
                    field: 'subtype',
                    message: 'Vertical-definition subtype is missing from the capability manifest.',
                });
            }
        }

        const subtypeSelections: Array<string | null> = manifestSubtypes.length
            ? manifestSubtypes
            : [null];
        const allConfiguredServices: VerticalCommercialServiceRow[] = [];

        for (const subtype of subtypeSelections) {
            const contract = resolveVerticalAgendaSeedContract(definition, subtype);
            contract.services.forEach((service) => validateService(industry, subtype, service, failures));
            const configuredServices = contract.services.map(mapService);
            allConfiguredServices.push(...configuredServices);
            configurations.push({
                industry,
                subtype,
                agendaAllowed: contract.agendaAllowed,
                durationUnit: contract.durationUnit,
                currencySource: contract.currencySource,
                configuredServices,
                seededServices: contract.agendaAllowed ? configuredServices : [],
            });
        }

        industries.push({
            industry,
            subtypeCount: manifestSubtypes.length,
            configuredServiceCount: allConfiguredServices.length,
            currencies: [...new Set(allConfiguredServices.map((service) => service.currency))].sort(),
            durationTypes: [...new Set(allConfiguredServices.map((service) => service.durationType))].sort(),
        });
    }

    const subtypeCount = VERTICAL_MANIFEST_INDUSTRIES.reduce(
        (total, industry) => total + VERTICAL_CAPABILITY_MANIFEST[industry].subtypes.length,
        0,
    );
    return {
        layer: VERTICAL_COMMERCIAL_UNITS_LAYER,
        bootstrapCertified: false,
        dimensions: {
            industries: VERTICAL_MANIFEST_INDUSTRIES.length,
            subtypes: subtypeCount,
            operationalConfigurations: listVerticalCapabilityConfigurations().length,
        },
        industries,
        configurations,
        failures,
    };
}
