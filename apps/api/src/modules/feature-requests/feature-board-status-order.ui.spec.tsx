/** @jest-environment node */
// Proposed native status-filter response ordering. Strict memory; no production/model/DB.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { FeatureRequestsController } from './feature-requests.controller';
import { FeatureRequestsService } from './feature-requests.service';
const USER='11111111-1111-4111-8111-111111111111',TENANT='22222222-2222-4222-8222-222222222222';
const OUT=process.env.FEATURE_BOARD_STATUS_EVIDENCE_DIR;
if(!OUT||!path.isAbsolute(OUT))throw new Error('Exclusive absolute evidence folder required');
const dump=(file:string,value:any)=>fs.writeFileSync(path.join(OUT!,file),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const nav={push:jest.fn(),replace:jest.fn(),back:jest.fn(),refresh:jest.fn(),prefetch:jest.fn()};
jest.mock('next/navigation',()=>({__esModule:true,usePathname:()=>'/admin/feature-requests',useRouter:()=>nav}));
jest.mock('@/contexts/AuthContext',()=>({__esModule:true,useAuth:()=>({user:{id:USER,tenantId:TENANT,role:'tenant_admin'}})}));
jest.mock('@/lib/api',()=>({__esModule:true,api:{listFeatureRequests:jest.fn(),getFeatureRequestChangelog:jest.fn()}}));
const api=jest.requireMock('@/lib/api').api;
let dom:JSDOM,Page:any,NextIntlClientProvider:any,createRoot:any;
const globals=['window','document','navigator','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent','HTMLInputElement','HTMLSelectElement','localStorage','IS_REACT_ACT_ENVIRONMENT'];
const prior=new Map<string,PropertyDescriptor|undefined>(),boundaryErrors:string[]=[];
function unexpected(message:string):never{boundaryErrors.push(message);throw new Error(message);}
function unused(name:string):any{return new Proxy({}, {get(_target,key){return unexpected('Unapproved dependency '+name+'.'+String(key));}});}
beforeAll(async()=>{
    dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1/'});
    for(const key of globals){prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[key]});}
    ({createRoot}=await import('react-dom/client'));({NextIntlClientProvider}=await import('next-intl'));
    const pageModulePath='../../../../dashboard/src/app/admin/feature-requests/page';Page=(await import(pageModulePath)).default;
});
afterAll(()=>{dom?.window.close();for(const key of globals){const old=prior.get(key);if(old)Object.defineProperty(globalThis,key,old);else delete (globalThis as any)[key];}});
async function waitFor(check:()=>boolean,label:string){for(let n=0;n<120;n++){if(check())return;await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});}throw new Error('Prerequisite settle failed: '+label);}
const LIST_SQL='SELECT fr.id, fr.title, fr.description, fr.status, fr.category, fr.author_user_id, fr.author_tenant_id, fr.vote_count, fr.weighted_score, fr.comment_count, fr.shipped_at, fr.created_at, fr.updated_at, t.name AS author_tenant_name, u.first_name || \' \' || u.last_name AS author_name , uv.id IS NOT NULL AS user_voted FROM feature_requests fr LEFT JOIN tenants t ON t.id = fr.author_tenant_id LEFT JOIN users u ON u.id = fr.author_user_id LEFT JOIN feature_request_votes uv ON uv.request_id = fr.id AND uv.user_id = $1::uuid WHERE fr.merged_into_id IS NULL ORDER BY fr.weighted_score DESC, fr.vote_count DESC LIMIT 200';
const FILTER_SQL=LIST_SQL.replace('uv.user_id = $1::uuid','uv.user_id = $2::uuid').replace('WHERE fr.merged_into_id IS NULL ORDER BY','WHERE fr.merged_into_id IS NULL AND fr.status = $1 ORDER BY');
for(const locale of ['es','en','pt','fr'])it(locale+' latest native status selection retains its rows after an older response',async()=>{
    const row=(id:string,status:string,title:string)=>({id,title,description:'Synthetic existing improvement '+status,category:'ux',status,shipped_at:status==='shipped'?'2099-01-15T12:00:00.000Z':null,vote_count:3,weighted_score:3,comment_count:0,user_voted:false,author_name:'Synthetic operator'});
    const initial=row('33333333-3333-4333-8333-333333333331','open','Synthetic initial '+locale),planned=row('33333333-3333-4333-8333-333333333332','planned','Synthetic planned A '+locale),shipped=row('33333333-3333-4333-8333-333333333333','shipped','Synthetic shipped B '+locale);
    const observed:any={locale,source:'real_page_NextIntl_TabNav_controller_service_strict_memory',requests:[],sql:[],responses:[],initial:null,middle:null,final:null,boundaryErrors:[],error:null};
    const startBoundary=boundaryErrors.length;let root:any,container:HTMLDivElement|undefined,releasePlanned:((rows:any[])=>void)|undefined,plannedResolved=false,cleanupReleasedOwnedPending=false;
    const pendingPlanned=new Promise<any[]>(resolve=>{releasePlanned=resolve;});for(const fn of Object.values(nav))fn.mockClear();
    const view=()=>({activeStatus:container?.querySelector('button[role="tab"][aria-selected="true"]')?.getAttribute('data-tab-id'),titles:Array.from(container?.querySelectorAll('h3')||[]).map(h=>h.textContent),html:container?.innerHTML});
    try{
        const prisma=new Proxy({$queryRawUnsafe:async(sql:string,...params:any[])=>{const compact=sql.replace(/\s+/g,' ').trim(),call=observed.sql.length+1;observed.sql.push({call,sql:compact,params:structuredClone(params)});
            if(call===1&&compact===LIST_SQL&&JSON.stringify(params)===JSON.stringify([USER]))return [structuredClone(initial)];
            if(call===2&&compact===FILTER_SQL&&JSON.stringify(params)===JSON.stringify(['planned',USER]))return pendingPlanned;
            if(call===3&&compact===FILTER_SQL&&JSON.stringify(params)===JSON.stringify(['shipped',USER]))return [structuredClone(shipped)];
            return unexpected('Unapproved SQL/params/order');
        }},{get(target,key){if(key==='$queryRawUnsafe')return target.$queryRawUnsafe;return unexpected('Unapproved Prisma operation '+String(key));}});
        const service=new FeatureRequestsService(prisma as any,unused('config'),unused('cronLock'),unused('llmKeys')),controller=new FeatureRequestsController(service);
        api.listFeatureRequests.mockReset().mockImplementation(async(params:any)=>{const call=observed.requests.length+1,expected=call===1?{sort:'score'}:call===2?{sort:'score',status:'planned'}:call===3?{sort:'score',status:'shipped'}:null;observed.requests.push({call,method:'GET',route:'/feature-requests',params:structuredClone(params)});if(!expected||JSON.stringify(params)!==JSON.stringify(expected))return unexpected('Unexpected native board filters');const response=await controller.list({user:{id:USER,tenantId:TENANT,role:'tenant_admin'}},params.status,undefined,undefined,params.sort);observed.responses.push({call,requestedStatus:params.status||'all',rows:structuredClone(response.data)});return response;});
        api.getFeatureRequestChangelog.mockReset().mockImplementation(()=>unexpected('Unapproved changelog port'));
        const messages=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../dashboard/messages',locale+'.json'),'utf8'));
        container=dom.window.document.createElement('div');container.dataset.caseOwned=locale;dom.window.document.body.appendChild(container);root=createRoot(container);
        await act(async()=>root.render(createElement(NextIntlClientProvider,{locale,messages,timeZone:'America/Bogota'},createElement(Page))));
        await waitFor(()=>container?.querySelector('h3')?.textContent===initial.title,'initial board own row');observed.initial=view();
        const plannedTab=container.querySelector<HTMLButtonElement>('button[role="tab"][data-tab-id="planned"]'),shippedTab=container.querySelector<HTMLButtonElement>('button[role="tab"][data-tab-id="shipped"]');if(!plannedTab||!shippedTab||plannedTab.textContent?.trim()!==messages.featureRequests.status.planned||shippedTab.textContent?.trim()!==messages.featureRequests.status.shipped)throw new Error('Translated native status tabs prerequisite');
        await act(async()=>plannedTab.click());await waitFor(()=>observed.sql.length===2,'planned realSELECT started and pending');
        await act(async()=>shippedTab.click());await waitFor(()=>container?.querySelector('h3')?.textContent===shipped.title&&observed.responses.length===2,'latest shipped response visible');observed.middle=view();
        await act(async()=>{plannedResolved=true;releasePlanned!([structuredClone(planned)]);await pendingPlanned;});await waitFor(()=>observed.responses.length===3,'older planned realSELECT resolved');
        observed.final=view();observed.boundaryErrors=boundaryErrors.slice(startBoundary);dump(locale+'-observed.json',observed);
        // Positive native flow and both legitimate responses before first product oracle.
        expect(observed.initial.activeStatus).toBe('all');expect(observed.initial.titles).toEqual([initial.title]);expect(observed.middle.activeStatus).toBe('shipped');expect(observed.middle.titles).toEqual([shipped.title]);expect(observed.final.activeStatus).toBe('shipped');expect(observed.requests).toHaveLength(3);expect(observed.requests.every((r:any)=>r.method==='GET')).toBe(true);expect(observed.sql).toHaveLength(3);expect(observed.responses.map((r:any)=>r.call)).toEqual([1,3,2]);expect(observed.responses.map((r:any)=>r.rows[0].status)).toEqual(['open','shipped','planned']);expect(observed.boundaryErrors).toEqual([]);
        expect(observed.final.titles).toEqual([shipped.title]);
        expect(observed.final.titles).not.toContain(planned.title);
    }catch(error){observed.error=String((error as Error).stack||error);if(!fs.existsSync(path.join(OUT!,locale+'-observed.json')))dump(locale+'-observed.json',observed);throw error;
    }finally{
        if(!plannedResolved){cleanupReleasedOwnedPending=true;await act(async()=>{plannedResolved=true;releasePlanned!([structuredClone(planned)]);await pendingPlanned;});}
        if(root)await act(async()=>root.unmount());if(container)container.remove();dump(locale+'-cleanup.json',{ownContainerRemoved:!container?.isConnected,remainingOwnedContainers:dom.window.document.querySelectorAll('[data-case-owned]').length,boundaryErrors:boundaryErrors.slice(startBoundary),navigation:Object.values(nav).map(fn=>fn.mock.calls.length),writes:observed.requests.filter((r:any)=>r.method!=='GET').length,plannedResolved,cleanupReleasedOwnedPending,timerInventoryMeasured:false});
    }
},15000);
