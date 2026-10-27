/**
 * F4300-46 (production QA 27-oct, salon tenant, images 84f88db8 and c6a5fa88): the customer asks the price of one service and
 * the reply gives another's. «qto custa a manicure e pedicure?» → «El precio de Corte y estilo es 40.000 COP»; «c'est combien la
 * manucure pédicure ?» → «Le prix de Corte y estilo est 40 000 COP». The services were in the turn's <available_services> (the
 * manicure's price is only an example); the model copied an earlier answer of the conversation instead.
 *
 * When the customer's message names exactly one service and the reply prices another service without naming the one asked
 * for, the reply is said from that service's own entry: its confirmed price, or that its price is not confirmed yet.
 */
import { formatPriceWithCurrency } from './booking-engine.service';
import { moneyMentionsIn } from './response-validator.service';

export interface OfferedService {
    name: string;
    price?: number;
    priceStatus?: string;
    currency?: string;
}

const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'en', 'the', 'of', 'and', 'with', 'do', 'da', 'dos',
    'das', 'e', 'com', 'du', 'des', 'le', 'les', 'et', 'avec', 'a', 'o', 'un', 'una', 'um', 'uma', 'une']);
// The same service said in another language: «manucure» is the manicure, «coupe» the cut, «soin» the treatment.
const ALIASES: Record<string, string> = {
    manucure: 'manicure', manicura: 'manicure', pedicura: 'pedicure', haircut: 'corte', cut: 'corte', coupe: 'corte',
    style: 'estilo', styling: 'estilo', coiffage: 'estilo', estilizado: 'estilo', colour: 'color', coloration: 'color',
    coloracao: 'color', cor: 'color', treatment: 'tratamiento', tratamento: 'tratamiento', soin: 'tratamiento', soins: 'tratamiento',
    consultation: 'consulta', consult: 'consulta', controle: 'control', controlo: 'control', checkup: 'control',
};

const fold = (text: string): string => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (text: string): string[] => fold(text).split(' ').filter(word => word.length > 1 && !STOPWORDS.has(word))
    .map(word => ALIASES[word] ?? word);

/** The text names the service: most of the words of its name, in any of the four languages. */
function names(text: string, service: OfferedService): boolean {
    const own = words(service.name);
    if (!own.length) return false;
    const said = new Set(words(text));
    return own.filter(word => said.has(word)).length / own.length >= (own.length === 1 ? 1 : 0.6);
}

const TEXTS: Record<string, { price: (name: string, amount: string) => string; pending: (name: string) => string }> = {
    es: { price: (name, amount) => `El precio de ${name} es ${amount}.`,
        pending: name => `El precio de ${name} todavía no está confirmado por el negocio. ¿Quiere que alguien del equipo se lo confirme?` },
    pt: { price: (name, amount) => `O preço de ${name} é ${amount}.`,
        pending: name => `O preço de ${name} ainda não foi confirmado pelo estabelecimento. Quer que alguém da equipe o confirme?` },
    en: { price: (name, amount) => `The price of ${name} is ${amount}.`,
        pending: name => `The price of ${name} has not been confirmed by the business yet. Would you like someone from the team to confirm it?` },
    fr: { price: (name, amount) => `Le prix de ${name} est de ${amount}.`,
        pending: name => `Le prix de ${name} n'a pas encore été confirmé par l'établissement. Voulez-vous que quelqu'un de l'équipe vous le confirme ?` },
};

/** The reply said from the service the customer asked about, when it priced another one instead; null otherwise. */
export function wrongServiceCorrection(reply: string, customerText: string, services: readonly OfferedService[] | undefined,
    lang?: string): string | null {
    const list = (services ?? []).filter(service => !!service?.name);
    if (list.length < 2 || !moneyMentionsIn(String(reply || '')).length) return null;
    const asked = list.filter(service => names(customerText, service));
    if (asked.length !== 1) return null;
    const [wanted] = asked;
    if (names(reply, wanted) || !list.some(service => service !== wanted && names(reply, service))) return null;
    const texts = TEXTS[String(lang || 'es').slice(0, 2)] ?? TEXTS.es;
    const amount = wanted.priceStatus === 'confirmed' && typeof wanted.price === 'number'
        ? formatPriceWithCurrency(String(lang || 'es'), wanted.price, wanted.currency) : '';
    return amount ? texts.price(wanted.name, amount) : texts.pending(wanted.name);
}
