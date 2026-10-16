/** @jest-environment node */
// Proposed strict-memory existing-task display criterion, no production activity.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { CrmController } from './crm.controller';
import { TasksService } from './services/tasks/tasks.service';
const TENANT='11111111-1111-4111-8111-111111111111',LEAD='22222222-2222-4222-8222-222222222222';
const TYPES=['follow_up','call','email','meeting','handoff'];
const OUT=process.env.TASK_TYPE_EVIDENCE_DIR;
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
beforeAll(async()=>{
    dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1/'});
    for(const key of globals){prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[key]});}
    ({createRoot}=await import('react-dom/client'));({NextIntlClientProvider}=await import('next-intl'));const pageModulePath='../../../../dashboard/src/app/admin/contacts/[leadId]/page';Page=(await import(pageModulePath)).default;
});
afterAll(()=>{dom.window.close();for(const key of globals){const descriptor=prior.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete (globalThis as any)[key];}});
async function waitFor(predicate:()=>boolean,description:string){for(let n=0;n<120;n++){if(predicate())return;await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});}throw new Error('Prerequisite/settle failed: '+description);}
for(const locale of ['es','en','pt','fr'])it(locale+' existing task types match native selector translations',async()=>{
    const schema='qa_task_type_memory_'+locale,rows=TYPES.map((type,index)=>({id:'33333333-3333-4333-8333-33333333333'+(index+1),lead_id:LEAD,title:'Synthetic task type '+type,type,status:'pending',due_at:null}));
    const observed:any={locale,source:'real_page_NextIntl_controller_TasksService_GET_strict_memory',requests:[],sql:[],redis:[],returnedRows:null,expectedLabels:null,displayedRows:null,html:null,boundaryErrors:[],error:null};
    let root:any,container:HTMLDivElement|undefined;const initialBoundary=boundaryErrors.length;for(const fn of Object.values(router))fn.mockClear();
    try{
        const adapter={executeInTenantSchema:async(requestSchema:string,sql:string,params:any[])=>{
            if(requestSchema!==schema)return unexpected('Foreign memory schema');const compact=sql.replace(/\s+/g,' ').trim();observed.sql.push({sql:compact,params:structuredClone(params)});
            if(compact!=='SELECT * FROM tasks WHERE 1=1 AND lead_id = $1::uuid ORDER BY due_at ASC NULLS LAST'||JSON.stringify(params)!==JSON.stringify([LEAD]))return unexpected('Unexpected SQL/write');
            return structuredClone(rows);
        }};
        const redis={get:async(key:string)=>{observed.redis.push(key);if(key!=='tenant:'+TENANT+':schema')return unexpected('Unexpected Redis key');return schema;}};
        const service=new TasksService(adapter as any,redis as any),controller=new CrmController(unused('leads'),unused('opportunities'),unused('catalog'),unused('notes'),service,unused('activity'),unused('scoring'),unused('customAttrs'),unused('segments'),unused('importExport'),unused('analytics'),unused('insights'),unused('prisma'),unused('throttle'),unused('pipeline'));
        const profile={lead:{id:LEAD,contact_id:null,first_name:'Synthetic',last_name:'Task',stage:'nuevo',score:0,phone:null},opportunities:[],tags:[],resolved:{kind:'lead',leadId:LEAD,contactId:null}};
        api.getStages.mockReset().mockImplementation(async(tenant:string)=>{if(tenant!==TENANT)return unexpected('Foreign stages tenant');return {success:true,data:[]};});
        api.fetch.mockReset().mockImplementation(async(route:string,options:any={})=>{
            const method=options.method||'GET';observed.requests.push({route,method});if(method!=='GET')return unexpected('Unapproved write API');
            if(route==='/crm/tasks/'+TENANT+'?leadId='+LEAD){const result=await controller.getTasks(TENANT,LEAD);observed.returnedRows=structuredClone(result.data);return result;}
            if(route==='/crm/leads/'+TENANT+'/'+LEAD)return {success:true,data:profile};
            if(['/crm/timeline/'+TENANT+'/'+LEAD,'/crm/notes/'+TENANT+'/'+LEAD,'/crm/custom-attributes/'+TENANT+'?entityType=lead'].includes(route))return {success:true,data:[]};
            if(route==='/crm/leads/'+TENANT+'/'+LEAD+'/score')return {success:true,data:{factors:{}}};
            return unexpected('Unexpected UI API '+route);
        });
        const messages=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../dashboard/messages',locale+'.json'),'utf8')),labels=messages.contacts.leadDetail.taskTypes;
        for(const type of TYPES)if(typeof labels[type]!=='string'||!labels[type].trim())throw new Error('Missing translated native type '+type);observed.expectedLabels=structuredClone(labels);
        container=dom.window.document.createElement('div');container.dataset.caseOwned=locale;dom.window.document.body.appendChild(container);root=createRoot(container);
        await act(async()=>root.render(createElement(NextIntlClientProvider,{locale,messages,timeZone:'America/Bogota'},createElement(Page))));
        const tabLabel=messages.contacts.leadDetail.tabTasks.replace('{count}','5');await waitFor(()=>container!.textContent!.includes(tabLabel),'profile plus five existing task rows loaded');
        const tab=Array.from(container.querySelectorAll('button')).find(b=>b.textContent?.includes(tabLabel));if(!tab)throw new Error('Native Tasks tab missing');await act(async()=>tab.click());
        const select=container.querySelector('input[type="datetime-local"]')?.parentElement?.querySelector('select');if(!select)throw new Error('Native task selector prerequisite missing');
        const options=Array.from(select.options).map(o=>({value:o.value,label:o.textContent}));if(JSON.stringify(options.map(o=>o.value))!==JSON.stringify(TYPES))throw new Error('Native admitted types mismatch');for(const option of options)if(option.label!==labels[option.value])throw new Error('Independent selector translation prerequisite mismatch');
        const displayed=rows.map(task=>{const titleNode=Array.from(container!.querySelectorAll('div')).filter(el=>el.childElementCount===0&&el.textContent===task.title);if(titleNode.length!==1)throw new Error('Unique visible task title prerequisite');const label=titleNode[0].nextElementSibling?.querySelector('span');if(!label)throw new Error('Task row type span prerequisite');return{id:task.id,title:task.title,type:task.type,label:label.textContent};});
        observed.displayedRows=displayed;observed.html=container.innerHTML;observed.boundaryErrors=boundaryErrors.slice(initialBoundary);dump(locale+'-observed.json',observed);
        // Positive list/translation/scope controls before the first product oracle.
        expect(observed.boundaryErrors).toEqual([]);expect(observed.returnedRows).toEqual(rows);expect(displayed).toHaveLength(5);expect(displayed.map(row=>row.title)).toEqual(rows.map(row=>row.title));expect(observed.sql).toHaveLength(1);expect(observed.requests.every((r:any)=>r.method==='GET')).toBe(true);
        expect(displayed[0].label).toBe(labels.follow_up);
        for(const row of displayed.slice(1))expect(row.label).toBe(labels[row.type]);
        expect(router.push).not.toHaveBeenCalled();expect(router.replace).not.toHaveBeenCalled();
    }catch(error){observed.error=String((error as Error).stack||error);if(!fs.existsSync(path.join(OUT!,locale+'-observed.json')))dump(locale+'-observed.json',observed);throw error;
    }finally{
        if(root)await act(async()=>root.unmount());if(container)container.remove();dump(locale+'-cleanup.json',{ownContainerRemoved:!container?.isConnected,remainingOwnedContainers:dom.window.document.querySelectorAll('[data-case-owned]').length,boundaryErrors:boundaryErrors.slice(initialBoundary),navigation:Object.values(router).map(fn=>fn.mock.calls.length),writes:observed.requests.filter((r:any)=>r.method!=='GET').length,timerInventoryMeasured:false});
    }
},15000);
