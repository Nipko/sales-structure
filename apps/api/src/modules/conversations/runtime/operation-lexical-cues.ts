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

/**
 * The pilot operation the message's own words name, when the turn publishes its read; null otherwise. Only the restaurant
 * pilot has a lexical cue (`menu_info` → get_menu).
 */
export function lexicalRequiredReadsOperation(text: unknown, pilot: RequiredReadsPilot, publishedTools: readonly string[]): string | null {
    if (pilot === 'restaurants' && publishedTools.includes('get_menu') && isMenuQuestion(text)) return 'menu_info';
    return null;
}
