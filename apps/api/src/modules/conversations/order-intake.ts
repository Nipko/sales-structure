import { isInformationSeekingMessage } from '../../common/conversation/intent-normalizer';
import { foldKeepingPunctuation, negatedAt } from './appointment-transition';
import { formatDay, shortReference, type AddressForm } from './transition-engine';

/**
 * A customer's request to BUY something the catalogue holds, read by the server.
 *
 * Why it exists. The cancel / reschedule engine (transition-engine.ts) exists because a write behind a confirmation needs a
 * pending ledger row before the customer's «sí» can execute it, and that row only exists if the MODEL calls the writer on the
 * request turn. A model summarises the order in prose («¿Confirma que desea realizar este pedido?»), calls nothing (or calls it
 * with arguments that never settle), and every later «sí» finds nothing to confirm: production 2026-10-09, Tienda QA
 * Electrónica, ten confirmations in a row and no order. Orders were the one writer that still depended on that. Here the server
 * reads the words, resolves WHICH product from the tenant's own catalogue, and calls `place_catalog_order` itself: the central
 * guard answers with the confirmation challenge (the pending row, mission and terms included) and the reply states the exact
 * terms from the guard's own `catalogTerms`. The «sí» is then executed by the server (conversations.service, 4c), exactly like a
 * cancellation, and what the customer is told afterwards is what the record says.
 *
 * Nothing here executes a write. It only builds the arguments of a proposal and the sentences around it.
 */

export interface IntakeProduct {
    id: string;
    title: string;
    price?: number;
    currency?: string;
    stock?: number;
    inStock?: boolean;
}

export interface OrderIntake {
    product: IntakeProduct;
    quantity: number;
    /** Delivery or collection the same message gave («envíelo a la Calle 5»): the order's notes. */
    notes?: string;
}

/** The customer named a product only in part and more than one product of the catalogue answers to those words: ask which. */
export interface OrderChoice { choose: IntakeProduct[]; quantity: number }

const fold = (value: unknown): string => foldKeepingPunctuation(value).replace(/\s+/g, ' ').trim();
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** «quiero», «quisiera», «me gustaría», «i want», «je voudrais»… */
const DESIRE = /\b(?:quiero|quisiera|queria|necesito|deseo|me gustaria|voy a|vamos a|favor de|por favor|i want|i would like|i d like|i need|i ll|quero|gostaria|preciso|vou|je veux|je voudrais|j aimerais|il me faut)\b/;
/** The act of buying. «llevar» only counts with a desire form («quiero llevar…»). */
const BUY_ACT = /\b(?:pedir(?:lo|la|los|las)?|pedido de|ordenar(?:lo|la)?|comprar(?:lo|la|los|las)?|adquirir|llevar(?:lo|la|los|las|me)?|encargar(?:lo|la)?|buy|order|purchase|comprar|pedir|encomendar|levar|acheter|commander)\b/;
/** «me llevo…», «i ll take…»: the buying act and the desire in one phrase. */
const TAKE_IT = /\b(?:me llevo|me quedo con|lo compro|la compro|me lo vende|me la vende|me lo vendes|me la vendes|me lo venden|lo quiero comprar|i ll take|i will take|i ll buy it|vou levar|eu levo|je prends|je le prends)\b/;
/** What makes the message something other than an order for the product it names. */
const NOT_AN_ORDER = /\b(?:informacion|info|detalles?|saber|precio|precios|cuanto|cuesta|costo|disponib\w*|tienen|tiene|hay|stock|garantia|caracteristicas|diferencia\w*|comparar|opciones|catalogo|recomiend\w*|cancel\w*|anul\w*|devol\w*|reembols\w*|cambi\w*|reclam\w*|queja|factura|cotiz\w*|presupuesto|cita|citas|turno|reserva|ya pedi|ya compre|ya ordene|pedi|compre|ordene|roto|rota|rotos|rotas|danad\w*|defectuos\w*|llego|llegaron|no funciona|no sirve|perdon|disculp\w*|problema\w*|incomplet\w*|equivoc\w*|broken|damaged|defective|arrived|sorry|apolog\w*|problem|warranty|refund|return|complain\w*|invoice|faulty|wrong|quebrad\w*|danificad\w*|defeituos\w*|chegou|desculp\w*|reembolso|reclamacao|fatura|casse\w*|endommag\w*|defectueu\w*|arrive|desole|probleme\w*|garantie|retour|rembours\w*|plainte|facture)\b/;
const NUMBER_WORDS: Record<string, number> = {
    un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    um: 1, uma: 1, dois: 2, duas: 2, quatro: 4, sete: 7, oito: 8, nove: 9, dez: 10,
    deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10,
};
const QUANTITY_BEFORE = new RegExp(`(?:^|\\s)(\\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')})\\s*(?:x\\s*)?(?:unidad(?:es)?|und?s?|piezas?|pares?|units?|unites?|unidades?)?\\s*(?:de |del |de la |of |de l )?$`);
const QUANTITY_AFTER = /^\s*(?:x|por)\s*(\d{1,3})\b/;
/** Words that may stand between the buying verb and the product's name without breaking the phrase. */
const FILLER = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'uno', 'unos', 'unas', 'de', 'del', 'mi', 'mis', 'para', 'me', 'lo', 'the', 'a', 'an', 'my', 'some', 'one', 'o', 'os', 'as', 'um', 'uma', 'le', 'les', 'des', 'du', 'mon', 'ma', 'mes', 'unidad', 'unidades', 'pedido', 'orden', 'order', 'pedir', 'comprar']);
const SKIP_TOKENS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'con', 'para', 'the', 'of', 'and', 'le', 'les', 'du', 'des', 'et']);

const tokensOf = (text: string): string[] => text.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
const sameWord = (a: string, b: string): boolean => a === b || a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;

/** Where the product's name sits in the (folded) text, or -1. */
function findProduct(text: string, title: string): { start: number; end: number } | -1 {
    const name = fold(title);
    if (name.length < 3) return -1;
    const whole = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${escapeRegex(name)}(?:e?s)?)(?![\\p{L}\\p{N}])`, 'u').exec(text);
    if (whole) {
        const start = whole.index + whole[0].indexOf(whole[1]);
        return { start, end: start + whole[1].length };
    }
    // Every significant word of the name, in any order, plurals tolerated («audífonos Aurora»).
    const wanted = tokensOf(name).filter(token => token.length >= 3 && !SKIP_TOKENS.has(token));
    if (wanted.length < 2) return -1;
    const words = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map(match => ({ word: match[0], start: match.index!, end: match.index! + match[0].length }));
    const hits = wanted.map(token => words.find(word => sameWord(word.word, token)));
    if (hits.some(hit => !hit)) return -1;
    return { start: Math.min(...hits.map(hit => hit!.start)), end: Math.max(...hits.map(hit => hit!.end)) };
}

/** The words alone (no catalogue): a desire form and the act of buying, in a message that is not a question, a complaint or a negation. */
export function mightBeOrderRequest(raw: string): boolean {
    const original = String(raw ?? '');
    if (!original.trim() || original.length > 400) return false;
    const text = fold(original).replace(/['’]/g, ' ');
    if (/[?¿]/.test(text) || isInformationSeekingMessage(original)) return false;
    const plain = text.replace(/[,.;!?¿¡]/g, ' ').replace(/\s+/g, ' ').trim();
    if (NOT_AN_ORDER.test(plain)) return false;
    const take = TAKE_IT.exec(text);
    const desire = DESIRE.exec(text);
    const act = BUY_ACT.exec(text);
    if (!take && !(desire && act)) return false;
    const verbAt = (take ?? act)!.index;
    return !negatedAt(text, verbAt) && !negatedAt(text, desire?.index ?? verbAt);
}

/**
 * «Quiero pedir 1 Audífono QA Aurora»: a request to buy ONE product the tenant sells, with the quantity it states (one when it
 * states none). Conservative on purpose, like the transition engine: a question, a price or stock enquiry, a complaint, a
 * cancellation, an appointment, a negation or the past tense is not an order, and neither is a message that names two products.
 */
export function detectOrderIntake(raw: string, catalog: readonly IntakeProduct[]): OrderIntake | OrderChoice | null {
    if (!catalog.length || !mightBeOrderRequest(raw)) return null;
    const text = fold(raw).replace(/['’]/g, ' ');
    const take = TAKE_IT.exec(text);
    const act = BUY_ACT.exec(text);
    const found = catalog
        .filter(product => product && typeof product.id === 'string' && typeof product.title === 'string')
        .map(product => ({ product, at: findProduct(text, product.title) }))
        .filter((hit): hit is { product: IntakeProduct; at: { start: number; end: number } } => hit.at !== -1);
    if (!found.length) return null;
    // «Audífono QA Aurora» and «Audífono QA Aurora Pro»: when one name contains the other, the longer one is what was said.
    const best = found.filter(hit => !found.some(other => other !== hit
        && other.at.start <= hit.at.start && other.at.end >= hit.at.end && fold(other.product.title).length > fold(hit.product.title).length));
    const unique = new Map(best.map(hit => [hit.product.id, hit]));
    if (unique.size !== 1) return null;
    const { product, at } = [...unique.values()][0];
    const wholeName = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(fold(product.title))}(?:e?s)?(?![\\p{L}\\p{N}])`, 'u').test(text);

    const before = text.slice(0, at.start);
    const after = text.slice(at.end);
    const stated = QUANTITY_BEFORE.exec(before.replace(/[,.;]/g, ' ').trimEnd() + ' ') ?? null;
    let quantity = 1;
    if (stated) {
        const token = stated[1];
        quantity = /^\d+$/.test(token) ? Number(token) : (NUMBER_WORDS[token] ?? 1);
    } else {
        const trailing = QUANTITY_AFTER.exec(after);
        if (trailing) quantity = Number(trailing[1]);
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return null;
    // What «Quiero pedir perdón, el Audífono llegó roto» shares with an order is a verb and a product. An order says HOW MANY, or puts
    // the product right after the buying verb («quisiera comprar audífonos aurora»), or takes it («me llevo…»).
    const buyEnd = take ? take.index + take[0].length : act ? act.index + act[0].length : 0;
    const gap = text.slice(buyEnd, at.start);
    const adjacent = !/[,.;]/.test(gap) && tokensOf(gap).every(token => FILLER.has(token) || /^\d+$/.test(token));
    if (!stated && !QUANTITY_AFTER.test(after) && !take && !adjacent) return null;
    // A partial name that a longer product of the catalogue also answers to («audífonos aurora» with an «… Pro» on sale): ask which.
    if (!wholeName) {
        const said = tokensOf(text.slice(at.start, at.end)).filter(token => token.length >= 3 && !SKIP_TOKENS.has(token));
        const also = catalog.filter(other => other.id !== product.id && typeof other.title === 'string'
            && said.every(token => tokensOf(fold(other.title)).some(word => sameWord(word, token))));
        if (also.length) return { choose: [product, ...also], quantity };
    }
    const notes = deliveryClauses(raw);
    return { product, quantity, ...(notes ? { notes } : {}) };
}

/** What the order message itself says about delivery or collection, clause by clause («envíelo a la Calle 5»). */
function deliveryClauses(raw: string): string {
    const kept = String(raw ?? '').split(/[,;.]/).map(part => part.trim()).filter(part => part && DETAILS_CUE.test(fold(part)));
    return mergeOrderNotes(undefined, kept.join(', '));
}

/** Words that give the order's delivery or collection: an address, «sin envío», «lo recojo». */
const DETAILS_CUE = /\b(?:envi\w*|direccion|domicilio|calle|carrera|cra|avenida|diagonal|transversal|barrio|conjunto|apto|apartamento|torre|recoger\w*|recojo|retir\w*|despach\w*|entreg\w*|ship\w*|deliver\w*|pick ?up|address|envoyer|livr\w*|adresse|endereco)\b/;

/**
 * While a proposal to place an order is waiting, a message that gives its delivery («envíelo a la Calle 5», «sin envío por ahora»)
 * belongs to that order: it is added to the order's notes and the proposal is made again. A question, a cancellation or anything
 * that is not about delivery is not (the model answers it, and the proposal keeps waiting).
 */
export function isOrderDetails(raw: string): boolean {
    const original = String(raw ?? '');
    if (!original.trim() || original.length > 400) return false;
    const text = fold(original);
    if (/[?¿]/.test(text) || isInformationSeekingMessage(original)) return false;
    const plain = text.replace(/[,.;!?¿¡]/g, ' ').replace(/\s+/g, ' ').trim();
    if (/\b(?:cancel\w*|anul\w*|devol\w*|reembols\w*|cita|turno)\b/.test(plain)) return false;
    return DETAILS_CUE.test(plain);
}

/** The notes of the order: what it already had, then what the customer just said (bounded). */
export function mergeOrderNotes(previous: unknown, added: string): string {
    const before = typeof previous === 'string' ? previous.trim() : '';
    const extra = String(added ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!extra) return before;
    if (before && fold(before).includes(fold(extra))) return before;
    return (before ? `${before}. ${extra}` : extra).slice(0, 600);
}

// ── Texts ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Lang = 'es' | 'en' | 'pt' | 'fr';
const LOCALES: Record<Lang, string> = { es: 'es-CO', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR' };
const langOf = (language?: string): Lang => (['es', 'en', 'pt', 'fr'].includes(String(language).slice(0, 2).toLowerCase())
    ? String(language).slice(0, 2).toLowerCase() : 'es') as Lang;

/** Cents (a string, as the catalogue terms carry them) to a readable amount: «119.900 COP». */
export function formatCents(cents: unknown, currency: unknown, lang: Lang, locale?: string): string {
    let amount: number;
    try { amount = Number(BigInt(String(cents))) / 100; } catch { return ''; }
    if (!Number.isFinite(amount)) return '';
    const code = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency.trim()) ? currency.trim().toUpperCase() : '';
    const written = amount.toLocaleString(locale || LOCALES[lang], { maximumFractionDigits: 2 });
    return code ? `${written} ${code}` : written;
}

const formatAmount = (value: unknown, currency: unknown, lang: Lang, locale?: string): string => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '';
    const code = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency.trim()) ? currency.trim().toUpperCase() : '';
    const written = amount.toLocaleString(locale || LOCALES[lang], { maximumFractionDigits: 2 });
    return code ? `${written} ${code}` : written;
};

interface OrderTerms { currency?: string; totalAmountCents?: string; notes?: string; items?: Array<{ productName?: string; quantity?: number; unitAmountCents?: string; totalAmountCents?: string }> }

/** The exact terms of the order the central guard is waiting on, written for the customer. Null when the terms cannot be read. */
export function orderProposalText(terms: OrderTerms | undefined, language: string | undefined, form: AddressForm = 'usted', locale?: string): string | null {
    const lang = langOf(language);
    const items = Array.isArray(terms?.items) ? terms!.items! : [];
    if (!terms || !items.length) return null;
    const lines = items.map(item => {
        const unit = formatCents(item.unitAmountCents, terms.currency, lang, locale);
        const name = String(item.productName ?? '').trim();
        if (!name || !Number.isInteger(item.quantity)) return '';
        return lang === 'en' ? `- ${item.quantity} × ${name}${unit ? ` (${unit} each)` : ''}`
            : lang === 'fr' ? `- ${item.quantity} × ${name}${unit ? ` (${unit} l'unité)` : ''}`
            : lang === 'pt' ? `- ${item.quantity} × ${name}${unit ? ` (${unit} cada)` : ''}`
            : `- ${item.quantity} × ${name}${unit ? ` (${unit} c/u)` : ''}`;
    });
    const total = formatCents(terms.totalAmountCents, terms.currency, lang, locale);
    if (lines.some(line => !line) || !total) return null;
    const notes = typeof terms.notes === 'string' ? terms.notes.trim() : '';
    const tu = form === 'tu' && lang === 'es';
    const head = {
        es: tu ? 'Este es tu pedido:' : 'Este es su pedido:', en: 'Here is your order:', pt: 'Este é o seu pedido:', fr: 'Voici votre commande :',
    }[lang];
    const totalLine = { es: `- Total: ${total}`, en: `- Total: ${total}`, pt: `- Total: ${total}`, fr: `- Total : ${total}` }[lang];
    const notesLine = notes ? { es: `- Notas: ${notes}`, en: `- Notes: ${notes}`, pt: `- Notas: ${notes}`, fr: `- Notes : ${notes}` }[lang] : '';
    const ask = {
        es: tu ? '¿Confirmas que quieres realizar este pedido? Queda registrado como pendiente y no es un pago. Si lo quieres con envío, dime la dirección.'
            : '¿Confirma que desea realizar este pedido? Queda registrado como pendiente y no es un pago. Si lo quiere con envío, indíqueme la dirección.',
        en: 'Do you confirm you want to place this order? It is recorded as pending and is not a payment. If you want it delivered, tell me the address.',
        pt: 'Confirma que deseja fazer este pedido? Fica registrado como pendente e não é um pagamento. Se quiser com entrega, informe o endereço.',
        fr: 'Confirmez-vous cette commande ? Elle est enregistrée comme en attente et ce n’est pas un paiement. Si vous la voulez livrée, indiquez-moi l’adresse.',
    }[lang];
    return [head, ...lines, totalLine, ...(notesLine ? [notesLine] : []), ask].join('\n');
}

/** Two or more products answer to the words the customer used: asked, never guessed. */
export function orderChoiceText(options: readonly IntakeProduct[], language: string | undefined, form: AddressForm = 'usted'): string {
    const lang = langOf(language);
    const tu = form === 'tu' && lang === 'es';
    const names = options.map(product => product.title);
    const listed = names.length > 1 ? `${names.slice(0, -1).join(', ')} ${{ es: 'o', en: 'or', pt: 'ou', fr: 'ou' }[lang]} ${names[names.length - 1]}` : names.join('');
    return {
        es: `Tengo más de un producto con ese nombre: ${listed}. ${tu ? '¿Cuál quieres?' : '¿Cuál desea?'}`,
        en: `I have more than one product with that name: ${listed}. Which one would you like?`,
        pt: `Tenho mais de um produto com esse nome: ${listed}. Qual você quer?`,
        fr: `J’ai plusieurs produits portant ce nom : ${listed}. Lequel souhaitez-vous ?`,
    }[lang];
}

/** Not enough of the product, or none: said by the server from the catalogue's own number. */
export function orderStockText(product: IntakeProduct, quantity: number, language: string | undefined, form: AddressForm = 'usted'): string {
    const lang = langOf(language);
    const left = typeof product.stock === 'number' && Number.isFinite(product.stock) ? Math.max(0, Math.floor(product.stock)) : 0;
    const tu = form === 'tu' && lang === 'es';
    if (left <= 0) {
        return {
            es: `Por ahora no tengo unidades disponibles de ${product.title}. ${tu ? '¿Quieres que te ayude con otro producto?' : '¿Desea que le ayude con otro producto?'}`,
            en: `I have no units of ${product.title} available right now. Can I help you with another product?`,
            pt: `No momento não tenho unidades disponíveis de ${product.title}. Posso ajudar com outro produto?`,
            fr: `Je n’ai plus d’unités de ${product.title} pour le moment. Puis-je vous aider avec un autre produit ?`,
        }[lang];
    }
    return {
        es: `Solo tengo ${left} ${left === 1 ? 'unidad' : 'unidades'} de ${product.title} (${tu ? 'pediste' : 'pidió'} ${quantity}). ${tu ? '¿Quieres ese número de unidades?' : '¿Desea esa cantidad?'}`,
        en: `I only have ${left} ${left === 1 ? 'unit' : 'units'} of ${product.title} (you asked for ${quantity}). Would you like that amount?`,
        pt: `Só tenho ${left} ${left === 1 ? 'unidade' : 'unidades'} de ${product.title} (você pediu ${quantity}). Quer essa quantidade?`,
        fr: `Je n’ai que ${left} ${left === 1 ? 'unité' : 'unités'} de ${product.title} (vous en avez demandé ${quantity}). Souhaitez-vous cette quantité ?`,
    }[lang];
}

/**
 * What the customer is told about a record the server just created, from the record itself (the reference is the one the
 * listings show). Null when the result is not one it can state: a pending payment, a missing id, a failure.
 */
export function createdDoneText(toolName: string, args: any, result: any, language: string | undefined, form: AddressForm = 'usted', todayIso?: string, locale?: string): string | null {
    if (!result || result.error || result.success === false) return null;
    const lang = langOf(language);
    const tu = form === 'tu' && lang === 'es';
    if (toolName === 'place_catalog_order') {
        const order = result.order ?? {};
        const ref = shortReference(order.id);
        const items: any[] = Array.isArray(order.items) ? order.items : [];
        if (!ref || !items.length) return null;
        const lines = items.map(item => `- ${Number(item.quantity)} × ${String(item.productName ?? '').trim()}`);
        if (lines.some(line => /× $/.test(line) || /NaN/.test(line))) return null;
        const total = formatAmount(order.totalAmount ?? order.total, order.currency, lang, locale);
        const head = {
            es: `${tu ? 'Tu' : 'Su'} pedido (Ref. ${ref}) quedó registrado:`, en: `Your order (Ref. ${ref}) has been recorded:`,
            pt: `O seu pedido (Ref. ${ref}) ficou registrado:`, fr: `Votre commande (Réf. ${ref}) a été enregistrée :`,
        }[lang];
        const status = {
            es: 'Estado: pendiente. Pago: pendiente. Entrega: por registrar.', en: 'Status: pending. Payment: pending. Delivery: not yet recorded.',
            pt: 'Estado: pendente. Pagamento: pendente. Entrega: a registrar.', fr: 'Statut : en attente. Paiement : en attente. Livraison : à enregistrer.',
        }[lang];
        return [head, ...lines, ...(total ? [`- Total: ${total}`] : []), status].join('\n');
    }
    if (toolName === 'create_appointment') {
        const appointment = result.appointment ?? {};
        // A payment to make, a meeting link or a vehicle to name carry more than this sentence can say: the model voices those.
        if (appointment.awaitingPayment === true || appointment.status === 'pending_payment' || appointment.meetingUrl || appointment.vehicleId) return null;
        const ref = shortReference(appointment.id);
        const date = String(appointment.date ?? args?.date ?? '');
        const time = String(appointment.time ?? args?.time ?? '');
        const service = String(appointment.service ?? appointment.serviceName ?? '').trim();
        if (!ref || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}/.test(time)) return null;
        const confirmed = !appointment.status || ['confirmed', 'scheduled', 'booked'].includes(String(appointment.status));
        const day = formatDay(date, lang, todayIso);
        const at = time.slice(0, 5);
        const subject = service ? { es: ` de ${service}`, en: ` for ${service}`, pt: ` de ${service}`, fr: ` pour ${service}` }[lang] : '';
        return {
            es: `${tu ? 'Tu' : 'Su'} cita${subject} quedó ${confirmed ? 'confirmada' : 'registrada'} para el ${day} a las ${at}. Ref. ${ref}.`,
            en: `Your appointment${subject} is ${confirmed ? 'confirmed' : 'recorded'} for ${day} at ${at}. Ref. ${ref}.`,
            pt: `O seu agendamento${subject} ficou ${confirmed ? 'confirmado' : 'registrado'} para ${day} às ${at}. Ref. ${ref}.`,
            fr: `Votre rendez-vous${subject} est ${confirmed ? 'confirmé' : 'enregistré'} pour le ${day} à ${at}. Réf. ${ref}.`,
        }[lang];
    }
    return null;
}
