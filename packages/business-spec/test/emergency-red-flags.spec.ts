import { validateRequirementValue } from '../src/validate-value';
import { spec } from './helpers';

/**
 * DOM.HEALTH.EMERGENCY_PROTOCOL: el evaluador acepta `red_flags_accepted: true` (la lista de plataforma tal cual), pero la
 * escritura lo rechazaba como campo fuera de la estructura, y esa vía nunca contaba. 2026-11-10.
 */
describe('urgencias de salud: aceptar la lista de alarma de la plataforma se puede guardar', () => {
    it('red_flags_accepted es un campo de la estructura', () => {
        const issues = validateRequirementValue(spec, 'DOM.HEALTH.EMERGENCY_PROTOCOL',
            { value: { red_flags_accepted: true }, status: 'confirmed', origin: 'owner_form' });
        expect(issues.filter(i => i.path.includes('red_flags_accepted'))).toEqual([]);
    });
    it('y debe ser sí/no', () => {
        const issues = validateRequirementValue(spec, 'DOM.HEALTH.EMERGENCY_PROTOCOL',
            { value: { red_flags_accepted: 'si' }, status: 'confirmed', origin: 'owner_form' });
        expect(issues.some(i => i.path.includes('red_flags_accepted') && i.code === 'type')).toBe(true);
    });
});
