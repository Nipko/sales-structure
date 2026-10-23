import type { VerifiedFactView } from '@parallext/shared';

/**
 * Per-conversation ledger of verified facts (operations runtime PR3, flag `agentRuntime.factsLedger`).
 *
 * Production QA 2026-10-22 (F4300-22): a restaurant agent read get_menu in turn 1 and quoted the confirmed 13.500 COP;
 * in turn 2, without reading again, it said «el precio no está confirmado». A tool result was authority for exactly one
 * turn: rule 22a said "read in THIS turn" and the price guardrail only knew this turn's results. The ledger keeps what
 * the business's own tools returned, typed and bound to its subject, for as long as that kind of fact stays true:
 *
 *   money 24h · attribute 24h · availability 10 min · record list 5 min · record status 2 min
 *
 * The 30-minute session boundary no longer clears facts: the TTL decides. A successful business write drops the
 * availability of the subject it touched and every record list/status (they changed). Only typed fields of successful,
 * non-knowledge tool results enter (`facts-extractors.ts`) — never customer text, model history or FAQ prose — so the
 * history can stop being where the agent "remembers" facts (F4300-08).
 *
 * Storage: `conversations.metadata.verifiedFacts` (Agent Test: the session's metadata). It is the plan's double-write
 * slot: no table, no migration, written in one `jsonb_set` beside `toolContext` under the conversation lock.
 */
export type VerifiedFactKind = VerifiedFactView['kind'];

export interface VerifiedFact {
    v: 1;
    kind: VerifiedFactKind;
    subject: { type: string; id: string; name?: string };
    field: string;
    value: string | number | boolean | string[];
    currency?: string;
    priceStatus?: string;
    complete?: boolean;
    total?: number;
    /** Slots or other short detail of an availability answer. */
    detail?: string[];
    source: { tool: string; turn?: string };
    observedAt: string;
    expiresAt: string;
}

export const FACT_TTL_MS: Readonly<Record<VerifiedFactKind, number>> = Object.freeze({
    money: 24 * 60 * 60 * 1000,
    attribute: 24 * 60 * 60 * 1000,
    availability: 10 * 60 * 1000,
    record_list: 5 * 60 * 1000,
    record_status: 2 * 60 * 1000,
});

/** Stored facts per conversation; the newest win. */
export const VERIFIED_FACTS_MAX = 60;
/** Facts rendered into one turn's `<verified_facts>`; the newest win. */
export const VERIFIED_FACTS_RENDER_MAX = 30;

const KINDS = new Set<string>(Object.keys(FACT_TTL_MS));

export function factKey(fact: Pick<VerifiedFact, 'kind' | 'subject' | 'field'>): string {
    return `${fact.kind}|${fact.subject.type}|${fact.subject.id}|${fact.field}`;
}

export function wellFormed(fact: any): fact is VerifiedFact {
    if (!fact || typeof fact !== 'object' || fact.v !== 1 || !KINDS.has(fact.kind)) return false;
    if (!fact.subject || typeof fact.subject.type !== 'string' || typeof fact.subject.id !== 'string' || !fact.subject.id) return false;
    if (typeof fact.field !== 'string' || !fact.source || typeof fact.source.tool !== 'string') return false;
    const value = fact.value;
    if (!(['string', 'number', 'boolean'].includes(typeof value) || (Array.isArray(value) && value.every((v: unknown) => typeof v === 'string')))) return false;
    if (typeof value === 'number' && !Number.isFinite(value)) return false;
    return Number.isFinite(Date.parse(fact.observedAt)) && Number.isFinite(Date.parse(fact.expiresAt));
}

/** Facts still true now. Anything malformed, expired or observed in the future (clock skew > 1 min) is dropped. */
export function liveVerifiedFacts(stored: unknown, now: Date): VerifiedFact[] {
    if (!Array.isArray(stored)) return [];
    const at = now.getTime();
    return stored.filter((fact): fact is VerifiedFact => wellFormed(fact)
        && Date.parse(fact.expiresAt) > at && Date.parse(fact.observedAt) <= at + 60_000);
}

/** What a successful business write makes stale. */
export interface FactInvalidation { subjectIds: string[]; records: boolean }

/**
 * The ledger after a turn: live previous facts, minus what this turn's writes invalidated, plus this turn's facts
 * (one entry per kind|subject|field, newest last), capped.
 */
export function mergeVerifiedFacts(previous: VerifiedFact[], added: VerifiedFact[], invalidations: FactInvalidation[] = [], now = new Date()): VerifiedFact[] {
    const stale = new Set(invalidations.flatMap(i => i.subjectIds));
    const records = invalidations.some(i => i.records);
    const kept = liveVerifiedFacts(previous, now).filter(fact =>
        !(fact.kind === 'availability' && stale.has(fact.subject.id))
        && !(records && (fact.kind === 'record_list' || fact.kind === 'record_status')));
    const byKey = new Map<string, VerifiedFact>();
    for (const fact of [...kept, ...added]) {
        const key = factKey(fact);
        byKey.delete(key);
        byKey.set(key, fact);
    }
    return [...byKey.values()].slice(-VERIFIED_FACTS_MAX);
}

/** The turn's view of live facts (`<turn><verified_facts>`), newest last. */
export function verifiedFactViews(facts: VerifiedFact[], now: Date): VerifiedFactView[] {
    return facts.slice(-VERIFIED_FACTS_RENDER_MAX).map(fact => ({
        kind: fact.kind,
        subjectType: fact.subject.type,
        subjectId: fact.subject.id,
        ...(fact.subject.name ? { subjectName: fact.subject.name } : {}),
        field: fact.field,
        value: fact.value,
        ...(fact.currency ? { currency: fact.currency } : {}),
        ...(fact.priceStatus ? { priceStatus: fact.priceStatus } : {}),
        ...(typeof fact.complete === 'boolean' ? { complete: fact.complete } : {}),
        ...(typeof fact.total === 'number' ? { total: fact.total } : {}),
        ...(fact.detail?.length ? { detail: fact.detail } : {}),
        source: fact.source.tool,
        ageMinutes: Math.max(0, Math.floor((now.getTime() - Date.parse(fact.observedAt)) / 60_000)),
    }));
}

// ── Subject-bound price support (response validator) ─────────────────────────

const LABEL_STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'en', 'the', 'of', 'and', 'with', 'do', 'da', 'dos', 'das', 'e', 'com', 'du', 'des', 'le', 'les', 'et', 'avec']);

function normalizeLabel(text: string): string {
    return ` ${text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

/** Where `label` is named in `text` (both normalized): verbatim first, else most of its words. -1 when not named. */
function namedAt(text: string, label: string, mode: 'last' | 'first'): { at: number; verbatim: boolean } | null {
    const needle = normalizeLabel(label);
    if (needle.trim().length < 2) return null;
    const at = mode === 'last' ? text.lastIndexOf(needle) : text.indexOf(needle);
    if (at >= 0) return { at, verbatim: true };
    const words = needle.trim().split(' ').filter(word => !LABEL_STOPWORDS.has(word));
    if (words.length < 2) return null;
    const positions = words.map(word => mode === 'last' ? text.lastIndexOf(` ${word} `) : text.indexOf(` ${word} `)).filter(p => p >= 0);
    if (positions.length / words.length < 0.6) return null;
    return { at: mode === 'last' ? Math.max(...positions) : Math.min(...positions), verbatim: false };
}

function sameAmount(a: number, b: number): boolean {
    return a === b || (a !== 0 && Math.abs(a - b) / Math.max(a, b) < 0.005);
}

type PricedSubject = { key: string; name: string };

/** The subject the reply attributes the amount to: the one named closest before it in its sentence, else after it. */
function attributedSubject(sentenceBefore: string, sentenceAfter: string, subjects: PricedSubject[]): PricedSubject[] | null {
    const before = normalizeLabel(sentenceBefore);
    const after = normalizeLabel(sentenceAfter);
    const pick = (text: string, mode: 'last' | 'first'): PricedSubject[] | null => {
        const hits = subjects.map(subject => ({ subject, hit: namedAt(text, subject.name, mode) }))
            .filter((h): h is { subject: PricedSubject; hit: { at: number; verbatim: boolean } } => !!h.hit);
        if (!hits.length) return null;
        const pool = hits.some(h => h.hit.verbatim) ? hits.filter(h => h.hit.verbatim) : hits;
        const best = mode === 'last' ? Math.max(...pool.map(h => h.hit.at)) : Math.min(...pool.map(h => h.hit.at));
        return pool.filter(h => h.hit.at === best).map(h => h.subject);
    };
    return pick(before, 'last') ?? pick(after, 'first');
}

/**
 * Whether a live money fact backs an amount the reply states, for the subject the reply ties it to.
 *
 * Only confirmed amounts of a NAMED subject qualify (a fact whose subject is unknown stays limited to the call that
 * produced it). The subject is the one the reply's sentence names next to the amount; when the sentence names none,
 * the one the customer's message names; when neither names one, any live subject with that amount. «La habitación B
 * cuesta 200.000» is rejected when 200.000 is room A's price, even though the number is in the ledger.
 */
export function ledgerBacksAmount(
    reply: string, mention: { amount: number; currency?: string; index: number; length: number },
    facts: readonly VerifiedFactView[], customerText = '',
): boolean {
    const priced = facts.filter(fact => fact.kind === 'money' && fact.priceStatus === 'confirmed' && typeof fact.value === 'number' && fact.subjectName);
    const owners = new Set(priced
        .filter(fact => sameAmount(fact.value as number, mention.amount)
            && !(mention.currency && fact.currency && mention.currency !== fact.currency.toUpperCase()))
        .map(fact => `${fact.subjectType}|${fact.subjectId}`));
    if (!owners.size) return false;
    const subjects = [...new Map(priced.map(fact => [`${fact.subjectType}|${fact.subjectId}`, { key: `${fact.subjectType}|${fact.subjectId}`, name: fact.subjectName! }])).values()];
    const start = Math.max(reply.lastIndexOf('\n', mention.index - 1), ...['.', '!', '?'].map(mark => {
        // A thousands separator ("13.500") is not the end of a sentence.
        for (let i = mention.index - 1; i >= 0; i--) if (reply[i] === mark && !/\d/.test(reply[i + 1] ?? '')) return i;
        return -1;
    })) + 1;
    const endCandidates = ['\n', '. ', '! ', '? '].map(mark => reply.indexOf(mark, mention.index + mention.length)).filter(i => i >= 0);
    const end = endCandidates.length ? Math.min(...endCandidates) : reply.length;
    const named = attributedSubject(reply.slice(start, mention.index), reply.slice(mention.index + mention.length, end), subjects);
    if (named) return named.some(subject => owners.has(subject.key));
    const asked = attributedSubject(customerText, '', subjects);
    if (asked) return asked.some(subject => owners.has(subject.key));
    return true;
}
