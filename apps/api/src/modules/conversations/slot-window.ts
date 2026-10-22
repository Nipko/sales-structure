/**
 * Cuántos huecos se ofrecen en una sola tanda al cliente.
 *
 * La lista visible sigue siendo corta, pero la hora que el cliente pidió no
 * puede quedar fuera de ella solo por caer lejos del inicio del día.
 */
export const MAX_OFFERED_SLOTS = 6;

const HHMM = /^(\d{1,2}):(\d{2})$/;

function toMinutes(time: string): number | null {
    const match = HHMM.exec(time.trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours > 23 || minutes > 59 ? null : hours * 60 + minutes;
}

/** Orden cronológico estable: la consulta de agenda no garantiza ninguno. */
function byTime<T extends { time: string }>(slots: readonly T[]): T[] {
    return slots
        .map((slot, index) => ({ slot, index, minutes: toMinutes(slot.time) ?? Infinity }))
        .sort((a, b) => a.minutes - b.minutes || a.index - b.index)
        .map(entry => entry.slot);
}

/**
 * Elige la tanda de huecos a mostrar.
 *
 * Sin hora pedida (o con una ilegible) devuelve los primeros `limit`, igual que
 * antes. Con hora pedida devuelve los `limit` huecos más cercanos a ella, en el
 * orden original: si existe un hueco a esa hora, está dentro; si no, quedan los
 * vecinos. No decide qué hueco se reserva: eso sigue siendo del motor.
 */
export function selectSlotWindow<T extends { time: string }>(
    slots: readonly T[],
    requestedTime?: string | null,
    limit: number = MAX_OFFERED_SLOTS,
): T[] {
    const ordered = byTime(slots);
    const requested = requestedTime ? toMinutes(requestedTime) : null;
    if (requested === null || ordered.length <= limit) return ordered.slice(0, limit);
    return ordered
        .map((slot, index) => ({ slot, index, distance: Math.abs((toMinutes(slot.time) ?? Infinity) - requested) }))
        .sort((a, b) => a.distance - b.distance || a.index - b.index)
        .slice(0, limit)
        .sort((a, b) => a.index - b.index)
        .map(entry => entry.slot);
}

/** Distancia máxima, en minutos, para recomendar un hueco en lugar de la hora pedida. */
export const NEAREST_SLOT_TOLERANCE_MIN = 30;

/**
 * Los huecos (hasta `count`, los más cercanos primero) que distan como mucho
 * `toleranceMin` de la hora pedida. Si hay uno a esa hora exacta, no hay nada
 * que recomendar y devuelve vacío. Solo recomienda: quien lo muestre debe pedir
 * confirmación antes de reservar.
 */
export function nearestSlots<T extends { time: string }>(
    slots: readonly T[],
    requestedTime: string,
    toleranceMin: number = NEAREST_SLOT_TOLERANCE_MIN,
    count = 2,
): T[] {
    const requested = toMinutes(requestedTime);
    if (requested === null || slots.some(s => toMinutes(s.time) === requested)) return [];
    const seen = new Set<string>();
    // Una hora una sola vez: con varios profesionales libres a la misma hora,
    // repetirla ocuparía los dos puestos de la recomendación.
    return byTime(slots)
        .filter(slot => !seen.has(slot.time) && !!seen.add(slot.time))
        .map(slot => ({ slot, distance: Math.abs((toMinutes(slot.time) ?? Infinity) - requested) }))
        .filter(entry => entry.distance <= toleranceMin)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, count)
        .map(entry => entry.slot)
        .sort((a, b) => (toMinutes(a.time) ?? 0) - (toMinutes(b.time) ?? 0));
}

/** How many free slots outside the requested window are offered when the window itself is full. */
export const NEAREST_OUTSIDE_WINDOW_COUNT = 3;

/** The outcome of offering slots for a requested window ("mañana en la tarde"). */
export type WindowedSlotSelection<T> =
    /** Free slots inside the window, spread across it. */
    | { kind: 'inside'; slots: T[]; insideCount: number }
    /**
     * Nothing free inside the window, but the day has other free slots: these are
     * the nearest ones. The reply must say "no hay en la tarde; lo más cercano es…",
     * never that the day has no availability.
     */
    | { kind: 'outsideRequestedWindow'; slots: T[]; insideCount: 0 };

/**
 * One slot per distinct start time, spread evenly over the ordered list: a
 * window with sixteen free half-hours offers its start, its end and points in
 * between instead of its first three hours.
 */
export function spreadSlots<T extends { time: string }>(slots: readonly T[], limit: number = MAX_OFFERED_SLOTS): T[] {
    const ordered = byTime(slots);
    if (ordered.length <= limit) return ordered;
    const firstPerTime: T[] = [];
    const seen = new Set<string>();
    for (const slot of ordered) {
        if (seen.has(slot.time)) continue;
        seen.add(slot.time);
        firstPerTime.push(slot);
    }
    if (firstPerTime.length <= limit) return firstPerTime;
    if (limit <= 1) return firstPerTime.slice(0, Math.max(0, limit));
    const picked = new Set<number>();
    for (let i = 0; i < limit; i++) picked.add(Math.round(i * (firstPerTime.length - 1) / (limit - 1)));
    return [...picked].sort((a, b) => a - b).map(index => firstPerTime[index]);
}

/**
 * Filters the free slots to the requested window BEFORE choosing which ones to
 * show. `fromMin` is inclusive and `toMin` exclusive on the slot start.
 *
 * With a requested hour as well, the hour decides inside the window (same rule as
 * `selectSlotWindow`). An empty window answers with the free slots nearest to it
 * (distinct start times, chronological), typed as `outsideRequestedWindow`.
 * A day with no free slot at all returns `inside` with nothing: that is a plain
 * "no availability", which the caller already handles.
 */
export function selectSlotsInWindow<T extends { time: string }>(
    slots: readonly T[],
    window: { fromMin: number; toMin: number },
    requestedTime?: string | null,
    limit: number = MAX_OFFERED_SLOTS,
): WindowedSlotSelection<T> {
    const ordered = byTime(slots);
    const inside = ordered.filter(slot => {
        const minutes = toMinutes(slot.time);
        return minutes !== null && minutes >= window.fromMin && minutes < window.toMin;
    });
    if (inside.length) {
        const requested = requestedTime ? toMinutes(requestedTime) : null;
        return {
            kind: 'inside',
            slots: requested === null ? spreadSlots(inside, limit) : selectSlotWindow(inside, requestedTime, limit),
            insideCount: inside.length,
        };
    }
    if (!ordered.length) return { kind: 'inside', slots: [], insideCount: 0 };
    const seen = new Set<string>();
    const nearest = ordered
        .filter(slot => toMinutes(slot.time) !== null && !seen.has(slot.time) && !!seen.add(slot.time))
        .map(slot => {
            const minutes = toMinutes(slot.time) as number;
            const distance = minutes < window.fromMin ? window.fromMin - minutes : minutes - window.toMin + 1;
            return { slot, minutes, distance };
        })
        .sort((a, b) => a.distance - b.distance || a.minutes - b.minutes)
        .slice(0, Math.min(limit, NEAREST_OUTSIDE_WINDOW_COUNT))
        .sort((a, b) => a.minutes - b.minutes)
        .map(entry => entry.slot);
    return { kind: 'outsideRequestedWindow', slots: nearest, insideCount: 0 };
}
