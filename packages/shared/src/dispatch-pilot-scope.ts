/**
 * ═══ WHAT A PILOT IS ALLOWED TO MEAN ═══
 *
 * Durable dispatch is mandatory. The compatibility row in `platform_settings`
 * names the tenants and channels whose real-provider evidence is reviewed in a
 * canary. Two properties decide whether "we validated one tenant" is true:
 *
 *   1. **An empty tenant list means EVERY tenant.** `DispatchRolloutService`
 *      reads it that way, deliberately, because that is what a full rollout
 *      looks like. A pilot that forgets its tenant is platform-wide validation.
 *
 *   2. **A channel the transport cannot serve is ignored, not honoured.** The
 *      service drops it and logs, which is right; but a rehearsal that names one
 *      goes green while validating nothing. The independent review reproduced
 *      exactly that: a pilot configured for `web_widget` produced
 *      `effectiveChannels: []` and `enabledFor === false`, and the check that
 *      was supposed to prove the outbox live only re-read the row it had just
 *      written.
 *
 * Both are refusals rather than warnings here, because both look like success
 * from the outside. The rule is checked BEFORE the write and read back AFTER,
 * so a value that did not land cannot be mistaken for one that did.
 *
 * This does not read the database or select a delivery lane. It is the shape the
 * cohort is allowed to hold, in the one place the writer, the reader and the
 * dashboard can all see it.
 */

export interface DispatchPilotScope {
    readonly enabled: boolean;
    readonly tenantIds: readonly string[];
    readonly channels: readonly string[];
}

export type PilotScopeRefusal =
    /** `enabled` with no tenant named: this is the full rollout, not a pilot. */
    | 'pilot_would_include_every_tenant'
    /** More tenants than the pilot declared. */
    | 'pilot_tenant_count_exceeded'
    /** A tenant id that is not one of the declared participants. */
    | 'pilot_tenant_not_declared'
    /** No channel named: nothing would be validated. */
    | 'pilot_names_no_channel'
    /** A channel with no strict transport. It is dropped, so the pilot is a no-op. */
    | 'pilot_channel_has_no_transport';

export interface PilotScopeVerdict {
    readonly ok: boolean;
    readonly refusals: readonly PilotScopeRefusal[];
    /** The channels whose transport can actually be validated. */
    readonly effectiveChannels: readonly string[];
}

/**
 * Is this configuration a pilot of the size and shape it claims to be?
 *
 * `declaredTenantIds` is the authorisation: the tenants a person agreed to
 * include. `transportChannels` is reality: the channels whose adapter can
 * actually carry a strict dispatch. Both are supplied by the caller rather than
 * imported, so this stays a pure rule and the runtime keeps its own authority
 * over what it supports.
 */
export function assessPilotScope(
    scope: DispatchPilotScope,
    authorised: { readonly declaredTenantIds: readonly string[]; readonly transportChannels: readonly string[] },
): PilotScopeVerdict {
    const refusals: PilotScopeRefusal[] = [];
    const tenantIds = Array.isArray(scope?.tenantIds) ? scope.tenantIds : [];
    const channels = Array.isArray(scope?.channels) ? scope.channels : [];
    const effectiveChannels = channels.filter(channel => authorised.transportChannels.includes(channel));

    // Off is always a valid shape: there is nothing to scope.
    if (scope?.enabled !== true) {
        return Object.freeze({ ok: true, refusals: Object.freeze([]), effectiveChannels: Object.freeze([]) });
    }

    if (tenantIds.length === 0) refusals.push('pilot_would_include_every_tenant');
    if (tenantIds.length > authorised.declaredTenantIds.length) refusals.push('pilot_tenant_count_exceeded');
    if (tenantIds.some(tenant => !authorised.declaredTenantIds.includes(tenant))) {
        refusals.push('pilot_tenant_not_declared');
    }
    if (channels.length === 0) refusals.push('pilot_names_no_channel');
    else if (effectiveChannels.length === 0) refusals.push('pilot_channel_has_no_transport');

    return Object.freeze({
        ok: refusals.length === 0,
        refusals: Object.freeze([...new Set(refusals)]),
        effectiveChannels: Object.freeze(effectiveChannels),
    });
}

/**
 * Turning it off names nothing.
 *
 * `{enabled: false}` with the tenant list still in place is one flipped boolean
 * away from being live again for those tenants, and the boolean is the field
 * most likely to be edited by hand at three in the morning.
 */
export const PILOT_OFF: DispatchPilotScope =
    Object.freeze({ enabled: false, tenantIds: Object.freeze([]), channels: Object.freeze([]) });

/** Did the value that came back from the store say what was written? */
export function pilotScopeMatches(written: DispatchPilotScope, stored: unknown): boolean {
    const read = stored as DispatchPilotScope;
    if (!read || typeof read !== 'object') return false;
    if (read.enabled !== written.enabled) return false;
    const same = (a: readonly string[] = [], b: readonly string[] = []) =>
        a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
    return same(read.tenantIds, written.tenantIds) && same(read.channels, written.channels);
}
