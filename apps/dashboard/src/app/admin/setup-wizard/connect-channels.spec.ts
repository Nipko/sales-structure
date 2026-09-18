import * as fs from "fs";
import * as path from "path";
import { META_CONNECT_ERROR } from "@parallext/shared";
import {
    TELEGRAM_CARD_KEYS,
    TELEGRAM_ERRORS_NAMESPACE,
    TELEGRAM_INVALID_BOT_KEY,
    emailBlocksConnect,
    isChannelInPlan,
    leadChannel,
    orderWizardChannels,
    planNamesIncluding,
    readInstagramCallback,
    readMessengerConnected,
    readPlanChannels,
    readRecipeRecommendations,
    readTelegramConnected,
    wizardChannelOrderToSave,
    wizardConnectFailure,
} from "./connect-channels";

/**
 * ═══ THE CONNECT STEP OFFERS WHAT THIS BUSINESS NEEDS, AND ONLY WHAT ITS PLAN ALLOWS ═══
 *
 * The step was "Conecta WhatsApp" for every business, with the other channels
 * in a fixed order, and it let a trial owner start an Instagram connection her
 * plan was going to refuse after Meta's window. These pin the order (the
 * recipe's), the lock (the plan's), and that every failure is a card with one
 * action instead of the provider's sentence.
 */

const BEAUTY_RECIPE = {
    success: true,
    data: {
        industry: "moda_belleza",
        source: "registry",
        recipe: {
            recommendedChannels: [
                { channel: "instagram", why: { es: "En belleza casi todo empieza por Instagram.", en: "In beauty it all starts on Instagram." } },
                { channel: "whatsapp", why: { es: "WhatsApp es donde se cierra la cita." } },
            ],
        },
    },
};

describe("the recipe decides the order", () => {
    it("keeps the recipe's order and reads the reason in the panel's language", () => {
        expect(readRecipeRecommendations(BEAUTY_RECIPE, "en")).toEqual([
            { channel: "instagram", why: "In beauty it all starts on Instagram." },
            // No English reason: Spanish, rather than an empty line.
            { channel: "whatsapp", why: "WhatsApp es donde se cierra la cita." },
        ]);
        expect(orderWizardChannels(readRecipeRecommendations(BEAUTY_RECIPE, "es")))
            .toEqual(["instagram", "whatsapp", "messenger", "telegram"]);
    });

    it("drops what it cannot connect and any repeat", () => {
        const body = { data: { recipe: { recommendedChannels: [
            { channel: "web_widget", why: { es: "El enlace." } },
            { channel: "messenger", why: "Ya en su idioma." },
            { channel: "messenger", why: { es: "Repetido." } },
            { channel: "sms", why: { es: "No es un canal de conversación." } },
            "basura",
        ] } } };
        expect(readRecipeRecommendations(body, "es")).toEqual([{ channel: "messenger", why: "Ya en su idioma." }]);
    });

    it("without a recipe, WhatsApp stays first — the order the product always had", () => {
        for (const body of [null, { success: false }, { data: { recipe: null } }, { data: { industry: "salud" } }, "nope"]) {
            const recommendations = readRecipeRecommendations(body, "es");
            expect(recommendations).toEqual([]);
            expect(orderWizardChannels(recommendations)).toEqual(["whatsapp", "instagram", "messenger", "telegram"]);
        }
    });
});

describe("the plan decides what can be started", () => {
    const TRIAL = { channels: ["whatsapp"], widget: false };

    it("an unknown plan locks nothing", () => {
        expect(readPlanChannels(null)).toBeNull();
        expect(readPlanChannels({ maxAgents: 1 })).toBeNull();
        // The e2e fixture's shape, which is not the API's: still "not known".
        expect(readPlanChannels({ features: { channels: ["whatsapp"] } })).toBeNull();
        expect(isChannelInPlan("instagram", null)).toBe(true);
    });

    it("the no-card trial offers WhatsApp and locks the rest", () => {
        const channels = readPlanChannels(TRIAL);
        expect(channels).toEqual(["whatsapp"]);
        expect(isChannelInPlan("whatsapp", channels)).toBe(true);
        expect(isChannelInPlan("instagram", channels)).toBe(false);
        expect(isChannelInPlan("telegram", channels)).toBe(false);
    });

    it("never locks WhatsApp, because the API never gates it", () => {
        expect(isChannelInPlan("whatsapp", [])).toBe(true);
    });

    it("leads with the first recommendation the plan includes", () => {
        const order = orderWizardChannels(readRecipeRecommendations(BEAUTY_RECIPE, "es"));
        // A beauty salon on the trial: Instagram is recommended but locked.
        expect(leadChannel(order, ["whatsapp"])).toBe("whatsapp");
        // The same salon on a plan with Instagram.
        expect(leadChannel(order, ["whatsapp", "instagram", "messenger"])).toBe("instagram");
        expect(leadChannel(order, null)).toBe("instagram");
    });

    describe("the order the wizard saves, which every other screen reads first", () => {
        const recommendations = readRecipeRecommendations(BEAUTY_RECIPE, "es");
        const EVERY = ["whatsapp", "instagram", "messenger", "telegram"];

        it("is the step's order, only what the plan includes", () => {
            expect(wizardChannelOrderToSave({ recommendations, planChannels: EVERY }))
                .toEqual(["instagram", "whatsapp", "messenger", "telegram"]);
            expect(wizardChannelOrderToSave({ recommendations, planChannels: ["whatsapp"] })).toEqual(["whatsapp"]);
        });

        it("is nothing while the plan is not known — never the full recipe as if everything were included", () => {
            // F8: a pending or failed plan read saved Instagram first on a
            // WhatsApp-only trial.
            expect(wizardChannelOrderToSave({ recommendations, planChannels: null })).toBeUndefined();
            expect(wizardChannelOrderToSave({ recommendations: [], planChannels: null })).toBeUndefined();
        });

        it("puts first the channel she chose (F7), when the plan includes it", () => {
            expect(wizardChannelOrderToSave({ recommendations, planChannels: EVERY, first: "whatsapp" }))
                .toEqual(["whatsapp", "instagram", "messenger", "telegram"]);
            // A choice the plan excludes changes nothing.
            expect(wizardChannelOrderToSave({ recommendations, planChannels: ["whatsapp"], first: "telegram" })).toEqual(["whatsapp"]);
        });

        it("keeps WhatsApp alone when she chose it and the plan is not known: no plan leaves it out", () => {
            expect(wizardChannelOrderToSave({ recommendations, planChannels: null, first: "whatsapp" })).toEqual(["whatsapp"]);
            expect(wizardChannelOrderToSave({ recommendations, planChannels: null, first: "instagram" })).toBeUndefined();
        });
    });

    it("names the first plan in catalogue order that includes each locked channel", () => {
        const catalogue = { success: true, data: [
            { slug: "emprendedor", name: "Emprendedor", features: { channels: ["whatsapp"] } },
            { slug: "starter", name: "Starter", features: { channels: ["whatsapp", "instagram", "messenger", "email"] } },
            { slug: "pro", name: "Pro", features: { channels: ["whatsapp", "instagram", "messenger", "telegram"] } },
        ] };
        expect(planNamesIncluding(catalogue, ["instagram", "messenger", "telegram"]))
            .toEqual({ instagram: "Starter", messenger: "Starter", telegram: "Pro" });
        // Unreadable, or a channel no plan has: no name, never a guessed one.
        expect(planNamesIncluding(null, ["instagram"])).toEqual({});
        expect(planNamesIncluding({ data: [{ name: "Starter", features: {} }] }, ["telegram"])).toEqual({});
    });
});

describe("a failed connection is one card with one action", () => {
    it("reads the Instagram window's CODE, never a sentence", () => {
        expect(readInstagramCallback({ type: "ig_oauth_success" })).toEqual({ kind: "success" });
        expect(readInstagramCallback({ type: "ig_oauth_error", code: META_CONNECT_ERROR.ACCOUNT_NOT_PROFESSIONAL, message: "Meta prose" }))
            .toEqual({ kind: "error", code: META_CONNECT_ERROR.ACCOUNT_NOT_PROFESSIONAL });
        expect(readInstagramCallback({ type: "other" })).toBeNull();
        const card = wizardConnectFailure("instagram", META_CONNECT_ERROR.ACCOUNT_NOT_PROFESSIONAL);
        expect(card).toMatchObject({ namespace: "channels.instagram.errors", failure: { key: "accountNotProfessional" } });
        // What used to reach the screen as "Error de conexión".
        expect(wizardConnectFailure("instagram", null).failure.key).toBe("generic");
    });

    it("maps Messenger's typed codes the way its page does", () => {
        expect(wizardConnectFailure("messenger", META_CONNECT_ERROR.NOT_PAGE_ADMIN).failure.key).toBe("notPageAdmin");
        expect(wizardConnectFailure("messenger", "email_not_verified").failure)
            .toMatchObject({ key: "emailNotVerified", href: "/verify-email" });
        expect(wizardConnectFailure("messenger", "channel_not_available").failure)
            .toMatchObject({ key: "channelNotAvailable", href: "/admin/settings/billing" });
    });

    it("gives Telegram the same two refusals, its own card for a key Telegram refuses, and a generic one for the rest", () => {
        expect(wizardConnectFailure("telegram", "email_not_verified")).toMatchObject({
            namespace: TELEGRAM_ERRORS_NAMESPACE, failure: { key: "emailNotVerified", href: "/verify-email", retryable: false },
        });
        expect(wizardConnectFailure("telegram", "channel_not_available").failure)
            .toMatchObject({ key: "channelNotAvailable", href: "/admin/settings/billing" });
        // One action, and it is the line: back to @BotFather for the key. No
        // button beside the form that already has "Conectar".
        expect(wizardConnectFailure("telegram", TELEGRAM_INVALID_BOT_KEY))
            .toEqual({ channel: "telegram", namespace: TELEGRAM_ERRORS_NAMESPACE, failure: { key: "invalidBotKey", retryable: false } });
        // Telegram out of reach or refusing the bot: nothing she did, the same
        // key again is the fix — so this card, and only this one, retries.
        expect(wizardConnectFailure("telegram", "telegram_unavailable").failure).toEqual({ key: "unavailable", retryable: true });
        // A plan that allows no more bots is not about the key either.
        expect(wizardConnectFailure("telegram", "plan_limit_reached").failure)
            .toEqual({ key: "planLimit", retryable: false, href: "/admin/settings/billing", hrefLabelKey: "goToBilling" });
        // A code nobody mapped, or the old sentence itself: the generic card,
        // never the server's words.
        expect(wizardConnectFailure("telegram", "Token invalido — verifica").failure).toEqual({ key: "generic", retryable: false });
        expect(wizardConnectFailure("telegram", null).failure).toEqual({ key: "generic", retryable: false });
    });

    it("maps the exact code the API raises for a key Telegram refuses", () => {
        // Across the seam: `TELEGRAM_CONNECT_ERROR.INVALID_BOT_KEY` in the API.
        // A rename on one side alone would put the generic card back.
        const controller = fs.readFileSync(
            path.join(__dirname, "..", "..", "..", "..", "..", "api", "src", "modules", "channels", "channel-management.controller.ts"),
            "utf8",
        );
        expect(controller).toContain(`INVALID_BOT_KEY: '${TELEGRAM_INVALID_BOT_KEY}'`);
    });

    it("says what connected, and only builds a link from a real handle", () => {
        expect(readMessengerConnected({ success: true, data: { connected: [{ id: "1", name: " Café Luna " }] } }))
            .toEqual({ channel: "messenger", label: "Café Luna", href: null });
        expect(readTelegramConnected({ success: true, data: { botUsername: "cafe_luna_bot" } }))
            .toEqual({ channel: "telegram", label: "@cafe_luna_bot", href: "https://t.me/cafe_luna_bot" });
        expect(readTelegramConnected({ data: { botUsername: "javascript:alert(1)" } }))
            .toEqual({ channel: "telegram", label: null, href: null });
    });
});

describe("the email notice appears only when the server will refuse", () => {
    it("on an explicit false, never on a missing field, never for super_admin", () => {
        expect(emailBlocksConnect({ emailVerified: false, role: "tenant_admin" })).toBe(true);
        expect(emailBlocksConnect({ role: "tenant_admin" })).toBe(false);
        expect(emailBlocksConnect({ emailVerified: true, role: "tenant_admin" })).toBe(false);
        expect(emailBlocksConnect({ emailVerified: false, role: "super_admin" })).toBe(false);
        expect(emailBlocksConnect(null)).toBe(false);
    });
});

describe("the words of the connect step", () => {
    const MESSAGES = path.join(__dirname, "..", "..", "..", "..", "messages");
    const LOCALES = ["es", "en", "pt", "fr"] as const;
    const read = (locale: string) => JSON.parse(fs.readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8"));
    const at = (source: any, dotted: string) => dotted.split(".").reduce((node, part) => node?.[part], source);

    function copyOf(locale: string): string[] {
        const source = read(locale);
        const wizard = source.setupWizard;
        const out: string[] = [];
        const walk = (node: unknown) => {
            if (typeof node === "string") out.push(node);
            else if (node && typeof node === "object") Object.values(node).forEach(walk);
        };
        walk(wizard.steps);
        walk(wizard.connectStep);
        walk(wizard.connect.plan);
        walk(wizard.connect.emailGate);
        walk(wizard.connect.telegramErrors);
        walk(wizard.connect.connectedChannel);
        out.push(wizard.connect.telegramHint, wizard.connect.telegramPlaceholder, wizard.connect.otherChannelsHint,
            wizard.connect.orWhatsapp, source.emailVerification.sendFailed);
        return out;
    }

    // Appendix A of the experience design: words that do not belong on a day-0 surface.
    const JARGON: Record<string, RegExp> = {
        es: /\btoken\b|webhook|\bAPI\b|borrador|publica(?:r|ción)|candidat|misi[oó]n|piloto|\btier\b|\bslug\b/i,
        en: /\btoken\b|webhook|\bAPI\b|draft|publish|candidate|mission|pilot|\btier\b|\bslug\b/i,
        pt: /\btoken\b|webhook|\bAPI\b|rascunho|publica(?:r|ção)|candidat|miss[aã]o|piloto|\btier\b|\bslug\b/i,
        fr: /\btoken\b|webhook|\bAPI\b|brouillon|publi(?:er|cation)|candidat|mission|pilote|\btier\b|\bslug\b/i,
    };

    it.each(LOCALES)("has no day-0 jargon in %s", (locale) => {
        for (const line of copyOf(locale)) expect(line).not.toMatch(JARGON[locale]);
    });

    it("speaks Spanish with tú, never voseo", () => {
        const voseo = /(?:^|[^\wáéíóúñ])(?:prob|peg|revis|conect|agreg|confirm|mir|escrib|termin|permit|carg)á(?![\wáéíóúñ])|(?:^|[^\wáéíóúñ])(?:podés|tenés|querés|sabés|obtenés|elegí|escribí|permití|vos)(?![\wáéíóúñ])/i;
        expect("Pegá el token de tu bot (lo obtenés de @BotFather)").toMatch(voseo);
        expect("Permití las ventanas emergentes").toMatch(voseo);
        expect("Pega la clave y confirma tu correo").not.toMatch(voseo);
        for (const line of copyOf("es")) expect(line).not.toMatch(voseo);
    });

    it("no longer says WhatsApp is the only channel", () => {
        for (const locale of LOCALES) {
            const source = read(locale);
            expect(source.setupWizard.steps.connect).not.toMatch(/whatsapp/i);
            expect(source.setupWizard.connectStep.title).not.toMatch(/whatsapp/i);
        }
    });

    it.each(LOCALES)("does not say WhatsApp can do without the email it needs to finish, in %s", (locale) => {
        // F13: "WhatsApp no lo necesita" — but confirming the number's billing
        // time zone asks for a confirmed email (`billingZoneAccess` →
        // `verify_email`), and without the zone no reply goes out.
        const body = read(locale).setupWizard.connect.emailGate.body as string;
        expect(body).toContain("{email}");
        expect(body).not.toMatch(/no lo necesita|does not need it|não precisa disso|n'en a pas besoin/i);
        const zone = { es: /zona horaria de facturación/, en: /billing time zone/, pt: /fuso horário de cobrança/, fr: /fuseau horaire de facturation/ }[locale];
        expect(body).toMatch(zone);
    });

    it("says so in Spanish: WhatsApp connects without it, finishing it does not", () => {
        expect(read("es").setupWizard.connect.emailGate.body).toBe(
            "Te enviamos un código a {email}. WhatsApp se conecta sin él, pero para terminar de activarlo tendrás que confirmar la zona horaria de facturación de tu número, y eso también pide tu correo confirmado.",
        );
    });

    it.each(LOCALES)("calls the Telegram connection a bot, as its own page does, in %s", (locale) => {
        // F14: it said "tu contacto de Telegram"; what fails to connect is the bot.
        const source = read(locale);
        const title = at(source, `${TELEGRAM_ERRORS_NAMESPACE}.generic.title`) as string;
        expect(title).toBe(source.channels.telegram.errors.generic.title);
        expect(title).toMatch(/\bbot\b/);
        expect(title).not.toMatch(/contact/i);
    });

    it.each(LOCALES)("carries every Telegram card the mapping can produce, in %s", (locale) => {
        const source = read(locale);
        for (const key of TELEGRAM_CARD_KEYS) {
            expect(typeof at(source, `${TELEGRAM_ERRORS_NAMESPACE}.${key}.title`)).toBe("string");
            expect(typeof at(source, `${TELEGRAM_ERRORS_NAMESPACE}.${key}.action`)).toBe("string");
        }
        for (const label of ["goToBilling", "goToVerifyEmail"]) {
            expect(typeof at(source, `${TELEGRAM_ERRORS_NAMESPACE}.${label}`)).toBe("string");
        }
    });

    it.each(LOCALES)("names every channel the wizard can offer, in %s", (locale) => {
        const connect = read(locale).setupWizard.connect;
        for (const channel of ["whatsapp", "instagram", "messenger", "telegram"]) {
            expect(typeof connect[`channel_${channel}`]).toBe("string");
            if (channel !== "whatsapp") expect(typeof connect.connectedChannel.test[channel]).toBe("string");
        }
    });
});

describe("the wizard's help strip says what the test chat costs", () => {
    const MESSAGES = path.join(__dirname, "..", "..", "..", "..", "messages");
    const tips = (locale: string): string[] =>
        JSON.parse(fs.readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8")).help.setupWizard.tips;

    it.each(["es", "en", "pt", "fr"] as const)("never promises a free test, and says each reply counts, in %s", (locale) => {
        // F16: "sin gastar mensajes" was false — every test reply counts
        // against the plan's AI messages (`setupWizard.test.quotaReached`
        // is what she reads when they run out).
        const all = tips(locale).join(" ");
        expect(all).not.toMatch(/sin gastar|without spending|sem gastar|sans dépenser/i);
        const counts = { es: /cuenta para los mensajes de IA de tu plan/, en: /counts toward your plan's AI messages/,
            pt: /conta para as mensagens de IA do seu plano/, fr: /compte dans les messages IA de votre forfait/ }[locale];
        expect(all).toMatch(counts);
    });

    it("keeps what IS true: the test makes no bookings", () => {
        expect(tips("es")[1]).toBe(
            "Pruébalo en el chat antes de conectar nada: así ves cómo responde a un cliente real. La prueba no crea reservas ni hace cambios de verdad, pero cada respuesta cuenta para los mensajes de IA de tu plan.",
        );
    });
});
