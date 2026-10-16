/** @jest-environment node */
// PREPARED ONLY: initial existing macro edit button name; no activation.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
const OUT=process.env.MACROS_EDIT_NAME_EVIDENCE_DIR;
if(!OUT||!path.isAbsolute(OUT))throw new Error('Exclusive evidence directory required');
const dump=(name:string,value:unknown)=>fs.writeFileSync(path.join(OUT!,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const tenantId='11111111-1111-4111-8111-111111111111';
const user=Object.freeze({id:'22222222-2222-4222-8222-222222222222',role:'tenant_admin',tenantId});
const fixture=Object.freeze({id:'33333333-3333-4333-8333-333333333333',name:'Owned synthetic macro 25',description:'Owned synthetic description 25',visibility:'team',actions:[{type:'tag',config:{tagName:'synthetic25'}},{type:'add_note',config:{content:'Synthetic only, never executed'}}]});
const boundaryErrors:string[]=[],apiCalls:Array<{method:string;args:unknown[]}>=[];
function unexpected(message:string):never{boundaryErrors.push(message);throw new Error(message);}
jest.mock('@/contexts/AuthContext',()=>({__esModule:true,useAuth:()=>({user})}));
jest.mock('@/contexts/TenantContext',()=>({__esModule:true,useTenant:()=>({activeTenantId:tenantId})}));
jest.mock('@/lib/api',()=>({__esModule:true,api:new Proxy({},{get(_target,key){return async(...args:unknown[])=>{const method=String(key);apiCalls.push({method,args});if(method!=='getMacros'||args.length!==1||args[0]!==tenantId)return unexpected('Unapproved API '+method);return{success:true,data:[JSON.parse(JSON.stringify(fixture))]};};}})}));
let dom:JSDOM,Page:any,NextIntlClientProvider:any,createRoot:any,axe:any;
const globalKeys=['window','document','navigator','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent','HTMLInputElement','HTMLSelectElement','localStorage','IS_REACT_ACT_ENVIRONMENT','fetch','XMLHttpRequest','WebSocket','EventSource','confirm'];
const prior=new Map<string,PropertyDescriptor|undefined>();
beforeAll(async()=>{
 dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1/'});
 for(const key of globalKeys){prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));const blocked=['fetch','XMLHttpRequest','WebSocket','EventSource','confirm'].includes(key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:blocked?function(){return unexpected('Unapproved browser boundary '+key);}:(dom.window as any)[key]});}
 for(const key of ['fetch','XMLHttpRequest','WebSocket','EventSource','confirm'])Object.defineProperty(dom.window,key,{configurable:true,writable:true,value:(globalThis as any)[key]});
 const axeModule=await import('axe-core');axe=axeModule.default||axeModule;
 ({createRoot}=await import('react-dom/client'));({NextIntlClientProvider}=await import('next-intl'));const pageSpecifier='./'+'page';Page=(await import(pageSpecifier)).default;
});
afterAll(()=>{dom?.window.close();for(const key of globalKeys){const old=prior.get(key);if(old)Object.defineProperty(globalThis,key,old);else delete(globalThis as any)[key];}});
for(const locale of ['es','en','pt','fr'])it(locale+' existing macro edit button has an accessible name',async()=>{
 const observed:any={locale,source:'real_MacrosPage_NextIntl_HelpPanel_synthetic_context_one_memory_read',macro:null,edit:null,accessibility:null,html:null,controlsPassedBeforeOracle:false,error:null};
 const startApi=apiCalls.length,startBoundary=boundaryErrors.length,activations:string[]=[];
 const recordActivation=(event:Event)=>activations.push(event.type);for(const type of ['click','input','change','submit'])dom.window.document.addEventListener(type,recordActivation,true);
 let root:any,container:HTMLDivElement|undefined;
 try{
  const messages=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../../messages',locale+'.json'),'utf8')),copy=messages.settings.macrosPage;
  container=dom.window.document.createElement('div');container.dataset.caseOwned=locale;dom.window.document.body.appendChild(container);root=createRoot(container);
  await act(async()=>root.render(createElement(NextIntlClientProvider,{locale,messages,timeZone:'America/Bogota'},createElement(Page))));
  const names=Array.from(container.querySelectorAll('div')).filter(node=>node.children.length===0&&node.textContent===fixture.name);if(container.querySelector('h1')?.textContent?.trim()!==copy.title||names.length!==1)throw new Error('Prerequisite: translated H1 and exactly one own macro name');
  const row=names[0].parentElement?.parentElement?.parentElement;if(!row)throw new Error('Prerequisite: own macro row');
  const edits=Array.from(row.querySelectorAll('button')).filter(button=>button.querySelector('svg.lucide-pencil')),deletes=Array.from(row.querySelectorAll('button')).filter(button=>button.querySelector('svg.lucide-trash2'));
  const spans=Array.from(row.querySelectorAll('span'));const expectedCount=copy.actionsCount.replace('{count}','2');
  if(!row.textContent?.includes(fixture.description)||!spans.some(s=>s.textContent?.trim()===copy.visibility.team)||!spans.some(s=>s.textContent?.trim()===expectedCount)||edits.length!==1||deletes.length!==1||edits[0].disabled||container.querySelector('h2'))throw new Error('Prerequisite: own description/team/actions2, exactly one native edit and delete, enabled edit, closed editor');
  const calls=apiCalls.slice(startApi);if(calls.length!==1||calls[0].method!=='getMacros'||JSON.stringify(calls[0].args)!==JSON.stringify([tenantId])||boundaryErrors.length!==startBoundary||activations.length)throw new Error('Prerequisite: one strict memory read/zero activations/boundary');
  const edit=edits[0];observed.macro={name:fixture.name,description:fixture.description,rowHtml:row.outerHTML,actionsCount:expectedCount,visibility:copy.visibility.team};observed.edit={html:edit.outerHTML,text:edit.textContent,type:edit.type,disabled:edit.disabled,ariaLabel:edit.getAttribute('aria-label'),ariaLabelledby:edit.getAttribute('aria-labelledby'),title:edit.getAttribute('title')};observed.controlsPassedBeforeOracle=true;
  const result=await axe.run({include:[edit]},{runOnly:['button-name']});observed.accessibility={scope:'owned existing macro edit button ONLY',rule:'button-name',version:axe.version,violations:result.violations,passes:result.passes,incomplete:result.incomplete};observed.html=container.innerHTML;observed.apiCalls=apiCalls.slice(startApi);observed.boundaryErrors=boundaryErrors.slice(startBoundary);observed.activations=[...activations];dump(locale+'-observed.json',observed);
  if(result.incomplete.length||apiCalls.length!==startApi+1||boundaryErrors.length!==startBoundary||activations.length)throw new Error('Prerequisite: complete scoped axe and zero effects');
  // FIRST product oracle. Delete/create/modal/configuration are not certified.
  expect(result.violations).toEqual([]);
 }catch(error){observed.error=String((error as Error).stack||error);if(!fs.existsSync(path.join(OUT!,locale+'-observed.json')))dump(locale+'-observed.json',observed);throw error;}
 finally{if(root)await act(async()=>root.unmount());if(container)container.remove();for(const type of ['click','input','change','submit'])dom.window.document.removeEventListener(type,recordActivation,true);dump(locale+'-cleanup.json',{ownContainerRemoved:!container?.isConnected,remainingOwnedContainers:dom.window.document.querySelectorAll('[data-case-owned]').length,apiCalls:apiCalls.slice(startApi),boundaryErrors:boundaryErrors.slice(startBoundary),activations,timerInventoryMeasured:false});}
},15000);
