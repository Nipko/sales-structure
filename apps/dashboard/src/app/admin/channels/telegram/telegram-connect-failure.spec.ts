import * as fs from "fs";
import * as path from "path";
import { META_CONNECT_ERROR } from "@parallext/shared";
import {
    TELEGRAM_CONNECT_CODES,
    TELEGRAM_PAGE_CARD_KEYS,
    TELEGRAM_PAGE_ERRORS_NAMESPACE,
    readTelegramConnectCode,
    telegramConnectFailure,
} from "./telegram-connect-failure";
import { TELEGRAM_INVALID_BOT_KEY, wizardConnectFailure } from "../../setup-wizard/connect-channels";

/**
 * A refused Telegram connection on the Telegram page is ONE card, chosen by the
 * refusal's code — never the server's sentence, which is how Telegram's own
 * "Unauthorized" used to reach the owner.
 */

const MESSAGES = path.join(__dirname, "..", "..", "..", "..", "..", "messages");
const LOCALES = ["es", "en", "pt", "fr"] as const;

/** What `apiPost` hands back for a non-2xx: the code in `errorCode`, the prose in `error`. */
function refused(code: string, prose = "Telegram no reconoce esa clave. Unauthorized"): Record<string, unknown> {
    return { success: false, httpStatus: 400, error: prose, errorCode: code };
}

describe("the Telegram page's connect failures", () => {
    it("gives every code the API refuses its own card, never with two ways forward", () => {
        expect(telegramConnectFailure(refused(TELEGRAM_INVALID_BOT_KEY))).toEqual({ key: "invalidBotKey", retryable: false });
        // After Telegram accepted the key: the same key, sent again, is the fix.
        expect(telegramConnectFailure(refused("telegram_unavailable"))).toEqual({ key: "unavailable", retryable: true });
        expect(telegramConnectFailure(refused("email_not_verified"))).toEqual({
            key: "emailNotVerified", retryable: false, href: "/verify-email", hrefLabelKey: "goToVerifyEmail",
        });
        expect(telegramConnectFailure(refused("channel_not_available"))).toEqual({
            key: "channelNotAvailable", retryable: false, href: "/admin/settings/billing", hrefLabelKey: "goToBilling",
        });
        expect(telegramConnectFailure(refused(META_CONNECT_ERROR.PLAN_LIMIT))).toEqual({
            key: "planLimit", retryable: false, href: "/admin/settings/billing", hrefLabelKey: "goToBilling",
        });
        for (const code of TELEGRAM_CONNECT_CODES) {
            const card = telegramConnectFailure(refused(code));
            // A retry and a link side by side would be two answers to one problem.
            const controls = Number(card.retryable) + Number(Boolean(card.href));
            expect({ code, atMostOne: controls <= 1 }).toEqual({ code, atMostOne: true });
        }
    });

    it("maps the codes the wizard also maps to the same card the wizard shows", () => {
        // Every code the page maps: the wizard gives each the same card, so the
        // owner never reads two different answers for the same refusal.
        for (const code of TELEGRAM_CONNECT_CODES) {
            expect({ code, card: telegramConnectFailure(refused(code)) })
                .toEqual({ code, card: wizardConnectFailure("telegram", code).failure });
        }
    });

    it("never takes the server's sentence for a code", () => {
        expect(readTelegramConnectCode({ success: false, error: "Telegram no reconoce esa clave." })).toBeNull();
        expect(telegramConnectFailure({ success: false, error: "Bad Request: Unauthorized" })).toEqual({ key: "generic", retryable: false });
        // A 200 body that says `success:false` keeps the code in `error`.
        expect(readTelegramConnectCode({ success: false, error: "telegram_unavailable" })).toBe("telegram_unavailable");
        // A network failure (`apiPost` answers "Error de conexión") and nothing at all.
        expect(telegramConnectFailure({ success: false, error: "Error de conexión" }).key).toBe("generic");
        expect(telegramConnectFailure(null).key).toBe("generic");
        expect(telegramConnectFailure(undefined).key).toBe("generic");
        // A code this page does not know is not guessed at.
        expect(telegramConnectFailure(refused("tenant_suspended")).key).toBe("generic");
    });

    it("hands out a fresh card each time, so a caller cannot edit the table", () => {
        const first = telegramConnectFailure(refused("telegram_unavailable"));
        first.retryable = false;
        expect(telegramConnectFailure(refused("telegram_unavailable")).retryable).toBe(true);
    });

    it.each(LOCALES)("carries every card and label in %s", (locale) => {
        const source = JSON.parse(fs.readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8"));
        const at = (dotted: string): unknown => dotted.split(".").reduce((node: any, part) => node?.[part], source);
        expect(TELEGRAM_PAGE_CARD_KEYS).toEqual(expect.arrayContaining(["invalidBotKey", "unavailable", "emailNotVerified", "channelNotAvailable", "planLimit", "generic"]));
        for (const key of TELEGRAM_PAGE_CARD_KEYS) {
            for (const part of ["title", "action"]) {
                const value = at(`${TELEGRAM_PAGE_ERRORS_NAMESPACE}.${key}.${part}`);
                expect({ key, part, ok: typeof value === "string" && value.trim().length > 0 }).toEqual({ key, part, ok: true });
            }
        }
        for (const label of ["retry", "goToBilling", "goToVerifyEmail"]) {
            expect(typeof at(`${TELEGRAM_PAGE_ERRORS_NAMESPACE}.${label}`)).toBe("string");
        }
    });
});
