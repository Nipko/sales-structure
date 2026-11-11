import { BOOKING_ENGINE_MESSAGES } from './booking-engine.service';

/** E2ai/E2aj C16: elegir el servicio no registra nada; el texto no puede prometer la reserva. */
const PROMISE = /\b(?:reservaremos|agendaremos|estamos agendando|we will book|we'll book|vamos agendar|reservaremos|nous réserverons)\b/iu;

describe('motor de reservas: elegir un servicio no promete la cita', () => {
    it.each(Object.keys(BOOKING_ENGINE_MESSAGES))('%s', lang => {
        for (const key of ['serviceSelected', 'switchedService']) {
            const value = BOOKING_ENGINE_MESSAGES[lang][key];
            for (const text of Array.isArray(value) ? value : [value]) expect(text).not.toMatch(PROMISE);
        }
    });
});
