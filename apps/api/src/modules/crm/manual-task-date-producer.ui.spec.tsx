/** @jest-environment node */
// CI strict-memory date producer composition. No PostgreSQL, real HTTP, model or global acceptance.
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
const priorDescriptors=new Map<string,PropertyDescriptor|undefined>();
const setup:any={};
const boundaryErrors:string[]=[];
const unexpected=(message:string):never=>{boundaryErrors.push(message);throw new Error(message);};
function unused(name:string):any{return new Proxy({}, {get(_target,key){return unexpected('Unapproved dependency '+name+'.'+String(key));}});}

beforeAll(async()=>{
    if(Intl.DateTimeFormat().resolvedOptions().timeZone!=='America/Bogota')throw new Error('Child timezone must be America/Bogota');
    setup.browserTimezone=Intl.DateTimeFormat().resolvedOptions().timeZone;setup.offsetMinutes=new Date('2099-01-02T00:30').getTimezoneOffset();
    if(setup.offsetMinutes!==300)throw new Error('Expected independently checked offset300');dump('setup.json',setup);
    dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1/'});
    for(const key of globals){priorDescriptors.set(key,Object.getOwnPropertyDescriptor(globalThis,key));const value=key==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[key];Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
    ({createRoot}=require('react-dom/client'));
    ({NextIntlClientProvider}=require('next-intl'));
    Page=require('../../../../dashboard/src/app/admin/contacts/[leadId]/page').default;
},60000);

afterAll(async()=>{
    if(dom){dom.window.close();for(const key of globals){const previous=priorDescriptors.get(key);if(previous)Object.defineProperty(globalThis,key,previous);else delete (globalThis as any)[key];}}
},60000);

function setInput(input:HTMLInputElement,value:string){const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!;setter.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));}
async function waitFor(predicate:()=>boolean,description:string){for(let attempt=0;attempt<120;attempt++){if(predicate())return;await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});}throw new Error('Prerequisite/settle failed: '+description);}
for(const locale of ['es','en','pt','fr'])for(const withDate of [false,true]){
    it(locale+' '+(withDate?'dated':'undated'),async()=>{
        const caseName=locale+'-'+(withDate?'dated':'undated'),schema='qa_manual_task_memory_'+locale+'_'+(withDate?'dated':'undated'),title='Synthetic local follow-up '+caseName;
        const observed:any={locale,caseName,withDate,source:'real_page_controller_service_strict_memory_NO_PG',schema,requests:[],sql:[],prerequisites:{},created:null,afterRows:null,rendered:null,error:null,boundaryErrors:[],cleanup:{}};
        let root:any,container:HTMLDivElement|undefined;const rows:any[]=[];
        const initialBoundary=boundaryErrors.length;
        for(const fn of Object.values(router))fn.mockClear();
        try{
            observed.prerequisites.storage='synthetic_memory_only_NO_PG';observed.prerequisites.before=[];
            const adapter={executeInTenantSchema:async(requestSchema:string,sql:string,params:any[])=>{
                if(requestSchema!==schema)return unexpected('Foreign schema requested');
                const compact=sql.replace(/\s+/g,' ').trim();
                observed.sql.push({sql,params:structuredClone(params)});
                if(compact==='SELECT * FROM tasks WHERE 1=1 AND lead_id = $1::uuid ORDER BY due_at ASC NULLS LAST'&&JSON.stringify(params)===JSON.stringify([LEAD]))return structuredClone(rows);
                if(compact!=='INSERT INTO tasks ( lead_id, opportunity_id, title, description, type, due_at, assigned_to, created_by ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz, $7, $8) RETURNING *')return unexpected('Unexpected memory SQL');
                const expectedDue=withDate?'2099-01-02T05:30:00.000Z':null;
                if(JSON.stringify(params)!==JSON.stringify([LEAD,null,title,null,'call',expectedDue,null,null]))return unexpected('Unexpected original task payload/ISO instant at SQL port');
                if(rows.length!==0)return unexpected('Duplicate synthetic INSERT');
                // Synthetic storage response only. PostgreSQL semantics are covered by the separate local real-PG evidence.
                const row={id:'33333333-3333-4333-8333-333333333333',lead_id:LEAD,title,type:'call',status:'pending',due_at:params[5]?new Date(params[5]):null};rows.push(row);return [structuredClone(row)];
            }};
            const redis={get:async(key:string)=>{if(key!=='tenant:'+TENANT+':schema')return unexpected('Unexpected Redis key');return schema;}};
            const service=new TasksService(adapter as any,redis as any);
            const controller=new CrmController(unused('leads'),unused('opportunities'),unused('catalog'),unused('notes'),service,unused('activity'),unused('scoring'),unused('customAttrs'),unused('segments'),unused('importExport'),unused('analytics'),unused('insights'),unused('prisma'),unused('throttle'),unused('pipeline'));
            const profile={lead:{id:LEAD,contact_id:null,first_name:'Synthetic',last_name:'Task',stage:'nuevo',score:0,phone:null},opportunities:[],tags:[],resolved:{kind:'lead',leadId:LEAD,contactId:null}};
            api.getStages.mockReset().mockResolvedValue({success:true,data:[]});
            api.fetch.mockReset().mockImplementation(async(route:string,options:any={})=>{
                const method=options.method||'GET';observed.requests.push({route,method,body:options.body?JSON.parse(options.body):null});
                let response:any;
                if(route==='/crm/tasks/'+TENANT&&method==='POST'){
                    const body=JSON.parse(options.body);if(body.leadId!==LEAD||body.title!==title||body.type!=='call')return unexpected('Unexpected creation payload');
                    response=await controller.createTask(TENANT,body);observed.created=JSON.parse(JSON.stringify(response));
                }else if(route==='/crm/tasks/'+TENANT+'?leadId='+LEAD&&method==='GET')response=await controller.getTasks(TENANT,LEAD);
                else if(method==='GET'&&route==='/crm/leads/'+TENANT+'/'+LEAD)response={success:true,data:profile};
                else if(method==='GET'&&['/crm/timeline/'+TENANT+'/'+LEAD,'/crm/notes/'+TENANT+'/'+LEAD,'/crm/custom-attributes/'+TENANT+'?entityType=lead'].includes(route))response={success:true,data:[]};
                else if(method==='GET'&&route==='/crm/leads/'+TENANT+'/'+LEAD+'/score')response={success:true,data:{factors:{}}};
                else return unexpected('Unexpected UI API '+method+' '+route);
                // Same Date -> JSON serialization as the API response, not an invented client date.
                return JSON.parse(JSON.stringify(response));
            });
            const messages=require(path.resolve(__dirname,'../../../../dashboard/messages',locale+'.json'));
            container=dom.window.document.createElement('div');container.dataset.caseOwned=caseName;dom.window.document.body.appendChild(container);root=createRoot(container);
            await act(async()=>root.render(createElement(NextIntlClientProvider,{locale,messages,timeZone:'America/Bogota'},createElement(Page))));
            const tabTemplate=messages.contacts.leadDetail.tabTasks;if(typeof tabTemplate!=='string'||!tabTemplate.includes('{count}'))throw new Error('Native translated Tasks tab key missing');
            const tabLabel=tabTemplate.replace('{count}','0');
            await waitFor(()=>container!.textContent!.includes(tabLabel),'profile loaded');
            const tab=Array.from(container.querySelectorAll('button')).find(b=>b.textContent?.includes(tabLabel));if(!tab)throw new Error('Native Tasks tab missing');
            await act(async()=>tab.click());
            const date=container.querySelector<HTMLInputElement>('input[type="datetime-local"]'),input=container.querySelector<HTMLInputElement>('input[placeholder="'+messages.contacts.leadDetail.newTaskPlaceholder+'"]');
            if(!date||!input)throw new Error('Visible manual task controls missing');
            const group=date.parentElement!,select=group.querySelector('select'),add=group.querySelector('button');if(!select||!add)throw new Error('Native task type/add controls missing');
            await act(async()=>{setInput(input,title);if(withDate)setInput(date,'2099-01-02T00:30');select.value='call';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
            observed.prerequisites.inputDate=date.value;observed.prerequisites.expectedDate=withDate?new Date('2099-01-02T00:30').toLocaleDateString(undefined):null;
            if(input.value!==title||select.value!=='call'||date.value!==(withDate?'2099-01-02T00:30':''))throw new Error('Native input prerequisites failed');
            if(add.disabled)throw new Error('Add remains disabled before action');
            await act(async()=>add.click());
            await waitFor(()=>!!observed.created&&container!.textContent!.includes(title)&&observed.requests.filter((r:any)=>r.method==='GET'&&r.route.startsWith('/crm/tasks/')).length===2,'one create and normal refresh');
            observed.afterRows=JSON.parse(JSON.stringify(rows.map(row=>({id:row.id,title:row.title,type:row.type,due_at:row.due_at}))));
            observed.rendered={text:container.textContent,html:container.innerHTML};observed.boundaryErrors=boundaryErrors.slice(initialBoundary);dump(caseName+'-observed.json',observed);
            // Preconditions and cardinality precede the date oracle.
            expect(observed.boundaryErrors).toEqual([]);expect(observed.requests.filter((r:any)=>r.method==='POST')).toHaveLength(1);expect(observed.sql.filter((r:any)=>r.sql.includes('INSERT INTO tasks'))).toHaveLength(1);expect(observed.afterRows).toHaveLength(1);expect(observed.afterRows[0]).toMatchObject({title,type:'call'});expect(observed.rendered.text).toContain(title);
            if(withDate)expect(observed.rendered.text).toContain(observed.prerequisites.expectedDate);
            else expect(observed.afterRows[0].due_at).toBeNull();
            expect(router.push).not.toHaveBeenCalled();expect(router.replace).not.toHaveBeenCalled();
        }catch(error){observed.error=String((error as Error).stack||error);if(!fs.existsSync(path.join(OUT!,caseName+'-observed.json')))dump(caseName+'-observed.json',observed);throw error;
        }finally{
            if(root)await act(async()=>root.unmount());if(container)container.remove();
            rows.length=0;
            dump(caseName+'-cleanup.json',{ownContainerRemoved:!container?.isConnected,remainingContainers:dom?.window.document.querySelectorAll('[data-case-owned]').length||0,memoryRowsDiscarded:rows.length===0,actualPostgreSQL:false,boundaryErrors:boundaryErrors.slice(initialBoundary),navigation:Object.values(router).map(fn=>fn.mock.calls.length)});
        }
    },60000);
}
