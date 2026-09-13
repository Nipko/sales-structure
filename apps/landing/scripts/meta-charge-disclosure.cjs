/**
 * ═══ THE ANSWER HAS TO BE AS WIDE AS THE QUESTION ═══════════════════════════
 *
 * `/precios` asks "are there hidden fees?" and, from 1 October 2026, the honest
 * answer names a charge that is not ours: Meta bills the tenant's OWN WhatsApp
 * Business account for what it delivers.
 *
 * The first version of that answer named ONE of those charges — the service
 * messages — and, in the same edit, deleted the catch-all sentence the answer
 * used to end with ("third-party services or optional packages are quoted
 * separately"). So the page went from a vague truth to a precise half-truth:
 * an enumerated exception that reads as exhaustive and is not. Meta also bills
 * marketing templates (every broadcast campaign), utility templates (appointment
 * reminders, attendance checks, order confirmations — charged INSIDE the 24-hour
 * window from October) and authentication templates (the portal's OTP). Those
 * rates are not a rounding error either: in the preserved cards a marketing
 * template costs several times a service message in every market we sell into.
 *
 * The validator could not notice, because it only asked whether the answer
 * MENTIONED Meta, the date and the allowance — all of which a narrower answer
 * does. A disclosure check that can be satisfied by a subset of the truth is a
 * check that will be satisfied again by the next subset.
 *
 * Hence this module: the rules live apart from the 600-line validator script so
 * `test-marketing-claim-regressions.cjs` can feed them the pre-fix copy and
 * prove they reject it, instead of the narrowing being caught by whoever
 * happens to re-read the page.
 *
 * ── WHAT IS DELIBERATELY NOT CHECKED ───────────────────────────────────────
 *
 * No per-country rate. Meta revises its cards quarterly and prices by the
 * RECIPIENT's country, so a figure on a marketing page is wrong at the next
 * revision and right for almost nobody in between. The page says the rate
 * varies by country and category and points at Meta; that is the whole of what
 * it may promise. `apps/api/src/modules/copilot/assistant-whatsapp-cost-kb.spec.ts`
 * enforces the same rule on the in-app help.
 */

/**
 * What a complete answer contains, per locale.
 *
 * Matched as concepts rather than as one blessed sentence — a rewrite in
 * different words still passes if it is still complete — but every concept is
 * required, so a rewrite that drops one does not.
 */
const DISCLOSURE_RULES = {
  es: {
    templateWord: /plantillas?/i,
    templateCategories: [/marketing/i, /utilidad/i, /autenticaci[oó]n/i],
    allowanceExcludesTemplates: /(?:no cubre|no incluye|no alcanza para|no se aplica a)[^.\n]{0,60}plantillas|plantillas[^.\n]{0,60}(?:no consumen|no entran|quedan fuera)/i,
    country: /pa[ií]s/i,
    category: /categor[ií]a/i,
    catchAll: /terceros|paquetes opcionales/i,
  },
  en: {
    templateWord: /templates?/i,
    templateCategories: [/marketing/i, /utility/i, /authentication/i],
    allowanceExcludesTemplates: /(?:does not cover|does not include|does not apply to)[^.\n]{0,60}templates|templates[^.\n]{0,60}(?:do not count|are not covered|fall outside)/i,
    country: /country/i,
    category: /categor(?:y|ies)/i,
    catchAll: /third-party|optional packages/i,
  },
  pt: {
    templateWord: /modelos?/i,
    templateCategories: [/marketing/i, /utilidade/i, /autenticaç[aã]o/i],
    allowanceExcludesTemplates: /(?:não cobre|não inclui|não se aplica a)[^.\n]{0,60}modelos|modelos[^.\n]{0,60}(?:não consomem|não entram|ficam de fora)/i,
    country: /pa[ií]s/i,
    category: /categoria/i,
    catchAll: /terceiros|pacotes opcionais/i,
  },
  fr: {
    templateWord: /mod[èe]les?/i,
    templateCategories: [/marketing/i, /utilitaires?/i, /authentification/i],
    allowanceExcludesTemplates: /(?:ne couvre pas|n['’]inclut pas|ne s['’]applique pas)[^.\n]{0,60}mod[èe]les|mod[èe]les[^.\n]{0,60}(?:ne consomment pas|ne comptent pas|restent en dehors)/i,
    country: /pays/i,
    category: /cat[ée]gorie/i,
    catchAll: /tiers|offres optionnelles/i,
  },
};

/**
 * Everything wrong with one locale's hidden-fees disclosure, as messages.
 *
 * Returned rather than thrown so the caller keeps collecting: a page with three
 * incomplete locales should report three, not the first one.
 *
 * @param {object} input
 * @param {string} input.locale         one of es|en|pt|fr — es-AR is checked as es
 * @param {string} input.label          how to name this locale in a failure
 * @param {string} input.faqA3          the "are there hidden fees?" answer
 * @param {string} input.faqA9          the "does my plan include Meta's charge?" answer
 * @param {string} input.allowanceText  the free allowance as this locale writes it
 * @param {RegExp} input.datePattern    the day the charge starts, as this locale writes it
 * @returns {string[]}
 */
function metaChargeDisclosureFailures({ locale, label, faqA3, faqA9, allowanceText, datePattern }) {
  const rules = DISCLOSURE_RULES[locale];
  if (!rules) return [`${label}: no disclosure rules written for locale ${locale}`];

  const hiddenFees = String(faqA3 || "");
  const planAnswer = String(faqA9 || "");
  const disclosure = `${hiddenFees} ${planAnswer}`;
  const problems = [];
  const must = (condition, message) => { if (!condition) problems.push(`${label}: ${message}`); };

  must(
    /\bMeta\b/.test(disclosure) && /WhatsApp Business/i.test(disclosure),
    "the pricing FAQ must say Meta charges the business's own WhatsApp Business account",
  );
  must(
    datePattern.test(disclosure),
    "the pricing FAQ must date the WhatsApp service-message charge",
  );
  must(
    planAnswer.includes(allowanceText),
    "the pricing FAQ must state the free service-message allowance per number",
  );

  // The charge is not one charge. Naming only the service messages turns the
  // answer into an enumerated exception that excludes the campaign, the
  // appointment reminder and the OTP — each of which Meta bills to the same
  // account, and the first of which costs several times a reply.
  for (const [field, text] of [["faqA3", hiddenFees], ["faqA9", planAnswer]]) {
    must(
      rules.templateWord.test(text),
      `${field} names the service messages Meta bills but not the templates it also bills`,
    );
    for (const category of rules.templateCategories) {
      must(
        category.test(text),
        `${field} must name every billed template category (missing ${category.source})`,
      );
    }
  }

  // The thousand free is the single most repeatable misreading on this page:
  // it is per number, per calendar month, and SERVICE ONLY. An answer that
  // states the allowance next to a list of billed templates, without saying
  // the allowance does not cover them, invites the reader to assume it does.
  must(
    rules.allowanceExcludesTemplates.test(planAnswer),
    "faqA9 states the free allowance without saying it does not cover templates",
  );

  // Two dimensions, not one. "Varies by country" alone hides that a marketing
  // template and a reply on the same number are priced differently.
  must(
    rules.country.test(planAnswer) && rules.category.test(planAnswer),
    "faqA9 must say the rate varies by the recipient's country AND the message category",
  );

  // The catch-all this answer used to end with. Naming one external charge
  // precisely while dropping the sentence that covered the rest reads as a
  // complete list, and it is not one.
  must(
    rules.catchAll.test(hiddenFees),
    "faqA3 must keep a catch-all for third-party services or optional packages",
  );

  return problems;
}

module.exports = { DISCLOSURE_RULES, metaChargeDisclosureFailures };
