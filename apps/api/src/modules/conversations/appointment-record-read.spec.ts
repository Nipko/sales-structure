import { appointmentRecordReadId } from './appointment-record-read';
const id='f0080b9a-c062-47c3-8318-b592a82da9a3';
describe('appointment historical read routing',()=>{
 it.each([`Consulte la cita ${id} de mi ficha: estado y precio historico; no la cambie.`,`Consulta la cita cancelada ${id}: estado historico.`,`Consult appointment ${id} details; do not change it.`,`Consulter le rendez-vous ${id} historique.`])('accepts explicit record reads: %s',q=>expect(appointmentRecordReadId(q)).toBe(id));
 it.each([`Cancele la cita ${id}`,`Consulte la cita ${id} y luego cancele la cita`,`Consulte la cita ${id} y pague`,`Consulte la cita ${id} y agende otra`,`Consulte la cita ${id} y cree otra`,`Consult appointment ${id} details and confirm it`,`Ver detalles de cita ${id} y ${id.replace('f0080b9a','00000000')}`,`Consulte cita x${id}x`,`Consulte cita ${id}-extra`,`Quiero disponibilidad para agendar una cita`,`Consulte mi cita sin referencia`])('does not redirect mutations, ambiguous or invalid references: %s',q=>expect(appointmentRecordReadId(q)).toBeNull());
});
