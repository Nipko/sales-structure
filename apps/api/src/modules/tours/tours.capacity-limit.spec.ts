import { ToursService } from './tours.service';
const schema='tenant_capacity',ID='76775f40-2fdd-48e2-9db5-c6afa93573dc',CONTACT='22222222-2222-4222-8222-222222222222';
const future=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
function fixture(maxCapacity:number|null=10,seats:number|null=null){
 const queries:string[]=[];const execute=jest.fn(async(_schema:string,sql:string)=>{
  queries.push(sql);
  if(sql.includes('FROM contacts'))return [{id:CONTACT}];
  if(sql.includes('FROM opportunities o'))return [];
  if(sql.includes('FROM tour_packages'))return [{id:ID,is_active:true,min_party_size:1,max_capacity:maxCapacity,price:125,currency:'EUR'}];
  if(sql.includes('FROM tour_bookings'))return [];
  if(sql.includes('FROM tour_inventory'))return seats===null?[]:[{id:'33333333-3333-4333-8333-333333333333',available_seats:seats}];
  if(sql.includes('UPDATE tour_inventory'))return [{id:'33333333-3333-4333-8333-333333333333'}];
  if(sql.includes('INSERT INTO tour_bookings'))return [{id:'44444444-4444-4444-8444-444444444444',contact_id:CONTACT}];
  if(sql.includes('operational_notice_outbox'))return [{id:'synthetic-notice'}];
  throw Error('unexpected query');
 });
 const prisma={executeInTenantSchema:execute,transactionInTenantSchema:jest.fn(async(s:string,fn:any)=>fn((sql:string)=>execute(s,sql)))};
 const service=new ToursService(prisma as any,{enforcePlanLimit:jest.fn()}as any,{renderAndSend:jest.fn()}as any);
 return {service,queries,execute};
}
describe('configured package maximum is independent of remaining departure seats',()=>{
 it.each([null,30])('rejects group11 with cap10 and departure seats %s',async seats=>{
  const h=fixture(10,seats);await expect(h.service.checkAvailability(schema,ID,future,11)).resolves.toMatchObject({available:false,reason:'party_size_too_large',maxCapacity:10});
  expect(h.queries.some(sql=>sql.includes('tour_inventory'))).toBe(false);
 });
 it('rejects booking above cap before inventory or insertion',async()=>{
  const h=fixture();await expect(h.service.createBooking(schema,{packageId:ID,contactId:CONTACT,departureDate:future,partySize:11})).rejects.toMatchObject({response:expect.objectContaining({error:'party_size_too_large',maxCapacity:10,requested:11})});
  expect(h.queries.some(sql=>/tour_inventory|INSERT|UPDATE/.test(sql))).toBe(false);
 });
 it('retains unbounded custom packages when no maximum is configured',async()=>{const h=fixture(null);await expect(h.service.checkAvailability(schema,ID,future,11)).resolves.toEqual({available:true,seatsLeft:'unlimited'});});
 it('allows the exact configured maximum when seats suffice',async()=>{const h=fixture(10,20);await expect(h.service.checkAvailability(schema,ID,future,10)).resolves.toEqual({available:true,seatsLeft:20});});
 it('still rejects groups below minimum before inventory',async()=>{const h=fixture();jest.spyOn(h.service,'getPackage').mockResolvedValue({id:ID,is_active:true,min_party_size:3,max_capacity:10});await expect(h.service.checkAvailability(schema,ID,future,2)).resolves.toMatchObject({available:false,reason:'party_size_too_small',minPartySize:3});});
 it('allows an exact-maximum booking with the existing inventory claim path',async()=>{const h=fixture(10,20);await expect(h.service.createBooking(schema,{packageId:ID,contactId:CONTACT,departureDate:future,partySize:10})).resolves.toHaveProperty('id');expect(h.queries.some(sql=>sql.includes('UPDATE tour_inventory'))).toBe(true);});
 it('retains bookings without a configured cap and without scheduled inventory',async()=>{const h=fixture(null);await expect(h.service.createBooking(schema,{packageId:ID,contactId:CONTACT,departureDate:future,partySize:11})).resolves.toHaveProperty('id');expect(h.queries.some(sql=>sql.includes('UPDATE tour_inventory'))).toBe(false);});
 it('checks the package row inside the booking transaction rather than an earlier read',async()=>{const h=fixture(8);const earlier=jest.spyOn(h.service,'getPackage').mockResolvedValue({id:ID,is_active:true,min_party_size:1,max_capacity:10});await expect(h.service.createBooking(schema,{packageId:ID,contactId:CONTACT,departureDate:future,partySize:9})).rejects.toMatchObject({response:expect.objectContaining({error:'party_size_too_large',maxCapacity:8})});expect(earlier).not.toHaveBeenCalled();expect(h.queries.some(sql=>/INSERT|UPDATE/.test(sql))).toBe(false);});
 it('still reports insufficient departure seats for a within-cap group',async()=>{const h=fixture(10,3);await expect(h.service.checkAvailability(schema,ID,future,4)).resolves.toMatchObject({available:false,reason:'not_enough_seats',seatsLeft:3});});
 it('does not list an over-cap package as available even with spare seats',async()=>{const h=fixture(10,30);await expect(h.service.searchPackages(schema,{date:future,partySize:11})).resolves.toEqual([]);});
});
