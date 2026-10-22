/** Recognize an explicit self-profile read; identity still belongs to the executor. */
export function requiresOwnCustomerContextRead(query: string): boolean {
 const text=String(query||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(/\b(?:otra|otro|otras|otros|other|autre|autres|outro|outra|mama|papa)\b/.test(text)
  || /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/.test(text))return false;
 if(!/\b(?:mi|mis|tengo|my|meu|minha|meus|minhas|mon|mes)\b/.test(text))return false;
 const read=text.replace(/\bno\s+(?:agregues|agregue|agregar|cambies|cambie|modifiques|modifique)\b(?:\s+ninguna)?/g,'')
  .replace(/\bdo not (?:add|change|modify|update|remove)\b/g,'');
 if(/\b(?:agrega|agregue|agregues|agregar|crea|cree|crear|modifi\w*|actualiz\w*|elimina\w*|borra\w*|add|set|update|remove|delete|ajout\w*|supprim\w*|adicion\w*)\b/.test(read))return false;
 return /\b(?:etiquetas?|tags|etiquettes?|prime(?:r|ro|iro)\s+contacto|primeiro\s+contato|first\s+contact|premier\s+contact)\b/.test(text);
}
