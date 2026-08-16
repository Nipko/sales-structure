/**
 * ¿El feed sirve para algo, o solo responde 200?
 *
 * Un iCal puede estar impecable —status 200, VCALENDAR completo, eventos
 * parseables— y aun así no cubrir nada de lo que importa. Booking.com llegó a
 * exportar UN bloqueo manual de febrero de 2028 mientras su propio panel
 * mostraba tres reservas de ese mes: el feed decía "OK", el sync decía "1
 * importado", y las reservas reales no salían por ningún lado.
 *
 * El guard de barrido masivo no alcanza para esto. Ese frena una CAÍDA brusca;
 * acá el feed puede llevar meses sin traer nada del período que importa, y cada
 * bloqueo se libera de a poco, por debajo del umbral, sin que nadie se entere.
 *
 * La señal es la cobertura de CORTO PLAZO: un evento en 2028 no rescata a un
 * feed que no dice nada de las próximas semanas.
 */

/** Días hacia adelante que se consideran "lo que importa ahora". */
export const COVERAGE_HORIZON_DAYS = 90;

export interface DateRange {
    /** YYYY-MM-DD */
    checkIn: string;
    /** YYYY-MM-DD, exclusivo (día de checkout). */
    checkOut: string;
}

export interface FeedCoverage {
    /** Eventos del feed que tocan la ventana de corto plazo. */
    eventsInHorizon: number;
    /** Bloqueos que YA teníamos de este feed y tocan esa ventana. */
    blocksInHorizon: number;
    /**
     * Código estable del problema, o null si el feed cubre lo que debe.
     * `no_near_term_coverage`: el feed no dice NADA de las próximas semanas
     * mientras nosotros sostenemos bloqueos suyos ahí. O terminaron todas a la
     * vez, o la OTA dejó de exportarlas — y lo segundo es mucho más probable.
     */
    anomaly: 'no_near_term_coverage' | null;
}

/** Solape con [desde, hasta): el checkout no ocupa. */
function overlapsHorizon(range: DateRange, from: string, to: string): boolean {
    return range.checkIn < to && range.checkOut > from;
}

export function assessFeedCoverage(
    eventsInFeed: DateRange[],
    knownBlocks: DateRange[],
    now: Date = new Date(),
    horizonDays: number = COVERAGE_HORIZON_DAYS,
): FeedCoverage {
    const from = now.toISOString().slice(0, 10);
    const to = new Date(now.getTime() + horizonDays * 86_400_000).toISOString().slice(0, 10);

    const eventsInHorizon = eventsInFeed.filter((e) => overlapsHorizon(e, from, to)).length;
    const blocksInHorizon = knownBlocks.filter((b) => overlapsHorizon(b, from, to)).length;

    // Sólo es anomalía si NOSOTROS sostenemos algo en esa ventana. Un feed que
    // no trae nada porque el anfitrión no tiene reservas es un feed sano.
    const anomaly = eventsInHorizon === 0 && blocksInHorizon > 0
        ? 'no_near_term_coverage'
        : null;

    return { eventsInHorizon, blocksInHorizon, anomaly };
}
