/**
 * ═══ WHICH CHANNEL THE WIZARD OFFERS FIRST, AND WHICH IT MAY OFFER AT ALL ═══
 *
 * The connect step used to be "Conecta WhatsApp" with Instagram, Messenger and
 * Telegram underneath in a fixed order, whatever the business. Two things were
 * wrong with that, and both are decided here, as pure functions pinned by
 * tests instead of JSX:
 *
 * - ORDER. The business recipe already says where this kind of business is
 *   written to, and why (`recipe.recommendedChannels`). A beauty salon starts on
 *   Instagram; a clinic on WhatsApp. The wizard follows the recipe and shows
 *   the first recommendation's reason. No recipe, no reordering: WhatsApp stays
 *   first, which is what the product did before and the safe default.
 *
 * - THE PLAN. The default no-card trial includes WhatsApp only, and the wizard
 *   still offered all five — the owner learned "este canal no está en tu plan"
 *   AFTER Meta's window. The plan's own channel list is read BEFORE any window,
 *   and a channel outside it is shown as "incluido desde {plan}" instead of as
 *   a button that leads to a refusal. WhatsApp is never gated here because the
 *   API never gates it either (`assertChannelAllowed` is not on its path): a
 *   lock the server does not enforce would be a lie in the other direction.
 *
 * Unknown is never "no": a plan that could not be read, or a recipe that did
 * not come back, blocks nothing and reorders nothing.
 */

import {
    connectFailureForCode,
    isRecord,
    type ChannelConnectFailure,
} from "../channels/_components/connect-errors";

/** The channels the wizard can connect, in the order used when nothing says otherwise. */
export const WIZARD_CHANNELS = ["whatsapp", "instagram", "messenger", "telegram"] as const;

export type WizardChannel = typeof WIZARD_CHANNELS[number];

/** The ones connected from `SecondaryChannels`; WhatsApp has its own panel. */
export type SecondaryChannel = Exclude<WizardChannel, "whatsapp">;

export function isWizardChannel(value: unknown): value is WizardChannel {
    return typeof value === "string" && (WIZARD_CHANNELS as readonly string[]).includes(value);
}

export function isSecondaryChannel(value: unknown): value is SecondaryChannel {
    return isWizardChannel(value) && value !== "whatsapp";
}

/** One line of the recipe, already in the panel's language. */
export interface ChannelRecommendation {
    channel: WizardChannel;
    /** Why this business should start there. Empty when the recipe gave no reason. */
    why: string;
}

function localized(value: unknown, locale: string): string {
    if (typeof value === "string") return value.trim();
    if (!isRecord(value)) return "";
    const base = locale.split("-")[0];
    for (const candidate of [value[base], value.es, ...Object.values(value)]) {
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    return "";
}

/**
 * `GET /verticals/:tenantId/recipe` → the recommendations the wizard can act on.
 *
 * Accepts the envelope (`{success, data: {recipe}}`) or the bare data. Keeps
 * the recipe's order, drops what the wizard cannot connect (the public link is
 * not a connection: it exists from day 0 and is offered on its own) and any
 * repeat. Anything unreadable is an empty list — the default order.
 */
export function readRecipeRecommendations(body: unknown, locale: string): ChannelRecommendation[] {
    if (!isRecord(body)) return [];
    const data = isRecord(body.data) ? body.data : body;
    const recipe = isRecord(data.recipe) ? data.recipe : null;
    const hints = recipe && Array.isArray(recipe.recommendedChannels) ? recipe.recommendedChannels : [];
    const seen = new Set<WizardChannel>();
    const out: ChannelRecommendation[] = [];
    for (const hint of hints) {
        if (!isRecord(hint) || !isWizardChannel(hint.channel) || seen.has(hint.channel)) continue;
        seen.add(hint.channel);
        out.push({ channel: hint.channel, why: localized(hint.why, locale) });
    }
    return out;
}

/** The recipe's channels first, in its order; then every other one in the default order. */
export function orderWizardChannels(recommendations: readonly ChannelRecommendation[]): WizardChannel[] {
    const first = recommendations.map((item) => item.channel);
    return [...first, ...WIZARD_CHANNELS.filter((channel) => !first.includes(channel))];
}

/**
 * The plan's channel allow-list, from the plan features the session already
 * holds (`AuthContext.planFeatures`). `null` = not known, and not known blocks
 * nothing: the server enforces the plan anyway, and hiding a channel because
 * one read failed is worse than a refusal after the click.
 */
export function readPlanChannels(planFeatures: unknown): string[] | null {
    if (!isRecord(planFeatures) || !Array.isArray(planFeatures.channels)) return null;
    return planFeatures.channels.filter((item): item is string => typeof item === "string");
}

/** Whether connecting this channel will get past the plan check on the server. */
export function isChannelInPlan(channel: WizardChannel, planChannels: readonly string[] | null): boolean {
    if (channel === "whatsapp" || planChannels === null) return true;
    return planChannels.includes(channel);
}

/**
 * The channel the step leads with: the first one, in order, that the plan lets
 * the owner connect. A recommendation the plan excludes stays in the list —
 * locked, saying from which plan — but it does not get the big panel.
 */
export function leadChannel(order: readonly WizardChannel[], planChannels: readonly string[] | null): WizardChannel {
    return order.find((channel) => isChannelInPlan(channel, planChannels)) ?? "whatsapp";
}

/**
 * The channel order the wizard saves (`selectedChannels` → the server's
 * `setupWizardChannels`), or `undefined` for "leave it out".
 *
 * The server reads its FIRST channel as the one to connect first: the setup
 * step on Inicio, "Salud de agentes" and Assist all name it. So:
 *
 * - the plan's channels must be KNOWN. "Unknown blocks nothing" is right for
 *   what the step shows — a refusal after the click is better than hiding a
 *   channel over a failed read — but wrong for what is kept: with the plan
 *   not read yet (or not readable), the full recipe order put Instagram first
 *   on a WhatsApp-only trial, and every other screen then asked her to
 *   connect a channel her plan does not include. Unknown saves nothing, and
 *   the server keeps what it had.
 * - `first` is the channel she chose (WhatsApp, when she answered its
 *   question and left it for later). It goes first when the plan includes it.
 *   WhatsApp is the one channel no plan leaves out (the API never gates it),
 *   so it can be saved alone even while the plan is unknown — it is the only
 *   thing known to be true then.
 */
export function wizardChannelOrderToSave(input: {
    recommendations: readonly ChannelRecommendation[];
    planChannels: readonly string[] | null;
    first?: WizardChannel | null;
}): WizardChannel[] | undefined {
    const first = input.first ?? null;
    if (input.planChannels === null) return first === "whatsapp" ? ["whatsapp"] : undefined;
    const offered = orderWizardChannels(input.recommendations)
        .filter((channel) => isChannelInPlan(channel, input.planChannels));
    if (!first || !offered.includes(first)) return offered;
    return [first, ...offered.filter((channel) => channel !== first)];
}

/**
 * The plan each locked channel is included from, by name, from the tenant-facing
 * catalogue (`GET /billing/plans`, already in catalogue order).
 *
 * Names come from the runtime catalogue on purpose: which plan includes what is
 * a commercial decision the owner of the business edits from the super-admin
 * panel, and a name typed here would go stale the day that changes. A channel
 * no plan includes has no entry, and the screen then says only that it is not
 * in the current plan.
 */
export function planNamesIncluding(
    catalogue: unknown,
    channels: readonly SecondaryChannel[],
): Partial<Record<SecondaryChannel, string>> {
    const body = isRecord(catalogue) ? catalogue : null;
    const plans = Array.isArray(body?.data) ? body.data : Array.isArray(catalogue) ? catalogue : [];
    const names: Partial<Record<SecondaryChannel, string>> = {};
    for (const channel of channels) {
        for (const plan of plans) {
            if (!isRecord(plan) || !isRecord(plan.features) || !Array.isArray(plan.features.channels)) continue;
            const name = typeof plan.name === "string" ? plan.name.trim() : "";
            if (name && plan.features.channels.includes(channel)) { names[channel] = name; break; }
        }
    }
    return names;
}

/**
 * A failed connection from the wizard: which copy to read and what the one
 * action is.
 *
 * Instagram and Messenger use exactly the cards their own pages use
 * (`connect-errors.ts`). Telegram has no page-level card set, so the wizard
 * carries its own under `setupWizard.connect.telegramErrors`, with the same
 * anatomy and the same two refusals the API raises before Telegram is called
 * (an unconfirmed email and a plan that does not include it) plus the ones it
 * raises after: a key Telegram does not accept (`invalid_bot_key`), which
 * sends her back to @BotFather for the key; Telegram out of reach or refusing
 * the connection (`telegram_unavailable`), where the same key sent again is
 * the fix — the one card with a retry; and a plan that allows no more bots
 * (`plan_limit_reached`). Both of those used to fall into `generic`, which
 * told her to check the key she pasted: the wrong instruction for both.
 * Everything else — including Telegram's own prose — becomes `generic`.
 */
export interface WizardConnectFailure {
    channel: SecondaryChannel;
    /** i18n namespace the card reads `.title` / `.action` / labels from. */
    namespace: string;
    failure: ChannelConnectFailure;
}

export const TELEGRAM_ERRORS_NAMESPACE = "setupWizard.connect.telegramErrors";

/** Every card key the Telegram namespace must carry, `generic` included. */
export const TELEGRAM_CARD_KEYS = ["channelNotAvailable", "emailNotVerified", "invalidBotKey", "unavailable", "planLimit", "generic"] as const;

/**
 * `TELEGRAM_CONNECT_ERROR.INVALID_BOT_KEY` in the API's
 * `channel-management.controller.ts`, raised when Telegram's `getMe` refuses
 * the key. Pinned on both sides.
 */
export const TELEGRAM_INVALID_BOT_KEY = "invalid_bot_key";

export function wizardConnectFailure(
    channel: SecondaryChannel,
    code: unknown,
    serverRetryable: boolean | null = null,
): WizardConnectFailure {
    if (channel === "instagram" || channel === "messenger") {
        return { channel, namespace: `channels.${channel}.errors`, failure: connectFailureForCode(channel, code, serverRetryable) };
    }
    if (code === "email_not_verified") {
        return {
            channel,
            namespace: TELEGRAM_ERRORS_NAMESPACE,
            failure: { key: "emailNotVerified", retryable: false, href: "/verify-email", hrefLabelKey: "goToVerifyEmail" },
        };
    }
    if (code === "channel_not_available") {
        return {
            channel,
            namespace: TELEGRAM_ERRORS_NAMESPACE,
            failure: { key: "channelNotAvailable", retryable: false, href: "/admin/settings/billing", hrefLabelKey: "goToBilling" },
        };
    }
    if (code === TELEGRAM_INVALID_BOT_KEY) {
        // Its one action is the line itself: go back to @BotFather, copy the
        // key again, and press "Conectar" on the form right below the card.
        return { channel, namespace: TELEGRAM_ERRORS_NAMESPACE, failure: { key: "invalidBotKey", retryable: false } };
    }
    if (code === "telegram_unavailable") {
        // Nothing she did: Telegram was out of reach (the key was not
        // checked) or refused to route the bot (after accepting the key).
        // The same key, sent again, is the fix.
        return { channel, namespace: TELEGRAM_ERRORS_NAMESPACE, failure: { key: "unavailable", retryable: true } };
    }
    if (code === "plan_limit_reached") {
        return {
            channel,
            namespace: TELEGRAM_ERRORS_NAMESPACE,
            failure: { key: "planLimit", retryable: false, href: "/admin/settings/billing", hrefLabelKey: "goToBilling" },
        };
    }
    // Not retryable: the form with the key is right there, and pressing
    // "Conectar" with the same key is the retry — a second button beside it
    // would say the key was fine.
    return { channel, namespace: TELEGRAM_ERRORS_NAMESPACE, failure: { key: "generic", retryable: false } };
}

/**
 * What the Instagram callback window posts, read the way it is sent today:
 * `{type: 'ig_oauth_error', code}`. `message` is not read on purpose — it was
 * the provider's sentence, and this wave exists so that it never reaches the
 * screen.
 */
export function readInstagramCallback(data: unknown): { kind: "success" } | { kind: "error"; code: unknown } | null {
    if (!isRecord(data)) return null;
    if (data.type === "ig_oauth_success") return { kind: "success" };
    if (data.type === "ig_oauth_error") return { kind: "error", code: data.code ?? null };
    return null;
}

/**
 * What a successful Messenger or Telegram connection says about itself: the
 * page name, or the bot's handle and the link that opens it. Instagram's
 * window reports only that it succeeded.
 */
export interface ConnectedChannelDetails {
    channel: SecondaryChannel;
    /** "Café Luna" (a Facebook page) or "@cafe_luna_bot" (Telegram). */
    label: string | null;
    /** Where to write to it right now, when there is such a place. */
    href: string | null;
}

export function readMessengerConnected(body: unknown): ConnectedChannelDetails {
    const data = isRecord(body) && isRecord(body.data) ? body.data : null;
    const first = Array.isArray(data?.connected) ? data.connected.find(isRecord) : null;
    const name = first && typeof first.name === "string" && first.name.trim() ? first.name.trim() : null;
    return { channel: "messenger", label: name, href: null };
}

export function readTelegramConnected(body: unknown): ConnectedChannelDetails {
    const data = isRecord(body) && isRecord(body.data) ? body.data : null;
    const raw = data && typeof data.botUsername === "string" ? data.botUsername.trim().replace(/^@/, "") : "";
    // A Telegram username is letters, digits and underscores; anything else is
    // not put into a link.
    const username = /^[A-Za-z0-9_]{3,64}$/.test(raw) ? raw : "";
    return {
        channel: "telegram",
        label: username ? `@${username}` : null,
        href: username ? `https://t.me/${username}` : null,
    };
}

/**
 * Whether the connects that need a confirmed email will be refused.
 *
 * Instagram, Messenger and Telegram carry `@RequiresVerifiedEmail` on the API;
 * the WhatsApp signup does not. Same rule as the email banner: only an explicit
 * `false` counts — a session stored before the field travelled says nothing,
 * and a notice raised on a missing field is worse than none. super_admin
 * passes the guard, so it is never told to verify.
 */
export function emailBlocksConnect(user: { emailVerified?: boolean; role?: string } | null | undefined): boolean {
    if (!user || user.role === "super_admin") return false;
    return user.emailVerified === false;
}
