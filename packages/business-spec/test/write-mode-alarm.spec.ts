/** Alarma del modo de reserva no declarado (dueño, 4-nov): el agente ya actúa con el modo por defecto. */
import { evaluate } from '../src/engine/evaluate';
import { NOW, fixtureSnapshot, spec, val } from './helpers';

describe('modo de reserva no declarado', () => {
    it('salón: avisa que el agente ya confirma citas por defecto y lo pone primero entre los bloqueantes', () => {
        const r = evaluate(spec, fixtureSnapshot('salon-qa-citas'), NOW);
        expect(r.config.objects).toEqual([expect.objectContaining({ object: 'appointment', writeMode: 'direct_commit', writeModeDeclared: false })]);
        expect(r.blockingGaps[0]).toBe('OBJ.APPOINTMENT.WRITE_MODE');
        expect(r.qualityWarnings[0]).toMatchObject({ id: 'OBJ.APPOINTMENT.WRITE_MODE', message: expect.stringContaining('ya confirma citas directamente') });
    });

    it('con el modo declarado no hay alarma', () => {
        const snap = val(fixtureSnapshot('salon-qa-citas'), 'OBJ.APPOINTMENT.WRITE_MODE',
            { mode: 'request_to_business', required_fields: ['servicio', 'fecha_hora', 'nombre', 'telefono'], business_confirm_sla: { min: 2, unit: 'h' } });
        const r = evaluate(spec, snap, NOW);
        expect(r.qualityWarnings.some(w => w.id === 'OBJ.APPOINTMENT.WRITE_MODE' && /por defecto/.test(w.message))).toBe(false);
    });
});
