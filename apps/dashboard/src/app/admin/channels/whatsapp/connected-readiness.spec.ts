import * as fs from "fs";
import * as path from "path";
import type { BillingZoneReadiness, BillingZoneState } from "./billing-time-zone";
import {
    META_SERVICE_CHARGES_FROM,
    connectedNumberId,
    connectedReadiness,
    paymentRequiredNow,
    paymentVerdict,
    preselectBusinessZone,
    readFundingFor,
    readTenantTimeZone,
    signupBlockers,
    withSavedZone,
} from "./connected-readiness";

/**
 * ═══ "CONECTADO" SOLO DICE "TU AGENTE YA RESPONDE" CUANDO ES VERDAD ═══
 *
 * The 14-sep-2026 recording ended on "¡Conectado! … Tu agente ya responde ahí"
 * over a number with no billing time zone — which the spend admission reads as
 * "refuse every reply". These pin the rule that replaced that sentence: the
 * claim needs a zone that is SET and no known reason for Meta not to deliver,
 * and nothing we failed to read is ever taken as fine.
 */

const BEFORE = Date.UTC(2026, 8, 17, 15); // 17-sep-2026, the day this shipped
const AFTER = Date.UTC(2026, 9, 2, 15);

const SET: BillingZoneState = { kind: "set", zone: "America/Bogota", conflictingZones: [] };
const MISSING: BillingZoneState = { kind: "missing", suggestion: "America/Bogota", suggestionSource: "common", conflictingZones: [] };
const UNKNOWN: BillingZoneState = { kind: "unknown" };

function readiness(numbers: Partial<BillingZoneReadiness["numbers"][number]>[]): BillingZoneReadiness {
    return {
        numbers: numbers.map((number) => ({
            phoneNumberId: "111", zone: null, resolution: "unmapped", resolvedZone: null,
            candidateZones: [], displayPhoneNumber: null, ...number,
        })),
        contradictions: [],
    };
}

describe("connectedReadiness — the three states the wizard can end in", () => {
    it("all good: a set zone and a payment method Meta reports → the agent answers", () => {
        expect(connectedReadiness({ zone: SET, payment: "ready", now: BEFORE }))
            .toEqual({ headline: "ready", answering: true, pending: [] });
    });

    it("timezone missing: never claims an answer, whatever the payment method says", () => {
        for (const payment of ["ready", "unestablished", "missing", "restricted", "checking"] as const) {
            const result = connectedReadiness({ zone: MISSING, payment, now: BEFORE });
            expect(result.headline).toBe("needs_zone");
            expect(result.answering).toBe(false);
            expect(result.pending[0]).toBe("billing_zone");
        }
    });

    it("payment method missing or refused: no claim, and it says which", () => {
        expect(connectedReadiness({ zone: SET, payment: "missing", now: BEFORE }))
            .toEqual({ headline: "needs_payment", answering: false, pending: ["payment_method"] });
        expect(connectedReadiness({ zone: SET, payment: "restricted", now: BEFORE }))
            .toEqual({ headline: "payment_restricted", answering: false, pending: ["payment_method"] });
    });

    it("payment method not established: true today, but not from 1 October", () => {
        // Before 1-oct service replies are delivered without a card, so the
        // claim holds and the card only asks. From that date the likeliest
        // "unknown" is an account with no card, and the claim stops.
        expect(connectedReadiness({ zone: SET, payment: "unestablished", now: BEFORE }))
            .toEqual({ headline: "ready", answering: true, pending: ["payment_method"] });
        expect(connectedReadiness({ zone: SET, payment: "unestablished", now: AFTER }))
            .toEqual({ headline: "needs_payment", answering: false, pending: ["payment_method"] });
    });

    it("claims nothing while it is still reading, or when the zone could not be read", () => {
        expect(connectedReadiness({ zone: undefined, payment: "ready", now: BEFORE }).answering).toBe(false);
        expect(connectedReadiness({ zone: undefined, payment: "ready", now: BEFORE }).headline).toBe("checking");
        expect(connectedReadiness({ zone: SET, payment: "checking", now: BEFORE }))
            .toEqual({ headline: "checking", answering: false, pending: [] });
        expect(connectedReadiness({ zone: UNKNOWN, payment: "ready", now: BEFORE }))
            .toEqual({ headline: "zone_unknown", answering: false, pending: [] });
    });

    it("switches the payment date at 1 October 2026, not later", () => {
        expect(paymentRequiredNow(META_SERVICE_CHARGES_FROM - 1)).toBe(false);
        expect(paymentRequiredNow(META_SERVICE_CHARGES_FROM)).toBe(true);
        expect(new Date(META_SERVICE_CHARGES_FROM).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    });
});

describe("Embedded Signup warnings that stop the replies", () => {
    // The signup answer carries `warnings` (apps/whatsapp onboarding.service.ts
    // and KNOWN_WHATSAPP_WARNINGS). Two of them mean messages do not flow:
    // Meta did not confirm our subscription to the account's webhooks, so the
    // customer's message never reaches the agent; or the number is not yet
    // registered with the Cloud API, so nothing can be sent from it.
    it.each([
        ["webhook_subscription_failed", "webhook_subscription"],
        ["phone_registration_deferred", "phone_registration"],
    ] as const)("%s: never claims the agent answers, and names it as pending", (warning, pending) => {
        expect(connectedReadiness({ zone: SET, payment: "ready", now: BEFORE, warnings: [warning] }))
            .toEqual({ headline: "signup_pending", answering: false, pending: [pending] });
    });

    it("warnings that do not stop a reply leave the claim alone", () => {
        // An unverified business answers with a daily cap; templates only
        // matter for messages the business starts; free text is not a code.
        for (const warning of ["business_not_verified", "template_sync_failed", "La verificación del negocio…"]) {
            expect(connectedReadiness({ zone: SET, payment: "ready", now: BEFORE, warnings: [warning] }))
                .toEqual({ headline: "ready", answering: true, pending: [] });
        }
        expect(signupBlockers(["business_not_verified", "template_sync_failed"])).toEqual([]);
        expect(signupBlockers(undefined)).toEqual([]);
    });

    it("keeps the zone first, lists every blocker once, and never claims while reading", () => {
        const both = ["webhook_subscription_failed", "phone_registration_deferred", "webhook_subscription_failed"];
        expect(connectedReadiness({ zone: MISSING, payment: "unestablished", now: BEFORE, warnings: both }))
            .toEqual({
                headline: "needs_zone",
                answering: false,
                pending: ["billing_zone", "payment_method", "phone_registration", "webhook_subscription"],
            });
        const reading = connectedReadiness({ zone: undefined, payment: "ready", now: BEFORE, warnings: ["webhook_subscription_failed"] });
        expect(reading).toMatchObject({ headline: "checking", answering: false, pending: ["webhook_subscription"] });
        // Before 1 October an unconfirmed card still answers — not over a
        // number whose messages never reach us.
        expect(connectedReadiness({ zone: SET, payment: "unestablished", now: BEFORE, warnings: ["webhook_subscription_failed"] }))
            .toEqual({ headline: "signup_pending", answering: false, pending: ["payment_method", "webhook_subscription"] });
    });
});

describe("the funding reading", () => {
    const body = (numbers: unknown[]) => ({ success: true, data: { numbers } });

    it("reads this number's state and nothing else's", () => {
        const payload = body([
            { channelAccountId: "222", state: "absent" },
            { channelAccountId: "111", state: "attached", checkedAt: "2026-09-17T10:00:00Z" },
        ]);
        expect(readFundingFor(payload, "111")).toEqual({ kind: "read", state: "attached", checkedAt: "2026-09-17T10:00:00Z" });
    });

    it("never turns a failed or partial answer into a finding", () => {
        expect(readFundingFor(null, "111")).toEqual({ kind: "unreadable" });
        expect(readFundingFor({ success: false, httpStatus: 403 }, "111")).toEqual({ kind: "unreadable" });
        expect(readFundingFor(body([{ channelAccountId: "222", state: "attached" }]), "111")).toEqual({ kind: "unreadable" });
        expect(readFundingFor(body([{ channelAccountId: "111", state: "attached" }]), null)).toEqual({ kind: "unreadable" });
        expect(readFundingFor(body([{ channelAccountId: "111", state: "maybe" }]), "111"))
            .toEqual({ kind: "read", state: "unknown", checkedAt: null });
    });

    it("maps states to what they mean for the replies", () => {
        expect(paymentVerdict(undefined)).toBe("checking");
        expect(paymentVerdict({ kind: "unreadable" })).toBe("unestablished");
        expect(paymentVerdict({ kind: "read", state: "attached", checkedAt: null })).toBe("ready");
        expect(paymentVerdict({ kind: "read", state: "absent", checkedAt: null })).toBe("missing");
        expect(paymentVerdict({ kind: "read", state: "restricted", checkedAt: null })).toBe("restricted");
        // "Not checked" is not "no card" — and not "fine" either.
        expect(paymentVerdict({ kind: "read", state: "not_checked", checkedAt: null })).toBe("unestablished");
        expect(paymentVerdict({ kind: "read", state: "unknown", checkedAt: null })).toBe("unestablished");
    });
});

describe("preselectBusinessZone — one tap to confirm", () => {
    const options = ["America/Argentina/Buenos_Aires", "America/Bogota", "America/Mexico_City"];

    it("starts the picker on the business's own zone instead of the generic suggestion", () => {
        const result = preselectBusinessZone(MISSING, "America/Mexico_City", options);
        expect(result.fromBusiness).toBe("America/Mexico_City");
        // The card's "most common" hint must not describe the business's zone.
        expect(result.state).toEqual({ kind: "missing", suggestion: "America/Mexico_City", suggestionSource: null, conflictingZones: [] });
    });

    it("accepts a legacy alias when only the canonical name is offered", () => {
        expect(preselectBusinessZone(MISSING, "America/Buenos_Aires", options).fromBusiness).toBe("America/Argentina/Buenos_Aires");
    });

    it("keeps what the WhatsApp account itself says, and a disagreement for a person to settle", () => {
        const sameAccount: BillingZoneState = { kind: "missing", suggestion: "America/Bogota", suggestionSource: "same_account", conflictingZones: [] };
        expect(preselectBusinessZone(sameAccount, "America/Mexico_City", options)).toEqual({ state: sameAccount, fromBusiness: null });
        const conflict: BillingZoneState = { kind: "missing", suggestion: null, suggestionSource: null, conflictingZones: ["America/Bogota", "America/Lima"] };
        expect(preselectBusinessZone(conflict, "America/Mexico_City", options)).toEqual({ state: conflict, fromBusiness: null });
    });

    it("changes nothing without a usable business zone, or for a zone that is not missing", () => {
        expect(preselectBusinessZone(MISSING, null, options)).toEqual({ state: MISSING, fromBusiness: null });
        expect(preselectBusinessZone(MISSING, "Mars/Olympus", options)).toEqual({ state: MISSING, fromBusiness: null });
        expect(preselectBusinessZone(SET, "America/Mexico_City", options)).toEqual({ state: SET, fromBusiness: null });
    });

    it("reads the tenant zone from its endpoint and nothing from a failure", () => {
        expect(readTenantTimeZone({ success: true, data: { timezone: "America/Lima" } })).toBe("America/Lima");
        expect(readTenantTimeZone({ success: true, data: { timezone: null } })).toBeNull();
        expect(readTenantTimeZone({ success: false })).toBeNull();
        expect(readTenantTimeZone(null)).toBeNull();
    });
});

describe("which number was just connected", () => {
    it("uses the id the signup answered", () => {
        expect(connectedNumberId({ phoneNumberId: " 111 " }, null)).toBe("111");
    });

    it("falls back to the display number, then to the only number there is", () => {
        const list = readiness([
            { phoneNumberId: "111", displayPhoneNumber: "+57 300 000 0001" },
            { phoneNumberId: "222", displayPhoneNumber: "+57 300 000 0002" },
        ]);
        expect(connectedNumberId({ displayPhoneNumber: "+57 300-000-0002" }, list)).toBe("222");
        expect(connectedNumberId({ displayPhoneNumber: "+1 555" }, list)).toBeNull();
        expect(connectedNumberId({ displayPhoneNumber: "+1 555" }, readiness([{ phoneNumberId: "333" }]))).toBe("333");
        expect(connectedNumberId({}, null)).toBeNull();
    });
});

describe("withSavedZone", () => {
    it("holds the zone the server confirmed until the next read, for the siblings it reached too", () => {
        const before = readiness([{ phoneNumberId: "111" }, { phoneNumberId: "222" }, { phoneNumberId: "333" }]);
        const after = withSavedZone(before, { phoneNumberId: "111", timeZone: "America/Lima", alsoApplied: ["222"] });
        expect(after.numbers.map((number) => [number.phoneNumberId, number.zone, number.resolution])).toEqual([
            ["111", "America/Lima", "known"],
            ["222", "America/Lima", "known"],
            ["333", null, "unmapped"],
        ]);
    });

    it("works when the first read had failed", () => {
        const after = withSavedZone(null, { phoneNumberId: "111", timeZone: "America/Lima", alsoApplied: [] });
        expect(after.numbers).toHaveLength(1);
        expect(after.numbers[0]).toMatchObject({ phoneNumberId: "111", zone: "America/Lima", resolution: "known" });
    });
});

describe("the copy the owner reads after connecting", () => {
    const MESSAGES = path.join(__dirname, "..", "..", "..", "..", "..", "messages");
    const LOCALES = ["es", "en", "pt", "fr"] as const;
    const read = (locale: string) => JSON.parse(fs.readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8"));

    /** Every string of the connected state, flattened. */
    function copyOf(locale: string): string[] {
        const whatsapp = read(locale).channels.whatsapp;
        const out: string[] = [whatsapp.testAgentTitle, whatsapp.testAgentDesc];
        const walk = (node: unknown) => {
            if (typeof node === "string") out.push(node);
            else if (node && typeof node === "object") Object.values(node).forEach(walk);
        };
        walk(whatsapp.afterConnect);
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
        // JS `\b` does not see accented letters as word characters, so the
        // boundaries are spelled out.
        const voseo = /(?:^|[^\wáéíóúñ])(?:prob|peg|revis|conect|agreg|confirm|mir|escrib)á(?![\wáéíóúñ])|(?:^|[^\wáéíóúñ])(?:podés|tenés|querés|sabés|elegí|escribí)(?![\wáéíóúñ])/i;
        expect("Probá tu agente").toMatch(voseo);
        expect("Si podés, seguí").toMatch(voseo);
        for (const line of copyOf("es")) expect(line).not.toMatch(voseo);
        expect(read("es").channels.whatsapp.testAgentTitle).toBe("Prueba tu agente");
    });

    it.each(LOCALES)("names what silences an agent in the test card in %s", (locale) => {
        const desc: string = read(locale).channels.whatsapp.testAgentDesc;
        expect(desc).toContain("{number}");
        const words: Record<string, RegExp[]> = {
            es: [/zona horaria/i, /método de pago/i, /pausa/i],
            en: [/time zone/i, /payment method/i, /paused/i],
            pt: [/fuso horário/i, /meio de pagamento/i, /pausado/i],
            fr: [/fuseau horaire/i, /moyen de paiement/i, /en pause/i],
        };
        for (const word of words[locale]) expect(desc).toMatch(word);
    });

    it.each(LOCALES)("says Meta charges it, not Parallly, and gives the date, in %s", (locale) => {
        const payment = read(locale).channels.whatsapp.afterConnect.payment;
        expect(payment.what).toMatch(/Meta/);
        expect(payment.what).toMatch(/Parallly/);
        expect(payment.dateBefore).toMatch(/2026/);
        expect(payment.dateBefore).toMatch(/30/);
        expect(payment.dateAfter).toMatch(/2026/);
    });

    it.each(LOCALES)("never promises replies in the pending headlines in %s", (locale) => {
        const after = read(locale).channels.whatsapp.afterConnect;
        const promise: Record<string, RegExp> = {
            es: /ya responde/i, en: /now answers|already answers/i, pt: /já responde/i, fr: /répond désormais|répond déjà/i,
        };
        for (const key of ["checkingTitle", "pendingTitle", "zoneUnknownTitle", "needsZoneDesc", "needsPaymentDesc", "restrictedDesc", "signupBlocksReplies"]) {
            expect(after[key]).not.toMatch(promise[locale]);
        }
    });
});
