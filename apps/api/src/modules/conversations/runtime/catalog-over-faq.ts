import type { RetrievedKnowledgeItem } from '@parallext/shared';
import type { AddressForm } from '../transition-engine';

/**
 * The service catalogue decides what the business offers (flag `agentRuntime.catalogOverFaq`, off by default).
 *
 * F4300-24, dental tenant, production QA: the catalogue (`list_services`) had three services — «Consulta general»,
 * «Consulta especializada», «Control y seguimiento» — and a seeded business-type FAQ said «¿Cuánto tiempo dura un
 * tratamiento de ortodoncia? — … entre 12 y 24 meses». Asked «¿tienen tratamiento de ortodoncia?», the agent read the FAQ
 * and answered «Sí, ofrecemos tratamiento de ortodoncia». The model followed its data: the FAQ talked about a service the
 * business does not sell.
 *
 * With the flag on, for a tenant whose agent reads a service catalogue:
 *  - a knowledge item (FAQ, RAG chunk, search_faqs / search_knowledge_base result) naming a service that the catalogue
 *    does not list carries `not_in_catalogue`, so the model reads it as "not proof the service is offered";
 *  - the contract gets one rule saying the catalogue is the authority for what is offered;
 *  - a reply that still says «sí, ofrecemos X» for such an X is replaced by a not-offered answer listing the catalogue.
 *
 * What counts as "naming a service" is deliberately narrow, so a FAQ about parking, payment methods or opening hours is
 * never touched: a generic service head followed by a connector — «tratamiento de X», «servicio de X», «terapia de X»,
 * «treatment for X», «séance de X» — and X is the service. X is in the catalogue when any of its significant words appears
 * in a catalogue service name or description (accent- and plural-insensitive). When unsure, the item is left as it was.
 */

export interface CatalogueEntry { name: string; description?: string | null }

export interface AbsentSubject {
    /** The phrase as written, lower-cased: «tratamiento de ortodoncia». */
    phrase: string;
    /** Folded key of the service words only: «ortodoncia». */
    key: string;
    /** Folded significant words of the service: matched against the reply. */
    words: string[];
}

const fold = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const stem = (word: string): string => {
    const w = fold(word);
    if (w.length > 5 && w.endsWith('es')) return w.slice(0, -2);
    if (w.length > 4 && w.endsWith('s')) return w.slice(0, -1);
    return w;
};

/** Generic heads that introduce a service by name: «tratamiento de …». Folded and singular. */
const SERVICE_HEADS = new Set([
    // es
    'tratamiento', 'servicio', 'procedimiento', 'terapia', 'sesion', 'cirugia', 'clase', 'curso', 'consulta', 'examen',
    // pt
    'tratamento', 'servico', 'procedimento', 'sessao', 'cirurgia', 'aula', 'exame',
    // fr
    'traitement', 'procedure', 'therapie', 'seance', 'chirurgie', 'cours', 'consultation',
    // en
    'treatment', 'service', 'therapy', 'session', 'surgery', 'class', 'course', 'exam',
]);
const HEAD_PLURALS: Record<string, string> = {
    tratamientos: 'tratamiento', servicios: 'servicio', procedimientos: 'procedimiento', terapias: 'terapia', sesiones: 'sesion',
    cirugias: 'cirugia', clases: 'clase', cursos: 'curso', consultas: 'consulta', examenes: 'examen', tratamentos: 'tratamento',
    servicos: 'servico', procedimentos: 'procedimento', sessoes: 'sessao', cirurgias: 'cirurgia', aulas: 'aula', exames: 'exame',
    traitements: 'traitement', procedures: 'procedure', therapies: 'therapie', seances: 'seance', consultations: 'consultation',
    treatments: 'treatment', services: 'service', sessions: 'session', surgeries: 'surgery', classes: 'class', courses: 'course', exams: 'exam',
};
/** A head only introduces a service through one of these: «tratamiento DE ortodoncia», «treatment FOR braces». */
const CONNECTORS = new Set(['de', 'del', 'do', 'da', 'dos', 'das', 'du', 'des', "d'", 'of', 'for', 'para', 'pour']);
const ARTICLES = new Set(['la', 'las', 'los', 'el', 'le', 'les', 'the', 'a', 'o', 'un', 'una', 'uno']);
/** Words that end the service name. */
const STOP = new Set([
    'y', 'o', 'e', 'en', 'con', 'que', 'por', 'a', 'al', 'es', 'son', 'se', 'si', 'no', 'mi', 'tu', 'su', 'sus', 'mis',
    'como', 'cuando', 'donde', 'dura', 'duran', 'cuesta', 'cuestan', 'puede', 'pueden', 'tiene', 'tienen', 'incluye', 'para',
    'generalmente', 'normalmente', 'aproximadamente', 'entre', 'desde', 'hasta', 'sobre', 'durante', 'tiempo', 'precio',
    'the', 'and', 'or', 'in', 'with', 'is', 'are', 'it', 'takes', 'cost', 'costs', 'usually', 'about', 'how', 'long',
    'et', 'ou', 'avec', 'est', 'sont', 'dans', 'pour', 'combien', 'prend', 'coute',
    'em', 'com', 'quanto', 'leva', 'custa', 'geralmente',
    // Verbs that commonly follow the service name («el tratamiento de ortodoncia usa…», «a treatment for braces takes…»).
    'usa', 'usan', 'utiliza', 'utilizan', 'tarda', 'tardan', 'demora', 'demoran', 'requiere', 'requieren', 'necesita',
    'necesitan', 'permite', 'ayuda', 'sirve', 'consiste', 'implica', 'ofrece', 'take', 'last', 'lasts', 'need', 'needs',
    'use', 'uses', 'requires', 'include', 'includes', 'dure', 'prend', 'utilise', 'demande', 'usa', 'precisa', 'inclui',
]);
/** Words that never identify a service on their own. */
const WEAK = new Set(['general', 'especial', 'normal', 'completo', 'completa', 'basico', 'basica', 'nuevo', 'nueva',
    'todo', 'toda', 'todos', 'todas', 'este', 'esta', 'estos', 'estas', 'cada', 'otro', 'otra', 'caso', 'casos', 'tipo', 'tipos']);

type Token = { raw: string; folded: string; word: boolean };

function tokenize(text: string): Token[] {
    const out: Token[] = [];
    for (const match of String(text ?? '').toLowerCase().matchAll(/[\p{L}\p{N}]+(?:'[\p{L}]+)?|[^\s\p{L}\p{N}]/gu)) {
        const raw = match[0];
        const word = /[\p{L}\p{N}]/u.test(raw);
        // «d'orthodontie» is the connector «d'» followed by the word.
        if (word && /^d'/.test(fold(raw)) && raw.length > 2) {
            out.push({ raw: raw.slice(0, 2), folded: "d'", word: true }, { raw: raw.slice(2), folded: fold(raw.slice(2)), word: true });
            continue;
        }
        out.push({ raw, folded: fold(raw), word });
    }
    return out;
}

const significant = (folded: string): boolean => folded.length >= 4 && !STOP.has(folded) && !WEAK.has(folded);

/** The services a text names through a generic head («tratamiento de ortodoncia» → ortodoncia). */
export function serviceSubjectsIn(text: string): AbsentSubject[] {
    const tokens = tokenize(text);
    const found = new Map<string, AbsentSubject>();
    for (let i = 0; i < tokens.length; i++) {
        const head = tokens[i];
        if (!head.word || !(SERVICE_HEADS.has(head.folded) || HEAD_PLURALS[head.folded])) continue;
        let j = i + 1;
        if (!tokens[j] || !CONNECTORS.has(tokens[j].folded)) continue;
        j++;
        while (tokens[j] && (ARTICLES.has(tokens[j].folded) || CONNECTORS.has(tokens[j].folded))) j++;
        const words: Token[] = [];
        while (tokens[j] && tokens[j].word && !STOP.has(tokens[j].folded) && !ARTICLES.has(tokens[j].folded)
            && !CONNECTORS.has(tokens[j].folded) && words.length < 3) words.push(tokens[j++]);
        const keyWords = words.map(w => w.folded).filter(significant);
        if (!keyWords.length) continue;
        const key = keyWords.join(' ');
        if (found.has(key)) continue;
        const phrase = tokens.slice(i, i + (j - i)).filter(t => t.word).map(t => t.raw).join(' ').replace(/d' /g, "d'");
        found.set(key, { phrase, key, words: keyWords });
    }
    return [...found.values()];
}

function catalogueWords(catalogue: readonly CatalogueEntry[]): string[] {
    const words = new Set<string>();
    for (const entry of catalogue) {
        for (const token of tokenize(`${entry?.name ?? ''} ${entry?.description ?? ''}`)) {
            if (token.word && token.folded.length >= 4) words.add(stem(token.folded));
        }
    }
    return [...words];
}

const sameWord = (a: string, b: string): boolean => a === b || (a.length >= 6 && b.length >= 6 && a.slice(0, 6) === b.slice(0, 6));

/** Whether any significant word of the subject appears in a catalogue service name or description. */
export function catalogueCovers(subject: AbsentSubject, catalogue: readonly CatalogueEntry[], words = catalogueWords(catalogue)): boolean {
    return subject.words.some(word => { const s = stem(word); return words.some(c => sameWord(s, c)); });
}

/** The services a text names that the catalogue does not list. An empty catalogue decides nothing. */
export function absentServicesIn(text: string, catalogue: readonly CatalogueEntry[]): AbsentSubject[] {
    if (!catalogue.length) return [];
    const words = catalogueWords(catalogue);
    return serviceSubjectsIn(text).filter(subject => !catalogueCovers(subject, catalogue, words));
}

/** Collects absent subjects across the turn, by key. */
export class AbsentSubjects {
    private readonly byKey = new Map<string, AbsentSubject>();
    add(subjects: readonly AbsentSubject[]): void { for (const s of subjects) if (!this.byKey.has(s.key)) this.byKey.set(s.key, s); }
    list(): AbsentSubject[] { return [...this.byKey.values()]; }
}

/** Marks the knowledge items (FAQ / RAG) that name a service absent from the catalogue. Returns new items. */
export function annotateKnowledgeItems(items: readonly RetrievedKnowledgeItem[] | undefined, catalogue: readonly CatalogueEntry[],
    collect?: AbsentSubjects): RetrievedKnowledgeItem[] | undefined {
    if (!items || !catalogue.length) return items as RetrievedKnowledgeItem[] | undefined;
    return items.map(item => {
        const absent = absentServicesIn(`${item.title ?? ''}\n${item.content ?? ''}`, catalogue);
        if (!absent.length) return item;
        collect?.add(absent);
        return { ...item, notInCatalogue: absent.map(s => s.phrase) };
    });
}

const NOT_IN_CATALOGUE_NOTE = 'This text names a service that the business service catalogue does not list. It is not proof that the service is offered.';

/**
 * A search_faqs / search_knowledge_base result as the model sees it: every FAQ or chunk naming a service absent from
 * the catalogue carries `not_in_catalogue` and a note. Anything else is returned unchanged (same object).
 */
export function annotateKnowledgeToolResult(name: string | undefined, result: any, catalogue: readonly CatalogueEntry[], collect?: AbsentSubjects): any {
    if (!catalogue.length || !result || typeof result !== 'object' || Array.isArray(result) || result.error) return result;
    const field = name === 'search_faqs' ? 'faqs' : name === 'search_knowledge_base' ? 'chunks' : null;
    if (!field || !Array.isArray(result[field])) return result;
    let changed = false;
    const rows = result[field].map((row: any) => {
        if (!row || typeof row !== 'object') return row;
        const text = field === 'faqs' ? `${row.question ?? ''}\n${row.answer ?? ''}` : `${row.title ?? ''}\n${row.content ?? ''}`;
        const absent = absentServicesIn(text, catalogue);
        if (!absent.length) return row;
        changed = true;
        collect?.add(absent);
        return { ...row, not_in_catalogue: absent.map(s => s.phrase), catalogue_note: NOT_IN_CATALOGUE_NOTE };
    });
    return changed ? { ...result, [field]: rows } : result;
}

const OFFER_VERBS = new Set([
    'ofrecemos', 'tenemos', 'realizamos', 'hacemos', 'manejamos', 'brindamos', 'prestamos', 'contamos', 'ofrece', 'realiza',
    'offer', 'offers', 'provide', 'provides', 'perform', 'performs',
    'oferecemos', 'temos', 'fazemos', 'realizamos', 'prestamos',
    'proposons', 'offrons', 'faisons', 'avons', 'realisons', 'propose',
]);
const NEGATIONS = new Set(['no', 'not', "don't", 'dont', "doesn't", 'nao', 'ne', "n'", 'pas', 'nunca', 'jamas', 'jamais', 'never', 'tampoco']);
const AFFIRMATIVE_OPENERS = [/^\s*[¡!]?\s*s[ií]\s*[,!.]/i, /^\s*[¡!]?\s*claro/i, /^\s*[¡!]?\s*por supuesto/i, /^\s*yes\b/i,
    /^\s*of course\b/i, /^\s*sim\b/i, /^\s*oui\b/i, /^\s*bien s[uû]r\b/i];

/**
 * The absent service a reply presents as offered, or null. A sentence claims it when it names the service, names no
 * catalogue service, and either has an offer verb not preceded by a negation («sí, ofrecemos tratamiento de ortodoncia»)
 * or is the opening sentence starting with «sí» / «claro» / «yes» and carries no negation at all.
 */
export function offerClaimForAbsent(reply: string, absent: readonly AbsentSubject[], catalogue: readonly CatalogueEntry[]): AbsentSubject | null {
    if (!reply || !absent.length || !catalogue.length) return null;
    const names = catalogue.map(entry => fold(String(entry?.name ?? '')).trim()).filter(name => name.length >= 3);
    const opensWithYes = AFFIRMATIVE_OPENERS.some(re => re.test(reply));
    const sentences = reply.split(/(?<=[.!?\n])\s+/).filter(s => s.trim());
    for (const [index, sentence] of sentences.entries()) {
        const tokens = tokenize(sentence).filter(t => t.word);
        const foldedSentence = fold(sentence);
        if (names.some(name => foldedSentence.includes(name))) continue;
        const stems = tokens.map(t => stem(t.folded));
        const mentions = (s: AbsentSubject, from = 0) => s.words.some(word => { const w = stem(word); return stems.slice(from).some(t => sameWord(w, t)); });
        const subject = absent.find(s => mentions(s));
        if (!subject) continue;
        // «ofrecemos X»: an offer verb, not negated just before it, with the service after it.
        const verbClaim = tokens.some((t, i) => OFFER_VERBS.has(t.folded)
            && !tokens.slice(Math.max(0, i - 2), i).some(p => NEGATIONS.has(p.folded)) && mentions(subject, i + 1));
        // «Sí, …» / «¡Sí! El tratamiento de X …»: the reply opens with a yes and its first sentences name the service.
        const openerClaim = opensWithYes && index <= 1 && !tokens.some(t => NEGATIONS.has(t.folded));
        if (verbClaim || openerClaim) return subject;
    }
    return null;
}

const list = (names: string[], and: string): string =>
    names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}`;

/** Does the business's own `not_offered` list (CORE.OFFER.NOT_OFFERED, rendered for the prompt) name this subject? */
export function declaredNotOffered(subject: AbsentSubject, declared: readonly string[] | undefined): boolean {
    if (!declared?.length) return false;
    const stems = subject.words.map(stem);
    return declared.some(entry => {
        const words = fold(entry.split(' (alternative:')[0]).split(/[^a-z0-9ñ]+/).filter(Boolean).map(stem);
        return stems.length > 0 && stems.every(s => words.some(w => sameWord(s, w)));
    });
}

/**
 * The answer when the reply offered a service the catalogue does not list (R3b, D9). Only a subject the business itself
 * declared in `not_offered` gets «we don't offer X»; anything else is «I don't see X in our catalogue» — absence from
 * the catalogue is not the business saying it does not do it. The catalogue is offered instead in both cases.
 */
export function notOfferedReply(subject: AbsentSubject, catalogue: readonly CatalogueEntry[], language: string, form: AddressForm, declared?: readonly string[]): string {
    const names = [...new Set(catalogue.map(entry => String(entry?.name ?? '').trim()).filter(Boolean))].slice(0, 10);
    const lang = String(language || 'es').slice(0, 2).toLowerCase();
    const phrase = subject.phrase;
    if (!declaredNotOffered(subject, declared)) {
        if (lang === 'en') return `I don't see ${phrase} among our services. The services we offer are ${list(names, 'and')}. Would any of them interest you?`;
        if (lang === 'pt') return `Não vejo ${phrase} entre os nossos serviços. Os serviços que oferecemos são ${list(names, 'e')}. Algum deles interessa?`;
        if (lang === 'fr') return `Je ne vois pas ${phrase} parmi nos services. Les services que nous proposons sont ${list(names, 'et')}. L'un d'eux vous intéresse-t-il ?`;
        const ask = form === 'tu' ? '¿Te interesa alguno?' : '¿Le interesa alguno?';
        return `No veo ${phrase} entre nuestros servicios. Los servicios que ofrecemos son ${list(names, 'y')}. ${ask}`;
    }
    if (lang === 'en') return `We don't offer ${phrase}: it is not among our services. The services we offer are ${list(names, 'and')}. Would any of them interest you?`;
    if (lang === 'pt') return `Não oferecemos ${phrase}: não está entre os nossos serviços. Os serviços que oferecemos são ${list(names, 'e')}. Algum deles interessa?`;
    if (lang === 'fr') return `Nous ne proposons pas ${phrase} : cela ne fait pas partie de nos services. Les services que nous proposons sont ${list(names, 'et')}. L'un d'eux vous intéresse-t-il ?`;
    const close = form === 'tu' ? '¿Te interesa alguno?' : '¿Le interesa alguno?';
    return `Por ahora no ofrecemos ${phrase}: no está entre nuestros servicios. Los servicios que ofrecemos son ${list(names, 'y')}. ${close}`;
}
