/**
 * The slot values a required read takes from the customer's CURRENT message (operations runtime PR7: hotel and travel).
 *
 * The catalogue declares where each reader argument comes from (`slot:check_in`, `slot:starts_at`, …). The PR5 pilots needed none:
 * a menu or an order list reads with bounded defaults. A stay or a departure does: production QA (Telegram, hotel) answered
 * «¿tienen disponible del 3 al 5 de diciembre para 2?» with availability nobody read, because the dates in the message never
 * reached `check_property_availability`. These are the values the runner may pass; anything not said is left out, and a read whose
 * required slot is missing is not run (the model asks).
 *
 * Deterministic, read-only, no model: the same readers the booking interpreter uses (`date-reference.ts`), on folded text.
 */
import { normalizeForIntent } from '@parallext/shared';
import { customerDatesIn, expandDayRanges } from '../date-reference';

export interface RequiredReadSlots {
    /** YYYY-MM-DD. Only with `check_out`, and only when check-out is after check-in. */
    check_in?: string;
    check_out?: string;
    /** The first future (or today's) date of the message: a departure. */
    starts_at?: string;
    /** People in the stay / on the trip, when the customer said how many. */
    guests?: number;
    travellers?: number;
    /** Real estate (`listingSearchSlotsIn`): sale or rent, when the message says exactly one. */
    operation?: 'sale' | 'rent';
    /** Real estate: the one property kind the message names (`search_listings.propertyKind`). */
    property_kind?: 'apartment' | 'house' | 'commercial' | 'land' | 'office';
    /** Real estate: «3 habitaciones» → at least 3 bedrooms. */
    bedrooms?: number;
}

const COUNT_WORDS: Record<string, number> = {
    uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    um: 1, uma: 1, duas: 2, quatro: 4, cinq: 5, deux: 2, trois: 3, quatre: 4,
};
const COUNT = `(\\d{1,2}|${Object.keys(COUNT_WORDS).join('|')})`;
/** «para 2», «somos 3», «for 4»: a count unless a date, an hour or a length of stay follows it. */
const COUNT_AFTER_WORD = new RegExp(`\\b(?:para|somos|seriamos|seremos|vamos|for|pour|we are)\\s+${COUNT}\\b(?!\\s*(?:de\\b|del\\b|of\\b|/|:|-|noches?\\b|nights?\\b|dias?\\b|days?\\b|nuits?\\b|noites?\\b|h\\b|hs\\b|am\\b|pm\\b|horas?\\b|\\d))`);
/** «2 personas», «3 adultos», «4 guests». */
const COUNT_BEFORE_WORD = new RegExp(`\\b${COUNT}\\s+(?:personas?|huespedes?|adultos?|viajeros?|pasajeros?|people|persons?|guests?|adults?|travell?ers?|pessoas?|hospedes?|personnes?|voyageurs?)\\b`);

function count(text: string): number | undefined {
    const match = COUNT_BEFORE_WORD.exec(text) ?? COUNT_AFTER_WORD.exec(text);
    if (!match) return undefined;
    const value = /^\d+$/.test(match[1]) ? Number(match[1]) : COUNT_WORDS[match[1]];
    return Number.isInteger(value) && value >= 1 && value <= 50 ? value : undefined;
}

/**
 * The slots of one customer message. `todayIso` is the tenant's local today (YYYY-MM-DD). Past dates are never a slot: a stay or a
 * departure in the past is a question for the model, not a read.
 */
export function requiredReadSlotsIn(text: unknown, todayIso: string): RequiredReadSlots {
    const folded = expandDayRanges(normalizeForIntent(text));
    if (!folded) return {};
    const slots: RequiredReadSlots = {};
    const dates = customerDatesIn(folded, todayIso).filter(date => date.relation !== 'past').map(date => date.date);
    if (dates.length) slots.starts_at = dates[0];
    if (dates.length >= 2 && dates[1] > dates[0]) {
        slots.check_in = dates[0];
        slots.check_out = dates[1];
    }
    const people = count(folded);
    if (people !== undefined) {
        slots.guests = people;
        slots.travellers = people;
    }
    return slots;
}

// ── Real estate (`listings` pilot) ───────────────────────────────────────

/** «en arriendo», «para alquilar», «for rent», «aluguel», «à louer». English «location» is a place, so it is not here. */
const RENT = /\b(?:arriendo|arriendos|arrendar|arrienda\w*|alquiler(?:es)?|alquilar|alquila\w*|renta|rentar|rent|rental|renting|lease|aluguel|alugar|aluga\w*|louer|loue\w*)\b/;
/** «en venta», «para comprar», «for sale», «à vendre». «Vender (mi casa)» is the customer selling: not a search filter. */
const SALE = /\b(?:venta|ventas|compra|comprar|compro|sale|buy|buying|purchase|venda|achat|acheter|a vendre)\b/;
const PROPERTY_KINDS: ReadonlyArray<[NonNullable<RequiredReadSlots['property_kind']>, RegExp]> = [
    ['apartment', /\b(?:apartamentos?|apto|aptos|apartaestudios?|departamentos?|apartments?|flats?|appartements?)\b/],
    ['house', /\b(?:casas?|houses?|maisons?)\b/],
    ['commercial', /\b(?:locales? comerciales?|local comercial|bodegas?|commercial)\b/],
    ['land', /\b(?:lotes?|terrenos?|land|plots?|terrains?)\b/],
    ['office', /\b(?:oficinas?|offices?|escritorios?|bureaux?)\b/],
];
const BEDROOMS = new RegExp(`\\b${COUNT}\\s+(?:habitaciones?|alcobas?|cuartos?|dormitorios?|recamaras?|bedrooms?|rooms?|quartos?|chambres?)\\b`);

/**
 * The `search_listings` filters the customer stated in this message: the operation (sale or rent), the property kind and a minimum
 * of bedrooms. Only what is said, and only when it is one value: «casa o apartamento» names no single kind. Zone and budget are left
 * to the model (a free-text zone or a price said in words is not read deterministically).
 */
export function listingSearchSlotsIn(text: unknown): RequiredReadSlots {
    const folded = normalizeForIntent(text);
    if (!folded) return {};
    const slots: RequiredReadSlots = {};
    const rent = RENT.test(folded), sale = SALE.test(folded);
    if (rent !== sale) slots.operation = rent ? 'rent' : 'sale';
    const kinds = PROPERTY_KINDS.filter(([, pattern]) => pattern.test(folded)).map(([kind]) => kind);
    if (kinds.length === 1) slots.property_kind = kinds[0];
    const bedrooms = BEDROOMS.exec(folded);
    if (bedrooms) {
        const value = /^\d+$/.test(bedrooms[1]) ? Number(bedrooms[1]) : COUNT_WORDS[bedrooms[1]];
        if (Number.isInteger(value) && value >= 1 && value <= 20) slots.bedrooms = value;
    }
    return slots;
}
