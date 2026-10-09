import { normalizeForIntent } from '@parallext/shared';
import { explicitDates } from './date-reference';

/**
 * Two things a customer of a catalogue business (travel packages, property listings) is owed BEFORE any question back, which the model
 * sometimes answers the other way round (seen on the 9 October regression):
 *
 *  1. «¿Qué paquetes tienen para el 3 de julio de 2026?» (a departure that already passed): say so first. The model asked «¿para
 *     cuántas personas y qué destino?» or offered the team, as if the date were fine. The tool reports `departure_in_past`, but only
 *     when the model calls it; here the date itself is read.
 *  2. «¿Qué paquetes de viaje tienen?» when the business has published nothing: say so first, not «¿a qué destino?».
 *
 * Both are pure checks on the customer's message and the reply; the caller decides whether to apply them (tool availability, and for
 * the second one the catalogue probe) and the reply is replaced only when it does NOT already say what is owed.
 */

type Lang = 'es' | 'en' | 'pt' | 'fr';
const langOf = (language?: string): Lang => (['es', 'en', 'pt', 'fr'].includes(String(language).slice(0, 2).toLowerCase())
    ? String(language).slice(0, 2).toLowerCase() : 'es') as Lang;
const LOCALES: Record<Lang, string> = { es: 'es-CO', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR' };

export type CatalogDomain = 'packages' | 'listings';

const DEPARTURE_CUE = /\b(?:paquete|paquetes|tour|tours|viaje|viajes|viajar|salir|salida|salimos|salgo|ir a|queremos ir|quiero ir|disponib\w*|cupos?|reserv\w*|package|packages|trip|travel|depart\w*|leave|leaving|go to|voyage|partir|depart|pacote|pacotes|viagem|sair)\b/;
/** The date is about something that already happened or exists, not a trip to be sold. */
const NOT_A_DEPARTURE = /\b(?:mi reserva|mi viaje|mi compra|ya viaje|viaje el|fue el|my booking|my trip|i travelled|i traveled)\b/;

const DOMAIN_CUES: Record<CatalogDomain, RegExp> = {
    packages: /\b(?:paquete|paquetes|tour|tours|viaje|viajes|viajar|destino|destinos|excursion|excursiones|vacaciones|package|packages|trip|trips|travel|destination|voyage|voyages|pacote|pacotes|viagem|viagens)\b/,
    listings: /\b(?:apartamento|apartamentos|casa|casas|inmueble|inmuebles|propiedad|propiedades|arriendo|arrendar|alquiler|alquilar|venta|comprar|house|houses|apartment|apartments|property|properties|rent|buy|sale|imovel|imoveis|maison|appartement)\b/,
};

/** The reply asks the customer for search criteria instead of answering. */
const ASKS_CRITERIA = /\b(?:destino|destinos|fecha|fechas|personas|presupuesto|zona|barrio|ciudad|habitaciones|comprar o arrendar|arrendar o comprar|comprar o alquilar|tipo de|destination|date|dates|budget|how many|which|looking to|buy or rent|neighbou?rhood|area|bedrooms|pessoas|orcamento|quantas|combien|quel|quelle|budget)\b/;
/** The reply already says the catalogue is empty / nothing was published. */
const SAYS_EMPTY = /\b(?:no (?:hay|tengo|tenemos|contamos|existen|encuentro)[^.?!]{0,70}(?:publicad\w*|disponible\w*|catalogo)|todavia no|aun no|no (?:packages|properties|listings|tours)[^.?!]{0,40}(?:published|available)|nothing (?:is )?published|not (?:published|yet)|ainda nao|nao ha[^.?!]{0,50}publicad|aucun[^.?!]{0,50}(?:publie|disponible)|pas encore)\b/;
/** The reply already tells the customer the date has passed. */
const SAYS_PAST = /\b(?:ya paso|ya pasaron|esa fecha ya|fecha .{0,40}ya paso|already passed|has passed|have passed|is in the past|was in the past|ja passou|ja se passou|deja passe|est passee)\b/;

export function catalogDomainOf(userText: unknown): CatalogDomain[] {
    const folded = normalizeForIntent(userText);
    return (Object.keys(DOMAIN_CUES) as CatalogDomain[]).filter(domain => DOMAIN_CUES[domain].test(folded));
}

export function replyAsksCriteria(reply: unknown): boolean {
    const text = String(reply ?? '');
    return /[?¿]/.test(text) && ASKS_CRITERIA.test(normalizeForIntent(text));
}

export function replySaysEmpty(reply: unknown): boolean {
    return SAYS_EMPTY.test(normalizeForIntent(String(reply ?? '')));
}

const longDate = (iso: string, lang: Lang): string => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

const dayAndMonth = (iso: string, lang: Lang): string => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'long', timeZone: 'UTC' });
};

export interface PastDeparture {
    /** The date the customer named, as ISO. */
    iso: string;
    /** The year was written by the customer. False: the day had already gone by THIS year and no year was said. */
    yearStated: boolean;
    /** No year said: the same day next year, offered back as a question. */
    nextYearIso?: string;
}

/** A departure date in the message that already passed (this year's, when no year was said). */
export function pastDepartureIn(userText: unknown, todayIso: string): PastDeparture | null {
    const raw = String(userText ?? '');
    const folded = normalizeForIntent(raw);
    if (!folded || raw.length > 400 || !DEPARTURE_CUE.test(folded) || NOT_A_DEPARTURE.test(folded)) return null;
    for (const found of explicitDates(folded, todayIso)) {
        if (found.yearStated && found.date < todayIso) return { iso: found.date, yearStated: true };
        if (!found.yearStated && found.rolledForward) return { iso: found.thisYearDate, yearStated: false, nextYearIso: found.date };
    }
    return null;
}

export const replyAcknowledgesPast = (reply: unknown): boolean => SAYS_PAST.test(normalizeForIntent(String(reply ?? '')));

export function pastDepartureText(lang: string | undefined, past: PastDeparture): string {
    const code = langOf(lang);
    const when = longDate(past.iso, code);
    const next = past.nextYearIso ? longDate(past.nextYearIso, code) : '';
    if (!past.yearStated) {
        const dayMonth = dayAndMonth(past.iso, code);
        return {
            es: `El ${dayMonth} de este año ya pasó. ¿Se refiere al ${next}? Si es otra fecha, indíquemela y busco.`,
            en: `${dayMonth} of this year has already passed. Do you mean ${next}? If it is another date, tell me and I will look.`,
            pt: `${dayMonth} deste ano já passou. Você se refere a ${next}? Se for outra data, me diga e eu procuro.`,
            fr: `Le ${dayMonth} de cette année est déjà passé. Parlez-vous du ${next} ? S’il s’agit d’une autre date, dites-le-moi et je cherche.`,
        }[code];
    }
    return {
        es: `Esa fecha de salida, ${when}, ya pasó. ¿Para qué otra fecha desea que busque?`,
        en: `That departure date, ${when}, has already passed. Which other date should I look for?`,
        pt: `Essa data de saída, ${when}, já passou. Para qual outra data devo procurar?`,
        fr: `Cette date de départ, ${when}, est déjà passée. Pour quelle autre date dois-je chercher ?`,
    }[code];
}

const NOUN: Record<CatalogDomain, Record<Lang, string>> = {
    packages: { es: 'paquetes de viaje', en: 'travel packages', pt: 'pacotes de viagem', fr: 'forfaits de voyage' },
    listings: { es: 'inmuebles', en: 'properties', pt: 'imóveis', fr: 'biens immobiliers' },
};

/** «There is nothing published yet», said first, with the offer that someone from the team gets in touch when there are options. */
export function emptyCatalogText(lang: string | undefined, domain: CatalogDomain, canOfferPerson: boolean): string {
    const code = langOf(lang);
    const noun = NOUN[domain][code];
    const sentence = {
        es: `Actualmente no hay ${noun} publicados en nuestro catálogo.`,
        en: `There are currently no ${noun} published in our catalogue.`,
        pt: `Atualmente não há ${noun} publicados no nosso catálogo.`,
        fr: `Il n’y a actuellement aucun ${noun} publié dans notre catalogue.`,
    }[code];
    const offer = {
        es: '¿Le gustaría que alguien del equipo se ponga en contacto con usted cuando haya opciones disponibles?',
        en: 'Would you like someone from the team to get in touch with you when there are options available?',
        pt: 'Gostaria que alguém da equipe entrasse em contato com você quando houver opções disponíveis?',
        fr: 'Souhaitez-vous que quelqu’un de l’équipe vous contacte lorsqu’il y aura des options disponibles ?',
    }[code];
    return canOfferPerson ? `${sentence} ${offer}` : sentence;
}
