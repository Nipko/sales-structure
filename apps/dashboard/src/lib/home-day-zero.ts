import type { OnboardingLanding } from "@parallext/shared";
import type { RecordedWhatsAppTriage } from "@/app/admin/channels/whatsapp/whatsapp-triage";
import {
    leadChannel,
    orderWizardChannels,
    type ChannelRecommendation,
    type WizardChannel,
} from "@/app/admin/setup-wizard/connect-channels";

/**
 * Home during day 0 — which surfaces may share the screen with the setup card.
 *
 * The 14-sep recording counted six things on Home before the owner had a
 * single channel: the trial notice, an indigo "Retomar" banner, the setup
 * card, an empty "Actividad reciente", "Uso de modelos" promising that "el
 * router ahorra ~42% usando Tier 3-4", and the mascot. Two of them told her to
 * connect a channel, each with its own destination. The rule here is the one
 * the design asks for: while the account is still waiting for its agent's
 * first real reply and the setup card has something left to say, the card is
 * the screen.
 *
 * Pure functions only, so the rule is pinned by tests instead of JSX.
 */

/**
 * Answers to "¿Dónde vive hoy tu número?" that end in "lo dejamos anotado".
 *
 * The other three answers open Meta's window on a route; these two leave the
 * channel for later with a reason. `other_provider` also offers the migration
 * route, so it only reads as a reason while the channel is still pending.
 */
export const DEFERRING_WHATSAPP_TRIAGE_ANSWERS = ["other_provider", "not_at_hand"] as const;
export type DeferringWhatsAppTriageAnswer = typeof DEFERRING_WHATSAPP_TRIAGE_ANSWERS[number];

export function isDeferringWhatsAppTriageAnswer(value: unknown): value is DeferringWhatsAppTriageAnswer {
    return typeof value === "string" && (DEFERRING_WHATSAPP_TRIAGE_ANSWERS as readonly string[]).includes(value);
}

/**
 * Why the channel step is waiting, as the setup card says it.
 *
 * - `other_provider` / `not_at_hand`: the owner answered the WhatsApp question
 *   and the screen promised "lo dejamos anotado". The card keeps that promise
 *   by repeating the reason, and sends her back to the WhatsApp screen, where
 *   the answer lives.
 * - `later`: "Conectar después" (or "Saltar") without a reason. The card keeps
 *   its own destination for the step.
 */
export type SetupChannelDeferral =
    | { reason: DeferringWhatsAppTriageAnswer; href: string }
    | { reason: "later"; href: null };

/** The WhatsApp screen, where the triage question is asked and remembered. */
export const WHATSAPP_CHANNEL_HREF = "/admin/channels/whatsapp";

export function setupChannelDeferral(input: {
    /**
     * Only an account with NO channel has one waiting. A channel that was
     * connected and later broke is a repair ("Revisar la autorización"), not
     * something the owner left for later, whatever she answered back then.
     */
    hasAnyChannel: boolean;
    stage?: string | null;
    channelConnectSkippedAt?: string | null;
    setupWizardSkipped?: boolean;
    /** `SetupStatusFacts.whatsappTriage`: the one reading of the answer, shared with the WhatsApp screen. */
    triage?: Pick<RecordedWhatsAppTriage, "answerId"> | null;
}): SetupChannelDeferral | null {
    if (input.hasAnyChannel) return null;
    const answer = input.triage?.answerId;
    if (isDeferringWhatsAppTriageAnswer(answer)) return { reason: answer, href: WHATSAPP_CHANNEL_HREF };
    if (input.stage === "channel_deferred" || Boolean(input.channelConnectSkippedAt) || input.setupWizardSkipped === true) {
        return { reason: "later", href: null };
    }
    return null;
}

/**
 * The channel Home asks the owner to connect first WHEN THE SERVER DID NOT
 * SAY — the one the setup wizard would lead with.
 *
 * The server's setup step names the channel itself (`channelType`, from the
 * order the wizard saved), and that is the one answer every screen reads
 * (`withLeadChannel`). This is only the fallback for a step that arrives
 * without one — the server could not count the connections — and it asks the
 * question with the same functions the wizard uses (`orderWizardChannels` +
 * `leadChannel`, over the recipe and the plan's channels) instead of a
 * second opinion.
 *
 * - `hasAnyChannel`: only an account with nothing connected has a first
 *   channel to connect. `true`, or not known, is `null`.
 * - `recommendations`: `undefined` while the recipe is being read — `null`
 *   then, so the card keeps the server's own step rather than naming one
 *   channel and swapping it for another a moment later. An empty list (no
 *   recipe, or a read that failed) is the wizard's default order: WhatsApp.
 * - `planChannels`: `null` = not known, which excludes nothing.
 * - `deferral`: an answer to the WhatsApp question is about WhatsApp. The card
 *   says her reason and sends her back to that screen, so the step it sits on
 *   must say WhatsApp too, whatever the recipe prefers.
 */
export function homeLeadChannel(input: {
    hasAnyChannel: boolean | undefined;
    recommendations: readonly ChannelRecommendation[] | undefined;
    planChannels: readonly string[] | null;
    deferral: SetupChannelDeferral | null;
}): WizardChannel | null {
    if (input.hasAnyChannel !== false || input.recommendations === undefined) return null;
    if (input.deferral?.href === WHATSAPP_CHANNEL_HREF) return "whatsapp";
    return leadChannel(orderWizardChannels(input.recommendations), input.planChannels);
}

/**
 * The deferral the card's channel step says, for the channel the step names.
 *
 * An answer to the WhatsApp question ("con otro proveedor", "no lo tengo a
 * mano") is about WhatsApp, and its "Continuar donde quedaste" opens the
 * WhatsApp screen. The step names the server's channel; when that channel is
 * another one, her answer would sit under "Conecta Instagram" with a button
 * that opens WhatsApp — one step saying two channels. So the answer is said on
 * a step that is WhatsApp (or names no channel), and otherwise stays on the
 * WhatsApp screen, where it was given and is still remembered. When the
 * wizard hears that answer it saves WhatsApp first, so the server's step says
 * WhatsApp too; this covers the answer given elsewhere. "Conectar después"
 * says nothing about a channel and fits any step.
 */
export function channelStepDeferral(
    stepChannel: string | null | undefined,
    deferral: SetupChannelDeferral | null,
): SetupChannelDeferral | null {
    if (!deferral) return null;
    if (deferral.href === WHATSAPP_CHANNEL_HREF && stepChannel && stepChannel !== "whatsapp") return null;
    return deferral;
}

/**
 * True while the setup card owns Home: day 0 and the card still has something
 * to say.
 *
 * - `guideOwnsHome`: only a tenant admin or supervisor with a tenant has a
 *   setup of their own. Anyone else keeps the ordinary Home.
 * - `dayZero`: the shared day-0 question, asked by the caller with the
 *   session's stage, first reply and creation date (never the stage alone).
 * - `setupRead`: while the setup status is in flight the panels stay hidden —
 *   drawing KPIs and pulling them back half a second later is worse than
 *   drawing them a moment late. A FAILED read gives the screen back: a day-0
 *   owner whose status request broke gets the ordinary Home, not a page with
 *   nothing but a greeting.
 * - `landing`: once the essentials are done, day 0 still belongs to the
 *   first-reply check. `normal` only gives the screen back after the server
 *   has observed that reply (which makes `dayZero` false).
 * - `setupIncomplete`: what the card itself reported. `false` = it drew
 *   nothing — every step it can show this person is done, or none of them is
 *   one this role may open (a supervisor cannot open Canales). Hiding the rest
 *   of Home then would leave a greeting over an empty page, even on a landing
 *   that still says "setup card only". `undefined` = still loading, or its
 *   read failed and it is showing its own retry: it owns the screen either way.
 */
export function homeCardOwnsScreen(input: {
    guideOwnsHome: boolean;
    dayZero: boolean;
    setupRead: "loading" | "ready" | "unavailable";
    landing: OnboardingLanding;
    setupIncomplete: boolean | undefined;
}): boolean {
    if (!input.guideOwnsHome || !input.dayZero) return false;
    if (input.setupRead === "unavailable") return false;
    if (input.setupIncomplete === false) return true;
    return input.landing !== "normal";
}
