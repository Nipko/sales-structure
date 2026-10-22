/** Select only an explicit self-owned tour history read; executor enforces identity. */
export function requiresOwnTourBookingsRead(query: string): boolean {
 const text=String(query||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/.test(text)
  || /\b(?:otra|otro|otras|otros|other|autre|autres|outro|outra|esposa|esposo|wife|husband|madre|padre|mama|papa|cliente|customer)\b/.test(text)
  || /\bde\s+(?!(?:tours?|passeios|circuits|excursiones|excursions)\b)\S+/.test(text)
  || /\b(?:for|pour|para)\s+\S+/.test(text))return false;
 if(!/\b(?:mis|mi|tengo|my|minhas|meus|mes)\b/.test(text)
  || !/\b(?:reservas?|bookings?|reservations?)\b/.test(text)
  || !/\b(?:tours?|passeios|circuits|excursiones|excursions)\b/.test(text)
  || !/\b(?:consulta|muestra|ver|lista|que|cuales|tengo|show|list|what|quais|consulte|affiche|quelles)\b/.test(text))return false;
 const read=text.replace(/\bno (?:crees|canceles)(?: ni (?:crees|canceles))?(?: nada)?\b/g,'');
 return !/\b(?:crea\w*|cree\w*|crear|cancela\w*|cancele\w*|paga\w*|pague\w*|pagar|reserva\s+(?:un|una)|reservar|modifi\w*|cambia\w*|elimina\w*|borra\w*|create|book|cancel|pay|change|update|delete|remove|annul\w*|payer|paye\w*|supprim\w*|crie\w*|criar|pagar|alter\w*)\b/.test(read);
}
