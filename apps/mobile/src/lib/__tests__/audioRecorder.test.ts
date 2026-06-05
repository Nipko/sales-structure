/**
 * Tests for the audio-recorder duration formatter (pure logic). The recording
 * hook itself wraps native expo-av, so we mock the module and test fmtDuration.
 */
jest.mock('expo-av', () => ({ Audio: {} }));

import { fmtDuration } from '../useAudioRecorder';

describe('fmtDuration', () => {
    it('formats zero', () => {
        expect(fmtDuration(0)).toBe('0:00');
    });

    it('pads single-digit seconds', () => {
        expect(fmtDuration(1000)).toBe('0:01');
        expect(fmtDuration(9000)).toBe('0:09');
    });

    it('formats sub-minute', () => {
        expect(fmtDuration(45000)).toBe('0:45');
    });

    it('rolls over to minutes', () => {
        expect(fmtDuration(60000)).toBe('1:00');
        expect(fmtDuration(65000)).toBe('1:05');
    });

    it('formats multi-minute', () => {
        expect(fmtDuration(600000)).toBe('10:00');
        expect(fmtDuration(125000)).toBe('2:05');
    });

    it('truncates partial seconds (floor)', () => {
        expect(fmtDuration(1999)).toBe('0:01');
    });
});
