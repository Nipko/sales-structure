/** @jest-environment node */
// PREPARED ONLY. Initial native SSO default-role select name; no changes/actions.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
const OUT=process.env.SECURITY_SSO_ROLE_EVIDENCE_DIR;
if(!OUT||!path.isAbsolute(OUT))throw new Error('Exclusive evidence directory required');
const dump=(name:string,value:unknown)=>fs.writeFileSync(path.join(OUT!,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const tenantId='11111111-1111-4111-8111-111111111111';
const user=Object.freeze({id:'22222222-2222-4222-8222-222222222222',role:'tenant_admin',tenantId,hasPassword:true});
const ssoFixture=Object.freeze({tenantId,enabled:false,idpEntityId:'urn:owned:qa:sso:31',idpSsoUrl:'https://idp.example.invalid/owned31',idpCertificate:'***CONFIGURED***',emailDomains:['owned31.example.invalid'],forceSso:false,defaultRole:'tenant_supervisor'});
const boundaryErrors:string[]=[],apiCalls:Array<{method:string;args:unknown[]}>=[],navigationCalls:Array<{method:string;args:unknown[]}>=[];
function unexpected(message:string):never{boundaryErrors.push(message);throw new Error(message);}
jest.mock('@/contexts/AuthContext',()=>({__esModule:true,useAuth:()=>({user})}));
jest.mock('next/navigation',()=>({__esModule:true,usePathname:()=>'/admin/settings/security',useRouter:()=>new Proxy({},{get(_target,key){return(...args:unknown[])=>{navigationCalls.push({method:String(key),args});return unexpected('Unapproved router '+String(key));};}})}));
jest.mock('@/lib/api',()=>({__esModule:true,api:new Proxy({},{get(_target,key){return async(...args:unknown[])=>{const method=String(key);apiCalls.push({method,args});if(args.length)return unexpected('Unapproved API arguments '+method);if(method==='getSsoConfig')return{success:true,data:JSON.parse(JSON.stringify(ssoFixture))};if(method==='get2FAStatus')return{success:true,data:{enabled:false}};if(method==='listTrustedDevices')return{success:true,data:[]};return unexpected('Unapproved API '+method);};}})}));
let dom:JSDOM,Page:any,NextIntlClientProvider:any,createRoot:any,axe:any;
const blockedKeys=['fetch','XMLHttpRequest','WebSocket','EventSource','BroadcastChannel','Worker','SharedWorker','confirm','open'];
const globalKeys=['window','document','navigator','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','localStorage','IS_REACT_ACT_ENVIRONMENT',...blockedKeys];
const prior=new Map<string,PropertyDescriptor|undefined>();
beforeAll(async()=>{
 dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1/'});
 for(const key of globalKeys){prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:blockedKeys.includes(key)?function(){return unexpected('Unapproved browser boundary '+key);}:(dom.window as any)[key]});}
 for(const key of blockedKeys)Object.defineProperty(dom.window,key,{configurable:true,writable:true,value:(globalThis as any)[key]});
 Object.defineProperty(dom.window.navigator,'sendBeacon',{configurable:true,value:()=>unexpected('Unapproved browser boundary sendBeacon')});
 Object.defineProperty(dom.window.navigator,'clipboard',{configurable:true,value:{writeText:()=>unexpected('Unapproved clipboard write'),readText:()=>unexpected('Unapproved clipboard read')}});
 Object.defineProperty(dom.window.document,'execCommand',{configurable:true,value:()=>unexpected('Unapproved document execCommand')});
 const axeModule=await import('axe-core');axe=axeModule.default||axeModule;
 ({createRoot}=await import('react-dom/client'));({NextIntlClientProvider}=await import('next-intl'));const pageSpecifier='./'+'page';Page=(await import(pageSpecifier)).default;
});
afterAll(()=>{dom?.window.close();for(const key of globalKeys){const old=prior.get(key);if(old)Object.defineProperty(globalThis,key,old);else delete(globalThis as any)[key];}});
for(const locale of ['es','en','pt','fr'])it(locale+' initial SSO default-role select has an accessible name',async()=>{
 const observed:any={locale,source:'real_SecurityPage_SsoSettings_PageHeader_NavigationPageContext_HelpPanel_NextIntl_synthetic_auth_three_memory_reads',select:null,accessibility:null,html:null,controlsPassedBeforeOracle:false,error:null};
 const startApi=apiCalls.length,startBoundary=boundaryErrors.length,startNavigation=navigationCalls.length,activations:string[]=[];
 const recordActivation=(event:Event)=>activations.push(event.type);for(const type of ['click','input','change','submit'])dom.window.document.addEventListener(type,recordActivation,true);
 let root:any,container:HTMLDivElement|undefined;
 try{
  const messages=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../../messages',locale+'.json'),'utf8')),security=messages.settings.securityPage,copy=security.sso;
  for(const key of ['title','desc','defaultRole','defaultRoleDesc','roleAgent','roleSupervisor','roleAdmin'])if(typeof copy[key]!=='string'||!copy[key].trim())throw new Error('Prerequisite: translated SSO '+key);
  container=dom.window.document.createElement('div');container.dataset.caseOwned=locale;dom.window.document.body.appendChild(container);root=createRoot(container);
  await act(async()=>root.render(createElement(NextIntlClientProvider,{locale,messages,timeZone:'America/Bogota'},createElement(Page))));
  if(container.querySelector('h1')?.textContent?.trim()!==security.title||container.querySelector('[role="alert"]'))throw new Error('Prerequisite: real translated H1, no load error');
  const headings=Array.from(container.querySelectorAll('h2')).filter(n=>n.textContent?.trim()===copy.title);if(headings.length!==1)throw new Error('Prerequisite: one SSO heading');const panel=headings[0].parentElement?.parentElement?.parentElement;
  if(!panel||!Array.from(panel.querySelectorAll('p')).some(n=>n.textContent?.trim()===copy.desc))throw new Error('Prerequisite: own SSO panel and description');
  const selects=Array.from(panel.querySelectorAll('select'));if(selects.length!==1||container.querySelectorAll('select').length!==1||selects[0].disabled)throw new Error('Prerequisite: unique enabled native SSO select');const select=selects[0],group=select.parentElement!;
  if(!Array.from(group.querySelectorAll('label')).some(n=>n.textContent?.trim()===copy.defaultRole)||!Array.from(group.querySelectorAll('p')).some(n=>n.textContent?.trim()===copy.defaultRoleDesc))throw new Error('Prerequisite: own visible role label and hint');
  const options=Array.from(select.options).map(o=>({value:o.value,label:o.textContent?.trim(),selected:o.selected}));const expected=[{value:'tenant_agent',label:copy.roleAgent,selected:false},{value:'tenant_supervisor',label:copy.roleSupervisor,selected:true},{value:'tenant_admin',label:copy.roleAdmin,selected:false}];if(JSON.stringify(options)!==JSON.stringify(expected)||select.value!==ssoFixture.defaultRole||select.selectedIndex!==1)throw new Error('Prerequisite: three translated options and saved nondefault supervisor value');
  const inputs=Array.from(panel.querySelectorAll('input'));for(const value of [ssoFixture.idpEntityId,ssoFixture.idpSsoUrl,ssoFixture.emailDomains.join(', ')])if(inputs.filter(n=>n.value===value).length!==1)throw new Error('Prerequisite: saved own SSO fields loaded');
  if(panel.querySelector('textarea')?.value!==''||!Array.from(panel.querySelectorAll('button')).some(b=>b.textContent?.trim()===messages.common.save&&!b.disabled))throw new Error('Prerequisite: certificate sentinel omitted, Save enabled without activation');
  const passwordForm=container.querySelector('form');if(!passwordForm||passwordForm.querySelectorAll('input[type="password"]').length!==3||Array.from(passwordForm.querySelectorAll('input')).some(i=>i.value!=='')||!passwordForm.querySelector('button[type="submit"]')?.hasAttribute('disabled'))throw new Error('Prerequisite: untouched password form');
  if(!Array.from(container.querySelectorAll('button')).some(b=>b.textContent?.trim()===security.enable2FA)||!Array.from(container.querySelectorAll('p')).some(n=>n.textContent?.trim()===security.trustedDevices.noDevices))throw new Error('Prerequisite: auxiliary reads settled to synthetic idle states');
  const calls=apiCalls.slice(startApi);if(calls.length!==3||['get2FAStatus','listTrustedDevices','getSsoConfig'].some(method=>calls.filter(c=>c.method===method&&c.args.length===0).length!==1)||boundaryErrors.length!==startBoundary||navigationCalls.length!==startNavigation||activations.length)throw new Error('Prerequisite: exactly three strict memory reads and zero effects');
  observed.panelHtml=panel.outerHTML;observed.groupHtml=group.outerHTML;observed.select={html:select.outerHTML,value:select.value,selectedIndex:select.selectedIndex,options,disabled:select.disabled,ariaLabel:select.getAttribute('aria-label'),ariaLabelledby:select.getAttribute('aria-labelledby'),title:select.getAttribute('title')};observed.controlsPassedBeforeOracle=true;
  const result=await axe.run({include:[select]},{runOnly:['select-name']});observed.accessibility={scope:'own initial SSO default-role select ONLY',rule:'select-name',version:axe.version,violations:result.violations,passes:result.passes,incomplete:result.incomplete};observed.html=container.innerHTML;observed.apiCalls=apiCalls.slice(startApi);observed.boundaryErrors=boundaryErrors.slice(startBoundary);observed.navigationCalls=navigationCalls.slice(startNavigation);observed.activations=[...activations];dump(locale+'-observed.json',observed);
  if(result.incomplete.length||apiCalls.length!==startApi+3||boundaryErrors.length!==startBoundary||navigationCalls.length!==startNavigation||activations.length)throw new Error('Prerequisite: complete scoped axe and zero effects');
  // FIRST product oracle. Options/auxiliary cards only establish loaded context.
  expect(result.violations).toEqual([]);
 }catch(error){observed.error=String((error as Error).stack||error);if(!fs.existsSync(path.join(OUT!,locale+'-observed.json')))dump(locale+'-observed.json',observed);throw error;}
 finally{if(root)await act(async()=>root.unmount());if(container)container.remove();for(const type of ['click','input','change','submit'])dom.window.document.removeEventListener(type,recordActivation,true);dump(locale+'-cleanup.json',{ownContainerRemoved:!container?.isConnected,remainingOwnedContainers:dom.window.document.querySelectorAll('[data-case-owned]').length,apiCalls:apiCalls.slice(startApi),boundaryErrors:boundaryErrors.slice(startBoundary),navigationCalls:navigationCalls.slice(startNavigation),activations,timerInventoryMeasured:false});}
},15000);
