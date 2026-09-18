import { readExistingWhatsAppNumber } from "../../setup-wizard/done-step-channel";
import {
    numberSignupWarnings,
    signupBlocksRepliesOn,
    signupWarningGroups,
    whatsAppRowSignupWarnings,
    whatsAppRowSignupWarningsAt,
} from "./signup-warnings";

/**
 * What the signup of a connected number left open, read back from
 * `GET /channels/whatsapp/status` (`signupWarnings` per account).
 *
 * Before, the wizard and Canales → WhatsApp knew a signup's warnings only from
 * the answer to a signup run in that same page: after a reload a number Meta
 * did not register read "Conectado". Pinned here: the server's record is read
 * per number, "not said" never becomes "nothing open", and what this page's
 * own signup answered fills in only where the server could not say.
 */

const account = (accountId: string, extra: Record<string, unknown> = {}) => ({
    accountId, displayName: `Número ${accountId}`, metadata: { displayPhoneNumber: `+57 300 000 ${accountId}` }, ...extra,
});
const status = (...accounts: Record<string, unknown>[]) => ({
    success: true, data: { connected: accounts.length > 0, account: accounts[0] ?? null, accounts },
});

describe("reading one status row", () => {
    it("reads the codes the server kept, once each", () => {
        expect(whatsAppRowSignupWarnings(account("1", { signupWarnings: ["phone_registration_deferred", "phone_registration_deferred", 7, ""] })))
            .toEqual(["phone_registration_deferred"]);
        expect(whatsAppRowSignupWarnings(account("1", { signupWarnings: [] }))).toEqual([]);
    });

    it("reads a missing or unreadable field as 'not said', never as 'nothing open'", () => {
        expect(whatsAppRowSignupWarnings(account("1"))).toBeUndefined();
        expect(whatsAppRowSignupWarnings(account("1", { signupWarnings: null }))).toBeUndefined();
        expect(whatsAppRowSignupWarnings(null)).toBeUndefined();
    });

    it("keeps the date only when it is one", () => {
        expect(whatsAppRowSignupWarningsAt(account("1", { signupWarningsAt: "2026-09-17T15:00:00.000Z" }))).toBe("2026-09-17T15:00:00.000Z");
        expect(whatsAppRowSignupWarningsAt(account("1", { signupWarningsAt: "ayer" }))).toBeNull();
    });
});

describe("numberSignupWarnings", () => {
    const body = status(account("111", { signupWarnings: ["webhook_subscription_failed"] }), account("222", { signupWarnings: [] }));

    it("finds the number it is asked about", () => {
        expect(numberSignupWarnings(body, "111")).toEqual(["webhook_subscription_failed"]);
        expect(numberSignupWarnings(body, "222")).toEqual([]);
        expect(numberSignupWarnings(body, "333")).toBeUndefined();
    });

    it("without a number, answers only for a tenant that has exactly one", () => {
        expect(numberSignupWarnings(status(account("111", { signupWarnings: ["phone_registration_deferred"] })), null))
            .toEqual(["phone_registration_deferred"]);
        expect(numberSignupWarnings(body, null)).toBeUndefined();
        expect(numberSignupWarnings(null, "111")).toBeUndefined();
    });
});

describe("signupWarningGroups — what Canales → WhatsApp lists", () => {
    it("lists every connected number with something open, from the server's record", () => {
        const rows = [
            account("111", { signupWarnings: ["phone_registration_deferred"], signupWarningsAt: "2026-09-10T10:00:00.000Z" }),
            account("222", { signupWarnings: [] }),
            account("333", { signupWarnings: ["business_not_verified"] }),
        ];
        expect(signupWarningGroups(rows, null)).toEqual([
            { phoneNumberId: "111", warnings: ["phone_registration_deferred"], recordedAt: "2026-09-10T10:00:00.000Z" },
            { phoneNumberId: "333", warnings: ["business_not_verified"], recordedAt: null },
        ]);
    });

    it("lets this page's signup fill in only where the server did not say", () => {
        const session = { phoneNumberId: "111", warnings: ["webhook_subscription_failed"] };
        // The server has not listed the warnings (read failed): the session's stand.
        expect(signupWarningGroups([account("111")], session))
            .toEqual([{ phoneNumberId: "111", warnings: ["webhook_subscription_failed"], recordedAt: null }]);
        // The server kept its own record of the same signup: that one is read.
        expect(signupWarningGroups([account("111", { signupWarnings: [] })], session)).toEqual([]);
        // The status read has not listed the number yet: the session's are still shown.
        expect(signupWarningGroups([], session))
            .toEqual([{ phoneNumberId: "111", warnings: ["webhook_subscription_failed"], recordedAt: null }]);
    });
});

describe("the wizard's number connected before it opened", () => {
    it("carries what its signup left open into the connected state and the last screen", () => {
        expect(readExistingWhatsAppNumber(status(account("111", { signupWarnings: ["phone_registration_deferred"] }))))
            .toEqual({ phoneNumberId: "111", displayPhoneNumber: "+57 300 000 111", warnings: ["phone_registration_deferred"] });
    });

    it("adds nothing when the server did not say", () => {
        expect(readExistingWhatsAppNumber(status(account("111")))).toEqual({ phoneNumberId: "111", displayPhoneNumber: "+57 300 000 111" });
    });
});

describe("signupBlocksRepliesOn — whether \"Prueba tu agente\" can get an answer", () => {
    const group = (phoneNumberId: string, warnings: string[]) => ({ phoneNumberId, warnings, recordedAt: null });

    it("blocks only on what the connected state calls blocking", () => {
        expect(signupBlocksRepliesOn([group("111", ["phone_registration_deferred"])], "111")).toBe(true);
        expect(signupBlocksRepliesOn([group("111", ["webhook_subscription_failed"])], "111")).toBe(true);
        // A reply still goes out: unverified business, templates not synced.
        expect(signupBlocksRepliesOn([group("111", ["business_not_verified", "template_sync_failed"])], "111")).toBe(false);
        expect(signupBlocksRepliesOn([], "111")).toBe(false);
    });

    it("reads the number the card opens, not another number's warnings", () => {
        const groups = [group("222", ["phone_registration_deferred"])];
        expect(signupBlocksRepliesOn(groups, "111")).toBe(false);
        expect(signupBlocksRepliesOn(groups, "222")).toBe(true);
    });

    it("counts a signup answer that named no number, and every number when it cannot say which", () => {
        expect(signupBlocksRepliesOn([group("", ["phone_registration_deferred"])], "111")).toBe(true);
        expect(signupBlocksRepliesOn([group("222", ["webhook_subscription_failed"])], "")).toBe(true);
        expect(signupBlocksRepliesOn([group("222", ["webhook_subscription_failed"])], null)).toBe(true);
    });
});
