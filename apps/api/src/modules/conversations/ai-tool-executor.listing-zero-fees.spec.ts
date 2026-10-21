import { AIToolExecutorService } from './ai-tool-executor.service';
const ID='57542cc7-de10-4166-b731-704bc7fa403d';
function fixture(hoa:unknown,deposit:unknown,state='available'){
 const listing={id:ID,name:'Synthetic listing',hoa_fee:hoa,deposit,financing_available:false};
 const getAvailableById=jest.fn().mockResolvedValue(state==='available'?{state,listing}:{state});
 const executor:any=Object.assign(Object.create(AIToolExecutorService.prototype),{listingsService:{getAvailableById}});
 return {listing,getAvailableById,read:()=>executor.getListingDetails('tenant_qa',ID)};
}
describe('listing fees preserve published zero separately from unknown',()=>{
 it.each([
  [0,0,0,0],['0.00','0.00',0,0],[null,null,null,null],
  [undefined,undefined,null,null],[0,'250.50',0,250.5],['150.25',0,150.25,0],
  ['150.25','250.50',150.25,250.5],['','',null,null],
 ])('projects HOA %s and deposit %s accurately',async(hoa,deposit,expectedHoa,expectedDeposit)=>{
  const h=fixture(hoa,deposit),original={...h.listing};const result=await h.read();
  expect(result.hoaFee).toBe(expectedHoa);expect(result.deposit).toBe(expectedDeposit);
  expect(result.financingAvailable).toBe(false);expect(h.listing).toEqual(original);
  expect(h.getAvailableById).toHaveBeenCalledTimes(1);expect(h.getAvailableById).toHaveBeenCalledWith('tenant_qa',ID);
 });
 it.each(['not_found','unavailable'])('does not disclose fields of %s listing',async state=>{
  const result=await fixture(0,0,state).read();expect(result.hoaFee).toBeUndefined();expect(result.deposit).toBeUndefined();expect(result.name).toBeUndefined();
 });
});
