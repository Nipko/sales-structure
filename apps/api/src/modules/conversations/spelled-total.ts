/**
 * F4300-47 (production QA 27-oct, image c3cf6985/1a719d86): a total the customer asked for was left as words. «¿cuánto pagaríamos dos
 * personas por corte y estilo?» → «El precio del servicio Corte y estilo es 40.000 COP por persona. Para dos personas, sería el doble
 * de ese valor.»; «combien coûte une demi-douzaine de plats Spark ?» → «…13 500 COP. Pour une demi-douzaine, le coût serait six fois
 * ce montant.»; the same with «o dobro desse preço», «twice that amount», in salon, tours, hotel and menu, in es/pt/en/fr.
 *
 * When the reply already said an amount and then multiplies it in words («el doble de ese valor», «six fois ce montant») by a
 * quantity the CUSTOMER asked for, the words become the total, with its working: «80.000 COP (2 × 40.000 COP)». A multiplier the
 * customer never asked for («the double room») or with no amount before it is left as it is.
 */
import { formatPriceWithCurrency } from './booking-engine.service';
import { moneyMentionsIn, quantitiesIn } from './response-validator.service';

const NUMBER_WORDS: Record<string, number> = {
    dos: 2, two: 2, dois: 2, duas: 2, deux: 2, tres: 3, 'três': 3, three: 3, trois: 3, cuatro: 4, four: 4, quatro: 4, quatre: 4,
    cinco: 5, five: 5, cinq: 5, seis: 6, six: 6, siete: 7, seven: 7, sete: 7, sept: 7, ocho: 8, eight: 8, oito: 8, huit: 8,
    nueve: 9, nine: 9, nove: 9, neuf: 9, diez: 10, ten: 10, dez: 10, dix: 10,
};
const TIMES_OF: Record<string, number> = { doble: 2, dobro: 2, double: 2, twice: 2, triple: 3, triplo: 3 };

// What the multiplier refers back to: «ese valor», «desse preço», «that amount», «ce montant», «du prix».
const BACK = String.raw`(?:(?:de|do|del|du|of)\s+)?(?:(?:ese|este|esse|este|desse|deste|dessa|that|this|the|ce|cet|le|el|o)\s+)?(?:valor|precio|preço|preco|monto|importe|montant|prix|amount|price|value)`;
// «el doble» / «o dobro» need their article (a «habitación doble» is a room), «twice», «double», «triple» and «N veces» need what
// they multiply («a double room», «I asked twice» are no totals).
const MULTIPLIER = new RegExp(String.raw`(?<!\p{L})(?:(?:el|o)\s+(doble|dobro|triplo)(?:\s+${BACK})?|(?:(?:le|the)\s+)?(twice|double|triple)\s+${BACK}|(\d{1,2}|\p{L}+)\s+(?:veces|vezes|fois|times)\s+${BACK})(?!\p{L})`, 'giu');

/** The reply with each worded multiple of an amount it said turned into the total; null when there is none to turn. */
export function spelledTotalCorrection(reply: string, customerText: string, lang?: string): string | null {
    const text = String(reply || '');
    const asked = quantitiesIn(String(customerText || ''));
    if (!asked.length) return null;
    const mentions = moneyMentionsIn(text);
    if (!mentions.length) return null;
    let changed = false;
    const out = text.replace(MULTIPLIER, (whole: string, doubled?: string, word?: string, count?: string, offset?: number) => {
        const key = String(doubled || word || count || '').toLowerCase();
        const n = TIMES_OF[key] ?? (/^\d+$/.test(key) ? Number(key) : NUMBER_WORDS[key]);
        if (!n || !asked.includes(n)) return whole;
        const before = mentions.filter(m => (m.index ?? 0) + (m.length ?? 0) <= (offset ?? 0));
        const base = before[before.length - 1];
        if (!base) return whole;
        const total = formatPriceWithCurrency(String(lang || 'es'), base.amount * n, base.currency);
        if (!total) return whole;
        changed = true;
        return `${total} (${n} × ${text.slice(base.index!, base.index! + base.length!)})`;
    });
    return changed ? out : null;
}
