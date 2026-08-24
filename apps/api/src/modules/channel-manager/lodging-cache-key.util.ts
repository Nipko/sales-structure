export function lodgingSorCacheVersionKey(tenantId: string): string {
    return `lodging:sor:version:${tenantId}`;
}

export function lodgingSorCacheValueKey(
    tenantId: string,
    version: string,
    propertyId: string,
): string {
    return `lodging:sor:${tenantId}:v${version}:${propertyId}`;
}
