import * as fs from "fs";
import * as path from "path";
import { WHATSAPP_DELIVERY_BLOCK_REASONS } from "@parallext/shared";
import type { ConnectedReadiness } from "../channels/whatsapp/connected-readiness";
import {
    doneStepChannel,
    doneStepFixesOnWhatsappScreen,
    readConnectedReadiness,
    readExistingWhatsAppNumber,
    settledReadiness,
} from "./done-step-channel";

/**
 * ═══ "LISTO" ONLY SAYS "TU AGENTE YA RESPONDE" WHEN NOTHING KNOWN STOPS IT ═══
 *
 * The wizard's last screen said "Tu agente ya responde por el canal
 * conectado" right after "Continuar", with the billing time zone of the number
 * still unconfirmed — which the spend admission reads as "refuse every reply".
 * These pin what the last screen may say about the channel, and that a reading
 * nobody could take is said as such.
 */

const BEFORE = Date.UTC(2026, 8, 17, 15); // 17-sep-2026
const AFTER = Date.UTC(2026, 9, 2, 15); // 2-oct-2026

const READY: ConnectedReadiness = { headline: "ready", answering: true, pending: [] };
const READY_NO_CARD_YET: ConnectedReadiness = { headline: "ready", answering: true, pending: ["payment_method"] };
const NEEDS_ZONE: ConnectedReadiness = { headline: "needs_zone", answering: false, pending: ["billing_zone", "payment_method"] };
const RESTRICTED: ConnectedReadiness = { headline: "payment_restricted", answering: false, pending: ["payment_method"] };
const ZONE_UNKNOWN: ConnectedReadiness = { headline: "zone_unknown", answering: false, pending: [] };
const CHECKING: ConnectedReadiness = { headline: "checking", answering: false, pending: [] };

function zones(numbers: Array<Record<string, unknown>>) {
    return { success: true, data: { numbers, contradictions: [] } };
}

function funding(state: string, channelAccountId = "111") {
    return { success: true, data: { numbers: [{ channelAccountId, state, checkedAt: "2026-09-17T12:00:00.000Z" }] } };
}

const ZONE_SET = { channelAccountId: "111", zone: "America/Bogota", resolution: { kind: "known" }, metadata: { displayPhoneNumber: "+57 300 000 0000" } };
const ZONE_MISSING = { channelAccountId: "111", zone: null, resolution: { kind: "unmapped" }, metadata: { displayPhoneNumber: "+57 300 000 0000" } };

describe("doneStepChannel — what the last screen says about the channel", () => {
    it("without a channel, says so (the link copy lives on the page)", () => {
        expect(doneStepChannel({ channelConnected: false, whatsapp: false, readiness: undefined })).toEqual({ kind: "no_channel" });
    });

    it("claims the agent answers only when nothing known stops it", () => {
        expect(doneStepChannel({ channelConnected: true, whatsapp: true, readiness: READY }))
            .toEqual({ kind: "answering", paymentSoon: false });
    });

    it("before 1 October a payment method nobody confirmed still answers, with one line about the date", () => {
        expect(doneStepChannel({ channelConnected: true, whatsapp: true, readiness: READY_NO_CARD_YET }))
            .toEqual({ kind: "answering", paymentSoon: true });
    });

    it("with the zone or the payment method pending, lists what is missing in order", () => {
        expect(doneStepChannel({ channelConnected: true, whatsapp: true, readiness: NEEDS_ZONE }))
            .toEqual({ kind: "pending", pending: ["billing_zone", "payment_method"] });
        expect(doneStepChannel({ channelConnected: true, whatsapp: true, readiness: RESTRICTED }))
            .toEqual({ kind: "pending", pending: ["payment_method"] });
    });

    it("a reading that could not be taken is 'unconfirmed', never 'answering' and never a chore list", () => {
        expect(doneStepChannel({ channelConnected: true, whatsapp: true, readiness: null })).toEqual({ kind: "unconfirmed" });
        expect(doneStepChannel({ channelConnected: true, whatsapp: true, readiness: ZONE_UNKNOWN })).toEqual({ kind: "unconfirmed" });
        // The zone is what stops everything; an unconfirmed card beside an
        // unreadable zone is still "we do not know".
        expect(doneStepChannel({
            channelConnected: true,
            whatsapp: true,
            readiness: { headline: "zone_unknown", answering: false, pending: ["payment_method"] },
        })).toEqual({ kind: "unconfirmed" });
    });

    it("says nothing about answering while the reading is out", () => {
        expect(doneStepChannel({ channelConnected: true, whatsapp: true, readiness: undefined })).toEqual({ kind: "checking" });
        expect(doneStepChannel({ channelConnected: true, whatsapp: true, readiness: CHECKING })).toEqual({ kind: "checking" });
    });

    it("a channel that is not WhatsApp has no blocker this screen can read: taken at its word", () => {
        expect(doneStepChannel({ channelConnected: true, whatsapp: false, readiness: undefined }))
            .toEqual({ kind: "answering", paymentSoon: false });
    });

    it("does not hand out the reading's own array", () => {
        const outcome = doneStepChannel({ channelConnected: true, whatsapp: true, readiness: NEEDS_ZONE });
        expect(outcome.kind === "pending" && outcome.pending).not.toBe(NEEDS_ZONE.pending);
    });
});

describe("a signup that Meta left open — what the last screen says", () => {
    const SIGNUP_OPEN: ConnectedReadiness = { headline: "signup_pending", answering: false, pending: ["webhook_subscription"] };

    it("says what is pending instead of 'ya responde'", () => {
        expect(doneStepChannel({ channelConnected: true, whatsapp: true, readiness: SIGNUP_OPEN }))
            .toEqual({ kind: "pending", pending: ["webhook_subscription"] });
    });

    it("a known blocker beside a zone nobody could read is still a known blocker", () => {
        // "We could not check" would hide the one thing we DO know.
        expect(doneStepChannel({
            channelConnected: true,
            whatsapp: true,
            readiness: { headline: "zone_unknown", answering: false, pending: ["payment_method", "phone_registration"] },
        })).toEqual({ kind: "pending", pending: ["phone_registration"] });
    });

    it("the same verdict when 'Listo' reads it again from the payload of this signup", () => {
        const connected = { phoneNumberId: "111", warnings: ["webhook_subscription_failed"] };
        const reading = readConnectedReadiness(zones([ZONE_SET]), funding("attached"), connected, BEFORE);
        expect(reading).toEqual({ headline: "signup_pending", answering: false, pending: ["webhook_subscription"] });
        expect(doneStepChannel({ channelConnected: true, whatsapp: true, readiness: reading }))
            .toEqual({ kind: "pending", pending: ["webhook_subscription"] });
        // A zone reading that failed still knows what the signup said.
        const unread = readConnectedReadiness(null, funding("attached"), { phoneNumberId: "111", warnings: ["phone_registration_deferred"] }, BEFORE);
        expect(unread).toMatchObject({ answering: false, pending: expect.arrayContaining(["phone_registration"]) });
        expect(doneStepChannel({ channelConnected: true, whatsapp: true, readiness: unread }))
            .toEqual({ kind: "pending", pending: ["phone_registration"] });
        // A warning that does not stop replies changes nothing.
        expect(readConnectedReadiness(zones([ZONE_SET]), funding("attached"), { phoneNumberId: "111", warnings: ["business_not_verified"] }, BEFORE))
            .toEqual({ headline: "ready", answering: true, pending: [] });
    });

    it("sends the owner to Canales → WhatsApp only for what she can fix there", () => {
        expect(doneStepFixesOnWhatsappScreen({ kind: "pending", pending: ["webhook_subscription"] })).toBe(false);
        expect(doneStepFixesOnWhatsappScreen({ kind: "pending", pending: ["phone_registration", "webhook_subscription"] })).toBe(false);
        expect(doneStepFixesOnWhatsappScreen({ kind: "pending", pending: ["billing_zone", "webhook_subscription"] })).toBe(true);
        expect(doneStepFixesOnWhatsappScreen({ kind: "pending", pending: ["payment_method"] })).toBe(true);
        expect(doneStepFixesOnWhatsappScreen({ kind: "unconfirmed" })).toBe(true);
        expect(doneStepFixesOnWhatsappScreen({ kind: "answering", paymentSoon: false })).toBe(false);
        expect(doneStepFixesOnWhatsappScreen({ kind: "checking" })).toBe(false);
    });
});

describe("settledReadiness — what 'Continuar' may hand over", () => {
    it("keeps a final reading and drops one that was still checking", () => {
        expect(settledReadiness(NEEDS_ZONE)).toBe(NEEDS_ZONE);
        expect(settledReadiness(READY)).toBe(READY);
        expect(settledReadiness(CHECKING)).toBeUndefined();
        expect(settledReadiness(null)).toBeUndefined();
        expect(settledReadiness(undefined)).toBeUndefined();
    });
});

describe("readConnectedReadiness — the same verdict as the connected state, read again", () => {
    it("zone set and a payment method Meta reports → answering", () => {
        expect(readConnectedReadiness(zones([ZONE_SET]), funding("attached"), { phoneNumberId: "111" }, BEFORE))
            .toEqual({ headline: "ready", answering: true, pending: [] });
    });

    it("zone missing → not answering, whatever the payment method says", () => {
        const result = readConnectedReadiness(zones([ZONE_MISSING]), funding("attached"), { phoneNumberId: "111" }, BEFORE);
        expect(result).toEqual({ headline: "needs_zone", answering: false, pending: ["billing_zone"] });
    });

    it("a funding read that failed is 'unestablished': fine before 1 October, pending from it", () => {
        expect(readConnectedReadiness(zones([ZONE_SET]), null, { phoneNumberId: "111" }, BEFORE))
            .toEqual({ headline: "ready", answering: true, pending: ["payment_method"] });
        expect(readConnectedReadiness(zones([ZONE_SET]), null, { phoneNumberId: "111" }, AFTER))
            .toEqual({ headline: "needs_payment", answering: false, pending: ["payment_method"] });
    });

    it("Meta refusing to charge the account → not answering", () => {
        expect(readConnectedReadiness(zones([ZONE_SET]), funding("restricted"), { phoneNumberId: "111" }, BEFORE))
            .toEqual({ headline: "payment_restricted", answering: false, pending: ["payment_method"] });
    });

    it("finds the number by its display digits, or as the only one, when the payload has no id", () => {
        const other = { ...ZONE_MISSING, channelAccountId: "222", metadata: { displayPhoneNumber: "+57 311 111 1111" } };
        expect(readConnectedReadiness(zones([other, ZONE_SET]), funding("attached"), { displayPhoneNumber: "+57 300-000-0000" }, BEFORE)?.answering)
            .toBe(true);
        expect(readConnectedReadiness(zones([ZONE_SET]), funding("attached"), {}, BEFORE)?.answering).toBe(true);
    });

    it("null when the zone reading failed or cannot say which number this is", () => {
        expect(readConnectedReadiness(null, funding("attached"), { phoneNumberId: "111" }, BEFORE)).toBeNull();
        expect(readConnectedReadiness({ success: false }, funding("attached"), { phoneNumberId: "111" }, BEFORE)).toBeNull();
        const two = zones([ZONE_SET, { ...ZONE_SET, channelAccountId: "222", metadata: {} }]);
        expect(readConnectedReadiness(two, funding("attached"), {}, BEFORE)).toBeNull();
    });

    it("a number the zone list does not carry is 'zone_unknown' (unconfirmed), not ready", () => {
        expect(readConnectedReadiness(zones([ZONE_SET]), funding("attached"), { phoneNumberId: "999" }, BEFORE))
            .toEqual({ headline: "zone_unknown", answering: false, pending: ["payment_method"] });
        const reading = readConnectedReadiness(zones([ZONE_SET]), funding("attached"), { phoneNumberId: "999" }, BEFORE);
        expect(doneStepChannel({ channelConnected: true, whatsapp: true, readiness: reading })).toEqual({ kind: "unconfirmed" });
    });
});

describe("readExistingWhatsAppNumber — the number connected before the wizard", () => {
    it("takes the first CONNECTED row, not the leftover of a replaced number", () => {
        const status = {
            channels: [
                { phone_number_id: "old", display_phone_number: "+57 300 999 9999", channel_status: "disconnected" },
                { phone_number_id: "111", display_phone_number: "+57 300 000 0000", channel_status: "connected" },
            ],
        };
        expect(readExistingWhatsAppNumber(status)).toEqual({ phoneNumberId: "111", displayPhoneNumber: "+57 300 000 0000" });
    });

    it("reads the display number from metadata when the column is empty", () => {
        const status = { data: { channels: [{ metadata: { phoneNumberId: "111", displayPhoneNumber: " +57 300 000 0000 " }, channel_status: "connected" }] } };
        expect(readExistingWhatsAppNumber(status)).toEqual({ phoneNumberId: "111", displayPhoneNumber: "+57 300 000 0000" });
    });

    it("an unreadable status is an empty payload, never an error", () => {
        expect(readExistingWhatsAppNumber(null)).toEqual({});
        expect(readExistingWhatsAppNumber({ success: false })).toEqual({});
        expect(readExistingWhatsAppNumber({ channels: "nope" })).toEqual({});
    });
});

describe("the words the last screen and the day-0 bar use", () => {
    const MESSAGES = path.join(__dirname, "..", "..", "..", "..", "messages");
    const LOCALES = ["es", "en", "pt", "fr"] as const;
    const read = (locale: string) => JSON.parse(fs.readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8"));

    /** Every string this change says on day 0, flattened. */
    function copyOf(locale: string): string[] {
        const source = read(locale);
        const out: string[] = [];
        const walk = (node: unknown) => {
            if (typeof node === "string") out.push(node);
            else if (node && typeof node === "object") Object.values(node).forEach(walk);
        };
        walk(source.setupWizard.doneStep);
        walk(source.qualityHealth.bannerDeliveryReason);
        out.push(source.qualityHealth.bannerDeliveryFailure, source.qualityHealth.bannerChannelUnanswered);
        return out;
    }

    // Day 0 saves immediately (D1/D15): there is no pipeline to talk about.
    const JARGON: Record<string, RegExp> = {
        es: /borrador|publica(?:r|ción|da|do)|candidat|versi[oó]n operativa|bloqueo cr[ií]tico|piloto/i,
        en: /draft|publish|publication|candidate|operational version|critical block|pilot/i,
        pt: /rascunho|publica(?:r|ção|da|do)|candidat|vers[aã]o operacional|bloqueio cr[ií]tico|piloto/i,
        fr: /brouillon|publi(?:er|ée|é|cation)|candidat|version opérationnelle|blocage critique|pilote/i,
    };

    it.each(LOCALES)("has no publication jargon in %s", (locale) => {
        for (const line of copyOf(locale)) expect(line).not.toMatch(JARGON[locale]);
    });

    it("speaks Spanish with tú, never voseo", () => {
        const voseo = /(?:^|[^\wáéíóúñ])(?:prob|peg|revis|conect|agreg|confirm|mir|escrib|termin)á(?![\wáéíóúñ])|(?:^|[^\wáéíóúñ])(?:podés|tenés|querés|sabés|elegí|escribí)(?![\wáéíóúñ])/i;
        expect("Confirmá la zona").toMatch(voseo);
        for (const line of copyOf("es")) expect(line).not.toMatch(voseo);
    });

    it.each(LOCALES)("names a reason for every WhatsApp block the API can report, in %s", (locale) => {
        const reasons = read(locale).qualityHealth.bannerDeliveryReason;
        // The shared vocabulary, so a reason added to the API cannot reach the
        // bar untranslated.
        expect(Object.keys(reasons).sort()).toEqual([...WHATSAPP_DELIVERY_BLOCK_REASONS].sort());
    });
});
