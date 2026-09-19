/**
 * ═══ WHAT "LISTO" MAY SAY ABOUT THE CHANNEL ═══
 *
 * The wizard's last screen used to say "Tu agente ya responde por el canal
 * conectado" the moment a channel existed. For WhatsApp that is two facts
 * outside the connection — the billing time zone of the number and the
 * payment method on the WhatsApp account — and either one stops every reply
 * (`connected-readiness.ts` owns that rule). An owner who pressed "Continuar"
 * with the zone still unconfirmed read that her agent answers, went to the
 * panel, wrote to herself and got silence.
 *
 * This file decides what the last screen says, from the same reading the
 * connected state already made (handed over by "Continuar") or, when the
 * person got here another way ("Siguiente", the step circle, a reload), from
 * the same two endpoints read again. The claim is made only when nothing
 * known stops the agent; otherwise the screen says what is pending. A reading
 * that could not be taken is said as such — never as "ready", never as the
 * worst case.
 *
 * Pure functions only, so the rule is pinned by tests instead of JSX.
 */

import { billingZoneStateFor, readBillingZoneReadiness } from "../channels/whatsapp/billing-time-zone";
import {
    connectedNumberId,
    connectedReadiness,
    isSignupPending,
    paymentVerdict,
    readFundingFor,
    signupBlockers,
    type ConnectedPending,
    type ConnectedReadiness,
    type WhatsAppConnectedPayload,
} from "../channels/whatsapp/connected-readiness";
import { readWhatsAppChannelRows, whatsAppRowPhoneNumberId } from "../channels/whatsapp/whatsapp-channel-rows";
import { whatsAppRowSignupWarnings } from "../channels/whatsapp/signup-warnings";

/** What the last screen says about the channel. */
export type DoneStepChannel =
    /** No channel: the existing "WhatsApp queda pendiente" copy. */
    | { kind: "no_channel" }
    /** A WhatsApp number is connected and its readiness is still being read. */
    | { kind: "checking" }
    /**
     * Nothing known stops the agent. `paymentSoon`: Meta did not confirm a
     * payment method, which does not stop replies before 1 October 2026 but
     * will from then — worth one line, not a claim that it is broken.
     */
    | { kind: "answering"; paymentSoon: boolean }
    /** Known blockers, in the order the owner should clear them. */
    | { kind: "pending"; pending: ConnectedPending[] }
    /** We could not establish whether the agent can answer on WhatsApp. */
    | { kind: "unconfirmed" };

/**
 * `readiness`: `undefined` = not read yet, `null` = could not be read.
 *
 * `whatsapp` is whether a WhatsApp number is among the connections. Any other
 * channel has no known account-wide blocker the panel can read here, so a
 * channel that is not WhatsApp is taken at its word.
 */
export function doneStepChannel(input: {
    channelConnected: boolean;
    whatsapp: boolean;
    readiness: ConnectedReadiness | null | undefined;
}): DoneStepChannel {
    const { channelConnected, whatsapp, readiness } = input;
    if (!channelConnected && !whatsapp) return { kind: "no_channel" };
    if (!whatsapp) return { kind: "answering", paymentSoon: false };
    if (readiness === undefined || readiness?.headline === "checking") return { kind: "checking" };
    if (readiness === null) return { kind: "unconfirmed" };
    if (readiness.answering) {
        return { kind: "answering", paymentSoon: readiness.pending.includes("payment_method") };
    }
    // The zone could not be read: that is "we do not know", not a list of
    // chores — even when the payment method is also unconfirmed, the zone is
    // what stops everything and it is the part nobody could see. What the
    // signup itself reported open is KNOWN, though, and saying "we could not
    // check" would hide it: that much is listed, and only that.
    if (readiness.headline === "zone_unknown") {
        const known = readiness.pending.filter(isSignupPending);
        return known.length > 0 ? { kind: "pending", pending: known } : { kind: "unconfirmed" };
    }
    return readiness.pending.length > 0 ? { kind: "pending", pending: [...readiness.pending] } : { kind: "unconfirmed" };
}

/**
 * Whether "Terminar en Canales → WhatsApp" leads somewhere that fixes this.
 *
 * That screen confirms the zone and explains the payment method, and it is
 * where an unconfirmed reading is checked again. A signup Meta left open is
 * fixed by waiting for Meta or writing to support — the lines say so — and a
 * button to a screen with nothing to fix it with would be one more dead end.
 */
export function doneStepFixesOnWhatsappScreen(outcome: DoneStepChannel): boolean {
    if (outcome.kind === "unconfirmed") return true;
    return outcome.kind === "pending" && outcome.pending.some((item) => !isSignupPending(item));
}

/**
 * The reading "Continuar" hands over, kept only when it is final.
 *
 * The connected state lets the person continue while it is still checking;
 * keeping that reading would leave the last screen checking forever, so it is
 * dropped and read again there.
 */
export function settledReadiness(readiness: ConnectedReadiness | null | undefined): ConnectedReadiness | undefined {
    return readiness && readiness.headline !== "checking" ? readiness : undefined;
}

/**
 * The same verdict the connected state reaches, from the same two bodies:
 * `GET /channels/whatsapp/connection/billing-readiness` and
 * `GET /whatsapp/spend/funding-readiness`.
 *
 * Null when the zone reading failed or does not say which number this is:
 * without it nothing can be claimed — unless the signup of this number
 * reported something open that stops messages, which is known without any
 * reading and is then said as pending beside a zone nobody could read. A
 * funding read that failed is "unestablished", exactly as on the connected
 * state. This reads only — asking Meta is the connected state's job, and only
 * for an admin.
 */
export function readConnectedReadiness(
    zonesPayload: unknown,
    fundingPayload: unknown,
    connected: WhatsAppConnectedPayload,
    now: number,
): ConnectedReadiness | null {
    const zones = readBillingZoneReadiness(zonesPayload);
    const id = connectedNumberId(connected, zones);
    if (!zones || !id) {
        if (signupBlockers(connected.warnings).length === 0) return null;
        return connectedReadiness({
            zone: { kind: "unknown" },
            payment: paymentVerdict(readFundingFor(fundingPayload, id)),
            now,
            warnings: connected.warnings,
        });
    }
    return connectedReadiness({
        zone: billingZoneStateFor(id, zones),
        payment: paymentVerdict(readFundingFor(fundingPayload, id)),
        now,
        warnings: connected.warnings,
    });
}

/**
 * The number a tenant connected BEFORE opening the wizard, from
 * `GET /channels/whatsapp/status`: the first connected row, else the first row.
 *
 * An unreadable body is an empty payload, not an error: the connected state
 * then matches the number through its own readiness list (a tenant with one
 * number — day 0 — is that number).
 */
export function readExistingWhatsAppNumber(statusPayload: unknown): WhatsAppConnectedPayload {
    const rows = readWhatsAppChannelRows(statusPayload);
    const row = rows.connected[0] ?? rows.preferred;
    if (!row) return {};
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
    const display = [row.display_phone_number, metadata.displayPhoneNumber]
        .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
    const phoneNumberId = whatsAppRowPhoneNumberId(row);
    // What that number's signup left open, as the server persisted it. Without
    // it, a number Meta did not register read "Conectado" once the page had
    // been reloaded. Absent when the server did not say: "not known" is not
    // "nothing open", and the connected state then asks again.
    const warnings = whatsAppRowSignupWarnings(row);
    return {
        ...(phoneNumberId ? { phoneNumberId } : {}),
        ...(display ? { displayPhoneNumber: display.trim() } : {}),
        ...(warnings ? { warnings } : {}),
    };
}
