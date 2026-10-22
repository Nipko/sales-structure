/** Read intent only; a supplied reference never establishes ownership or identity. */
export function appointmentRecordReadId(query: string): string | null {
 const text=String(query||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(!/\b(?:cita|citas|appointment|appointments|agendamento|rendez-vous)\b/.test(text)
  || !/\b(?:consulte|consultar|consulta|consult|detalles|details|detalle|estado|status|historico|historique|historical|verifique|verify|consulter)\b/.test(text))return null;
 // Permit the explicit no-change instruction from a read, but never consume a
 // positive/mixed cancellation, reschedule, payment or new-booking request.
 const intent=text.replace(/\bno (?:la |lo )?(?:cambie|modifique|cancele|agende)\b/g,'').replace(/\bdo not (?:change|modify|cancel|book)\b/g,'');
 if(/\b(?:cancel|cancelar|cancele|cancela|cancelamento|anul\w*|annuler|annulez|remarc\w*|reschedul\w*|reagend\w*|cambie|cambiar|modifi\w*|agende|agendar|reserv\w*|book|crear|cree|crea|programar|programe|schedule|reprogram\w*|confirme|confirm|pagar|pague|pay|reembols\w*)\b/.test(intent))return null;
 const matches=text.match(/(?<![a-z0-9-])[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![a-z0-9-])/g)||[];
 return new Set(matches).size===1?(matches[0]??null):null;
}
