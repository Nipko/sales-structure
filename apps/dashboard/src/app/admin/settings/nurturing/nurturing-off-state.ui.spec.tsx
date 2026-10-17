/** @jest-environment node */
// PREPARED ONLY. Only initial Nurturing programmatic OFF state; one settled memory read, no actions; no name/axe oracle.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
const OUT = process.env.NURTURING_OFF_STATE_EVIDENCE_DIR;
if (!OUT || !path.isAbsolute(OUT)) throw new Error('Exclusive evidence directory required');
const dump = (name: string, value: unknown) => fs.writeFileSync(path.join(OUT!, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const tenantId = '99999999-9999-4999-8999-999999999999';
const user = Object.freeze({ id: '22222222-2222-4222-8222-222222222222', role: 'tenant_admin', tenantId });
const response = Object.freeze({"success":true,"data":{"enabled":false,"maxAttempts":2,"delays":[28800,172800],"allowedChannels":["telegram"],"finalAction":"mark_not_interested","whatsappTemplateName":"owned_nurturing_off_state_unactivated","maxPerDay":7}});
type Envelope = typeof response;
let pending: { promise: Promise<Envelope>; settle: () => void; settled: boolean } | undefined;
const boundaryErrors: string[] = [], apiCalls: Array<{ method: string; args: unknown[] }> = [], navigationCalls: Array<{ method: string; args: unknown[] }> = [];
function unexpected(message: string): never { boundaryErrors.push(message); throw new Error(message); }
jest.mock('@/contexts/AuthContext', () => ({ __esModule: true, useAuth: () => ({ user }) }));
jest.mock('@/contexts/TenantContext', () => ({ __esModule: true, useTenant: () => ({ activeTenantId: tenantId }) }));
jest.mock('next/navigation', () => ({ __esModule: true, usePathname: () => '/admin/settings/nurturing', useRouter: () => new Proxy({}, { get(_target, key) { return (...args: unknown[]) => { navigationCalls.push({ method: String(key), args }); return unexpected('Unapproved router ' + String(key)); }; } }) }));
jest.mock('@/lib/api', () => ({ __esModule: true, api: new Proxy({}, { get(_target, key) { return (...args: unknown[]) => {
 const method = String(key); apiCalls.push({ method, args });
 if (method !== 'getNurturingConfig' || args.length !== 1 || args[0] !== tenantId || !pending) return unexpected('Unapproved API ' + method);
 return pending.promise;
}; } }) }));
let dom: JSDOM, Page: any, NextIntlClientProvider: any, createRoot: any;
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
for (const locale of ['es', 'en', 'pt', 'fr']) it(locale + ' initial Nurturing enable control exposes programmatic OFF state', async () => {
 const observed: any = { locale, source: 'real_NurturingSettingsPage_HelpPanel_useRole_NextIntl_one_synthetic_memory_read', controlsPassedBeforeOracle: false, requestSettled: false, actFlushCompleted: false, html: null, programmaticState: null, error: null };
 const startApi = apiCalls.length, startBoundary = boundaryErrors.length, startNavigation = navigationCalls.length, activations: string[] = [];
 const recordActivation = (event: Event) => activations.push(event.type);
 for (const type of ['click', 'input', 'change', 'submit']) dom.window.document.addEventListener(type, recordActivation, true);
 let root: any, container: HTMLDivElement | undefined, resolveResponse!: (value: Envelope) => void;
 const ownedPending = { promise: new Promise<Envelope>(resolve => { resolveResponse = resolve; }), settled: false, settle() { if (this.settled) throw new Error('Prerequisite: owned deferred already settled'); this.settled = true; resolveResponse(JSON.parse(JSON.stringify(response))); } };
 pending = ownedPending;
 try {
  const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../messages', locale + '.json'), 'utf8')), copy = messages.settings.nurturingPage;
  for (const key of ['title', 'description', 'enableLabel', 'enableDesc', 'warning', 'warningDetail']) if (typeof copy[key] !== 'string' || !copy[key].trim()) throw new Error('Prerequisite: translated ' + key);
  container = dom.window.document.createElement('div'); container.dataset.caseOwned = locale; dom.window.document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale, messages, timeZone: 'America/Bogota' }, createElement(Page))));
  const before = apiCalls.slice(startApi);
  if (!container.isConnected || before.length !== 1 || before[0].method !== 'getNurturingConfig' || JSON.stringify(before[0].args) !== JSON.stringify([tenantId]) || ownedPending.settled) throw new Error('Prerequisite: exact one pending matched-tenant read');
  await act(async () => { ownedPending.settle(); await ownedPending.promise; });
  await act(async () => { await Promise.resolve(); });
  observed.requestSettled = ownedPending.settled; observed.actFlushCompleted = true;
  const calls = apiCalls.slice(startApi), h1 = Array.from(container.querySelectorAll('h1')).filter(n => n.textContent?.trim() === copy.title);
  if (h1.length !== 1 || !visibleInOwnedDom(h1[0])) throw new Error('Prerequisite: own translated heading');
  for (const key of ['description', 'warning', 'warningDetail']) { const nodes = Array.from(container.querySelectorAll('p')).filter(n=>n.textContent?.trim() === copy[key]); if (nodes.length !== 1 || !visibleInOwnedDom(nodes[0])) throw new Error('Prerequisite: translated description/warning ' + key); }
  const leafCopy = (text: string) => Array.from(container!.querySelectorAll('*')).filter(node => node.textContent?.trim() === text && !Array.from(node.children).some(child => child.textContent?.trim() === text));
  const ownLabels = leafCopy(copy.enableLabel), ownDescriptions = leafCopy(copy.enableDesc);
  if (ownLabels.length !== 1 || ownDescriptions.length !== 1 || !visibleInOwnedDom(ownLabels[0]) || !visibleInOwnedDom(ownDescriptions[0])) throw new Error('Prerequisite: unique own enable label and description');
  let panel: Element | null = ownLabels[0].parentElement;
  while (panel && panel !== container && !(panel.contains(ownDescriptions[0]) && panel.querySelector('button,input[type="checkbox"]'))) panel = panel.parentElement;
  if (!panel || panel === container) throw new Error('Prerequisite: own enable panel');
  const controls = Array.from(panel.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input[type="checkbox"]'));
  if (controls.length !== 1) throw new Error('Prerequisite: one native button or checkbox in own enable panel');
  const control = controls[0], isCheckbox = control instanceof dom.window.HTMLInputElement && control.type === 'checkbox', spans = control.querySelectorAll('span');
  if (control.disabled || control.matches(':disabled') || control.getAttribute('aria-disabled') === 'true' || !visibleInOwnedDom(control)) throw new Error('Prerequisite: available own native enable control');
  if (!isCheckbox && control.classList.contains('w-11') && control.classList.contains('h-6') && (!control.classList.contains('bg-neutral-300') || spans.length !== 1 || spans[0].classList.contains('translate-x-5'))) throw new Error('Prerequisite: styled native button visually OFF');
  const saves = Array.from(container.querySelectorAll('button')).filter(node=>node.textContent?.trim()===messages.common.save);
  const extraFields = Array.from(container.querySelectorAll('input,select,textarea')).filter(node=>node !== control);
  if (saves.length !== 1 || saves[0].disabled || saves[0].querySelectorAll('svg.lucide-save').length !== 1 || saves[0].querySelector('svg.lucide-circle-check') || extraFields.length || container.querySelector('.animate-pulse')) throw new Error('Prerequisite: untouched Save and disabled-config branch without extra fields/loading');
  if (!container.isConnected || !ownedPending.settled || calls.length !== 1 || calls[0].method !== 'getNurturingConfig' || JSON.stringify(calls[0].args) !== JSON.stringify([tenantId]) || boundaryErrors.length !== startBoundary || navigationCalls.length !== startNavigation || activations.length) throw new Error('Prerequisite: settled exact read and zero effects');
  const role = control.getAttribute('role')?.trim() || null, pressed = control.getAttribute('aria-pressed'), checked = control.getAttribute('aria-checked'), selected = control.getAttribute('aria-selected'), current = control.getAttribute('aria-current');
  const liveChecked = isCheckbox ? (control as HTMLInputElement).checked : null, indeterminate = isCheckbox ? (control as HTMLInputElement).indeterminate : null;
  const noContradictorySelection = (selected === null || selected === 'false') && (current === null || current === 'false');
  const buttonOff = control.tagName === 'BUTTON' && (role === null || role === 'button') && pressed === 'false' && checked === null;
  const ariaOff = (role === 'switch' || role === 'checkbox') && checked === 'false' && pressed === null && (!isCheckbox || (liveChecked === false && indeterminate === false));
  const nativeOff = isCheckbox && (role === null || role === 'checkbox' || role === 'switch') && liveChecked === false && indeterminate === false && pressed === null && (checked === null || checked === 'false');
  const exposesOff = noContradictorySelection && (buttonOff || ariaOff || nativeOff);
  observed.programmaticState = { tag: control.tagName, type: control.type, role, ariaPressed: pressed, ariaChecked: checked, ariaSelected: selected, ariaCurrent: current, liveChecked, indeterminate, nativeDisabled: control.disabled, buttonOff, ariaOff, nativeOff, noContradictorySelection, exposesOff };
  observed.control = { html: control.outerHTML, className: control.className, spanClassNames: Array.from(spans).map(node=>node.className) };
  observed.panelHtml = panel.outerHTML; observed.panelText = panel.textContent; observed.html = container.innerHTML; observed.fixture = response; observed.hiddenFixtureFieldsCertified = false; observed.apiCalls = calls; observed.boundaryErrors = boundaryErrors.slice(startBoundary); observed.navigationCalls = navigationCalls.slice(startNavigation); observed.activations = [...activations]; observed.controlsPassedBeforeOracle = true;
  dump(locale + '-observed.json', observed);
  // FIRST product oracle, after controls and raw DOM/live state evidence. No name/axe oracle.
  expect(exposesOff).toBe(true);
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
