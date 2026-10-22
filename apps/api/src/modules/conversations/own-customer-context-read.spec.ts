import { requiresOwnCustomerContextRead as read } from './own-customer-context-read';
describe('explicit own customer profile read',()=>{
 it.each(['Consulta mi ficha: ¿qué etiquetas tengo? No agregues ninguna.','¿En qué fecha UTC fue mi primer contacto?','What are my tags?','My first contact date?','Minhas tags?','Meu primeiro contato?','Mes etiquettes?'])('recognizes %s',q=>expect(read(q)).toBe(true));
 it.each(['Agrega una etiqueta a mi ficha','Consulta mis etiquetas y elimina una','Las etiquetas de otra persona en mi ficha','My tags for other customer','Mis etiquetas a04493f8-5b74-4f94-921e-9d73d1b189d7','¿Cuánto cuesta el tour?','¿Qué etiquetas existen en el negocio?'])('rejects %s',q=>expect(read(q)).toBe(false));
});
