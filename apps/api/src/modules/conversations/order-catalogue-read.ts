/**
 * An order request the server cannot take deterministically («quiero pedir una pizza» in a restaurant whose menu has one dish,
 * «quiero comprar un cargador» in a store that sells headphones) used to reach the model with no current menu or catalogue: it
 * started taking the order (allergies, address, payment) for something the business does not sell. Order creation already
 * rejects unknown items; this keeps the conversation from promising them. The server reads the menu / catalogue first (read
 * only) and the model sees this note next to the result.
 */
export const MENU_ORDER_NOTE = 'The customer asked to order. Only the items on this menu can be ordered. If what they asked for is not on this menu, say so plainly and show what is offered before asking about allergies, delivery address or payment.';
export const CATALOGUE_ORDER_NOTE = 'The customer asked to buy. Only the products in this catalogue can be ordered. If what they asked for is not in this catalogue, say so plainly and show what is offered before asking about quantity, delivery address or payment.';

/** The result as the model sees it: a successful read carries the note; a failed read stays an admission, unchanged. */
export function withOrderNote(result: any, note: string): any {
    if (!result || typeof result !== 'object' || Array.isArray(result) || result.error) return result;
    if (result.status === 'error') return result;
    return { ...result, order_note: note };
}
