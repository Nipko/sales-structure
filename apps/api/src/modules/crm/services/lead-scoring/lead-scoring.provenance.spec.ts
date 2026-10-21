import { LeadScoringService } from './lead-scoring.service';
import { captureScoringConfiguration, matchesScoringConfigurationReceipt } from './scoring-configuration-receipt';
const factors={engagement:75,intent:30,recency:100,stageProgress:10,profileCompleteness:60};
const configuration=()=>({weights:{engagement:0.25,intent:0.30,recency:0.20,stageProgress:0.15,profileCompleteness:0.10},keywords:['precio','comprar'],decayEnabled:false,decayDays:30,decayFactor:0.5});
function fixture(cached:any=configuration(),rows:any[]=[]){
 const cache=new Map<string,any>();if(cached)cache.set('scoring_config:tenant',cached);
 const writes:any[]=[];
 const prisma={executeInTenantSchema:jest.fn(async(_schema:string,sql:string,args:any[])=>{if(sql.includes('FROM scoring_config'))return rows;if(sql.startsWith('UPDATE leads'))writes.push(JSON.parse(args[1]));return [];}),$queryRaw:jest.fn()};
 const redis={get:jest.fn(async()=> 'tenant_test'),getJson:jest.fn(async(key:string)=>cache.get(key)),setJson:jest.fn(async(key:string,value:any)=>{cache.set(key,value);}),tenantKey:jest.fn((_tenant:string,key:string)=>key)};
 const service=new LeadScoringService(prisma as any,redis as any,{emit:jest.fn()}as any);
 jest.spyOn(service as any,'computeFactors').mockResolvedValue(factors);
 return {service,cache,writes,prisma,redis};
}
describe('score calculation configuration provenance',()=>{
 it('persists a receipt of the effective cached configuration, not newer database settings',async()=>{
  const current=configuration();const h=fixture(current,[{weights:{engagement:1},purchase_keywords:['different']}]);
  const result=await h.service.updateLeadScore('tenant','lead');expect(result.score).toBe(6);
  expect(h.writes[0].configurationReceipt).toEqual(captureScoringConfiguration(current)?.receipt);
  expect(h.prisma.executeInTenantSchema.mock.calls.some((c:any[])=>c[1].includes('FROM scoring_config'))).toBe(false);
 });
 it('retains verifiable provenance after Redis expires without recalculating the old score',async()=>{
  const current=configuration();const h=fixture(current);await h.service.updateLeadScore('tenant','lead');const receipt=h.writes[0].configurationReceipt;
  h.cache.clear();expect(matchesScoringConfigurationReceipt(receipt,current)).toBe(true);
  const other=configuration();other.weights.intent=0.9;expect(matchesScoringConfigurationReceipt(receipt,other)).toBe(false);
  expect(h.writes).toHaveLength(1);
 });
 it('records the merged database configuration on a cache miss',async()=>{
  const h=fixture(null,[{weights:{intent:0.7},purchase_keywords:['exact'],decay_enabled:true,decay_days:45,decay_factor:'0.4'}]);
  await h.service.updateLeadScore('tenant','lead');const used=(h.service as any).computeFactors.mock.calls[0][2];
  expect(used).toMatchObject({weights:{intent:0.7,engagement:0.25},keywords:['exact'],decayEnabled:true,decayDays:45,decayFactor:0.4});
  expect(matchesScoringConfigurationReceipt(h.writes[0].configurationReceipt,used)).toBe(true);
 });
 it('records actual default parameters when the existing loader selects defaults',async()=>{
  const h=fixture(null,[]);await h.service.updateLeadScore('tenant','lead');const used=(h.service as any).computeFactors.mock.calls[0][2];
  expect(used.keywords).toContain('precio');expect(matchesScoringConfigurationReceipt(h.writes[0].configurationReceipt,used)).toBe(true);
 });
 it('uses the captured configuration if the original cache object changes during factor calculation',async()=>{
  const c=configuration();const original=captureScoringConfiguration(c)!.receipt;const h=fixture(c);
  (h.service as any).computeFactors.mockImplementation(async(_schema:string,_lead:string,used:any)=>{
   c.weights.intent=0.9;c.keywords.push('later');expect(used.weights.intent).toBe(0.3);return factors;
  });
  const result=await h.service.updateLeadScore('tenant','lead');expect(result.score).toBe(6);expect(h.writes[0].configurationReceipt).toEqual(original);
 });
 it('preserves malformed legacy execution without issuing a receipt',async()=>{
  const c:any=configuration();c.weights.intent='0.30';const h=fixture(c);
  await h.service.updateLeadScore('tenant','lead');expect((h.service as any).computeFactors.mock.calls[0][2]).toBe(c);
  expect(h.writes[0]).not.toHaveProperty('configurationReceipt');
 });
 it('does not expose effective keyword values or weights in persisted provenance',async()=>{
  const c=configuration();c.keywords=['synthetic-private-term'];const h=fixture(c);await h.service.updateLeadScore('tenant','lead');
  expect(JSON.stringify(h.writes[0].configurationReceipt)).not.toContain('synthetic-private-term');expect(Object.keys(h.writes[0].configurationReceipt).sort()).toEqual(['algorithm','sha256','version']);
 });
});
describe('configuration receipts fail closed',()=>{
 it('has stable hashes across object key ordering',()=>{const c=configuration();const reversed={...c,weights:Object.fromEntries(Object.entries(c.weights).reverse())};expect(captureScoringConfiguration(c)?.receipt).toEqual(captureScoringConfiguration(reversed)?.receipt);});
 it('detects every effective parameter changing',()=>{
  const c=configuration(),receipt=captureScoringConfiguration(c)!.receipt;
  const changes=[{...c,weights:{...c.weights,intent:0.9}},{...c,keywords:['different']},{...c,decayEnabled:true},{...c,decayDays:31},{...c,decayFactor:0.9}];
  for(const changed of changes)expect(matchesScoringConfigurationReceipt(receipt,changed)).toBe(false);
 });
 it.each([null,{}, {version:1,algorithm:'sha256',sha256:'a'.repeat(64),extra:true}, {version:2,algorithm:'sha256',sha256:'a'.repeat(64)}])('does not upgrade missing, forged, or unknown receipts',r=>expect(matchesScoringConfigurationReceipt(r,configuration())).toBe(false));
 it.each([NaN,Infinity,'0.3',null])('never certifies a malformed weight %s',value=>{const c:any=configuration();c.weights.intent=value;expect(captureScoringConfiguration(c)).toBeNull();});
 it('captures an immutable independent snapshot rather than a mutable cache object',()=>{
  const c=configuration(),s=captureScoringConfiguration(c)!;c.weights.intent=0.9;c.keywords.push('new');
  expect(s.configuration.weights.intent).toBe(0.3);expect(s.configuration.keywords).toEqual(['precio','comprar']);expect(Object.isFrozen(s.configuration.keywords)).toBe(true);
 });
});
