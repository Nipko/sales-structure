import { META_CONNECT_ERROR } from "@parallext/shared";
import { isRecord, type ChannelConnectFailure } from "../_components/connect-errors";
import { TELEGRAM_INVALID_BOT_KEY } from "../../setup-wizard/connect-channels";

/**
 * A refused Telegram connection on the Telegram page, turned into ONE card.
 *
 * The page used to call `api.fetch` and print whatever the server wrote — for
 * an unrecognised key, Telegram's "Unauthorized" came back through the error
 * message. `POST /channels/telegram/connect` now names what happened with a
 * code (`TELEGRAM_CONNECT_ERROR` in the API's `channel-management.controller.ts`,
 * plus the guard's and the plan checks' shared ones), and this module decides
 * what the owner does about each, the same way the wizard does
 * (`wizardConnectFailure` in `setup-wizard/connect-channels.ts`): the same
 * card keys, the same one action per card, and the same answer for every
 * code both of them map (pinned by telegram-connect-failure.spec.ts).
 * `telegram_unavailable` means Telegram was out of reach (the key was not
 * checked) or refused the bot after accepting the key: either way nothing she
 * did, and the same key again is the fix.
 *
 * The server's sentence is never read: anything that is not one of these
 * codes — including an unmapped 500's message — is `generic`.
 */

export const TELEGRAM_PAGE_ERRORS_NAMESPACE = "channels.telegram.errors";

/** Every code `POST /channels/telegram/connect` refuses with that has its own card. */
export const TELEGRAM_CONNECT_CODES = [
    TELEGRAM_INVALID_BOT_KEY,
    "telegram_unavailable",
    "email_not_verified",
    "channel_not_available",
    META_CONNECT_ERROR.PLAN_LIMIT,
] as const;

export type TelegramConnectCode = typeof TELEGRAM_CONNECT_CODES[number];

const CARD_BY_CODE: Record<TelegramConnectCode, ChannelConnectFailure> = {
    // Its one action is the line itself: copy the key again from @BotFather
    // and press "Conectar bot" on the form right above the card.
    [TELEGRAM_INVALID_BOT_KEY]: { key: "invalidBotKey", retryable: false },
    // Nothing she did: Telegram was out of reach or did not take the bot.
    // The same key, sent again, is the fix — so this is the one card with a retry.
    telegram_unavailable: { key: "unavailable", retryable: true },
    email_not_verified: { key: "emailNotVerified", retryable: false, href: "/verify-email", hrefLabelKey: "goToVerifyEmail" },
    channel_not_available: { key: "channelNotAvailable", retryable: false, href: "/admin/settings/billing", hrefLabelKey: "goToBilling" },
    [META_CONNECT_ERROR.PLAN_LIMIT]: { key: "planLimit", retryable: false, href: "/admin/settings/billing", hrefLabelKey: "goToBilling" },
};

/**
 * Not retryable: the form with the key is right there, and pressing "Conectar
 * bot" again is the retry — a second button beside it would say the key was
 * fine.
 */
const GENERIC: ChannelConnectFailure = { key: "generic", retryable: false };

/** Every card key the namespace must carry, `generic` included. */
export const TELEGRAM_PAGE_CARD_KEYS: readonly string[] = Array.from(
    new Set([...Object.values(CARD_BY_CODE).map((card) => card.key), GENERIC.key]),
);

function isTelegramConnectCode(value: unknown): value is TelegramConnectCode {
    return typeof value === "string" && (TELEGRAM_CONNECT_CODES as readonly string[]).includes(value);
}

/**
 * The code, and ONLY a code. `apiPost` puts the service's code in `errorCode`
 * for a non-2xx and the server's PROSE in `error`; membership in the list is
 * what keeps prose from being mistaken for a code.
 */
export function readTelegramConnectCode(body: unknown): TelegramConnectCode | null {
    if (!isRecord(body)) return null;
    for (const candidate of [body.errorCode, body.error, body.code]) {
        if (isTelegramConnectCode(candidate)) return candidate;
    }
    return null;
}

/** The card for a refused `api.connectTelegram` envelope. */
export function telegramConnectFailure(body: unknown): ChannelConnectFailure {
    const code = readTelegramConnectCode(body);
    return { ...(code ? CARD_BY_CODE[code] : GENERIC) };
}
