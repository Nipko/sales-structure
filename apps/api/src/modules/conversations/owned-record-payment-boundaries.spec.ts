import { AIToolExecutorService } from './ai-tool-executor.service';
import { CatalogOrderCommands } from '../orders/catalog-order-commands';
const CONTACT='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',RECORD='33333333-3333-4333-8333-333333333333';
function appointment(extra:any={}){
 const row={id:RECORD,contact_id:CONTACT,service_name:'Synthetic appointment',status:'pending_payment',payment_status:'pending',amount_due:0,price:40000,currency:'COP',hold_expires_at:'2000-01-01T00:00:00Z',notes:'SYNTHETIC_PRIVATE_NOTE',...extra};
 const query=jest.fn().mockResolvedValue([row]),payable=jest.fn();
 const service:any=Object.assign(Object.create(AIToolExecutorService.prototype),{prisma:{$queryRawUnsafe:query},payableReference:payable});
 return{read:()=>service.getAppointmentDetails('tenant_synthetic',CONTACT,RECORD),query,payable};
}
function catalog(mode:'foreign'|'erased'|'paid'){
 const query=jest.fn(async(sql:string,params:any[]=[])=>{
  if(sql.includes('FROM contacts'))return[{id:CONTACT}];
  if(sql.includes('to_regclass'))return[{name:mode==='erased'?'customer_memory_erasure':null}];
  if(sql.includes('FROM customer_memory_erasure'))return[{contact_id:CONTACT}];
  if(sql.includes('FROM orders')){expect(sql).toContain('contact_id=$2::uuid');expect(params).toEqual([RECORD,CONTACT]);return mode==='foreign'?[]:[{id:RECORD,version:1,status:'paid',payment_status:'pending',total_amount:'30.00',currency:'USD',contact_id:CONTACT}];}
  if(sql.includes('FROM order_items'))return[{id:'synthetic-line',product_id:RECORD,product_name:'Synthetic product',quantity:1,unit_price:'30.00',total_price:'30.00',stock_deducted:1}];
  if(sql.includes('pg_advisory_xact_lock_shared'))return[];
  throw Error('Unexpected SQL');
 });
 const transaction=jest.fn(async(schema:string,work:any)=>{expect(schema).toBe('tenant_synthetic');return work(query);});
 const commands=new CatalogOrderCommands({transactionInTenantSchema:transaction}as any);
 return{read:()=>commands.getOwned('tenant_synthetic',RECORD,CONTACT),query,transaction};
}
describe('OWNEDQA05 appointment disclosure and payment boundaries',()=>{
 it('denies a foreign appointment without disclosing its notes or payment data',async()=>{const h=appointment({contact_id:OTHER});const r=await h.read();expect(r).toEqual({error:'You can only view your own appointments'});expect(JSON.stringify(r)).not.toContain('SYNTHETIC_PRIVATE_NOTE');expect(h.payable).not.toHaveBeenCalled();expect(h.query.mock.calls[0][1]).toBe(RECORD);});
 it('does not offer a payable reference for an expired hold and preserves zero due',async()=>{const h=appointment();expect(await h.read()).toMatchObject({amountDueToConfirm:0,paymentStatus:'pending',payableReference:null});expect(h.payable).not.toHaveBeenCalled();});
 it('does not turn completed status into provider payment or a payable reference',async()=>{const h=appointment({status:'completed',payment_status:'unpaid'});expect(await h.read()).toMatchObject({status:'completed',paymentStatus:'unpaid',payableReference:null});expect(h.payable).not.toHaveBeenCalled();});
});
describe('OWNEDQA10 catalog identity and payment boundaries',()=>{
 it('denies a foreign order before reading its lines',async()=>{const h=catalog('foreign');await expect(h.read()).rejects.toThrow('catalog_order_not_found');expect(h.query.mock.calls.some(([sql])=>sql.includes('order_items'))).toBe(false);});
 it('denies an erased contact before reading any order or lines',async()=>{const h=catalog('erased');await expect(h.read()).rejects.toThrow('contact_erased');expect(h.query.mock.calls.some(([sql])=>sql.includes('FROM orders')||sql.includes('FROM order_items'))).toBe(false);});
 it('keeps operator paid separate from pending provider payment and unknown fulfillment',async()=>{const h=catalog('paid');const r=await h.read();expect(r).toMatchObject({status:'paid',paymentStatus:'pending',fulfillmentStatus:'not_recorded',totalAmount:30,totalAmountCents:'3000',currency:'USD'});expect(r.items).toHaveLength(1);expect(h.query.mock.calls.every(([sql])=>/^SELECT\b/.test(sql))).toBe(true);});
});
