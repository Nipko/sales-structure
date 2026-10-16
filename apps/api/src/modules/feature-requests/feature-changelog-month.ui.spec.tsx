/** @jest-environment node */
// Proposed calendar-month criterion. Strict memory only; never production/PG/model.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { FeatureRequestsController } from './feature-requests.controller';
import { FeatureRequestsService } from './feature-requests.service';
const USER='11111111-1111-4111-8111-111111111111',TENANT='22222222-2222-4222-8222-222222222222',ITEM='33333333-3333-4333-8333-333333333333';
const OUT=process.env.FEATURE_CHANGELOG_EVIDENCE_DIR;
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
    if(process.env.TZ!=='America/Bogota'||new Date(2099,0,2,0,30).getTimezoneOffset()!==300)throw new Error('Owned child TZ prerequisite');
    dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1/'});
    for(const key of globals){prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[key]});}
    ({createRoot}=await import('react-dom/client'));({NextIntlClientProvider}=await import('next-intl'));
    const pageModulePath='../../../../dashboard/src/app/admin/feature-requests/page';Page=(await import(pageModulePath)).default;
});
afterAll(()=>{dom?.window.close();for(const key of globals){const old=prior.get(key);if(old)Object.defineProperty(globalThis,key,old);else delete (globalThis as any)[key];}});
async function waitFor(check:()=>boolean,label:string){for(let n=0;n<120;n++){if(check())return;await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});}throw new Error('Prerequisite settle failed: '+label);}
const LIST_SQL='SELECT fr.id, fr.title, fr.description, fr.status, fr.category, fr.author_user_id, fr.author_tenant_id, fr.vote_count, fr.weighted_score, fr.comment_count, fr.shipped_at, fr.created_at, fr.updated_at, t.name AS author_tenant_name, u.first_name || \' \' || u.last_name AS author_name , uv.id IS NOT NULL AS user_voted FROM feature_requests fr LEFT JOIN tenants t ON t.id = fr.author_tenant_id LEFT JOIN users u ON u.id = fr.author_user_id LEFT JOIN feature_request_votes uv ON uv.request_id = fr.id AND uv.user_id = $1::uuid WHERE fr.merged_into_id IS NULL ORDER BY fr.weighted_score DESC, fr.vote_count DESC LIMIT 200';
const CHANGELOG_SQL="SELECT id, title, description, category, shipped_at, vote_count, to_char(shipped_at, 'YYYY-MM') AS month FROM feature_requests WHERE status = 'shipped' AND shipped_at IS NOT NULL AND merged_into_id IS NULL ORDER BY shipped_at DESC LIMIT 200";
for(const locale of ['es','en','pt','fr'])it(locale+' changelog heading preserves canonical calendar month',async()=>{
    const row={id:ITEM,title:'Synthetic January release '+locale,description:'Synthetic existing shipped improvement',category:'ux',status:'shipped',shipped_at:'2099-01-15T12:00:00.000Z',month:'2099-01',vote_count:3,weighted_score:3,comment_count:0,user_voted:false,author_name:'Synthetic operator'};
    const observed:any={locale,source:'real_page_NextIntl_controller_service_strict_memory',requests:[],sql:[],returnedMonth:null,before:null,after:null,boundaryErrors:[],error:null};
    const startBoundary=boundaryErrors.length;let root:any,container:HTMLDivElement|undefined;for(const fn of Object.values(nav))fn.mockClear();
    try{
        const prisma=new Proxy({$queryRawUnsafe:async(sql:string,...params:any[])=>{const compact=sql.replace(/\s+/g,' ').trim();observed.sql.push({sql:compact,params:structuredClone(params)});
            if(observed.sql.length===1&&compact===LIST_SQL&&JSON.stringify(params)===JSON.stringify([USER]))return [structuredClone(row)];
            if(observed.sql.length===2&&compact===CHANGELOG_SQL&&params.length===0){observed.returnedMonth=row.month;return [structuredClone(row)];}
            return unexpected('Unapproved SQL/params/order');
        }},{get(target,key){if(key==='$queryRawUnsafe')return target.$queryRawUnsafe;return unexpected('Unapproved Prisma operation '+String(key));}});
        const service=new FeatureRequestsService(prisma as any,unused('config'),unused('cronLock'),unused('llmKeys')),controller=new FeatureRequestsController(service);
        api.listFeatureRequests.mockReset().mockImplementation(async(params:any)=>{observed.requests.push({method:'GET',route:'/feature-requests',params:structuredClone(params)});if(JSON.stringify(params)!==JSON.stringify({sort:'score'}))return unexpected('Unexpected initial board filters');return controller.list({user:{id:USER,tenantId:TENANT,role:'tenant_admin'}},undefined,undefined,undefined,'score');});
        api.getFeatureRequestChangelog.mockReset().mockImplementation(async(...args:any[])=>{observed.requests.push({method:'GET',route:'/feature-requests/changelog'});if(args.length)return unexpected('Unexpected changelog params');return controller.changelog();});
        const messages=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../dashboard/messages',locale+'.json'),'utf8'));
        if(typeof messages.featureRequests.viewChangelog!=='string'||typeof messages.featureRequests.status.shipped!=='string')throw new Error('Native locale messages prerequisite');
        container=dom.window.document.createElement('div');container.dataset.caseOwned=locale;dom.window.document.body.appendChild(container);root=createRoot(container);
        await act(async()=>root.render(createElement(NextIntlClientProvider,{locale,messages,timeZone:'America/Bogota'},createElement(Page))));
        await waitFor(()=>!!container?.querySelector('h3')&&container.textContent?.includes(row.title)===true,'initial board title');
        observed.before={title:container.querySelector('h3')?.textContent,sqlCount:observed.sql.length,requests:structuredClone(observed.requests),html:container.innerHTML};
        const buttons=Array.from(container.querySelectorAll('button')).filter(b=>b.textContent?.trim()===messages.featureRequests.viewChangelog);if(buttons.length!==1)throw new Error('Unique native changelog tab prerequisite');
        await act(async()=>buttons[0].click());await waitFor(()=>observed.returnedMonth==='2099-01'&&container?.querySelector('h4')?.textContent===row.title,'canonical changelog row');
        const expectedMonth=new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(new Date(2099,0,15,12));
        observed.after={heading:container.querySelector('h3')?.textContent?.trim(),title:container.querySelector('h4')?.textContent,description:container.querySelector('h4')?.nextElementSibling?.textContent,hasShipped:container.textContent?.includes(messages.featureRequests.status.shipped),expectedMonth,effectiveIntlLocale:new Intl.DateTimeFormat().resolvedOptions().locale,timeZone:new Intl.DateTimeFormat().resolvedOptions().timeZone,offsetMinutes:new Date(2099,0,15,12).getTimezoneOffset(),html:container.innerHTML};
        observed.boundaryErrors=boundaryErrors.slice(startBoundary);dump(locale+'-observed.json',observed);
        // Positive source/list/canonical-row/read-only controls before the first product oracle.
        expect(observed.before.title).toBe(row.title);expect(observed.before.sqlCount).toBe(1);expect(observed.sql).toHaveLength(2);expect(observed.requests.map((r:any)=>r.route)).toEqual(['/feature-requests','/feature-requests/changelog']);expect(observed.requests.every((r:any)=>r.method==='GET')).toBe(true);expect(observed.returnedMonth).toBe('2099-01');expect(observed.after.title).toBe(row.title);expect(observed.after.description).toBe(row.description);expect(observed.after.hasShipped).toBe(true);expect(observed.after.offsetMinutes).toBe(300);expect(observed.boundaryErrors).toEqual([]);
        expect(observed.after.heading).toBe(expectedMonth);
        expect(nav.push).not.toHaveBeenCalled();expect(nav.replace).not.toHaveBeenCalled();
    }catch(error){observed.error=String((error as Error).stack||error);if(!fs.existsSync(path.join(OUT!,locale+'-observed.json')))dump(locale+'-observed.json',observed);throw error;
    }finally{if(root)await act(async()=>root.unmount());if(container)container.remove();dump(locale+'-cleanup.json',{ownContainerRemoved:!container?.isConnected,remainingOwnedContainers:dom.window.document.querySelectorAll('[data-case-owned]').length,boundaryErrors:boundaryErrors.slice(startBoundary),navigation:Object.values(nav).map(fn=>fn.mock.calls.length),writes:observed.requests.filter((r:any)=>r.method!=='GET').length,timerInventoryMeasured:false});}
},15000);
