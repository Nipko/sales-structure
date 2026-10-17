/** @jest-environment node */
// PREPARED ONLY. Only initial Webhooks Copy-secret button name; one settled memory read, no actions.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
const OUT = process.env.WEBHOOKS_COPY_NAME_EVIDENCE_DIR;
if (!OUT || !path.isAbsolute(OUT)) throw new Error('Exclusive evidence directory required');
const dump = (name: string, value: unknown) => fs.writeFileSync(path.join(OUT!, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user = Object.freeze({ id: '22222222-2222-4222-8222-222222222222', role: 'tenant_admin', tenantId });
const response = Object.freeze({"success":true,"data":[{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","url":"https://owned-webhook.invalid/hook","events":["lead.created","appointment.booked"],"secret":"owned_synthetic_webhook_secret_20261017_not_real","is_active":false,"description":"OWNED_WEBHOOK_COPY_NAME_UNACTIVATED","created_at":"2099-01-01T12:00:00.000Z","updated_at":"2099-01-01T12:00:00.000Z"}]});
type Envelope = typeof response;
let pending: { promise: Promise<Envelope>; settle: () => void; settled: boolean } | undefined;
const boundaryErrors: string[] = [], apiCalls: Array<{ method: string; args: unknown[] }> = [], navigationCalls: Array<{ method: string; args: unknown[] }> = [];
function unexpected(message: string): never { boundaryErrors.push(message); throw new Error(message); }
jest.mock('@/contexts/AuthContext', () => ({ __esModule: true, useAuth: () => ({ user }) }));
jest.mock('@/contexts/TenantContext', () => ({ __esModule: true, useTenant: () => ({ activeTenantId: tenantId }) }));
jest.mock('next/navigation', () => ({ __esModule: true, usePathname: () => '/admin/settings/integrations/webhooks', useRouter: () => new Proxy({}, { get(_target, key) { return (...args: unknown[]) => { navigationCalls.push({ method: String(key), args }); return unexpected('Unapproved router ' + String(key)); }; } }) }));
jest.mock('@/lib/api', () => ({ __esModule: true, api: new Proxy({}, { get(_target, key) { return (...args: unknown[]) => {
 const method = String(key); apiCalls.push({ method, args });
 if (method !== 'listWebhooks' || args.length !== 1 || args[0] !== tenantId || !pending) return unexpected('Unapproved API ' + method);
 return pending.promise;
}; } }) }));
let dom: JSDOM, Page: any, NextIntlClientProvider: any, createRoot: any, axe: any;
const blockedKeys = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'BroadcastChannel', 'Worker', 'SharedWorker', 'confirm', 'open'];
const globalKeys = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT', ...blockedKeys];
const prior = new Map<string, PropertyDescriptor | undefined>();
beforeAll(async () => {
 dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/' });
 for (const key of globalKeys) {
  prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : blockedKeys.includes(key) ? function () { return unexpected('Unapproved browser boundary ' + key); } : (dom.window as any)[key] });
 }
 for (const key of blockedKeys) Object.defineProperty(dom.window, key, { configurable: true, writable: true, value: (globalThis as any)[key] });
 Object.defineProperty(dom.window.navigator, 'sendBeacon', { configurable: true, value: () => unexpected('Unapproved browser boundary sendBeacon') });
 Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: { writeText: () => unexpected('Unapproved clipboard writeText'), readText: () => unexpected('Unapproved clipboard readText') } });
 Object.defineProperty(dom.window.document, 'execCommand', { configurable: true, value: () => unexpected('Unapproved document execCommand') });
 axe = (await import('axe-core')).default;
 ({ createRoot } = await import('react-dom/client')); ({ NextIntlClientProvider } = await import('next-intl'));
 const pageSpecifier = './' + 'page'; Page = (await import(pageSpecifier)).default;
});
afterAll(() => { dom?.window.close(); for (const key of globalKeys) { const old = prior.get(key); if (old) Object.defineProperty(globalThis, key, old); else delete (globalThis as any)[key]; } });

function visibleInOwnedDom(element: Element): boolean {
 for (let node: Element | null = element; node; node = node.parentElement) {
  const style = dom.window.getComputedStyle(node);
  if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
 }
 return element.isConnected;
}
for (const locale of ['es', 'en', 'pt', 'fr']) it(locale + ' initial Webhooks Copy-secret button has its own translated accessible name', async () => {
 const observed: any = { locale, source: 'real_WebhooksSettingsPage_HelpPanel_useRole_NextIntl_one_synthetic_memory_read', controlsPassedBeforeOracle: false, requestSettled: false, actFlushCompleted: false, html: null, accessibility: null, error: null };
 const startApi=apiCalls.length,startBoundary=boundaryErrors.length,startNavigation=navigationCalls.length,activations:string[]=[];
 const recordActivation=(event:Event)=>activations.push(event.type);
 for(const type of ['click','input','change','submit']) dom.window.document.addEventListener(type,recordActivation,true);
 let root:any,container:HTMLDivElement|undefined,resolveResponse!:(value:Envelope)=>void;
 const ownedPending={promise:new Promise<Envelope>(resolve=>{resolveResponse=resolve;}),settled:false,settle(){if(this.settled)throw new Error('Prerequisite: deferred already settled');this.settled=true;resolveResponse(JSON.parse(JSON.stringify(response)));}};pending=ownedPending;
 try{
  const messages=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../../../messages',locale+'.json'),'utf8')),copy=messages.outboundWebhooks,endpoint=response.data[0];
  for(const key of ['title','subtitle','secret','inactive','addEndpoint','recentDeliveries'])if(typeof copy[key]!=='string'||!copy[key].trim())throw new Error('Prerequisite: translated '+key);
  if(typeof messages.common.copy!=='string'||!messages.common.copy.trim())throw new Error('Prerequisite: copy translation');
  container=dom.window.document.createElement('div');container.dataset.caseOwned=locale;dom.window.document.body.appendChild(container);root=createRoot(container);
  await act(async()=>root.render(createElement(NextIntlClientProvider,{locale,messages,timeZone:'America/Bogota'},createElement(Page))));
  const before=apiCalls.slice(startApi);
  if(!container.isConnected||before.length!==1||before[0].method!=='listWebhooks'||JSON.stringify(before[0].args)!==JSON.stringify([tenantId])||ownedPending.settled)throw new Error('Prerequisite: exact one pending matchedtenant read');
  await act(async()=>{ownedPending.settle();await ownedPending.promise;});await act(async()=>{await Promise.resolve();});observed.requestSettled=ownedPending.settled;observed.actFlushCompleted=true;
  const calls=apiCalls.slice(startApi),h1=Array.from(container.querySelectorAll('h1')).filter(n=>n.textContent?.trim()===copy.title),sub=Array.from(container.querySelectorAll('p')).filter(n=>n.textContent?.trim()===copy.subtitle);
  if(h1.length!==1||sub.length!==1||!visibleInOwnedDom(h1[0])||!visibleInOwnedDom(sub[0]))throw new Error('Prerequisite: translated heading/subtitle');
  const ownDescriptions=Array.from(container.querySelectorAll('span')).filter(n=>n.textContent?.trim()===endpoint.description);
  if(ownDescriptions.length!==1||!visibleInOwnedDom(ownDescriptions[0]))throw new Error('Prerequisite: unique own endpoint description');
  const card=ownDescriptions[0].closest('div.overflow-hidden');if(!card||!container.contains(card))throw new Error('Prerequisite: own endpoint card');
  const urls=Array.from(card.querySelectorAll('p')).filter(n=>n.textContent?.trim()===endpoint.url),badges=Array.from(card.querySelectorAll('span.rounded-full')).filter(n=>n.textContent?.trim()===copy.inactive);
  if(urls.length!==1||badges.length!==1||!visibleInOwnedDom(urls[0])||!visibleInOwnedDom(badges[0]))throw new Error('Prerequisite: own URL and inactive badge');
  for(const event of endpoint.events){const nodes=Array.from(card.querySelectorAll('span.font-mono')).filter(n=>n.textContent===event);if(nodes.length!==1||!visibleInOwnedDom(nodes[0]))throw new Error('Prerequisite: own event badge');}
  const secretLabels=Array.from(card.querySelectorAll('span')).filter(n=>n.textContent?.trim()===copy.secret+':');if(secretLabels.length!==1)throw new Error('Prerequisite: own secret label');
  const row=secretLabels[0].parentElement!,codes=row.querySelectorAll('code'),copyIcons=row.querySelectorAll('svg.lucide-copy'),eyes=row.querySelectorAll('svg.lucide-eye'),regenerates=row.querySelectorAll('svg.lucide-rotate-cw');
  if(codes.length!==1||codes[0].textContent!=='••••••••••••••••'||!visibleInOwnedDom(codes[0])||copyIcons.length!==1||eyes.length!==1||regenerates.length!==1||container.innerHTML.includes(endpoint.secret))throw new Error('Prerequisite: masked own secret row and untouched controls');
  const button=copyIcons[0].closest('button') as HTMLButtonElement|null,allCopy=container.querySelectorAll('svg.lucide-copy');
  if(!button||!row.contains(button)||allCopy.length!==1||button.disabled||!visibleInOwnedDom(button))throw new Error('Prerequisite: unique available native Copy-secret button');
  const add=Array.from(container.querySelectorAll('button')).filter(n=>n.textContent?.trim()===copy.addEndpoint),deliveries=Array.from(card.querySelectorAll('button')).filter(n=>n.textContent?.trim()===copy.recentDeliveries);
  if(add.length!==1||add[0].disabled||deliveries.length!==1||!deliveries[0].querySelector('svg.lucide-chevron-down')||container.querySelector('input,select,textarea,[role="dialog"],.animate-spin,svg.lucide-alert-triangle')||Array.from(container.querySelectorAll('p')).some(n=>n.textContent?.trim()===copy.empty))throw new Error('Prerequisite: initial loaded card with editor/deliveries closed');
  if(!container.isConnected||!ownedPending.settled||calls.length!==1||calls[0].method!=='listWebhooks'||JSON.stringify(calls[0].args)!==JSON.stringify([tenantId])||boundaryErrors.length!==startBoundary||navigationCalls.length!==startNavigation||activations.length)throw new Error('Prerequisite: settled exact read and zero effects');
  const labelledby=(button.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).map(id=>{const node=dom.window.document.getElementById(id);return node&&container!.contains(node)?node.textContent?.trim()||'':'';}).join(' ').trim(),nativeLabels=Array.from(button.labels||[]).map(n=>n.textContent?.trim()).join(' ').trim();
  const nameEvidence={ariaLabel:button.getAttribute('aria-label'),ariaLabelledby:button.getAttribute('aria-labelledby'),labelledbyText:labelledby,nativeLabelsText:nativeLabels,ownText:button.textContent?.trim()||'',title:button.getAttribute('title')};
  const observedName=labelledby||nameEvidence.ariaLabel?.trim()||nativeLabels||nameEvidence.ownText||nameEvidence.title?.trim()||'';
  observed.button={html:button.outerHTML,disabled:button.disabled,nameEvidence,observedName};observed.panelHtml=row.outerHTML;observed.cardHtml=card.outerHTML;observed.html=container.innerHTML;observed.fixture=response;observed.apiCalls=calls;observed.boundaryErrors=boundaryErrors.slice(startBoundary);observed.navigationCalls=navigationCalls.slice(startNavigation);observed.activations=[...activations];observed.controlsPassedBeforeOracle=true;
  const result=await axe.run({include:[button]},{runOnly:['button-name']});observed.accessibility={scope:'ONLY_initial_Webhooks_Copy_secret_button',rule:'button-name',version:axe.version,violations:result.violations,passes:result.passes,incomplete:result.incomplete};dump(locale+'-observed.json',observed);
  if(result.incomplete.length||boundaryErrors.length!==startBoundary||navigationCalls.length!==startNavigation||activations.length||apiCalls.length!==startApi+1)throw new Error('Prerequisite: complete single-rule result and zero effects');
  // FIRST product oracle, after controls and captured raw DOM/axe evidence.
  expect(result.violations).toEqual([]);
  expect(result.passes).toHaveLength(1);expect(result.passes[0].nodes).toHaveLength(1);expect(observedName.toLocaleLowerCase(locale)).toContain(messages.common.copy.toLocaleLowerCase(locale));
 }catch(error){observed.error=String((error as Error).stack||error);if(!fs.existsSync(path.join(OUT!,locale+'-observed.json')))dump(locale+'-observed.json',observed);throw error;}
 finally{
  if(!ownedPending.settled)await act(async()=>{ownedPending.settle();await ownedPending.promise;});if(root)await act(async()=>root.unmount());if(container)container.remove();pending=undefined;
  for(const type of ['click','input','change','submit'])dom.window.document.removeEventListener(type,recordActivation,true);
  dump(locale+'-cleanup.json',{ownContainerRemoved:!container?.isConnected,remainingOwnedContainers:dom.window.document.querySelectorAll('[data-case-owned]').length,knownDeferredSettled:ownedPending.settled,apiCalls:apiCalls.slice(startApi),boundaryErrors:boundaryErrors.slice(startBoundary),navigationCalls:navigationCalls.slice(startNavigation),activations,timerInventoryMeasured:false});
 }
},15000);
