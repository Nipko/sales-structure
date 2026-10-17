/** @jest-environment node */
// PREPARED ONLY. One local launcher click; never create, rotate, revoke or copy a key.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
const OUT = process.env.API_KEYS_DIALOG_EVIDENCE_DIR;
if (!OUT || !path.isAbsolute(OUT)) throw new Error('Exclusive evidence directory required');
const dump = (name: string, value: unknown) => fs.writeFileSync(path.join(OUT!, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const tenantId = '11111111-1111-4111-8111-111111111111';
const user = Object.freeze({ id: '22222222-2222-4222-8222-222222222222', role: 'tenant_admin', tenantId });
const boundaryErrors: string[] = [], apiCalls: Array<{ method: string; args: unknown[] }> = [], navigationCalls: Array<{ method: string; args: unknown[] }> = [];
function unexpected(message: string): never { boundaryErrors.push(message); throw new Error(message); }
jest.mock('@/contexts/AuthContext', () => ({ __esModule: true, useAuth: () => ({ user }) }));
jest.mock('@/contexts/TenantContext', () => ({ __esModule: true, useTenant: () => ({ activeTenantId: tenantId }) }));
jest.mock('next/navigation', () => ({ __esModule: true, usePathname: () => '/admin/settings/api-keys', useRouter: () => new Proxy({}, { get(_target, key) { return (...args: unknown[]) => { navigationCalls.push({ method: String(key), args }); return unexpected('Unapproved router ' + String(key)); }; } }) }));
jest.mock('@/lib/api', () => ({ __esModule: true, api: new Proxy({}, { get(_target, key) { return async (...args: unknown[]) => {
 const method = String(key); apiCalls.push({ method, args });
 if (args.length !== 1 || args[0] !== tenantId) return unexpected('Unapproved API arguments ' + method);
 if (method === 'getPlanFeatures') return { success: true, data: { publicApi: true } };
 if (method === 'listPublicApiKeys') return { success: true, data: [] };
 return unexpected('Unapproved API ' + method);
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
 Object.defineProperty(dom.window.navigator, 'sendBeacon', { configurable: true, value: () => unexpected('Unapproved sendBeacon') });
 Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: { writeText: () => unexpected('Unapproved clipboard writeText'), readText: () => unexpected('Unapproved clipboard readText') } });
 Object.defineProperty(dom.window.document, 'execCommand', { configurable: true, value: () => unexpected('Unapproved execCommand') });
 ({ createRoot } = await import('react-dom/client')); ({ NextIntlClientProvider } = await import('next-intl'));
 const pageSpecifier = './' + 'page'; Page = (await import(pageSpecifier)).default;
});
afterAll(() => { dom?.window.close(); for (const key of globalKeys) { const old = prior.get(key); if (old) Object.defineProperty(globalThis, key, old); else delete (globalThis as any)[key]; } });
for (const locale of ['es', 'en', 'pt', 'fr']) it(locale + ' opened new API key form exposes a dialog role', async () => {
 const observed: any = { locale, source: 'real_ApiKeysPage_CreateKeyModal_usePlanLimits_PageHeader_NextIntl_synthetic_context', controlsPassedBeforeOracle: false, html: null, formContentHtml: null, dialogs: [], error: null };
 const startApi = apiCalls.length, startBoundary = boundaryErrors.length, startNavigation = navigationCalls.length;
 const activations: Array<{ type: string; ownLauncher: boolean }> = [];
 let permittedLauncher: HTMLButtonElement | undefined, root: any, container: HTMLDivElement | undefined;
 const recordActivation = (event: Event) => { const ownLauncher = event.type === 'click' && event.target === permittedLauncher; activations.push({ type: event.type, ownLauncher }); if (!ownLauncher) unexpected('Unapproved UI activation ' + event.type); };
 for (const type of ['click', 'input', 'change', 'submit']) dom.window.document.addEventListener(type, recordActivation, true);
 const exactReads = () => { const calls = apiCalls.slice(startApi); return calls.length === 2 && ['getPlanFeatures', 'listPublicApiKeys'].every(method => calls.filter(call => call.method === method && JSON.stringify(call.args) === JSON.stringify([tenantId])).length === 1); };
 try {
  const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../messages', locale + '.json'), 'utf8')), copy = messages.apiKeys;
  container = dom.window.document.createElement('div'); container.dataset.caseOwned = locale; dom.window.document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale, messages, timeZone: 'America/Bogota' }, createElement(Page))));
  if (container.querySelector('h1')?.textContent?.trim() !== copy.title || !Array.from(container.querySelectorAll('p')).some(node => node.textContent?.trim() === copy.noKeys) || container.querySelector('input') || container.querySelector('[role="alert"]') || !exactReads()) throw new Error('Prerequisite: translated page/empty synthetic list/settled exact plan+list reads');
  const launchers = Array.from(container.querySelectorAll('button')).filter(button => button.textContent?.trim() === copy.createKey);
  if (launchers.length !== 1 || launchers[0].disabled || boundaryErrors.length !== startBoundary || navigationCalls.length !== startNavigation || activations.length) throw new Error('Prerequisite: unique enabled own launcher and zero effects');
  permittedLauncher = launchers[0]; observed.beforeOpenHtml = container.innerHTML;
  await act(async () => { permittedLauncher!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
  permittedLauncher = undefined;
  const headings = Array.from(container.querySelectorAll('h2')).filter(node => node.textContent?.trim() === copy.createKey);
  if (headings.length !== 1) throw new Error('Prerequisite: own translated create-form heading after one local open click');
  const heading = headings[0]; let content: Element | null = heading.parentElement;
  while (content && content !== container && content.querySelectorAll('input').length < 2) content = content.parentElement;
  if (!content || content === container || !content.contains(heading) || content.querySelectorAll('input').length !== 2) throw new Error('Prerequisite: unique own form content with two native inputs');
  const name = content.querySelector<HTMLInputElement>('input[type="text"]'), expiry = content.querySelector<HTMLInputElement>('input[type="date"]');
  if (!name || !expiry || name.value !== '' || expiry.value !== '' || name.disabled || expiry.disabled || name.placeholder !== copy.modal.namePlaceholder) throw new Error('Prerequisite: untouched empty name and expiry');
  const buttons = Array.from(content.querySelectorAll('button'));
  for (const label of Object.values(copy.scopes)) if (buttons.filter(button => button.textContent?.trim() === label).length !== 1) throw new Error('Prerequisite: eleven translated untouched scope controls');
  const cancel = buttons.filter(button => button.textContent?.trim() === messages.common.cancel), submit = buttons.filter(button => button.textContent?.trim() === copy.modal.create);
  if (cancel.length !== 1 || cancel[0].disabled || submit.length !== 1 || !submit[0].disabled) throw new Error('Prerequisite: enabled cancel and disabled creation untouched');
  if (!container.isConnected || !exactReads() || boundaryErrors.length !== startBoundary || navigationCalls.length !== startNavigation || JSON.stringify(activations) !== JSON.stringify([{ type: 'click', ownLauncher: true }])) throw new Error('Prerequisite: exact two memory reads/no writes/router/boundary/only one permitted launch click');
  const dialogs = Array.from(container.querySelectorAll('[role="dialog"],dialog[open]'));
  observed.dialogs = dialogs.map(dialog => ({ html: dialog.outerHTML, containsOwnHeading: dialog.contains(heading), containsOwnFormContent: dialog.contains(content) }));
  observed.html = container.innerHTML; observed.formContentHtml = content.outerHTML; observed.apiCalls = apiCalls.slice(startApi); observed.boundaryErrors = boundaryErrors.slice(startBoundary); observed.navigationCalls = navigationCalls.slice(startNavigation); observed.activations = [...activations]; observed.controlsPassedBeforeOracle = true;
  dump(locale + '-observed.json', observed);
  // FIRST product oracle: role only. Names, focus, background inertness and other controls are not certified.
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0].contains(heading)).toBe(true);
  expect(dialogs[0].contains(content)).toBe(true);
 } catch (error) {
  observed.error = String((error as Error).stack || error);
  if (!fs.existsSync(path.join(OUT!, locale + '-observed.json'))) dump(locale + '-observed.json', observed);
  throw error;
 } finally {
  permittedLauncher = undefined;
  if (root) await act(async () => root.unmount()); if (container) container.remove();
  for (const type of ['click', 'input', 'change', 'submit']) dom.window.document.removeEventListener(type, recordActivation, true);
  dump(locale + '-cleanup.json', { ownContainerRemoved: !container?.isConnected, remainingOwnedContainers: dom.window.document.querySelectorAll('[data-case-owned]').length, apiCalls: apiCalls.slice(startApi), boundaryErrors: boundaryErrors.slice(startBoundary), navigationCalls: navigationCalls.slice(startNavigation), activations, timerInventoryMeasured: false });
 }
}, 15000);
