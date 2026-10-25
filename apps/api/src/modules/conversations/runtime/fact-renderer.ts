import type { FactTokenView, TurnContext, VerifiedFactView } from '@parallext/shared';
import { catalogPriceStatus } from '../catalog-price-status';
import { spokenItemName } from '../description-authority';
import { replyLanguageOf } from '../reply-language';
import { normalizeReplyAmounts } from '../reply-price-format';
import { quantitiesIn, ResponseValidatorService } from '../response-validator.service';
import { addressFormOf, humanizeReferences, localizeStatusWords, orderStatusLabel, type AddressForm } from '../transition-engine';
import { FACT_TTL_MS, factKey, verifiedFactViews, wellFormed, type VerifiedFact } from './facts-ledger';

/**
 * Rendered facts (operations runtime PR6, flag `agentRuntime.renderedFacts`).
 *
 * Production QA 2026-10-22: the model typed the numbers. «2 baños» for a listing whose record says bathrooms 1 and
 * bedrooms 2 (it mixed the fields); «ha hecho tres pedidos» when the customer has 6, all cancelled, read from a partial
 * list; «precio no confirmado» for a dish the menu priced at 13.500 COP, and a price it had read retracted once the
 * customer doubted it; amenities a hotel record does not list. Every one of those is a value the server already held.
 *
 * With the flag on the model writes a token instead of the value — `⟦fact:id⟧`, `⟦count:id⟧`, `⟦avail:id⟧` — and this
 * module puts the verified value in its place, in the customer's language and the data's currency. A sentence that
 * cites an unknown or expired id, an example price, a malformed token or a token copied from customer text or tool
 * data never reaches the customer as a raw token: it is replaced by a safe template. So is a sentence in which the
 * model typed an amount or a count itself, or affirmed an amenity no record lists, or denied a price the facts confirm.
 * Pure: the caller traces the outcome.
 */

export const FACT_TOKEN_RE = /⟦(fact|count|avail):([A-Za-z0-9_-]{1,40})⟧/g;
const TOKEN_BRACKETS = /[⟦⟧]/g;
/** Facts citable in one turn's prompt; the newest win. */
export const FACT_TOKENS_RENDER_MAX = 40;

type Lang = 'es' | 'en' | 'pt' | 'fr';
const langOf = (language?: string): Lang => {
    const code = String(language || 'es').slice(0, 2).toLowerCase();
    return code === 'en' || code === 'pt' || code === 'fr' ? code : 'es';
};

// ── Ids and the registry ─────────────────────────────────────────────────────

/** Stable short id of a fact: the same subject and field keep the same id across turns. */
export function factTokenId(fact: Pick<VerifiedFact, 'kind' | 'subject' | 'field'>): string {
    let hash = 0x811c9dc5;
    const key = factKey(fact);
    for (let i = 0; i < key.length; i++) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `f${hash.toString(36).padStart(7, '0')}`;
}

/** Text from customers or tools can never carry a token to the renderer: its brackets are made plain. */
export function neutralizeFactTokens(text: string): string {
    return typeof text === 'string' ? text.replace(TOKEN_BRACKETS, m => (m === '⟦' ? '[' : ']')) : text;
}

/** The facts of a turn by id: later facts (newer) replace earlier ones of the same key. Malformed entries are dropped. */
export function factRegistry(facts: readonly unknown[]): Map<string, VerifiedFact> {
    const byId = new Map<string, VerifiedFact>();
    for (const fact of facts) if (wellFormed(fact)) byId.set(factTokenId(fact), fact);
    return byId;
}

/**
 * What the prompt's turn block (`<turn>`) already projects as authority — the catalogue sample and the services with
 * their prices — as facts, so a price the model reads there is cited by token like one a tool returned.
 */
export function projectedCatalogFacts(turn: Partial<TurnContext>, at: Date): VerifiedFact[] {
    const facts: VerifiedFact[] = [];
    const observedAt = at.toISOString();
    const make = (kind: VerifiedFact['kind'], source: string, body: Omit<VerifiedFact, 'v' | 'kind' | 'source' | 'observedAt' | 'expiresAt'>): VerifiedFact => ({
        v: 1, kind, ...body, source: { tool: source }, observedAt, expiresAt: new Date(at.getTime() + FACT_TTL_MS[kind]).toISOString(),
    });
    for (const entry of turn.catalog || []) {
        if (!entry?.id) continue;
        const subject = { type: 'product', id: String(entry.id), ...(entry.title ? { name: String(entry.title).slice(0, 80) } : {}) };
        const priceStatus = catalogPriceStatus(entry.price, (entry as any).priceStatus);
        if (typeof entry.price === 'number' && Number.isFinite(entry.price) && priceStatus !== 'missing') {
            facts.push(make('money', 'turn_catalog', { subject, field: 'price', value: entry.price, priceStatus,
                ...(entry.currency ? { currency: String(entry.currency).toUpperCase() } : {}) }));
        }
        if (typeof entry.stock === 'number' && Number.isFinite(entry.stock)) facts.push(make('attribute', 'turn_catalog', { subject, field: 'stock', value: entry.stock }));
        if (typeof entry.inStock === 'boolean') facts.push(make('availability', 'turn_catalog', { subject, field: 'available', value: entry.inStock }));
    }
    for (const service of turn.availableServices || []) {
        if (!service?.id) continue;
        const subject = { type: 'service', id: String(service.id), ...(service.name ? { name: String(service.name).slice(0, 80) } : {}) };
        if (typeof service.price === 'number' && Number.isFinite(service.price)) {
            // Rule 22a: an <available_services> entry with a price and no price_status is confirmed.
            const priceStatus = service.priceStatus ?? catalogPriceStatus(service.price, undefined);
            if (priceStatus !== 'missing') facts.push(make('money', 'available_services', { subject, field: 'price', value: service.price, priceStatus,
                ...(service.currency ? { currency: String(service.currency).toUpperCase() } : {}) }));
        }
        if (typeof service.durationMinutes === 'number') facts.push(make('attribute', 'available_services', { subject, field: 'durationMinutes', value: service.durationMinutes }));
    }
    return facts;
}

const isLive = (fact: VerifiedFact, now: Date) => Date.parse(fact.expiresAt) > now.getTime();
const countable = (fact: VerifiedFact) => fact.kind === 'record_list'
    || (fact.kind === 'attribute' && (typeof fact.value === 'number' || Array.isArray(fact.value)));

function preview(fact: VerifiedFact): string {
    const value = Array.isArray(fact.value) ? fact.value.join(' | ') : String(fact.value);
    return neutralizeFactTokens(`${value}${fact.currency ? ` ${fact.currency}` : ''}`).slice(0, 120);
}

/** The prompt's view of the citable facts (`<turn><fact_tokens>`), newest last. Expired facts are not offered. */
export function factTokenViews(registry: Map<string, VerifiedFact>, now: Date): FactTokenView[] {
    return [...registry.entries()].filter(([, fact]) => isLive(fact, now)).slice(-FACT_TOKENS_RENDER_MAX).map(([id, fact]) => ({
        id, kind: fact.kind, subjectType: fact.subject.type, subjectId: fact.subject.id,
        ...(fact.subject.name ? { subjectName: neutralizeFactTokens(fact.subject.name) } : {}),
        field: fact.field,
        tokens: {
            fact: `⟦fact:${id}⟧`,
            ...(countable(fact) ? { count: `⟦count:${id}⟧` } : {}),
            ...(fact.kind === 'availability' ? { avail: `⟦avail:${id}⟧` } : {}),
        },
        preview: preview(fact),
        ...(fact.priceStatus ? { priceStatus: fact.priceStatus } : {}),
        ...(typeof fact.complete === 'boolean' ? { complete: fact.complete } : {}),
        ...(typeof fact.total === 'number' ? { total: fact.total } : {}),
    }));
}

/** The tokens of one tool result, attached to what the model reads (`fact_tokens`), with its brackets-free data. */
export function factTokensForToolResult(facts: readonly VerifiedFact[]): Array<Record<string, string>> {
    return facts.map(fact => {
        const id = factTokenId(fact);
        return {
            ...(fact.subject.name ? { subject: neutralizeFactTokens(fact.subject.name) } : { subject_id: fact.subject.id }),
            field: fact.field,
            ...(fact.priceStatus ? { price_status: fact.priceStatus } : {}),
            fact: `⟦fact:${id}⟧`,
            ...(countable(fact) ? { count: `⟦count:${id}⟧` } : {}),
            ...(fact.kind === 'availability' ? { avail: `⟦avail:${id}⟧` } : {}),
        };
    });
}

// ── Values ───────────────────────────────────────────────────────────────────

const WORDS: Record<Lang, { yes: string; no: string; available: string; unavailable: string; of: string; atLeast: string; status: string }> = {
    es: { yes: 'sí', no: 'no', available: 'disponible', unavailable: 'no disponible', of: 'de', atLeast: 'al menos', status: 'estado' },
    en: { yes: 'yes', no: 'no', available: 'available', unavailable: 'not available', of: 'of', atLeast: 'at least', status: 'status' },
    pt: { yes: 'sim', no: 'não', available: 'disponível', unavailable: 'indisponível', of: 'de', atLeast: 'pelo menos', status: 'situação' },
    fr: { yes: 'oui', no: 'non', available: 'disponible', unavailable: 'indisponible', of: 'sur', atLeast: 'au moins', status: 'statut' },
};

function listOf(items: string[], lang: Lang): string {
    try {
        return new (Intl as any).ListFormat(lang, { style: 'long', type: 'conjunction' }).format(items);
    } catch {
        return items.join(', ');
    }
}

function numberOf(value: number, locale: string): string {
    try {
        return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
    } catch {
        return String(value);
    }
}

export interface RenderContext { lang: Lang; locale: string; now: Date }
type Rendered = { ok: true; text: string } | { ok: false; reason: FallbackReason };

/** The money value as the customer reads it: the amount in the reply language's grouping, with the data's currency. */
function moneyText(fact: VerifiedFact, ctx: RenderContext): string {
    return normalizeReplyAmounts(`${fact.value}${fact.currency ? ` ${fact.currency}` : ''}`, ctx.locale)
        .replace(/^(\d+(?:\.\d+)?)$/, (_m, n) => numberOf(Number(n), ctx.locale));
}

function availabilityText(fact: VerifiedFact, ctx: RenderContext): string {
    const words = WORDS[ctx.lang];
    if (fact.value !== true) return words.unavailable;
    return fact.detail?.length ? `${words.available} (${fact.detail.map(neutralizeFactTokens).join(', ')})` : words.available;
}

function countText(fact: VerifiedFact, ctx: RenderContext): string | null {
    const words = WORDS[ctx.lang];
    if (fact.kind === 'record_list' && Array.isArray(fact.value)) {
        const shown = fact.value.length;
        const total = typeof fact.total === 'number' ? fact.total : undefined;
        if (total !== undefined && total > shown) return `${shown} ${words.of} ${total}`;
        if (fact.complete === false) return `${words.atLeast} ${Math.max(shown, total ?? 0)}`;
        return String(total ?? shown);
    }
    if (fact.kind === 'attribute') {
        if (typeof fact.value === 'number') return numberOf(fact.value, ctx.locale);
        if (Array.isArray(fact.value)) return String(fact.value.length);
    }
    return null;
}

function recordListText(fact: VerifiedFact, ctx: RenderContext): string {
    const words = WORDS[ctx.lang];
    const rows = (fact.value as string[]).map(row => {
        const [ref, ...status] = neutralizeFactTokens(row).split(' ');
        const shown = /^[0-9A-F]{8}$/.test(ref) ? `Ref. ${ref}` : ref;
        return status.length ? `${shown} (${words.status}: ${status.join(' ')})` : shown;
    });
    // Reused on purpose: the references and status words read exactly like the server's own listing.
    return localizeStatusWords(humanizeReferences(listOf(rows, ctx.lang)), ctx.lang);
}

function attributeText(fact: VerifiedFact, ctx: RenderContext): string {
    const words = WORDS[ctx.lang];
    if (typeof fact.value === 'boolean') return fact.value ? words.yes : words.no;
    if (typeof fact.value === 'number') return numberOf(fact.value, ctx.locale);
    if (Array.isArray(fact.value)) return listOf(fact.value.map(neutralizeFactTokens), ctx.lang);
    return neutralizeFactTokens(String(fact.value));
}

/** One token's value, or why it cannot be said. Never the token itself. */
export function renderToken(kind: string, fact: VerifiedFact | undefined, ctx: RenderContext): Rendered {
    if (!fact) return { ok: false, reason: 'unknown_fact' };
    if (!isLive(fact, ctx.now)) return { ok: false, reason: 'expired_fact' };
    if (kind === 'avail') return fact.kind === 'availability' ? { ok: true, text: availabilityText(fact, ctx) } : { ok: false, reason: 'wrong_token_kind' };
    if (kind === 'count') {
        const text = countText(fact, ctx);
        return text === null ? { ok: false, reason: 'wrong_token_kind' } : { ok: true, text };
    }
    switch (fact.kind) {
        // An example (or quote / missing) price is never rendered as a confirmed amount, and neither is 0: an empty price
        // column (`cleaningFee: 0` of a hotel room, production QA 2026-10-24: «The price of … is 0 COP») is a missing amount.
        case 'money': if (fact.priceStatus !== 'confirmed' || typeof fact.value !== 'number') return { ok: false, reason: 'example_price' };
            return fact.value > 0 ? { ok: true, text: moneyText(fact, ctx) } : { ok: false, reason: 'missing_price' };
        case 'availability': return { ok: true, text: availabilityText(fact, ctx) };
        case 'record_list': return Array.isArray(fact.value) ? { ok: true, text: recordListText(fact, ctx) } : { ok: false, reason: 'wrong_token_kind' };
        case 'record_status': return { ok: true, text: orderStatusLabel(fact.value, ctx.lang) };
        default: return { ok: true, text: attributeText(fact, ctx) };
    }
}

// ── Detection of what the model typed itself ─────────────────────────────────

export type FallbackReason = 'unknown_fact' | 'expired_fact' | 'wrong_token_kind' | 'example_price' | 'missing_price' | 'malformed_token'
    | 'untrusted_token' | 'unrendered_amount' | 'unrendered_count' | 'unbacked_amenity' | 'price_denied';

const norm = (text: string) => ` ${text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/m²/g, 'm2').replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** Number words of each reply language («dos» is «two» in Spanish but «of the» in Portuguese). «un/una/one» are articles, not counts. */
const NUMBER_WORDS: Record<Lang, string> = {
    es: 'dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce',
    en: 'two|three|four|five|six|seven|eight|nine|ten|eleven|twelve',
    pt: 'dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze',
    fr: 'deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze',
};
type CountCategory = 'bathrooms' | 'bedrooms' | 'area' | 'orders' | 'appointments' | 'bookings' | 'units';
const COUNT_NOUNS: Array<[CountCategory, string]> = [
    ['bathrooms', 'banos?|bathrooms?|banheiros?|salles? de bains?|salles? d eau'],
    ['bedrooms', 'habitacion|habitaciones|alcobas?|dormitorios?|cuartos|recamaras?|bedrooms?|quartos?|chambres?'],
    ['area', 'm2|mt2|metros cuadrados|square meters|square feet|sq ft|metres carres|metros quadrados'],
    ['orders', 'pedidos?|ordenes|orders?|encomendas?|commandes?'],
    ['appointments', 'citas?|appointments?|consultas?|rendez vous'],
    ['bookings', 'reservas?|reservaciones|reservations?|bookings?'],
    ['units', 'unidades|units|unites'],
];
const COUNT_RES = Object.fromEntries((Object.keys(NUMBER_WORDS) as Lang[]).map(lang => [lang,
    new RegExp(` ([0-9]+(?: [0-9]+)?|${NUMBER_WORDS[lang]}) (?:[a-z]+ )?(${COUNT_NOUNS.map(([, nouns]) => nouns).join('|')}) `, 'g')])) as Record<Lang, RegExp>;
const CATEGORY_FIELDS: Partial<Record<CountCategory, string[]>> = {
    bathrooms: ['bathrooms', 'banos'], bedrooms: ['bedrooms', 'rooms', 'habitaciones'], area: ['area', 'aream2', 'area_m2', 'areaM2'], units: ['stock'],
};
const CATEGORY_RECORDS: Partial<Record<CountCategory, RegExp>> = { orders: /order|pedido/, appointments: /appointment|cita/, bookings: /booking|reserv/ };

/** The value of a typed count: digits («13 500» is one number) or a number word of the reply language. */
function typedNumber(raw: string, lang: Lang): number | null {
    if (/^[0-9 ]+$/.test(raw)) return Number(raw.replace(/ /g, ''));
    const words = NUMBER_WORDS[lang].split('|');
    const index = words.indexOf(raw);
    if (index < 0) return null;
    // Portuguese has «dois» and «duas» for 2: every word after them is one lower in the list.
    return lang === 'pt' ? (index <= 1 ? 2 : index + 1) : index + 2;
}

interface TypedCount { category: CountCategory; value: number | null }
function typedCounts(sentence: string, lang: Lang): TypedCount[] {
    const text = norm(sentence);
    const found: TypedCount[] = [];
    for (const match of text.matchAll(COUNT_RES[lang])) {
        const noun = match[2];
        const category = COUNT_NOUNS.find(([, nouns]) => new RegExp(`^(?:${nouns})$`).test(noun))?.[0];
        if (category) found.push({ category, value: typedNumber(match[1], lang) });
    }
    return found;
}

function countCategories(sentence: string, lang: Lang): CountCategory[] {
    return [...new Set(typedCounts(sentence, lang).map(count => count.category))];
}

const AMENITY_TERMS = ['piscina', 'pool', 'piscine', 'parqueadero', 'estacionamiento', 'estacionamento', 'parking', 'garaje', 'garage', 'garagem',
    'wifi', 'wi fi', 'internet', 'gimnasio', 'gym', 'jacuzzi', 'hidromasaje', 'spa', 'aire acondicionado', 'air conditioning', 'ar condicionado',
    'climatisation', 'desayuno', 'breakfast', 'cafe da manha', 'petit dejeuner', 'terraza', 'terrace', 'terraco', 'terrasse', 'balcon', 'balcony',
    'varanda', 'cocina equipada', 'kitchen', 'cozinha', 'lavadora', 'washing machine', 'maquina de lavar', 'lave linge', 'ascensor', 'elevator',
    'elevador', 'ascenseur', 'bbq', 'parrilla', 'churrasqueira', 'barbecue', 'chimenea', 'fireplace', 'lareira', 'cheminee', 'calefaccion',
    'heating', 'aquecimento', 'chauffage', 'pet friendly', 'mascotas'];
const NEGATION = / (?:no|sin|ni|tampoco|ningun|ninguna|not|without|nao|sem|nem|pas|sans|aucun|aucune|n) /;
const LODGING_SUBJECT = /propert|listing|room|accommodation|stay|cabin|cabana/;

const PRICE_DENIAL = [
    / precio (?:[a-z]+ ){0,5}no (?:esta |se encuentra |lo tengo |es )?confirmad/, / no (?:lo )?tengo confirmad[oa] (?:el |ese |su |tu )?(?:precio|valor)/, / no (?:tengo|cuento con|tenemos) (?:el |ese |un |una |la )?(?:precio|valor|informacion del precio)/,
    / no (?:puedo|podria|podemos) confirmar(?:te|le)? (?:el |ese |su |tu )?(?:precio|valor)/, / precio (?:aun |todavia )?(?:por|sin) confirmar/,
    / (?:me equivoque|me confundi|error) (?:[a-z]+ ){0,3}(?:precio|valor)/, / precio (?:[a-z]+ ){0,2}no (?:es )?correcto/,
    / price (?:is |was )?(?:not|n t|un)confirmed/, / price (?:is |was )?not confirmed/, / (?:don t|do not|cannot|can t) (?:have|confirm) (?:the|a|that|its) price/, / price to be confirmed/,
    / preco (?:[a-z]+ ){0,3}nao (?:esta |e )?confirmado/, / nao tenho (?:o |esse )?preco/, / preco a confirmar/,
    / prix (?:[a-z]+ ){0,3}(?:n est pas|non|pas) confirme/, / prix a confirmer/, / (?:je n ai pas|nous n avons pas) (?:le|ce) prix/,
];

const LABEL_STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'en', 'the', 'of', 'and', 'with', 'do', 'da', 'dos', 'das', 'e', 'com', 'du', 'des', 'le', 'les', 'et', 'avec']);
function names(text: string, name?: string): boolean {
    if (!name) return false;
    // «Spark QA Plato» names «Spark QA Plato 20261018T110518Z»: the technical stamp is not part of how anyone says it.
    const spoken = spokenItemName(name);
    if (spoken !== name.trim() && names(text, spoken)) return true;
    const label = norm(name);
    if (label.trim().length < 2) return false;
    const hay = norm(text);
    if (hay.includes(label)) return true;
    const words = label.trim().split(' ').filter(word => word.length > 2 && !LABEL_STOPWORDS.has(word));
    return words.length >= 2 && words.filter(word => hay.includes(` ${word} `)).length / words.length >= 0.6;
}

// ── Templates ────────────────────────────────────────────────────────────────

interface Templates {
    unknown: string; example: (name?: string) => string; amount: string; count: string;
    price: (name: string, amount: string) => string; has: (name: string, parts: string[]) => string;
    /** `recorded`: the noun with its participle, agreed in number and gender («1 cita registrada», «6 pedidos registrados»). */
    records: (total: string, recorded: string, shown?: string) => string; recordsAtLeast: (shown: string, noun: string) => string;
    amenitiesListed: (name: string, list: string) => string; amenityMissing: (name?: string) => string;
    duration: (name: string, minutes: string) => string;
}
const T: Record<Lang, Templates> = {
    es: {
        unknown: 'Ese dato no lo tengo confirmado en este momento; si quieres, lo consulto de nuevo.',
        example: name => `${name ? `El precio de ${name}` : 'Ese precio'} es solo de referencia y todavía no está confirmado por el negocio.`,
        amount: 'Prefiero no darte una cifra que no tengo confirmada en el sistema.',
        count: 'Prefiero no darte una cantidad que no tengo confirmada en el sistema.',
        price: (name, amount) => `El precio de ${name} es ${amount}.`,
        has: (name, parts) => `Según la ficha, ${name} tiene ${listOf(parts, 'es')}.`,
        records: (total, recorded, shown) => `Tienes ${total} ${recorded}${shown ? `; te muestro ${shown} de ${total}` : ''}.`,
        recordsAtLeast: (shown, noun) => `Encontré al menos ${shown} ${noun} a tu nombre.`,
        amenitiesListed: (name, list) => `Según la ficha, ${name} incluye: ${list}.`,
        amenityMissing: name => `En la ficha${name ? ` de ${name}` : ''} no aparece ese servicio, así que no puedo confirmártelo.`,
        duration: (name, minutes) => `${name} dura ${minutes} minutos.`,
    },
    en: {
        unknown: "I don't have that detail confirmed right now; I can check it again if you like.",
        example: name => `${name ? `The price of ${name}` : 'That price'} is only a reference and has not been confirmed by the business yet.`,
        amount: "I'd rather not give you a figure I don't have confirmed in the system.",
        count: "I'd rather not give you a number I don't have confirmed in the system.",
        price: (name, amount) => `The price of ${name} is ${amount}.`,
        has: (name, parts) => `According to the listing, ${name} has ${listOf(parts, 'en')}.`,
        records: (total, recorded, shown) => `You have ${total} ${recorded}${shown ? `; here are ${shown} of ${total}` : ''}.`,
        recordsAtLeast: (shown, noun) => `I found at least ${shown} ${noun} under your name.`,
        amenitiesListed: (name, list) => `According to the listing, ${name} includes: ${list}.`,
        amenityMissing: name => `The listing${name ? ` for ${name}` : ''} does not show that feature, so I can't confirm it.`,
        duration: (name, minutes) => `${name} takes ${minutes} minutes.`,
    },
    pt: {
        unknown: 'Não tenho esse dado confirmado neste momento; se quiser, consulto de novo.',
        example: name => `${name ? `O preço de ${name}` : 'Esse preço'} é apenas uma referência e ainda não foi confirmado pelo negócio.`,
        amount: 'Prefiro não passar um valor que não tenho confirmado no sistema.',
        count: 'Prefiro não passar uma quantidade que não tenho confirmada no sistema.',
        price: (name, amount) => `O preço de ${name} é ${amount}.`,
        has: (name, parts) => `Segundo a ficha, ${name} tem ${listOf(parts, 'pt')}.`,
        records: (total, recorded, shown) => `Você tem ${total} ${recorded}${shown ? `; mostro ${shown} de ${total}` : ''}.`,
        recordsAtLeast: (shown, noun) => `Encontrei pelo menos ${shown} ${noun} no seu nome.`,
        amenitiesListed: (name, list) => `Segundo a ficha, ${name} inclui: ${list}.`,
        amenityMissing: name => `A ficha${name ? ` de ${name}` : ''} não mostra esse serviço, então não posso confirmá-lo.`,
        duration: (name, minutes) => `${name} dura ${minutes} minutos.`,
    },
    fr: {
        unknown: "Je n'ai pas cette information confirmée pour le moment ; je peux la vérifier à nouveau si vous voulez.",
        example: name => `${name ? `Le prix de ${name}` : 'Ce prix'} n'est qu'une référence et n'a pas encore été confirmé par l'établissement.`,
        amount: "Je préfère ne pas vous donner un montant que je n'ai pas confirmé dans le système.",
        count: "Je préfère ne pas vous donner un nombre que je n'ai pas confirmé dans le système.",
        price: (name, amount) => `Le prix de ${name} est de ${amount}.`,
        has: (name, parts) => `D'après la fiche, ${name} a ${listOf(parts, 'fr')}.`,
        records: (total, recorded, shown) => `Vous avez ${total} ${recorded}${shown ? ` ; je vous en montre ${shown} sur ${total}` : ''}.`,
        recordsAtLeast: (shown, noun) => `J'ai trouvé au moins ${shown} ${noun} à votre nom.`,
        amenitiesListed: (name, list) => `D'après la fiche, ${name} comprend : ${list}.`,
        amenityMissing: name => `La fiche${name ? ` de ${name}` : ''} n'indique pas ce service, je ne peux donc pas le confirmer.`,
        duration: (name, minutes) => `${name} dure ${minutes} minutes.`,
    },
};
/**
 * The Spanish «usted» register. The templates speak to the customer the way the rest of the reply does (production QA
 * 2026-10-24: «Tienes 6 pedidos registrados» next to «¿Le ayudo con algo más?»). Portuguese («você» constructions),
 * English and French («vous») have one register.
 */
const ES_USTED: Templates = {
    ...T.es,
    unknown: 'Ese dato no lo tengo confirmado en este momento; si desea, lo consulto de nuevo.',
    amount: 'Prefiero no darle una cifra que no tengo confirmada en el sistema.',
    count: 'Prefiero no darle una cantidad que no tengo confirmada en el sistema.',
    records: (total, recorded, shown) => `Tiene ${total} ${recorded}${shown ? `; le muestro ${shown} de ${total}` : ''}.`,
    recordsAtLeast: (shown, noun) => `Encontré al menos ${shown} ${noun} a su nombre.`,
    amenityMissing: name => `En la ficha${name ? ` de ${name}` : ''} no aparece ese servicio, así que no puedo confirmárselo.`,
};
const templatesFor = (lang: Lang, form: AddressForm): Templates => (lang === 'es' && form === 'usted' ? ES_USTED : T[lang]);
const LOCALE_OF: Record<Lang, string> = { es: 'es-CO', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR' };

const FIELD_LABELS: Record<Lang, Record<string, [string, string]>> = {
    es: { bathrooms: ['baño', 'baños'], bedrooms: ['habitación', 'habitaciones'], area: ['m²', 'm²'], units: ['unidad disponible', 'unidades disponibles'] },
    en: { bathrooms: ['bathroom', 'bathrooms'], bedrooms: ['bedroom', 'bedrooms'], area: ['m²', 'm²'], units: ['unit available', 'units available'] },
    pt: { bathrooms: ['banheiro', 'banheiros'], bedrooms: ['quarto', 'quartos'], area: ['m²', 'm²'], units: ['unidade disponível', 'unidades disponíveis'] },
    fr: { bathrooms: ['salle de bain', 'salles de bain'], bedrooms: ['chambre', 'chambres'], area: ['m²', 'm²'], units: ['unité disponible', 'unités disponibles'] },
};
/** [one, many] of each record noun, alone and with its «on record» participle («1 pedido registrado», «6 citas registradas»). */
const RECORD_NOUNS: Record<Lang, Record<string, [string, string]>> = {
    es: { orders: ['pedido', 'pedidos'], appointments: ['cita', 'citas'], bookings: ['reserva', 'reservas'] },
    en: { orders: ['order', 'orders'], appointments: ['appointment', 'appointments'], bookings: ['booking', 'bookings'] },
    pt: { orders: ['pedido', 'pedidos'], appointments: ['consulta', 'consultas'], bookings: ['reserva', 'reservas'] },
    fr: { orders: ['commande', 'commandes'], appointments: ['rendez-vous', 'rendez-vous'], bookings: ['réservation', 'réservations'] },
};
const RECORDED: Record<Lang, Record<string, [string, string]>> = {
    es: { orders: ['pedido registrado', 'pedidos registrados'], appointments: ['cita registrada', 'citas registradas'], bookings: ['reserva registrada', 'reservas registradas'] },
    en: { orders: ['order on record', 'orders on record'], appointments: ['appointment on record', 'appointments on record'], bookings: ['booking on record', 'bookings on record'] },
    pt: { orders: ['pedido registrado', 'pedidos registrados'], appointments: ['consulta registrada', 'consultas registradas'], bookings: ['reserva registrada', 'reservas registradas'] },
    fr: { orders: ['commande enregistrée', 'commandes enregistrées'], appointments: ['rendez-vous enregistré', 'rendez-vous enregistrés'], bookings: ['réservation enregistrée', 'réservations enregistrées'] },
};

// ── The reply ────────────────────────────────────────────────────────────────

export interface RenderFactsInput {
    reply: string;
    /** Every fact of the turn: the stored ledger (expired entries included, so they read as expired), this turn's reads, the projected catalogue. */
    facts: readonly unknown[];
    now: Date;
    language?: string;
    locale: string;
    /** The customer's current message: names the subject a sentence leaves implicit. */
    customerText?: string;
    /** Customer text and tool data of the turn: a token found verbatim in them is never interpreted. */
    untrusted?: readonly string[];
    /** Server-authored text of the turn (an engine directive): its amounts are not the model's. */
    serverText?: string;
    /** The customer's form of address (`regional.addressForm`): a Spanish template says «usted» or «tú» like the rest of the reply. */
    addressForm?: unknown;
}

export interface RenderFactsOutcome {
    text: string;
    tokens: number;
    rendered: number;
    fallbacks: Array<{ reason: FallbackReason }>;
}

const validator = new ResponseValidatorService();

/**
 * The field that IS the price of an item, per kind of record, best first. A hotel room's price is its night price, never
 * its cleaning fee (production QA 2026-10-24: «The price of Spark QA Habitacion … is 0 COP» — `cleaningFee: 0`, the last
 * money field of the record, was taken for the room's price); a fee, a deposit, a total or a balance is never «the price of X».
 */
const PRICE_FIELDS_LODGING = ['nightprice', 'pricepernight', 'price'];
const PRICE_FIELDS = ['price', 'unitprice', 'nightprice', 'pricepernight', 'monthlyprice', 'annualprice', 'tuition'];
function priceFieldRank(fact: VerifiedFact): number {
    const field = (fact.field.split('.').pop() || '').replace(/[^a-z]/gi, '').toLowerCase();
    return (LODGING_SUBJECT.test(fact.subject.type) ? PRICE_FIELDS_LODGING : PRICE_FIELDS).indexOf(field);
}

/** The customer's message asks about a price or an amount («how much», «what's the nightly rate», «cuánto pago»). */
const PRICE_QUESTION = / (?:precio|precios|cuanto|cuesta|cuestan|vale|valen|costo|costos|coste|tarifa|tarifas|pago|pagar|total|price|prices|cost|costs|much|rate|rates|fee|fees|preco|precos|quanto|custa|custam|valor|prix|combien|coute|coutent|tarif|tarifs|payer) /;
/** A sentence about how long something takes. */
const DURATION_WORDS = / (?:min|mins|minuto|minutos|minute|minutes|hora|horas|hour|hours|heure|heures|dura|duran|duracion|duracao|duree|duration|takes|long|demora|tarda|leva) /;

export function renderReplyFacts(input: RenderFactsInput): RenderFactsOutcome {
    const turnLang = langOf(input.language);
    const registry = factRegistry(input.facts);
    const live = [...registry.values()].filter(fact => isLive(fact, input.now));
    const untrusted = (input.untrusted || []).filter(text => typeof text === 'string' && text.includes('⟦'));
    const customerText = input.customerText || '';
    const outcome: RenderFactsOutcome = { text: input.reply, tokens: 0, rendered: 0, fallbacks: [] };
    if (!input.reply) return outcome;

    // One language per reply. A template is written in the language the rest of the reply is written in: when the model
    // answered a French turn in Spanish, a French template in the middle («El Spark QA Tour tiene… Le prix de … est de
    // 125 EUR. ¿Le gustaría…», production QA 2026-10-24) left a reply the language guard could no longer read as Spanish,
    // and it went out mixed. A reply written in one language is what that guard rewrites into the customer's, whole.
    const subjectNames = [...new Set(live.flatMap(fact => (fact.subject.name ? [fact.subject.name, spokenItemName(fact.subject.name)] : [])))];
    const written = replyLanguageOf(input.reply.replace(FACT_TOKEN_RE, ' '), subjectNames);
    const lang: Lang = written && written !== turnLang ? written : turnLang;
    const ctx: RenderContext = { lang, locale: lang === turnLang ? input.locale : LOCALE_OF[lang], now: input.now };
    const t = templatesFor(lang, addressFormOf(input.addressForm));
    /** A record name as the customer says it: no technical stamp («Spark QA Plato 20261018T110518Z» → «Spark QA Plato»). */
    const say = (name: string) => neutralizeFactTokens(spokenItemName(name));
    const subjectKey = (fact: VerifiedFact) => `${fact.subject.type}|${fact.subject.id}`;
    // No customer text (a pure call): every amount sentence is about a price, as before.
    const asksPrice = !customerText.trim() || PRICE_QUESTION.test(norm(customerText));

    const subjectFor = (sentence: string, candidates: VerifiedFact[], single = true): VerifiedFact | undefined => {
        const bySubject = new Map(candidates.map(fact => [subjectKey(fact), fact]));
        const pool = [...bySubject.values()];
        return pool.find(fact => names(sentence, fact.subject.name)) ?? pool.find(fact => names(customerText, fact.subject.name))
            ?? (single && pool.length === 1 ? pool[0] : undefined);
    };
    // The price of each named item: its price field, never a fee, and never an empty (0) amount.
    const bestPrice = new Map<string, VerifiedFact>();
    for (const fact of live) {
        if (fact.kind !== 'money' || fact.priceStatus !== 'confirmed' || typeof fact.value !== 'number' || !(fact.value > 0) || !fact.subject.name) continue;
        const rank = priceFieldRank(fact);
        if (rank < 0) continue;
        const current = bestPrice.get(subjectKey(fact));
        if (!current || rank <= priceFieldRank(current)) bestPrice.set(subjectKey(fact), fact);
    }
    const confirmedMoney = [...bestPrice.values()];
    const examplePriced = new Set(live.filter(fact => fact.kind === 'money' && fact.priceStatus !== 'confirmed').map(subjectKey));

    // What backs an amount the model typed: a confirmed amount of the subject the sentence (or the customer) names, the
    // server's own text, an amount of a record with no name (an order's total) — and, as in the price guard (F4300-36), a
    // total computed from them (2 × 13.500 when the customer asked «si pido dos»).
    const confirmedAmounts = live.filter(fact => fact.kind === 'money' && fact.priceStatus === 'confirmed' && typeof fact.value === 'number' && fact.value > 0);
    const moneyViews: VerifiedFactView[] = verifiedFactViews(confirmedAmounts, input.now);
    const ledger = moneyViews.length ? { facts: moneyViews, customerText } : undefined;
    const corpus = [input.serverText || '', ...confirmedAmounts.filter(fact => !fact.subject.name)
        .map(fact => JSON.stringify({ amount: fact.value, ...(fact.currency ? { currency: fact.currency } : {}) }))].join('\n');
    const amountBacked = (sentence: string) => validator.validatePrices(sentence, corpus, ledger, { customerText }).ok;
    const statesAmount = (sentence: string) => !validator.validatePrices(sentence, '').ok;

    const priceTemplate = (sentence: string): string | null => {
        // An item nobody named is priced only when the customer asked for a price: «how many orders have I made?» never
        // gets «The price of Spark QA Plato is 13,500 COP» appended (production QA 2026-10-24).
        const fact = subjectFor(sentence, confirmedMoney, asksPrice);
        if (!fact || examplePriced.has(subjectKey(fact))) return null;
        return t.price(say(fact.subject.name!), moneyText(fact, ctx));
    };
    const recordListFor = (category: CountCategory): VerifiedFact | undefined => {
        const pattern = CATEGORY_RECORDS[category];
        const lists = live.filter(f => f.kind === 'record_list' && Array.isArray(f.value));
        return lists.find(f => pattern?.test(`${f.subject.type} ${f.source.tool}`)) ?? (lists.length === 1 ? lists[0] : undefined);
    };
    const fieldFacts = (category: CountCategory): VerifiedFact[] => {
        const fields = CATEGORY_FIELDS[category] ?? [];
        return live.filter(f => f.kind === 'attribute' && typeof f.value === 'number' && fields.some(field => field.toLowerCase() === f.field.toLowerCase()));
    };
    const countTemplate = (sentence: string, categories: CountCategory[]): string | null => {
        const parts: string[] = [];
        let owner: string | undefined;
        for (const category of categories) {
            if (CATEGORY_FIELDS[category]) {
                const fact = subjectFor(sentence, fieldFacts(category));
                if (!fact) continue;
                const value = fact.value as number;
                const [one, many] = FIELD_LABELS[lang][category] ?? ['', ''];
                parts.push(`${numberOf(value, ctx.locale)} ${value === 1 ? one : many}`);
                owner = owner ?? fact.subject.name;
                // The other record fields of the same subject are said with it: «2 baños» never stands alone for a 1-bathroom, 2-bedroom listing.
                continue;
            }
            const list = recordListFor(category);
            if (!list) continue;
            const shown = (list.value as string[]).length;
            const total = typeof list.total === 'number' ? list.total : shown;
            const pick = (forms: [string, string] | undefined, n: number) => (forms ? forms[n === 1 ? 0 : 1] : '');
            return list.complete === false && total <= shown
                ? t.recordsAtLeast(String(shown), pick(RECORD_NOUNS[lang][category], shown))
                : t.records(String(total), pick(RECORDED[lang][category], total), total > shown ? String(shown) : undefined);
        }
        if (!parts.length) return null;
        return t.has(owner ? say(owner) : '', parts).replace(/ {2,}/g, ' ');
    };
    /** A count the model typed that the record says: the field of the subject it names, the known total of a list. */
    const countBacked = (sentence: string, count: TypedCount): boolean => {
        if (count.value === null) return false;
        if (CATEGORY_FIELDS[count.category]) {
            // «2 unidades» when the customer asked for two is the quantity, not the stock.
            if (count.category === 'units' && quantitiesIn(customerText).includes(count.value)) return true;
            const candidates = fieldFacts(count.category);
            const owner = subjectFor(sentence, candidates);
            return !!owner && candidates.some(f => subjectKey(f) === subjectKey(owner) && f.value === count.value);
        }
        const list = recordListFor(count.category);
        if (!list) return false;
        const total = typeof list.total === 'number' ? list.total : list.complete === false ? null : (list.value as string[]).length;
        return total !== null && total === count.value;
    };
    const durationTemplate = (sentence: string): string | null => {
        if (!DURATION_WORDS.test(norm(sentence))) return null;
        const fact = subjectFor(sentence, live.filter(f => f.kind === 'attribute' && typeof f.value === 'number' && f.value > 0 && /^durationminutes$/i.test(f.field)));
        return fact?.subject.name ? t.duration(say(fact.subject.name), numberOf(fact.value as number, ctx.locale)) : null;
    };
    const serverCategories = input.serverText ? countCategories(input.serverText, lang) : [];
    /**
     * What a sentence with an unbacked figure becomes: the record's values for what the sentence was about — its price,
     * its counts, its duration — so the rest of the answer survives («80 m²», «45 minutos» were dropped with the whole
     * sentence when only the price was restated, production QA 2026-10-24). '' drops the sentence: an amount nobody asked
     * about and no record can say.
     */
    const fallbackFor = (sentence: string, failed: 'amount' | 'count'): string => {
        const pieces: string[] = [];
        if (statesAmount(sentence)) {
            const price = priceTemplate(sentence);
            if (price) pieces.push(price);
            else if (failed === 'amount' && asksPrice) pieces.push(t.amount);
        }
        const categories = countCategories(sentence, lang).filter(category => !serverCategories.includes(category));
        if (categories.length) {
            const counts = countTemplate(sentence, categories);
            if (counts) pieces.push(counts);
            else if (failed === 'count') pieces.push(t.count);
        }
        const duration = durationTemplate(sentence);
        if (duration) pieces.push(duration);
        if (pieces.length) return pieces.join(' ');
        return failed === 'count' ? t.count : asksPrice ? t.amount : '';
    };
    const amenityTemplate = (sentence: string): string => {
        const lodging = live.filter(fact => LODGING_SUBJECT.test(fact.subject.type));
        const listed = subjectFor(sentence, live.filter(fact => fact.kind === 'attribute' && /amenit|includ|inclus/i.test(fact.field) && Array.isArray(fact.value)));
        if (listed) return t.amenitiesListed(listed.subject.name ? say(listed.subject.name) : '', attributeText(listed, ctx));
        const owner = subjectFor(sentence, lodging);
        return t.amenityMissing(owner?.subject.name ? say(owner.subject.name) : undefined);
    };
    const lodgingTurn = live.some(fact => LODGING_SUBJECT.test(fact.subject.type));
    const backedAmenities = norm(live.filter(fact => fact.kind === 'attribute' && /amenit|includ|inclus|feature/i.test(fact.field))
        .map(fact => (Array.isArray(fact.value) ? fact.value.join(' ') : String(fact.value))).join(' '));

    const sentenceOut = (sentence: string): { text: string; reason?: FallbackReason } => {
        const tokens = [...sentence.matchAll(FACT_TOKEN_RE)];
        outcome.tokens += tokens.length;
        const stripped = sentence.replace(FACT_TOKEN_RE, ' ');
        if (stripped.includes('⟦') || stripped.includes('⟧')) return { text: t.unknown, reason: 'malformed_token' };
        const values: string[] = [];
        for (const token of tokens) {
            if (untrusted.some(text => text.includes(token[0]))) return { text: t.unknown, reason: 'untrusted_token' };
            const fact = registry.get(token[2]);
            const rendered = renderToken(token[1], fact, ctx);
            if (!rendered.ok) {
                return { text: rendered.reason === 'example_price' ? t.example(fact?.subject.name ? say(fact.subject.name) : undefined) : t.unknown,
                    reason: rendered.reason };
            }
            values.push(rendered.text);
        }
        // What the model typed itself (the sentence without its tokens): kept when the verified facts back it — the room's
        // 150.000 COP, the listing's 80 m², 2 × 13.500 for two dishes. Only an unbacked figure falls back.
        if (!amountBacked(stripped)) return { text: fallbackFor(stripped, 'amount'), reason: 'unrendered_amount' };
        const unbacked = typedCounts(stripped, lang)
            .filter(count => !serverCategories.includes(count.category) && !countBacked(stripped, count));
        if (unbacked.length) return { text: fallbackFor(stripped, 'count'), reason: 'unrendered_count' };
        const plain = norm(stripped);
        if (lodgingTurn && !NEGATION.test(plain) && AMENITY_TERMS.some(term => plain.includes(` ${term} `) && !backedAmenities.includes(` ${term} `))) {
            return { text: amenityTemplate(stripped), reason: 'unbacked_amenity' };
        }
        if (PRICE_DENIAL.some(pattern => pattern.test(plain))) {
            const price = priceTemplate(stripped);
            if (price) return { text: price, reason: 'price_denied' };
        }
        let i = 0;
        outcome.rendered += values.length;
        return { text: sentence.replace(FACT_TOKEN_RE, () => values[i++]) };
    };

    // Sentences end at . ! ? … followed by a space, or at a line break; «13.500» is not an end.
    const parts = input.reply.split(/((?<=[.!?…])[ \t]+|\n+)/);
    const seen = new Set<string>();
    const out: string[] = [];
    for (let index = 0; index < parts.length; index++) {
        const part = parts[index];
        if (index % 2 === 1) { out.push(part); continue; }
        if (!part.trim()) { out.push(part); continue; }
        const { text, reason } = sentenceOut(part);
        if (reason) {
            outcome.fallbacks.push({ reason });
            // A sentence dropped, or a template said once already: it goes with the separator before it.
            if (!text || seen.has(text)) { if (out.length && index > 0) out.pop(); continue; }
            seen.add(text);
        }
        out.push(text);
    }
    outcome.text = out.join('').trim() || (outcome.fallbacks.length ? t.amount : '');
    return outcome;
}
