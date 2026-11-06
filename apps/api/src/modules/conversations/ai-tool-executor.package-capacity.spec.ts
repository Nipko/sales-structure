import { AIToolExecutorService } from './ai-tool-executor.service';
const ID='76775f40-2fdd-48e2-9db5-c6afa93573dc';
const CONFIRMED={confirmed_fields:{min_party_size:'2026-11-06T10:00:00.000Z',max_capacity:'2026-11-06T10:00:00.000Z'}};
const executorFor=(pkg:Record<string,unknown>)=>Object.assign(Object.create(AIToolExecutorService.prototype),{toursService:{getPackage:jest.fn().mockResolvedValue({id:ID,is_active:true,name:'Synthetic tour',price:125,currency:'EUR',...pkg}),listInventory:jest.fn().mockResolvedValue([{departure_date:'2026-12-15',departure_time:'09:00',available_seats:30}])}});
describe('package detail projection preserves configured traveller bounds',()=>{
 it.each([[4,8,undefined],[1,10,CONFIRMED],[null,null,undefined]])('projects minimum %s and maximum %s without guessing seats',async(min,max,metadata)=>{
  const executor:any=executorFor({min_party_size:min,max_capacity:max,metadata});
  const result=await executor.getPackageDetails('tenant_capacity',ID);expect(result).toMatchObject({minPartySize:min,maxCapacity:max,upcomingDepartures:[{seatsLeft:30}]});
  expect(result.unconfirmedFields).toBeUndefined();
  expect(executor.toursService.getPackage).toHaveBeenCalledWith('tenant_capacity',ID);
 });
 // Opción B (dueño, 2026-11-06): the 1 and 10 the column puts when the form never set them are no business data. The read
 // carries no figure to state («grupos de 1 a 10 personas») and says which fields are not confirmed; booking still enforces them.
 it('does not project the column defaults 1 and 10 the business never confirmed',async()=>{
  const executor:any=executorFor({min_party_size:1,max_capacity:10,metadata:{}});
  const result=await executor.getPackageDetails('tenant_capacity',ID);
  expect(result).toMatchObject({minPartySize:null,maxCapacity:null,unconfirmedFields:['minPartySize','maxCapacity'],priceStatus:'confirmed'});
  expect(result.unconfirmedFieldsNote).toMatch(/not confirmed/);
 });
 it('confirms only the bound the form saved',async()=>{
  const executor:any=executorFor({min_party_size:1,max_capacity:10,metadata:{confirmed_fields:{max_capacity:'2026-11-06T10:00:00.000Z'}}});
  const result=await executor.getPackageDetails('tenant_capacity',ID);
  expect(result).toMatchObject({minPartySize:null,maxCapacity:10,unconfirmedFields:['minPartySize']});
 });
});
