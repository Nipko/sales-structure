import {PoliciesService} from './policies.service';
describe('policy post-commit pending legacy invalidation',()=>{
 const tenant='44444444-4444-4444-8444-444444444444';
 const row={id:'55555555-5555-4555-8555-555555555555',type:'privacy',title:'Synthetic pending test',content:'Synthetic current',version:2,is_active:true};
 const input={type:'privacy',title:row.title,content:row.content};
 function harness(){
  const s=Object.create(PoliciesService.prototype)as any;let committed=false,removed=false;
  let release!:(v?:unknown)=>void,reject!:(e:Error)=>void,entered!:()=>void;
  const gate=new Promise((ok,no)=>{release=ok;reject=no;});const waiting=new Promise<void>(ok=>{entered=ok;});
  s.logger={warn:jest.fn()};s.ensureSchema=jest.fn().mockResolvedValue('tenant_synthetic_pending');s.events={emit:jest.fn()};
  s.redis={del:jest.fn(()=>{entered();return gate;})};
  s.prisma={
   $executeRawUnsafe:jest.fn(async()=>1),
   $queryRawUnsafe:jest.fn(async(sql:string)=>{if(sql.includes('MAX(version)'))return[{next_version:2}];if(sql.includes('pg_advisory_xact_lock'))return[{}];if(sql.includes('DELETE FROM')){committed=true;removed=true;return[{type:'privacy'}];}if(sql.includes('INSERT INTO'))return[row];if(sql.includes('WHERE type'))return removed?[]:[row];return[];}),
   $transaction:jest.fn(async(fn:any)=>{const result=await fn(s.prisma);committed=true;return result;}),
  };
  function start(kind:'upsert'|'delete'){
   const state={settled:false,value:undefined as any,error:undefined as any};
   const done=(kind==='upsert'?s.upsert(tenant,input):s.delete(tenant,row.id)).then((v:any)=>{state.settled=true;state.value=v;},(e:any)=>{state.settled=true;state.error=e;});
   return{state,done};
  }
  return{s,waiting,release,reject,start,committed:()=>committed};
 }
 async function flush(){await new Promise<void>(r=>setImmediate(r));}
 it('POLICYCACHEFIX_A_UPSERT_RESPONSE committed replacement should not depend on pending legacy invalidation',async()=>{
  const h=harness(),op=h.start('upsert');await h.waiting;await flush();
  try{expect(h.committed()).toBe(true);expect(h.s.events.emit).toHaveBeenCalledTimes(1);expect(op.state.settled).toBe(true);}finally{h.release();await op.done;}
 });
 it('POLICYCACHEFIX_A_DELETE_RESPONSE committed deletion should not depend on pending legacy invalidation',async()=>{
  const h=harness(),op=h.start('delete');await h.waiting;await flush();
  try{expect(h.committed()).toBe(true);expect(h.s.events.emit).toHaveBeenCalledTimes(1);expect(op.state.settled).toBe(true);}finally{h.release();await op.done;}
 });
 it('POLICYCACHEFIX_A_LATE_UPSERT_REJECTION eventual rejected invalidation preserves one committed outcome and event',async()=>{
  const h=harness(),op=h.start('upsert');await h.waiting;await flush();expect(op.state.settled).toBe(true);
  h.reject(Error('synthetic_late_redis_error'));await op.done;await flush();
  expect(op.state.error).toBeUndefined();expect(op.state.value).toMatchObject({id:row.id,version:2});
  expect(h.s.prisma.$transaction).toHaveBeenCalledTimes(1);expect(h.s.events.emit).toHaveBeenCalledTimes(1);expect(h.s.logger.warn).toHaveBeenCalledTimes(1);
 });
 it('POLICYCACHEFIX_B_LATE_DELETE_REJECTION eventual rejected invalidation preserves one removal and event',async()=>{
  const h=harness(),op=h.start('delete');await h.waiting;await flush();expect(op.state.settled).toBe(true);
  h.reject(Error('synthetic_late_redis_error'));await op.done;await flush();
  expect(op.state.error).toBeUndefined();expect(op.state.value).toBeUndefined();
  expect(h.s.prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);expect(h.s.events.emit).toHaveBeenCalledTimes(1);expect(h.s.logger.warn).toHaveBeenCalledTimes(1);
 });
 it('POLICYCACHEFIX_B_READ_REPLACED current policy is observable without holding replacement response',async()=>{
  const h=harness(),op=h.start('upsert');await h.waiting;await flush();
  try{expect(h.committed()).toBe(true);expect(op.state.settled).toBe(true);await expect(h.s.getActive(tenant,'privacy')).resolves.toMatchObject({id:row.id,version:2,content:row.content});expect(h.s.events.emit).toHaveBeenCalledTimes(1);}finally{h.release();await op.done;}
 });
 it('POLICYCACHEFIX_B_READ_DELETED removed policy is absent without holding deletion response',async()=>{
  const h=harness(),op=h.start('delete');await h.waiting;await flush();
  try{expect(h.committed()).toBe(true);expect(op.state.settled).toBe(true);await expect(h.s.getActive(tenant,'privacy')).resolves.toBeNull();expect(h.s.events.emit).toHaveBeenCalledTimes(1);}finally{h.release();await op.done;}
 });
});
