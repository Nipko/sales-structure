export const PROVIDER_RESOURCE_BINDING_VERSION = 1 as const;

export type ProviderResourceBindingState = 'active' | 'conflict' | 'tombstoned';
export type ProviderBindingResolutionMode = 'exact' | 'tenant_wide_conservative' | 'conflict' | 'native';

export interface ProviderResourceBindingV1 {
    version: typeof PROVIDER_RESOURCE_BINDING_VERSION;
    id: string;
    tenantId: string;
    provider: string;
    connectionId: string;
    resourceType: string;
    resourceId: string;
    externalId: string;
    scopeType: string | null;
    scopeId: string | null;
    state: ProviderResourceBindingState;
    generation: number;
    conflictReason: string | null;
    createdAt: string;
    updatedAt: string;
    tombstonedAt: string | null;
}

export interface ProviderBindingResolutionV1 {
    version: typeof PROVIDER_RESOURCE_BINDING_VERSION;
    provider: string | null;
    connectionId: string | null;
    resourceType: string;
    resourceId: string;
    mode: ProviderBindingResolutionMode;
    bindingId: string | null;
    externalId: string | null;
    generation: number;
    owner: 'external' | 'native' | 'blocked';
    allowExternalRead: boolean;
    allowExternalWrite: boolean;
    allowLocalWrite: boolean;
    reason: string;
    cache: 'not_cached';
}

export function conservativeProviderBindingFallback(input: {
    provider?: string | null;
    connectionId?: string | null;
    resourceType: string;
    resourceId: string;
    providerConfigured: boolean;
    generation?: number;
}): ProviderBindingResolutionV1 {
    if (!input.providerConfigured) {
        return Object.freeze({
            version: PROVIDER_RESOURCE_BINDING_VERSION,
            provider: null,
            connectionId: null,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            mode: 'native',
            bindingId: null,
            externalId: null,
            generation: input.generation || 0,
            owner: 'native',
            allowExternalRead: false,
            allowExternalWrite: false,
            allowLocalWrite: true,
            reason: 'provider_not_configured',
            cache: 'not_cached',
        });
    }
    return Object.freeze({
        version: PROVIDER_RESOURCE_BINDING_VERSION,
        provider: input.provider || null,
        connectionId: input.connectionId || null,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        mode: 'tenant_wide_conservative',
        bindingId: null,
        externalId: null,
        generation: input.generation || 0,
        owner: 'external',
        // Preserve the existing tenant-wide provider read while exact local
        // mappings are adopted. Ownership stays external and every write is
        // still closed, so migration cannot create a split-brain writer.
        allowExternalRead: true,
        allowExternalWrite: false,
        allowLocalWrite: false,
        reason: 'resource_binding_required',
        cache: 'not_cached',
    });
}
