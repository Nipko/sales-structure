/** @jest-environment node */
// PREPARED ONLY. Only initial native Recall channel select name; one settled synthetic saved-config read and no actions.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
const OUT = process.env.RECALL_CHANNEL_LABEL_EVIDENCE_DIR;
if (!OUT || !path.isAbsolute(OUT)) throw new Error('Exclusive evidence directory required');
const dump = (name: string, value: unknown) => fs.writeFileSync(path.join(OUT!, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const tenantId = '77777777-7777-4777-8777-777777777777';
const user = Object.freeze({ id: '22222222-2222-4222-8222-222222222222', role: 'tenant_admin', tenantId });
const response = Object.freeze({"success":true,"data":{"enabled":false,"daysThreshold":247,"cooldownDays":61,"channelType":"telegram","message":"Owned recall synthetic {name} {months} ONLY"}});
type Envelope = typeof response;
let pending: { promise: Promise<Envelope>; settle: () => void; settled: boolean } | undefined;
const boundaryErrors: string[] = [], apiCalls: Array<{ method: string; args: unknown[] }> = [], navigationCalls: Array<{ method: string; args: unknown[] }> = [];
function unexpected(message: string): never { boundaryErrors.push(message); throw new Error(message); }
jest.mock('@/contexts/AuthContext', () => ({ __esModule: true, useAuth: () => ({ user }) }));
jest.mock('@/contexts/TenantContext', () => ({ __esModule: true, useTenant: () => ({ activeTenantId: tenantId }) }));
jest.mock('next/navigation', () => ({ __esModule: true, usePathname: () => '/admin/settings/recall', useRouter: () => new Proxy({}, { get(_target, key) { return (...args: unknown[]) => { navigationCalls.push({ method: String(key), args }); return unexpected('Unapproved router ' + String(key)); }; } }) }));
jest.mock('@/lib/api', () => ({ __esModule: true, api: new Proxy({}, { get(_target, key) { return (...args: unknown[]) => {
 const method = String(key); apiCalls.push({ method, args });
 if (method !== 'getRecallConfig' || args.length !== 1 || args[0] !== tenantId || !pending) return unexpected('Unapproved API ' + method);
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
for (const locale of ['es', 'en', 'pt', 'fr']) it(locale + ' initial Recall channel select has its own translated accessible name', async () => {
 const observed: any = { locale, source: 'real_RecallSettingsPage_HelpPanel_useRole_NextIntl_one_synthetic_saved_config_memory_read', controlsPassedBeforeOracle: false, requestSettled: false, actFlushCompleted: false, html: null, accessibility: null, error: null };
 const startApi = apiCalls.length, startBoundary = boundaryErrors.length, startNavigation = navigationCalls.length, activations: string[] = [];
 const recordActivation = (event: Event) => activations.push(event.type);
 for (const type of ['click', 'input', 'change', 'submit']) dom.window.document.addEventListener(type, recordActivation, true);
 let root: any, container: HTMLDivElement | undefined;
 let resolveResponse!: (value: Envelope) => void;
 const ownedPending = { promise: new Promise<Envelope>(resolve => { resolveResponse = resolve; }), settled: false, settle() { if (this.settled) throw new Error('Prerequisite: owned deferred already settled'); this.settled = true; resolveResponse(JSON.parse(JSON.stringify(response))); } };
 pending = ownedPending;
 try {
  const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../messages', locale + '.json'), 'utf8')), copy = messages.settings.recall;
  for (const key of ['title', 'channelLabel', 'channelHelp', 'save', 'runNow', 'enabledLabel']) if (typeof copy[key] !== 'string' || !copy[key].trim()) throw new Error('Prerequisite: translated ' + key);
  container = dom.window.document.createElement('div'); container.dataset.caseOwned = locale; dom.window.document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale, messages, timeZone: 'America/Bogota' }, createElement(Page))));
  const before = apiCalls.slice(startApi);
  if (!container.isConnected || before.length !== 1 || before[0].method !== 'getRecallConfig' || JSON.stringify(before[0].args) !== JSON.stringify([tenantId]) || ownedPending.settled) throw new Error('Prerequisite: exact one pending matched-tenant read');
  await act(async () => { ownedPending.settle(); await ownedPending.promise; });
  await act(async () => { await Promise.resolve(); });
  observed.requestSettled = ownedPending.settled; observed.actFlushCompleted = true;
  const calls = apiCalls.slice(startApi), selects = Array.from(container.querySelectorAll('select'));
  const h1 = Array.from(container.querySelectorAll('h1')).filter(n => n.textContent?.trim() === copy.title);
  if (h1.length !== 1 || selects.length !== 1) throw new Error('Prerequisite: own heading and unique native channel select');
  const select = selects[0], group = select.parentElement!, options = Array.from(select.options);
  const expectedOptions = [{value:'whatsapp',text:'WhatsApp'},{value:'instagram',text:'Instagram DM'},{value:'messenger',text:'Messenger'},{value:'telegram',text:'Telegram'},{value:'sms',text:'SMS'}];
  const labels = Array.from(group.querySelectorAll('label')).filter(n => n.textContent?.trim() === copy.channelLabel);
  const hints = Array.from(group.querySelectorAll('p')).filter(n => n.textContent?.trim() === copy.channelHelp);
  if (select.disabled || !visibleInOwnedDom(select) || labels.length !== 1 || hints.length !== 1 || !visibleInOwnedDom(labels[0]) || !visibleInOwnedDom(hints[0]) || JSON.stringify(options.map(n=>({value:n.value,text:n.textContent?.trim()}))) !== JSON.stringify(expectedOptions) || select.value !== 'telegram' || select.selectedIndex !== 3 || JSON.stringify(options.map(n=>n.selected)) !== JSON.stringify([false,false,false,true,false])) throw new Error('Prerequisite: own channel label/help and LIVE nondefault selection');
  const toggles = Array.from(container.querySelectorAll<HTMLButtonElement>('button.w-11.h-6'));
  const numbers = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="number"]')), texts = Array.from(container.querySelectorAll('textarea'));
  const buttons = Array.from(container.querySelectorAll('button')), save = buttons.filter(n=>n.textContent?.trim()===copy.save), run = buttons.filter(n=>n.textContent?.trim()===copy.runNow);
  if (toggles.length !== 1 || toggles[0].disabled || toggles[0].getAttribute('aria-pressed') !== 'false' || numbers.length !== 2 || numbers[0].value !== '247' || numbers[1].value !== '61' || texts.length !== 1 || texts[0].value !== response.data.message || save.length !== 1 || save[0].disabled || run.length !== 1 || !run[0].disabled || container.querySelector('div.p-4.rounded-xl.text-sm.border')) throw new Error('Prerequisite: saved disabled-Recall form values, enabled untouched toggle/Save, disabled RunNow and absent feedback');
  if (!container.isConnected || !ownedPending.settled || calls.length !== 1 || calls[0].method !== 'getRecallConfig' || JSON.stringify(calls[0].args) !== JSON.stringify([tenantId]) || boundaryErrors.length !== startBoundary || navigationCalls.length !== startNavigation || activations.length) throw new Error('Prerequisite: settled exact read and zero effects');
  const labelledby = (select.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id=>{const node=dom.window.document.getElementById(id);return node && container!.contains(node) ? node.textContent?.trim() || '' : '';}).join(' ').trim();
  const nativeLabels = Array.from(select.labels || []).map(n=>n.textContent?.trim()).join(' ').trim();
  const nameEvidence = { ariaLabel: select.getAttribute('aria-label'), ariaLabelledby: select.getAttribute('aria-labelledby'), labelledbyText: labelledby, nativeLabelsText: nativeLabels, title: select.getAttribute('title') };
  const observedName = labelledby || nameEvidence.ariaLabel?.trim() || nativeLabels || nameEvidence.title?.trim() || '';
  observed.select = { html: select.outerHTML, value: select.value, selectedIndex: select.selectedIndex, options: options.map(n=>({value:n.value,text:n.textContent,selected:n.selected})), nameEvidence, observedName };
  observed.groupHtml = group.outerHTML; observed.html = container.innerHTML; observed.fixture = response; observed.apiCalls = calls; observed.boundaryErrors = boundaryErrors.slice(startBoundary); observed.navigationCalls = navigationCalls.slice(startNavigation); observed.activations = [...activations]; observed.controlsPassedBeforeOracle = true;
  const result = await axe.run({include:[select]}, {runOnly:['select-name']});
  observed.accessibility = {scope:'ONLY_initial_native_Recall_channel_select',rule:'select-name',version:axe.version,violations:result.violations,passes:result.passes,incomplete:result.incomplete};
  dump(locale + '-observed.json', observed);
  if (result.incomplete.length || boundaryErrors.length !== startBoundary || navigationCalls.length !== startNavigation || activations.length || apiCalls.length !== startApi + 1) throw new Error('Prerequisite: complete single-rule result and zero effects');
  // FIRST product oracle, after live controls and captured raw DOM/axe evidence.
  expect(result.violations).toEqual([]);
  expect(result.passes).toHaveLength(1); expect(result.passes[0].nodes).toHaveLength(1);
  expect(observedName).toBe(copy.channelLabel);
 } catch (error) {
  observed.error = String((error as Error).stack || error);
  if (!fs.existsSync(path.join(OUT!, locale + '-observed.json'))) dump(locale + '-observed.json', observed);
  throw error;
 } finally {
  if (!ownedPending.settled) await act(async () => { ownedPending.settle(); await ownedPending.promise; });
  if (root) await act(async () => root.unmount()); if (container) container.remove(); pending = undefined;
  for (const type of ['click', 'input', 'change', 'submit']) dom.window.document.removeEventListener(type, recordActivation, true);
  dump(locale + '-cleanup.json', { ownContainerRemoved: !container?.isConnected, remainingOwnedContainers: dom.window.document.querySelectorAll('[data-case-owned]').length, knownDeferredSettled: ownedPending.settled, apiCalls: apiCalls.slice(startApi), boundaryErrors: boundaryErrors.slice(startBoundary), navigationCalls: navigationCalls.slice(startNavigation), activations, timerInventoryMeasured: false });
 }
}, 15000);
