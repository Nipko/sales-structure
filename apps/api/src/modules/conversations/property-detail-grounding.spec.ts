import { requiresPropertyDetailLookup as required, propertyDetailIdForQuestion as pick } from './property-detail-grounding';
const ID='a04493f8-5b74-4f94-921e-9d73d1b189d7', NAME='Casa QA';
const result=()=>({properties:[{id:ID,name:NAME}]});
describe('property fact lookup boundaries',()=>{
 it.each(['De Casa QA, horarios de entrada y salida','House Casa QA check-in time','Logement Casa QA horaires arrivee','Quarto Casa QA regras'])('recognizes current fact query %s',q=>expect(required(q)).toBe(true));
 it.each(['Horario de atencion del dentista','Quiero una foto de Casa QA','No consulte horarios de Casa QA'])('does not expand unrelated lookup %s',q=>expect(required(q)).toBe(false));
 it('uses exact owned catalogue name or UUID only',()=>{expect(pick('Horario Casa QA',result())).toBe(ID);expect(pick(`Property ${ID} check-in`,result())).toBe(ID);expect(pick('Casa QA Pro horarios',result())).toBeNull();expect(pick('Otra Casa horarios',result())).toBeNull();});
 it.each([{error:'failed'},{properties:[],stale:true},{properties:[],truncated:true},{properties:[],success:false},{properties:[],status:'error'},{properties:[{id:'bad',name:NAME}]},{properties:[{id:ID,name:''}]}])('rejects unavailable or malformed catalogue %j',r=>expect(pick('Casa QA horarios',r)).toBeNull());
 it('rejects duplicate identities, names, oversized catalogue and multiple references',()=>{
  expect(pick('Casa QA horarios',{properties:[...result().properties,...result().properties]})).toBeNull();
  expect(pick('Casa QA horarios',{properties:[...result().properties,{id:'b04493f8-5b74-4f94-921e-9d73d1b189d7',name:NAME}]})).toBeNull();
  expect(pick('Casa QA horarios',{properties:Array(51).fill(result().properties[0])})).toBeNull();
  expect(pick(`${ID} b04493f8-5b74-4f94-921e-9d73d1b189d7`,result())).toBeNull();
 });
});
