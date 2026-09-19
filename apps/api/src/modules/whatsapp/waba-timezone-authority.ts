/**
 * ═══ MAPPING META'S NUMERIC TIME ZONE, WITHOUT INVENTING IT ═══
 *
 * Meta hands back `timezone_id`: an integer from Facebook's own table, not an
 * IANA zone. Everything the money engine does with dates needs the IANA zone —
 * the rate depends on the effective date, and the free thousand resets per
 * number per calendar month — and 23:30 on 30 September in Bogotá is already
 * October in UTC, so a wrong zone silently dates charges in the wrong month.
 *
 * The previous position was to refuse the mapping entirely and make a human
 * type the zone. That is honest and it does not scale: a tenant with six
 * numbers types six times, and a tenant with one number who never finds the
 * field has an agent that will not price anything.
 *
 * ── THE MIDDLE PATH: MAP ONLY WHAT IS AUTHORISED ────────────────────────────
 *
 * The table is not shipped from memory. It is BUILT from evidence, and there
 * are exactly two kinds:
 *
 *   · `human_confirmed` — a person set the zone for a number whose numeric id
 *     we recorded. That pair is now known, for this platform, because somebody
 *     with the account open said so.
 *   · `same_waba_same_id` — another number on the SAME WhatsApp Business
 *     Account reports the SAME numeric id. Meta's time zone is a property of
 *     the business account, so two numbers on one WABA cannot honestly hold
 *     different zones; carrying the confirmed one across is reading the same
 *     fact twice, not guessing.
 *
 * Anything else stays unmapped, and unmapped means BLOCKED with a named
 * diagnosis and a one-field fix — never defaulted. A default here is a wrong
 * rate date that nobody ever notices.
 *
 * ── THE CONTRADICTION RULE ──────────────────────────────────────────────────
 *
 * One WABA, one zone. If two numbers on the same business account end up with
 * different zones, at least one is wrong and the money engine is dating some of
 * its charges in a month that did not happen. That is surfaced as a
 * contradiction to be resolved rather than silently averaged, because there is
 * no correct way to average a time zone.
 */

import { wabaLocalDate } from '../billing/whatsapp-rates';

export interface ZoneEvidence {
    readonly source: 'human_confirmed' | 'same_waba_same_id';
    readonly at: string;
    /** Who confirmed it, when a person did. Never an email or a token. */
    readonly by?: string | null;
    /** Meta's numeric id this zone was confirmed against, when there was one. */
    readonly timezoneId?: number | null;
    /** The WABA the confirmation belongs to. */
    readonly wabaId?: string | null;
    /** For an inherited zone: the number it was inherited from. */
    readonly from?: string | null;
}

/** One WhatsApp number, as the authority sees it. */
export interface NumberZone {
    readonly channelAccountId: string;
    readonly wabaId: string | null;
    /** Meta's numeric id, as reported at connection time. */
    readonly timezoneId: number | null;
    /** The IANA zone, when one is known. */
    readonly zone: string | null;
    readonly evidence: ZoneEvidence | null;
}

export type ZoneResolution =
    | { readonly kind: 'known'; readonly zone: string; readonly evidence: ZoneEvidence }
    | { readonly kind: 'inherited'; readonly zone: string; readonly evidence: ZoneEvidence }
    | { readonly kind: 'unmapped'; readonly reason: 'no_confirmation_for_this_id' | 'no_timezone_id' }
    | { readonly kind: 'contradictory'; readonly zones: readonly string[] };

/** An IANA zone the runtime can actually format with, or nothing. */
export function usableZone(candidate: unknown, now: Date = new Date()): string | null {
    const zone = String(candidate ?? '').trim();
    if (!zone) return null;
    // Validated against the runtime that will USE it rather than against a list
    // of shapes: a zone this accepts and the pricing then refuses would be a
    // ceremony, not a check.
    return wabaLocalDate(now, zone) === null ? null : zone;
}

/**
 * The zone for one number, given every number of the same tenant.
 *
 * `siblings` is the whole set on purpose — the answer depends on what the rest
 * of the WABA already knows, and passing only "the ones that look relevant"
 * would mean the caller deciding the question this function exists to decide.
 */
export function resolveZone(target: NumberZone, siblings: readonly NumberZone[],
    now: Date = new Date()): ZoneResolution {
    const own = usableZone(target.zone, now);
    if (own && target.evidence) return { kind: 'known', zone: own, evidence: target.evidence };
    if (own) {
        // A zone with no evidence behind it: honoured, because it is there and
        // somebody put it there, and recorded as human-confirmed from now on so
        // the next number can inherit it.
        return {
            kind: 'known', zone: own,
            evidence: { source: 'human_confirmed', at: now.toISOString(),
                timezoneId: target.timezoneId ?? null, wabaId: target.wabaId ?? null },
        };
    }

    // Nothing of our own. Can another number on the same business account,
    // reporting the same numeric id, tell us?
    if (target.timezoneId === null || target.timezoneId === undefined) {
        return { kind: 'unmapped', reason: 'no_timezone_id' };
    }
    const family = siblings.filter(sibling =>
        sibling.channelAccountId !== target.channelAccountId
        && sibling.wabaId && target.wabaId && sibling.wabaId === target.wabaId
        && sibling.timezoneId === target.timezoneId
        && usableZone(sibling.zone, now)
        // A zone whose evidence names another WABA or another Meta id was
        // confirmed for an account the donor is no longer on (kept across a
        // reconnect): carrying it would be passing on a zone nobody confirmed
        // for this one.
        && evidenceNamesItsAccount(sibling));

    const distinct = [...new Set(family.map(sibling => usableZone(sibling.zone, now)!))];
    if (distinct.length > 1) return { kind: 'contradictory', zones: distinct.sort() };
    if (distinct.length === 1) {
        const donor = family.find(sibling => usableZone(sibling.zone, now) === distinct[0])!;
        return {
            kind: 'inherited', zone: distinct[0],
            evidence: { source: 'same_waba_same_id', at: now.toISOString(),
                timezoneId: target.timezoneId, wabaId: target.wabaId,
                from: donor.channelAccountId },
        };
    }
    return { kind: 'unmapped', reason: 'no_confirmation_for_this_id' };
}

// ═══ A ZONE BELONGS TO THE ACCOUNT IT WAS CONFIRMED FOR ═══
//
// A zone is confirmed — by a person, or carried from one — for a specific
// account: a WABA and the numeric id Meta reported for it. A reconnect that
// rewrites `metadata.wabaId` / `metadata.metaTimezoneId` to ANOTHER account and
// keeps the column makes the old zone read as confirmed for the new one, and
// `same_waba_same_id` then carries it to that account's next number. So:
//
//   · a reconnect keeps the zone only while it is the same account
//     (`zoneStillConfirmedFor`), and otherwise clears it;
//   · a number whose zone evidence names another account is never a donor
//     (`evidenceNamesItsAccount`), in `resolveZone` and in the propagation of
//     a confirmation.
//
// TWIN: apps/whatsapp onboarding.service.ts (`zoneConfirmedFor`,
// `zoneStillConfirmedFor`, `resolveBillingFacts`) — the Embedded Signup path.
// Change both.

/** Meta's numeric id in one spelling (`"12"`, `12` and `" 12 "` are one id), or null. */
export function normalizeMetaTimezoneId(value: unknown): string | null {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? String(numeric) : raw;
}

function textOrNull(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text ? text : null;
}

/**
 * The WhatsApp Business Account and Meta timezone id a row's zone was
 * confirmed FOR: the ones its evidence names, and — for a zone with no
 * evidence, or evidence that predates those fields — the ones the row itself
 * recorded. `null` = not known, which is never read as a change.
 */
export function zoneConfirmedFor(metadata: unknown): { wabaId: string | null; timezoneId: string | null } {
    const row = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>;
    const evidence = (row.wabaTimezoneEvidence && typeof row.wabaTimezoneEvidence === 'object'
        ? row.wabaTimezoneEvidence : {}) as Record<string, unknown>;
    return {
        wabaId: textOrNull(evidence.wabaId) ?? textOrNull(row.wabaId),
        timezoneId: normalizeMetaTimezoneId(evidence.timezoneId) ?? normalizeMetaTimezoneId(row.metaTimezoneId),
    };
}

/**
 * Whether a zone confirmed for `confirmed` still answers for `account`.
 *
 * A different WABA, or the same WABA now reporting a different id, is an
 * account nobody confirmed this zone for. What is unknown on either side (no
 * evidence, no id reported this time) is not a change.
 */
export function zoneStillConfirmedFor(
    confirmed: { wabaId: string | null; timezoneId: unknown },
    account: { wabaId: string | null; timezoneId: unknown },
): boolean {
    const confirmedWaba = textOrNull(confirmed.wabaId);
    const accountWaba = textOrNull(account.wabaId);
    if (confirmedWaba && accountWaba && confirmedWaba !== accountWaba) return false;
    const confirmedId = normalizeMetaTimezoneId(confirmed.timezoneId);
    const reportedId = normalizeMetaTimezoneId(account.timezoneId);
    return !(confirmedId && reportedId && confirmedId !== reportedId);
}

/** Whether a number's zone evidence names the account the number is on now. */
export function evidenceNamesItsAccount(number: NumberZone): boolean {
    if (!number.evidence) return true;
    return zoneStillConfirmedFor(
        { wabaId: number.evidence.wabaId ?? null, timezoneId: number.evidence.timezoneId },
        { wabaId: number.wabaId, timezoneId: number.timezoneId },
    );
}

/** What a (re)connection writes about the billing zone. */
export interface ConnectionZoneDecision {
    /** `undefined` = leave the column as it is; a zone = write it; `null` = clear it. */
    readonly wabaTimezone: string | null | undefined;
    /** Keys to merge into `channel_accounts.metadata`; a `null` value clears that key. */
    readonly metadata: Readonly<Record<string, unknown>>;
    /** The zone a reconnect to another account dropped, for the log. */
    readonly superseded: string | null;
    /** What the tenant's other numbers could say for the new account, when asked. */
    readonly resolution: ZoneResolution | null;
}

/**
 * The billing zone a connected (or reconnected) number is left with.
 *
 * `existing` is the row as it was before this connection (null for a new
 * one); `account` is what this connection is — its WABA and the id Meta
 * reported now, when it reported one; `siblings` are the tenant's numbers that
 * could donate a zone. Twin of the Embedded Signup's `resolveBillingFacts`.
 */
export function zoneOnConnection(input: {
    readonly existing: { readonly zone: string | null; readonly metadata: unknown } | null;
    readonly account: { readonly channelAccountId: string; readonly wabaId: string; readonly timezoneId: unknown };
    readonly siblings: readonly NumberZone[];
    readonly now?: Date;
}): ConnectionZoneDecision {
    const now = input.now ?? new Date();
    const { account } = input;
    const metadata: Record<string, unknown> = {};
    const previous = (input.existing?.metadata && typeof input.existing.metadata === 'object'
        ? input.existing.metadata : {}) as Record<string, unknown>;
    const reported = normalizeMetaTimezoneId(account.timezoneId);
    const previousWaba = textOrNull(previous.wabaId);
    if (!reported && previous.metaTimezoneId != null && previousWaba && previousWaba !== account.wabaId) {
        // Meta's id is a report ABOUT a WABA. Moved to another WABA that
        // reported none, the old id would claim the new WABA reports it.
        metadata.metaTimezoneId = null;
    }

    const own = input.existing ? usableZone(input.existing.zone, now) : null;
    let superseded: string | null = null;
    if (own) {
        if (zoneStillConfirmedFor(zoneConfirmedFor(previous), { wabaId: account.wabaId, timezoneId: reported })) {
            return { wabaTimezone: undefined, metadata, superseded: null, resolution: null };
        }
        superseded = own;
        metadata.wabaTimezoneEvidence = null;
    }

    if (reported) {
        const resolution = resolveZone({
            channelAccountId: account.channelAccountId, wabaId: account.wabaId,
            timezoneId: Number(reported) || null, zone: null, evidence: null,
        }, input.siblings, now);
        if (resolution.kind === 'inherited') {
            metadata.wabaTimezoneEvidence = resolution.evidence;
            return { wabaTimezone: resolution.zone, metadata, superseded, resolution };
        }
        return { wabaTimezone: superseded ? null : undefined, metadata, superseded, resolution };
    }
    return { wabaTimezone: superseded ? null : undefined, metadata, superseded, resolution: null };
}

/**
 * Every business account whose numbers disagree about what time it is.
 *
 * Meta's zone belongs to the WABA, so a disagreement means at least one number
 * is dating its charges in a month that did not happen for it. There is no
 * correct way to average a time zone, so this returns the conflict rather than
 * resolving it — the fix is a person choosing, once, for the account.
 */
export function contradictoryWabas(numbers: readonly NumberZone[], now: Date = new Date()): readonly {
    readonly wabaId: string;
    readonly zones: readonly string[];
    readonly numbers: readonly string[];
}[] {
    const byWaba = new Map<string, NumberZone[]>();
    for (const number of numbers) {
        if (!number.wabaId || !usableZone(number.zone, now)) continue;
        const list = byWaba.get(number.wabaId) ?? [];
        list.push(number);
        byWaba.set(number.wabaId, list);
    }
    const conflicts: { wabaId: string; zones: string[]; numbers: string[] }[] = [];
    for (const [wabaId, list] of byWaba) {
        const zones = [...new Set(list.map(number => usableZone(number.zone, now)!))].sort();
        if (zones.length > 1) {
            conflicts.push({ wabaId, zones, numbers: list.map(number => number.channelAccountId).sort() });
        }
    }
    return Object.freeze(conflicts.map(conflict => Object.freeze({
        wabaId: conflict.wabaId,
        zones: Object.freeze(conflict.zones),
        numbers: Object.freeze(conflict.numbers),
    })));
}

/** What somebody has to do, in their own terms. */
export function describeResolution(target: NumberZone, resolution: ZoneResolution): string {
    switch (resolution.kind) {
        case 'known':
            return `Charges for this number are dated in ${resolution.zone}.`;
        case 'inherited':
            return `Charges for this number are dated in ${resolution.zone}, taken from another number `
                + `on the same WhatsApp Business Account that reports the same time zone from Meta. `
                + `Change it here if that is wrong.`;
        case 'contradictory':
            return `Two numbers on this WhatsApp Business Account are set to different time zones `
                + `(${resolution.zones.join(', ')}). Meta's time zone belongs to the business account, `
                + `so one of them is wrong and some charges are being dated in the wrong month. `
                + `Choose the correct zone for the account.`;
        case 'unmapped':
        default:
            return resolution.reason === 'no_timezone_id'
                ? `Meta did not report a time zone for this number. Set the zone its WhatsApp charges `
                    + `should be dated in — the rate date and the free monthly allowance both depend on it.`
                : `Meta reports time zone ${target.timezoneId} for this number, which is a numeric id `
                    + `rather than a zone, and no number on this account has confirmed what it means yet. `
                    + `Set the zone once and every number that reports the same id will follow.`;
    }
}
