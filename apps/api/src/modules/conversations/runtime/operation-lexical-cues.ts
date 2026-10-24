/**
 * Deterministic operation cues for the required reads (restaurant pilot).
 *
 * Production QA 2026-10-24, restaurant tenant with `agentRuntime.requiredReads.restaurants` on: the menu read ran before the
 * model for «¿cuánto vale el plato Spark?», «quanto custa o prato Spark?», «combien coûte le plat Spark ?», but 0 of 3 times
 * for «how much is the Spark QA Plato?», «price of the Spark dish?», «what does the Spark dish cost?». The reads only run on a
 * classifier verdict for a pilot operation at or above the threshold, and the English price questions never reached one: they
 * fell to `ask_question` (the FAQ intent reads as "something the business already answered before", and the dish's price was in
 * the history) or to `menu_info` below the threshold. Only `search_faqs` ran; the model answered from history or said it had no confirmed price.
 *
 * A message that is unmistakably about the menu (a dish or menu word together with a price, an ingredient or diet, or a
 * "do you have"), in Spanish, Portuguese, French or English, is `menu_info` whatever the classifier said, unless the
 * classifier confidently named another business operation. The threshold itself does not move. The cue only gates a read
 * (get_menu is a public, side-effect-free read), never a write.
 *
 * The same day, with `requiredReads.properties` and `requiredReads.tours` on, the lodging and travel pilots had the same gap:
 *   - hotel «à quelle heure est l'enregistrement ?» and «what time is check-out?» ran only `search_faqs` and answered «I don't
 *     have the check-in/check-out time configured» (the property has 15:00 / 11:00, in `get_property_details`): the classifier
 *     maps a schedule question to the FAQ intent;
 *   - travel «combien de places restent pour le Spark QA Tour ?» ran only `search_packages` (no departure or details read) and
 *     said there is no specific number of seats (the departure has 10).
 * So a lodging question in the message's own words (check-in/check-out or arrival/departure time, address, capacity, rooms and
 * bathrooms, amenities, minimum stay, nightly price, availability) is `property_info` (list_properties → get_property_details),
 * and a tour question is `package_availability` (seats left, departures, dates: the departures and their seats) or
 * `package_info` (duration, what it includes or excludes, price), under the same rules.
 */
import { normalizeForIntent } from '@parallext/shared';
import type { RequiredReadsPilot } from './required-reads.runner';

/** Words that name a menu item or the menu itself. */
const DISH = /\b(?:platos?|platillos?|pratos?|plats?|dish(?:es)?|plates?|meals?|food|foods|comidas?|bebidas?|boissons?|drinks?|postres?|sobremesas?|desserts?|menus?|cardapio|la carta|la carte)\b/;
/** The menu itself: asking for it is a menu question on its own («what's on the menu?», «¿me pasas la carta?»). */
const MENU = /\b(?:menus?|cardapio|la carta|la carte)\b/;
/** Price, cost or preparation-time words («how long does the X dish take?», «¿cuánto tarda el plato?»). */
const PRICE = /\b(?:cuanto|cuanta|cuantos|cuantas|precios?|valor|cuesta|cuestan|cobran|quanto|quanta|precos?|custa|custam|combien|prix|coute|coutent|tarifs?|how much|prices?|priced|pricing|cost|costs|how long|takes?|tarda\w*|demora\w*|prep\w*)\b/;
/** Ingredients, allergens and diets: details of a dish. */
const ATTRIBUTE = /\b(?:ingredientes?|ingredients?|alergen\w*|allergen\w*|allergi\w*|alergi\w*|vegetarian\w*|vegetarien\w*|vegan\w*|gluten|lactosa|lactose|picantes?|spicy|epice\w*|apimentad\w*)\b/;
/** "Do you have …?" forms. */
const HAVE = /\b(?:tienen|tiene|hay|ofrecen|manejan|sirven|tem|tens|temos|voces tem|avez vous|vous avez|y a t il|servez|do you have|do you serve|have you got|is there|are there|any)\b/;
/**
 * The customer's own order, booking or complaint: never the menu, whatever dish word it carries («the status of my order»,
 * «mi pedido del plato Spark», «I want a refund for the dish»). Those belong to the classifier and to their own reads.
 */
const NOT_MENU = /\b(?:(?:mi|mis|meu|meus|minha|minhas|ma|mes|mon|my|our|nuestro|nuestros) (?:pedidos?|ordens?|orders?|commandes?|encomendas?|reservas?|reservations?|bookings?)|status|estado|statut|rastre\w*|track\w*|reembols\w*|refund\w*|rembours\w*|devoluc\w*|devolu\w*|quej\w*|reclam\w*|complain\w*|plaint\w*)\b/;

const folded = (text: unknown): string => normalizeForIntent(text)
    .replace(/[’']/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The message asks about the menu or one of its items: what is on the menu, or the price, ingredients, allergens, diet or
 * preparation time of a dish or drink. Spanish, Portuguese, French and English. Pure.
 */
export function isMenuQuestion(text: unknown): boolean {
    const t = folded(text);
    if (!t || t.length > 400 || NOT_MENU.test(t)) return false;
    if (MENU.test(t)) return true;
    return DISH.test(t) && (PRICE.test(t) || ATTRIBUTE.test(t) || HAVE.test(t));
}

// ── Lodging (hotel / vacation rental) ───────────────────────────────────────────────────────────────────────────────────

/** Check-in / check-out: a stay's schedule on its own («what time is check-out?», «à quelle heure est l'enregistrement ?»). */
const STAY_CHECK = /\b(?:check ?ins?|check ?outs?|enregistrement|horario de entrada|horario de salida)\b/;
/** Arriving or leaving the property: a schedule question together with a time word («a que horas é a chegada?»). */
const STAY_MOVE = /\b(?:llegada|llegar|entrada|entrar|salida|salir|entregar|chegada|chegar|saida|sair|arrivee|arriver|depart|partir|quitter|liberer|arrival|arrive|departure|leave|vacate)\b/;
const TIME = /\b(?:hora|horas|horario|heure|heures|horaire|time|times|when|cuando|quando|quand)\b/;
/** Where the property is. */
const ADDRESS = /\b(?:direccion|ubicacion|ubicad[oa]s?|donde (?:queda|quedan|esta|estan|se encuentra\w*)|endereco|localizacao|localizad[oa]s?|onde (?:fica|ficam|esta|estao)|adresse|ou (?:se trouve|se situe|etes vous|est situe\w*)|situe\w*|address|location|located|where is|where are)\b/;
/** How many people fit. */
const CAPACITY = /\b(?:capacidad|capacidade|capacite|capacity|sleeps|caben|cabem)\b/;
const PEOPLE = /\b(?:huespedes|hospedes|guests|personas|pessoas|personnes|people|persons|adultos|adults|adultes)\b/;
const HOW_MANY = /\b(?:cuant\w*|quant\w*|combien|how many|max\w*|hasta|up to|jusqu\w*)\b/;
/** Rooms, beds and bathrooms. */
const ROOMS = /\b(?:habitacion\w*|cuartos?|recamaras?|dormitorios?|banos?|quartos?|banheiros?|chambres?|salles? de bains?|salles? d eau|bedrooms?|bathrooms?|beds?|camas?|lits?|rooms?|suites?)\b/;
/** Amenities and house services. */
const AMENITY = /\b(?:amenities|amenidades|comodidades|servicios|servicos|equipements?|wifi|wi fi|internet|piscina|piscine|pool|parqueadero|parqueo|estacionamiento|estacionamento|parking|garagem|desayuno|breakfast|petit dejeuner|cafe da manha|aire acondicionado|ar condicionado|air conditioning|climatisation|cocina|cozinha|kitchen|cuisine|jacuzzi|spa|gym|gimnasio|mascotas|pets?|animais|animaux|pet friendly|toallas|toalhas|towels|serviettes|lavadora|lavanderia|laundry)\b/;
/** Minimum stay. */
const MINIMUM = /\bminim\w*\b/;
const NIGHTS = /\b(?:noches?|noites?|nuits?|nights?|estadias?|estancias?|stays?|sejours?)\b/;
/** What is rented: a night, a stay, a room, the property. */
const LODGING = /\b(?:noches?|noites?|nuits?|nights?|nightly|diarias?|estadias?|estancias?|stays?|sejours?|habitacion\w*|cuartos?|quartos?|chambres?|rooms?|suites?|cabanas?|cabins?|apartamentos?|apartments?|appartements?|alojamientos?|hospedagem|logements?|hotel|propiedad\w*|property|properties|propriete\w*)\b/;
const AVAILABLE = /\b(?:disponib\w*|available|availability|vacancy|vacancies)\b/;
/** Price words of a stay or a tour (no preparation time: that is the menu's). */
const PRICE_WORDS = /\b(?:cuanto|cuanta|precios?|valor|cuesta|cuestan|cobran|tarifas?|quanto|precos?|custa|custam|combien|prix|coute|coutent|tarifs?|how much|prices?|pricing|cost|costs|rates?)\b/;
/** A question form, for words that are also small talk («the room is nice»). */
const QUESTION = /\b(?:cuant\w*|quant\w*|combien|how many|how much|tiene\w*|tienen|hay|tem|avez|vous avez|y a t il|il y a|have|has|is there|are there|que|qual|quais|what|which|quel\w*|incluye\w*|inclui\w*|include\w*|permit\w*|allow\w*|accept\w*|acept\w*)\b/;
/**
 * A write or a complaint about the customer's own stay or trip: never a catalogue read, whatever words it carries («cancel my
 * booking», «I want a refund», «can I pay on arrival?»). Those belong to the classifier and their own flows.
 */
const NOT_CATALOGUE = /\b(?:cancel\w*|anul\w*|annul\w*|reembols\w*|refund\w*|rembours\w*|devoluc\w*|devolu\w*|quej\w*|reclam\w*|complain\w*|plainte\w*|modific\w*|cambiar|changer|alterar|pagar|pago|pay|paid|payment|paiement|payer|pagamento|link)\b/;
/** The customer's own reservation: the guest's booking reads (identity step-up), not the public catalogue. */
const MY_BOOKING = /\b(?:mi|mis|meu|meus|minha|minhas|ma|mes|mon|my|our|nuestra|nuestras|nuestro) (?:reservas?|reservations?|reservaciones?|bookings?)\b/;

const asked = (raw: unknown, t: string) => (typeof raw === 'string' && raw.includes('?')) || QUESTION.test(t);

/**
 * The message asks about a lodging's offer: check-in/check-out or arrival/departure time, address, capacity, rooms and
 * bathrooms, amenities, minimum stay, nightly price or availability. Spanish, Portuguese, French and English. Pure.
 */
export function isLodgingQuestion(text: unknown): boolean {
    const t = folded(text);
    if (!t || t.length > 400 || NOT_CATALOGUE.test(t)) return false;
    if (STAY_CHECK.test(t) || (STAY_MOVE.test(t) && TIME.test(t))) return true;
    if (MY_BOOKING.test(t)) return false;
    if (ADDRESS.test(t) || CAPACITY.test(t) || (PEOPLE.test(t) && HOW_MANY.test(t))) return true;
    if (MINIMUM.test(t) && NIGHTS.test(t)) return true;
    if (LODGING.test(t) && PRICE_WORDS.test(t)) return true;
    if (AVAILABLE.test(t) && (LODGING.test(t) || /\d/.test(t))) return true;
    return asked(text, t) && (ROOMS.test(t) || AMENITY.test(t));
}

// ── Travel agency / tours ───────────────────────────────────────────────────────────────────────────────────────────────

/** What a travel agency sells. */
const TOUR = /\b(?:tours?|paquetes?|pacotes?|forfaits?|excursion\w*|excursao|excursoes|planes|viajes?|viagens?|voyages?|trips?|experiencias?|experiences?|packages?|passeios?|circuitos?|circuits?|actividad\w*|activites?|activities|activity)\b/;
/** Seats on a departure… */
const SEATS = /\b(?:cupos?|lugares|plazas?|asientos?|places?|vagas?|seats?|spots?|spaces?|assentos?)\b/;
/** …that are left. */
const LEFT = /\b(?:quedan|queda|restan|resta|disponibles?|libres?|hay|left|remaining|available|restent|reste|restantes?|restam|sobram|sobra|disponiveis|livres?|how many|cuant\w*|quant\w*|combien|still)\b/;
/** Departures and their dates, on their own. */
const DEPARTURES = /\b(?:salidas|proxim\w* salida|siguiente salida|saidas|proxim\w* saida|departs|prochain\w* depart|next departure|departures|fechas|datas|dates|proxim\w* fecha|proxim\w* data|prochain\w* date|next date)\b/;
/** When it leaves, or whether it is available: about a tour. */
const WHEN_OR_AVAILABLE = /\b(?:cuando sale\w*|quando sai\w*|quand part\w*|when does|when do|when is|horarios?|schedule|disponib\w*|available|availability)\b/;
/** How long it lasts. */
const DURATION = /\b(?:cuanto dura\w*|duracion|dura|duran|duracao|quanto tempo|combien de temps|duree|dure|durent|how long|duration|lasts|cuant[oa]s (?:dias|horas|noches)|quant[oa]s (?:dias|horas|noites)|combien de (?:jours|heures|nuits)|how many (?:days|hours|nights))\b/;
/** What it includes or excludes, and what to bring. */
const INCLUDES = /\b(?:incluye\w*|incluid\w*|inclui\w*|inclus\w*|incluso|include\w*|exclu\w*|comprend\w*|que trae|what to bring|que llevar|o que levar|apporter)\b/;

/**
 * The tour operation the message's words name: `package_availability` for seats left, departures and dates, `package_info` for
 * duration, inclusions and price; null when it is neither. Spanish, Portuguese, French and English. Pure.
 */
export function tourQuestionOperation(text: unknown): 'package_availability' | 'package_info' | null {
    const t = folded(text);
    if (!t || t.length > 400 || NOT_CATALOGUE.test(t) || MY_BOOKING.test(t)) return null;
    if ((SEATS.test(t) && LEFT.test(t)) || DEPARTURES.test(t) || (TOUR.test(t) && WHEN_OR_AVAILABLE.test(t))) return 'package_availability';
    if (DURATION.test(t) || INCLUDES.test(t) || (TOUR.test(t) && PRICE_WORDS.test(t))) return 'package_info';
    return null;
}

/**
 * The pilot operation the message's own words name, when the turn publishes its read; null otherwise: the restaurant menu
 * (`menu_info` → get_menu), a lodging's details (`property_info` → list_properties) and a tour's details or departures
 * (`package_info` / `package_availability` → search_packages).
 */
export function lexicalRequiredReadsOperation(text: unknown, pilot: RequiredReadsPilot, publishedTools: readonly string[]): string | null {
    if (pilot === 'restaurants' && publishedTools.includes('get_menu') && isMenuQuestion(text)) return 'menu_info';
    if (pilot === 'properties' && publishedTools.includes('list_properties') && isLodgingQuestion(text)) return 'property_info';
    if (pilot === 'tours' && publishedTools.includes('search_packages')) return tourQuestionOperation(text);
    return null;
}
