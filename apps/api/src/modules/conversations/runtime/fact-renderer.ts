import type { FactTokenView, TurnContext } from '@parallext/shared';
import { catalogPriceStatus } from '../catalog-price-status';
import { normalizeReplyAmounts } from '../reply-price-format';
import { ResponseValidatorService } from '../response-validator.service';
import { humanizeReferences, localizeStatusWords, orderStatusLabel } from '../transition-engine';
import { FACT_TTL_MS, factKey, wellFormed, type VerifiedFact } from './facts-ledger';

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
        // An example (or quote / missing) price is never rendered as a confirmed amount.
        case 'money': return fact.priceStatus === 'confirmed' && typeof fact.value === 'number'
            ? { ok: true, text: moneyText(fact, ctx) } : { ok: false, reason: 'example_price' };
        case 'availability': return { ok: true, text: availabilityText(fact, ctx) };
        case 'record_list': return Array.isArray(fact.value) ? { ok: true, text: recordListText(fact, ctx) } : { ok: false, reason: 'wrong_token_kind' };
        case 'record_status': return { ok: true, text: orderStatusLabel(fact.value, ctx.lang) };
        default: return { ok: true, text: attributeText(fact, ctx) };
    }
}

// ── Detection of what the model typed itself ─────────────────────────────────

export type FallbackReason = 'unknown_fact' | 'expired_fact' | 'wrong_token_kind' | 'example_price' | 'malformed_token'
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

function countCategories(sentence: string, lang: Lang): CountCategory[] {
    const text = norm(sentence);
    const found = new Set<CountCategory>();
    for (const match of text.matchAll(COUNT_RES[lang])) {
        const noun = match[2];
        const category = COUNT_NOUNS.find(([, nouns]) => new RegExp(`^(?:${nouns})$`).test(noun))?.[0];
        if (category) found.add(category);
    }
    return [...found];
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
    const label = norm(name);
    if (label.trim().length < 2) return false;
    const hay = norm(text);
    if (hay.includes(label)) return true;
    const words = label.trim().split(' ').filter(word => word.length > 2 && !LABEL_STOPWORDS.has(word));
    return words.length >= 2 && words.filter(word => hay.includes(` ${word} `)).length / words.length >= 0.6;
}

// ── Templates ────────────────────────────────────────────────────────────────

const T: Record<Lang, {
    unknown: string; example: (name?: string) => string; amount: string; count: string;
    price: (name: string, amount: string) => string; has: (name: string, parts: string[]) => string;
    records: (total: string, noun: string, shown?: string) => string; recordsAtLeast: (shown: string, noun: string) => string;
    amenitiesListed: (name: string, list: string) => string; amenityMissing: (name?: string) => string;
}> = {
    es: {
        unknown: 'Ese dato no lo tengo confirmado en este momento; si quieres, lo consulto de nuevo.',
        example: name => `${name ? `El precio de ${name}` : 'Ese precio'} es solo de referencia y todavía no está confirmado por el negocio.`,
        amount: 'Prefiero no darte una cifra que no tengo confirmada en el sistema.',
        count: 'Prefiero no darte una cantidad que no tengo confirmada en el sistema.',
        price: (name, amount) => `El precio de ${name} es ${amount}.`,
        has: (name, parts) => `Según la ficha, ${name} tiene ${listOf(parts, 'es')}.`,
        records: (total, noun, shown) => `Tienes ${total} ${noun} registrados${shown ? `; te muestro ${shown} de ${total}` : ''}.`,
        recordsAtLeast: (shown, noun) => `Encontré al menos ${shown} ${noun} a tu nombre.`,
        amenitiesListed: (name, list) => `Según la ficha, ${name} incluye: ${list}.`,
        amenityMissing: name => `En la ficha${name ? ` de ${name}` : ''} no aparece ese servicio, así que no puedo confirmártelo.`,
    },
    en: {
        unknown: "I don't have that detail confirmed right now; I can check it again if you like.",
        example: name => `${name ? `The price of ${name}` : 'That price'} is only a reference and has not been confirmed by the business yet.`,
        amount: "I'd rather not give you a figure I don't have confirmed in the system.",
        count: "I'd rather not give you a number I don't have confirmed in the system.",
        price: (name, amount) => `The price of ${name} is ${amount}.`,
        has: (name, parts) => `According to the listing, ${name} has ${listOf(parts, 'en')}.`,
        records: (total, noun, shown) => `You have ${total} ${noun} on record${shown ? `; here are ${shown} of ${total}` : ''}.`,
        recordsAtLeast: (shown, noun) => `I found at least ${shown} ${noun} under your name.`,
        amenitiesListed: (name, list) => `According to the listing, ${name} includes: ${list}.`,
        amenityMissing: name => `The listing${name ? ` for ${name}` : ''} does not show that feature, so I can't confirm it.`,
    },
    pt: {
        unknown: 'Não tenho esse dado confirmado neste momento; se quiser, consulto de novo.',
        example: name => `${name ? `O preço de ${name}` : 'Esse preço'} é apenas uma referência e ainda não foi confirmado pelo negócio.`,
        amount: 'Prefiro não passar um valor que não tenho confirmado no sistema.',
        count: 'Prefiro não passar uma quantidade que não tenho confirmada no sistema.',
        price: (name, amount) => `O preço de ${name} é ${amount}.`,
        has: (name, parts) => `Segundo a ficha, ${name} tem ${listOf(parts, 'pt')}.`,
        records: (total, noun, shown) => `Você tem ${total} ${noun} registrados${shown ? `; mostro ${shown} de ${total}` : ''}.`,
        recordsAtLeast: (shown, noun) => `Encontrei pelo menos ${shown} ${noun} no seu nome.`,
        amenitiesListed: (name, list) => `Segundo a ficha, ${name} inclui: ${list}.`,
        amenityMissing: name => `A ficha${name ? ` de ${name}` : ''} não mostra esse serviço, então não posso confirmá-lo.`,
    },
    fr: {
        unknown: "Je n'ai pas cette information confirmée pour le moment ; je peux la vérifier à nouveau si vous voulez.",
        example: name => `${name ? `Le prix de ${name}` : 'Ce prix'} n'est qu'une référence et n'a pas encore été confirmé par l'établissement.`,
        amount: "Je préfère ne pas vous donner un montant que je n'ai pas confirmé dans le système.",
        count: "Je préfère ne pas vous donner un nombre que je n'ai pas confirmé dans le système.",
        price: (name, amount) => `Le prix de ${name} est de ${amount}.`,
        has: (name, parts) => `D'après la fiche, ${name} a ${listOf(parts, 'fr')}.`,
        records: (total, noun, shown) => `Vous avez ${total} ${noun} enregistrés${shown ? ` ; je vous en montre ${shown} sur ${total}` : ''}.`,
        recordsAtLeast: (shown, noun) => `J'ai trouvé au moins ${shown} ${noun} à votre nom.`,
        amenitiesListed: (name, list) => `D'après la fiche, ${name} comprend : ${list}.`,
        amenityMissing: name => `La fiche${name ? ` de ${name}` : ''} n'indique pas ce service, je ne peux donc pas le confirmer.`,
    },
};

const FIELD_LABELS: Record<Lang, Record<string, [string, string]>> = {
    es: { bathrooms: ['baño', 'baños'], bedrooms: ['habitación', 'habitaciones'], area: ['m²', 'm²'], units: ['unidad disponible', 'unidades disponibles'] },
    en: { bathrooms: ['bathroom', 'bathrooms'], bedrooms: ['bedroom', 'bedrooms'], area: ['m²', 'm²'], units: ['unit available', 'units available'] },
    pt: { bathrooms: ['banheiro', 'banheiros'], bedrooms: ['quarto', 'quartos'], area: ['m²', 'm²'], units: ['unidade disponível', 'unidades disponíveis'] },
    fr: { bathrooms: ['salle de bain', 'salles de bain'], bedrooms: ['chambre', 'chambres'], area: ['m²', 'm²'], units: ['unité disponible', 'unités disponibles'] },
};
const RECORD_NOUNS: Record<Lang, Record<string, string>> = {
    es: { orders: 'pedidos', appointments: 'citas', bookings: 'reservas' },
    en: { orders: 'orders', appointments: 'appointments', bookings: 'bookings' },
    pt: { orders: 'pedidos', appointments: 'consultas', bookings: 'reservas' },
    fr: { orders: 'commandes', appointments: 'rendez-vous', bookings: 'réservations' },
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
}

export interface RenderFactsOutcome {
    text: string;
    tokens: number;
    rendered: number;
    fallbacks: Array<{ reason: FallbackReason }>;
}

const validator = new ResponseValidatorService();

export function renderReplyFacts(input: RenderFactsInput): RenderFactsOutcome {
    const lang = langOf(input.language);
    const ctx: RenderContext = { lang, locale: input.locale, now: input.now };
    const registry = factRegistry(input.facts);
    const live = [...registry.values()].filter(fact => isLive(fact, input.now));
    const untrusted = (input.untrusted || []).filter(text => typeof text === 'string' && text.includes('⟦'));
    const customerText = input.customerText || '';
    const outcome: RenderFactsOutcome = { text: input.reply, tokens: 0, rendered: 0, fallbacks: [] };
    if (!input.reply) return outcome;

    const subjectFor = (sentence: string, candidates: VerifiedFact[]): VerifiedFact | undefined => {
        const bySubject = new Map(candidates.map(fact => [`${fact.subject.type}|${fact.subject.id}`, fact]));
        const pool = [...bySubject.values()];
        return pool.find(fact => names(sentence, fact.subject.name)) ?? pool.find(fact => names(customerText, fact.subject.name))
            ?? (pool.length === 1 ? pool[0] : undefined);
    };
    const confirmedMoney = live.filter(fact => fact.kind === 'money' && fact.priceStatus === 'confirmed' && typeof fact.value === 'number' && fact.subject.name);
    const examplePriced = new Set(live.filter(fact => fact.kind === 'money' && fact.priceStatus !== 'confirmed').map(fact => `${fact.subject.type}|${fact.subject.id}`));

    const priceTemplate = (sentence: string): string | null => {
        const fact = subjectFor(sentence, confirmedMoney);
        if (!fact || examplePriced.has(`${fact.subject.type}|${fact.subject.id}`)) return null;
        return T[lang].price(neutralizeFactTokens(fact.subject.name!), moneyText(fact, ctx));
    };
    const countTemplate = (sentence: string, categories: CountCategory[]): string | null => {
        const parts: string[] = [];
        let owner: string | undefined;
        for (const category of categories) {
            const fields = CATEGORY_FIELDS[category];
            if (fields) {
                const fact = subjectFor(sentence, live.filter(f => f.kind === 'attribute' && typeof f.value === 'number'
                    && fields.some(field => field.toLowerCase() === f.field.toLowerCase())));
                if (!fact) continue;
                const value = fact.value as number;
                const [one, many] = FIELD_LABELS[lang][category] ?? ['', ''];
                parts.push(`${numberOf(value, ctx.locale)} ${value === 1 ? one : many}`);
                owner = owner ?? fact.subject.name;
                // The other record fields of the same subject are said with it: «2 baños» never stands alone for a 1-bathroom, 2-bedroom listing.
                continue;
            }
            const pattern = CATEGORY_RECORDS[category];
            const lists = live.filter(f => f.kind === 'record_list' && Array.isArray(f.value));
            const list = lists.find(f => pattern?.test(`${f.subject.type} ${f.source.tool}`)) ?? (lists.length === 1 ? lists[0] : undefined);
            if (!list) continue;
            const noun = RECORD_NOUNS[lang][category] ?? '';
            const shown = (list.value as string[]).length;
            const total = typeof list.total === 'number' ? list.total : shown;
            return list.complete === false && total <= shown
                ? T[lang].recordsAtLeast(String(shown), noun)
                : T[lang].records(String(total), noun, total > shown ? String(shown) : undefined);
        }
        if (!parts.length) return null;
        return T[lang].has(neutralizeFactTokens(owner ?? ''), parts).replace(/ {2,}/g, ' ');
    };
    const amenityTemplate = (sentence: string): string => {
        const lodging = live.filter(fact => LODGING_SUBJECT.test(fact.subject.type));
        const listed = subjectFor(sentence, live.filter(fact => fact.kind === 'attribute' && /amenit|includ|inclus/i.test(fact.field) && Array.isArray(fact.value)));
        if (listed) return T[lang].amenitiesListed(neutralizeFactTokens(listed.subject.name ?? ''), attributeText(listed, ctx));
        const owner = subjectFor(sentence, lodging);
        return T[lang].amenityMissing(owner?.subject.name ? neutralizeFactTokens(owner.subject.name) : undefined);
    };
    const lodgingTurn = live.some(fact => LODGING_SUBJECT.test(fact.subject.type));
    const backedAmenities = norm(live.filter(fact => fact.kind === 'attribute' && /amenit|includ|inclus|feature/i.test(fact.field))
        .map(fact => (Array.isArray(fact.value) ? fact.value.join(' ') : String(fact.value))).join(' '));

    const sentenceOut = (sentence: string): { text: string; reason?: FallbackReason } => {
        const tokens = [...sentence.matchAll(FACT_TOKEN_RE)];
        outcome.tokens += tokens.length;
        const stripped = sentence.replace(FACT_TOKEN_RE, ' ');
        if (stripped.includes('⟦') || stripped.includes('⟧')) return { text: T[lang].unknown, reason: 'malformed_token' };
        const values: string[] = [];
        for (const token of tokens) {
            if (untrusted.some(text => text.includes(token[0]))) return { text: T[lang].unknown, reason: 'untrusted_token' };
            const fact = registry.get(token[2]);
            const rendered = renderToken(token[1], fact, ctx);
            if (!rendered.ok) {
                return { text: rendered.reason === 'example_price' ? T[lang].example(fact?.subject.name ? neutralizeFactTokens(fact.subject.name) : undefined) : T[lang].unknown,
                    reason: rendered.reason };
            }
            values.push(rendered.text);
        }
        // What the model typed itself (the sentence without its tokens).
        if (!validator.validatePrices(stripped, input.serverText || '').ok) {
            return { text: priceTemplate(stripped) ?? T[lang].amount, reason: 'unrendered_amount' };
        }
        const categories = countCategories(stripped, lang).filter(category => !(input.serverText && countCategories(input.serverText, lang).includes(category)));
        if (categories.length) return { text: countTemplate(stripped, categories) ?? T[lang].count, reason: 'unrendered_count' };
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
            // A template said once is enough.
            if (seen.has(text)) { if (out.length && index > 0) out.pop(); continue; }
            seen.add(text);
        }
        out.push(text);
    }
    outcome.text = out.join('').trim();
    return outcome;
}
