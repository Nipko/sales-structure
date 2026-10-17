/** @jest-environment node */
// PREPARED ONLY. One settled synthetic configuration failure; no booking or action.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
const OUT = process.env.PUBLIC_BOOKING_LOAD_EVIDENCE_DIR;
if (!OUT || !path.isAbsolute(OUT)) throw new Error('Exclusive evidence directory required');
const dump = (name: string, value: unknown) => fs.writeFileSync(path.join(OUT!, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const tenantId = '11111111-1111-4111-8111-111111111111';
const user = Object.freeze({ id: '22222222-2222-4222-8222-222222222222', role: 'tenant_admin', tenantId });
const response = Object.freeze({ success: false, httpStatus: 503, error: 'Owned synthetic public booking configuration unavailable' });
type Envelope = typeof response;
let pending: { promise: Promise<Envelope>; settle: () => void; settled: boolean } | undefined;
const boundaryErrors: string[] = [], apiCalls: Array<{ method: string; args: unknown[] }> = [], navigationCalls: Array<{ method: string; args: unknown[] }> = [];
function unexpected(message: string): never { boundaryErrors.push(message); throw new Error(message); }
jest.mock('@/contexts/AuthContext', () => ({ __esModule: true, useAuth: () => ({ user }) }));
jest.mock('@/contexts/TenantContext', () => ({ __esModule: true, useTenant: () => ({ activeTenantId: tenantId }) }));
jest.mock('next/navigation', () => ({ __esModule: true, usePathname: () => '/admin/settings/public-booking', useRouter: () => new Proxy({}, { get(_target, key) { return (...args: unknown[]) => { navigationCalls.push({ method: String(key), args }); return unexpected('Unapproved router ' + String(key)); }; } }) }));
jest.mock('@/lib/api', () => ({ __esModule: true, api: new Proxy({}, { get(_target, key) { return (...args: unknown[]) => {
 const method = String(key); apiCalls.push({ method, args });
 if (method !== 'getPublicBookingConfig' || args.length !== 1 || args[0] !== tenantId || !pending) return unexpected('Unapproved API ' + method);
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
for (const locale of ['es', 'en', 'pt', 'fr']) it(locale + ' settled public booking configuration failure leaves loading and explains the failure', async () => {
 const observed: any = { locale, source: 'real_PublicBookingSettingsPage_NextIntl_synthetic_tenant_one_memory_structured_failure', controlsPassedBeforeOracle: false, requestSettled: false, actFlushCompleted: false, html: null, alerts: [], skeletonCount: null, error: null };
 const startApi = apiCalls.length, startBoundary = boundaryErrors.length, startNavigation = navigationCalls.length, activations: string[] = [];
 const recordActivation = (event: Event) => activations.push(event.type);
 for (const type of ['click', 'input', 'change', 'submit']) dom.window.document.addEventListener(type, recordActivation, true);
 let root: any, container: HTMLDivElement | undefined;
 let resolveResponse!: (value: Envelope) => void;
 const ownedPending = { promise: new Promise<Envelope>(resolve => { resolveResponse = resolve; }), settled: false, settle() { if (this.settled) throw new Error('Prerequisite: owned deferred already settled'); this.settled = true; resolveResponse(JSON.parse(JSON.stringify(response))); } };
 pending = ownedPending;
 try {
  const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../messages', locale + '.json'), 'utf8')), copy = messages.common;
  for (const key of ['loadFailed', 'loadFailedHint', 'retry']) if (typeof copy[key] !== 'string' || !copy[key].trim()) throw new Error('Prerequisite: translated ' + key);
  container = dom.window.document.createElement('div'); container.dataset.caseOwned = locale; dom.window.document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale, messages, timeZone: 'America/Bogota' }, createElement(Page))));
  const beforeSettlementCalls = apiCalls.slice(startApi);
  if (!container.isConnected || beforeSettlementCalls.length !== 1 || beforeSettlementCalls[0].method !== 'getPublicBookingConfig' || JSON.stringify(beforeSettlementCalls[0].args) !== JSON.stringify([tenantId]) || ownedPending.settled) throw new Error('Prerequisite: connected owned container and exactly one pending matched-tenant memory request');
  await act(async () => { ownedPending.settle(); await ownedPending.promise; });
  await act(async () => { await Promise.resolve(); });
  observed.requestSettled = ownedPending.settled; observed.actFlushCompleted = true;
  const calls = apiCalls.slice(startApi);
  if (!container.isConnected || !ownedPending.settled || calls.length !== 1 || calls[0].method !== 'getPublicBookingConfig' || JSON.stringify(calls[0].args) !== JSON.stringify([tenantId]) || boundaryErrors.length !== startBoundary || navigationCalls.length !== startNavigation || activations.length) throw new Error('Prerequisite: settled exact memory read and zero effects');
  const alerts = Array.from(container.querySelectorAll('[role="alert"]'));
  observed.alerts = alerts.map(alert => ({ html: alert.outerHTML, text: alert.textContent, visible: visibleInOwnedDom(alert), paragraphs: Array.from(alert.querySelectorAll('p')).map(node => ({ text: node.textContent?.trim(), visible: visibleInOwnedDom(node) })) }));
  observed.skeletonCount = container.querySelectorAll('.skeleton').length;
  observed.html = container.innerHTML; observed.response = response; observed.apiCalls = calls; observed.boundaryErrors = boundaryErrors.slice(startBoundary); observed.navigationCalls = navigationCalls.slice(startNavigation); observed.activations = [...activations]; observed.controlsPassedBeforeOracle = true;
  dump(locale + '-observed.json', observed);
  // FIRST product oracle. No heading or existing skeleton is a prerequisite.
  expect(alerts).toHaveLength(1);
  expect(visibleInOwnedDom(alerts[0])).toBe(true);
  const visibleTexts = Array.from(alerts[0].querySelectorAll('p')).filter(visibleInOwnedDom).map(node => node.textContent?.trim());
  expect(visibleTexts).toContain(copy.loadFailed);
  expect(visibleTexts).toContain(copy.loadFailedHint);
  expect(container.querySelectorAll('.skeleton')).toHaveLength(0);
 } catch (error) {
  observed.error = String((error as Error).stack || error);
  if (!fs.existsSync(path.join(OUT!, locale + '-observed.json'))) dump(locale + '-observed.json', observed);
  throw error;
 } finally {
  // Settle this one owned deferred even if a prerequisite stopped the case; never initiate a request or retry.
  if (!ownedPending.settled) await act(async () => { ownedPending.settle(); await ownedPending.promise; });
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  pending = undefined;
  for (const type of ['click', 'input', 'change', 'submit']) dom.window.document.removeEventListener(type, recordActivation, true);
  dump(locale + '-cleanup.json', { ownContainerRemoved: !container?.isConnected, remainingOwnedContainers: dom.window.document.querySelectorAll('[data-case-owned]').length, knownDeferredSettled: ownedPending.settled, apiCalls: apiCalls.slice(startApi), boundaryErrors: boundaryErrors.slice(startBoundary), navigationCalls: navigationCalls.slice(startNavigation), activations, timerInventoryMeasured: false });
 }
}, 15000);
