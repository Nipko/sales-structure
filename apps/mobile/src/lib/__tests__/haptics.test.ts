import { haptic } from '../haptics';

// The native module may be absent in the test/Expo-Go environment. The wrapper must
// degrade to a silent no-op and never throw — it is feedback, never load-bearing.
describe('haptic wrapper', () => {
    it('exposes the four feedback methods', () => {
        expect(typeof haptic.tap).toBe('function');
        expect(typeof haptic.success).toBe('function');
        expect(typeof haptic.warning).toBe('function');
        expect(typeof haptic.error).toBe('function');
    });

    it('never throws regardless of native module availability', () => {
        expect(() => { haptic.tap(); haptic.success(); haptic.warning(); haptic.error(); }).not.toThrow();
    });
});
