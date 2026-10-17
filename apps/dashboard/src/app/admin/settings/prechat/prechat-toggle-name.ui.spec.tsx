/** @jest-environment node */
// PREPARED ONLY. Name of initial Form active button; no activation/save.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
const OUT=process.env.PRECHAT_TOGGLE_NAME_EVIDENCE_DIR;
if(!OUT||!path.isAbsolute(OUT))throw new Error('Exclusive evidence directory required');
const dump=(name:string,value:unknown)=>fs.writeFileSync(path.join(OUT!,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const tenantId='11111111-1111-4111-8111-111111111111';
const user=Object.freeze({id:'22222222-2222-4222-8222-222222222222',role:'tenant_admin',tenantId});
const endpoint='/conversations/prechat-form/'+tenantId;
const fixture=Object.freeze({is_active:false,greeting_message:'Owned synthetic prechat greeting 30',fields:[{key:'owned_email_30',label:'Owned synthetic email 30',type:'email',required:true,options:[],map_to:'contact.email'}]});
const boundaryErrors:string[]=[],apiCalls:Array<{method:string;args:unknown[]}>=[],navigationCalls:Array<{method:string;args:unknown[]}>=[];
function unexpected(message:string):never{boundaryErrors.push(message);throw new Error(message);}
jest.mock('@/contexts/AuthContext',()=>({__esModule:true,useAuth:()=>({user})}));
jest.mock('@/contexts/TenantContext',()=>({__esModule:true,useTenant:()=>({activeTenantId:tenantId})}));
jest.mock('next/navigation',()=>({__esModule:true,usePathname:()=>'/admin/settings/prechat',useRouter:()=>new Proxy({},{get(_target,key){return(...args:unknown[])=>{navigationCalls.push({method:String(key),args});return unexpected('Unapproved router '+String(key));};}})}));
jest.mock('@/lib/api',()=>({__esModule:true,api:new Proxy({},{get(_target,key){return async(...args:unknown[])=>{const method=String(key);apiCalls.push({method,args});if(method!=='fetch'||args.length!==1||args[0]!==endpoint)return unexpected('Unapproved API '+method);return{success:true,data:JSON.parse(JSON.stringify(fixture))};};}})}));
let dom:JSDOM,Page:any,NextIntlClientProvider:any,createRoot:any,axe:any;
const blockedKeys=['fetch','XMLHttpRequest','WebSocket','EventSource','BroadcastChannel','Worker','SharedWorker','confirm','open'];
const globalKeys=['window','document','navigator','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','localStorage','IS_REACT_ACT_ENVIRONMENT',...blockedKeys];
const prior=new Map<string,PropertyDescriptor|undefined>();
beforeAll(async()=>{
 dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1/'});
 for(const key of globalKeys){prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:blockedKeys.includes(key)?function(){return unexpected('Unapproved browser boundary '+key);}:(dom.window as any)[key]});}
 for(const key of blockedKeys)Object.defineProperty(dom.window,key,{configurable:true,writable:true,value:(globalThis as any)[key]});
 Object.defineProperty(dom.window.navigator,'sendBeacon',{configurable:true,value:()=>unexpected('Unapproved browser boundary sendBeacon')});
 const axeModule=await import('axe-core');axe=axeModule.default||axeModule;
 ({createRoot}=await import('react-dom/client'));({NextIntlClientProvider}=await import('next-intl'));const pageSpecifier='./'+'page';Page=(await import(pageSpecifier)).default;
});
afterAll(()=>{dom?.window.close();for(const key of globalKeys){const old=prior.get(key);if(old)Object.defineProperty(globalThis,key,old);else delete(globalThis as any)[key];}});
for(const locale of ['es','en','pt','fr'])it(locale+' initial prechat Form active button has an accessible name',async()=>{
 const observed:any={locale,source:'real_PrechatPage_PageHeader_NavigationPageContext_HelpPanel_NextIntl_synthetic_context_one_memory_read',toggle:null,accessibility:null,html:null,controlsPassedBeforeOracle:false,error:null};
 const startApi=apiCalls.length,startBoundary=boundaryErrors.length,startNavigation=navigationCalls.length,activations:string[]=[];
 const recordActivation=(event:Event)=>activations.push(event.type);for(const type of ['click','input','change','submit'])dom.window.document.addEventListener(type,recordActivation,true);
 let root:any,container:HTMLDivElement|undefined;
 try{
  const messages=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../../messages',locale+'.json'),'utf8')),copy=messages.prechatPage;
  for(const key of ['title','formActive','formActiveDesc','formDisabled'])if(typeof copy[key]!=='string'||!copy[key].trim())throw new Error('Prerequisite: translated '+key);
  container=dom.window.document.createElement('div');container.dataset.caseOwned=locale;dom.window.document.body.appendChild(container);root=createRoot(container);
  await act(async()=>root.render(createElement(NextIntlClientProvider,{locale,messages,timeZone:'America/Bogota'},createElement(Page))));
  if(container.querySelector('h1')?.textContent?.trim()!==copy.title||container.querySelector('[role="alert"]'))throw new Error('Prerequisite: translated H1 and successful configuration read');
  const labels=Array.from(container.querySelectorAll('div')).filter(node=>node.children.length===0&&node.textContent?.trim()===copy.formActive);
  if(labels.length!==1)throw new Error('Prerequisite: one own Form active label');const panel=labels[0].parentElement?.parentElement;
  if(!panel||!Array.from(panel.querySelectorAll('div')).some(n=>n.children.length===0&&n.textContent?.trim()===copy.formActiveDesc))throw new Error('Prerequisite: exact own active panel description');
  const buttons=Array.from(panel.querySelectorAll('button'));if(buttons.length!==1||buttons[0].disabled)throw new Error('Prerequisite: one enabled native button in own active panel');const toggle=buttons[0];
  const cssTargets=Array.from(container.querySelectorAll('button.w-11.h-6'));if(cssTargets.length!==1||cssTargets[0]!==toggle||!toggle.classList.contains('bg-neutral-300')||toggle.classList.contains('bg-indigo-500'))throw new Error('Prerequisite: unique same-node active toggle CSS initially off');
  const ownInputs=Array.from(container.querySelectorAll('input')).filter(input=>input.value===fixture.fields[0].label);
  if(container.querySelector('textarea')?.value!==fixture.greeting_message||ownInputs.length!==1||!Array.from(container.querySelectorAll('div')).some(n=>n.children.length===0&&n.textContent?.trim()===copy.formDisabled))throw new Error('Prerequisite: saved synthetic greeting/own field and inactive preview');
  const calls=apiCalls.slice(startApi);if(calls.length!==1||calls[0].method!=='fetch'||JSON.stringify(calls[0].args)!==JSON.stringify([endpoint])||boundaryErrors.length!==startBoundary||navigationCalls.length!==startNavigation||activations.length)throw new Error('Prerequisite: one strict memory read/zero effects');
  observed.panelHtml=panel.outerHTML;observed.toggle={html:toggle.outerHTML,text:toggle.textContent,type:toggle.type,disabled:toggle.disabled,ariaLabel:toggle.getAttribute('aria-label'),ariaLabelledby:toggle.getAttribute('aria-labelledby'),title:toggle.getAttribute('title')};observed.controlsPassedBeforeOracle=true;
  const result=await axe.run({include:[toggle]},{runOnly:['button-name']});observed.accessibility={scope:'own initial prechat active toggle ONLY',rule:'button-name',version:axe.version,violations:result.violations,passes:result.passes,incomplete:result.incomplete};observed.html=container.innerHTML;observed.apiCalls=apiCalls.slice(startApi);observed.boundaryErrors=boundaryErrors.slice(startBoundary);observed.navigationCalls=navigationCalls.slice(startNavigation);observed.activations=[...activations];dump(locale+'-observed.json',observed);
  if(result.incomplete.length||apiCalls.length!==startApi+1||boundaryErrors.length!==startBoundary||navigationCalls.length!==startNavigation||activations.length)throw new Error('Prerequisite: complete scoped axe and zero effects');
  // FIRST product oracle. Initial state/actions/other controls are not certified.
  expect(result.violations).toEqual([]);
 }catch(error){observed.error=String((error as Error).stack||error);if(!fs.existsSync(path.join(OUT!,locale+'-observed.json')))dump(locale+'-observed.json',observed);throw error;}
 finally{if(root)await act(async()=>root.unmount());if(container)container.remove();for(const type of ['click','input','change','submit'])dom.window.document.removeEventListener(type,recordActivation,true);dump(locale+'-cleanup.json',{ownContainerRemoved:!container?.isConnected,remainingOwnedContainers:dom.window.document.querySelectorAll('[data-case-owned]').length,apiCalls:apiCalls.slice(startApi),boundaryErrors:boundaryErrors.slice(startBoundary),navigationCalls:navigationCalls.slice(startNavigation),activations,timerInventoryMeasured:false});}
},15000);
