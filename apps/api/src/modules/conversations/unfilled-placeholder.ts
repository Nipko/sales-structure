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

/** Health / safety emergency words, es / en / pt / fr, on folded text. */
const EMERGENCY = /\b(?:emergenc\w*|emergenz\w*|urgenc\w*|urgent\w*|urgente|guardia|on[- ]call|after[- ]hours|dolor\w*|duele|dueles?|pain\w*|hurts?|hurting|dor|doi|doendo|douleur\w*|mal aux?|sangr\w*|bleed\w*|saign\w*|accident\w*|fractur\w*|broke|broken|rompi\w*|roto|rota|quebr\w*|cass[ea]\w*|injur\w*|herid\w*|lesion\w*|blessure\w*|swell\w*|hinchaz\w*|inchac\w*|gonfl\w*|fever|fiebre|febre|fievre|ambulanc\w*|samu|poison\w*|envenen\w*|intoxica\w*)\b/;
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
    const all = findUnfilledPlaceholders(reply, input.sources);
    if (!all.length) return { changed: false, text: reply, action: 'none', placeholders: [] };
    const lang = code(input.lang);
    const placeholders = all.map(hit => hit.text);
    const out: Piece[] = [];
    let removedAt = -1;
    let removedEmergency = false;
    for (const piece of splitSentences(reply)) {
        const hits = findUnfilledPlaceholders(piece.text, input.sources);
        if (!hits.length) { out.push(piece); continue; }
        if (hits.every(hit => hit.name)) {
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
        return { changed: true, text: out.map((piece, index) => (index ? piece.sep || ' ' : '') + piece.text).join('').trim(), action: 'removed', placeholders };
    }
    const emergency = removedEmergency || mentionsEmergency(input.customerText);
    if (!out.some(piece => !isCourtesy(piece.text))) {
        const text = emergency ? emergencyFallbackText(lang) : placeholderFallbackText(lang, input.canOfferPerson !== false);
        return { changed: true, text, action: emergency ? 'emergency_fallback' : 'fallback', placeholders };
    }
    // the customer is never left without the emergency instruction the removed sentence was giving
    if (removedEmergency) out.splice(removedAt, 0, { text: emergencyFallbackText(lang), sep: removedAt ? ' ' : '' });
    const text = out.map((piece, index) => (index ? piece.sep || ' ' : '') + piece.text).join('').trim();
    return { changed: true, text, action: removedEmergency ? 'emergency_fallback' : 'removed', placeholders };
}
