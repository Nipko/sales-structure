import { AIToolExecutorService } from './ai-tool-executor.service';
const ID='11111111-1111-4111-8111-111111111111';
function reader(row:any){
 const query=jest.fn().mockResolvedValue([row]);const executor:any=Object.assign(Object.create(AIToolExecutorService.prototype),{prisma:{$queryRawUnsafe:query},logger:{warn:jest.fn()}});
 return {executor,query,checkRead:()=>{expect(query).toHaveBeenCalledTimes(1);expect(query.mock.calls[0][0]).toMatch(/^SELECT\b/);expect(query.mock.calls[0][0]).toContain('"tenant_synthetic".');}};
}
function service(extra:any={}){return {id:ID,name:'Synthetic service',price:'40000.00',price_status:'confirmed',currency:'COP',duration_minutes:45,duration_type:'fixed',duration_minutes_max:null,payment_policy:'none',deposit_percent:null,deposit_amount:null,location_type:'in_person',location_address:null,meeting_link:null,...extra};}
function product(){return {id:ID,name:'Synthetic garment',description:'',category:null,images:[],price:'30.00',currency:'USD',stock:13,is_available:true,requires_prescription:false};}
describe('PUBLICQA05 actual public service projection',()=>{
 it('preserves the current confirmed40000COP instead of a historical agreement',async()=>{const h=reader(service());const r=await h.executor.listServices('tenant_synthetic');expect(r.services[0]).toMatchObject({price:40000,priceStatus:'confirmed',currency:'COP',appointmentTerms:{price:40000}});h.checkRead();});
 it('does not publish the120000example amount as a confirmed quote',async()=>{const h=reader(service({price:'120000.00',price_status:'example'}));const r=await h.executor.listServices('tenant_synthetic');expect(r.services[0]).toMatchObject({price:null,priceStatus:'example',requiresPaymentToConfirm:false,amountDueToConfirm:null,appointmentTerms:{price:0,priceStatus:'example'}});expect(JSON.stringify(r)).not.toContain('120000');h.checkRead();});
 it('preserves inperson modality and an unknown address without making a meeting link',async()=>{const h=reader(service());const r=await h.executor.listServices('tenant_synthetic');expect(r.services[0].appointmentTerms).toMatchObject({locationType:'in_person',locationAddress:null,meetingLinkHash:null});h.checkRead();});
});
describe('PUBLICQA10 actual public product projection',()=>{
 it('preserves an absent category rather than inferring it from the garment name',async()=>{const h=reader(product());const r=await h.executor.getProduct('tenant_synthetic',ID);expect(r).toMatchObject({status:'ok',category:null});expect(h.query.mock.calls[0][1]).toBe(ID);expect(h.query.mock.calls[0][0]).toContain('id = $1::uuid');h.checkRead();});
 it('preserves an empty description rather than generating product attributes',async()=>{const h=reader(product());const r=await h.executor.getProduct('tenant_synthetic',ID);expect(r.status).toBe('ok');expect(r.description).toBe('');h.checkRead();});
 it('preserves zero catalogue images without producing a media-send instruction',async()=>{const h=reader(product());const r=await h.executor.getProduct('tenant_synthetic',ID);expect(r.status).toBe('ok');expect(r.images).toEqual([]);expect(r).not.toHaveProperty('_mediaToSend');h.checkRead();});
});
