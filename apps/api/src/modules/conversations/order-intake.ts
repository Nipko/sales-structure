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
    /** The delivery or collection the same message gave («envíelo a la Calle 5»), as the order's canonical delivery line (see `deliveryLine`). */
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

interface Span { start: number; end: number; /** The whole name was said, not a part of it. */ whole: boolean }

/** Where the product's name sits in the (folded) text, or -1. */
function findProduct(text: string, title: string): Span | -1 {
    const name = fold(title);
    if (name.length < 3) return -1;
    const whole = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${escapeRegex(name)}(?:e?s)?)(?![\\p{L}\\p{N}])`, 'u').exec(text);
    if (whole) {
        const start = whole.index + whole[0].indexOf(whole[1]);
        return { start, end: start + whole[1].length, whole: true };
    }
    const words = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map(match => ({ word: match[0], start: match.index!, end: match.index! + match[0].length }));
    // Every significant word of the name, in any order, plurals tolerated («audífonos Aurora» for «Audífono QA Aurora»).
    const wanted = tokensOf(name).filter(token => token.length >= 3 && !SKIP_TOKENS.has(token));
    if (wanted.length >= 2) {
        const hits = wanted.map(token => words.find(word => sameWord(word.word, token)));
        if (!hits.some(hit => !hit)) return { start: Math.min(...hits.map(hit => hit!.start)), end: Math.max(...hits.map(hit => hit!.end)), whole: false };
    }
    // A PART of the name: «audífonos aurora» for «Audífono Inalámbrico Aurora». The customer's words run together (a «de» or «la» may sit
    // between two of them), every one of them is a word of the name, and there are at least two: one word alone names nothing.
    const nameWords = tokensOf(name).filter(token => !SKIP_TOKENS.has(token));
    let best: { start: number; end: number; count: number } | null = null;
    let run: Array<{ index: number; name: string }> = [];
    const flush = () => {
        const distinct = new Set(run.map(entry => entry.name));
        if (distinct.size >= 2 && (!best || distinct.size > best.count)) {
            best = { start: words[run[0].index].start, end: words[run[run.length - 1].index].end, count: distinct.size };
        }
        run = [];
    };
    words.forEach((word, index) => {
        const hit = nameWords.find(candidate => sameWord(word.word, candidate));
        if (hit) run.push({ index, name: hit });
        else if (!(SKIP_TOKENS.has(word.word) && run.length)) flush();
    });
    flush();
    const found = best as { start: number; end: number; count: number } | null;
    return found ? { start: found.start, end: found.end, whole: false } : -1;
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
        .filter((hit): hit is { product: IntakeProduct; at: Span } => hit.at !== -1);
    if (!found.length) return null;
    // A part of a name only counts where no product's whole name was said over the same words («Audífono QA Aurora» said in full is not
    // also a part of «Audífono QA Aurora Pro»).
    const wholes = found.filter(hit => hit.at.whole);
    const candidates = wholes.length ? found.filter(hit => hit.at.whole || !wholes.some(other => other.at.start < hit.at.end && hit.at.start < other.at.end)) : found;
    // «Audífono QA Aurora» and «Audífono QA Aurora Pro» both said in full: when one name contains the other, the longer one is what was said.
    const best = candidates.filter(hit => !candidates.some(other => other !== hit && other.at.whole
        && other.at.start <= hit.at.start && other.at.end >= hit.at.end && fold(other.product.title).length > fold(hit.product.title).length));
    const unique = new Map(best.map(hit => [hit.product.id, hit]));
    const answering = [...unique.values()];
    // Two products answer to the very same part of a name («audífonos aurora» → «Audífono QA Aurora» and «Audífono Inalámbrico Aurora»):
    // asked which, once the quantity below is read. Any other pair of products in one message is not an order.
    const samePart = answering.length > 1 && answering.every(hit => !hit.at.whole && hit.at.start === answering[0].at.start && hit.at.end === answering[0].at.end);
    if (answering.length !== 1 && !samePart) return null;
    const { product, at } = answering[0];
    const wholeName = at.whole;

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
    if (samePart) return { choose: answering.map(hit => hit.product), quantity };
    // A partial name that a longer product of the catalogue also answers to («audífonos aurora» with an «… Pro» on sale): ask which.
    if (!wholeName) {
        const said = tokensOf(text.slice(at.start, at.end)).filter(token => token.length >= 3 && !SKIP_TOKENS.has(token));
        const also = catalog.filter(other => other.id !== product.id && typeof other.title === 'string'
            && said.every(token => tokensOf(fold(other.title)).some(word => sameWord(word, token))));
        if (also.length) return { choose: [product, ...also], quantity };
    }
    // The delivery or the collection the message gives, read without the product's own words («Kit de envío» is a product, not a shipment).
    const delivery = readDelivery(maskWords(String(raw ?? ''), tokensOf(fold(product.title))));
    return { product, quantity, ...(delivery ? { notes: deliveryLine(delivery.delivery) } : {}) };
}

// ── Delivery ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What the customer said about how the order reaches them. The catalogue order has no column for it (`orders` holds the items, the
 * total and free `notes`), so it travels as ONE canonical line at the end of the notes — «Envío a: Calle 5 #4-3», «Recojo en tienda»,
 * «Con envío (dirección pendiente)» — which the proposal and the record read back as a delivery of their own, and which the team
 * reads in the order. Never a free sentence the customer has to repeat.
 */
export type Delivery = { kind: 'ship'; address?: string } | { kind: 'pickup' };
export interface DeliveryRead { delivery: Delivery; /** Where in the text it was said (so the rest of the text can be kept as notes). */ start: number; end: number }

const SHIP_NOTE = 'Envío a: ';
const PICKUP_NOTE = 'Recojo en tienda';
const SHIP_PENDING_NOTE = 'Con envío (dirección pendiente)';

/** «sin envío», «lo recojo», «retiro en tienda», «pick up»: the order is collected, nothing is shipped. */
const PICKUP_CUE = /\b(?:sin (?:envio|domicilio|despacho)|no (?:quiero|necesito|requiero) (?:el |un )?(?:envio|domicilio|despacho)|(?:lo|la|los|las) (?:recojo|recogo|retiro|busco)|(?:paso|pasare|voy|ire|vengo|viene|vamos|iremos) (?:a|por) (?:recog|retir|busc)\w*|recog\w*|recojo|retirar\w*|retiro en (?:la |el |su |mi )?(?:tienda|local|sucursal|almacen|punto)|pick ?up|pick it up|i ll collect|collect(?:ion)?|sans livraison|je viens (?:le |la )?(?:chercher|retirer)|(?:vou|vamos) (?:retirar|buscar)|retirada na loja)\b/;
/**
 * What says the ORDER is sent: «envíelo», «me lo envían», «a domicilio», «con envío», «ship it», an address. A bare «enviar» with another
 * object — «me envían la factura», «envíenme info de la garantía» — is not a shipment of the order.
 */
const SHIP_CUE = new RegExp([
    '\\b(?:envi|mand|despach|entreg|llev)\\w*(?:lo|la|los|las)\\b',
    '\\b(?:lo|la|los|las) (?:\\w+ ){0,2}(?:envi|mand|despach|entreg)\\w*',
    '\\b(?:con|quiero|necesito|incluya|incluye|incluir) (?:el |un )?(?:envio|domicilio|despacho)\\b',
    '\\b(?:a )?domicilio\\b|\\bdespacho a\\b',
    '\\b(?:ship|deliver|send)\\s+(?:it|them|this|that|my order|the order)\\b|\\bshipping\\b|\\bdelivery\\b',
    '\\b(?:envoy|livr)\\w*[- ](?:le|la|les)\\b|\\bavec livraison\\b',
    '\\b(?:envi|mand|entreg)\\w*-(?:o|a|os|as)\\b|\\bcom (?:envio|entrega)\\b',
    '\\b(?:mi |nuestra |la |my |our )?(?:direccion|address|adresse|endereco)\\s*(?:es|is|est|:|-)\\s*\\S',
].join('|'));
/** A street of a city: «Calle 5», «Carrera 7 # 32-16», «Cl 5», «Avenida 68». It needs its number, so a product called «Torre» is not an address. */
const STREET = /\b(?:calle|carrera|cra|kr|cl|cr|avenida|av|diagonal|dg|transversal|autopista|circular|street|avenue|rue|rua)\.?\s*(?:#\s*)?\d/;
/** «envíelo a …», «enviar a la …», «ship to …»: what follows is where. */
const SHIP_TO = /\b(?:envi\w*|mand\w*|entreg\w*|despach\w*|llev\w*|ship\w*|deliver\w*|send\w*)(?:\s+(?:lo|la|los|las|me|nos|le|it|them))*\s+(?:a|al|en|hasta|para|to|at|in)\s+(?:(?:la|el|los|las|the)\s+)?/;
/** «mi dirección es …», «dirección: …». */
const ADDRESS_IS = /\b(?:direccion|address|adresse|endereco)\s*(?:es|is|est|e|:|-)?\s*:?\s*/;

/** Lower case, accents removed, ONE character per character of the input (so an index in the result is an index in the original). */
function alignedFold(text: string): string {
    let out = '';
    for (let index = 0; index < text.length; index++) {
        const folded = text[index].normalize('NFD').replace(/[̀-ͯ]/g, '');
        out += folded.length === 1 ? folded.toLowerCase() : folded.length === 0 ? ' ' : folded[0].toLowerCase();
    }
    return out;
}

/** The text with the given words (and their plurals) blanked out, character for character: the product's name is not a delivery. */
function maskWords(text: string, words: readonly string[]): string {
    const folded = alignedFold(text);
    let masked = text;
    for (const word of words) {
        if (word.length < 3) continue;
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(word)}(?:e?s)?(?![\\p{L}\\p{N}])`, 'gu');
        for (const match of folded.matchAll(pattern)) masked = masked.slice(0, match.index!) + ' '.repeat(match[0].length) + masked.slice(match.index! + match[0].length);
    }
    return masked;
}

function addressIn(text: string, folded: string, start: number, end: number): string {
    const segment = folded.slice(start, end);
    let from = -1;
    const street = STREET.exec(segment);
    if (street) from = start + street.index;
    else {
        const shipTo = SHIP_TO.exec(segment);
        if (shipTo) from = start + shipTo.index + shipTo[0].length;
        else {
            const stated = ADDRESS_IS.exec(segment);
            if (stated) from = start + stated.index + stated[0].length;
        }
    }
    if (from < 0 || from >= end) return '';
    const address = text.slice(from, end).trim().replace(/[\s.,;:!]+$/, '');
    // «con envío a domicilio»: «domicilio» is how, not where.
    if (!address || /^(?:domicilio|direccion|la direccion|mi direccion)$/.test(alignedFold(address))) return '';
    return address.slice(0, 200);
}

/**
 * The delivery or collection a text states, with where in the text it was said; null when it says nothing about it. Clause by clause
 * (a clause ends at «.», «;», «!», «?» or a line break; a comma splits a clause into parts, because the customer lists «1 unidad, a
 * nombre de Ana, sin envío»); the last clause that says something wins, since a customer corrects themselves toward the end.
 * A pickup part is only that part; a shipment runs from the part that says «envíelo» to the end of the clause, so an address with
 * commas («Calle 123 #45-67, Bogotá») stays whole.
 */
export function readDelivery(raw: string): DeliveryRead | null {
    const text = String(raw ?? '');
    const folded = alignedFold(text);
    const cuts: number[] = [0];
    for (const match of folded.matchAll(/[;!?\n]|\.(?=\s|$)/g)) cuts.push(match.index! + 1);
    cuts.push(folded.length);
    let found: DeliveryRead | null = null;
    for (let c = 0; c < cuts.length - 1; c++) {
        const clauseStart = cuts[c];
        const clauseEnd = cuts[c + 1];
        const clause = folded.slice(clauseStart, clauseEnd);
        if (!clause.trim()) continue;
        const bounds = [clauseStart, ...[...clause.matchAll(/,/g)].map(match => clauseStart + match.index! + 1), clauseEnd];
        const parts = bounds.slice(0, -1).map((from, index) => [from, bounds[index + 1]] as const);
        const pickup = parts.find(([from, to]) => PICKUP_CUE.test(folded.slice(from, to)));
        if (pickup) { found = { delivery: { kind: 'pickup' }, start: pickup[0], end: pickup[1] }; continue; }
        const ship = parts.find(([from, to]) => SHIP_CUE.test(folded.slice(from, to)) || STREET.test(folded.slice(from, to)));
        if (!ship) continue;
        const address = addressIn(text, folded, ship[0], clauseEnd);
        found = { delivery: address ? { kind: 'ship', address } : { kind: 'ship' }, start: ship[0], end: clauseEnd };
    }
    return found;
}

export function deliveryFrom(raw: string): Delivery | null {
    return readDelivery(raw)?.delivery ?? null;
}

/** The canonical line of the notes for a delivery. */
export function deliveryLine(delivery: Delivery): string {
    return delivery.kind === 'pickup' ? PICKUP_NOTE : delivery.address ? `${SHIP_NOTE}${delivery.address}` : SHIP_PENDING_NOTE;
}

/** The notes of an order apart from their canonical delivery line (which is the notes' last sentence), and the delivery it holds. */
export function splitDeliveryNote(notes: unknown): { rest: string; delivery: Delivery | null } {
    const text = typeof notes === 'string' ? notes.trim() : '';
    const match = /(?:^|\.\s+)(Envío a: [^]+|Recojo en tienda|Con envío \(dirección pendiente\))$/.exec(text);
    if (!match) return { rest: text, delivery: null };
    const line = match[1];
    const delivery: Delivery = line === PICKUP_NOTE ? { kind: 'pickup' }
        : line === SHIP_PENDING_NOTE ? { kind: 'ship' } : { kind: 'ship', address: line.slice(SHIP_NOTE.length).trim() };
    return { rest: text.slice(0, match.index).trim(), delivery };
}

/** The delivery an order's notes state: the canonical line, or (a model wrote the notes) the words read as a customer's. */
export function deliveryOfNotes(notes: unknown): { rest: string; delivery: Delivery | null; canonical: boolean } {
    const split = splitDeliveryNote(notes);
    if (split.delivery) return { ...split, canonical: true };
    return { rest: split.rest, delivery: split.rest ? deliveryFrom(split.rest) : null, canonical: false };
}

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
    // «me envían la factura por favor» names a shipment word and states no delivery of the order: the model answers it.
    return DETAILS_CUE.test(plain) && readDelivery(original) !== null;
}

/** Words that give the order's delivery or collection: an address, «sin envío», «lo recojo». */
const DETAILS_CUE = /\b(?:envi\w*|direccion|domicilio|calle|carrera|cra|avenida|diagonal|transversal|barrio|conjunto|apto|apartamento|torre|recoger\w*|recojo|retir\w*|despach\w*|entreg\w*|ship\w*|deliver\w*|pick ?up|address|envoyer|livr\w*|adresse|endereco)\b/;

const tidy = (text: string): string => text.replace(/\s+/g, ' ').replace(/^[\s,;.]+|[\s,;.]+$/g, '').trim();

/** The notes the order already has, with the delivery they state (canonical line, or the customer's words read as one) taken apart. */
function priorNotes(previous: unknown): { rest: string; delivery: Delivery | null } {
    const split = splitDeliveryNote(previous);
    if (split.delivery || !split.rest) return split;
    const read = readDelivery(split.rest);
    if (!read) return split;
    return { rest: tidy(`${split.rest.slice(0, read.start)} ${split.rest.slice(read.end)}`), delivery: read.delivery };
}

/**
 * The notes of the order. While a proposal is waiting, a message that gives its delivery («envíelo a la Calle 5», «sin envío por ahora»)
 * belongs to that order: the delivery it states replaces the one the notes had (one canonical line, the last sentence), whatever else
 * the customer said stays as written (bounded), and the proposal is made again.
 */
export function mergeOrderNotes(previous: unknown, added: string): string {
    const before = priorNotes(previous);
    const extra = String(added ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const read = extra ? readDelivery(extra) : null;
    const other = read ? tidy(`${extra.slice(0, read.start)} ${extra.slice(read.end)}`) : extra;
    let rest = before.rest;
    if (other && !(rest && fold(rest).includes(fold(other)))) rest = rest ? `${rest}. ${other}` : other;
    const line = read ? deliveryLine(read.delivery) : before.delivery ? deliveryLine(before.delivery) : '';
    if (!line) return rest.slice(0, 600);
    return (rest ? `${rest.slice(0, Math.max(0, 600 - line.length - 2))}. ${line}` : line).slice(0, 600);
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

/** The delivery as a phrase: «envío a Calle 5 #4-3», «recojo en tienda». */
function deliveryPhrase(delivery: Delivery, lang: Lang): string {
    if (delivery.kind === 'pickup') return { es: 'recojo en tienda', en: 'pickup at the store', pt: 'retirada na loja', fr: 'retrait en magasin' }[lang];
    if (delivery.address) {
        return { es: `envío a ${delivery.address}`, en: `shipping to ${delivery.address}`, pt: `envio para ${delivery.address}`, fr: `envoi à ${delivery.address}` }[lang];
    }
    return { es: 'con envío (falta la dirección)', en: 'shipping (the address is still needed)', pt: 'com envio (falta o endereço)', fr: 'avec livraison (l’adresse manque)' }[lang];
}

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
    // The canonical delivery line is shown as the delivery; what the model wrote in the notes stays as written (a delivery it also states is shown too).
    const { rest: notes, delivery } = deliveryOfNotes(terms.notes);
    const tu = form === 'tu' && lang === 'es';
    const head = {
        es: tu ? 'Este es tu pedido:' : 'Este es su pedido:', en: 'Here is your order:', pt: 'Este é o seu pedido:', fr: 'Voici votre commande :',
    }[lang];
    const totalLine = { es: `- Total: ${total}`, en: `- Total: ${total}`, pt: `- Total: ${total}`, fr: `- Total : ${total}` }[lang];
    const deliveryLabel = { es: 'Entrega', en: 'Delivery', pt: 'Entrega', fr: 'Livraison :' }[lang];
    const deliveryLineText = delivery ? `- ${deliveryLabel}${lang === 'fr' ? '' : ':'} ${deliveryPhrase(delivery, lang)}` : '';
    const notesLine = notes ? { es: `- Notas: ${notes}`, en: `- Notes: ${notes}`, pt: `- Notas: ${notes}`, fr: `- Notes : ${notes}` }[lang] : '';
    const confirm = {
        es: tu ? '¿Confirmas que quieres realizar este pedido? Queda registrado como pendiente y no es un pago.'
            : '¿Confirma que desea realizar este pedido? Queda registrado como pendiente y no es un pago.',
        en: 'Do you confirm you want to place this order? It is recorded as pending and is not a payment.',
        pt: 'Confirma que deseja fazer este pedido? Fica registrado como pendente e não é um pagamento.',
        fr: 'Confirmez-vous cette commande ? Elle est enregistrée comme en attente et ce n’est pas un paiement.',
    }[lang];
    // What is still asked about delivery: nothing when it is known (an address or a pickup), the address when only «con envío» was said,
    // and the offer of a shipment when nothing was said.
    const deliveryAsk = !delivery ? {
        es: tu ? 'Si lo quieres con envío, dime la dirección.' : 'Si lo quiere con envío, indíqueme la dirección.',
        en: 'If you want it delivered, tell me the address.',
        pt: 'Se quiser com entrega, informe o endereço.',
        fr: 'Si vous la voulez livrée, indiquez-moi l’adresse.',
    }[lang] : delivery.kind === 'ship' && !delivery.address ? {
        es: tu ? 'Dime la dirección de envío.' : 'Indíqueme la dirección de envío.',
        en: 'Tell me the delivery address.',
        pt: 'Informe o endereço de entrega.',
        fr: 'Indiquez-moi l’adresse de livraison.',
    }[lang] : '';
    return [head, ...lines, totalLine, ...(deliveryLineText ? [deliveryLineText] : []), ...(notesLine ? [notesLine] : []),
        deliveryAsk ? `${confirm} ${deliveryAsk}` : confirm].join('\n');
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
 * A reply that, besides whatever else it says, still ASKS the customer to confirm what has just been recorded: «¿Me confirma si agendo la
 * cita…?», «¿Confirma que desea realizar este pedido?», «Shall I book it?». Said after a booking / an order was created in the same turn
 * it contradicts the record (production 2026-10-10, Salón QA Citas: that question, then «¡Cita confirmada! … Ref. A72599D6»).
 * Only a QUESTION counts, and «confirmada» / «confirmed» (the record's own word) is not a request to confirm.
 */
export function replyStillAsksConfirmation(reply: string): boolean {
    const text = alignedFold(String(reply ?? ''));
    // Asking to do / confirm THIS record: «¿Lo agendo?», «¿Me confirma si agendo la cita?», «¿Confirma que desea realizar este pedido?».
    const OFFERS_TO_ACT = /\b(?:(?:lo|la) (?:agendo|registro|reservo|confirmo)|le (?:agendo|reservo|registro|confirmo) (?:la|el|su|este|esta) (?:cita|pedido|reserva|orden|compra)|agendo la|shall i|should i (?:book|place|confirm|schedule|go ahead|proceed)|(?:do you want|would you like) me to (?:book|place|confirm|schedule|go ahead|proceed)|(?:desea|deseas|quiere|quieres|deseja|quer) que (?:le |lo |la |te )?(?:proceda|continue|finalice|proceed)\w*|voulez-vous que je (?:le |la )?(?:reserve|confirme))\b/;
    const ASKS_TO_CONFIRM = /\bconfirm(?:a|as|e|es|ez|ar|o)?\b/;
    const RECORD_NOUN = /\b(?:pedido|orden|cita|reserva|agend\w*|order|appointment|booking|commande|rendez-vous|reservation|compra|purchase)\b/;
    // A follow-up about something else (another appointment, a confirmation by e-mail, the address of the shop, a reminder) is not a request
    // to confirm the record that was just created, and is not the contradiction this guard removes.
    const ANOTHER_THING = /\b(?:otra|otro|otras|otros|tambien|ademas|another|other|also|too|autre|autres|outra|outro|tambem|aussi|nuevo|nueva|new|siguiente|next|recordatorio|reminder|rappel|lembrete|correo|email|e-mail|mail|whatsapp|sms|direccion|address|adresse|endereco|ubicacion|location|factura|recibo|invoice|receipt|comprobante)\b/;
    for (let at = text.indexOf('?'); at >= 0; at = text.indexOf('?', at + 1)) {
        const start = Math.max(text.lastIndexOf('¿', at), text.lastIndexOf('. ', at), text.lastIndexOf('! ', at), text.lastIndexOf('\n', at)) + 1;
        const sentence = text.slice(start, at);
        if (ANOTHER_THING.test(sentence)) continue;
        if (OFFERS_TO_ACT.test(sentence) || (ASKS_TO_CONFIRM.test(sentence) && RECORD_NOUN.test(sentence))) return true;
    }
    return false;
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
        // What the customer asked for is told as asked, and as something to arrange: no shipment is recorded or promised here.
        const { delivery } = deliveryOfNotes(order.notes || args?.notes);
        const arranged = { es: 'por coordinar con el equipo', en: 'to be arranged with the team', pt: 'a combinar com a equipe', fr: 'à convenir avec l’équipe' }[lang];
        const status = {
            es: `Estado: pendiente. Pago: pendiente. Entrega: ${delivery ? `${deliveryPhrase(delivery, lang)} (${arranged})` : 'por registrar'}.`,
            en: `Status: pending. Payment: pending. Delivery: ${delivery ? `${deliveryPhrase(delivery, lang)} (${arranged})` : 'not yet recorded'}.`,
            pt: `Estado: pendente. Pagamento: pendente. Entrega: ${delivery ? `${deliveryPhrase(delivery, lang)} (${arranged})` : 'a registrar'}.`,
            fr: `Statut : en attente. Paiement : en attente. Livraison : ${delivery ? `${deliveryPhrase(delivery, lang)} (${arranged})` : 'à enregistrer'}.`,
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
