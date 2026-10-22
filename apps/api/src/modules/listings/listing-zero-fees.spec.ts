import { ListingsService } from './listings.service';
const ID='57542cc7-de10-4166-b731-704bc7fa403d';
describe('listing fees distinguish explicit zero from absent amounts',()=>{
 it.each([[0,0,0,0],['0.00','0.00','0.00','0.00'],[null,null,null,null],[undefined,undefined,null,null],[0,250,0,250],[150,0,150,0],['','',null,null]])('preserves HOA %s/deposit %s at creation',async(hoaFee,deposit,expectedHoa,expectedDeposit)=>{
  const prisma={executeInTenantSchema:jest.fn().mockResolvedValue([{id:ID}])};
  const service=new ListingsService(prisma as any);
  await service.create('tenant_qa',{name:'Synthetic listing',transactionType:'rent',hoaFee,deposit});
  const [schema,sql,params]=prisma.executeInTenantSchema.mock.calls[0];
  expect(schema).toBe('tenant_qa');expect(sql).toContain('INSERT INTO real_estate_listings');
  expect(params[6]).toBe(expectedHoa);expect(params[7]).toBe(expectedDeposit);
  expect(prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
 });
 it('keeps existing update behavior for explicit zero and parameterized identity',async()=>{
  const prisma={executeInTenantSchema:jest.fn().mockResolvedValue([{id:ID}])};
  await new ListingsService(prisma as any).update('tenant_qa',ID,{hoaFee:0,deposit:0});
  const [schema,sql,params]=prisma.executeInTenantSchema.mock.calls[0];
  expect(schema).toBe('tenant_qa');expect(sql).toContain('"hoa_fee" = $1');expect(sql).toContain('"deposit" = $2');
  expect(params).toEqual([0,0,ID]);expect(sql).toContain('WHERE id = $3::uuid');
 });
});
