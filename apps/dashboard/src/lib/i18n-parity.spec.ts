import * as fs from "fs";
import * as path from "path";
import { guidedTourReviewedOnlyMessageKeys } from "./guided-tours";
import { reviewedOnlyAgentReviewModeKeys } from "./agent-review-mode";

/**
 * The four locales are one file with four spellings.
 *
 * `next-intl` resolves a missing key by rendering the key path itself, so a
 * translation that never landed ships as `settings.securityPage.twoFactorDesc`
 * in the middle of a card — visible only to whoever reads the product in that
 * language, which for pt and fr is nobody on this side of the repo. The rule
 * has been in CLAUDE.md since the beginning ("every page edit MUST update all 4
 * JSON files"); until now nothing enforced it. The only parity assertion that
 * existed covered ~40 guided-tour keys out of 11k.
 *
 * Spanish is the reference because it is the market the product is written for
 * and the locale every screen is authored in. The check runs in both
 * directions: a key only in `en` is just as broken — it means a translator
 * added copy the source language cannot render, so nobody sees it either.
 */

const MESSAGES = path.join(__dirname, "..", "..", "messages");
const REFERENCE = "es";
const TRANSLATIONS = ["en", "pt", "fr"] as const;

/**
 * Keys allowed to exist in some locales and not others.
 *
 * Empty on purpose, and it should stay that way: there is no such thing as a
 * string one language needs and another does not — a locale-specific *value*
 * (a legal notice that only applies in one country, a date format) still has a
 * key in all four. If you are about to add an entry here, the honest fix is
 * almost always to add the key everywhere and translate the value. Anything
 * listed must carry a comment saying which locales it belongs to and why.
 */
const LOCALE_SPECIFIC_KEYS: readonly string[] = [];

/** How many paths a failure prints before it stops. A 9k-line dump is not a report. */
const MAX_REPORTED = 20;

/**
 * Every leaf path with the shape of its value.
 *
 * Arrays are leaves and carry their length: `help.*.tips` is rendered with
 * `t.raw()` and indexed, so a locale with three tips where Spanish has four
 * drops a tip silently rather than failing.
 */
function leaves(value: unknown, prefix: string, out: Map<string, string>): Map<string, string> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [key, child] of Object.entries(value)) {
            leaves(child, prefix ? `${prefix}.${key}` : key, out);
        }
        return out;
    }
    out.set(prefix, Array.isArray(value) ? `array[${value.length}]` : typeof value);
    return out;
}

function readLocale(locale: string): Map<string, string> {
    const file = path.join(MESSAGES, `${locale}.json`);
    return leaves(JSON.parse(fs.readFileSync(file, "utf8")), "", new Map());
}

const allowed = new Set(LOCALE_SPECIFIC_KEYS);
const reference = readLocale(REFERENCE);
const localized = new Map(TRANSLATIONS.map((locale) => [locale, readLocale(locale)] as const));

/** Bounded, and it says how much it is not showing. */
function report(paths: string[]): string[] {
    if (paths.length <= MAX_REPORTED) return paths;
    return [...paths.slice(0, MAX_REPORTED), `…and ${paths.length - MAX_REPORTED} more`];
}

describe("i18n key parity across es/en/pt/fr", () => {
    it("reads four non-trivial locale files", () => {
        // Guards the guard: a typo in the path would make every assertion below
        // compare two empty sets and pass.
        expect(reference.size).toBeGreaterThan(1000);
        for (const [locale, keys] of localized) {
            expect({ locale, size: keys.size > 1000 }).toEqual({ locale, size: true });
        }
    });

    it.each(TRANSLATIONS)("has every Spanish key in %s", (locale) => {
        const keys = localized.get(locale)!;
        const missing = [...reference.keys()].filter((key) => !keys.has(key) && !allowed.has(key));
        expect({
            locale,
            missing: report(missing),
            hint: missing.length ? `add these ${missing.length} key(s) to messages/${locale}.json` : "",
        }).toEqual({ locale, missing: [], hint: "" });
    });

    it.each(TRANSLATIONS)("has no key in %s that Spanish is missing", (locale) => {
        const keys = localized.get(locale)!;
        const extra = [...keys.keys()].filter((key) => !reference.has(key) && !allowed.has(key));
        expect({
            locale,
            extra: report(extra),
            hint: extra.length ? `add these ${extra.length} key(s) to messages/${REFERENCE}.json` : "",
        }).toEqual({ locale, extra: [], hint: "" });
    });

    it.each(TRANSLATIONS)("keeps the same value shape as Spanish in %s", (locale) => {
        const keys = localized.get(locale)!;
        const mismatched = [...reference.entries()]
            .filter(([key]) => keys.has(key) && !allowed.has(key))
            .filter(([key, kind]) => keys.get(key) !== kind)
            .map(([key, kind]) => `${key}: ${REFERENCE}=${kind} ${locale}=${keys.get(key)}`);
        expect({ locale, mismatched: report(mismatched) }).toEqual({ locale, mismatched: [] });
    });

    it.each([REFERENCE, ...TRANSLATIONS] as const)("has no blank string in %s", (locale) => {
        const keys = locale === REFERENCE ? reference : localized.get(locale as typeof TRANSLATIONS[number])!;
        const source = JSON.parse(fs.readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8"));
        // A blank value renders as nothing, which reads as a layout bug rather
        // than as missing copy — the failure mode a parity check exists to stop.
        const blank = [...keys.entries()]
            .filter(([, kind]) => kind === "string")
            .filter(([key]) => !String(key.split(".").reduce((node: any, part) => node?.[part], source) ?? "").trim())
            .map(([key]) => key);
        expect({ locale, blank: report(blank) }).toEqual({ locale, blank: [] });
    });

    it.each([REFERENCE, ...TRANSLATIONS] as const)("does not call a connected WhatsApp agent live before publication in %s", (locale) => {
        const source = JSON.parse(fs.readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8"));
        const copy = [
            source.channels.whatsapp.testAgentDesc,
            source.help.agentEditor.description,
            source.help.agentEditor.tips.join(" "),
            source.help.setupWizard.description,
        ].join("\n");
        // Changes apply immediately by default now (owner decision D1/D15,
        // sep-2026), so day-0 help must NOT teach a publication pipeline; the
        // guard that matters is the negative one: never promise that a merely
        // connected number is already answering.
        const publicationWord: Record<string, RegExp> = {
            es: /borrador|candidato|publica(?:r|ción|da)/i,
            en: /draft|candidate|publish(?:ed|ing)?|publication/i,
            pt: /rascunho|candidato|publica(?:r|ção|da)/i,
            fr: /brouillon|candidat|publi(?:er|ée|cation)/i,
        };
        expect([source.help.setupWizard.description, source.help.setupWizard.tips.join(" ")].join("\n")).not.toMatch(publicationWord[locale]);
        expect(copy).not.toMatch(/ya está activo en este número|now live on this number|já está ativo neste número|est actif sur ce numéro/i);
    });

    it.each([REFERENCE, ...TRANSLATIONS] as const)("does not resurrect retired notification or email-channel promises in %s", (locale) => {
        const source = JSON.parse(fs.readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8"));
        expect(source.emailChannel).toBeUndefined();
        expect(JSON.stringify(source.help.settingsNotifications)).not.toMatch(/email digest|resumen de email|resumo de e-mail|résumé e-mail/i);
        expect(source.help.inbox.description).not.toMatch(/e-?mail/i);
    });

    it("keeps the allow-list documented and empty unless deliberately grown", () => {
        // Not a style rule: an allow-list is how a parity check quietly stops
        // checking. If this number changes, the diff has to explain each entry.
        expect(LOCALE_SPECIFIC_KEYS).toEqual([]);
    });
});

/**
 * Day 0 speaks the owner's language — no pipeline words, no platform jargon,
 * and in Spanish, tú (audit #56).
 *
 * The 14-sep recording is an owner reading "1 bloqueo crítico", "Guarda el
 * borrador", "Pegá el token" on the screens that were supposed to get her agent
 * answering. `docs/onboarding-experience-design-2026-09.md` Appendix A lists the
 * words that do not belong outside "Avanzado"; this is that list, enforced on
 * the namespaces day 0 actually renders, in all four languages.
 *
 * What is left out is left out by the code, not by a list of exceptions:
 *  · tour copy that only the reviewed pipeline can show
 *    (`guidedTourReviewedOnlyMessageKeys`, computed from the step definitions);
 *  · mode copy only reviewed mode can show (`reviewedOnlyAgentReviewModeKeys`);
 *  · statuses and quality-bar headlines that cannot appear before the agent's
 *    first real reply (see `DAY_ZERO_BANNER` and `DAY_ZERO_STATUSES`).
 */
describe("day-0 copy: no jargon, no voseo", () => {
    /** Appendix A, per language. English "review" is left out: it is also the plain verb. */
    const FORBIDDEN: Record<string, RegExp> = {
        es: /borrador|versi[oó]n(?:es)? operativa|\bcandidat[oa]s?\b|\bpubl[ií]ca(?:r(?:l[oa]s?)?|ci[oó]n|ciones|d[oa]s?|l[oa]s?)?\b|\bpubliqu|\brevisi[oó]n|\bevaluaci[oó]n|\bmisi[oó]n|bloqueos? cr[ií]ticos?|acci[oó]n(?:es)? cr[ií]ticas?|cr[ií]ticas? o altas?|\bpiloto|\bwebhook|\btokens?\b|\bAPIs?\b|\brouter\b|\btiers?\b|\bslug|\bRAG\b|\bupsell|cross-?sell|\bsnapshot|\bchunks?\b|\btop-k\b|\bBSP\b|web_widget|\bdowntime|lead scoring|p[aá]gina de prueba/i,
        en: /\bdrafts?\b|operational version|\bcandidates?\b|\bpublish|\bpublication|\brevisions?\b|\bevaluations?\b|\bmissions?\b|critical blocks?|critical blockers?|critical actions?|critical or high|\bpilot|\bwebhook|\btokens?\b|\bAPIs?\b|\brouter\b|\btiers?\b|\bslug|\bRAG\b|\bupsell|cross-?sell|\bsnapshot|\bchunks?\b|\btop-k\b|\bBSP\b|web_widget|\bdowntime|lead scoring|test page/i,
        pt: /rascunho|vers[aã]o(?:es)? operacional|\bcandidat[oa]s?\b|\bpublica(?:r|ç[aã]o|ções|d[oa]s?)?\b|\bpublicá-l[oa]s?|\bpubliqu|\brevis[aã]o|\bavalia[cç][aã]o|\bmiss[aã]o|bloqueios? cr[ií]ticos?|a[cç](?:[aã]o|[oõ]es) cr[ií]ticas?|cr[ií]ticas? ou altas?|\bpiloto|\bwebhook|\btokens?\b|\bAPIs?\b|\brouter\b|\btiers?\b|\bslug|\bRAG\b|\bupsell|cross-?sell|\bsnapshot|\bchunks?\b|\btop-k\b|\bBSP\b|web_widget|\bdowntime|lead scoring|p[aá]gina de teste/i,
        fr: /brouillon|version op[ée]rationnelle|\bcandidat|\bpubli(?:er|[ée]e?s?|cation|ez|ons)\b|\br[ée]vision|[ée]valuation|\bmission|blocages? critiques?|actions? critiques?|critiques? ou hautes?|\bpilote|\bwebhook|\btokens?\b|\bAPIs?\b|\brouter\b|\btiers?\b|\bslug|\bRAG\b|\bupsell|cross-?sell|\bsnapshot|\bchunks?\b|\btop-k\b|\bBSP\b|web_widget|\bdowntime|lead scoring|page de test/i,
    };

    /**
     * Voseo, the way the product was actually written in it.
     *
     * Three nets. Forms that are voseo and nothing else ("podés", "tené",
     * "fijate"). Imperatives of -ir verbs that are also a first-person preterite
     * ("Permití", "Escribí") only where they open a sentence, which is where an
     * instruction goes and "ya lo permití" does not. And any word ending in an
     * accented -á after a consonant other than r: that is the -ar imperative
     * ("Probá", "Pegá", "Conectá"); the -rá words are futures ("podrá"), so the
     * -rá imperatives are in the first list instead.
     */
    const VOSEO_WORDS = "vos|sos|podés|tenés|querés|sabés|necesitás|obtenés|hacés|ponés|decís|venís|usás|pagás|conectás|elegís|escribís|recibís|mirá|borrá|configurá|registrá|comprá|cerrá|entrá|explorá|prepará|generá|compará|separá|declará|ignorá|integrá|mejorá|recuperá|filtrá|esperá|hacé|poné|tené|volvé|respondé|leé|escogé|aprendé|vendé|atendé|decí|vení|fijate|asegurate|acordate|animate|contanos|escribinos|avisanos|llamanos|probalo|probala|conectalo|conectala|pegalo|pegala|copialo|compartilo|escribile|decile|mandale|enviale|hacelo|ponelo|tocalo";
    const LETTER = "a-záéíóúüñ";
    const voseoListed = new RegExp(`(?<![${LETTER}])(?:${VOSEO_WORDS})(?![${LETTER}])`, "i");
    const voseoOpening = /(?:^|[.!?¡¿:;]\s+|["“(]\s*)(?:Permití|Escribí|Elegí|Abrí|Recibí|Subí|Compartí|Seguí|Pedí|Añadí|Imprimí|Descubrí|Definí|Reuní)(?![a-záéíóúüñ])/;
    const accentedA = new RegExp(`(?<![${LETTER}])[${LETTER}]{2,}[bcdfghjklmnñpqstvxyz]á(?![${LETTER}])`, "gi");
    const NOT_VOSEO = new Set(["está", "acá", "allá", "quizá", "mamá", "papá", "sofá", "panamá", "canadá", "bogotá", "ojalá"]);

    function voseoIn(text: string): string[] {
        const found: string[] = [];
        const listed = text.match(voseoListed);
        if (listed) found.push(listed[0]);
        const opening = text.match(voseoOpening);
        if (opening) found.push(opening[0].trim());
        for (const match of text.matchAll(accentedA)) {
            if (!NOT_VOSEO.has(match[0].toLowerCase())) found.push(match[0]);
        }
        return found;
    }

    function jargonIn(locale: string, text: string): string[] {
        const match = text.match(FORBIDDEN[locale]);
        return match ? [match[0]] : [];
    }

    /**
     * Words that only exist with their accent — the ones the Telegram page was
     * written without ("atencion", "Envia", "Voce", "Creez"). Deliberately a
     * list, not a spell checker: each entry has no unaccented twin in its
     * language, so "esta" (this), "valida" (validates), "enviara" (a
     * subjunctive), "aqui" (Portuguese) or "connecte" (French verb) are never
     * on it and never flagged. English has no accents to lose.
     */
    const UNACCENTED: Record<string, string> = {
        es: "atencion|conexion|informacion|configuracion|verificacion|automaticamente|atras|envia|seran|estara|podras|podra|tendra|recibira|respondera|tambien|despues|aqui|facil|rapido|telefono|codigo|todavia|ademas",
        pt: "voce|voces|nao|ja|proximo|proxima|conexao|sao|tambem|informacao|configuracao|verificacao|atencao|disponivel|possivel|codigo",
        fr: "creez|creer|etape|etapes|deja|recoit|reponses|repond|verifier|verifiee|generees|pret|deconnecter|chiffree|telephone|equipe|systeme|parametres",
    };
    const ACCENT_LETTER = "a-zàâäçéèêëîïôöùûüÿœæáíóúãõñ";
    function unaccentedIn(locale: string, text: string): string[] {
        const words = UNACCENTED[locale];
        if (!words) return [];
        const pattern = new RegExp(`(?<![${ACCENT_LETTER}])(?:${words})(?![${ACCENT_LETTER}])`, "gi");
        return Array.from(text.matchAll(pattern), (match) => match[0]);
    }

    /**
     * The quality bar during day 0 shows only a delivery failure over a channel
     * the owner connected: `qualityBannerContent` returns nothing else before
     * the first real reply. `bannerCritical`/`bannerAtRisk` are the headlines of
     * an account that is already live.
     */
    const DAY_ZERO_BANNER = /^qualityHealth\.(?:bannerDeliveryFailure|bannerChannelUnanswered|bannerDeliveryReason\.|bannerAgent$)/;
    /**
     * Every status except `operating_with_evidence`, which needs a sample of
     * real conversations (`resolveStatus` in agent-quality.service.ts). The
     * others can all be reached before the first reply — tests can run, fail or
     * go stale on day 0.
     */
    const DAY_ZERO_STATUSES = /^agentQuality\.statuses\.(?!operating_with_evidence\.)/;
    const DAY_ZERO_NAMESPACES: readonly RegExp[] = [
        /^setupWizard\./,
        /^channels\.whatsapp\.testAgent/,
        /^channels\.[^.]+\.errors\./,
        // The whole Telegram page: Home sends a day-0 owner there ("Conecta
        // Telegram"), and it still said "Pega el token", "copialo" and
        // "Se eliminara el webhook" while the wizard said "clave del bot".
        /^channels\.telegram\./,
        /^help\.channelsTelegram\./,
        /^guidedTours\./,
        /^agentToolNavigation\./,
        DAY_ZERO_BANNER,
        DAY_ZERO_STATUSES,
    ];
    /**
     * Owner copy that stays on screen after day 0 too, in both change modes:
     * the sidebar badge and Home's health card (`qualityHealth.*`), the
     * preparation pillar of "Salud de agentes", the agent's quality banner and
     * assessment line, and the test screen's status line. Named key by key
     * because their namespaces also hold copy only the reviewed pipeline shows.
     * Each of these said "acción crítica o alta", "bloqueo crítico" or
     * "versión operativa" to every owner, every day.
     */
    const ALWAYS_SHOWN_KEYS: readonly string[] = [
        "qualityHealth.attentionCount",
        "qualityHealth.navBadge",
        "qualityHealth.noPriorityActions",
        "agentQuality.banner.blockers",
        "agentQuality.pillars.preparation.blockers",
        "agentDraft.assessmentOperational",
        "agentDraft.testingOperational",
    ];
    const alwaysShown = new Set(ALWAYS_SHOWN_KEYS);
    const reviewedOnly = new Set([...guidedTourReviewedOnlyMessageKeys(), ...reviewedOnlyAgentReviewModeKeys()]);
    const dayZeroEntries = (locale: string): Array<[string, string]> => {
        const source = JSON.parse(fs.readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8"));
        const out: Array<[string, string]> = [];
        const walk = (node: unknown, prefix: string) => {
            if (typeof node === "string") {
                const shown = alwaysShown.has(prefix) || DAY_ZERO_NAMESPACES.some((pattern) => pattern.test(prefix));
                if (shown && !reviewedOnly.has(prefix)) out.push([prefix, node]);
            } else if (Array.isArray(node)) node.forEach((item, index) => walk(item, `${prefix}.${index}`));
            else if (node && typeof node === "object") for (const [key, child] of Object.entries(node)) walk(child, prefix ? `${prefix}.${key}` : key);
        };
        walk(source, "");
        return out;
    };

    it("catches the strings that brought this check about, and leaves plain words alone", () => {
        // Guards the guard: each of these shipped on a day-0 screen.
        expect(jargonIn("es", "Configuración incompleta · 1 bloqueo crítico")).toEqual(["bloqueo crítico"]);
        expect(jargonIn("es", "Al aplicar esta propuesta se guarda un borrador.")).toEqual(["borrador"]);
        expect(jargonIn("es", "Guarda el borrador y completa su publicación.")).toEqual(["borrador"]);
        expect(jargonIn("es", "Listo para piloto controlado")).toEqual(["piloto"]);
        expect(jargonIn("es", "Pega el token de tu bot")).toEqual(["token"]);
        expect(jargonIn("en", "Save the draft and complete publication")).toEqual(["draft"]);
        expect(jargonIn("pt", "Salve o rascunho")).toEqual(["rascunho"]);
        expect(jargonIn("fr", "Publiez la version approuvée")).toEqual(["Publiez"]);
        // The two the first version of this check missed: an enclitic is still the verb.
        expect(jargonIn("es", "Los cambios se aplican al publicarlos")).toEqual(["publicarlos"]);
        expect(jargonIn("es", "Publícalo cuando quieras")).toEqual(["Publícalo"]);
        expect(jargonIn("pt", "As mudanças valem ao publicá-las")).toEqual(["publicá-las"]);
        // The severity pair the sidebar badge and Home's health card spoke in.
        expect(jargonIn("es", "2 acciones críticas o altas abiertas")).toEqual(["acciones críticas"]);
        expect(jargonIn("es", "Sin acciones críticas o altas")).toEqual(["acciones críticas"]);
        expect(jargonIn("en", "No critical or high actions")).toEqual(["critical or high"]);
        expect(jargonIn("pt", "Sem ações críticas ou altas")).toEqual(["ações críticas"]);
        expect(jargonIn("fr", "Aucune action critique ou haute")).toEqual(["action critique"]);
        expect(voseoIn("Pegá el token de tu bot (lo obtenés de @BotFather en Telegram).")).toEqual(["obtenés", "Pegá"]);
        expect(voseoIn("Permití las ventanas emergentes para conectar Instagram.")).toEqual(["Permití"]);
        expect(voseoIn("Conectá al menos un canal; podés elegir cualquiera.")).toEqual(["podés", "Conectá"]);
        expect(voseoIn("Probá tu agente")).toEqual(["Probá"]);
        // The Telegram page, before this check covered it.
        expect(voseoIn("BotFather te enviara un token — copialo, lo necesitaras")).toEqual(["copialo"]);
        expect(jargonIn("es", "Se eliminara el webhook y dejara de recibir mensajes")).toEqual(["webhook"]);
        expect(jargonIn("en", "I already have the token")).toEqual(["token"]);
        expect(unaccentedIn("es", "Automatiza tu atencion al cliente. Envia /newbot y vuelve atras")).toEqual(["atencion", "Envia", "atras"]);
        expect(unaccentedIn("pt", "Voce encontra na mensagem. Ja tenho a chave")).toEqual(["Voce", "Ja"]);
        expect(unaccentedIn("fr", "Creez votre bot ; il est pret")).toEqual(["Creez", "pret"]);
        // …and none of these is either.
        expect(jargonIn("es", "Tu copiloto está aquí. Revisa el cambio en tu página pública")).toEqual([]);
        expect(jargonIn("en", "Accept every permission the window asks for, then review it")).toEqual([]);
        expect(jargonIn("fr", "Acceptez chaque permission ; le lien public reste actif")).toEqual([]);
        expect(voseoIn("Prueba tu agente: puedes, tienes, revisa, confirma; ya lo permití y está listo; se podrá después")).toEqual([]);
        expect(unaccentedIn("es", "Esta clave es tuya: está lista, envíala; Telegram valida la conexión aunque te la enviara ayer")).toEqual([]);
        expect(unaccentedIn("pt", "Cole aqui a chave; o bot responde automaticamente")).toEqual([]);
        expect(unaccentedIn("fr", "Telegram se connecte ; collez la clé ici")).toEqual([]);
    });

    it("reads a real slice of every day-0 namespace", () => {
        // Without this, a renamed namespace would leave the checks below
        // comparing nothing and passing.
        const keys = dayZeroEntries(REFERENCE).map(([key]) => key);
        for (const pattern of DAY_ZERO_NAMESPACES) {
            expect({ pattern: String(pattern), found: keys.some((key) => pattern.test(key)) })
                .toEqual({ pattern: String(pattern), found: true });
        }
        // Every owner key named one by one exists, and is read.
        for (const key of ALWAYS_SHOWN_KEYS) {
            expect({ key, read: keys.includes(key) }).toEqual({ key, read: true });
        }
        // The reviewed-only exemptions are real keys, and few.
        expect(reviewedOnly.size).toBeGreaterThan(0);
        expect(reviewedOnly.size).toBeLessThan(20);
    });

    it.each([REFERENCE, ...TRANSLATIONS] as const)("uses no pipeline or platform jargon on day-0 screens in %s", (locale) => {
        const offences = dayZeroEntries(locale)
            .flatMap(([key, text]) => jargonIn(locale, text).map((word) => `${key} → «${word}»`));
        expect({ locale, offences: report(offences) }).toEqual({ locale, offences: [] });
    });

    it.each(["es", "pt", "fr"] as const)("writes its accents on day-0 screens in %s", (locale) => {
        const offences = dayZeroEntries(locale)
            .flatMap(([key, text]) => unaccentedIn(locale, text).map((word) => `${key} → «${word}»`));
        expect({ locale, offences: report(offences) }).toEqual({ locale, offences: [] });
    });

    it("speaks tú, never vos, on day-0 screens", () => {
        const offences = dayZeroEntries(REFERENCE)
            .flatMap(([key, text]) => voseoIn(text).map((word) => `${key} → «${word}»`));
        expect({ offences: report(offences) }).toEqual({ offences: [] });
    });
});
