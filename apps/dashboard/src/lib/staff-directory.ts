/**
 * The staff directory (`GET /staff/:tenantId`) belongs to the `staffScheduling`
 * plan feature: the API answers 403 `feature_not_available` on plans without it
 * (Starter), and that gate must stay as it is. Pages that merely OFFER the
 * directory as a convenience (the technician picker of service requests and
 * repair orders) therefore check the plan first and degrade, instead of firing
 * a request that is certain to be refused on every open.
 *
 * `loading` matters: until the plan has loaded, `features` holds the Starter
 * defaults, so asking too early would both skip a directory the tenant owns
 * and, on the other path, call it for one that does not.
 */
export function staffDirectoryAvailable(
    features: { staffScheduling?: boolean } | null | undefined,
    loading: boolean,
): boolean {
    return !loading && features?.staffScheduling === true;
}
