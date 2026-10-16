/** @jest-environment node */
// Local composition only. Root adoption and preregistration required before import/Jest.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { CrmController } from './crm.controller';
import { TasksService } from './services/tasks/tasks.service';
const TENANT='11111111-1111-4111-8111-111111111111',LEAD='22222222-2222-4222-8222-222222222222';
const OUT=process.env.MANUAL_TASK_EVIDENCE_DIR;
if(!OUT||!path.isAbsolute(OUT))throw new Error('Exclusive evidence directory required');
const dump=(name:string,value:any)=>fs.writeFileSync(path.join(OUT!,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const router={push:jest.fn(),replace:jest.fn(),back:jest.fn(),forward:jest.fn(),refresh:jest.fn(),prefetch:jest.fn()};
jest.mock('next/navigation',()=>({__esModule:true,useParams:()=>({leadId:LEAD}),useRouter:()=>router,usePathname:()=>'/admin/contacts/'+LEAD,useSearchParams:()=>new URLSearchParams()}));
jest.mock('@/contexts/TenantContext',()=>({__esModule:true,useTenant:()=>({activeTenantId:TENANT})}));
jest.mock('@/contexts/AuthContext',()=>({__esModule:true,useAuth:()=>({user:{id:'synthetic-operator',role:'tenant_admin'},verticalConfig:null})}));
jest.mock('@/lib/api',()=>({__esModule:true,api:{fetch:jest.fn(),getStages:jest.fn()}}));
const api=jest.requireMock('@/lib/api').api;
let dom:JSDOM,Page:any,NextIntlClientProvider:any,createRoot:any;
const globals=['window','document','navigator','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent','HTMLInputElement','HTMLSelectElement','IS_REACT_ACT_ENVIRONMENT'];
const prior=new Map<string,PropertyDescriptor|undefined>(),boundaryErrors:string[]=[];
const unexpected=(message:string):never=>{boundaryErrors.push(message);throw new Error(message);};
function unused(name:string):any{return new Proxy({}, {get(_target,key){return unexpected('Unapproved dependency '+name+'.'+String(key));}});}
beforeAll(()=>{
    if(Intl.DateTimeFormat().resolvedOptions().timeZone!=='America/Bogota'||new Date('2099-01-02T00:30').getTimezoneOffset()!==300)throw new Error('Verified Bogota timezone prerequisite');
    dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1/'});
    for(const key of globals){prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[key]});}
    ({createRoot}=require('react-dom/client'));({NextIntlClientProvider}=require('next-intl'));
    Page=require('../../../../dashboard/src/app/admin/contacts/[leadId]/page').default;
});
afterAll(()=>{dom.window.close();for(const key of globals){const descriptor=prior.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete (globalThis as any)[key];}});
function setInput(input:HTMLInputElement,value:string){Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));}
async function waitFor(predicate:()=>boolean,description:string){for(let n=0;n<160;n++){if(predicate())return;await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});}throw new Error('Prerequisite/settle failed: '+description);}
function visible(node:Element){for(let el:Element|null=node;el;el=el.parentElement){if(el.hasAttribute('hidden')||el.getAttribute('aria-hidden')==='true')return false;const css=dom.window.getComputedStyle(el);if(css.display==='none'||css.visibility==='hidden')return false;}return true;}
for(const locale of ['es','en','pt','fr'])it(locale+' pending then rejected manual task announces translated error',async()=>{
    const title='Synthetic retained task '+locale,dateValue='2099-01-02T00:30',schema='qa_manual_task_memory_'+locale;
    const observed:any={locale,source:'real_page_NextIntl_controller_TasksService_strict_memory',requests:[],sql:[],redis:[],pending:null,rejected:null,announcements:[],boundaryErrors:[],error:null};
    let root:any,container:HTMLDivElement|undefined,rejectInsert:((error:Error)=>void)|undefined,insertSettled=false,toastSeen=false,errorText='',toastGoneAt:string|null=null;
    const initialBoundary=boundaryErrors.length;for(const fn of Object.values(router))fn.mockClear();
    const insert=new Promise<any[]>((_resolve,reject)=>{rejectInsert=reject;});
    // Attach an observer immediately; the actual service still receives the original rejection.
    void insert.catch(()=>undefined);
    try{
        const adapter={executeInTenantSchema:async(requestSchema:string,sql:string,params:any[])=>{
            if(requestSchema!==schema)return unexpected('Foreign memory schema');
            const compact=sql.replace(/\s+/g,' ').trim();observed.sql.push({sql:compact,params:structuredClone(params)});
            if(compact==='SELECT * FROM tasks WHERE 1=1 AND lead_id = $1::uuid ORDER BY due_at ASC NULLS LAST'&&params.length===1&&params[0]===LEAD)return [];
            if(compact==='INSERT INTO tasks ( lead_id, opportunity_id, title, description, type, due_at, assigned_to, created_by ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz, $7, $8) RETURNING *'&&JSON.stringify(params)===JSON.stringify([LEAD,null,title,null,'call','2099-01-02T05:30:00.000Z',null,null]))return insert;
            return unexpected('Unexpected memory SQL/parameters');
        }};
        const redis={get:async(key:string)=>{observed.redis.push(key);if(key!=='tenant:'+TENANT+':schema')return unexpected('Unexpected Redis key');return schema;}};
        const service=new TasksService(adapter as any,redis as any),controller=new CrmController(unused('leads'),unused('opportunities'),unused('catalog'),unused('notes'),service,unused('activity'),unused('scoring'),unused('customAttrs'),unused('segments'),unused('importExport'),unused('analytics'),unused('insights'),unused('prisma'),unused('throttle'),unused('pipeline'));
        const profile={lead:{id:LEAD,contact_id:null,first_name:'Synthetic',last_name:'Task',stage:'nuevo',score:0,phone:null},opportunities:[],tags:[],resolved:{kind:'lead',leadId:LEAD,contactId:null}};
        api.getStages.mockReset().mockImplementation(async(tenant:string)=>{if(tenant!==TENANT)return unexpected('Foreign stages tenant');return {success:true,data:[]};});
        api.fetch.mockReset().mockImplementation(async(route:string,options:any={})=>{
            const method=options.method||'GET';observed.requests.push({route,method,body:options.body?JSON.parse(options.body):null});
            if(route==='/crm/tasks/'+TENANT&&method==='POST')return controller.createTask(TENANT,JSON.parse(options.body));
            if(route==='/crm/tasks/'+TENANT+'?leadId='+LEAD&&method==='GET')return controller.getTasks(TENANT,LEAD);
            if(method==='GET'&&route==='/crm/leads/'+TENANT+'/'+LEAD)return {success:true,data:profile};
            if(method==='GET'&&['/crm/timeline/'+TENANT+'/'+LEAD,'/crm/notes/'+TENANT+'/'+LEAD,'/crm/custom-attributes/'+TENANT+'?entityType=lead'].includes(route))return {success:true,data:[]};
            if(method==='GET'&&route==='/crm/leads/'+TENANT+'/'+LEAD+'/score')return {success:true,data:{factors:{}}};
            return unexpected('Unexpected UI API '+method+' '+route);
        });
        const messages=require(path.resolve(__dirname,'../../../../dashboard/messages',locale+'.json'));errorText=messages.common.errorSaving;
        if(typeof errorText!=='string'||!errorText.trim())throw new Error('Missing actual translated saving error');
        container=dom.window.document.createElement('div');container.dataset.caseOwned=locale;dom.window.document.body.appendChild(container);root=createRoot(container);
        await act(async()=>root.render(createElement(NextIntlClientProvider,{locale,messages,timeZone:'America/Bogota'},createElement(Page))));
        const tabLabel=messages.contacts.leadDetail.tabTasks.replace('{count}','0');
        await waitFor(()=>container!.textContent!.includes(tabLabel),'profile loaded');
        const tab=Array.from(container.querySelectorAll('button')).find(b=>b.textContent?.includes(tabLabel));if(!tab)throw new Error('Tasks tab missing');await act(async()=>tab.click());
        const date=container.querySelector<HTMLInputElement>('input[type="datetime-local"]'),input=container.querySelector<HTMLInputElement>('input[placeholder="'+messages.contacts.leadDetail.newTaskPlaceholder+'"]');if(!date||!input)throw new Error('Native task controls missing');
        const select=date.parentElement!.querySelector('select'),add=date.parentElement!.querySelector('button');if(!select||!add)throw new Error('Native type/add missing');
        await act(async()=>{setInput(input,title);setInput(date,dateValue);select.value='call';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
        if(add.disabled||input.value!==title||date.value!==dateValue||select.value!=='call')throw new Error('Task draft prerequisite');
        await act(async()=>add.click());await waitFor(()=>observed.sql.some((r:any)=>r.sql.startsWith('INSERT INTO tasks')),'real service reaches deferred memory INSERT');
        const disabledBeforeSecond=add.disabled;await act(async()=>add.click());
        observed.pending={disabledBeforeSecond,disabledAfterSecond:add.disabled,POSTs:observed.requests.filter((r:any)=>r.method==='POST').length,INSERTs:observed.sql.filter((r:any)=>r.sql.startsWith('INSERT INTO tasks')).length,title:input.value,type:select.value,date:date.value};
        if(!disabledBeforeSecond||!add.disabled||observed.pending.POSTs!==1||observed.pending.INSERTs!==1)throw new Error('Pending/second native click prerequisites failed');
        await act(async()=>{insertSettled=true;rejectInsert!(new Error('synthetic_owned_manual_task_insert_rejected'));});
        await waitFor(()=>container!.textContent!.includes(errorText)&&!add.disabled,'translated rejection text and unlocked button');toastSeen=true;
        const regions=Array.from(container.querySelectorAll('[role="alert"],[aria-live]')).filter(el=>visible(el)&&(el.getAttribute('role')==='alert'||(el.hasAttribute('aria-live')&&el.getAttribute('aria-live')!=='off'))&&el.textContent?.includes(errorText));
        observed.announcements=regions.map(el=>({role:el.getAttribute('role'),live:el.getAttribute('aria-live'),text:el.textContent}));
        observed.rejected={at_utc:new Date().toISOString(),errorText,visibleError:container.textContent!.includes(errorText),title:input.value,type:select.value,date:date.value,buttonDisabled:add.disabled,POSTs:observed.requests.filter((r:any)=>r.method==='POST').length,taskGETs:observed.requests.filter((r:any)=>r.method==='GET'&&r.route.startsWith('/crm/tasks/')).length,html:container.innerHTML};
        observed.boundaryErrors=boundaryErrors.slice(initialBoundary);dump(locale+'-observed.json',observed);
        expect(observed.boundaryErrors).toEqual([]);expect(observed.pending).toMatchObject({disabledBeforeSecond:true,disabledAfterSecond:true,POSTs:1,INSERTs:1,title,type:'call',date:dateValue});
        expect(observed.rejected).toMatchObject({visibleError:true,title,type:'call',date:dateValue,buttonDisabled:false,POSTs:1,taskGETs:1});
        // First discriminating product oracle, after native pending/error/draft controls and snapshot.
        expect(observed.announcements.length).toBeGreaterThan(0);
        expect(router.push).not.toHaveBeenCalled();expect(router.replace).not.toHaveBeenCalled();
    }catch(error){observed.error=String((error as Error).stack||error);if(!fs.existsSync(path.join(OUT!,locale+'-observed.json')))dump(locale+'-observed.json',observed);throw error;
    }finally{
        if(!insertSettled){insertSettled=true;await act(async()=>rejectInsert!(new Error('synthetic_owned_cleanup_rejection')));}
        // Natural product timeout while mounted, including when the announcement oracle fails.
        let cleanupError:string|null=null;
        try{if(container&&errorText){await waitFor(()=>!container!.textContent!.includes(errorText),'natural toast expiration while mounted');toastGoneAt=new Date().toISOString();}}catch(error){cleanupError=String(error);}
        if(root)await act(async()=>root.unmount());if(container)container.remove();
        dump(locale+'-cleanup.json',{toastSeen,naturalToastDisappearanceAt:toastGoneAt,cleanupError,ownContainerRemoved:!container?.isConnected,remainingOwnedContainers:dom.window.document.querySelectorAll('[data-case-owned]').length,boundaryErrors:boundaryErrors.slice(initialBoundary),navigation:Object.values(router).map(fn=>fn.mock.calls.length),timerInventoryMeasured:false});
        if(cleanupError)throw new Error(cleanupError);
    }
},20000);
