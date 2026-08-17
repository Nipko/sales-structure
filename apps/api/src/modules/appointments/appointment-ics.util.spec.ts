import {
    buildAppointmentIcs,
    durationMinutes,
    formatWallClockDate,
    formatWallClockTime,
    parseWallClock,
    wallClockToUtc,
} from './appointment-ics.util';

describe('appointment wall-clock handling', () => {
    it('reads a naive timestamp as the literal wall clock, not server-local time', () => {
        // `new Date('2026-12-09T08:00:00')` would apply the container timezone;
        // these digits must survive whatever the host is set to.
        const parsed = parseWallClock('2026-12-09T08:00:00');
        expect(parsed.toISOString()).toBe('2026-12-09T08:00:00.000Z');
    });

    it('accepts the string shape Postgres hands back for a naive timestamp', () => {
        expect(parseWallClock('2026-12-09T08:00:00.000Z').toISOString())
            .toBe('2026-12-09T08:00:00.000Z');
    });

    it('resolves a Bogota wall clock to the right UTC instant', () => {
        expect(wallClockToUtc('2026-12-09T08:00:00', 'America/Bogota').toISOString())
            .toBe('2026-12-09T13:00:00.000Z');
    });

    it('lands on the correct side of a DST boundary', () => {
        // Madrid is UTC+1 in January and UTC+2 in July.
        expect(wallClockToUtc('2026-01-15T09:00:00', 'Europe/Madrid').toISOString())
            .toBe('2026-01-15T08:00:00.000Z');
        expect(wallClockToUtc('2026-07-15T09:00:00', 'Europe/Madrid').toISOString())
            .toBe('2026-07-15T07:00:00.000Z');
    });

    it('formats the date unambiguously instead of 9/12/2026', () => {
        const formatted = formatWallClockDate('2026-12-09T08:00:00', 'es-CO');
        expect(formatted).toContain('diciembre');
        expect(formatted).toContain('2026');
        expect(formatted).not.toMatch(/^\d+\/\d+\/\d+$/);
    });

    it('returns an empty string for an unusable timestamp so the row can be dropped', () => {
        expect(formatWallClockDate('not-a-date', 'es-CO')).toBe('');
        expect(formatWallClockTime('', 'es-CO')).toBe('');
    });

    it('computes duration and refuses inverted intervals', () => {
        expect(durationMinutes('2026-12-09T08:00:00', '2026-12-09T09:30:00')).toBe(90);
        expect(durationMinutes('2026-12-09T09:30:00', '2026-12-09T08:00:00')).toBe(0);
    });
});

describe('buildAppointmentIcs', () => {
    const base = {
        uid: 'appointment-abc@parallly-chat.cloud',
        sequence: 0,
        startAt: '2026-12-09T08:00:00',
        endAt: '2026-12-09T09:30:00',
        timezone: 'America/Bogota',
        stamp: new Date('2026-08-16T12:00:00Z'),
        summary: 'Consulta general',
    };

    it('emits the interval as UTC instants derived from the tenant timezone', () => {
        const ics = buildAppointmentIcs({ ...base, method: 'REQUEST', status: 'CONFIRMED' });
        expect(ics).toContain('DTSTART:20261209T130000Z');
        expect(ics).toContain('DTEND:20261209T143000Z');
        expect(ics).toContain('DTSTAMP:20260816T120000Z');
    });

    it('escapes the characters that would otherwise break the format', () => {
        const ics = buildAppointmentIcs({
            ...base,
            method: 'REQUEST',
            status: 'CONFIRMED',
            summary: 'Corte, color; y peinado',
            location: 'Cra 7 #72-41, Oficina 502',
        });
        expect(ics).toContain('SUMMARY:Corte\\, color\\; y peinado');
        expect(ics).toContain('LOCATION:Cra 7 #72-41\\, Oficina 502');
    });

    it('folds long lines without splitting a multi-byte character', () => {
        const ics = buildAppointmentIcs({
            ...base,
            method: 'REQUEST',
            status: 'CONFIRMED',
            summary: 'Sesión de acompañamiento pedagógico con énfasis en comprensión lectora avanzada',
        });
        for (const line of ics.split('\r\n')) {
            expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
        }
        // Unfolding must give the original text back, accents intact.
        const unfolded = ics.replace(/\r\n /g, '');
        expect(unfolded).toContain('Sesión de acompañamiento pedagógico con énfasis en comprensión lectora avanzada');
    });

    it('marks a cancellation so the calendar replaces the original event', () => {
        const ics = buildAppointmentIcs({ ...base, method: 'CANCEL', status: 'CANCELLED', sequence: 1 });
        expect(ics).toContain('METHOD:CANCEL');
        expect(ics).toContain('STATUS:CANCELLED');
        expect(ics).toContain('SEQUENCE:1');
        // Same UID as the invite it supersedes.
        expect(ics).toContain(`UID:${base.uid}`);
    });

    it('refuses to build an event from an unusable interval', () => {
        expect(() => buildAppointmentIcs({
            ...base, method: 'REQUEST', status: 'CONFIRMED', startAt: 'nope', endAt: 'nope',
        })).toThrow('invalid_appointment_interval');
    });
});
