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
        && usableZone(sibling.zone, now));

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
