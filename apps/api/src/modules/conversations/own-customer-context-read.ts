/** Recognize an explicit self-profile read; identity still belongs to the executor. */
export function requiresOwnCustomerContextRead(query: string): boolean {
 const text=String(query||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(/\b(?:otra|otro|otras|otros|other|another|autre|autres|outro|outra|ajen[oa]s?|tercer[oa]s?|mama|papa)\b/.test(text)
  || /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/.test(text))return false;
 if(!/\b(?:mi|mis|tengo|my|meu|minha|meus|minhas|mon|mes)\b/.test(text))return false;
 // Participles ("guardadas", "registradas") and "anotaciones" describe what
 // is stored; only imperative/infinitive verbs ask for a write.
 const read=text.replace(/\bno\s+(?:agregues|agregue|agregar|cambies|cambie|modifiques|modifique)\b(?:\s+ninguna)?/g,'')
  .replace(/\bdo not (?:add|change|modify|update|remove)\b/g,'')
  .replace(/\b[a-z]+(?:ad|id)[oa]s?\b/g,'').replace(/\banotac(?:ion|iones|ao|oes)\b/g,'');
 if(/\b(?:agrega|agregue|agregues|agregar|crea|cree|crear|modifi\w*|actualiz\w*|elimina\w*|borra\w*|anota\w*|guarda\w*|registra\w*|add|set|update|remove|delete|save|record|ajout\w*|supprim\w*|adicion\w*)\b/.test(read))return false;
 if(/\b(?:etiquetas?|tags|etiquettes?|prime(?:r|ro|iro)\s+contacto|primeiro\s+contato|first\s+contact|premier\s+contact)\b/.test(text))return true;
 // A statement such as "mi preferencia es que me llamen" is not a read.
 return /\b(?:notas?|notes?|anotac(?:ion|iones|ao|oes)|preferencias?|preferences?)\b/.test(text)
  && (/\?/.test(text) || /^\W*(?:que|cuales|what|which|quais|quelles|quels)\b/.test(text)
   || /\b(?:consulta|muestra|muestrame|dime|lee|leeme|recuerdame|read|show|tell|list|leia|mostra|montre)\b/.test(text));
}
