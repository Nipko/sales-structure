import * as fs from 'fs';
import * as path from 'path';
import {
    MICROS_PER_UNIT,
    WHATSAPP_FREE_SERVICE_ALLOWANCE,
    WHATSAPP_RATE_CARDS,
} from '../billing/whatsapp-rates/whatsapp-rate-table.generated';

/**
 * ═══ WHAT PARALLLY ASSIST IS ALLOWED TO SAY ABOUT SOMEBODY ELSE'S BILL ═══
 *
 * From 1 October 2026 Meta charges the tenant's OWN WhatsApp Business account
 * per delivered service message. Parallly does not pay it, does not invoice it
 * and cannot fix it — and a business owner whose agent goes quiet that morning
 * will ask the in-app assistant first, because from the outside our product and
 * their bill look like one thing.
 *
 * `assistant-kb-contract.spec.ts` guards the SHAPE of that knowledge base: the
 * article set, the frontmatter, the routes, the release boundaries. This file
 * guards one subject inside it, because the subject has two properties the rest
 * of the help does not:
 *
 *   1. **It is four translations of one fact, and a fact translated four times
 *      rots in three of them first.** A Spanish edit that nobody mirrors leaves
 *      a French tenant reading last month's truth, and nothing about the file
 *      looks wrong. So every assertion here runs per locale, and every locale
 *      must carry the same clauses.
 *
 *   2. **It is about money the engine already computes.** The free thousand and
 *      the date it starts live in `whatsapp-rate-table.generated.ts`, derived
 *      from preserved rate cards. Help text that states them independently is
 *      a second copy that can disagree with the first, and the disagreement is
 *      invisible until a customer acts on the wrong one. So the numbers are
 *      read FROM the table here and compared, never retyped.
 *
 * ── WHY RATES ARE FORBIDDEN RATHER THAN CHECKED FOR FRESHNESS ───────────────
 *
 * Meta revises its cards quarterly and prices by the RECIPIENT's country, so a
 * rate printed in runtime help is wrong at the next revision and right for
 * almost nobody in between. The rule below is not "no numbers" though — it is
 * that any per-message figure the help does quote must exist in the table. That
 * keeps the check from being satisfied by silence: a figure contradicting the
 * card fails, and the only way to pass is to quote one the engine agrees with.
 */

const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
type Locale = (typeof LOCALES)[number];

const kbRoot = path.resolve(__dirname, '../../../kb/assistant');
const dashboardMessagesRoot = path.resolve(__dirname, '../../../../dashboard/messages');

const WHATSAPP_ARTICLE = '02-canales-whatsapp.md';
const BILLING_ARTICLE = '17-facturacion-planes.md';
const TROUBLESHOOTING_ARTICLE = '19-solucion-problemas.md';

/** Read an article with line endings normalised: the repo stores CRLF. */
function readArticle(locale: Locale, file: string): string {
    return fs.readFileSync(path.join(kbRoot, locale, file), 'utf8').replace(/\r\n/g, '\n');
}

function readDashboardMessages(locale: Locale): any {
    return JSON.parse(fs.readFileSync(path.join(dashboardMessagesRoot, `${locale}.json`), 'utf8'));
}

/**
 * The clauses a tenant's actual questions need answered, per locale.
 *
 * Each one is a sentence somebody would otherwise have to guess at, and each is
 * matched as written rather than by keyword: a paraphrase that drops "own", or
 * "per number", or "does not", changes the answer.
 */
const WHATSAPP_MARKERS: Record<Locale, Record<string, RegExp>> = {
    es: {
        /** Who charges, and that it is not us. */
        whoCharges: /Meta le cobra a \*\*tu propia cuenta de WhatsApp Business\*\*/,
        notParallly: /Ese cobro \*\*no es de Parallly\*\*/,
        separatePayments: /Cambiar de plan en Parallly no cambia lo que Meta cobra/,
        /** Where the card goes, and that we never ask for one in a conversation. */
        cardOnMeta: /El medio de pago se carga en Meta, no en Parallly/,
        neverAskInChat: /\*\*Parallly nunca te pide el número de una tarjeta por chat\*\*/,
        /** Not "degrades". Stops. */
        stopsDelivering: /\*\*deja de entregar los mensajes de servicio\*\*/,
        inboundStillArrives: /los mensajes que entran se reciben, se guardan y aparecen/,
        /** Attached is not approved. */
        attachedIsNotApproved: /\*\*Una tarjeta cargada no garantiza que el cobro se apruebe\.\*\*/,
        /** What the allowance is not. */
        notPerCountry: /\*\*No es por país\.\*\*/,
        notPerContact: /\*\*No es por contacto ni por conversación\.\*\*/,
        notTemplates: /\*\*No cubre plantillas\.\*\*/,
        noRollover: /\*\*No se acumula\.\*\*/,
        wabaTimeZone: /\*\*zona horaria de tu cuenta de WhatsApp Business\*\*/,
        /** The ceiling, and the three things it cannot promise. */
        ceilingObservesByDefault: /\*\*no frena ningún envío\*\*/,
        ceilingNotOtherTools: /\*\*No limita lo que otra herramienta le cobra a la misma cuenta\.\*\*/,
        ceilingNotEnforcedByMeta: /\*\*No es un límite que Meta aplique\.\*\*/,
        /** Coming back from a pause. */
        pausePerNumber: /pausa los envíos cobrables \*\*de ese número\*\*/,
        resumeIsAClaim: /Es tu declaración de que lo arreglaste, no una comprobación/,
    },
    en: {
        whoCharges: /Meta charges \*\*your own WhatsApp Business account\*\*/,
        notParallly: /That charge is \*\*not Parallly's\*\*/,
        separatePayments: /Changing your Parallly plan does not change what Meta charges/,
        cardOnMeta: /The payment method goes on Meta, not on Parallly/,
        neverAskInChat: /\*\*Parallly never asks for a card number in chat\*\*/,
        stopsDelivering: /\*\*stops delivering service messages\*\*/,
        inboundStillArrives: /incoming messages are still received, stored and shown/,
        attachedIsNotApproved: /\*\*A card on file does not guarantee the charge will be approved\.\*\*/,
        notPerCountry: /\*\*Not per country\.\*\*/,
        notPerContact: /\*\*Not per contact or per conversation\.\*\*/,
        notTemplates: /\*\*Not for templates\.\*\*/,
        noRollover: /\*\*Not cumulative\.\*\*/,
        wabaTimeZone: /\*\*time zone of your WhatsApp Business account\*\*/,
        ceilingObservesByDefault: /\*\*stops no message\*\*/,
        ceilingNotOtherTools: /\*\*It does not limit what another tool charges to the same account\.\*\*/,
        ceilingNotEnforcedByMeta: /\*\*It is not a limit Meta enforces\.\*\*/,
        pausePerNumber: /pauses chargeable sends \*\*for that number\*\*/,
        resumeIsAClaim: /It is your statement that you fixed it, not a verification/,
    },
    pt: {
        whoCharges: /a Meta cobra da \*\*sua própria conta do WhatsApp Business\*\*/,
        notParallly: /Essa cobrança \*\*não é da Parallly\*\*/,
        separatePayments: /Mudar de plano na Parallly não muda o que a Meta cobra/,
        cardOnMeta: /A forma de pagamento fica na Meta, não na Parallly/,
        neverAskInChat: /\*\*A Parallly nunca pede o número de um cartão por chat\*\*/,
        stopsDelivering: /\*\*deixa de entregar as mensagens de serviço\*\*/,
        inboundStillArrives: /as mensagens que chegam são recebidas, guardadas e aparecem/,
        attachedIsNotApproved: /\*\*Um cartão cadastrado não garante que a cobrança seja aprovada\.\*\*/,
        notPerCountry: /\*\*Não é por país\.\*\*/,
        notPerContact: /\*\*Não é por contato nem por conversa\.\*\*/,
        notTemplates: /\*\*Não cobre modelos\.\*\*/,
        noRollover: /\*\*Não acumula\.\*\*/,
        wabaTimeZone: /\*\*fuso horário da sua conta do WhatsApp Business\*\*/,
        ceilingObservesByDefault: /\*\*não freia nenhum envio\*\*/,
        ceilingNotOtherTools: /\*\*Não limita o que outra ferramenta cobra da mesma conta\.\*\*/,
        ceilingNotEnforcedByMeta: /\*\*Não é um limite aplicado pela Meta\.\*\*/,
        pausePerNumber: /pausa os envios cobráveis \*\*daquele número\*\*/,
        resumeIsAClaim: /É a sua declaração de que resolveu, não uma verificação/,
    },
    fr: {
        whoCharges: /Meta facture à \*\*votre propre compte WhatsApp Business\*\*/,
        notParallly: /Cette facturation \*\*n'est pas celle de Parallly\*\*/,
        separatePayments: /Changer de forfait chez Parallly ne change pas ce que Meta facture/,
        cardOnMeta: /Le moyen de paiement s'enregistre chez Meta, pas chez Parallly/,
        neverAskInChat: /\*\*Parallly ne demande jamais un numéro de carte par chat\*\*/,
        stopsDelivering: /\*\*cesse de livrer les messages de service\*\*/,
        inboundStillArrives: /les messages entrants sont toujours reçus, enregistrés et affichés/,
        attachedIsNotApproved: /\*\*Une carte enregistrée ne garantit pas que le paiement sera accepté\.\*\*/,
        notPerCountry: /\*\*Ce n'est pas par pays\.\*\*/,
        notPerContact: /\*\*Ce n'est pas par contact ni par conversation\.\*\*/,
        notTemplates: /\*\*Cela ne couvre pas les modèles\.\*\*/,
        noRollover: /\*\*Cela ne se cumule pas\.\*\*/,
        wabaTimeZone: /\*\*fuseau horaire de votre compte WhatsApp Business\*\*/,
        ceilingObservesByDefault: /\*\*n'arrête aucun envoi\*\*/,
        ceilingNotOtherTools: /\*\*Il ne limite pas ce qu'un autre outil facture au même compte\.\*\*/,
        ceilingNotEnforcedByMeta: /\*\*Ce n'est pas une limite appliquée par Meta\.\*\*/,
        pausePerNumber: /met en pause les envois facturables \*\*de ce numéro\*\*/,
        resumeIsAClaim: /C'est votre déclaration que c'est réglé, pas une vérification/,
    },
};

/**
 * Where each locale states the allowance, with the figure captured.
 *
 * Captured rather than asserted literally so the number can be compared with
 * the rate table instead of with another constant written down here — which
 * would only prove that two copies of the same mistake agree.
 */
/**
 * El separador de miles puede ser un espacio DURO (U+00A0): el francés lo usa y
 * la Base de conocimiento se escribe con él, así que la clase de caracteres
 * tiene que admitirlo.
 *
 * Va como ESCAPE y no como carácter literal por dos razones: `no-irregular-
 * whitespace` rechaza el literal —esto estaba en rojo— y, sobre todo, un U+00A0
 * literal dentro de una clase de caracteres es invisible para quien lee el
 * archivo, que es cómo se pierde media hora preguntándose qué falta.
 */
const ALLOWANCE_SENTENCE: Record<Locale, RegExp> = {
    es: /Cada \*\*número\*\* recibe \*\*([\d.,\s\u00a0]+) mensajes de servicio gratis por mes calendario\*\*/,
    en: /Every \*\*number\*\* gets \*\*([\d.,\s\u00a0]+) free service messages per calendar month\*\*/,
    pt: /Cada \*\*número\*\* recebe \*\*([\d.,\s\u00a0]+) mensagens de serviço grátis por mês civil\*\*/,
    fr: /Chaque \*\*numéro\*\* reçoit \*\*([\d.,\s\u00a0]+) messages de service gratuits par mois civil\*\*/,
};

/** The article in each locale that answers "does my plan cover this?". */
const BILLING_MARKER: Record<Locale, RegExp> = {
    es: /\*\*No paga los mensajes que WhatsApp entrega\.\*\*/,
    en: /\*\*It does not pay for the messages WhatsApp delivers\.\*\*/,
    pt: /\*\*Ela não paga as mensagens que o WhatsApp entrega\.\*\*/,
    fr: /\*\*Il ne paie pas les messages livrés par WhatsApp\.\*\*/,
};

/** The article in each locale that answers "why did my agent go quiet?". */
const TROUBLESHOOTING_MARKER: Record<Locale, RegExp> = {
    es: /Meta cobra a tu cuenta de WhatsApp Business cada mensaje de servicio entregado/,
    en: /Meta charges your WhatsApp Business account for every delivered service message/,
    pt: /a Meta cobra da sua conta do WhatsApp Business cada mensagem de serviço entregue/,
    fr: /Meta facture à votre compte WhatsApp Business chaque message de service livré/,
};

/**
 * Claims the help must never make, in any locale.
 *
 * Each is a sentence somebody would write in good faith while simplifying, and
 * each would cost a real business real money or real silence.
 */
const FORBIDDEN_CLAIMS: { label: string; pattern: RegExp }[] = [
    {
        label: 'Parallly paying or absorbing the Meta charge',
        pattern: /\b(?:a\s+)?Parallly\s+(?:paga|pays?|paie|absorbe|absorbs?|assume)\b[^.\n]{0,30}\bMeta\b/i,
    },
    {
        label: 'WhatsApp messages described as included in the plan',
        pattern: /\b(?:mensajes de servicio|service messages|mensagens de serviço|messages de service)\b[^.\n]{0,50}\b(?:incluidos en (?:el|tu) plan|included in (?:the|your) plan|inclu[íi]das no plano|inclus dans le forfait)\b/i,
    },
    {
        label: 'an attached payment method promised to work',
        pattern: /\b(?:tarjeta cargada|card on file|cartão cadastrado|carte enregistrée)\b[^.\n]{0,40}\b(?:garantiza|guarantees?|garante|garantit)\b(?!\s*(?:que el cobro se apruebe|the charge|que a cobrança|pas))/i,
    },
];

/** Every per-message price the preserved rate cards actually publish, in micros. */
const publishedRateMicros = new Set<number>();
for (const card of WHATSAPP_RATE_CARDS) {
    for (const entry of card.entries) {
        for (const value of Object.values(entry.micros)) {
            if (typeof value === 'number') publishedRateMicros.add(value);
        }
    }
}

/** The card the October regime prices against, which is what help would quote. */
const octoberUsdCard = WHATSAPP_RATE_CARDS.find(
    (card) => card.currency === 'USD'
        && card.effectiveFrom === WHATSAPP_FREE_SERVICE_ALLOWANCE.effectiveFrom,
);

/**
 * How each locale writes the markets we sell into.
 *
 * Needed because "a figure that exists SOMEWHERE in the table" is not a check:
 * 0.0009 is a real published rate for some market, so a sentence saying Colombia
 * costs 0.0009 would pass a set-membership test while being wrong by 12 %. The
 * comparison has to be against the market named beside the number.
 */
const MARKET_ALIASES: Readonly<Record<string, string>> = Object.freeze({
    Colombia: 'Colombia',
    'México': 'Mexico', Mexico: 'Mexico', 'Mexique': 'Mexico',
    Brasil: 'Brazil', Brazil: 'Brazil', 'Brésil': 'Brazil',
    Argentina: 'Argentina', Argentine: 'Argentina',
    Chile: 'Chile', Chili: 'Chile',
    'Perú': 'Peru', Peru: 'Peru', 'Pérou': 'Peru',
});

/** Per-message figures in help text, as a sub-unit price with a currency mark. */
const QUOTED_RATE = /(?:US\$|USD|COP|\$|€)\s*(0[.,]\d{3,})/g;

/**
 * Rates in this text that disagree with the card for the market beside them.
 *
 * Returns a description per offence rather than a boolean, so a failure says
 * which figure, which market and what the card actually publishes.
 */
function rateContradictions(text: string): string[] {
    const offences: string[] = [];
    for (const match of text.matchAll(QUOTED_RATE)) {
        const micros = Math.round(Number(match[1].replace(',', '.')) * MICROS_PER_UNIT);
        const index = match.index ?? 0;
        const around = text.slice(Math.max(0, index - 90), index + match[0].length + 90);
        for (const [alias, market] of Object.entries(MARKET_ALIASES)) {
            if (!around.includes(alias)) continue;
            const published = octoberUsdCard?.entries.find((entry) => entry.market === market)
                ?.micros.service;
            if (published !== micros) {
                offences.push(
                    `${match[0]} next to "${alias}": the card publishes `
                    + `${typeof published === 'number' ? published : 'no service rate'} micros, `
                    + `this says ${micros}`,
                );
            }
        }
    }
    return offences;
}

describe('Parallly Assist: what it may say about the WhatsApp charge', () => {
    const whatsapp = Object.fromEntries(
        LOCALES.map((locale) => [locale, readArticle(locale, WHATSAPP_ARTICLE)]),
    ) as Record<Locale, string>;

    it('has a non-empty rate table to compare help text against', () => {
        // Without this, every rate assertion below would pass by being vacuous.
        expect(WHATSAPP_RATE_CARDS.length).toBeGreaterThan(0);
        expect(publishedRateMicros.size).toBeGreaterThan(10);
        expect(MICROS_PER_UNIT).toBe(1_000_000);
        expect(octoberUsdCard).toBeDefined();
        // Every market the help could name must be priced on that card, or the
        // comparator would silently have nothing to compare against.
        for (const market of new Set(Object.values(MARKET_ALIASES))) {
            const entry = octoberUsdCard!.entries.find((candidate) => candidate.market === market);
            expect({ market, service: typeof entry?.micros.service })
                .toEqual({ market, service: 'number' });
        }
    });

    it.each(LOCALES)('%s answers every question a tenant actually asks about the charge', (locale) => {
        const body = whatsapp[locale];
        for (const [clause, pattern] of Object.entries(WHATSAPP_MARKERS[locale])) {
            expect({ locale, clause, found: pattern.test(body) })
                .toEqual({ locale, clause, found: true });
        }
    });

    it.each(LOCALES)('%s states the allowance the engine actually counts', (locale) => {
        const match = whatsapp[locale].match(ALLOWANCE_SENTENCE[locale]);
        expect(match).not.toBeNull();
        const stated = Number(match![1].replace(/[^\d]/g, ''));
        expect(stated).toBe(WHATSAPP_FREE_SERVICE_ALLOWANCE.deliveries);
    });

    it('keeps the documented scope of the allowance identical to the engine\'s', () => {
        // Per number, per calendar month, no rollover, service only. Every one
        // of those clauses is written out in all four articles, so a change to
        // the engine's model has to be answered in the help rather than
        // silently disagreeing with it.
        expect(WHATSAPP_FREE_SERVICE_ALLOWANCE.scope).toBe('per_phone_number_per_calendar_month');
        expect(WHATSAPP_FREE_SERVICE_ALLOWANCE.rollsOver).toBe(false);
        expect(WHATSAPP_FREE_SERVICE_ALLOWANCE.category).toBe('service');
    });

    it.each(LOCALES)('%s dates the charge from the day the engine starts charging', (locale) => {
        const [year, month, day] = WHATSAPP_FREE_SERVICE_ALLOWANCE.effectiveFrom.split('-').map(Number);
        // The help is written for an October start. Any other month means Meta
        // moved the date and four locales need rewriting on purpose, rather
        // than a stale sentence surviving a month-agnostic check.
        expect(month).toBe(10);
        const dated: Record<Locale, RegExp> = {
            es: new RegExp(`\\*\\*${day} de octubre de ${year}\\*\\*`),
            en: new RegExp(`\\*\\*${day} October ${year}\\*\\*`),
            pt: new RegExp(`\\*\\*${day}º de outubro de ${year}\\*\\*`),
            fr: new RegExp(`\\*\\*${day}er octobre ${year}\\*\\*`),
        };
        expect(dated[locale].test(whatsapp[locale])).toBe(true);
    });

    it('catches a rate that disagrees with the card for the market beside it', () => {
        // The comparator is exercised against the table itself, so this cannot
        // become a rule that passes because it never matches anything.
        const colombia = octoberUsdCard?.entries.find((entry) => entry.market === 'Colombia');
        const published = colombia?.micros.service;
        expect(typeof published).toBe('number');
        const printed = (micros: number) => `US$${(micros / MICROS_PER_UNIT).toFixed(4)}`;

        expect(rateContradictions(
            `En Colombia cada mensaje de servicio cuesta ${printed(published as number)}.`,
        )).toEqual([]);
        expect(rateContradictions(
            `En Colombia cada mensaje de servicio cuesta ${printed((published as number) + 100)}.`,
        )).toHaveLength(1);
    });

    it('quotes no per-message rate anywhere in the knowledge base', () => {
        // Scanned across the WHOLE knowledge base, not just the WhatsApp
        // article: a rate copied into troubleshooting or billing is exactly as
        // wrong and exactly as invisible. The policy is stricter than the
        // comparator on purpose — Meta revises quarterly and prices by the
        // recipient's country, so even a correct figure is a figure with an
        // expiry date and a scope no sentence here can carry.
        const quoted: string[] = [];
        const contradictions: string[] = [];
        for (const locale of LOCALES) {
            for (const file of fs.readdirSync(path.join(kbRoot, locale))) {
                if (!file.endsWith('.md')) continue;
                const raw = readArticle(locale, file);
                for (const match of raw.matchAll(QUOTED_RATE)) {
                    quoted.push(`${locale}/${file}: ${match[0]}`);
                }
                for (const offence of rateContradictions(raw)) {
                    contradictions.push(`${locale}/${file}: ${offence}`);
                }
            }
        }
        expect(contradictions).toEqual([]);
        expect(quoted).toEqual([]);
    });

    it('never makes a claim about this money that the product cannot keep', () => {
        const offences: string[] = [];
        for (const locale of LOCALES) {
            for (const file of fs.readdirSync(path.join(kbRoot, locale))) {
                if (!file.endsWith('.md')) continue;
                const raw = readArticle(locale, file);
                for (const claim of FORBIDDEN_CLAIMS) {
                    if (claim.pattern.test(raw)) offences.push(`${locale}/${file}: ${claim.label}`);
                }
            }
        }
        expect(offences).toEqual([]);
    });

    it.each(LOCALES)('%s repeats the fact where it is actually asked', (locale) => {
        // Nobody with a silent agent opens the WhatsApp article, and nobody
        // asking "does my plan cover this?" opens troubleshooting.
        expect(BILLING_MARKER[locale].test(readArticle(locale, BILLING_ARTICLE))).toBe(true);
        expect(TROUBLESHOOTING_MARKER[locale].test(readArticle(locale, TROUBLESHOOTING_ARTICLE)))
            .toBe(true);
    });

    it.each(LOCALES)('%s names the panel by the label the dashboard renders', (locale) => {
        // Help that points at a card by name is only useful while the card is
        // called that. Read from the dashboard's own messages so a rename there
        // fails here instead of sending somebody hunting for a heading that no
        // longer exists.
        const spend = readDashboardMessages(locale)?.whatsappSpend;
        expect(typeof spend?.title).toBe('string');
        expect(whatsapp[locale]).toContain(`**${spend.title}**`);
        expect(whatsapp[locale]).toContain(`**${spend.paused}**`);
        expect(whatsapp[locale]).toContain(`**${spend.resume}**`);
        expect(readArticle(locale, TROUBLESHOOTING_ARTICLE)).toContain(`**${spend.title}**`);
    });

    it('carries the same clauses in every locale, so no translation lags behind', () => {
        // The clause NAMES are the contract; the expressions differ by
        // language. A locale that loses a clause, or gains one the others do
        // not have, is a knowledge base answering four different questions.
        const clauseNames = LOCALES.map((locale) => Object.keys(WHATSAPP_MARKERS[locale]).sort());
        for (const names of clauseNames) expect(names).toEqual(clauseNames[0]);
        expect(clauseNames[0].length).toBeGreaterThanOrEqual(18);

        // And the same structure: one section with the same subsections.
        const subsectionCounts = LOCALES.map(
            (locale) => (whatsapp[locale].match(/^### /gm) || []).length,
        );
        expect(new Set(subsectionCounts).size).toBe(1);
    });
});
