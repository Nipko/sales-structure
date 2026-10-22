import { BusinessWindow, disambiguateBareHour } from './business-window';

/**
 * The part of a day the customer asked for ("mañana en la tarde", "after 3 pm",
 * "entre 14h e 17h"), as a typed value instead of a single hour.
 *
 * Behind the per-tenant flag `agentRuntime.slotWindow`: with the flag off nothing
 * in this file is reached and the slot offer is the one it always was.
 *
 * Conventions (the business has no setting of its own for these yet, so they are
 * fixed here and only clamped by its real opening hours):
 *   - morning   = opening time (or 00:00 when unknown) until 12:00;
 *   - afternoon = 12:00 until closing time (or 24:00 when unknown);
 *   - evening   = 18:00 until closing time (or 24:00 when unknown);
 *   - `from` is inclusive and `to` exclusive, both on the slot START time:
 *     "después de las 13:00" offers 13:00, "antes de las 11" offers 10:30 but not 11:00;
 *   - `partOfDay` and `from`/`to` intersect ("en la tarde después de las 3" = 15:00 until closing).
 * A business that closes at 18:00 therefore has no evening: the request is answered
 * with the nearest free slots, never with "no availability".
 */
export type PartOfDay = 'morning' | 'afternoon' | 'evening';
export const PARTS_OF_DAY: readonly PartOfDay[] = ['morning', 'afternoon', 'evening'];

export interface TimeWindow {
    partOfDay?: PartOfDay;
    /** HH:MM 24h, inclusive. */
    from?: string;
    /** HH:MM 24h, exclusive. */
    to?: string;
}

/** Where the part-of-day boundaries fall, in minutes since midnight. */
export interface PartOfDayBoundaries { morningEnd: number; eveningStart: number }
export const DEFAULT_PART_OF_DAY_BOUNDARIES: PartOfDayBoundaries = Object.freeze({ morningEnd: 12 * 60, eveningStart: 18 * 60 });

/** The window as minutes of the day: a slot is inside when `fromMin <= start < toMin`. */
export interface ResolvedTimeWindow { fromMin: number; toMin: number }

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function hhmmToMinutes(value: string): number | null {
    const match = HHMM.exec(value.trim());
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function minutesToHhmm(minutes: number): string {
    const clamped = Math.max(0, Math.min(1440, Math.round(minutes)));
    if (clamped === 1440) return '24:00';
    return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/**
 * A model- or state-supplied window, validated. Anything unreadable is dropped;
 * a window with nothing usable left is `null` (the caller then behaves as if no
 * window had been asked for).
 */
export function parseTimeWindow(raw: unknown): TimeWindow | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const input = raw as Record<string, unknown>;
    const out: TimeWindow = {};
    if (typeof input.partOfDay === 'string' && (PARTS_OF_DAY as readonly string[]).includes(input.partOfDay)) {
        out.partOfDay = input.partOfDay as PartOfDay;
    }
    for (const key of ['from', 'to'] as const) {
        const value = input[key];
        if (typeof value !== 'string') continue;
        const minutes = hhmmToMinutes(value);
        if (minutes !== null) out[key] = minutesToHhmm(minutes);
    }
    return out.partOfDay || out.from || out.to ? out : null;
}

export function sameTimeWindow(a: TimeWindow | null | undefined, b: TimeWindow | null | undefined): boolean {
    return (a?.partOfDay ?? null) === (b?.partOfDay ?? null)
        && (a?.from ?? null) === (b?.from ?? null)
        && (a?.to ?? null) === (b?.to ?? null);
}

/**
 * The window in minutes, clamped to the business's own opening window when it
 * is known. The result may be empty (`fromMin >= toMin`): a part of the day the
 * business does not open is still a request the caller must answer honestly.
 */
export function resolveTimeWindow(
    window: TimeWindow,
    business: BusinessWindow | null | undefined,
    boundaries: PartOfDayBoundaries = DEFAULT_PART_OF_DAY_BOUNDARIES,
): ResolvedTimeWindow {
    const open = business?.openMin ?? 0;
    const close = business?.closeMin ?? 1440;
    let fromMin = open;
    let toMin = close;
    if (window.partOfDay === 'morning') toMin = Math.min(close, boundaries.morningEnd);
    else if (window.partOfDay === 'afternoon') fromMin = Math.max(open, boundaries.morningEnd);
    else if (window.partOfDay === 'evening') fromMin = Math.max(open, boundaries.eveningStart);
    const from = window.from ? hhmmToMinutes(window.from) : null;
    const to = window.to ? hhmmToMinutes(window.to) : null;
    if (from !== null) fromMin = Math.max(fromMin, from);
    if (to !== null) toMin = Math.min(toMin, to === 0 ? 1440 : to);
    return { fromMin, toMin };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading the window from the customer's words (es / en / pt / fr)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractedTimeWindow {
    /** The window the message asks for, when it asks for one. */
    window?: TimeWindow;
    /** The message lifts any earlier window ("a cualquier hora", "any time"). */
    cleared?: boolean;
    /** An hour in the message is a range bound ("después de las 3"), not a time to book. */
    fromRange?: boolean;
}

function fold(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`´]/g, "'");
}

const DAY_WORDS = 'hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo';

/**
 * Part-of-day phrases. Each one needs a preposition, a demonstrative or a day in
 * front of it, so greetings ("buenas tardes", "boa tarde", "good morning", "bonsoir")
 * and "mañana" = tomorrow are never read as a window.
 */
const PART_PATTERNS: Record<PartOfDay, RegExp[]> = {
    morning: [
        /\b(?:en|por|de|a|para|esta|toda)\s+la\s+manana\b/,
        /\bpor\s+las\s+mananas\b/,
        /\bmanha\b/,
        /(?<!good\s)\bmorning\b/,
        /\bmatin(?:ee)?\b/,
    ],
    afternoon: [
        /\b(?:en|por|de|a|para|esta|toda)\s+la\s+tarde\b/,
        /\bpor\s+las\s+tardes\b/,
        new RegExp(`\\b(?:${DAY_WORDS})\\s+tarde\\b`),
        /\b(?:a|de|pela|na|da|esta|nesta)\s+tarde\b/,
        /(?<!good\s)\bafternoon\b/,
        /\bapres[-\s]?midi\b/,
        /\baprem\b/,
    ],
    evening: [
        /\b(?:en|por|de|a|para|esta|toda)\s+la\s+noche\b/,
        /\besta\s+noche\b/,
        /\b(?:a|de|pela|na|da|esta|nesta)\s+noite\b/,
        /(?<!good\s)\bevening\b/,
        /\btonight\b/,
        /\bsoir(?:ee)?\b/,
    ],
};

const ANY_TIME = /\b(?:a\s+cualquier\s+hora|cualquier\s+hora(?:rio)?|no\s+importa\s+la\s+hora|da\s+igual\s+la\s+hora|any\s*time|whenever|qualquer\s+hor(?:a|ario)|n'importe\s+(?:quand|quelle\s+heure)|a\s+toute\s+heure)\b/;

/** Hour token: "3", "3pm", "3 p.m.", "15:00", "15h", "15h30", "3 de la tarde", "3 da tarde", "3 du soir". */
const HOUR = String.raw`(\d{1,2})(?:\s*(?::|h|\.)\s*(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?|hs|hrs?|h)?(?:\s+(?:de\s+la\s+|da\s+|du\s+|de\s+l'\s*|in\s+the\s+)(manana|tarde|noche|manha|noite|matin|soir|apres-midi|morning|afternoon|evening))?`;
/** What can follow an hour that is not an hour: "después de 2 días", "antes del 15 de octubre". */
const NOT_AN_HOUR = String.raw`(?!\d|[a-z]|\s*(?:[/-]\d|dias?|days?|semanas?|weeks?|horas?|hours?|minutos?|minutes?|meses|mes|months?|jours?|semaines?|heures?|anos?|years?|personas?|people|pessoas|(?:de\s+|of\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|janeiro|fevereiro|marco|maio|junho|julho|setembro|outubro|novembro|dezembro|january|february|march|april|may|june|july|august|september|october|november|december|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b))`;

const FROM_PREFIX = String.raw`(?:despues\s+de(?:\s+las?)?|a\s+partir\s+d(?:e|as?)(?:\s+las?)?|desde(?:\s+las?)?|pasadas?\s+las|depois\s+d(?:e|as?)|apos(?:\s+as?)?|after|from|later\s+than|apres|des)`;
const TO_PREFIX = String.raw`(?:antes\s+d(?:e|as?)(?:\s+las?)?|hasta(?:\s+las?)?|ate(?:\s+as?)?|before|until|till|no\s+later\s+than|avant|jusqu'?\s*a)`;

const BETWEEN = [
    new RegExp(String.raw`\bentre\s+(?:las?\s+|as?\s+)?${HOUR}\s+(?:y|e|et)\s+(?:las?\s+|as?\s+)?${HOUR}${NOT_AN_HOUR}`),
    new RegExp(String.raw`\bbetween\s+${HOUR}\s+and\s+${HOUR}${NOT_AN_HOUR}`),
    new RegExp(String.raw`\bfrom\s+${HOUR}\s+(?:to|until|till)\s+${HOUR}${NOT_AN_HOUR}`),
    new RegExp(String.raw`\bde\s+(?:las?\s+)?${HOUR}\s+a\s+(?:las?\s+)?${HOUR}${NOT_AN_HOUR}`),
];
const FROM = new RegExp(String.raw`\b${FROM_PREFIX}\s+${HOUR}${NOT_AN_HOUR}`);
const TO = new RegExp(String.raw`\b${TO_PREFIX}\s+${HOUR}${NOT_AN_HOUR}`);

function readHour(
    hourText: string, minuteText: string | undefined, marker: string | undefined, qualifier: string | undefined,
    partOfDay: PartOfDay | undefined, business: BusinessWindow | null,
): number | null {
    let hour = Number(hourText);
    const minutes = minuteText ? Number(minuteText) : 0;
    if (!Number.isFinite(hour) || hour > 23 || minutes > 59) return null;
    const m = (marker || '').replace(/[\s.]/g, '');
    const q = qualifier || '';
    const pm = m === 'pm' || /tarde|noche|noite|soir|apres|afternoon|evening/.test(q);
    const am = m === 'am' || /manana|manha|matin|morning/.test(q);
    if (pm && hour < 12) hour += 12;
    else if (am && hour === 12) hour = 0;
    else if (!pm && !am && !/^(?:h|hs|hrs?)$/.test(m) && !minuteText) {
        // A bare "las 3": the part of the day said in the same message decides, then the opening hours.
        if ((partOfDay === 'afternoon' || partOfDay === 'evening') && hour >= 1 && hour < 12) hour += 12;
        else if (!partOfDay) hour = disambiguateBareHour(hour, minutes, business);
    }
    return hour * 60 + minutes;
}

/**
 * The window a message asks for. Pure and deterministic; `business` (the opening
 * window of the date in question) only places a bare hour such as "después de las 3".
 */
export function extractTimeWindow(text: string, business: BusinessWindow | null = null): ExtractedTimeWindow | null {
    const t = fold(text || '');
    if (!t.trim()) return null;
    if (ANY_TIME.test(t)) return { cleared: true };

    const parts = PARTS_OF_DAY.filter(part => PART_PATTERNS[part].some(pattern => pattern.test(t)));
    // "en la mañana o en la tarde": two parts of the day are no window at all.
    const partOfDay = parts.length === 1 ? parts[0] : undefined;

    let fromMin: number | null = null;
    let toMin: number | null = null;
    for (const pattern of BETWEEN) {
        const match = pattern.exec(t);
        if (!match) continue;
        const a = readHour(match[1], match[2], match[3], match[4], partOfDay, business);
        // The second hour's own marker also qualifies the first one ("entre 2 y 5 pm").
        const b = readHour(match[5], match[6], match[7], match[8], partOfDay, business);
        const shared = match[7] || match[8];
        const a2 = !match[3] && !match[4] && shared ? readHour(match[1], match[2], match[7], match[8], partOfDay, business) : a;
        if (a2 !== null && b !== null && a2 < b) { fromMin = a2; toMin = b; break; }
    }
    if (fromMin === null && toMin === null) {
        const from = FROM.exec(t);
        if (from) fromMin = readHour(from[1], from[2], from[3], from[4], partOfDay, business);
        const to = TO.exec(t);
        if (to) toMin = readHour(to[1], to[2], to[3], to[4], partOfDay, business);
    }

    const window: TimeWindow = {};
    if (partOfDay) window.partOfDay = partOfDay;
    if (fromMin !== null) window.from = minutesToHhmm(fromMin);
    if (toMin !== null) window.to = minutesToHhmm(toMin);
    if (!window.partOfDay && !window.from && !window.to) return null;
    return { window, fromRange: fromMin !== null || toMin !== null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Wording of the window for the deterministic replies
// ─────────────────────────────────────────────────────────────────────────────

const PART_LABEL: Record<string, Record<PartOfDay, string>> = {
    es: { morning: 'en la mañana', afternoon: 'en la tarde', evening: 'en la noche' },
    en: { morning: 'in the morning', afternoon: 'in the afternoon', evening: 'in the evening' },
    pt: { morning: 'de manhã', afternoon: 'à tarde', evening: 'à noite' },
    fr: { morning: 'le matin', afternoon: "l'après-midi", evening: 'le soir' },
};
const RANGE_LABEL: Record<string, { from: string; to: string; between: string }> = {
    es: { from: 'después de las {from}', to: 'antes de las {to}', between: 'entre las {from} y las {to}' },
    en: { from: 'after {from}', to: 'before {to}', between: 'between {from} and {to}' },
    pt: { from: 'depois das {from}', to: 'antes das {to}', between: 'entre {from} e {to}' },
    fr: { from: 'après {from}', to: 'avant {to}', between: 'entre {from} et {to}' },
};

/** "en la tarde", "después de las 15:00", "en la tarde después de las 15:00". */
export function describeTimeWindow(window: TimeWindow, lang: string): string {
    const code = (lang || 'es').slice(0, 2);
    const parts = PART_LABEL[code] || PART_LABEL.es;
    const ranges = RANGE_LABEL[code] || RANGE_LABEL.es;
    const out: string[] = [];
    if (window.partOfDay) out.push(parts[window.partOfDay]);
    const fill = (template: string) => template.replace('{from}', window.from || '').replace('{to}', window.to || '');
    if (window.from && window.to) out.push(fill(ranges.between));
    else if (window.from) out.push(fill(ranges.from));
    else if (window.to) out.push(fill(ranges.to));
    return out.join(' ');
}
