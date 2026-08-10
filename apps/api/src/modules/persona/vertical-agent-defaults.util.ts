import {
    resolveVerticalCapabilityManifest,
    VERTICAL_CAPABILITY_MANIFEST,
    VERTICAL_CAPABILITY_MANIFEST_VERSION,
} from '@parallext/shared';
import type {
    ResolvedVerticalCapabilityManifest,
    VerticalCapability,
    VerticalManifestIndustry,
    VerticalToolGroup,
} from '@parallext/shared';
import { VERTICAL_TOOL_CAPABILITY } from '../../common/contracts/vertical-capability-tools';

export const INVALID_VERTICAL_AGENT_DEFAULTS = 'invalid_vertical_agent_defaults';

export type VerticalAgentDefaultsErrorReason =
    | 'vertical_settings_missing'
    | 'vertical_industry_missing'
    | 'vertical_subtype_required'
    | 'vertical_manifest_version_unsupported'
    | 'vertical_manifest_unresolvable'
    | 'vertical_effective_capabilities_invalid';

export class VerticalAgentDefaultsError extends Error {
    constructor(
        readonly reason: VerticalAgentDefaultsErrorReason,
        message: string,
    ) {
        super(message);
        this.name = 'VerticalAgentDefaultsError';
    }
}

export interface ResolvedVerticalAgentDefaults {
    manifestVersion: typeof VERTICAL_CAPABILITY_MANIFEST_VERSION;
    industry: VerticalManifestIndustry;
    subType: string | null;
    effectiveCapabilities: VerticalCapability[];
    toolDefaults: Partial<Record<VerticalToolGroup, Record<string, boolean>>>;
}

function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizedIdentifier(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    return typeof value === 'string' ? value.trim() || null : null;
}

function resolveEffectiveCapabilities(
    verticalConfig: Record<string, any>,
    manifest: ResolvedVerticalCapabilityManifest,
): VerticalCapability[] {
    const declared = verticalConfig.effectiveCapabilities;
    if (declared !== undefined && !Array.isArray(declared)) {
        throw new VerticalAgentDefaultsError(
            'vertical_effective_capabilities_invalid',
            'Las capacidades efectivas de la vertical deben ser una lista.',
        );
    }

    const derived = manifest.capabilities.filter(
        (capability) => capability !== 'appointment_booking' || verticalConfig.bookingEnabled === true,
    );
    if (declared === undefined) return [...derived];

    const allowed = new Set<VerticalCapability>(manifest.capabilities);
    const effective: VerticalCapability[] = [];
    for (const capability of declared) {
        if (typeof capability !== 'string' || !allowed.has(capability as VerticalCapability)) {
            throw new VerticalAgentDefaultsError(
                'vertical_effective_capabilities_invalid',
                `La capacidad efectiva "${String(capability)}" no pertenece al manifest de ${manifest.industry}/${manifest.subtype || 'none'}.`,
            );
        }
        if (capability === 'appointment_booking' && verticalConfig.bookingEnabled !== true) {
            throw new VerticalAgentDefaultsError(
                'vertical_effective_capabilities_invalid',
                'appointment_booking no puede estar activa cuando bookingEnabled no está habilitado.',
            );
        }
        if (!effective.includes(capability as VerticalCapability)) {
            effective.push(capability as VerticalCapability);
        }
    }
    return effective;
}

function toolDefault(tool: VerticalToolGroup): Record<string, boolean> {
    return tool === 'appointments'
        ? { enabled: true, canBook: true, canCancel: true }
        : { enabled: true };
}

/**
 * Resolve the post-provisioning tenant contract used only for NEW agents.
 * Existing agents are deliberately outside this function: vertical inheritance
 * is a creation default, never a migration or a bulk patch.
 */
export function resolveVerticalAgentDefaults(settings: unknown): ResolvedVerticalAgentDefaults {
    if (!isRecord(settings)) {
        throw new VerticalAgentDefaultsError(
            'vertical_settings_missing',
            'El tenant no tiene settings verticales resolubles.',
        );
    }

    // verticalConfig is canonical. The flat shape is retained only for tenants
    // persisted before that envelope existed; both sources still live in settings.
    const verticalConfig = isRecord(settings.verticalConfig)
        ? settings.verticalConfig
        : settings;
    const industry = normalizedIdentifier(verticalConfig.industry);
    const subType = normalizedIdentifier(verticalConfig.subType ?? verticalConfig.subtype);
    if (!industry) {
        throw new VerticalAgentDefaultsError(
            'vertical_industry_missing',
            'El tenant no tiene una industria vertical configurada.',
        );
    }

    const persistedVersion = verticalConfig.manifestVersion;
    const migratesV1 = persistedVersion === 1 && VERTICAL_CAPABILITY_MANIFEST_VERSION === 2;
    if (
        persistedVersion !== undefined
        && persistedVersion !== VERTICAL_CAPABILITY_MANIFEST_VERSION
        && !migratesV1
    ) {
        throw new VerticalAgentDefaultsError(
            'vertical_manifest_version_unsupported',
            `La versión ${String(persistedVersion)} del manifest vertical no es compatible con v${VERTICAL_CAPABILITY_MANIFEST_VERSION}.`,
        );
    }

    let manifest: ResolvedVerticalCapabilityManifest;
    try {
        manifest = resolveVerticalCapabilityManifest(industry, subType);
    } catch (error: any) {
        throw new VerticalAgentDefaultsError(
            'vertical_manifest_unresolvable',
            error?.message || `No se pudo resolver el manifest vertical ${industry}/${subType || 'none'}.`,
        );
    }

    const entry = VERTICAL_CAPABILITY_MANIFEST[manifest.industry];
    if (entry.subtypes.length > 0 && !subType) {
        throw new VerticalAgentDefaultsError(
            'vertical_subtype_required',
            `La vertical "${industry}" requiere un subtipo explícito.`,
        );
    }

    // v2 removes generic appointments from several native-operation
    // subtypes. A persisted v1 capability list is therefore not authoritative
    // for a newly-created agent; derive v2 from the current manifest and let
    // the provisioning reconciler persist it on the tenant.
    const capabilitySource = migratesV1
        ? Object.fromEntries(
            Object.entries(verticalConfig).filter(([key]) => key !== 'effectiveCapabilities'),
        )
        : verticalConfig;
    const effectiveCapabilities = resolveEffectiveCapabilities(capabilitySource, manifest);
    const effectiveSet = new Set(effectiveCapabilities);
    const toolDefaults: ResolvedVerticalAgentDefaults['toolDefaults'] = {};
    for (const tool of manifest.toolGroups) {
        if (effectiveSet.has(VERTICAL_TOOL_CAPABILITY[tool])) {
            toolDefaults[tool] = toolDefault(tool);
        }
    }

    return {
        manifestVersion: VERTICAL_CAPABILITY_MANIFEST_VERSION,
        industry: manifest.industry,
        subType: manifest.subtype,
        effectiveCapabilities,
        toolDefaults,
    };
}

function hasExplicitValue(record: Record<string, any>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined;
}

/** Apply vertical values as defaults only; every explicit agent value wins. */
export function applyVerticalAgentDefaults(
    config: unknown,
    defaults: ResolvedVerticalAgentDefaults,
): Record<string, any> {
    const source = isRecord(config) ? config : {};
    const result: Record<string, any> = { ...source };

    if (!hasExplicitValue(source, 'capabilities')) {
        result.capabilities = [...defaults.effectiveCapabilities];
    }

    if (hasExplicitValue(source, 'tools') && !isRecord(source.tools)) {
        return result;
    }

    const sourceTools = isRecord(source.tools) ? source.tools : {};
    const tools = { ...sourceTools };
    for (const [tool, toolConfig] of Object.entries(defaults.toolDefaults)) {
        if (!hasExplicitValue(sourceTools, tool)) {
            tools[tool] = { ...toolConfig };
        }
    }
    result.tools = tools;
    return result;
}
