/** @jest-environment node */
// PREPARED ONLY. Initial Contact selection, no entity activation or CRUD.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
const OUT=process.env.CUSTOM_ATTRIBUTES_ENTITY_EVIDENCE_DIR;
if(!OUT||!path.isAbsolute(OUT))throw new Error('Exclusive evidence directory required');
const dump=(name:string,value:unknown)=>fs.writeFileSync(path.join(OUT!,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const tenantId='11111111-1111-4111-8111-111111111111';
const user=Object.freeze({id:'22222222-2222-4222-8222-222222222222',role:'tenant_admin',tenantId});
const fixture=Object.freeze({id:'44444444-4444-4444-8444-444444444444',entity_type:'contact',attribute_key:'owned_synthetic_27',label:'Owned synthetic attribute 27',data_type:'text',is_required:true,options:null});
const boundaryErrors:string[]=[],apiCalls:Array<{method:string;args:unknown[]}>=[],navigationCalls:Array<{method:string;args:unknown[]}>=[];
function unexpected(message:string):never{boundaryErrors.push(message);throw new Error(message);}
jest.mock('@/contexts/AuthContext',()=>({__esModule:true,useAuth:()=>({user})}));
jest.mock('@/contexts/TenantContext',()=>({__esModule:true,useTenant:()=>({activeTenantId:tenantId})}));
jest.mock('next/navigation',()=>({__esModule:true,useRouter:()=>new Proxy({},{get(_target,key){return(...args:unknown[])=>{navigationCalls.push({method:String(key),args});return unexpected('Unapproved router '+String(key));};}})}));
jest.mock('@/lib/api',()=>({__esModule:true,api:new Proxy({},{get(_target,key){return async(...args:unknown[])=>{const method=String(key);apiCalls.push({method,args});if(method==='getCustomAttributes'&&args.length===2&&args[0]===tenantId&&args[1]==='contact')return{success:true,data:[JSON.parse(JSON.stringify(fixture))]};if(method==='getPlanFeatures'&&args.length===1&&args[0]===tenantId)return{success:true,data:{customAttributes:10}};return unexpected('Unapproved API '+method);};}})}));
let dom:JSDOM,Page:any,NextIntlClientProvider:any,createRoot:any;
const globalKeys=['window','document','navigator','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent','HTMLInputElement','HTMLSelectElement','localStorage','IS_REACT_ACT_ENVIRONMENT','fetch','XMLHttpRequest','WebSocket','EventSource','confirm'];
const prior=new Map<string,PropertyDescriptor|undefined>();
beforeAll(async()=>{
 dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1/'});
 for(const key of globalKeys){prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));const blocked=['fetch','XMLHttpRequest','WebSocket','EventSource','confirm'].includes(key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:blocked?function(){return unexpected('Unapproved browser boundary '+key);}:(dom.window as any)[key]});}
 for(const key of ['fetch','XMLHttpRequest','WebSocket','EventSource','confirm'])Object.defineProperty(dom.window,key,{configurable:true,writable:true,value:(globalThis as any)[key]});
 ({createRoot}=await import('react-dom/client'));({NextIntlClientProvider}=await import('next-intl'));const pageSpecifier='./'+'page';Page=(await import(pageSpecifier)).default;
});
afterAll(()=>{dom?.window.close();for(const key of globalKeys){const old=prior.get(key);if(old)Object.defineProperty(globalThis,key,old);else delete(globalThis as any)[key];}});
for(const locale of ['es','en','pt','fr'])it(locale+' initial Contact entity selection exposes its programmatic state',async()=>{
 const observed:any={locale,source:'real_CustomAttributesPage_usePlanLimits_UpgradeBanner_NextIntl_HelpPanel_synthetic_context_two_memory_reads',entityKeys:['contact','lead','company','conversation'],options:null,programmaticState:null,row:null,html:null,controlsPassedBeforeOracle:false,error:null};
 const startApi=apiCalls.length,startBoundary=boundaryErrors.length,startNavigation=navigationCalls.length,activations:string[]=[];
 const recordActivation=(event:Event)=>activations.push(event.type);for(const type of ['click','input','change','submit'])dom.window.document.addEventListener(type,recordActivation,true);
 let root:any,container:HTMLDivElement|undefined;
 try{
  const messages=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../../messages',locale+'.json'),'utf8')),copy=messages.settings.customAttributesPage;
  container=dom.window.document.createElement('div');container.dataset.caseOwned=locale;dom.window.document.body.appendChild(container);root=createRoot(container);
  await act(async()=>root.render(createElement(NextIntlClientProvider,{locale,messages,timeZone:'America/Bogota'},createElement(Page))));
  if(container.querySelector('h1')?.textContent?.trim()!==copy.title||container.querySelector('h2'))throw new Error('Prerequisite: translated H1 and closed editor');
  const keys=['contact','lead','company','conversation'];
  const buttons=keys.map(key=>{const matches=Array.from(container!.querySelectorAll('button')).filter(b=>b.textContent?.trim()===copy.entityTypes[key]);if(matches.length!==1)throw new Error('Prerequisite: unique native translated entity '+key);return matches[0];});
  const group=buttons[0].parentElement;if(!group||buttons.some(b=>b.parentElement!==group||b.disabled)||group.querySelectorAll('button').length!==4)throw new Error('Prerequisite: four enabled entity buttons in own group');
  const selected=buttons.map(b=>b.classList.contains('bg-primary/20')&&b.classList.contains('border-primary/40'));if(JSON.stringify(selected)!==JSON.stringify([true,false,false,false]))throw new Error('Prerequisite: Contact selected visually, other entities unselected');
  const rows=Array.from(container.querySelectorAll('tbody tr'));if(rows.length!==1)throw new Error('Prerequisite: one own attribute row');const cells=Array.from(rows[0].querySelectorAll('td')).map(td=>td.textContent?.trim());
  if(JSON.stringify(cells.slice(0,5))!==JSON.stringify([fixture.attribute_key,fixture.label,copy.dataTypes.text,messages.common.yes,'—']))throw new Error('Prerequisite: own contact text/required attribute row');
  const headers=Array.from(container.querySelectorAll('thead th')).map(th=>th.textContent?.trim());if(JSON.stringify(headers)!==JSON.stringify(['key','label','type','required','options','actions'].map(k=>copy.table[k])))throw new Error('Prerequisite: six translated table headers');
  const allButtons=Array.from(container.querySelectorAll('button')),creates=allButtons.filter(b=>b.textContent?.trim()===copy.newAttribute);if(creates.length!==1||creates[0].disabled||allButtons.some(b=>b.textContent?.trim()===messages.billingPage.upgradePlan))throw new Error('Prerequisite: creation enabled below synthetic plan limit, no upgrade banner');
  const calls=apiCalls.slice(startApi),attrs=calls.filter(c=>c.method==='getCustomAttributes'),plans=calls.filter(c=>c.method==='getPlanFeatures');
  if(calls.length!==2||attrs.length!==1||plans.length!==1||JSON.stringify(attrs[0].args)!==JSON.stringify([tenantId,'contact'])||JSON.stringify(plans[0].args)!==JSON.stringify([tenantId])||boundaryErrors.length!==startBoundary||navigationCalls.length!==startNavigation||activations.length)throw new Error('Prerequisite: exactly two strict memory reads, zero effects');
  observed.row={html:rows[0].outerHTML,cells,headers};observed.options=buttons.map((button,index)=>({key:keys[index],label:copy.entityTypes[keys[index]],selectedClass:selected[index],role:button.getAttribute('role'),pressed:button.getAttribute('aria-pressed'),selected:button.getAttribute('aria-selected'),checked:button.getAttribute('aria-checked'),current:button.getAttribute('aria-current'),html:button.outerHTML}));
  const toggleState=buttons.every((b,i)=>(b.getAttribute('role')===null||b.getAttribute('role')==='button')&&b.getAttribute('aria-pressed')===String(i===0));
  const tablist=buttons[0].closest('[role="tablist"]'),tabState=!!tablist&&buttons.every((b,i)=>b.closest('[role="tablist"]')===tablist&&b.getAttribute('role')==='tab'&&b.getAttribute('aria-selected')===String(i===0));
  const radioGroup=buttons[0].closest('[role="radiogroup"]'),radioState=!!radioGroup&&buttons.every((b,i)=>b.closest('[role="radiogroup"]')===radioGroup&&b.getAttribute('role')==='radio'&&b.getAttribute('aria-checked')===String(i===0));
  const currentState=buttons.every((b,i)=>i===0?['true','page'].includes(b.getAttribute('aria-current')||''):[null,'false'].includes(b.getAttribute('aria-current')));
  observed.programmaticState={toggleState,tabState,radioState,currentState,exposedSelectionMatchesContact:toggleState||tabState||radioState||currentState};observed.controlsPassedBeforeOracle=true;observed.html=container.innerHTML;observed.apiCalls=calls;observed.boundaryErrors=boundaryErrors.slice(startBoundary);observed.navigationCalls=navigationCalls.slice(startNavigation);observed.activations=[...activations];dump(locale+'-observed.json',observed);
  // FIRST product oracle. No interaction, plan enforcement, CRUD, focus or real AT claim.
  expect(observed.programmaticState.exposedSelectionMatchesContact).toEqual(true);
 }catch(error){observed.error=String((error as Error).stack||error);if(!fs.existsSync(path.join(OUT!,locale+'-observed.json')))dump(locale+'-observed.json',observed);throw error;}
 finally{if(root)await act(async()=>root.unmount());if(container)container.remove();for(const type of ['click','input','change','submit'])dom.window.document.removeEventListener(type,recordActivation,true);dump(locale+'-cleanup.json',{ownContainerRemoved:!container?.isConnected,remainingOwnedContainers:dom.window.document.querySelectorAll('[data-case-owned]').length,apiCalls:apiCalls.slice(startApi),boundaryErrors:boundaryErrors.slice(startBoundary),navigationCalls:navigationCalls.slice(startNavigation),activations,timerInventoryMeasured:false});}
},15000);
