import type { TenantSnapshot } from './types';

export const SNAPSHOT_SCHEMA = 'business-spec/tenant-snapshot@1' as const;

/** Foto vacía: punto de partida de fixtures y de `composeFor`. */
export function emptySnapshot(ref: string, capturedAt = '2026-10-30T00:00:00.000Z'): TenantSnapshot {
    return {
        schema: SNAPSHOT_SCHEMA,
        tenant: { ref },
        capturedAt,
        values: {},
        items: {},
        texts: [],
        accounts: [],
        staff: { activeBookable: 0 },
        availability: {},
        integrations: { paymentProvider: false },
        platform: { countryPack: null, followUpRegistry: false },
        provisioningWindow: { tenantCreatedAt: null, completedAt: null },
        defaultsAcceptance: [],
        source: { kind: 'provenance' },
    };
}
