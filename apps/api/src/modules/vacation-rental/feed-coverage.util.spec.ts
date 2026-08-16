import { assessFeedCoverage } from './feed-coverage.util';

const NOW = new Date('2026-08-15T12:00:00Z');
const r = (checkIn: string, checkOut: string) => ({ checkIn, checkOut });

describe('assessFeedCoverage', () => {
    it('detecta el caso real: el feed solo trae un bloqueo de 2028', () => {
        // Booking.com, agosto 2026. Su panel mostraba tres reservas ese mes;
        // su iCal exportaba únicamente esto.
        const feed = [r('2028-02-15', '2028-02-16')];
        const known = [
            r('2026-08-12', '2026-08-19'),  // Marcela Vargas
            r('2026-08-24', '2026-08-28'),  // climaco garcia
            r('2026-08-29', '2026-09-02'),  // Mauricio Escobar
        ];

        const result = assessFeedCoverage(feed, known, NOW);

        expect(result.anomaly).toBe('no_near_term_coverage');
        // El evento de 2028 existe, pero no cubre nada de lo que importa.
        expect(result.eventsInHorizon).toBe(0);
        expect(result.blocksInHorizon).toBe(3);
    });

    it('no acusa a un feed que sí cubre el corto plazo', () => {
        const feed = [r('2026-08-24', '2026-08-28'), r('2028-02-15', '2028-02-16')];
        const known = [r('2026-08-24', '2026-08-28')];

        expect(assessFeedCoverage(feed, known, NOW).anomaly).toBeNull();
    });

    it('un feed vacío sin bloqueos nuestros es un feed sano, no una anomalía', () => {
        // El anfitrión simplemente no tiene reservas. Avisar acá sería ruido.
        expect(assessFeedCoverage([], [], NOW).anomaly).toBeNull();
    });

    it('marca el feed vacío cuando nosotros sí sostenemos bloqueos suyos', () => {
        const result = assessFeedCoverage([], [r('2026-09-01', '2026-09-05')], NOW);

        expect(result.anomaly).toBe('no_near_term_coverage');
        expect(result.blocksInHorizon).toBe(1);
    });

    it('ignora lo que ya pasó: un bloqueo vencido no dispara la alerta', () => {
        const known = [r('2026-07-01', '2026-07-05')];

        expect(assessFeedCoverage([], known, NOW).anomaly).toBeNull();
    });

    it('cuenta una estadía en curso: empezó antes de hoy pero sigue ocupando', () => {
        // Exactamente Marcela: check-in el 12, hoy 15, checkout el 19.
        const result = assessFeedCoverage([], [r('2026-08-12', '2026-08-19')], NOW);

        expect(result.blocksInHorizon).toBe(1);
        expect(result.anomaly).toBe('no_near_term_coverage');
    });

    it('no cuenta el día de checkout como ocupado', () => {
        // Sale el 15 a las 11: ese día ya no es suyo.
        expect(assessFeedCoverage([], [r('2026-08-10', '2026-08-15')], NOW).blocksInHorizon).toBe(0);
    });

    it('respeta el horizonte: algo lejano no cuenta como cobertura ni como falta', () => {
        const lejos = [r('2027-01-10', '2027-01-15')];

        expect(assessFeedCoverage(lejos, lejos, NOW).anomaly).toBeNull();
        expect(assessFeedCoverage(lejos, lejos, NOW).blocksInHorizon).toBe(0);
    });
});
