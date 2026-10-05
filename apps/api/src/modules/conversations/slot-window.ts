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
    const requested = requestedTime ? toMinutes(requestedTime) : null;
    if (requested === null || slots.length <= limit) return slots.slice(0, limit);
    return slots
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
    return slots
        .map((slot, index) => ({ slot, index, distance: Math.abs((toMinutes(slot.time) ?? Infinity) - requested) }))
        .filter(entry => entry.distance <= toleranceMin)
        .sort((a, b) => a.distance - b.distance || a.index - b.index)
        .slice(0, count)
        .sort((a, b) => a.index - b.index)
        .map(entry => entry.slot);
}
