/**
 * F4300-50 (production QA 28-oct, menu tenant, image 53aad919): «con 30.000 pesos, ¿me alcanza para dos platos Spark?» →
 * «Con 30.000 pesos no le alcanza para dos platos Spark, ya que cada uno cuesta 13.500 COP, y dos suman 27.000 COP» (es) and
 * «vous n'avez pas assez… deux totalisent 27 000 COP» (fr): the total was right and the verdict said the opposite.
 *
 * When the customer says an amount and asks whether it is enough, and the reply says a total and a verdict, the verdict is the
 * one the figures give: the sentence with the wrong verdict is said again from the budget and the total.
 */
import { formatPriceWithCurrency } from './booking-engine.service';
import { customerAmountsIn, moneyMentionsIn } from './response-validator.service';

const ASKS_ENOUGH = /(?<!\p{L})(?:alcanza|alcanzan|alcanzaria|me da para|da para|dá para|daria para|é suficiente|e suficiente|es suficiente|basta|enough|afford|can i get|suffit|suffisent|assez|puis-je prendre)(?!\p{L})/iu;
const SAYS_NOT = /(?<!\p{L})(?:no (?:le |te |les )?(?:alcanza|alcanzan|es suficiente|basta)|n[aã]o (?:d[aá]|chega|é suficiente|e suficiente|basta)|not enough|isn['’]?t enough|is not enough|can(?:not|['’]t) afford|won['’]?t cover|does(?: not|n['’]t) cover|(?:n['’]avez|n['’]a|n['’]ai) pas assez|pas assez|ne suffit pas|ne suffisent pas|insuficiente|insufficient)(?!\p{L})/iu;
const SAYS_YES = /(?<!\p{L})(?:s[ií],? (?:le |te )?(?:alcanza|da)|(?:le|te|les) alcanza|s[ií]m,? d[aá]|d[aá] sim|yes,? (?:it['’]?s|that['’]?s|you can)|is enough|it covers|covers it|oui,? (?:c['’]est|ça) (?:assez|suffit)|suffit|vous avez assez)(?!\p{L})/iu;

const TEXTS: Record<string, { enough: (budget: string, total: string, left: string) => string; short: (budget: string, total: string, missing: string) => string }> = {
    es: { enough: (b, t, l) => `Sí, con ${b} le alcanza: el total es ${t} y le sobran ${l}.`,
        short: (b, t, m) => `No, con ${b} no le alcanza: el total es ${t} y le faltan ${m}.` },
    pt: { enough: (b, t, l) => `Sim, com ${b} dá: o total é ${t} e sobram ${l}.`,
        short: (b, t, m) => `Não, com ${b} não dá: o total é ${t} e faltam ${m}.` },
    en: { enough: (b, t, l) => `Yes, ${b} is enough: the total is ${t}, leaving ${l}.`,
        short: (b, t, m) => `No, ${b} is not enough: the total is ${t}, ${m} short.` },
    fr: { enough: (b, t, l) => `Oui, avec ${b} c’est suffisant : le total est de ${t} et il vous reste ${l}.`,
        short: (b, t, m) => `Non, avec ${b} ce n’est pas suffisant : le total est de ${t} et il manque ${m}.` },
};

/** The reply with its enough / not-enough verdict said from the figures when it contradicts them; null otherwise. */
export function budgetVerdictCorrection(reply: string, customerText: string, lang?: string): string | null {
    const text = String(reply || '');
    const asked = String(customerText || '');
    if (!ASKS_ENOUGH.test(asked)) return null;
    // One amount said (the same figure may be read twice: «30.000 pesos» with and without its currency).
    const budgets = [...new Set(customerAmountsIn(asked).map(m => m.amount))];
    if (budgets.length !== 1) return null;
    const [budget] = budgets;
    // The total: the largest amount the reply says that is not the budget itself.
    const totals = moneyMentionsIn(text).filter(m => Math.abs(m.amount - budget) > 1);
    if (!totals.length) return null;
    const total = totals.reduce((a, b) => (b.amount > a.amount ? b : a));
    const says = SAYS_NOT.test(text) ? 'not' : SAYS_YES.test(text) ? 'yes' : null;
    if (!says) return null;
    const enough = total.amount <= budget;
    if ((says === 'yes') === enough) return null;
    const language = String(lang || 'es').slice(0, 2);
    const say = TEXTS[language] ?? TEXTS.es;
    const money = (amount: number) => formatPriceWithCurrency(language, amount, total.currency);
    const fixed = enough ? say.enough(money(budget), money(total.amount), money(budget - total.amount))
        : say.short(money(budget), money(total.amount), money(total.amount - budget));
    if (!fixed) return null;
    // The sentence that holds the wrong verdict is replaced; the rest of the reply (a closing question) stays.
    const verdict = says === 'not' ? SAYS_NOT : SAYS_YES;
    const sentences = text.split(/(?<=[.!?])\s+(?=\p{Lu}|¿|¡)/u);
    const at = sentences.findIndex(sentence => verdict.test(sentence));
    if (at < 0) return null;
    sentences[at] = fixed;
    return sentences.join(' ');
}
