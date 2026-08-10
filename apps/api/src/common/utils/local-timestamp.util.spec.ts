import { serializeLocalTimestamp, serializeLocalTimestampFields } from './local-timestamp.util';

describe('local TIMESTAMP serialization', () => {
    it('follows pg local parsing for a Date fallback', () => {
        expect(serializeLocalTimestamp(new Date(2030, 7, 10, 9, 0, 0)))
            .toBe('2030-08-10T09:00:00');
    });

    it('uses SQL wall-clock text instead of the process-dependent Date instant', () => {
        expect(serializeLocalTimestampFields(
            {
                scheduled_at: new Date('2030-08-10T14:00:00.000Z'),
                scheduled_at_text: '2030-08-10T09:00:00',
            },
            ['scheduled_at'],
        )).toEqual({ scheduled_at: '2030-08-10T09:00:00' });
    });

    it('never publishes a trailing timezone marker for a wall-clock field', () => {
        expect(serializeLocalTimestamp('2030-08-10T09:00:00.000Z')).toBe('2030-08-10T09:00:00');
    });
});
