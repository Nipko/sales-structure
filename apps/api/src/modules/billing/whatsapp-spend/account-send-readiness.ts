import { type WhatsappDeliveryBlockReason } from '@parallext/shared';
import { wabaCalendarMonth, wabaLocalDate } from '../whatsapp-rates';
import { resolveCurrency } from '../../whatsapp/waba-currency-authority';
import { isPaused, readPause } from '../../channels/account-send-pause';
import {
    deliveryReadiness, neverAsked, readFundingFromPause, readStoredFunding,
    type FundingReadinessState,
} from '../../channels/whatsapp-funding-readiness';
import { WHATSAPP_OCTOBER_COMMERCIAL_POLICY } from './whatsapp-commercial-policy';

/**
 * ═══ WHAT STOPS EVERY MESSAGE FROM ONE WHATSAPP NUMBER, READ ONCE ═══
 *
 * The send admission refuses some effects for reasons about the MESSAGE (a
 * category nobody could classify, a duplicate, a ceiling) and others for
 * reasons about the NUMBER — and the second kind silences the agent on that
 * number entirely: every reply it writes is refused before it reaches Meta.
 * Until this file, nothing outside the send path could see them, so Salud de
 * agentes showed a healthy agent while a WABA with no time zone refused every
 * answer (the incident behind `waba_timezone_null_silences_agents`).
 *
 * This is not a second copy of the rules. The admission and `authorize` call
 * the same helpers exported here (`resolveWabaZone`, `spendEnforcementFromSettings`),
 * the pause is parsed by the same `readPause` the pause store uses, the
 * currency by the same `resolveCurrency`, and funding by the same readers as
 * `GET /whatsapp/spend/funding-readiness`. A reader that wants to know whether
 * a number can deliver asks HERE, and gets the admission's own answer.
 *
 * Pure: no database, no clock of its own. The caller hands in the account row
 * it already read.
 */

export type SpendEnforcementSetting = 'observe' | 'enforce';

/**
 * The tenant's spend-protection mode, from `tenants.settings`.
 *
 * `enforce` only when the tenant explicitly turned it on; anything else —
 * absent, malformed, a typo — is `observe`, the shipped default. The admission
 * reads the mode through this (behind its Redis cache), and so does anybody
 * who needs to predict what the admission will do.
 */
export function spendEnforcementFromSettings(settings: unknown): SpendEnforcementSetting {
    const configured = (settings as any)?.whatsappSpend?.enforcement;
    return configured === 'enforce' ? 'enforce' : 'observe';
}

/**
 * The WABA time zone as `authorize` needs it, or `null` when there is none that
 * works.
 *
 * `null` is `timezone_missing`, and it is refused in BOTH modes: the rate date
 * and the free monthly allowance are dated in the WABA's own zone, and there
 * is no safe default. A zone string the date functions cannot use is exactly
 * as missing as an empty one.
 */
export function resolveWabaZone(raw: unknown, at: Date): {
    readonly zone: string; readonly localDate: string; readonly allowanceMonth: string;
} | null {
    const zone = String(raw ?? '').trim();
    if (!zone) return null;
    const localDate = wabaLocalDate(at, zone);
    const allowanceMonth = wabaCalendarMonth(at, zone);
    if (!localDate || !allowanceMonth) return null;
    return { zone, localDate, allowanceMonth };
}

/** Meta stops delivering service messages from a WABA with no payment method from this day. */
export const FUNDING_REQUIRED_FROM = WHATSAPP_OCTOBER_COMMERCIAL_POLICY.communication.effectiveOn;

export interface WhatsappAccountSendReadiness {
    /**
     * Why every chargeable send from this number is refused or undeliverable
     * NOW. Empty = nothing account-wide stops it (a single message can still be
     * refused for its own reasons).
     */
    readonly refusals: readonly WhatsappDeliveryBlockReason[];
    /**
     * What will stop it on a known date and does not yet: a WABA with no
     * payment method before `FUNDING_REQUIRED_FROM`.
     */
    readonly upcoming: readonly WhatsappDeliveryBlockReason[];
    /** The funding state `GET /whatsapp/spend/funding-readiness` would report. */
    readonly fundingState: FundingReadinessState;
}

/**
 * Can this WhatsApp number deliver, as the admission and Meta decide it?
 *
 * - `funding_restricted`: a live send pause. The admission refuses
 *   `account_paused` for ANY live pause, whatever code Meta gave, in both
 *   modes. A stored Graph reading of `restricted` counts too: Meta itself said
 *   the business is not eligible to be charged.
 * - `timezone_missing`: `resolveWabaZone` has nothing usable. Both modes.
 * - `currency_unknown`: only under `enforce`, where the admission defers an
 *   effect it cannot price. Under `observe` it is priced as unknown and sent,
 *   so reporting it would be a false alarm.
 * - `funding_absent`: an ESTABLISHED absence (a Graph answer that explicitly
 *   carried no funding id). Upcoming before `FUNDING_REQUIRED_FROM`, a refusal
 *   from that day. `unknown` and `not_checked` never raise it: see the
 *   RE-CHECKED note in `whatsapp-funding-readiness.ts`.
 */
export function whatsappAccountSendReadiness(input: {
    readonly metadata: unknown;
    readonly wabaTimezone: unknown;
    readonly enforcement: SpendEnforcementSetting;
    readonly now?: Date;
}): WhatsappAccountSendReadiness {
    const now = input.now ?? new Date();
    const refusals: WhatsappDeliveryBlockReason[] = [];
    const upcoming: WhatsappDeliveryBlockReason[] = [];

    const pause = readPause(input.metadata);
    const paused = isPaused(pause);
    // Same precedence as the funding-readiness endpoint: a refusal on a real
    // send outranks a stored configuration reading.
    const funding = (paused ? readFundingFromPause(pause) : null)
        ?? readStoredFunding(input.metadata, now)
        ?? neverAsked();

    const zone = resolveWabaZone(input.wabaTimezone, now);
    if (paused || funding.state === 'restricted') refusals.push('funding_restricted');
    if (!zone) refusals.push('timezone_missing');
    if (input.enforcement === 'enforce' && resolveCurrency(input.metadata, now).kind !== 'established') {
        refusals.push('currency_unknown');
    }
    if (funding.state === 'absent' && deliveryReadiness(funding) === 'not_ready') {
        // Meta's dates turn at midnight in the WABA's own zone; ISO dates
        // compare lexicographically. Without a zone, UTC is the fallback — and
        // that number is already reported as `timezone_missing` anyway.
        const today = zone?.localDate ?? now.toISOString().slice(0, 10);
        if (today >= FUNDING_REQUIRED_FROM) refusals.push('funding_absent');
        else upcoming.push('funding_absent');
    }

    return Object.freeze({
        refusals: Object.freeze(refusals),
        upcoming: Object.freeze(upcoming),
        fundingState: funding.state,
    });
}
