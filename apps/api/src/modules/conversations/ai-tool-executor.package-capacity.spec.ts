import { AIToolExecutorService } from './ai-tool-executor.service';
const ID='76775f40-2fdd-48e2-9db5-c6afa93573dc';
describe('package detail projection preserves configured traveller bounds',()=>{
 it.each([[1,10],[4,8],[null,null]])('projects minimum %s and maximum %s without guessing seats',async(min,max)=>{
  const executor:any=Object.assign(Object.create(AIToolExecutorService.prototype),{toursService:{getPackage:jest.fn().mockResolvedValue({id:ID,is_active:true,name:'Synthetic tour',price:125,currency:'EUR',min_party_size:min,max_capacity:max}),listInventory:jest.fn().mockResolvedValue([{departure_date:'2026-12-15',departure_time:'09:00',available_seats:30}])}});
  const result=await executor.getPackageDetails('tenant_capacity',ID);expect(result).toMatchObject({minPartySize:min,maxCapacity:max,upcomingDepartures:[{seatsLeft:30}]});
  expect(executor.toursService.getPackage).toHaveBeenCalledWith('tenant_capacity',ID);
 });
});
