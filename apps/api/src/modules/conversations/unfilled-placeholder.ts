import { noDataNoOfferText, noDataWaitReplacementText } from './human-offer';

/**
 * F4300-34 (high, safety). A dental tenant, customer «I broke a tooth and it hurts a lot, what should I do?». The reply that
 * reached the customer: «For dental emergencies outside of our regular hours, please call the emergency guard at this number:
 * [emergency contact number]. If you need anything else, I am here to help.» The tenant has no emergency phone; its FAQ says to
 * go to the nearest emergency service. A slot the model left for a value it did not have went out as if it were the value.
 *
 * Every model-written reply is read for an UNFILLED PLACEHOLDER before it leaves:
 *  - a square-bracket slot: letters only (no digit at all), not a markdown link `[text](url)` / `[text][ref]` / `[ref]: url`, and
 *    either a slot word («number», «número», «teléfono», «nombre», «address», «e-mail», «insert», «your»…) or a bracketed text the
 *    business data of the turn does not hold. «Ref. [5603A623]», «[1]», «[…]», «[sic]» and a bracketed name the catalogue writes
 *    that way are not slots;
 *  - a template slot: «{{ anything }}» or «{identifier}» (no colon, no quote: not JSON);
 *  - an angle slot: «<insert …>», «<su correo>» or several bare words between angle brackets (an HTML tag has one name and
 *    attributes with «=»);
 *  - a dummy number: two or more groups of X / # («XXX-XXXX», «(XXX) XXX-XXXX», «+57 XXX XXX XXXX») or a run of six X.
 *
 * What is done with it: a name slot in a greeting («Hola [nombre], …») is taken out of the sentence; any other slot takes its
 * whole sentence with it (and a line ending in «:» that only introduced it). When what is left is only courtesy («If you need
 * anything else, I am here to help») the reply is a fixed text instead: for a health or safety emergency, the honest sentence
 * that the business has no emergency contact on file and that the customer goes to the nearest emergency service or calls the
 * local emergency number (never a number); otherwise «I don't have that information confirmed» (with the offer of a person
 * when one can be reached). An emergency sentence that is removed while the rest stands is replaced by that same safe sentence.
 */

export type PlaceholderKind = 'bracket' | 'template' | 'angle' | 'dummy_number';
export interface PlaceholderHit { readonly kind: PlaceholderKind; readonly text: string; readonly index: number; readonly name: boolean }

export interface UnfilledPlaceholderGuardInput {
    readonly reply: string;
    /** The customer's message of this turn: an emergency there makes the fallback the emergency one. */
    readonly customerText?: string;
    /** What the turn holds from the business (system prompt, tool results): a bracketed text found there bracketed is data. */
    readonly sources?: ReadonlyArray<unknown>;
    readonly lang?: string;
    readonly canOfferPerson?: boolean;
}

export interface UnfilledPlaceholderGuardResult {
    readonly changed: boolean;
    readonly text: string;
    /** 'removed': sentences dropped, the rest stands; 'fallback': fixed text; 'emergency_fallback': the emergency text was used. */
    readonly action: 'none' | 'removed' | 'fallback' | 'emergency_fallback';
    readonly placeholders: string[];
    /** Contact details (phones, emergency numbers, e-mails, links, handles, offers of a phone) the business data does not hold. */
    readonly contacts: string[];
}

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Words that only a slot is made of («[emergency contact number]», «[número de teléfono]», «[su dirección]»), on folded text. */
const SLOT_WORD = new RegExp('(?:^|[\\s_\\-/])(?:' + [
    'numbers?', 'numeros?', 'nro', 'phone', 'telephone', 'telefono', 'telefone', 'tel', 'cel', 'celular', 'mobile', 'movil', 'whatsapp',
    'contacts?', 'contactos?', 'contatos?', 'names?', 'nombres?', 'nomes?', 'noms?', 'prenom', 'apellidos?', 'surname',
    'address(?:es)?', 'direccion(?:es)?', 'endereco', 'adresse', 'e-?mail', 'correo', 'courriel', 'url', 'link', 'enlace', 'lien',
    'website', 'sitio', 'site', 'web', 'insert', 'inserte', 'insertar', 'inserir', 'insira', 'inserer', 'inserez', 'placeholder',
    'your', 'su', 'tu', 'seu', 'sua', 'votre', 'company', 'empresa', 'business', 'negocio', 'clinic', 'clinica', 'clinique', 'doctor',
    'date', 'fecha', 'data', 'hora', 'time', 'heure', 'horario', 'hours', 'price', 'precio', 'preco', 'prix', 'amount', 'monto',
    'valor', 'city', 'ciudad', 'cidade', 'ville', 'emergency', 'emergencia', 'urgence', 'urgencia', 'customer', 'cliente', 'client',
    'agent', 'agente', 'team', 'equipo', 'equipe', 'here', 'aqui', 'ici',
].join('|') + ')(?=$|[\\s_\\-/.])');
/** A slot that stands for the customer's (or someone's) name: removed from its sentence, the sentence stays. */
const NAME_SLOT = /^(?:(?:customer|client|cliente|patient|paciente|your|su|tu|seu|sua|votre|du|del|da|do)[\s_-]+)*(?:first[\s_-]+)?(?:names?|nombres?|nomes?|noms?|prenom|cliente|client|customer)(?:[\s_-]+(?:del?|da|do|du|of|the|cliente|client|customer|paciente|patient))*$/;
/** Bracketed texts that are writing conventions, not slots. */
const BRACKET_CONVENTION = /^(?:sic!?|sic\.|\.{3}|…|x|\s*)$/i;

const BRACKET = /\[([^[\]\n]{1,60})\](?!\s*\(|\[)/g;
const TEMPLATE_DOUBLE = /\{\{[^{}\n]{0,60}\}\}/g;
const TEMPLATE_SINGLE = /(?<!\{)\{\s*([\p{L}_][\p{L}\p{N}_ .-]{0,40}?)\s*\}(?!\})/gu;
const ANGLE = /<\s*([^<>\n=/"']{1,60}?)\s*>/g;
const ANGLE_LEAD = /^(?:insert|inserte|insertar|inserir|insira|inserer|inserez|ajouter|add|enter|ingrese|escriba|your|tu|su|seu|sua|votre|nombre|name|nome|nom|numero|number|phone|telefono|telefone|direccion|address|endereco|adresse|correo|email|e-mail)\b/;
const DUMMY_GROUPS = /(?<![\p{L}\p{N}])(?:\+\s?\d{1,3}[\s.-]?)?(?:\(?[Xx#]{2,4}\)?[\s.-]){1,3}[Xx#]{3,4}(?![\p{L}\p{N}])/gu;
const DUMMY_RUN = /(?<![\p{L}\p{N}])[Xx]{6,}(?![\p{L}\p{N}])/gu;

function sourceText(sources: ReadonlyArray<unknown> | undefined): string {
    return (sources || []).map(source => {
        if (source == null) return '';
        if (typeof source === 'string') return source;
        try { return JSON.stringify(source); } catch { return ''; }
    }).join('\n');
}

/** Every unfilled placeholder of the text, in order. `sources` is what the business data of the turn says. */
export function findUnfilledPlaceholders(text: string, sources?: ReadonlyArray<unknown>): PlaceholderHit[] {
    if (!text) return [];
    const hits: PlaceholderHit[] = [];
    let corpus: string | null = null;
    for (const match of text.matchAll(BRACKET)) {
        const inner = match[1].trim();
        if (!inner || BRACKET_CONVENTION.test(inner)) continue;
        // a digit makes it a reference, a footnote, a code or a figure («[5603A623]», «[1]», «[2 pax]»)
        if (/\d/.test(inner) || !/^[\p{L}][\p{L}\p{M}\s'’_\-/.]*$/u.test(inner)) continue;
        if (match.index! > 0 && text[match.index! - 1] === '!') continue;
        // a markdown reference definition («[menu]: https://…» at the start of a line)
        if ((match.index === 0 || text[match.index! - 1] === '\n') && /^\s*:\s*\S/.test(text.slice(match.index! + match[0].length))) continue;
        const folded = fold(inner);
        const slotWord = SLOT_WORD.test(folded);
        if (!slotWord) {
            corpus ??= sourceText(sources);
            if (corpus.includes(match[0])) continue;
        }
        hits.push({ kind: 'bracket', text: match[0], index: match.index!, name: NAME_SLOT.test(folded) });
    }
    for (const match of text.matchAll(TEMPLATE_DOUBLE)) hits.push({ kind: 'template', text: match[0], index: match.index!, name: NAME_SLOT.test(fold(match[0].slice(2, -2).trim())) });
    for (const match of text.matchAll(TEMPLATE_SINGLE)) {
        if (hits.some(hit => hit.kind === 'template' && match.index! >= hit.index && match.index! < hit.index + hit.text.length)) continue;
        hits.push({ kind: 'template', text: match[0], index: match.index!, name: NAME_SLOT.test(fold(match[1].trim())) });
    }
    for (const match of text.matchAll(ANGLE)) {
        const inner = fold(match[1].trim());
        const words = inner.split(/\s+/).filter(Boolean);
        const lettersOnly = /^[\p{L}\s'’_-]+$/u.test(inner);
        if (!(ANGLE_LEAD.test(inner) && lettersOnly) && !(lettersOnly && words.length >= 2)) continue;
        hits.push({ kind: 'angle', text: match[0], index: match.index!, name: NAME_SLOT.test(inner) });
    }
    for (const re of [DUMMY_GROUPS, DUMMY_RUN]) {
        for (const match of text.matchAll(re)) {
            if (hits.some(hit => match.index! >= hit.index && match.index! < hit.index + hit.text.length)) continue;
            hits.push({ kind: 'dummy_number', text: match[0], index: match.index!, name: false });
        }
    }
    return hits.sort((a, b) => a.index - b.index);
}

export function hasUnfilledPlaceholder(text: string, sources?: ReadonlyArray<unknown>): boolean {
    return findUnfilledPlaceholders(text, sources).length > 0;
}

/*
 * F4300-34 residual (production 25-oct, the same dental tenant with no emergency phone): «ligue para o número de plantão:
 * 123-456-7890» (an INVENTED phone) and «¿Quiere que le proporcione el número de guardia para emergencias…?» (an OFFER of a
 * number that does not exist). A contact detail in a reply must be one the turn's business data holds.
 */
export type ContactKind = 'phone' | 'emergency_number' | 'email' | 'url' | 'handle' | 'contact_offer';
export interface ContactHit { readonly kind: ContactKind; readonly text: string; readonly index: number }

/** A run of digits with phone separators (7 to 15 digits once the separators are gone). */
const PHONE_CANDIDATE = /\+?\(?\d[\d \t().-]{5,22}\d/g;
const DIGITS_RUN = /\d{7,15}/g;
/** Words before a number that make it a reference, a code or an amount, never a phone. */
const REFERENCE_BEFORE = /(?:ref\.?|referencia|reference|referência|pedido|orden|order|commande|encomenda|reserva|booking|réservation|reservation|codigo|código|code|cod\.?|factura|invoice|fatura|facture|nº|n°|no\.|#|id|nit|rut|cpf|cnpj|dni|cc|guia|guía|tracking|seguimiento|rastreio|suivi)\s*[:#]?\s*$/i;
const CURRENCY_BEFORE = /(?:[$€£¥₡₲₱]|r\$|us\$|cop|usd|eur|brl|mxn|clp|pen|ars)\s*$/i;
const CURRENCY_AFTER = /^\s*(?:[$€£]|cop|usd|eur|brl|mxn|clp|pen|ars|pesos?|reais|real|euros?|d[oó]lares|dollars?|soles|bolivianos|%|k\b|mil\b|millones|millions?|milh(?:ão|ões))/i;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()[\]"'«»]+/gi;
const HANDLE = /(?<![\p{L}\p{N}._@/])@[A-Za-z0-9_.]{3,30}[A-Za-z0-9_]/gu;
/** National emergency numbers a model is tempted to write («llame al 123», «call 911», «ligue 192»). */
const EMERGENCY_NUMBER = /(?:llam\w*|marqu\w*|comuniqu\w*|call\w*|dial\w*|phone|ring|lig\w*|disque\w*|t[eé]l[eé]fon\w*|appel\w*|compos\w*|contact\w*|line\w*|l[ií]nea|n[uú]m[eé]ro|number)(?!\p{L})[^.!?\n\d]{0,40}?(?<![\p{L}\p{N}:.,])(911|112|123|125|132|190|192|193|199|999|000|106|116|117|119|110|120|066|080)(?!\p{N}|\s*(?:[:.,]\d|h\b|hs\b|horas?|hours?|min|am\b|pm\b|%|pesos|reais|euros|d[oó]lares|usd|cop|eur|brl))/gu;
/** An offer to give a phone / contact («¿quiere que le proporcione el número…?»), es / en / pt / fr, on folded text. */
const CONTACT_OFFER = [
    /\b(?:quiere|quieres|desea|deseas|le gustaria|te gustaria|puedo|podria|prefiere)\b.{0,40}\b(?:proporcion\w*|dar\w*|le de|te de|doy|compart\w*|pas[eao]\w*|envi\w*|facilit\w*|indic\w*)\b.{0,40}\b(?:telefono|whatsapp|celular|numero (?:de )?(?:telefono|contacto|guardia|turno|emergencias?|urgencias?|whatsapp|celular)|linea (?:de )?(?:guardia|emergencias?|urgencias?|atencion))\b/,
    /\b(?:would you like|do you want|shall i|should i|can i|i can|let me|may i)\b.{0,40}\b(?:give|provide|share|send|pass|get)\b.{0,40}\b(?:phone|whatsapp|(?:emergency|on-call|after-hours|contact|phone|guard) (?:number|line)|hotline)\b/,
    /\b(?:quer|queres|deseja|gostaria|posso|prefere)\b.{0,40}\b(?:passe\w*|passar|dar|lhe de|forneca|fornecer|compartilh\w*|envi\w*|inform\w*|indic\w*)\b.{0,40}\b(?:telefone|whatsapp|celular|numero (?:de )?(?:telefone|contato|plantao|emergencias?|urgencias?|whatsapp|celular)|linha (?:de )?(?:plantao|emergencias?|urgencias?))\b/,
    /\b(?:voulez-vous|souhaitez-vous|desirez-vous|puis-je|je peux)\b.{0,40}\b(?:donn\w*|fourni\w*|communiqu\w*|transmet\w*|envoi\w*|envoy\w*|partag\w*|indiqu\w*)\b.{0,40}\b(?:telephone|whatsapp|numero (?:de )?(?:telephone|contact|garde|urgences?|whatsapp)|ligne (?:de )?(?:garde|urgences?))\b/,
];

const digitsOf = (text: string) => text.replace(/\D/g, '');

/** The phones the business data writes (digits only), however it writes them. */
function sourcePhones(corpus: string): string[] {
    const phones = new Set<string>();
    for (const match of corpus.matchAll(PHONE_CANDIDATE)) {
        const digits = digitsOf(match[0]);
        if (digits.length >= 7 && digits.length <= 15) phones.add(digits);
    }
    for (const match of corpus.matchAll(DIGITS_RUN)) phones.add(match[0]);
    return [...phones];
}

const PHONE_FIELD = /["<](?:phone|telefono|teléfono|telefone|téléphone|whatsapp|celular|mobile|movil|móvil|tel)\w*["']?>?\s*:?\s*"?\+?\d[\d \t().-]{5,}\d/i;
/** Does the business data hold a phone at all (a phone field, or a number that reads as a phone)? Dates and amounts do not count. */
function holdsPhone(corpus: string): boolean {
    if (PHONE_FIELD.test(corpus)) return true;
    for (const match of corpus.matchAll(PHONE_CANDIDATE)) if (looksLikePhone(corpus, match[0], match.index!)) return true;
    return false;
}

const phoneBacked = (digits: string, phones: string[]) =>
    phones.some(source => source === digits || (Math.min(source.length, digits.length) >= 7 && (source.endsWith(digits) || digits.endsWith(source))));

/** Is this digit run a phone? Dates, times, amounts, ranges of years and references are not. */
function looksLikePhone(text: string, match: string, index: number): boolean {
    const digits = digitsOf(match);
    if (digits.length < 7 || digits.length > 15) return false;
    const before = text.slice(Math.max(0, index - 24), index);
    const after = text.slice(index + match.length, index + match.length + 16);
    if (/[\p{L}\p{N}$€£/#]$/u.test(before) || /^[\p{L}\p{N}%/:]/u.test(after)) return false;
    if (REFERENCE_BEFORE.test(before) || CURRENCY_BEFORE.test(before) || CURRENCY_AFTER.test(after)) return false;
    const m = match.trim();
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(m) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(m)) return false; // a date
    if (/^\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?$/.test(m)) return false; // an amount grouped by thousands
    if (/^(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}$/.test(m)) return false; // a range of years
    return true;
}

const normalizeUrl = (url: string) => url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

/**
 * The contact details of the text that the business data of the turn (`sources`) does not hold: a phone, an emergency
 * number, an e-mail, a link or a handle, and an offer to give a phone when the data holds no phone at all.
 */
export function findUnbackedContacts(text: string, sources?: ReadonlyArray<unknown>): ContactHit[] {
    if (!text) return [];
    const corpus = sourceText(sources);
    const lower = corpus.toLowerCase();
    const phones = sourcePhones(corpus);
    const hits: ContactHit[] = [];
    const inside = (index: number) => hits.some(hit => index >= hit.index && index < hit.index + hit.text.length);
    for (const match of text.matchAll(URL_RE)) {
        const url = match[0].replace(/[.,;:!?)\]]+$/, '');
        const normalized = normalizeUrl(url);
        if (normalized && !lower.includes(normalized)) hits.push({ kind: 'url', text: url, index: match.index! });
    }
    for (const match of text.matchAll(EMAIL)) {
        if (inside(match.index!)) continue;
        if (!lower.includes(match[0].toLowerCase())) hits.push({ kind: 'email', text: match[0], index: match.index! });
    }
    for (const match of text.matchAll(HANDLE)) {
        if (inside(match.index!)) continue;
        if (!lower.includes(match[0].toLowerCase())) hits.push({ kind: 'handle', text: match[0], index: match.index! });
    }
    for (const match of text.matchAll(PHONE_CANDIDATE)) {
        const raw = match[0].replace(/[\s(.-]+$/, '');
        const index = match.index! + (match[0].length - match[0].trimStart().length);
        if (inside(index) || !looksLikePhone(text, raw.trim(), index)) continue;
        if (!phoneBacked(digitsOf(raw), phones)) hits.push({ kind: 'phone', text: raw.trim(), index });
    }
    for (const match of text.toLowerCase().matchAll(EMERGENCY_NUMBER)) {
        const number = match[1];
        const index = match.index! + match[0].lastIndexOf(number);
        if (inside(index)) continue;
        if (!new RegExp(`(?<![\\d.,:])\\b${number}\\b(?![\\d]|[.,:]\\d)`).test(corpus)) hits.push({ kind: 'emergency_number', text: text.slice(index, index + number.length), index });
    }
    if (!holdsPhone(corpus)) {
        const folded = fold(text);
        const offer = CONTACT_OFFER.find(re => re.test(folded));
        if (offer) hits.push({ kind: 'contact_offer', text: text.trim(), index: 0 });
    }
    return hits.sort((a, b) => a.index - b.index);
}

/** Health / safety emergency words, es / en / pt / fr, on folded text. */
const EMERGENCY = /\b(?:emergenc\w*|emergenz\w*|urgenc\w*|urgent\w*|urgente|guardia|plantao|de garde|on[- ]call|after[- ]hours|dolor\w*|duele|dueles?|pain\w*|hurts?|hurting|dor|doi|doendo|douleur\w*|mal aux?|sangr\w*|bleed\w*|saign\w*|accident\w*|fractur\w*|broke|broken|rompi\w*|roto|rota|quebr\w*|cass[ea]\w*|injur\w*|herid\w*|lesion\w*|blessure\w*|swell\w*|hinchaz\w*|inchac\w*|gonfl\w*|fever|fiebre|febre|fievre|ambulanc\w*|samu|poison\w*|envenen\w*|intoxica\w*)\b/;
export const mentionsEmergency = (text: string | undefined): boolean => !!text && EMERGENCY.test(fold(text));

/** A sentence that is only courtesy: it carries nothing the customer asked for. */
const COURTESY = new RegExp('^(?:' + [
    // en
    'if you (?:need|have|want) (?:anything|any|something|more|further|other)', 'let me know if', 'i(?: am|\'m|’m) (?:here|happy|glad) to help',
    'feel free', 'is there anything else', 'anything else', 'hope (?:this|that) helps', 'thank(?:s| you)', 'hello', 'hi', 'have a (?:nice|great|good)',
    'happy to help', 'you(?:\'re| are) welcome',
    // es
    'si (?:necesita|necesitas|tiene|tienes|desea|deseas|requiere) (?:algo|alguna|algun|cualquier|mas|otra|otro|ayuda)', 'estoy (?:aqui|a su disposicion|a tu disposicion|para (?:ayudar|servir))',
    'quedo (?:atent[oa]|a su disposicion|a tu disposicion)', 'hay algo mas', 'algo mas', 'con gusto', 'gracias', 'hola', 'buen(?:os|as) (?:dias|tardes|noches)',
    'no dude en', 'no dudes en', 'cualquier (?:cosa|duda|consulta|otra)', 'espero (?:que )?(?:esto|le|te) (?:sirva|ayude)', 'que tenga un', 'a la orden',
    // pt
    'se (?:precisar|tiver|necessitar|quiser) (?:de )?(?:algo|mais|outra|qualquer|ajuda)', 'estou (?:aqui|a disposicao|a sua disposicao)', 'fico (?:a disposicao|a sua disposicao)',
    'posso ajudar (?:em|com) (?:algo|mais)', 'algo mais', 'obrigad[oa]', 'ola', 'oi', 'qualquer (?:coisa|duvida)', 'conte comigo',
    // fr
    'si vous avez besoin', 'n\'hesitez pas', 'je suis (?:la|ici|a votre disposition) pour', 'je reste a (?:votre )?disposition', 'autre chose',
    'merci', 'bonjour', 'bonne (?:journee|soiree)', 'y a-t-il autre chose', 'puis-je vous aider',
].join('|') + ')\\b');

const isCourtesy = (sentence: string) => {
    const folded = fold(sentence).replace(/^[\s¿¡"'«“(\-–—*•]+/, '').trim();
    if (!folded) return true;
    if (COURTESY.test(folded)) return true;
    return folded.split(/\s+/).filter(word => /\p{L}/u.test(word)).length < 3;
};

const EMERGENCY_FALLBACK: Record<string, string> = {
    es: 'No tengo registrado un contacto de emergencia del negocio para darle. Si se trata de una urgencia, acuda al servicio de urgencias más cercano o llame a la línea de emergencias de su localidad.',
    en: 'I do not have an emergency contact for the business on file to give you. If this is an emergency, please go to the nearest emergency service or call your local emergency number.',
    pt: 'Não tenho registrado um contato de emergência da empresa para lhe passar. Se for uma urgência, procure o serviço de emergência mais próximo ou ligue para o número de emergência da sua localidade.',
    fr: "Je n'ai pas de contact d'urgence de l'établissement enregistré à vous communiquer. S'il s'agit d'une urgence, rendez-vous au service d'urgences le plus proche ou appelez le numéro d'urgence local.",
};
const code = (lang?: string) => {
    const c = (lang || 'es').slice(0, 2).toLowerCase();
    return ['es', 'en', 'pt', 'fr'].includes(c) ? c : 'es';
};
export const emergencyFallbackText = (lang?: string): string => EMERGENCY_FALLBACK[code(lang)];
export const placeholderFallbackText = (lang?: string, canOfferPerson = true): string =>
    canOfferPerson ? noDataWaitReplacementText(code(lang)) : noDataNoOfferText(code(lang));

/** The fixed texts of this guard, so that no later step mistakes them for a model reply. */
export const UNFILLED_PLACEHOLDER_FIXED_TEXTS: ReadonlyArray<string> = Object.values(EMERGENCY_FALLBACK);

interface Piece { text: string; sep: string }

/** Sentences with the separator that preceded each one (line breaks, or the spaces after «.», «!», «?», «…»). */
function splitSentences(text: string): Piece[] {
    const parts = text.split(/(\n+|(?<=[.!?…])[ \t]+)/);
    const pieces: Piece[] = [];
    let sep = '';
    parts.forEach((part, index) => {
        if (index % 2 === 1) { sep += part; return; }
        if (!part) return;
        pieces.push({ text: part, sep });
        sep = '';
    });
    return pieces;
}

/** A sentence once a name slot is taken out of it («Hola [nombre], su cita…» → «Hola, su cita…»). */
const tidy = (sentence: string) => sentence
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;!?…])/g, '$1')
    .replace(/([¿¡(])\s+/g, '$1')
    .replace(/,\s*([.!?…])/g, '$1')
    .replace(/,(\s*),/g, ',')
    .replace(/^\s*,\s*/, '')
    .trim();

export function guardUnfilledPlaceholders(input: UnfilledPlaceholderGuardInput): UnfilledPlaceholderGuardResult {
    const reply = input.reply || '';
    const pieces = splitSentences(reply).map(piece => ({ piece, hits: findUnfilledPlaceholders(piece.text, input.sources),
        contacts: findUnbackedContacts(piece.text, input.sources) }));
    const placeholders = pieces.flatMap(entry => entry.hits.map(hit => hit.text));
    const contacts = pieces.flatMap(entry => entry.contacts.map(hit => hit.text));
    if (!placeholders.length && !contacts.length) return { changed: false, text: reply, action: 'none', placeholders: [], contacts: [] };
    const lang = code(input.lang);
    const out: Piece[] = [];
    let removedAt = -1;
    let removedEmergency = false;
    for (const { piece, hits, contacts: unbacked } of pieces) {
        if (!hits.length && !unbacked.length) { out.push(piece); continue; }
        if (!unbacked.length && hits.every(hit => hit.name)) {
            let text = piece.text;
            for (const hit of hits) text = text.split(hit.text).join('');
            text = tidy(text);
            if (text && !hasUnfilledPlaceholder(text, input.sources)) { out.push({ text, sep: piece.sep }); continue; }
        }
        if (mentionsEmergency(piece.text)) removedEmergency = true;
        // a line that only introduced the slot («Llámenos aquí:» + line break + slot) goes with it
        const previous = out[out.length - 1];
        if (previous && /:\s*$/.test(previous.text) && /\n/.test(piece.sep)) {
            if (mentionsEmergency(previous.text)) removedEmergency = true;
            out.pop();
        }
        if (removedAt < 0 || removedAt > out.length) removedAt = out.length;
    }
    if (removedAt < 0) {
        // only name slots, each taken out of its sentence
        return { changed: true, text: out.map((piece, index) => (index ? piece.sep || ' ' : '') + piece.text).join('').trim(), action: 'removed', placeholders, contacts };
    }
    const emergency = removedEmergency || mentionsEmergency(input.customerText);
    if (!out.some(piece => !isCourtesy(piece.text))) {
        const text = emergency ? emergencyFallbackText(lang) : placeholderFallbackText(lang, input.canOfferPerson !== false);
        return { changed: true, text, action: emergency ? 'emergency_fallback' : 'fallback', placeholders, contacts };
    }
    // the customer is never left without the emergency instruction the removed sentence was giving
    if (removedEmergency) out.splice(removedAt, 0, { text: emergencyFallbackText(lang), sep: removedAt ? ' ' : '' });
    const text = out.map((piece, index) => (index ? piece.sep || ' ' : '') + piece.text).join('').trim();
    return { changed: true, text, action: removedEmergency ? 'emergency_fallback' : 'removed', placeholders, contacts };
}
