import { requiresProductStockLookup, stockProductIdForQuestion } from './product-stock-grounding';
const ID='8074246f-02e0-4f64-a9b1-a0cf8cd62407',OTHER='9074246f-02e0-4f64-a9b1-a0cf8cd62407';
const row={id:ID,name:'Camiseta Aurora',isAvailable:true},ok=()=>({status:'ok',products:[row]});
describe('bounded exact product identity for stock reads',()=>{
 it.each(['¿Hay existencias de Camiseta Aurora?','Do you have fourteen units of Camiseta Aurora?','Qual o estoque de Camiseta Aurora?','Quatorze unites de Camiseta Aurora?'])('detects stock intent %s',q=>expect(requiresProductStockLookup(q)).toBe(true));
 it.each(['No consulte el stock de Camiseta Aurora.','Do not check inventory.','Cupos para tres viajeros del tour Aurora.'])('does not force lookup %s',q=>expect(requiresProductStockLookup(q)).toBe(false));
 it('matches a bounded exact named product',()=>expect(stockProductIdForQuestion('Stock de CAMISETA AURORA',ok())).toBe(ID));
 it('does not resolve an unknown PRO variant to the base',()=>expect(stockProductIdForQuestion('Stock de Camiseta Aurora PRO',ok())).toBeNull());
 it('resolves the actual listed PRO variant',()=>expect(stockProductIdForQuestion('Stock de Camiseta Aurora PRO',{products:[row,{id:OTHER,name:'Camiseta Aurora PRO'}]})).toBe(OTHER));
 it('does not use a partial word',()=>expect(stockProductIdForQuestion('Stock de Camiseta Auroras',ok())).toBeNull());
 it('does not guess among duplicate names',()=>expect(stockProductIdForQuestion('Stock de Camiseta Aurora',{products:[row,{...row,id:OTHER}]})).toBeNull());
 it.each([{error:'READ_FAILED'},{stale:true},{truncated:true},{success:false},{status:'empty'},{products:[{...row,id:'bad'}]},{products:[{...row,isAvailable:false}]}])('does not trust failed or malformed catalogue %j',change=>expect(stockProductIdForQuestion('Stock de Camiseta Aurora',{...ok(),...change})).toBeNull());
 it('does not establish name uniqueness from a full page',()=>{const products=Array.from({length:20},(_,n)=>({...row,id:`${n.toString(16).padStart(8,'0')}-02e0-4f64-a9b1-a0cf8cd62407`}));expect(stockProductIdForQuestion('Stock de Camiseta Aurora',{products})).toBeNull();});
 it('allows an explicit UUID even on a full page',()=>{const products=Array.from({length:20},(_,n)=>({...row,id:`${n.toString(16).padStart(8,'0')}-02e0-4f64-a9b1-a0cf8cd62407`}));expect(stockProductIdForQuestion(`Stock de ${products[0].id}`,{products})).toBe(products[0].id);});
 it('does not guess with multiple explicit UUIDs',()=>expect(stockProductIdForQuestion(`Stock de ${ID} y ${OTHER}`,ok())).toBeNull());
});
