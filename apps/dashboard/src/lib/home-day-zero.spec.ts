import * as fs from "fs";
import * as path from "path";
import type { WhatsAppTriageAnswerId } from "@/app/admin/channels/whatsapp/whatsapp-triage";
import type { ChannelRecommendation } from "@/app/admin/setup-wizard/connect-channels";
import {
    WHATSAPP_CHANNEL_HREF,
    channelStepDeferral,
    homeCardOwnsScreen,
    homeLeadChannel,
    setupChannelDeferral,
} from "./home-day-zero";

/**
 * The rules behind Home during day 0, as pure functions.
 *
 * `home-day-zero.a11y.spec.tsx` renders the screen; this file pins every
 * branch of the decisions it rests on, including the ones the rendered spec
 * cannot reach cheaply (a failed read, a connected account that still carries
 * an old triage answer). How `whatsappTriage` is READ is not here: Home takes
 * it from `readSetupStatusFacts`, which uses the WhatsApp screen's own reader
 * (`onboarding-guide.spec.ts`), so there is one reading and not two.
 */

const RECORDED = "2026-09-17T15:00:00.000Z";

describe("setupChannelDeferral", () => {
    const triage = (answerId: WhatsAppTriageAnswerId) => ({ answerId, recordedAt: RECORDED });

    it.each(["other_provider", "not_at_hand"] as const)("keeps the promise of '%s' and goes back to WhatsApp", (answerId) => {
        expect(setupChannelDeferral({ hasAnyChannel: false, triage: triage(answerId) }))
            .toEqual({ reason: answerId, href: WHATSAPP_CHANNEL_HREF });
    });

    it("gives the reason even when she never pressed 'Conectar después'", () => {
        // The triage lives on the WhatsApp screen, reachable without the wizard.
        expect(setupChannelDeferral({ hasAnyChannel: false, stage: "agent_reviewed", triage: triage("not_at_hand") })?.reason)
            .toBe("not_at_hand");
    });

    it.each([
        ["the deferred stage", { stage: "channel_deferred" }],
        ["the recorded 'connect later'", { channelConnectSkippedAt: RECORDED }],
        ["a skipped wizard", { setupWizardSkipped: true }],
    ])("resumes %s on the card's own destination", (_label, facts) => {
        expect(setupChannelDeferral({ hasAnyChannel: false, ...facts })).toEqual({ reason: "later", href: null });
    });

    it("does not turn an answer that opens a route into a reason", () => {
        // "Está en la app de WhatsApp Business" leads to Meta's window; it is
        // not something she left noted.
        expect(setupChannelDeferral({ hasAnyChannel: false, triage: triage("business_app") })).toBeNull();
        expect(setupChannelDeferral({ hasAnyChannel: false, stage: "channel_deferred", triage: triage("business_app") }))
            .toEqual({ reason: "later", href: null });
    });

    it("has nothing to resume once any channel is connected", () => {
        // A channel that broke later is a repair, not a deferral.
        expect(setupChannelDeferral({
            hasAnyChannel: true, stage: "channel_deferred", channelConnectSkippedAt: RECORDED, triage: triage("other_provider"),
        })).toBeNull();
    });

    it("is nothing on an account that never deferred", () => {
        expect(setupChannelDeferral({ hasAnyChannel: false, stage: "agent_reviewed" })).toBeNull();
    });
});

describe("homeLeadChannel", () => {
    const recommend = (...channels: ChannelRecommendation["channel"][]): ChannelRecommendation[] =>
        channels.map((channel) => ({ channel, why: "" }));
    const base = {
        hasAnyChannel: false as boolean | undefined,
        recommendations: recommend("instagram", "whatsapp") as ChannelRecommendation[] | undefined,
        planChannels: null as string[] | null,
        deferral: null as ReturnType<typeof setupChannelDeferral>,
    };

    it("is the recipe's first channel, as the wizard leads with it", () => {
        expect(homeLeadChannel(base)).toBe("instagram");
    });

    it("skips what the plan leaves out, as the wizard does", () => {
        expect(homeLeadChannel({ ...base, recommendations: recommend("instagram", "telegram"), planChannels: ["whatsapp", "telegram"] }))
            .toBe("telegram");
        // Nothing recommended is in the plan: WhatsApp, which no plan gates.
        expect(homeLeadChannel({ ...base, recommendations: recommend("instagram"), planChannels: [] })).toBe("whatsapp");
    });

    it("is WhatsApp with no recipe — the wizard's default order", () => {
        expect(homeLeadChannel({ ...base, recommendations: [] })).toBe("whatsapp");
    });

    it("stays on WhatsApp when her reason is about WhatsApp", () => {
        const deferral = setupChannelDeferral({ hasAnyChannel: false, triage: { answerId: "not_at_hand" } });
        expect(homeLeadChannel({ ...base, deferral })).toBe("whatsapp");
        // "Conectar después" says nothing about a channel: the recipe still leads.
        expect(homeLeadChannel({ ...base, deferral: { reason: "later", href: null } })).toBe("instagram");
    });

    it.each([
        ["an account with a channel", { hasAnyChannel: true }],
        ["an account whose channels nobody could read", { hasAnyChannel: undefined }],
        ["a recipe still being read", { recommendations: undefined }],
    ])("names nothing for %s", (_label, override) => {
        expect(homeLeadChannel({ ...base, ...override })).toBeNull();
    });
});

describe("channelStepDeferral", () => {
    const whatsappAnswer = setupChannelDeferral({ hasAnyChannel: false, triage: { answerId: "other_provider" } });
    const later = { reason: "later" as const, href: null };

    it("says a WhatsApp answer on a WhatsApp step, or on a step that names no channel", () => {
        expect(channelStepDeferral("whatsapp", whatsappAnswer)).toBe(whatsappAnswer);
        expect(channelStepDeferral(undefined, whatsappAnswer)).toBe(whatsappAnswer);
    });

    it("keeps a WhatsApp answer off a step that names another channel", () => {
        // One step, one channel: "Conecta Instagram" with a button to WhatsApp
        // would be both.
        expect(channelStepDeferral("instagram", whatsappAnswer)).toBeNull();
    });

    it("fits 'Conectar después' on any step: it names no channel", () => {
        expect(channelStepDeferral("instagram", later)).toBe(later);
        expect(channelStepDeferral("whatsapp", later)).toBe(later);
    });

    it("is nothing without a deferral", () => {
        expect(channelStepDeferral("whatsapp", null)).toBeNull();
    });
});

describe("homeCardOwnsScreen", () => {
    const base = {
        guideOwnsHome: true,
        dayZero: true,
        setupRead: "ready" as const,
        landing: "setup_card_only" as const,
        setupIncomplete: true as boolean | undefined,
    };

    it("belongs to the card during day 0 while it has something left", () => {
        expect(homeCardOwnsScreen(base)).toBe(true);
        expect(homeCardOwnsScreen({ ...base, landing: "setup_card_and_health" })).toBe(true);
    });

    it("waits for the card rather than drawing the board and pulling it back", () => {
        expect(homeCardOwnsScreen({ ...base, setupRead: "loading", landing: "unknown", setupIncomplete: undefined })).toBe(true);
        expect(homeCardOwnsScreen({ ...base, setupIncomplete: undefined })).toBe(true);
    });

    it.each([
        ["after the first real reply", { dayZero: false }],
        ["for someone without a setup of their own", { guideOwnsHome: false }],
        ["when the setup status could not be read", { setupRead: "unavailable" as const }],
        ["when the card has nothing left", { landing: "normal" as const, setupIncomplete: false }],
        ["when the card drew nothing this person may open", { setupIncomplete: false }],
    ])("gives the screen back %s", (_label, override) => {
        expect(homeCardOwnsScreen({ ...base, ...override })).toBe(false);
    });
});

describe("the day-0 screens ask with the activation facts", () => {
    const SRC = path.join(__dirname, "..");
    const read = (file: string) => fs.readFileSync(path.join(SRC, file), "utf8");

    it.each([
        "app/admin/page.tsx",
        "app/admin/agent/page.tsx",
    ])("%s gates on isOnboardingBeforeLive with the first reply and the creation date", (file) => {
        const source = read(file);
        // `day-zero-consumers.spec.ts` checks the arguments of every call; this
        // checks that these two screens still make one at all.
        expect(source).toMatch(/isOnboardingBeforeLive\(user\?\.onboardingStage,\s*\{\s*firstReplyAt:\s*user\?\.firstReplyAt,\s*createdAt:\s*user\?\.tenantCreatedAt,?\s*\}\)/);
    });

    it("Home no longer draws a second setup guide next to the card", () => {
        const source = read("app/admin/page.tsx");
        expect(source).not.toMatch(/resumeBanner|connectBanner|SHOW_CONNECT_BANNER|showResumeBanner/);
        expect(source).not.toMatch(/routerSavings|tierN|noModelUsage/);
    });

    it("Home reads the WhatsApp answer from the setup facts, not with a second reader", () => {
        const source = read("app/admin/page.tsx");
        expect(source).toMatch(/setupFacts\.whatsappTriage/);
        expect(source).not.toMatch(/readWhatsAppTriageNote|triageNote|whatsappTriage\s*:\s*readRecordedTriage/);
        expect(read("lib/home-day-zero.ts")).not.toMatch(/export function read/);
    });

    it.each(["es", "en", "pt", "fr"])("says AI usage without router or tier words in %s", (locale) => {
        const messages = JSON.parse(fs.readFileSync(path.join(SRC, "..", "messages", `${locale}.json`), "utf8"));
        const copy = JSON.stringify(messages.dashboard.aiUsage);
        expect(copy).not.toMatch(/router|tier|42/i);
        expect(messages.dashboard.routerSavings).toBeUndefined();
        expect(messages.dashboard.tierN).toBeUndefined();
    });

    it.each(["es", "en", "pt", "fr"])("has the deferral copy of the setup card in %s", (locale) => {
        const setup = JSON.parse(fs.readFileSync(path.join(SRC, "..", "messages", `${locale}.json`), "utf8")).qualityHealth.setup;
        expect(typeof setup.resume).toBe("string");
        expect(Object.keys(setup.deferred).sort()).toEqual(["later", "notAtHand", "otherProvider"]);
    });

    it("says it in Latin-American Spanish, with tú", () => {
        const es = JSON.parse(fs.readFileSync(path.join(SRC, "..", "messages", "es.json"), "utf8"));
        const copy = JSON.stringify([es.qualityHealth.setup.resume, es.qualityHealth.setup.deferred, es.dashboard.aiUsage]);
        expect(copy).not.toMatch(/\bvos\b|tenés|quedás|obtenés|probá|pegá|permití/i);
        expect(copy).not.toMatch(/borrador|versión operativa|candidato|publica|revisión|misión|piloto|webhook|token|\bAPI\b|slug/i);
    });
});
